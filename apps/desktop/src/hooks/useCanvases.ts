import { flattenNodes } from "@/lib/canvasBoard";
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, listen, LOCAL, serverOfPath } from "@/lib/transport";
import type { Canvas, CanvasEdit, CanvasList, CanvasProblem, CanvasReconciliation, CanvasSummary, CanvasUndoState } from "@/types/events";
import { readLocalStorage, writeLocalStorage } from "@/hooks/useLocalStorage";

/// Notifications invalidate durable state; a stale read never wins a project or file switch.
export function useCanvases(projectPath: string | null, active: boolean) {
  const [files, setFiles] = useState<CanvasSummary[]>([]);
  const [fileId, setFileId] = useState<string | null>(null);
  const [canvas, setCanvas] = useState<Canvas | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [undoState, setUndoState] = useState<CanvasUndoState>({ canUndo: false, canRedo: false, undoLabel: null, redoLabel: null });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const owner = projectPath ? serverOfPath(projectPath) : LOCAL;
  const scope = useRef(`canvas-page-${crypto.randomUUID()}`).current;
  const current = useRef({ projectPath, fileId, canvas, active, files });
  current.current = { projectPath, fileId, canvas, active, files };
  const listSeq = useRef(0), readSeq = useRef(0), writing = useRef(false);
  const loadedProject = useRef<string | null>(null);

  const read = useCallback(async (id: string, reconcile = false) => {
    const seq = ++readSeq.current;
    try {
      const next = reconcile
        ? await invoke<CanvasReconciliation>("reconcile_canvas", { id }, owner).then((r) => { if (r.problems.length && readSeq.current === seq) setError(r.problems.map((p) => p.message).join(" · ")); return r.canvas; })
        : await invoke<Canvas>("read_canvas", { id }, owner);
      if (readSeq.current === seq && current.current.fileId === id && current.current.projectPath === projectPath) setCanvas(next);
    } catch (e) { if (readSeq.current === seq) setError(String(e)); }
  }, [owner, projectPath]);

  const refresh = useCallback(async () => {
    if (!projectPath) return;
    const seq = ++listSeq.current;
    setLoading(true);
    try {
      const result = await invoke<CanvasList>("list_canvases", { projectPath }, owner);
      if (listSeq.current !== seq) return;
      loadedProject.current = projectPath;
      setFiles(result.files);
      setError(result.problems.length ? result.problems.map((p) => `${p.path}: ${p.message}`).join(" · ") : null);
      setFileId((id) => {
        const remembered = readLocalStorage<string | null>(`carbon.canvas.file:${projectPath}`, null);
        return result.files.some((f) => f.id === id) ? id : result.files.find((f) => f.id === remembered)?.id ?? result.files[0]?.id ?? null;
      });
    } catch (e) { if (listSeq.current === seq) setError(String(e)); }
    finally { if (listSeq.current === seq) setLoading(false); }
  }, [owner, projectPath]);

  useEffect(() => {
    setFiles([]); setFileId(null); setCanvas(null); setError(null);
    loadedProject.current = null;
    listSeq.current++; readSeq.current++;
  }, [projectPath]);

  useEffect(() => {
    if (!active || !projectPath) return;
    let stopped = false;
    const invalidate = ({ server, payload }: { server: string; payload: CanvasSummary }) => {
      if (stopped || server !== owner) return;
      const files = current.current.files;
      if (files.length && !files.some((f) => f.projectKey === payload.projectKey)) return;
      void refresh();
      if (payload.id === current.current.fileId) void read(payload.id);
    };
    const off = [listen<CanvasSummary>("canvas_changed", invalidate), listen<CanvasSummary>("canvas_deleted", invalidate), listen("live_state", ({ server }) => {
      if (!stopped && server === owner) {
        void invoke("watch_canvases", { scope, ids: current.current.files.map((f) => f.id) }, owner).catch((e) => setError(String(e)));
        void refresh(); if (current.current.fileId) void read(current.current.fileId, true);
      }
    }), listen<CanvasProblem>("canvas_problem", ({ server, payload }) => { if (!stopped && server === owner && payload.id === current.current.fileId) setError(payload.message); })];
    void refresh();
    return () => { stopped = true; listSeq.current++; readSeq.current++; off.forEach((p) => void p.then((fn) => fn()).catch(console.error)); };
  }, [active, owner, projectPath, read, refresh, scope]);

  useEffect(() => {
    setNotice(null);
    setCanvas((previous) => previous?.id === fileId ? previous : null);
    readSeq.current++;
  }, [fileId, projectPath, owner]);

  useEffect(() => {
    if (!active || !fileId || !projectPath) return;
    writeLocalStorage(`carbon.canvas.file:${projectPath}`, fileId);
    void read(fileId, true);
  }, [fileId, projectPath, active, read]);

  const watchIds = files.map((f) => f.id).join(",");
  useEffect(() => {
    if (!active || !projectPath) return;
    void invoke("watch_canvases", { scope, ids: watchIds ? watchIds.split(",") : [] }, owner).catch((e) => setError(String(e)));
    return () => { void invoke("watch_canvases", { scope, ids: [] }, owner).catch(console.error); };
  }, [active, owner, projectPath, scope, watchIds]);

  const mutate = async (operation: () => Promise<Canvas>): Promise<Canvas | null> => {
    if (writing.current) return null;
    writing.current = true; setBusy(true); setError(null); setNotice(null);
    const path = projectPath;
    const selected = fileId;
    try {
      const next = await operation();
      if (current.current.projectPath === path) {
        if (current.current.fileId === selected) {
          readSeq.current++;
          setFileId(next.id); setCanvas(next);
        }
        setFiles((prev) => { const summary: CanvasSummary = { ...next, frameCount: next.frames.length }; return prev.some((f) => f.id === next.id) ? prev.map((f) => f.id === next.id ? summary : f) : [...prev, summary]; });
      }
      return next;
    } catch (e) { if (current.current.projectPath === path) { setError(String(e)); if (current.current.fileId) void read(current.current.fileId); } return null; }
    finally { writing.current = false; setBusy(false); }
  };
  const create = (name: string) => projectPath ? mutate(() => invoke<Canvas>("create_canvas", { projectPath, name }, owner)) : Promise.resolve(null);
  const edit = (patch: Partial<CanvasEdit>, label?: string, basis?: number) => {
    const doc = current.current.canvas;
    if (!doc || doc.id !== fileId) return Promise.resolve(null);
    return mutate(() => invoke<Canvas>("update_canvas", { id: doc.id, revision: basis ?? doc.revision, edit: patch, author: label ? { label } : undefined }, owner));
  };
  const pasteLayers = async (parent: string, after: string | null, source: { id: string; revision: number; layers: string[] }) => {
    const doc = current.current.canvas;
    if (!doc || doc.id !== fileId) return null;
    let selection: { frameId: string; nodeIds: string[] } | null = null;
    const saved = await mutate(async () => {
      const result = await invoke<{ canvas: Canvas; frameId: string; nodeIds: string[] }>("paste_canvas_layers", {
        id: doc.id, revision: doc.revision, parent, after, source,
      }, owner);
      selection = result;
      return result.canvas;
    });
    return saved && selection ? { canvas: saved, selection: selection as { frameId: string; nodeIds: string[] } } : null;
  };
  useEffect(() => {
    if (!active || !canvas) { setUndoState({ canUndo: false, canRedo: false, undoLabel: null, redoLabel: null }); return; }
    let stopped = false;
    void invoke<CanvasUndoState>("canvas_undo_state", { id: canvas.id }, owner).then((state) => { if (!stopped) setUndoState(state); }).catch((e) => { if (!stopped) setError(String(e)); });
    return () => { stopped = true; };
  }, [active, canvas?.id, canvas?.revision, owner]);
  const undo = (redo = false) => {
    const doc = current.current.canvas;
    if (!doc || doc.id !== fileId) return Promise.resolve(null);
    return mutate(async () => {
      const result = await invoke<{ canvas: Canvas; conflicts: string[] }>("canvas_undo", { id: doc.id, revision: doc.revision, redo }, owner);
      if (result.conflicts.length && current.current.fileId === doc.id) {
        const labels = result.conflicts.map((path) => {
          const parts = path.split("/");
          const frame = result.canvas.frames.find((frame) => frame.id === parts[2]);
          const layer = parts[3] === "layers" && frame ? flattenNodes(frame.content.nodes).find((n) => n.node.id === parts[4])?.node.name : null;
          return [frame?.name ?? "Canvas", layer, parts.at(-1) === parts[2] ? "content" : parts.at(-1)].filter(Boolean).join(" · ");
        });
        setNotice(`Kept later changes: ${[...new Set(labels)].join(", ")}.`);
      }
      return result.canvas;
    });
  };
  const reload = async () => {
    await refresh();
    if (current.current.projectPath === projectPath && current.current.active && current.current.fileId) await read(current.current.fileId, true);
  };
  return { files: loadedProject.current === projectPath ? files : [], fileId, select: setFileId, canvas: canvas?.id === fileId && loadedProject.current === projectPath ? canvas : null, loading, busy, error: notice ?? error, refresh: reload, create, edit, pasteLayers, setError, undo, undoState, owner };
}

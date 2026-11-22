import { useCallback, useEffect, useRef, useState } from "react";

import { canvasKey, type CanvasFile } from "@/lib/canvasFile";
import { relocateCanvasDocument } from "@/components/canvases/useCanvasDocument";
import { moveCanvasChat } from "@/lib/canvasChat";
import { projectLabel } from "@/lib/servers";
import { invoke, listen, qualify } from "@/lib/transport";
import type { Project } from "@/types/events";

export { canvasKey, type CanvasFile } from "@/lib/canvasFile";
export type CanvasLocation = { project: string; folder: string; archived: boolean };
export const canvasRoot: CanvasLocation = { project: "", folder: "", archived: false };
type Entry = Omit<CanvasFile, "project"> & { modified: number; archived: boolean };
type Inventory = { folders: string[]; canvases: Entry[] };
export type CanvasAction =
  | { kind: "create"; folder: string }
  | { kind: "folder"; folder: string; name: string }
  | { kind: "archive"; folder: string; name: string }
  | { kind: "restore"; folder: string; name: string }
  | { kind: "move"; folder: string; name: string; destination: string };

export function useCanvasLibrary(projects: Project[], visible: boolean) {
  const [location, setLocation] = useState(canvasRoot);
  const scope = !location.project || projects.some((p) => p.path === location.project) ? location : canvasRoot;
  const [libraries, setLibraries] = useState<Record<string, Inventory>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [tabs, setTabs] = useState<CanvasFile[]>([]);
  const [selection, select] = useState<string | null>(null);
  const [serial, setSerial] = useState(0);
  const refresh = useCallback(() => setSerial((n) => n + 1), []);
  const writing = useRef(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const off = listen<{project: string; folder: string; canvas: string | null; command?: {group: string; args?: {destination: string}}}>("canvas_changed", ({payload, server}) => {
      const file = {project: qualify(payload.project, server), folder: payload.folder, name: payload.canvas ?? ""};
      const key = canvasKey(file);
      if (payload.command?.group === "move" && payload.command.args) {
        const moved = {...file, folder: payload.command.args.destination};
        relocateCanvasDocument(file, moved, false);
        moveCanvasChat(key, canvasKey(moved));
        setTabs(tabs => tabs.map(t => canvasKey(t) === key ? moved : t));
        select(active => active === key ? canvasKey(moved) : active);
      } else if (payload.command?.group === "archive" || payload.command?.group === "restore") {
        const archive = payload.command.group === "archive";
        relocateCanvasDocument(file, file, archive, !archive);
      }
      refresh();
    });
    return () => { void off.then(remove => remove()); };
  }, [refresh]);

  useEffect(() => {
    if (!visible) return;
    let current = true;
    setLoading(true);
    const read = (p: Project) => invoke<Inventory>("canvas_library", { projectPath: p.path });
    Promise.allSettled(projects.map(read)).then((results) => {
      if (!current) return;
      const next: Record<string, Inventory> = {};
      const failures: string[] = [];
      results.forEach((result, i) => {
        const project = projects[i];
        if (result.status === "fulfilled") next[project.path] = result.value;
        else failures.push(`${projectLabel(project)}: ${String(result.reason)}`);
      });
      setLibraries(next);
      setErrors(failures);
      setLoading(false);
      setTabs((open) =>
        open.filter(
          (tab) =>
            !next[tab.project] ||
            next[tab.project].canvases.some(
              (item) => !item.archived && item.folder === tab.folder && item.name === tab.name,
            ),
        ),
      );
    });
    window.addEventListener("focus", refresh);
    return () => {
      current = false;
      window.removeEventListener("focus", refresh);
    };
  }, [projects, visible, serial, refresh]);

  const open = (file: CanvasFile) => {
    const key = canvasKey(file);
    setTabs((prev) => (prev.some((tab) => canvasKey(tab) === key) ? prev : [...prev, file]));
    select(key);
  };
  const close = (key: string) => {
    setTabs((prev) => prev.filter((tab) => canvasKey(tab) !== key));
    select((prev) => (prev === key ? null : prev));
  };
  const change = async (project: string, action: CanvasAction) => {
    if (writing.current) return false;
    writing.current = true;
    setBusy(true);
    try {
      const name = await invoke<string>("change_canvas_library", { projectPath: project, action });
      if (action.kind === "create") open({ project, folder: action.folder, name });
      const file = { project, folder: action.folder, name };
      if (action.kind === "restore") relocateCanvasDocument(file, file, false, true);
      if (action.kind === "archive" || action.kind === "move") {
        const old = canvasKey(file);
        if (action.kind === "archive") {
          relocateCanvasDocument(file, file, true);
          close(old);
        } else {
          const moved = { project, folder: action.destination, name };
          relocateCanvasDocument(file, moved, false);
          moveCanvasChat(old, canvasKey(moved));
          setTabs((prev) => prev.map((tab) => (canvasKey(tab) === old ? moved : tab)));
          select((prev) => (prev === old ? canvasKey(moved) : prev));
        }
      }
      refresh();
      return true;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };
  const visibleTabs = tabs.filter((tab) => projects.some((p) => p.path === tab.project));
  const active = visibleTabs.find((tab) => canvasKey(tab) === selection);
  return { scope, setLocation, libraries, errors, loading, busy, refresh, tabs: visibleTabs, active, select, open, close, change };
}

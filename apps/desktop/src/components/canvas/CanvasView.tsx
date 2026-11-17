import { setCanvasFocus, type CanvasPreviewTarget } from "@/lib/canvasContext";
import { invoke, listen, displayPath } from "@/lib/transport";
import { IS_MAC } from "@/lib/platform";
import BrowserPane from "@/components/browser/BrowserPane";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import CanvasChrome from "./CanvasChrome";
import { CanvasFileDialog, CanvasFrameDialog } from "./CanvasDialogs";
import CanvasLayers from "./CanvasLayers";
import CanvasProperties from "./CanvasProperties";
import CanvasBoard from "./CanvasBoard";
import LiveFrame, { useFramePreviews } from "./FrameRenderer";
import { useCanvases } from "@/hooks/useCanvases";
import { blankFrame, flattenNodes, togglePick, previewKey, type CanvasPanelTab, type CanvasPick } from "@/lib/canvasBoard";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import type { Project, SessionIndexItem } from "@/types/events";
import { projectLabel } from "@/lib/servers";
import "./canvas.css";

export type CanvasControls = { toggleLayers(): void; togglePanel(): void; refresh(): void };

export default function CanvasView({ active, projects, projectPath, onProjectChange, sessions, sessionId, onSessionChange, onNewSession, chat, panelTab, onPanelTabChange, chatReady, projectPreview, controlsRef, agentTarget }: {
  active: boolean; projects: Project[]; projectPath: string | null; onProjectChange(path: string): void;
  sessions: SessionIndexItem[]; sessionId: string | null; onSessionChange(id: string): void; onNewSession(): void;
  chat: ReactNode; panelTab: CanvasPanelTab; onPanelTabChange(tab: CanvasPanelTab): void; chatReady: boolean; projectPreview: ReactNode;
  controlsRef: RefObject<CanvasControls | null>;
  agentTarget?: CanvasPreviewTarget | null;
}) {
  const data = useCanvases(projectPath, active);
  const [selection, setSelection] = useState<{ id: string | null; picks: CanvasPick[] }>({ id: null, picks: [] });
  const picks = selection.id === data.canvas?.id ? selection.picks.filter((p) => data.canvas!.frames.some((f) => f.id === p.frameId && (!p.nodeId || flattenNodes(f.content.nodes).some((n) => n.node.id === p.nodeId)))) : [];
  const select = (next: CanvasPick[]) => setSelection({ id: data.canvas?.id ?? null, picks: next });
  const [visible, setVisible] = useState<string[]>([]);
  const capture = useFramePreviews(data.canvas, data.owner, visible, active);
  const [dialog, setDialog] = useState<"create" | "rename" | "frame" | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [previewTarget, setPreviewTarget] = useState<"frame" | "project">("frame");
  const toggleLayersRef = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    controlsRef.current = { toggleLayers: () => toggleLayersRef.current?.(), togglePanel: () => setPanelOpen((open) => !open), refresh: () => { void data.refresh(); capture.retry(); } };
    return () => { controlsRef.current = null; };
  });
  const pick = picks.at(-1);
  const frame = data.canvas?.frames.find((f) => f.id === pick?.frameId) ?? null;
  const node = useMemo(() => pick?.nodeId && frame ? flattenNodes(frame.content.nodes).find((n) => n.node.id === pick.nodeId)?.node ?? null : null, [frame, pick?.nodeId]);
  const box = frame && pick?.nodeId ? capture.previews.get(frame.id)?.boxes.find((b) => b.id === pick.nodeId) ?? null : null;
  const selectionLabel = picks.length > 1 ? `${picks.length} selected` : node?.name ?? frame?.name ?? null;
  const currentSession = sessions.find((s) => s.sessionId === sessionId);
  const [editors, setEditors] = useState<{ canvasId: string; frameId: string }[]>([]);
  const [agentPreview, setAgentPreview] = useState<{ canvasId: string; frameId: string; sessionId: string } | null>(null);
  const handledOpen = useRef<string | null>(null);
  useEffect(() => {
    if (!active || !agentTarget || agentTarget.revealId === handledOpen.current || agentTarget.sessionId !== sessionId || agentTarget.projectPath !== displayPath(projectPath ?? "")) return;
    handledOpen.current = agentTarget.revealId;
    data.select(agentTarget.canvasId); setSelection({ id: agentTarget.canvasId, picks: [{ frameId: agentTarget.frameId, nodeId: null }] });
    setAgentPreview(agentTarget); setPreviewTarget("frame"); setPanelOpen(true); onPanelTabChange("preview");
  }, [active, agentTarget, sessionId, projectPath, onPanelTabChange]);

  useLayoutEffect(() => {
    if (projectPath) setCanvasFocus(projectPath, active && data.canvas ? { id: data.canvas.id, projectPath, revision: data.canvas.revision, picks: picks.map((pick) => {
      const pickedFrame = data.canvas!.frames.find((frame) => frame.id === pick.frameId);
      const preview = pickedFrame ? capture.previews.get(pickedFrame.id) : null;
      const bounds = pick.nodeId ? preview?.key.startsWith(`${previewKey(pickedFrame!, data.canvas!.tokens)}:`) ? preview.boxes.find((box) => box.id === pick.nodeId) : null : pickedFrame?.geometry;
      return { ...pick, bounds: bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null };
    }), previewFrameId: panelOpen && panelTab === "preview" && previewTarget === "frame" ? frame?.id ?? null : null } : null);
    return () => { if (projectPath) setCanvasFocus(projectPath, null); };
  }, [active, projectPath, data.canvas, selection, frame?.id, panelOpen, panelTab, previewTarget, capture.revision]);
  useEffect(() => {
    if (!active) return;
    const keydown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.defaultPrevented || event.isComposing || !(IS_MAC ? event.metaKey : event.ctrlKey) || event.altKey || event.key.toLowerCase() !== "z" || target?.closest("input,textarea,[contenteditable=true],[role=textbox],[role=dialog]")) return;
      event.preventDefault();
      if (!data.busy && (event.shiftKey ? data.undoState.canRedo : data.undoState.canUndo)) void data.undo(event.shiftKey);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [active, data.busy, data.undoState, data.undo]);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const refresh = () => { void invoke<{ canvasId: string; frameId: string }[]>("canvas_editors", {}, data.owner).then((value) => { if (!stopped) setEditors(value); }).catch(console.error); };
    refresh();
    const off = [listen<{ canvasId: string; frameId: string }[]>("canvas_editors", ({ server, payload }) => { if (!stopped && server === data.owner) setEditors(payload); }),
      listen("live_state", ({ server }) => { if (!stopped && server === data.owner) refresh(); }),
];
    return () => { stopped = true; off.forEach((p) => void p.then((fn) => fn()).catch(console.error)); };
  }, [active, projectPath, sessionId, data.owner, onPanelTabChange]);

  return <>
    <CanvasChrome active={active} toggleLayersRef={toggleLayersRef} projects={projects.map((p) => ({ path: p.path, name: projectLabel(p) }))} projectPath={projectPath} onProjectChange={onProjectChange}
      files={data.files} fileId={data.fileId} onFileChange={data.select} onCreateFile={() => setDialog("create")} onRenameFile={() => setDialog("rename")}
      onUndo={() => void data.undo()} onRedo={() => void data.undo(true)} canUndo={data.undoState.canUndo && !data.busy} canRedo={data.undoState.canRedo && !data.busy}
      onNewFrame={() => setDialog("frame")} loading={data.loading} error={data.error} onRefresh={() => { void data.refresh(); capture.retry(); }} selectionLabel={selectionLabel}
      panelTab={panelTab} onPanelTabChange={onPanelTabChange} panelOpen={panelOpen} onPanelOpenChange={setPanelOpen}
      layers={<CanvasLayers frames={data.canvas?.frames ?? []} picks={picks} onPick={(p, additive) => select(togglePick(picks, p, additive))} />}
      board={data.canvas ? <CanvasBoard key={data.canvas.id} canvas={data.canvas} active={active} picks={picks} onPicks={select} previews={capture.previews} errors={capture.errors} onVisible={setVisible} onNewFrame={() => setDialog("frame")} stats={capture.stats} editing={editors.filter((e) => e.canvasId === data.canvas?.id).map((e) => e.frameId)} />
        : <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground"><p>{data.loading ? "Loading canvases…" : data.fileId ? "Opening canvas…" : projectPath ? "Create a canvas for your designs" : "Choose a project to open its canvases"}</p>{projectPath && !data.fileId && <Button variant="secondary" size="sm" onClick={() => setDialog("create")}>New canvas</Button>}</div>}
      chat={<div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-3 py-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="xs" aria-label={`Canvas chat session: ${currentSession?.title ?? "Pick a session"}`} disabled={!sessions.length} className="min-w-0 flex-1 justify-between"><span className="truncate">{currentSession?.title ?? "Pick a session"}</span><ChevronDown /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-w-80 min-w-48">
              <DropdownMenuRadioGroup value={currentSession?.sessionId ?? ""} onValueChange={onSessionChange}>
                {sessions.map((s) => <DropdownMenuRadioItem key={s.sessionId} value={s.sessionId}><span className="truncate">{s.title}</span></DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu><Button variant="ghost" size="xs" onClick={onNewSession} disabled={!projectPath}>New session</Button>
        </div>
        {chatReady ? chat : <p className="p-4 text-sm text-muted-foreground">{projectPath ? "Opening the project session…" : "Choose a project to chat."}</p>}
      </div>}
      preview={<div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-1 border-b border-hairline px-2 py-1.5"><Button variant="ghost" size="xs" aria-pressed={previewTarget === "frame"} onClick={() => setPreviewTarget("frame")}>Focused frame</Button><Button variant="ghost" size="xs" aria-pressed={previewTarget === "project"} onClick={() => setPreviewTarget("project")}>Running project</Button></div>
        {previewTarget === "frame" ? active && panelOpen && panelTab === "preview" && data.canvas && frame ? agentPreview?.canvasId === data.canvas.id && agentPreview.frameId === frame.id && agentPreview.sessionId === sessionId ? <BrowserPane sessionId={agentPreview.sessionId} active={active && panelOpen && panelTab === "preview"} mode="panel" /> : <LiveFrame canvas={data.canvas} frame={frame} owner={data.owner} /> : <p className="p-4 text-sm text-muted-foreground">Select a frame to preview it at its original size.</p> : projectPreview}
      </div>}
      properties={<CanvasProperties frame={frame} node={node} box={box} count={picks.length} />}
    />
    {capture.renderer}
    <CanvasFileDialog open={active && (dialog === "create" || dialog === "rename")} onOpenChange={(open) => { if (!open) setDialog(null); }} initialName={dialog === "rename" ? data.canvas?.name ?? "" : ""} title={dialog === "rename" ? "Rename canvas" : "New canvas"} busy={data.busy} error={data.error}
      onSubmit={(name) => { void (dialog === "rename" ? data.edit({ name }) : data.create(name)).then((saved) => { if (saved) setDialog(null); }); }} />
    <CanvasFrameDialog open={active && dialog === "frame"} onOpenChange={(open) => { if (!open) setDialog(null); }} busy={data.busy} error={data.error} onSubmit={(name, width, height) => {
      if (!data.canvas) return;
      const added = blankFrame(name, width, height, data.canvas.frames);
      void data.edit({ frames: [...data.canvas.frames, added] }).then((saved) => { if (saved) { setDialog(null); setSelection({ id: saved.id, picks: [{ frameId: added.id, nodeId: null }] }); } });
    }} />
  </>;
}

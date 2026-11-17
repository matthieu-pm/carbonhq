import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import CanvasChrome from "./CanvasChrome";
import { CanvasFileDialog, CanvasFrameDialog } from "./CanvasDialogs";
import CanvasLayers from "./CanvasLayers";
import CanvasProperties from "./CanvasProperties";
import CanvasBoard from "./CanvasBoard";
import LiveFrame, { useFramePreviews } from "./FrameRenderer";
import { useCanvases } from "@/hooks/useCanvases";
import { blankFrame, flattenNodes, type CanvasPick } from "@/lib/canvasBoard";
import { Button } from "@/components/ui/button";
import type { Project, SessionIndexItem } from "@/types/events";
import { projectLabel } from "@/lib/servers";
import "./canvas.css";

export type CanvasPanelTab = "chat" | "preview" | "properties";
export type CanvasControls = { toggleLayers(): void; togglePanel(): void; refresh(): void };

export default function CanvasView({ active, projects, projectPath, onProjectChange, sessions, sessionId, onSessionChange, onNewSession, chat, panelTab, onPanelTabChange, chatReady, projectPreview, controlsRef }: {
  active: boolean; projects: Project[]; projectPath: string | null; onProjectChange(path: string): void;
  sessions: SessionIndexItem[]; sessionId: string | null; onSessionChange(id: string): void; onNewSession(): void;
  chat: ReactNode; panelTab: CanvasPanelTab; onPanelTabChange(tab: CanvasPanelTab): void; chatReady: boolean; projectPreview: ReactNode;
  controlsRef: RefObject<CanvasControls | null>;
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
  return <>
    <CanvasChrome active={active} toggleLayersRef={toggleLayersRef} projects={projects.map((p) => ({ path: p.path, name: projectLabel(p) }))} projectPath={projectPath} onProjectChange={onProjectChange}
      files={data.files} fileId={data.fileId} onFileChange={data.select} onCreateFile={() => setDialog("create")} onRenameFile={() => setDialog("rename")}
      onNewFrame={() => setDialog("frame")} loading={data.loading} error={data.error} onRefresh={() => { void data.refresh(); capture.retry(); }} selectionLabel={selectionLabel}
      panelTab={panelTab} onPanelTabChange={onPanelTabChange} panelOpen={panelOpen} onPanelOpenChange={setPanelOpen}
      layers={<CanvasLayers frames={data.canvas?.frames ?? []} picks={picks} onPick={(p, additive) => {
        const same = picks.some((s) => s.frameId === p.frameId && s.nodeId === p.nodeId);
        select(additive ? same ? picks.filter((s) => s.frameId !== p.frameId || s.nodeId !== p.nodeId) : [...picks, p] : [p]);
      }} />}
      board={data.canvas ? <CanvasBoard key={data.canvas.id} canvas={data.canvas} active={active} picks={picks} onPicks={select} previews={capture.previews} errors={capture.errors} onVisible={setVisible} onNewFrame={() => setDialog("frame")} stats={capture.stats} />
        : <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground"><p>{data.loading ? "Loading canvases…" : data.fileId ? "Opening canvas…" : projectPath ? "Create a canvas for your designs" : "Choose a project to open its canvases"}</p>{projectPath && !data.fileId && <Button variant="secondary" size="sm" onClick={() => setDialog("create")}>New canvas</Button>}</div>}
      chat={<div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-3 py-2">
          <select aria-label="Canvas chat session" className="min-w-0 flex-1 rounded-md bg-transparent text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" value={currentSession?.sessionId ?? ""} onChange={(e) => e.target.value ? onSessionChange(e.target.value) : onNewSession()}>
            <option value="">New session</option>{sessions.map((s) => <option key={s.sessionId} value={s.sessionId}>{s.title}</option>)}
          </select><Button variant="ghost" size="xs" onClick={onNewSession} disabled={!projectPath}>New session</Button>
        </div>
        {chatReady ? chat : <p className="p-4 text-sm text-muted-foreground">{projectPath ? "Opening the project session…" : "Choose a project to chat."}</p>}
      </div>}
      preview={<div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-1 border-b border-hairline px-2 py-1.5"><Button variant="ghost" size="xs" aria-pressed={previewTarget === "frame"} onClick={() => setPreviewTarget("frame")}>Focused frame</Button><Button variant="ghost" size="xs" aria-pressed={previewTarget === "project"} onClick={() => setPreviewTarget("project")}>Running project</Button></div>
        {previewTarget === "frame" ? active && panelOpen && panelTab === "preview" && data.canvas && frame ? <LiveFrame canvas={data.canvas} frame={frame} owner={data.owner} /> : <p className="p-4 text-sm text-muted-foreground">Select a frame to preview it at its original size.</p> : projectPreview}
      </div>}
      properties={<CanvasProperties frame={frame} node={node} box={box} count={picks.length} />}
    />
    {capture.renderer}
    <CanvasFileDialog open={dialog === "create" || dialog === "rename"} onOpenChange={(open) => { if (!open) setDialog(null); }} initialName={dialog === "rename" ? data.canvas?.name ?? "" : ""} title={dialog === "rename" ? "Rename canvas" : "New canvas"} busy={data.busy} error={data.error}
      onSubmit={(name) => { void (dialog === "rename" ? data.edit({ name }) : data.create(name)).then((saved) => { if (saved) setDialog(null); }); }} />
    <CanvasFrameDialog open={dialog === "frame"} onOpenChange={(open) => { if (!open) setDialog(null); }} busy={data.busy} error={data.error} onSubmit={(name, width, height) => {
      if (!data.canvas) return;
      const added = blankFrame(name, width, height, data.canvas.frames);
      void data.edit({ frames: [...data.canvas.frames, added] }).then((saved) => { if (saved) { setDialog(null); setSelection({ id: saved.id, picks: [{ frameId: added.id, nodeId: null }] }); } });
    }} />
  </>;
}

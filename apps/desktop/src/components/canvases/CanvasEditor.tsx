import { editLayer } from "./layerEdit";
import { useCanvasWindowPart, useEditorStatus, visibility } from "@/lib/canvasWindow";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  File,
  Frame,
  Hand,
  Layers,
  MousePointer2,
  Pencil,
  MessageSquare,
  Plus,
  Square,
  Type,
} from "lucide-react";
import { DockedSidebarFrame } from "@/components/layout/AppShell";
import Segmented from "@/components/Segmented";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { canvasKey, type CanvasFile } from "@/hooks/useCanvasLibrary";
import { CanvasComposerSlot } from "@/lib/canvasChat";
import type { Project } from "@/types/events";
import { useCanvasDocument } from "./useCanvasDocument";
import { CanvasTheme } from "./CanvasTheme";
import { CanvasInspector } from "./CanvasInspector";
import { CanvasBoard, type Tool } from "./CanvasBoard";
import { CanvasCamera, zoomAt, initialView } from "./canvasCamera";
import { ToolButton } from "./EditorControls";
import { uid } from "./document";
import { pageLayers, graphicsScene } from "./graphicsScene";
import { LayerTree } from "./LayerTree";
import "./editor.css";

const tools = [
  { name: "Select", icon: MousePointer2, key: "V" },
  { name: "Hand", icon: Hand, key: "H" },
  { name: "Frame", icon: Frame, key: "F" },
  { name: "Rectangle", icon: Square, key: "R" },
  { name: "Text", icon: Type, key: "T" },
  { name: "Pen", icon: Pencil, key: "P" },
  { name: "Comment", icon: MessageSquare, key: "C" },
] as const;

const tabs = [
  { value: "Design", label: "Design" },
  { value: "Theme", label: "Theme" },
] as const;
function CameraZoom({ camera }: { camera: CanvasCamera }) {
  return <>{useSyncExternalStore(camera.subscribe, camera.percent)}%</>;
}
export function CanvasEditor({
  file,
  projects,
  collapsed,
  controlsOpen = true,
  sidebarStyle,
  resizeHandle,
  libraryError,
}: {
  file: CanvasFile;
  projects: Project[];
  collapsed: boolean;
  controlsOpen?: boolean;
  sidebarStyle: CSSProperties;
  resizeHandle: ReactNode;
  libraryError: string;
}) {
  const { doc, preview, error, saving, conflict, session } = useCanvasDocument(file);
  const composer = useContext(CanvasComposerSlot);
  useEditorStatus(canvasKey(file), !!doc, doc ? "" : error);
  const [mode, setMode] = useState<"Design" | "Theme">("Design");
  const [tool, setTool] = useState<Tool>("Select");
  const [pageId, setPageId] = useState("");
  const [selectedId, select] = useState<string | null>(null);
  const [renaming, rename] = useState<string | null>(null);
  const [folded, fold] = useState(new Set<string>());
  const [pagesOpen, showPages] = useState(true);
  const [camera] = useState(() => new CanvasCamera());
  const root = useRef<HTMLElement>(null);
  const page = doc?.pages.find((p) => p.id === pageId) ?? doc?.pages[0];
  const [renderer, setRenderer] = useState<"Graphics" | "DOM" | "Compare">("Graphics");
  const retainedScene = useRef<ReturnType<typeof graphicsScene> | undefined>(undefined);
  const tree = useMemo(() => pageLayers(doc?.elements ?? [], page?.id, retainedScene.current?.tree), [doc?.elements, page?.id]);
  const scene = useMemo(() => graphicsScene(tree, doc?.tokens ?? [], retainedScene.current), [tree, doc?.tokens]);
  useEffect(() => { retainedScene.current = scene; }, [scene]);
  const boardScene = useMemo(
    () => preview ? graphicsScene(pageLayers(preview.elements, page?.id), preview.tokens) : scene,
    [preview, page?.id, scene],
  );
  const selected = selectedId ? tree.byId.get(selectedId) : undefined;
  const pick = useCallback((id: string | null) => {
    select(id);
    let parent = id ? tree.byId.get(id)?.parent : null;
    if (parent) {
      const next = new Set(folded);
      while (parent) {
        next.delete(parent);
        parent = tree.byId.get(parent)?.parent;
      }
      if (next.size !== folded.size) fold(next);
    }
  }, [folded, tree]);
  function activate(id: string) {
    setPageId(id);
    select(null);
    camera.set(initialView);
  }
  const zoom = (next: number) => {
    const b = root.current?.querySelector(".ce-board")?.getBoundingClientRect();
    if (b) camera.set(zoomAt(camera.latest(), next, b.width / 2, b.height / 2));
  };
  function fit() {
    const view = camera.get();
    const board = root.current?.querySelector(".ce-board"),
      b = board?.getBoundingClientRect();
    if (!board || !b) return;
    const rects = Array.from(board.querySelectorAll<HTMLElement>(".ce-world > [data-layer]")).map((el) =>
      el.getBoundingClientRect(),
    );
    let left = scene.extent?.x ?? Infinity, top = scene.extent?.y ?? Infinity;
    let right = scene.extent ? scene.extent.x + scene.extent.w : -Infinity;
    let bottom = scene.extent ? scene.extent.y + scene.extent.h : -Infinity;
    for (const r of rects) {
      left = Math.min(left, (r.left - b.left - view.x) / view.zoom);
      top = Math.min(top, (r.top - b.top - view.y) / view.zoom);
      right = Math.max(right, (r.right - b.left - view.x) / view.zoom);
      bottom = Math.max(bottom, (r.bottom - b.top - view.y) / view.zoom);
    }
    if (!Number.isFinite(left)) { camera.set(initialView); return; }
    const w = right - left, h = bottom - top;
    const z = Math.max(0.05, Math.min(8, (b.width - 64) / Math.max(1, w), (b.height - 64) / Math.max(1, h)));
    camera.set({ zoom: z, x: (b.width - w * z) / 2 - left * z, y: (b.height - h * z) / 2 - top * z });
  }
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, [!!doc]);
  useCanvasWindowPart("editor", async ({ command }) => {
    if (command.group !== "view") throw Error("Choose a view command.");
    const a = command.args;
    if (a.op === "state") return { page: page?.id, layer: selectedId, tool, mode, view: camera.latest(), pagesOpen, folded: [...folded], saving, conflict, error, ready: !!doc };
    if (!doc && a.op !== "reload") throw Error(error || "Canvas is loading.");
    const blurField = () => {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && root.current?.contains(focused)) focused.blur();
    };
    if (["save", "undo", "redo", "keep-mine"].includes(a.op)) blurField();
    switch (a.op) {
      case "page":
        if (!doc?.pages.some(p => p.id === a.id)) throw Error("Unknown page.");
        activate(a.id); break;
      case "select":
        if (a.id !== null && !tree.byId.has(a.id)) throw Error("Unknown layer on this page.");
        pick(a.id); break;
      case "mode":
        if (a.mode !== "Theme" && a.mode !== "Design") throw Error("Choose Design or Theme.");
        setMode(a.mode); break;
      case "tool": {
        const match = tools.find(t => t.name === a.tool);
        if (!match) throw Error("Unknown canvas tool.");
        setTool(match.name); break;
      }
      case "pan": camera.set({...camera.latest(), x: a.x, y: a.y}); break;
      case "zoom":
        if (a.factor < 0.05 || a.factor > 8) throw Error("Choose a zoom between 0.05 and 8.");
        zoom(a.factor); break;
      case "fit": fit(); break;
      case "tree": {
        if (!tree.byId.has(a.id)) throw Error("Unknown layer on this page.");
        const next = new Set(folded);
        if (visibility(a.visibility)) next.delete(a.id); else next.add(a.id);
        fold(next); break;
      }
      case "panel":
        if (a.panel !== "pages") throw Error("Unknown panel.");
        showPages(visibility(a.visibility)); break;
      case "undo": case "redo":
        if (!session.travel(a.op === "redo")) throw Error("No editor history in that direction.");
        await session.flush(); break;
      case "reload": await session.reload(blurField); break;
      case "save": await session.flush(); break;
      case "keep-mine": await session.keepMine(); break;
      default: throw Error("Unknown editor action.");
    }
    if (["undo", "redo", "save", "reload", "keep-mine"].includes(a.op) && session.get().error) throw Error(session.get().error);
  });
  function keys(e: React.KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (!root.current?.contains(target) || target.closest("input,textarea,select,[contenteditable=true],.ce-composer"))
      return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      session.travel(e.shiftKey);
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape") {
      select(null);
      setTool("Select");
      return;
    }
    const item = tools.find((t) => t.key === e.key.toUpperCase());
    if (item) {
      setTool(item.name);
      e.preventDefault();
      return;
    }
    const editingLayers = mode === "Design" && !!target.closest('.ce-board, nav[aria-label="Layers"]');
    if (editingLayers && selected && ["Delete", "Backspace"].includes(e.key)) {
      e.preventDefault();
      const ids = new Set<string>();
      const take = (id: string) => {
        ids.add(id);
        tree.children.get(id)?.forEach((l) => take(l.id));
      };
      take(selected.id);
      session.change((d) => ({ ...d, elements: d.elements.filter((l) => !ids.has(l.id)) }));
      select(null);
    }
    if (
      selected &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) &&
      editingLayers &&
      !target.closest("button") &&
      (!selected.parent || tree.byId.get(selected.parent)?.style.display !== "flex")
    ) {
      const n = e.shiftKey ? 10 : 1;
      e.preventDefault();
      session.change(
        d => editLayer(d, selected, l => ({
          ...l,
          x: l.x + (e.key === "ArrowLeft" ? -n : e.key === "ArrowRight" ? n : 0),
          y: l.y + (e.key === "ArrowUp" ? -n : e.key === "ArrowDown" ? n : 0),
        })),
        "nudge:" + selected.id,
      );
    }
  }
  const notices = (preview || libraryError || error) && (
    <>
      {preview && <p className="ce-notice" role="status">Previewing agent edits</p>}
      {libraryError && (
        <p className="ce-notice" role="alert">
          {libraryError}
        </p>
      )}
      {error && (
        <div role="alert" className="ce-notice">
          {error}
          <Button
            size="sm"
            disabled={saving}
            onClick={() => void (conflict ? session.keepMine() : session.flush())}
          >
            {conflict ? "Keep my edits" : "Retry save"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              if (window.confirm("Discard unsaved edits and reload this canvas?")) void session.load();
            }}
          >
            Reload from disk
          </Button>
        </div>
      )}
    </>
  );
  return (
    <section
      className="ce-editor"
      aria-label={"Canvas: " + file.name}
      tabIndex={-1}
      ref={root}
      data-canvas-key={canvasKey(file)}
      onKeyDown={keys}
      onInputCapture={(e) => {
        const input = e.target as Element;
        if (input.matches("textarea,input[type=color]")) session.groupInput(input);
      }}
    >
      {!collapsed && (
        <DockedSidebarFrame>
          <aside className="ce-nav" style={sidebarStyle} aria-label="Canvas navigation">
            {resizeHandle}
            <header className="ce-title">
              <Layers size={15} />
              <strong>{file.name}</strong>
            </header>
            <Segmented
              label="Canvas navigation mode"
              className="ce-tabs"
              value={mode}
              options={tabs}
              onPick={setMode}
            />
            {doc &&
              page &&
              (mode === "Theme" ? (
                <CanvasTheme doc={doc} change={session.change} project={file.project} projects={projects} />
              ) : (
                <>
                  <div className="ce-heading ce-pages-header">
                    <button
                      className="ce-pages-heading"
                      aria-expanded={pagesOpen}
                      onClick={() => showPages(!pagesOpen)}
                    >
                      {pagesOpen ? <ChevronDown /> : <ChevronRight />}Pages
                    </button>
                    <ToolButton
                      label="Add page"
                      onClick={() => {
                        const p = {
                          id: uid(),
                          name: "Page " + (doc.pages.length + 1),
                          background: "#282828",
                        };
                        session.change((d) => ({ ...d, pages: [...d.pages, p] }));
                        activate(p.id);
                        showPages(true);
                        rename(p.id);
                      }}
                    >
                      <Plus />
                    </ToolButton>
                  </div>
                  <div className="ce-scroll ce-pages-scroll">
                    {pagesOpen && (
                      <div className="ce-pages">
                        {doc.pages.map((p) =>
                          renaming === p.id ? (
                            <input
                              key={p.id}
                              className="ce-search"
                              aria-label="Page name"
                              autoFocus
                              defaultValue={p.name}
                              onFocus={(e) => e.target.select()}
                              onBlur={(e) => {
                                const name = e.target.value.trim();
                                if (name && name !== p.name)
                                  session.change((d) => ({
                                    ...d,
                                    pages: d.pages.map((item) =>
                                      item.id === p.id ? { ...item, name } : item,
                                    ),
                                  }));
                                rename(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") e.currentTarget.blur();
                                if (e.key === "Escape") {
                                  e.currentTarget.value = p.name;
                                  e.currentTarget.blur();
                                }
                              }}
                            />
                          ) : (
                            <button
                              className="ce-row"
                              key={p.id}
                              aria-current={page.id === p.id ? "page" : undefined}
                              onClick={() => {
                                if (page.id !== p.id) activate(p.id);
                              }}
                              onDoubleClick={() => rename(p.id)}
                            >
                              <File size={14} />
                              <span>{p.name}</span>
                              {page.id === p.id && <Check size={13} />}
                            </button>
                          ),
                        )}
                      </div>
                    )}
                    <LayerTree pagesOpen={pagesOpen} tree={tree} folded={folded} fold={fold} selected={selectedId} pick={pick} />
                  </div>
                </>
              ))}
          </aside>
        </DockedSidebarFrame>
      )}
      {doc && page ? (
        <>
          <div className="ce-stage">
            {!controlsOpen && notices && <div className="ce-stage-notices">{notices}</div>}
            <CanvasBoard
              scene={scene}
              agentScene={boardScene}
              graphics={renderer !== "DOM"}
              doc={doc}
              page={page}
              tool={tool}
              setTool={setTool}
              selected={selected}
              select={pick}
              camera={camera}
              session={session}
            />
            {renderer === "Compare" && <CanvasBoard reference graphics={false} scene={scene} agentScene={boardScene}
              doc={doc} page={page} tool={tool} setTool={setTool} selected={selected} select={pick}
              camera={camera} session={session} />}
            <div className="ce-bottom">
              {composer}
              <div className="ce-toolbar" role="toolbar" aria-label="Canvas tools">
                {tools.map(({ name, key, icon: Icon }) => (
                  <ToolButton
                    key={name}
                    label={name}
                    shortcut={key}
                    active={tool === name}
                    onClick={() => setTool(name)}
                  >
                    <Icon />
                  </ToolButton>
                ))}
              </div>
            </div>
          </div>
          <aside className="ce-inspector" hidden={!controlsOpen} aria-label="Canvas inspector">
            <header className="ce-inspector-head">
              <span aria-live="polite">{saving ? "Saving…" : ""}</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><button className="ce-zoom" aria-label="Canvas renderer">
                  {renderer} <ChevronDown size={12} /></button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {(["Graphics", "DOM", "Compare"] as const).map(r =>
                    <DropdownMenuItem key={r} onSelect={() => setRenderer(r)}>
                      {r === "Compare" ? "Compare side by side" : r === "DOM" ? "DOM reference" : "Graphics"}
                    </DropdownMenuItem>)}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="ce-zoom" aria-label="Canvas zoom">
                    <CameraZoom camera={camera} /> <ChevronDown size={12} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={fit}>Zoom to fit</DropdownMenuItem>
                  {[0.25, 0.5, 0.75, 1, 1.5, 2, 4].map((z) => (
                    <DropdownMenuItem key={z} onSelect={() => zoom(z)}>
                      {z * 100}%
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </header>
            {controlsOpen && notices}
            <div className="ce-scroll">
              <CanvasInspector
                tree={tree}
                key={selected?.id ?? page.id}
                doc={doc}
                page={page}
                layer={selected}
                change={session.change}
              />
            </div>
          </aside>
        </>
      ) : (
        <div className="ce-load" role={error ? "alert" : "status"}>
          {error || "Opening canvas…"}
          {error && (
            <Button size="sm" onClick={() => void session.load()}>
              Retry
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  File,
  Frame,
  Hand,
  Layers,
  MousePointer2,
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
import type { CanvasFile } from "@/hooks/useCanvasLibrary";
import type { Project } from "@/types/events";
import { useCanvasDocument } from "./useCanvasDocument";
import { CanvasTheme } from "./CanvasTheme";
import { CanvasInspector } from "./CanvasInspector";
import { CanvasBoard, zoomAt, type Tool, type View } from "./CanvasBoard";
import { ToolButton } from "./EditorControls";
import { uid } from "./document";
import "./editor.css";

const tools = [
  { name: "Select", icon: MousePointer2, key: "V" },
  { name: "Hand", icon: Hand, key: "H" },
  { name: "Frame", icon: Frame, key: "F" },
  { name: "Rectangle", icon: Square, key: "R" },
  { name: "Text", icon: Type, key: "T" },
] as const;
const glyph = { Frame, Rectangle: Square, Text: Type };
const tabs = [
  { value: "Design", label: "Design" },
  { value: "Theme", label: "Theme" },
] as const;
const initialView: View = { x: 32, y: 40, zoom: 1 };
export function CanvasEditor({
  file,
  projects,
  collapsed,
  sidebarStyle,
  resizeHandle,
}: {
  file: CanvasFile;
  projects: Project[];
  collapsed: boolean;
  sidebarStyle: CSSProperties;
  resizeHandle: ReactNode;
}) {
  const { doc, error, saving, session } = useCanvasDocument(file);
  const [mode, setMode] = useState<"Design" | "Theme">("Design");
  const [tool, setTool] = useState<Tool>("Select");
  const [pageId, setPageId] = useState("");
  const [selectedId, select] = useState<string | null>(null);
  const [renaming, rename] = useState<string | null>(null);
  const [folded, fold] = useState(new Set<string>());
  const [pagesOpen, showPages] = useState(true);
  const [view, setView] = useState(initialView);
  const root = useRef<HTMLElement>(null);
  const page = doc?.pages.find((p) => p.id === pageId) ?? doc?.pages[0];
  const layers = doc?.elements.filter((l) => l.page === page?.id) ?? [];
  const selected = layers.find((l) => l.id === selectedId);
  function pick(id: string | null) {
    select(id);
    let parent = layers.find((l) => l.id === id)?.parent;
    if (parent) {
      const next = new Set(folded);
      while (parent) {
        next.delete(parent);
        parent = layers.find((l) => l.id === parent)?.parent;
      }
      fold(next);
    }
  }
  function activate(id: string) {
    setPageId(id);
    select(null);
    setView(initialView);
  }
  function tree(parent: string | null, depth = 0): ReactNode {
    return layers
      .filter((l) => l.parent === parent)
      .map((l) => {
        const Glyph = glyph[l.kind],
          hasChildren = layers.some((c) => c.parent === l.id);
        return (
          <div key={l.id}>
            <div
              className="ce-tree-row"
              data-selected={selectedId === l.id}
              style={{ paddingLeft: 7 + depth * 14 }}
            >
              {hasChildren ? (
                <button
                  className="ce-disclosure"
                  aria-label={(folded.has(l.id) ? "Expand " : "Collapse ") + l.name}
                  aria-expanded={!folded.has(l.id)}
                  onClick={() =>
                    fold((prev) => {
                      const n = new Set(prev);
                      if (n.has(l.id)) n.delete(l.id);
                      else n.add(l.id);
                      return n;
                    })
                  }
                >
                  {folded.has(l.id) ? <ChevronRight /> : <ChevronDown />}
                </button>
              ) : (
                <i className="ce-indent" />
              )}
              <button className="ce-layer-row" aria-pressed={selectedId === l.id} onClick={() => pick(l.id)}>
                <Glyph size={14} />
                <span>{l.name}</span>
              </button>
            </div>
            {!folded.has(l.id) && tree(l.id, depth + 1)}
          </div>
        );
      });
  }
  const zoom = (next: number) => {
    const b = root.current?.querySelector(".ce-board")?.getBoundingClientRect();
    if (b) setView((v) => zoomAt(v, next, b.width / 2, b.height / 2));
  };
  function fit() {
    const board = root.current?.querySelector(".ce-board"),
      b = board?.getBoundingClientRect();
    if (!board || !b) return;
    const rects = Array.from(board.querySelectorAll<HTMLElement>(".ce-world > [data-layer]")).map((el) =>
      el.getBoundingClientRect(),
    );
    if (!rects.length) {
      setView(initialView);
      return;
    }
    const left = (Math.min(...rects.map((r) => r.left)) - b.left - view.x) / view.zoom,
      top = (Math.min(...rects.map((r) => r.top)) - b.top - view.y) / view.zoom;
    const w = (Math.max(...rects.map((r) => r.right)) - b.left - view.x) / view.zoom - left,
      h = (Math.max(...rects.map((r) => r.bottom)) - b.top - view.y) / view.zoom - top;
    const z = Math.max(0.05, Math.min(8, (b.width - 64) / Math.max(1, w), (b.height - 64) / Math.max(1, h)));
    setView({ zoom: z, x: (b.width - w * z) / 2 - left * z, y: (b.height - h * z) / 2 - top * z });
  }
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, [!!doc]);
  function keys(e: React.KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (!root.current?.contains(target) || target.closest("input,textarea,select,[contenteditable=true]"))
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
    if (selected && ["Delete", "Backspace"].includes(e.key)) {
      e.preventDefault();
      const ids = new Set<string>();
      const take = (id: string) => {
        ids.add(id);
        layers.filter((l) => l.parent === id).forEach((l) => take(l.id));
      };
      take(selected.id);
      session.change((d) => ({ ...d, elements: d.elements.filter((l) => !ids.has(l.id)) }));
      select(null);
    }
    if (
      selected &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) &&
      !target.closest("button")
    ) {
      const n = e.shiftKey ? 10 : 1;
      e.preventDefault();
      session.change((d) => ({
        ...d,
        elements: d.elements.map((l) =>
          l.id !== selected.id
            ? l
            : {
                ...l,
                x: l.x + (e.key === "ArrowLeft" ? -n : e.key === "ArrowRight" ? n : 0),
                y: l.y + (e.key === "ArrowUp" ? -n : e.key === "ArrowDown" ? n : 0),
              },
        ),
      }));
    }
  }
  return (
    <section
      className="ce-editor"
      aria-label={"Canvas: " + file.name}
      tabIndex={-1}
      ref={root}
      onKeyDown={keys}
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
                  <div className="ce-heading">
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
                  <div className="ce-scroll">
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
                    <nav aria-label="Layers">{tree(null)}</nav>
                  </div>
                </>
              ))}
          </aside>
        </DockedSidebarFrame>
      )}
      {doc && page ? (
        <>
          <div className="ce-rail" role="toolbar" aria-label="Canvas tools">
            {tools.map(({ name, key, icon: Icon }) => (
              <ToolButton
                key={name}
                label={name + " (" + key + ")"}
                active={tool === name}
                onClick={() => setTool(name)}
              >
                <Icon />
              </ToolButton>
            ))}
          </div>
          <CanvasBoard
            doc={doc}
            page={page}
            tool={tool}
            setTool={setTool}
            selected={selected}
            select={pick}
            view={view}
            setView={setView}
            change={session.change}
          />
          <aside className="ce-inspector" aria-label="Canvas inspector">
            <header className="ce-inspector-head">
              <span aria-live="polite">{saving ? "Saving…" : ""}</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="ce-zoom" aria-label="Canvas zoom">
                    {Math.round(view.zoom * 100)}% <ChevronDown size={12} />
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
            {error && (
              <div role="alert" className="ce-notice">
                {error}
                <Button size="sm" onClick={() => void session.flush()}>
                  Retry save
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
            <div className="ce-scroll">
              <CanvasInspector
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

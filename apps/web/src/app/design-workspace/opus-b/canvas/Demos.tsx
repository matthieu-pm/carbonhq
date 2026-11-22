"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { Archive, Eye, EyeOff, FileJson, Folder, LayoutGrid, List, Search } from "lucide-react";
import { cx } from "@/components/app/Window";

const PANEL = "bg-[#0A0A0A] light:bg-white light:shadow-[0_0_0_1px_#0000000F]";
const MONO = "font-mono text-xs leading-4 tracking-[-0.04em]";

type Fx = { id: string; label: string; detail: string; on: boolean };
const START_FX: Fx[] = [
  { id: "fill", label: "Fill", detail: "Linear 135°", on: true },
  { id: "border", label: "Border", detail: "1px all", on: true },
  { id: "shadow", label: "Shadow", detail: "0 24 48 −12", on: true },
  { id: "inner", label: "Inner shadow", detail: "0 1 0 0", on: true },
  { id: "backdrop", label: "Backdrop filter", detail: "blur 14px", on: true },
  { id: "stroke", label: "Text stroke", detail: "1px", on: false },
];

/// A layer's effect stack. Each eye hides one effect without losing it.
export function EffectsDemo() {
  const [fx, setFx] = useState(START_FX);
  const on = (id: string) => fx.find((f) => f.id === id)!.on;
  const shadows = [on("shadow") && "0 24px 48px -12px rgb(0 0 0 / 55%)", on("inner") && "inset 0 1px 0 0 rgb(255 255 255 / 40%)"].filter(Boolean);
  const card: CSSProperties = {
    background: on("fill") ? "linear-gradient(135deg, rgb(255 255 255 / 28%), rgb(255 255 255 / 6%))" : "transparent",
    border: on("border") ? "1px solid rgb(255 255 255 / 35%)" : "1px solid transparent",
    boxShadow: shadows.join(", ") || "none",
    backdropFilter: on("backdrop") ? "blur(14px)" : "none",
    WebkitBackdropFilter: on("backdrop") ? "blur(14px)" : "none",
  };
  return (
    <div className="grid border border-[#FFFFFF26] light:border-black/10 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="relative grid min-h-[300px] place-items-center overflow-hidden bg-[#1b1b2a]">
        <i className="absolute top-[12%] left-[18%] size-36 rounded-full bg-[#ef5a3c]" />
        <i className="absolute right-[16%] bottom-[10%] size-44 rounded-full bg-[#4f5bff]" />
        <i className="absolute top-[40%] left-[46%] size-20 rounded-full bg-[#e2a400]" />
        <div className="relative flex h-40 w-56 flex-col justify-between rounded-[18px] p-5 text-white transition-all duration-200" style={card}>
          <span className="text-5xl font-light tracking-[-0.04em]" style={on("stroke") ? { WebkitTextStroke: "1px #fff", color: "transparent" } : undefined}>
            72°
          </span>
          <small className="text-xs text-white/75">Glass card · Rectangle</small>
        </div>
      </div>
      <ol aria-label="Effects on Glass card" className={cx("flex flex-col border-[#FFFFFF26] max-lg:border-t lg:border-l light:border-black/10", PANEL)}>
        {fx.map((f) => (
          <li key={f.id} className={cx("flex h-[46px] items-center gap-2.5 border-b border-[#FFFFFF14] px-3 last:border-b-0 light:border-black/5", !f.on && "opacity-45")}>
            <button
              type="button"
              aria-pressed={f.on}
              aria-label={`${f.on ? "Hide" : "Show"} ${f.label}`}
              onClick={() => setFx((all) => all.map((x) => (x.id === f.id ? { ...x, on: !x.on } : x)))}
              className="grid size-7 place-items-center text-[#8A8A8A] hover:text-white light:hover:text-[#0A0A0A]"
            >
              {f.on ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
            </button>
            <span className={cx(MONO, "text-white light:text-[#0A0A0A]")}>{f.label}</span>
            <span className={cx(MONO, "ml-auto text-[11px] text-[#8A8A8A]")}>{f.detail}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

type Canvas = { name: string; folder: string; project: string; archived: boolean; edited: string };
const CANVASES: Canvas[] = [
  { name: "onboarding", folder: "", project: "web-app", archived: false, edited: "2 min ago" },
  { name: "checkout", folder: "flows", project: "web-app", archived: false, edited: "1 h ago" },
  { name: "settings", folder: "flows", project: "web-app", archived: false, edited: "Yesterday" },
  { name: "pricing", folder: "marketing", project: "site", archived: false, edited: "Tue" },
  { name: "launch-og", folder: "marketing", project: "site", archived: false, edited: "Mon" },
  { name: "old-nav", folder: "", project: "web-app", archived: true, edited: "Oct 2" },
  { name: "hero-v1", folder: "", project: "site", archived: true, edited: "Sep 18" },
];
const HUES = ["#4f5bff", "#ef5a3c", "#14a37f", "#c9417e", "#e2a400", "#5c5c63", "#7a7a80"];

/// The canvas library: Dashboard and Archive, search, project filter, grid or list.
export function LibraryDemo() {
  const [archived, setArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CANVASES.filter((c) => c.archived === archived && (!project || c.project === project) && `${c.name} ${c.folder} ${c.project}`.toLowerCase().includes(q));
  }, [archived, query, project]);
  const seg = (on: boolean) => cx("flex h-8 items-center gap-1.5 px-3 text-[13px]", on ? "bg-[#525252] text-white" : "text-[#8A8A8A] hover:text-white light:hover:text-[#0A0A0A]");

  return (
    <div className="border border-[#FFFFFF26] light:border-black/10">
      <div className="flex flex-wrap gap-2 border-b border-[#FFFFFF26] bg-[#FFFFFF1A] p-3 light:border-black/10 light:bg-[#F4F4F5]">
        <div role="tablist" aria-label="Library" className={cx("flex", PANEL)}>
          <button type="button" role="tab" aria-selected={!archived} onClick={() => setArchived(false)} className={seg(!archived)}>
            <LayoutGrid className="size-3.5" /> Dashboard
          </button>
          <button type="button" role="tab" aria-selected={archived} onClick={() => setArchived(true)} className={seg(archived)}>
            <Archive className="size-3.5" /> Archive
          </button>
        </div>
        <label className={cx("flex h-8 min-w-[180px] flex-1 items-center gap-2 px-2.5 text-[#8A8A8A] focus-within:ring-1 focus-within:ring-[#8A8A8A]", PANEL)}>
          <Search className="size-3.5" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search canvases" aria-label="Search canvases" className={cx(MONO, "min-w-0 flex-1 bg-transparent text-white outline-none light:text-[#0A0A0A]")} />
        </label>
        <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Filter by project" className={cx(MONO, "h-8 px-2 text-white light:text-[#0A0A0A]", PANEL)}>
          <option value="">All projects</option>
          <option value="web-app">web-app</option>
          <option value="site">site</option>
        </select>
        <div role="radiogroup" aria-label="Library layout" className={cx("flex", PANEL)}>
          <button type="button" role="radio" aria-checked={layout === "grid"} aria-label="Grid view" onClick={() => setLayout("grid")} className={seg(layout === "grid")}>
            <LayoutGrid className="size-3.5" />
          </button>
          <button type="button" role="radio" aria-checked={layout === "list"} aria-label="List view" onClick={() => setLayout("list")} className={seg(layout === "list")}>
            <List className="size-3.5" />
          </button>
        </div>
      </div>
      {shown.length ? (
        <ul className={cx("p-3", layout === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(min(100%,200px),1fr))] gap-3" : "flex flex-col gap-1")}>
          {shown.map((c) => (
            <li key={c.project + c.name} className={PANEL}>
              {layout === "grid" && (
                <div className="relative h-[100px] bg-[#282828]">
                  <span className="absolute top-4 left-[22%] h-[68px] w-[34%] bg-white" />
                  <span className="absolute top-7 left-[calc(22%+10px)] h-6 w-[22%]" style={{ background: HUES[CANVASES.indexOf(c) % HUES.length] }} />
                </div>
              )}
              <div className={cx("flex gap-1 p-3", layout === "grid" ? "flex-col" : "items-center justify-between")}>
                <span className={cx(MONO, "flex items-center gap-1.5 text-white light:text-[#0A0A0A]")}>
                  <FileJson className="size-3" /> {c.name}
                </span>
                <span className={cx(MONO, "flex items-center gap-1 text-[11px] text-[#8A8A8A]")}>
                  {c.folder && (
                    <>
                      <Folder className="size-3" /> {c.folder} ·
                    </>
                  )}{" "}
                  {c.project} · {c.edited}
                </span>
                {layout === "grid" && (
                  <span className={cx(MONO, "truncate text-[10px] text-[#5A5A5A] light:text-[#A1A1AA]")}>
                    canvases/{c.archived ? ".archive/" : c.folder ? c.folder + "/" : ""}
                    {c.name}.canvas.json
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-8 text-center text-[15px] text-[#8A8A8A]">No canvases match.</p>
      )}
    </div>
  );
}

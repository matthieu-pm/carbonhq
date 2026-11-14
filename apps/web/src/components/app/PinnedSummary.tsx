import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { AppWindow, Check, ChevronDown, FileDiff, GitBranch, Globe, GripVertical, Monitor, MoreHorizontal, SlidersHorizontal } from "lucide-react";

import { LinearGlyph } from "@/components/LinearGlyph";
import { GitHubGlyph } from "@/components/GitHubGlyph";
import { cx } from "./Window";
import { useDragReorder } from "./useDragReorder";
import { PrMergedGlyph, PrOpenGlyph } from "./Panel";

export type SummaryFile = { dir: string; name: string; added: number; removed: number };
export type SummaryData = {
  branch: string;
  files: SummaryFile[];
  pr?: { number: number; title: string; merged: boolean };
  sources: string[];
  tasks?: string[];
  context: number;
};

const ROW = "flex min-h-8 w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-1 text-left text-xs text-foreground/80 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
const ITEMS = [
  ["workspace", "Workspace and editor"], ["branch", "Branch"], ["changes", "Changes"],
  ["prs", "Pull requests"], ["tasks", "Tasks"], ["subagents", "Subagents"], ["sources", "Sources"], ["context", "Context window"],
] as const;
type Item = typeof ITEMS[number][0];
const SECTION_ORDER = ["workspace", "git", "prs", "tasks", "sources", "context"] as const;
type SectionId = typeof SECTION_ORDER[number];
type Reorder = ReturnType<typeof useDragReorder<SectionId>>;

/// The app's own 18px Nucleo glyph and icon-sm toolbar treatment.
export function PinnedSummaryToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <span className="group/summary-toggle relative flex shrink-0">
      <button id="preview-summary-toggle" type="button" aria-label="Toggle pinned summary" aria-pressed={open} aria-controls="preview-pinned-summary" onClick={onToggle}
        className={cx("grid size-7 shrink-0 place-items-center rounded-[min(var(--radius-md),12px)] text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring", open && "bg-accent text-foreground")}>
        <svg xmlns="http://www.w3.org/2000/svg" width={18} height={18} viewBox="0 0 18 18" className="size-4.5" aria-hidden>
          <line x1="9.75" y1="5.25" x2="15.75" y2="5.25" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
          <line x1="9.75" y1="12.75" x2="15.75" y2="12.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
          <path d="m2.75,3.8974v2.7051c0,.1826.1922.3013.3555.2197l2.7051-1.3526c.181-.0905.181-.3489,0-.4394l-2.7051-1.3526c-.1633-.0817-.3555.0371-.3555.2197Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" fill="currentColor" />
          <path d="m2.75,11.3974v2.7051c0,.1826.1922.3013.3555.2197l2.7051-1.3526c.181-.0905.181-.3489,0-.4394l-2.7051-1.3526c-.1633-.0817-.3555.0371-.3555.2197Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" fill="currentColor" />
        </svg>
      </button>
      <span role="tooltip" className="pointer-events-none absolute top-full right-0 z-50 mt-1 hidden whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-ui text-foreground shadow-lg group-hover/summary-toggle:block group-focus-within/summary-toggle:block">Toggle pinned summary</span>
    </span>
  );
}

/// Copied presentation from the desktop summary; all figures belong to the selected demo chat.
export default function PinnedSummary({ data, docked, onOpen, onHide, hidden, onHiddenChange, order, onOrderChange }: {
  data: SummaryData;
  order: SectionId[];
  onOrderChange: (order: SectionId[]) => void;
  docked: boolean;
  onOpen: (tab: "PR" | "Changes" | "Browser" | "More") => void;
  onHide: () => void;
  hidden: Item[];
  onHiddenChange: (items: Item[]) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const visible = (item: Item) => !hidden.includes(item);
  const added = data.files.reduce((sum, file) => sum + file.added, 0);
  const removed = data.files.reduce((sum, file) => sum + file.removed, 0);
  const hide = () => {
    setMenuOpen(false);
    onHide();
    document.getElementById("preview-summary-toggle")?.focus();
  };

  useEffect(() => {
    if (!menuOpen) return;
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')?.focus();
    const close = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  const present: Record<SectionId, boolean> = {
    workspace: visible("workspace"), git: visible("branch") || visible("changes"),
    prs: visible("prs") && !!data.pr, tasks: visible("tasks") && !!data.tasks?.length,
    sources: visible("sources") && !!data.sources.length, context: visible("context"),
  };
  const shown = order.filter((id) => present[id]);
  const reorder = useDragReorder(shown, (id) => id, (id, _delta, to) => {
    const next = shown.filter((section) => section !== id);
    next.splice(to, 0, id);
    let index = 0;
    onOrderChange(order.map((section) => present[section] ? next[index++] : section));
  });
  const sections: Record<SectionId, (at: { index: number; reorder: Reorder }) => ReactNode> = {
    workspace: (at) => <Section label="Workspace" {...at}>
        <div className="flex min-h-8 min-w-0 items-center gap-2.5 px-2.5 text-xs text-foreground/80"><Monitor className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">This Mac</span><span className="max-w-32 truncate text-muted-foreground group-hover/section:invisible group-has-[[data-grip]:focus-visible]/section:invisible group-data-held/section:invisible">{data.branch}</span></div>
        <div className="flex h-8 items-center gap-2.5 px-2.5 text-xs text-muted-foreground"><AppWindow className="size-4 shrink-0" /><span className="flex-1">Open in Cursor</span><ChevronDown className="size-3" /></div>
      </Section>,
    git: (at) => <Section label="Branch and changes" {...at}>
        {visible("branch") && <div className="flex min-h-8 min-w-0 items-center gap-2.5 px-2.5 text-xs text-foreground/80"><GitBranch className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{data.branch}</span></div>}
        {visible("changes") && <button type="button" className={ROW} onClick={() => onOpen("Changes")}><FileDiff className="size-4 shrink-0 text-muted-foreground" /><span className="flex-1">Changes</span><span className="flex gap-1.5 font-mono tabular-nums"><span className={added ? "text-accent-add" : "text-muted-foreground"}>+{added}</span><span className={removed ? "text-destructive" : "text-muted-foreground"}>-{removed}</span></span></button>}
      </Section>,
    prs: (at) => data.pr && <Section label="Pull requests" title="Pull requests" {...at}><button type="button" className={ROW} onClick={() => onOpen("PR")}>{data.pr.merged ? <PrMergedGlyph /> : <PrOpenGlyph />}<span className="truncate">{data.pr.title}</span></button></Section>,
    tasks: (at) => data.tasks && <Section label="Tasks" title="Tasks" {...at} action={<span className="text-xs text-muted-foreground">{data.tasks.length}/{data.tasks.length}</span>}><ul className="flex flex-col gap-1.5 px-2.5 py-1">{data.tasks.map((task) => <li key={task} className="flex items-start gap-2 text-xs text-muted-foreground"><Check className="mt-0.5 size-3 shrink-0" />{task}</li>)}</ul></Section>,
    sources: (at) => <Section label="Sources" title="Sources" {...at}>{data.sources.map((source) => <div key={source} className="flex min-h-8 items-center gap-2.5 px-2.5 py-1 text-xs text-foreground/80">{source === "Linear" ? <LinearGlyph className="size-4 shrink-0 text-muted-foreground" /> : source === "GitHub" ? <GitHubGlyph className="size-4 shrink-0 text-muted-foreground" /> : <Globe className="size-4 shrink-0 text-muted-foreground" />}<span className="min-w-0 flex-1 truncate">{source}</span><span className="shrink-0 text-muted-foreground">MCP</span></div>)}</Section>,
    context: (at) => <Section label="Context window" title="Context window" {...at}>
        <div className="px-2.5 pb-1 text-xs"><div className="flex min-h-5 items-baseline justify-between gap-2"><span>{Math.round(data.context * 100)}% used</span><span className="tabular-nums text-muted-foreground">{Math.round(data.context * 200)}k / 200k</span></div><div role="img" aria-label={`Context ${Math.round(data.context * 100)}% used`} className="relative flex h-3.5 gap-px"><span className="absolute inset-x-0 top-1 h-1.5 rounded-l-[2px] rounded-r-full bg-muted" /><span className="relative flex h-full shrink-0 items-center" style={{ width: `${data.context * 100}%` }}><span className="h-1.5 w-full rounded-[2px] bg-[#4f8fe8]" /></span></div></div>
      </Section>,
  };
  return (
    <section id="preview-pinned-summary" aria-label="Pinned summary" className={cx("min-h-0 overflow-y-auto", docked ? "flex-1" : "rounded-2xl bg-background")}>
      <div className="flex min-w-0 items-center justify-between gap-2 px-4 pt-3 pb-1">
        <span className="truncate text-xs text-muted-foreground">ade</span>
        <div ref={menu} className="relative" onKeyDown={(event) => { if (event.key === "Escape") { setMenuOpen(false); menu.current?.querySelector('button')?.focus(); }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? []);
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
          } }}>
          <button type="button" aria-label="Summary options" aria-expanded={menuOpen} aria-haspopup="menu" onClick={() => setMenuOpen((open) => !open)} className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"><MoreHorizontal className="size-4" /></button>
          {menuOpen && <div role="menu" aria-label="Show in conversation details" className="absolute top-full right-0 z-30 mt-1 w-56 rounded-lg border border-border bg-popover p-1 text-xs text-foreground shadow-lg">
            <div className="px-2 py-1.5 font-medium">Show in conversation details</div>
            {ITEMS.map(([id, label]) => <button type="button" role="menuitemcheckbox" aria-checked={visible(id)} key={id} onClick={() => onHiddenChange(visible(id) ? [...hidden, id] : hidden.filter((item) => item !== id))} className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"><span className="size-3.5">{visible(id) && <Check className="size-3.5" />}</span>{label}</button>)}
            <div className="my-1 h-px bg-border" />
            <button type="button" role="menuitem" onClick={() => { onHiddenChange([]); onOrderChange([...SECTION_ORDER]); }} className={ROW}>Reset to default</button>
            <button type="button" role="menuitem" onClick={hide} className={ROW}>Hide pinned summary</button>
          </div>}
        </div>
      </div>
      <div ref={reorder.list}>
        {reorder.shown.map((id, index) => <Fragment key={id}>{sections[id]({ index, reorder })}</Fragment>)}
        {!shown.length && <div className="p-2"><button type="button" className={ROW} onClick={() => setMenuOpen(true)}><SlidersHorizontal className="size-4" />Choose what to show</button></div>}
      </div>
    </section>
  );
}

/// Uses the desktop section grip, including arrow-key reordering.
function Section({ label, title, action, index, reorder, children }: {
  label: string; title?: string; action?: ReactNode; index: number; reorder: Reorder; children: ReactNode;
}) {
  const { drag, shown, start, commit, offset } = reorder;
  const held = drag?.from === index;
  return (
    <section aria-label={label} data-held={held || undefined} style={{ transform: offset(index) }}
      onPointerDown={(event) => { if ((event.target as Element).closest("[data-grip]")) start(event, index); }}
      className={cx("group/section relative border-t border-border/65 px-2 py-2 first:border-t-0", drag && !held && "transition-transform duration-150 ease-out", held && "z-10 rounded-xl border-transparent bg-background")}>
      {shown.length > 1 && <button type="button" data-grip aria-label={`Move ${label}`}
        onKeyDown={(event) => {
          const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
          if (!delta) return;
          event.preventDefault();
          if (!drag) commit(index, index + delta);
        }}
        className={cx("absolute top-2 right-4.5 flex w-3 cursor-grab touch-none items-center justify-center rounded-sm text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring group-hover/section:opacity-100", title ? "h-6" : "h-8", held && "opacity-100")}><GripVertical className="size-3" /></button>}
      {title && <div className="mb-1 flex min-h-6 items-center justify-between gap-2 px-2.5"><h3 className="text-xs text-muted-foreground">{title}</h3>{action && <div className="group-hover/section:invisible group-has-[[data-grip]:focus-visible]/section:invisible group-data-held/section:invisible">{action}</div>}</div>}
      {children}
    </section>
  );
}

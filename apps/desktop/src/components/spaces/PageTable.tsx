import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Check, Download, FileText, Loader2, MessageSquarePlus, Minus, RotateCcw, Star, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pageKey, readPage, startChatWithPages, type LocatedPage, type PageTarget } from "@/lib/pages";
import { invoke, LOCAL } from "@/lib/transport";
import { serverName } from "@/lib/servers";
import { relativeTime } from "@/lib/format";
import type { Project } from "@/types/events";

/// The Pages list: a checkbox gutter, Name / Source / Last activity, and a bar
/// for what a selection can do. Grid view draws cards and takes no selection.
export default function PageTable({ pages, projects, grid, trash, active, onOpen, onChanged, onError }: {
  pages: LocatedPage[];
  projects: Project[];
  grid: boolean;
  trash: boolean;
  active: boolean;
  onOpen: (target: PageTarget) => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"chat" | "download" | "trash" | null>(null);
  const anchor = useRef<number | null>(null);
  // A Page that left the list (trashed elsewhere, filtered out) leaves the selection with it.
  const selected = useMemo(() => pages.filter((page) => picked.has(pageKey(page))), [pages, picked]);
  const all = selected.length > 0 && selected.length === pages.length;
  const clear = () => { setPicked(new Set()); anchor.current = null; };

  useEffect(() => {
    if (!active || selected.length === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable]")) return;
      event.preventDefault();
      clear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, selected.length]);

  const toggle = (index: number, range: boolean) => {
    const key = pageKey(pages[index]);
    setPicked((previous) => {
      const next = new Set(previous);
      if (range && anchor.current !== null) {
        const [from, to] = [Math.min(anchor.current, index), Math.max(anchor.current, index)];
        for (const page of pages.slice(from, to + 1)) next.add(pageKey(page));
      } else if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    anchor.current = index;
  };
  const toggleAll = () => {
    setPicked(all ? new Set() : new Set(pages.map(pageKey)));
    anchor.current = null;
  };
  const clickRow = (event: MouseEvent, index: number) => {
    if (event.shiftKey || event.metaKey) { toggle(index, event.shiftKey); return; }
    onOpen({ id: pages[index].id, server: pages[index].server });
  };

  const run = async (kind: NonNullable<typeof busy>, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(kind);
    try { await action(); } catch (reason) { onError(String(reason)); } finally { setBusy(null); }
  };
  const read = () => Promise.all(selected.map((page) => readPage(page)));
  const startChat = () => run("chat", async () => { startChatWithPages(await read()); clear(); });
  const download = () => run("download", async () => {
    const documents = await read();
    await invoke("save_markdown_files", { files: documents.map(({ title, markdown }) => ({ title, markdown })) }, LOCAL);
  });
  const moveToTrash = () => run("trash", async () => {
    // Each Page answers on its own, so one stale revision doesn't strand the rest.
    const results = await Promise.allSettled(selected.map((page) =>
      invoke("set_page_trashed", { id: page.id, revision: page.revision, trashed: !trash }, page.server)));
    clear();
    onChanged();
    const failed = results.filter((result) => result.status === "rejected").length;
    if (failed) throw new Error(`${failed} of ${results.length} Pages could not be ${trash ? "restored" : "moved to Trash"}. Refresh and try again.`);
  });

  const source = (page: LocatedPage) => {
    const names = page.projectPaths.map((path) => projects.find((p) => p.path === path)?.name ?? path.split("/").pop()).join(", ");
    return <>{names || "—"}{page.server !== LOCAL && <span className="ml-2 text-xs">{serverName(page.server)}</span>}</>;
  };

  if (grid) {
    return <div className="spaces-page-grid">
      {pages.map((page) => <button key={pageKey(page)} className="spaces-card" onClick={() => onOpen({ id: page.id, server: page.server })}>
        <span className="flex w-full min-w-0 items-center gap-3"><PageIcon /><span className="truncate">{page.title}</span>{page.favorite && <Star className="size-3 shrink-0 fill-current text-primary" />}</span>
        {page.excerpt && <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{page.excerpt}</p>}
        <span className="mt-auto text-xs text-muted-foreground">{relativeTime(page.modified)}</span>
      </button>)}
    </div>;
  }

  return <>
    <div className="spaces-table" role="grid" aria-label="Pages" aria-multiselectable>
      <div className="spaces-row spaces-row-head" role="row">
        <span className="spaces-row-check"><Checkbox checked={all ? true : selected.length > 0 ? "mixed" : false} label="Select all Pages" onToggle={toggleAll} /></span>
        <span className="spaces-row-body"><span role="columnheader">Name</span><span role="columnheader">Source</span><span role="columnheader">Last activity</span></span>
      </div>
      {pages.map((page, index) => {
        const isPicked = picked.has(pageKey(page));
        return <div key={pageKey(page)} className="spaces-row" role="row" aria-selected={isPicked}>
          <span className="spaces-row-check"><Checkbox checked={isPicked} label={`Select ${page.title}`} onToggle={(range) => toggle(index, range)} /></span>
          <span className="spaces-row-body" onClick={(event) => clickRow(event, index)}>
            <span role="gridcell" className="flex min-w-0 items-center gap-3">
              <PageIcon />
              <button className="truncate text-left outline-none focus-visible:underline" onClick={(event) => { event.stopPropagation(); clickRow(event, index); }}>{page.title}</button>
              {page.favorite && <Star className="size-3 shrink-0 fill-current text-primary" aria-label="Favorite" />}
            </span>
            <span role="gridcell" className="truncate text-muted-foreground">{source(page)}</span>
            <span role="gridcell" className="text-muted-foreground">{relativeTime(page.modified)}</span>
          </span>
        </div>;
      })}
    </div>
    {selected.length > 0 && <div className="spaces-selection" role="toolbar" aria-label="Selected Pages">
      <span className="spaces-selection-count">{selected.length} selected</span>
      {!trash && <Action busy={busy === "chat"} disabled={!!busy} variant="default" icon={<MessageSquarePlus />} onClick={startChat}>Start chat</Action>}
      <Action busy={busy === "download"} disabled={!!busy} variant="outline" icon={<Download />} onClick={download}>Download</Action>
      {trash
        ? <Action busy={busy === "trash"} disabled={!!busy} variant="outline" icon={<RotateCcw />} onClick={moveToTrash}>Restore</Action>
        : <Action busy={busy === "trash"} disabled={!!busy} variant="destructive" icon={<Trash2 />} onClick={moveToTrash}>Delete</Action>}
      <Button size="icon-sm" variant="ghost" aria-label="Clear selection" onClick={clear}><X /></Button>
    </div>}
  </>;
}

function PageIcon() {
  return <span className="spaces-page-icon"><FileText /></span>;
}

function Action({ busy, disabled, variant, icon, onClick, children }: {
  busy: boolean; disabled: boolean; variant: "default" | "outline" | "destructive"; icon: ReactNode; onClick: () => void; children: ReactNode;
}) {
  return <Button size="sm" variant={variant} disabled={disabled} onClick={onClick}>{busy ? <Loader2 className="animate-spin" /> : icon}{children}</Button>;
}

/// A tri-state box: `mixed` is the header's answer to a partial selection.
function Checkbox({ checked, label, onToggle }: { checked: boolean | "mixed"; label: string; onToggle: (range: boolean) => void }) {
  return <button type="button" role="checkbox" aria-checked={checked} aria-label={label} className="spaces-check"
    onClick={(event) => { event.stopPropagation(); onToggle(event.shiftKey); }}>
    {checked === true ? <Check /> : checked === "mixed" ? <Minus /> : null}
  </button>;
}

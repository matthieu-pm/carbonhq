import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Code2, Eye, FileText, Folder, History, Loader2, Link2, ListTree, MessageSquarePlus, MoreHorizontal, PanelTop, Paperclip, SlidersHorizontal, Star, Trash2, Undo2, type LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useHotkey } from "@/hooks/useHotkey";
import { editPageDraft, markPageDraftPending, pageDraft, persistPageDraft, refreshPageDraft, resolvePageDraft, savePageDraft, usePageDocument } from "@/hooks/usePageDocument";
import { openPage, pageUrl, referencePageInTask, readPage, type LocatedPage, type Page } from "@/lib/pages";
import { richMarkdownReason } from "@/lib/pageMarkdown";
import { invoke, serverOfPath } from "@/lib/transport";
import { serverName } from "@/lib/servers";
import { cn } from "@/lib/utils";
import type { Project } from "@/types/events";
import type { PageEditorHandle } from "./RichPageEditor";
import PageHistory from "./PageHistory";
import PageBacklinks from "./PageBacklinks";
import PageMentionPicker from "./PageMentionPicker";
import PagePreview, { resolvePageImage } from "./PagePreview";
import { uploadPageAsset, usePageAssets } from "@/hooks/usePageAssets";
import LinearSyncPanel from "./LinearSyncPanel";
import DocumentOutline from "./DocumentOutline";

const RichPageEditor = lazy(() => import("./RichPageEditor"));
type Mode = "rich" | "source" | "preview";

/// Document state survives its view; the editor is only one way of editing that state.
export default function PageDocument({ page, active, projects, visibleProjects, onSaved, onTrashed, onFlushReady }: {
  page: LocatedPage<Page>; active: boolean; projects: Project[]; visibleProjects: string[] | null;
  onSaved: (page: LocatedPage<Page>) => void;
  onTrashed: () => void; onFlushReady: (flush: () => void) => void;
}) {
  const draft = usePageDocument(page, active);
  const { assets, error: assetError, refresh: refreshAssets } = usePageAssets(page, active);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const reason = richMarkdownReason(draft.markdown);
  const [mode, setMode] = useState<Mode>(() => reason ? "source" : "rich");
  const [editorPending, setEditorPending] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [copied, setCopied] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLTextAreaElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);
  useLayoutEffect(() => {
    const field = title.current;
    if (!field) return;
    let width = field.getBoundingClientRect().width;
    let frame = 0;
    const fit = () => {
      if (!field.getBoundingClientRect().width) return;
      field.style.height = "auto";
      field.style.height = `${field.scrollHeight}px`;
    };
    fit();
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    observer.observe(field);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [draft.title]);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [remote, setRemote] = useState<LocatedPage<Page> | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const editor = useRef<PageEditorHandle>(null);
  const richEdited = useRef(false);
  const source = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const isDirty = draft.dirty || editorPending;
  const bodyGeneration = useRef(0);
  const [editorGeneration, setEditorGeneration] = useState(0);

  const flush = () => {
    if (mode === "rich" && editor.current && richEdited.current) {
      const markdown = editor.current.getMarkdown();
      editPageDraft(page, { markdown });
      richEdited.current = false;
    }
    setEditorPending(false);
    persistPageDraft(page);
  };
  const save = async () => { flush(); await savePageDraft(page); };
  const switchMode = (next: Mode) => {
    flush();
    const current = pageDraft(page);
    if (next === "rich" && current && richMarkdownReason(current.markdown)) return;
    setMode(next);
  };
  useEffect(() => {
    onFlushReady(flush);
    const unload = () => flush();
    window.addEventListener("beforeunload", unload);
    return () => { window.removeEventListener("beforeunload", unload); };
  });
  useEffect(() => {
    if (draft.base.revision !== page.revision) onSaved(draft.base);
  }, [draft.base, page.revision, onSaved]);
  // Only a clean external body replacement rebuilds the rich editor; autosave echoes do not.
  const previousBody = useRef(draft.markdown);
  useEffect(() => {
    if (!draft.dirty && !editorPending && draft.markdown !== previousBody.current && editor.current && editor.current.getMarkdown() !== draft.markdown) {
      bodyGeneration.current++;
      setEditorGeneration(bodyGeneration.current);
      if (richMarkdownReason(draft.markdown)) setMode("source");
    }
    previousBody.current = draft.markdown;
  }, [draft.markdown, draft.dirty, editorPending]);
  useHotkey("doc.save", () => void save(), { enabled: active && !draft.base.trashed, page: true });

  const insert = (text: string) => {
    if (mode === "rich" && editor.current) editor.current.insertMarkdown(text);
    else {
      const current = pageDraft(page)?.markdown ?? draftRef.current.markdown;
      const from = source.current?.selectionStart ?? current.length;
      const to = source.current?.selectionEnd ?? from;
      editPageDraft(page, { markdown: `${current.slice(0, from)}${text}${current.slice(to)}` });
      source.current?.focus();
    }
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length || uploading !== null) return;
    setUploading(0); setActionError(null);
    try {
      for (const file of Array.from(files)) {
        const asset = await uploadPageAsset(page, file, setUploading);
        await refreshAssets();
        const label = asset.name.replace(/[\\[\]]/g, "\\$&");
        insert(`${asset.mimeType.startsWith("image/") ? "!" : ""}[${label}](${asset.url})\n\n`);
      }
    } catch (reason) { setActionError(String(reason)); }
    finally { setUploading(null); if (fileInput.current) fileInput.current.value = ""; }
  };
  const referenceInTask = async () => {
    await save();
    const current = pageDraft(page);
    if (current && !current.dirty && !current.conflict && !current.saving) referencePageInTask(current.base);
    else setActionError("Save or resolve this Page before referencing it in a task.");
  };

  const trash = async () => {
    await save();
    const current = pageDraft(page);
    if (!current || current.dirty || current.error) return;
    try {
      await invoke("set_page_trashed", { id: page.id, revision: current.base.revision, trashed: !current.base.trashed }, page.server);
      await refreshPageDraft(page);
      onTrashed();
    } catch (error) { setActionError(String(error)); }
  };
  const compare = async () => {
    flush();
    setConflictOpen(true);
    try { setRemote(await readPage(page)); }
    catch (error) { setActionError(String(error)); }
  };
  const resolve = async (choice: "saved" | "draft") => {
    await resolvePageDraft(page, choice, remote?.revision);
    if (choice === "saved") { bodyGeneration.current++; setEditorGeneration(bodyGeneration.current); }
    setConflictOpen(false);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(pageUrl({ id: page.id, server: page.server }));
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch { setActionError("The link could not be copied. Try again."); }
  };
  const status = draft.saving ? "Saving…" : draft.conflict ? "Draft kept" : isDirty ? "Unsaved changes" : "Saved";
  const projectOptions = [...new Map([
    ...draft.projectPaths.map((path) => ({ path, name: path.split("/").pop() || path })),
    ...projects.filter((project) => serverOfPath(project.path) === page.server),
  ].map((project) => [project.path, project])).values()];

  return <div className="spaces-document" data-wide={wide}>
    <div className="spaces-document-tools">
      <div className="spaces-document-crumb"><FileText aria-hidden="true" /><span>{draft.title || "Untitled"}</span></div>
      <DocumentTool label={draft.favorite ? "Remove from favorites" : "Add to favorites"} Icon={Star} selected={draft.favorite} disabled={draft.base.trashed} onClick={() => editPageDraft(page, { favorite: !draft.favorite })} />
      <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="Document options"><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent className="w-56">
        <DropdownMenuLabel>Document</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void copyLink()}><Link2 />Copy document link</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { flush(); setOutlineOpen(false); setHistoryOpen((v) => !v); }}><History />Version history</DropdownMenuItem>
        <DropdownMenuItem disabled={draft.base.trashed} onSelect={() => setLinkPickerOpen(true)}><Link2 />Link another Page</DropdownMenuItem>
        <DropdownMenuItem disabled={draft.base.trashed || uploading !== null} onSelect={() => fileInput.current?.click()}><Paperclip />Attach files…</DropdownMenuItem>
        <DropdownMenuItem disabled={draft.base.trashed} onSelect={() => void referenceInTask()}><MessageSquarePlus />Use in task</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={mode === "rich"} disabled={!!reason || draft.base.trashed} onCheckedChange={() => switchMode("rich")}>Edit document</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={mode === "source"} onCheckedChange={() => switchMode("source")}><Code2 />Markdown source</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={mode === "preview"} onCheckedChange={() => switchMode("preview")}><Eye />Preview</DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant={draft.base.trashed ? "default" : "destructive"} onSelect={() => void trash()}>{draft.base.trashed ? <Undo2 /> : <Trash2 />}{draft.base.trashed ? "Restore document" : "Move to trash"}</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>
      <div className="spaces-document-meta">
        <span role="status" className="spaces-document-status">{status}</span>
        {isDirty && <Button size="sm" variant="ghost" onClick={() => void save()} disabled={draft.saving || draft.conflict}>Save</Button>}
        <DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="ghost" aria-label="Document display options and metadata"><SlidersHorizontal /><span className="spaces-document-edited">Edited {new Date(draft.base.modified).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>Display options</DropdownMenuLabel>
          <DropdownMenuCheckboxItem checked={wide} onCheckedChange={setWide}>Full width</DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={formatting} disabled={mode !== "rich" || draft.base.trashed} onCheckedChange={setFormatting}><PanelTop />Formatting toolbar</DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Linked projects</DropdownMenuLabel>
          {projectOptions.map((p) => <DropdownMenuCheckboxItem key={p.path} checked={draft.projectPaths.includes(p.path)} disabled={draft.base.trashed} onSelect={(e) => e.preventDefault()} onCheckedChange={(checked) => editPageDraft(page, { projectPaths: checked ? [...draft.projectPaths, p.path] : draft.projectPaths.filter((path) => path !== p.path) })}><Folder />{p.name}</DropdownMenuCheckboxItem>)}
          {!projectOptions.length && <DropdownMenuItem disabled>No projects on this server</DropdownMenuItem>}
          <DropdownMenuSeparator /><DropdownMenuLabel>{serverName(page.server)} · Revision {draft.base.revision}</DropdownMenuLabel>
        </DropdownMenuContent></DropdownMenu>
        <DocumentTool label={copied ? "Link copied" : "Copy document link"} Icon={copied ? Check : Link2} onClick={() => void copyLink()} />
        <DocumentTool label={outlineOpen ? "Close outline" : "Open outline"} Icon={ListTree} selected={outlineOpen} disabled={mode === "source"} onClick={() => { setHistoryOpen(false); setOutlineOpen((v) => !v); }} />
      </div>
    </div>
    {(draft.error || actionError || assetError) && <div className="spaces-error" role="alert">{actionError || draft.error || assetError}<button onClick={() => draft.conflict ? void compare() : void save()}>{draft.conflict ? "Review changes" : "Retry"}</button></div>}
    <input ref={fileInput} type="file" multiple className="hidden" aria-label="Attach files to Page" onChange={(event) => void upload(event.target.files)} />
    {uploading !== null && <div className="px-[5.5%] py-2 text-xs text-muted-foreground" role="status">Uploading attachment… {Math.round(uploading * 100)}%</div>}
    <div className="spaces-document-body">
      <div ref={scroll} className="spaces-document-scroll"><article className="spaces-document-content">
        <div className="spaces-document-icon"><FileText aria-hidden="true" /></div>
        <textarea ref={title} rows={1} className="spaces-document-title" value={draft.title} onChange={(e) => editPageDraft(page, { title: e.target.value.replace(/\n/g, " ") })} placeholder="Untitled" aria-label="Page title" readOnly={draft.base.trashed} />
        {mode === "source" && reason && <p className="mb-5 text-xs text-muted-foreground">{reason}</p>}
        {mode === "preview" || draft.base.trashed ? <PagePreview markdown={draft.markdown || "*This Page is empty.*"} server={page.server} assets={assets} onOpenPage={openPage} /> : mode === "source" ?
          <textarea ref={source} className="spaces-source" value={draft.markdown} onChange={(e) => editPageDraft(page, { markdown: e.target.value })} aria-label="Page Markdown" placeholder="Start writing in Markdown…" spellCheck={false} /> :
          <Suspense fallback={<div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Opening editor…</div>}><RichPageEditor key={editorGeneration} ref={editor} showToolbar={formatting} markdown={draft.markdown} resolveImage={(src) => resolvePageImage(src, page.server, assets)} onAttach={() => fileInput.current?.click()} onOpenPage={(target) => openPage({ ...target, server: target.relative ? page.server : target.server })} onEdit={() => { richEdited.current = true; markPageDraftPending(page); setEditorPending(true); }} onChange={(markdown) => { editPageDraft(page, { markdown }); persistPageDraft(page); richEdited.current = false; setEditorPending(false); }} /></Suspense>}
        <LinearSyncPanel page={draft.base} dirty={isDirty} active={active} onPageUpdated={() => { void refreshPageDraft(page); }} />
        <PageBacklinks page={page} active={active} visibleProjects={visibleProjects} />
        <div className="mt-12 flex items-center gap-1 text-xs text-muted-foreground"><Check className="size-3" />Markdown document<span className="mx-2">·</span>Revision {draft.base.revision}</div>
      </article></div>
      <DocumentOutline containerRef={scroll} contentKey={page.server + ":" + page.id + ":" + mode} open={outlineOpen && mode !== "source"} onOpenChange={setOutlineOpen} />
      {historyOpen && <PageHistory page={draft.base} assets={assets} dirty={isDirty} onClose={() => setHistoryOpen(false)} onRestored={() => { void resolvePageDraft(page, "saved"); bodyGeneration.current++; setEditorGeneration(bodyGeneration.current); }} />}
    </div>
    <PageMentionPicker contextKey={`${page.server}:${page.id}`} open={linkPickerOpen} onOpenChange={setLinkPickerOpen} visibleProjects={visibleProjects} onSelect={(linked) => {
      const label = linked.title.replace(/[\\[\]]/g, "\\$&");
      insert(`[${label}](${pageUrl({ id: linked.id, server: linked.server, relative: linked.server === page.server })})`);
    }} />
    <Dialog open={conflictOpen} onOpenChange={setConflictOpen}><DialogContent className="max-w-4xl"><DialogHeader><DialogTitle>This Page changed elsewhere</DialogTitle><DialogDescription>Compare the saved document with your draft. Both versions remain available in history after you save.</DialogDescription></DialogHeader><div className="grid min-h-0 grid-cols-2 gap-4"><div><h3 className="mb-2 text-sm font-medium">Saved Page</h3><pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">{remote ? `${remote.title}\n\n${remote.markdown}` : "Loading…"}</pre></div><div><h3 className="mb-2 text-sm font-medium">Your draft</h3><pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">{draft.title}{"\n\n"}{draft.markdown}</pre></div></div><div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setConflictOpen(false)}>Keep editing</Button><Button variant="outline" disabled={!remote} onClick={() => void resolve("saved")}>Use saved version</Button><Button disabled={!remote} onClick={() => void resolve("draft")}>Save my version</Button></div></DialogContent></Dialog>
  </div>;
}

function DocumentTool({ label, Icon, selected, disabled, onClick }: { label: string; Icon: LucideIcon; selected?: boolean; disabled?: boolean; onClick: () => void }) {
  return <Tooltip><TooltipTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={label} aria-pressed={selected} disabled={disabled} onClick={onClick}><Icon className={cn(selected && "text-primary")} /></Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Check, Code2, Eye, FileText, Folder, History, Loader2, Link2, MessageSquarePlus, Paperclip, Plus, Star, Trash2, Undo2, X, type LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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

  return <div className="spaces-document">
    <div className="spaces-document-tools">
      <span role="status" className="text-xs text-muted-foreground">{serverName(page.server)}<span className="mx-2">·</span>{draft.saving ? "Saving…" : draft.conflict ? "Draft kept" : isDirty ? "Unsaved changes" : "Saved"}</span>
      <div className="ml-auto flex items-center gap-1">
        <DocumentTool label={draft.favorite ? "Remove from favorites" : "Add to favorites"} Icon={Star} selected={draft.favorite} disabled={draft.base.trashed} onClick={() => editPageDraft(page, { favorite: !draft.favorite })} />
        <Button size="sm" variant="ghost" aria-pressed={mode === "rich"} disabled={!!reason || draft.base.trashed} onClick={() => switchMode("rich")}>Edit</Button>
        <DocumentTool label="Markdown source" Icon={Code2} selected={mode === "source"} onClick={() => switchMode("source")} />
        <DocumentTool label="Preview Page" Icon={Eye} selected={mode === "preview"} onClick={() => switchMode("preview")} />
        <DocumentTool label="Version history" Icon={History} selected={historyOpen} onClick={() => { flush(); setHistoryOpen((v) => !v); }} />
        <DocumentTool label="Link another Page" Icon={Link2} disabled={draft.base.trashed} onClick={() => setLinkPickerOpen(true)} />
        <DocumentTool label="Attach a file" Icon={Paperclip} disabled={draft.base.trashed || uploading !== null} onClick={() => fileInput.current?.click()} />
        <Button size="sm" variant="ghost" onClick={() => void referenceInTask()}><MessageSquarePlus />Use in task</Button>
        {isDirty && <Button size="sm" onClick={() => void save()} disabled={draft.saving || draft.conflict}>Save</Button>}
        <Button size="sm" variant="ghost" onClick={() => void trash()}>{draft.base.trashed ? <Undo2 /> : <Trash2 />}{draft.base.trashed ? "Restore" : "Trash"}</Button>
      </div>
    </div>
    {(draft.error || actionError || assetError) && <div className="spaces-error" role="alert">{actionError || draft.error || assetError}<button onClick={() => draft.conflict ? void compare() : void save()}>{draft.conflict ? "Review changes" : "Retry"}</button></div>}
    <input ref={fileInput} type="file" multiple className="hidden" aria-label="Attach files to Page" onChange={(event) => void upload(event.target.files)} />
    {uploading !== null && <div className="px-[5.5%] py-2 text-xs text-muted-foreground" role="status">Uploading attachment… {Math.round(uploading * 100)}%</div>}
    <div className="flex min-h-0 flex-1">
      <div className="spaces-document-scroll"><article className="spaces-document-content">
        <FileText className="mb-5 size-9 text-muted-foreground/60" />
        <input className="spaces-document-title" value={draft.title} onChange={(e) => editPageDraft(page, { title: e.target.value })} placeholder="Untitled" aria-label="Page title" readOnly={draft.base.trashed} />
        <div className="mb-8 mt-4 flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">Projects</span>
          {draft.projectPaths.map((path) => <span key={path} className="spaces-project-chip"><Folder className="size-3" />{projects.find((p) => p.path === path)?.name ?? path.split("/").pop()}<button aria-label={`Unlink ${path}`} disabled={draft.base.trashed} onClick={() => editPageDraft(page, { projectPaths: draft.projectPaths.filter((p) => p !== path) })}><X className="size-3" /></button></span>)}
          <DropdownMenu><DropdownMenuTrigger asChild><button className="spaces-project-chip" disabled={draft.base.trashed}><Plus className="size-3" />Link project</button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuLabel>Linked projects</DropdownMenuLabel><DropdownMenuSeparator />{projects.filter((p) => serverOfPath(p.path) === page.server).map((p) => <DropdownMenuCheckboxItem key={p.path} checked={draft.projectPaths.includes(p.path)} onSelect={(e) => e.preventDefault()} onCheckedChange={(checked) => editPageDraft(page, { projectPaths: checked ? [...draft.projectPaths, p.path] : draft.projectPaths.filter((path) => path !== p.path) })}>{p.name}</DropdownMenuCheckboxItem>)}</DropdownMenuContent></DropdownMenu>
        </div>
        {mode === "source" && reason && <p className="mb-5 text-xs text-muted-foreground">{reason}</p>}
        {mode === "preview" || draft.base.trashed ? <PagePreview markdown={draft.markdown || "*This Page is empty.*"} server={page.server} assets={assets} onOpenPage={openPage} /> : mode === "source" ?
          <textarea ref={source} className="spaces-source" value={draft.markdown} onChange={(e) => editPageDraft(page, { markdown: e.target.value })} aria-label="Page Markdown" placeholder="Start writing in Markdown…" spellCheck={false} /> :
          <Suspense fallback={<div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Opening editor…</div>}><RichPageEditor key={editorGeneration} ref={editor} markdown={draft.markdown} resolveImage={(src) => resolvePageImage(src, page.server, assets)} onAttach={() => fileInput.current?.click()} onOpenPage={(target) => openPage({ ...target, server: target.relative ? page.server : target.server })} onEdit={() => { richEdited.current = true; markPageDraftPending(page); setEditorPending(true); }} onChange={(markdown) => { editPageDraft(page, { markdown }); persistPageDraft(page); richEdited.current = false; setEditorPending(false); }} /></Suspense>}
        <LinearSyncPanel page={draft.base} dirty={isDirty} active={active} onPageUpdated={() => { void refreshPageDraft(page); }} />
        <PageBacklinks page={page} active={active} visibleProjects={visibleProjects} />
        <div className="mt-12 flex items-center gap-1 text-xs text-muted-foreground"><Check className="size-3" />Markdown document<span className="mx-2">·</span>Revision {draft.base.revision}</div>
      </article></div>
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

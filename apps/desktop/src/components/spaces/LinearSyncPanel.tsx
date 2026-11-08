import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, ExternalLink, Link2, Loader2, RefreshCw, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { pageKey, type LocatedPage, type Page } from "@/lib/pages";
import { readLinearDocument, readLinearSync, syncLinearPage, unlinkLinearPage, type LinearDocument, type LinearResolution, type PageSyncState } from "@/lib/linearPages";
import { openLink } from "@/lib/openLink";
import { relativeTime } from "@/lib/format";

const STATUS = { synced: "Synced", local_changes: "Changes to sync", conflict: "Review changes", missing: "Source unavailable", error: "Sync needs attention", unlinked: "Unlinked" } as const;

/// Sync responses stay tied to their Page, and pulls wait until the editor has saved its draft.
export default function LinearSyncPanel({ page, dirty, active, onPageUpdated }: {
  page: LocatedPage<Page>;
  dirty: boolean;
  active: boolean;
  onPageUpdated: () => void;
}) {
  const [state, setState] = useState<PageSyncState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [comparison, setComparison] = useState<PageSyncState | null>(null);
  const [remote, setRemote] = useState<LinearDocument | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const identity = pageKey(page);
  const generation = useRef(0);
  const comparisonGeneration = useRef(0);
  const flight = useRef<object | null>(null);
  const latestState = useRef<PageSyncState | null>(null);
  const refreshPending = useRef(false);
  const current = useRef({ page, dirty, active, onPageUpdated });
  current.current = { page, dirty, active, onPageUpdated };

  const openComparison = async (snapshot: PageSyncState) => {
    if (!snapshot.conflict) return;
    const request = ++comparisonGeneration.current;
    const document = snapshot.conflict.remote;
    const requestedPage = current.current.page;
    setComparison(snapshot);
    setRemote(null);
    setRemoteError(null);
    setRemoteLoading(true);
    try {
      const result = await readLinearDocument(requestedPage.server, document.id);
      if (comparisonGeneration.current !== request || pageKey(current.current.page) !== pageKey(requestedPage)) return;
      setRemote(result);
      if (result.updatedAt !== document.updatedAt) setRemoteError("This document changed again in Linear. Refresh the comparison before choosing a version.");
    } catch (reason) {
      if (comparisonGeneration.current === request) setRemoteError(String(reason));
    } finally {
      if (comparisonGeneration.current === request) setRemoteLoading(false);
    }
  };

  const perform = async (operation: "read" | "sync" | "unlink", choice?: LinearResolution, refreshComparison = false): Promise<PageSyncState | null> => {
    const now = current.current;
    if (flight.current || !now.active || (operation !== "read" && now.dirty) || (operation === "sync" && now.page.trashed)) return null;
    const ticket = {};
    const request = generation.current;
    const requestedPage = now.page;
    const snapshot = comparison;
    if (choice && (!snapshot?.conflict || !remote || remote.updatedAt !== snapshot.conflict.remote.updatedAt || snapshot.page.revision !== snapshot.conflict.localRevision || now.page.revision !== snapshot.page.revision)) return null;
    flight.current = ticket;
    setBusy(true);
    setError(null);
    try {
      const result = operation === "read" ? await readLinearSync(requestedPage) : operation === "unlink" ? await unlinkLinearPage(requestedPage) : await syncLinearPage(requestedPage, choice && snapshot?.conflict ? {
        resolution: choice, localRevision: snapshot.conflict.localRevision, remoteUpdatedAt: snapshot.conflict.remote.updatedAt,
      } : undefined);
      if (generation.current !== request || pageKey(current.current.page) !== pageKey(requestedPage)) return null;
      latestState.current = result;
      setState(result);
      if (result.page.revision !== current.current.page.revision) {
        if (current.current.dirty) refreshPending.current = true;
        else current.current.onPageUpdated();
      }
      if (choice || refreshComparison) {
        if (result.conflict) void openComparison(result);
        else { comparisonGeneration.current++; setComparison(null); }
      }
      if (operation === "unlink") { setUnlinkOpen(false); setComparison(null); }
      return result;
    } catch (reason) {
      if (generation.current === request) setError(String(reason));
      return null;
    } finally {
      if (flight.current === ticket) { flight.current = null; if (generation.current === request) setBusy(false); }
    }
  };
  const performRef = useRef(perform);
  performRef.current = perform;

  useEffect(() => {
    const request = ++generation.current;
    latestState.current = null;
    setState(null);
    setError(null);
    setBusy(false);
    setComparison(null);
    comparisonGeneration.current++;
    setUnlinkOpen(false);
    refreshPending.current = false;
    flight.current = null;
    if (active) void performRef.current("read").then((result) => {
      if (generation.current === request && result?.link && !result.conflict && !current.current.dirty && !current.current.page.trashed) void performRef.current("sync");
    });
    return () => { generation.current++; comparisonGeneration.current++; flight.current = null; };
  }, [identity, active]);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      const saved = latestState.current;
      if (!document.hidden && saved?.link && !saved.conflict && saved.status !== "error" && saved.status !== "missing") void performRef.current("sync");
    }, 30_000);
    return () => clearInterval(timer);
  }, [identity, active]);

  useEffect(() => {
    if (!active || dirty || busy || error) return;
    if (refreshPending.current) { refreshPending.current = false; onPageUpdated(); return; }
    const saved = latestState.current;
    if (saved?.link && page.revision > saved.page.revision) void performRef.current(saved.conflict ? "read" : "sync");
  }, [identity, active, dirty, busy, error, page.revision, onPageUpdated]);

  if (!state?.link) return error && active ? <div role="alert" className="flex items-center gap-3 border-b border-border px-[5.5%] py-2.5 text-xs text-destructive"><AlertCircle className="size-3.5 shrink-0" /><p className="min-w-0 flex-1">{error}</p><Button size="sm" variant="ghost" disabled={busy} onClick={() => void perform("read").then((result) => { if (result?.link && !result.conflict) void performRef.current("sync"); })}>Retry sync status</Button></div> : null;
  const problem = error || state.error;
  const conflict = comparison?.conflict;
  const blocked = busy || dirty;
  const syncBlocked = blocked || page.trashed;
  const comparisonChanged = !!comparison && (page.revision !== comparison.page.revision || comparison.page.revision !== comparison.conflict?.localRevision);
  const status = page.trashed ? "Sync paused in Trash" : dirty ? "Waiting for your Page to save" : busy ? "Syncing…" : STATUS[state.status];

  return <div className="flex flex-col gap-2 border-b border-border px-[5.5%] py-2.5">
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Link2 className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
      <button className="inline-flex min-w-0 items-center gap-1.5 font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring" onClick={(event) => openLink(state.link!.url, event)} aria-label="Open original Linear document">Linear<ExternalLink className="size-3" /></button>
      <span className="text-muted-foreground" aria-hidden="true">·</span>
      <span role="status" className="inline-flex items-center gap-1.5 text-muted-foreground">{busy ? <Loader2 className="size-3 animate-spin" /> : state.status === "synced" && !dirty ? <Check className="size-3" /> : problem || state.conflict ? <AlertCircle className="size-3" /> : null}{status}</span>
      {state.link.lastSyncedAt && <Tooltip><TooltipTrigger asChild><span tabIndex={0} className="text-muted-foreground">{relativeTime(state.link.lastSyncedAt)}</span></TooltipTrigger><TooltipContent>Last synced {new Date(state.link.lastSyncedAt).toLocaleString()}</TooltipContent></Tooltip>}
      <div className="ml-auto flex items-center gap-1">
        {state.conflict ? <Button size="sm" variant="outline" disabled={syncBlocked} onClick={() => void openComparison(state)}>Review changes</Button> : <Button size="sm" variant="ghost" disabled={syncBlocked} onClick={() => void perform("sync")}><RefreshCw />{state.status === "error" ? "Refresh sync" : "Sync"}</Button>}
        <Tooltip><TooltipTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="Unlink Linear document" disabled={blocked} onClick={() => setUnlinkOpen(true)}><Unlink /></Button></TooltipTrigger><TooltipContent>Unlink Linear document</TooltipContent></Tooltip>
      </div>
    </div>
    {problem && <p role="alert" className="text-xs text-destructive">{problem}</p>}
    {/carbon-(?:page|asset):/.test(page.markdown) && <p className="text-xs text-muted-foreground">Page links and attachments stay in Carbon.</p>}
    <Dialog open={!!comparison} onOpenChange={(open) => { if (!open && !busy) { comparisonGeneration.current++; setComparison(null); } }}>
      <DialogContent className="max-w-4xl" dismissible={!busy}>
        <DialogHeader><DialogTitle>This document changed in both apps</DialogTitle><DialogDescription>Review both versions before choosing one. The Page’s previous versions remain in Carbon’s history.</DialogDescription></DialogHeader>
        {comparison && conflict && <>
          <div className="grid min-h-0 gap-4 sm:grid-cols-2">
            <div className="min-w-0"><h3 className="mb-2 text-sm font-medium">Carbon · revision {comparison.page.revision}</h3><pre className="max-h-72 overflow-auto whitespace-pre-wrap wrap-anywhere rounded-lg bg-muted p-3 text-xs leading-relaxed">{comparison.page.title}{"\n\n"}{comparison.page.markdown}</pre></div>
            <div className="min-w-0"><h3 className="mb-2 flex items-center gap-2 text-sm font-medium">Linear{remoteLoading && <Loader2 className="size-3 animate-spin" aria-label="Loading full Linear document" />}</h3><pre className="max-h-72 overflow-auto whitespace-pre-wrap wrap-anywhere rounded-lg bg-muted p-3 text-xs leading-relaxed">{remote?.title ?? conflict.remote.title}{"\n\n"}{remote?.markdown ?? conflict.remotePreview}</pre>{!remote && conflict.remoteBytes > new TextEncoder().encode(conflict.remotePreview).byteLength && <p className="mt-1 text-xs text-muted-foreground">Showing a preview while the full document loads.</p>}</div>
          </div>
          {problem && <p role="alert" className="text-xs text-destructive">{problem}</p>}
          {remoteError && <p role="alert" className="text-xs text-destructive">{remoteError}</p>}
          {comparisonChanged && <p role="alert" className="text-xs text-muted-foreground">This Page changed since the comparison was prepared. Refresh it before choosing a version.</p>}
          {dirty && <p className="text-xs text-muted-foreground">Save or resolve your local draft before choosing a synced version.</p>}
          <div className="flex flex-wrap justify-end gap-2"><Button size="sm" variant="ghost" disabled={busy} onClick={() => { comparisonGeneration.current++; setComparison(null); }}>Keep both for now</Button><Button size="sm" variant="outline" disabled={syncBlocked} onClick={() => void perform("sync", undefined, true)}>Refresh comparison</Button><Button size="sm" variant="outline" disabled={syncBlocked || comparisonChanged || remoteLoading || !!remoteError || !remote} onClick={() => void perform("sync", "linear")}>Use Linear version</Button><Button size="sm" disabled={syncBlocked || comparisonChanged || remoteLoading || !!remoteError || !remote} onClick={() => void perform("sync", "carbon")}>Use Carbon version</Button></div>
        </>}
      </DialogContent>
    </Dialog>
    <Dialog open={unlinkOpen} onOpenChange={(open) => { if (!busy) setUnlinkOpen(open); }}><DialogContent dismissible={!busy}><DialogHeader><DialogTitle>Unlink this Linear document?</DialogTitle><DialogDescription>Your Page and its history stay in Carbon. The original document stays in Linear. Future changes will no longer sync.</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button size="sm" variant="ghost" disabled={busy} onClick={() => setUnlinkOpen(false)}>Cancel</Button><Button size="sm" disabled={blocked} onClick={() => void perform("unlink")}>Unlink document</Button></div></DialogContent></Dialog>
  </div>;
}

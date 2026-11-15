import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { forgetIssues } from "@/hooks/useIssues";
import { openIssue } from "@/lib/issue";
import { adoptIssueProposal, editIssueReview, flushIssueReview, readIssueReview, refreshIssueReview, rememberIssueReview, type IssueCreationOptions, type IssueProposal, type IssueReview as Review } from "@/lib/issueDraft";
import { invoke, serverOfSession } from "@/lib/transport";

const field = "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-ui text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50";

export default function IssueReview({ sessionId, proposal, review, error: saveError, saving, busy }: {
  sessionId: string;
  proposal: IssueProposal;
  review: Review;
  error: string | null;
  saving: boolean;
  busy: boolean;
}) {
  const [options, setOptions] = useState<IssueCreationOptions | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryOpen, setRetryOpen] = useState(false);
  const inFlight = useRef(false);
  const draft = review.draft;
  const locked = busy || creating || !!review.submitted;
  const edit = (patch: Partial<Review["draft"]>) => editIssueReview(sessionId, { ...draft, ...patch });

  useEffect(() => {
    if (draft.sourceKey !== proposal.sourceKey && !review.submitted && !review.created) {
      const next = adoptIssueProposal(draft, proposal);
      if (next !== draft) editIssueReview(sessionId, next);
    }
  }, [sessionId, proposal.sourceKey, draft.sourceKey, review.submitted, review.created]);

  useEffect(() => {
    if (review.created) return;
    let live = true;
    setOptions(null);
    setOptionsError(null);
    invoke<IssueCreationOptions>("issue_creation_options", { tracker: draft.tracker }, serverOfSession(sessionId)).then((next) => {
      if (live) setOptions(next);
    }).catch((e) => { if (live) setOptionsError(String(e)); });
    return () => { live = false; };
  }, [sessionId, draft.tracker, generation, review.created]);

  useEffect(() => {
    if (!options || review.submitted || review.created) return;
    const project = options.projects.find((p) => p.id === draft.projectId);
    const destination = options.destinations.some((d) => d.id === draft.destination) ? draft.destination
      : project?.teamIds.length === 1 ? project.teamIds[0]
      : options.destinations.length === 1 ? options.destinations[0].id : "";
    const projectId = project?.teamIds.includes(destination) ? project.id : null;
    if (destination !== draft.destination || projectId !== draft.projectId) editIssueReview(sessionId, { ...draft, destination, projectId });
  }, [options, sessionId, draft, review.submitted, review.created]);

  const create = async () => {
    if (inFlight.current || busy) return;
    inFlight.current = true;
    setCreating(true);
    setError(null);
    try {
      await flushIssueReview(sessionId);
      const expectedRevision = readIssueReview(sessionId)?.revision ?? 0;
      const next = await invoke<Review>("create_conversation_issue", { sessionId, expectedRevision }, serverOfSession(sessionId));
      rememberIssueReview(sessionId, next);
      forgetIssues();
    } catch (e) {
      const failure = e && typeof e === "object" ? e as { message?: string } : null;
      setError(failure?.message ?? String(e));
      void refreshIssueReview(sessionId);
    } finally { inFlight.current = false; setCreating(false); }
  };
  const reopen = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await invoke<Review>("reopen_issue_review", { sessionId }, serverOfSession(sessionId));
      rememberIssueReview(sessionId, next);
      setRetryOpen(false);
      setError(null);
    } catch (e) { setError(String(e)); }
    finally { inFlight.current = false; }
  };
  const projects = options?.projects.filter((p) => p.teamIds.includes(draft.destination)) ?? [];

  if (review.created) return (
    <div className="flex items-start gap-3 rounded-xl bg-card p-4 shadow-(--shadow-card)">
      <Check className="mt-0.5 size-4 shrink-0 text-accent-add" />
      <div className="min-w-0 flex-1"><p className="text-ui font-medium">Issue created</p>
        <button type="button" onClick={() => openIssue(review.created!)} className="mt-1 flex max-w-full items-center gap-1.5 text-sm text-accent-issue hover:underline">
          <span className="truncate">{review.created.identifier} {review.created.title}</span><ExternalLink className="size-3 shrink-0" />
        </button>
        {!review.linked && <div className="mt-3 flex flex-col items-start gap-2">
          <p className="text-ui text-muted-foreground">The issue is created. Retry to finish linking it to this conversation.</p>
          {(error || saveError) && <p role="alert" className="text-ui text-destructive">{error || saveError}</p>}
          <Button size="sm" disabled={creating || busy} onClick={() => void create()}>{creating ? "Linking…" : "Retry session link"}</Button>
        </div>}
      </div>
    </div>
  );

  return (
    <section aria-label="Review issue" className="flex min-w-0 flex-col gap-4 rounded-xl bg-card p-4 shadow-(--shadow-card)">
      <div><h2 className="text-sm font-medium">Review issue</h2><p className="mt-1 text-ui text-muted-foreground">Edit the draft here or ask for changes in chat.</p></div>
      <div className="flex flex-wrap gap-3">
        <label className="flex min-w-32 flex-1 flex-col gap-1.5 text-ui text-muted-foreground">Tracker
          <select aria-label="Issue tracker" className={field} disabled={locked} value={draft.tracker} onChange={(e) => edit({ tracker: e.target.value as Review["draft"]["tracker"], destination: "", projectId: null })}>
            <option value="linear">Linear</option><option value="github">GitHub</option>
          </select>
        </label>
        <label className="flex min-w-40 flex-[2] flex-col gap-1.5 text-ui text-muted-foreground">{draft.tracker === "linear" ? "Team" : "Repository"}
          <select aria-label="Issue destination" className={field} disabled={locked || !options} value={draft.destination} onChange={(e) => edit({ destination: e.target.value, projectId: null })}>
            <option value="">{options ? "Choose…" : "Loading…"}</option>{options?.destinations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      </div>
      {draft.tracker === "linear" && projects.length > 0 && <label className="flex flex-col gap-1.5 text-ui text-muted-foreground">Project
        <select aria-label="Issue project" className={field} disabled={locked} value={draft.projectId ?? ""} onChange={(e) => edit({ projectId: e.target.value || null })}>
          <option value="">No project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>}
      {optionsError && <div role="alert" className="text-ui text-destructive"><p>{optionsError}</p><p>Connect this tracker on the Issues page.</p><Button variant="ghost" size="sm" onClick={() => setGeneration((n) => n + 1)}>Retry destinations</Button></div>}
      {options && !options.destinations.length && <p className="text-ui text-muted-foreground">{draft.tracker === "github" ? "Attach a project with a GitHub remote to choose its repository." : "No teams are available for this Linear connection."}</p>}
      <label className="flex flex-col gap-1.5 text-ui text-muted-foreground">Title
        <Input aria-label="Issue title" maxLength={256} disabled={locked} value={draft.title} onChange={(e) => edit({ title: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1.5 text-ui text-muted-foreground">Description
        <textarea aria-label="Issue description" maxLength={60_000} disabled={locked} rows={8} className={`${field} min-h-40 resize-y`} value={draft.description} onChange={(e) => edit({ description: e.target.value })} />
      </label>
      {(error || saveError) && <div role="alert" className="text-ui text-destructive">{error || saveError}</div>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-ui text-muted-foreground">{review.submitted ? "Check the original creation without sending another issue." : saving ? "Saving draft…" : `Creates in ${draft.tracker === "linear" ? "Linear" : "GitHub"} when you confirm.`}</p>
        <div className="flex gap-2">
          {review.submitted && <Button variant="ghost" size="sm" disabled={creating} onClick={() => setRetryOpen(true)}>Keep editing</Button>}
          <Button disabled={busy || creating || !draft.title.trim() || !draft.destination || (!review.submitted && (!options || !!optionsError))} onClick={() => void create()}>
            {creating && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}{creating ? "Creating…" : review.submitted ? "Check creation" : "Create issue"}
          </Button>
        </div>
      </div>
      <Dialog open={retryOpen} onOpenChange={setRetryOpen}><DialogContent><DialogHeader><DialogTitle>Check the tracker first</DialogTitle>
        <DialogDescription>The tracker may have created the issue even though Carbon did not receive its reply. If you have checked the tracker and the issue is missing, you can keep editing and submit it again.</DialogDescription></DialogHeader>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setRetryOpen(false)}>Go back</Button><Button onClick={() => void reopen()}>I checked, keep editing</Button></div>
      </DialogContent></Dialog>
    </section>
  );
}

import { useEffect, useSyncExternalStore } from "react";

import { readLocalStorage, writeLocalStorage } from "@/hooks/useLocalStorage";
import { channel } from "@/lib/channel";
import { invoke, listen, serverOfSession } from "@/lib/transport";
import type { IssueRef, IssueTracker } from "@/types/events";

export type CreateIssueInput = { requestId: string; tracker: IssueTracker; destination: string; projectId: string | null; title: string; description: string };
export type IssueDestination = { id: string; name: string; teamIds: string[] };
export type IssueCreationOptions = { destinations: IssueDestination[]; projects: IssueDestination[] };
export type IssueDraftContext = { tracker: IssueTracker; destination: string; projectId: string | null };
export type IssueProposal = { sourceKey: string; title: string; description: string };
export type IssueReviewInput = IssueProposal & IssueDraftContext;
export type IssueReview = { requestId: string; draft: IssueReviewInput; submitted: CreateIssueInput | null; created: IssueRef | null; linked?: boolean; revision?: number };
type ReviewState = { value: IssueReview | null; error: string | null; saving: boolean; loaded: boolean };

const EMPTY: ReviewState = { value: null, error: null, saving: false, loaded: false };
const reviews = new Map<string, ReviewState>();
const changed = channel<void>();
const generations = new Map<string, number>();
const queued = new Map<string, Promise<void>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const dirty = new Set<string>();
const TARGETS = "ade.issueConversationTargets";
const targets = readLocalStorage<Record<string, IssueDraftContext>>(TARGETS, {});

export function beginIssueConversation(sessionId: string, context: IssueDraftContext): void {
  targets[sessionId] = context;
  writeLocalStorage(TARGETS, targets);
  changed.emit();
}

export function pendingIssueConversation(sessionId: string): IssueDraftContext | null {
  return targets[sessionId] ?? null;
}

export function hasPendingIssueReview(sessionId: string): boolean {
  return !!targets[sessionId] || dirty.has(sessionId) || queued.has(sessionId);
}

export function cancelPendingIssueConversation(sessionId: string): void {
  if (!targets[sessionId]) return;
  delete targets[sessionId];
  writeLocalStorage(TARGETS, targets);
  changed.emit();
}

export function usePendingIssueConversation(sessionId: string): IssueDraftContext | null {
  return useSyncExternalStore(changed.subscribe, () => pendingIssueConversation(sessionId));
}

export function issueProposal(title: string, description: string, seq?: number): IssueProposal {
  let hash = 0xcbf29ce484222325n;
  for (const char of JSON.stringify([title, description])) hash = BigInt.asUintN(64, (hash ^ BigInt(char.codePointAt(0)!)) * 0x100000001b3n);
  return { title, description, sourceKey: `${seq === undefined ? "" : `${seq}:`}${hash.toString(16)}` };
}

/// Only the dedicated fence is interpreted; ordinary JSON and code examples remain Markdown.
export function splitIssueProposal(text: string, streaming = false, seq?: number): { text: string; proposal: IssueProposal | null } {
  let proposal: IssueProposal | null = null;
  const cleaned = text.replace(/^```carbon-issue[\t ]*\r?\n([\s\S]*?)^```[\t ]*$/gm, (block, json: string) => {
    try {
      const value = JSON.parse(json);
      if (typeof value.title !== "string" || !value.title.trim() || value.title.length > 256 || typeof value.description !== "string" || value.description.length > 60_000) return block;
      proposal = issueProposal(value.title, value.description, seq);
      return "";
    } catch { return block; }
  });
  return { text: (streaming ? cleaned.replace(/^```carbon-issue[\t ]*\r?\n[\s\S]*$/m, "") : cleaned).trim(), proposal };
}

/// An older transcript tail must not replace a newer draft recovered from the server.
export function adoptIssueProposal(draft: IssueReviewInput, proposal: IssueProposal): IssueReviewInput {
  if (draft.sourceKey === proposal.sourceKey) return draft;
  const order = (key: string) => /^(\d+):/.exec(key)?.[1];
  const before = order(draft.sourceKey);
  const next = order(proposal.sourceKey);
  if (before && (!next || Number(next) <= Number(before))) return draft;
  if (!before && proposal.sourceKey.endsWith(`:${draft.sourceKey}`) && draft.sourceKey) return { ...draft, sourceKey: proposal.sourceKey };
  return { ...draft, ...proposal };
}

function put(sessionId: string, state: ReviewState) {
  reviews.set(sessionId, state);
  changed.emit();
}

export function rememberIssueReview(sessionId: string, value: IssueReview): void {
  generations.set(sessionId, (generations.get(sessionId) ?? 0) + 1);
  put(sessionId, { value, error: null, saving: false, loaded: true });
}

export function readIssueReview(sessionId: string): IssueReview | null {
  return reviews.get(sessionId)?.value ?? null;
}

let listening = false;
function startListening() {
  if (listening) return;
  listening = true;
  void listen<{ sessionId: string; review: IssueReview }>("issue_review_changed", ({ payload }) => {
    if (!dirty.has(payload.sessionId) && !queued.has(payload.sessionId)) rememberIssueReview(payload.sessionId, payload.review);
  }).catch(() => { listening = false; });
  void listen("live_state", ({ server }) => {
    for (const sessionId of reviews.keys()) {
      if (serverOfSession(sessionId) === server) void refreshIssueReview(sessionId);
    }
  }).catch(() => { listening = false; });
}

export async function refreshIssueReview(sessionId: string): Promise<void> {
  const pending = dirty.has(sessionId) || queued.has(sessionId);
  const generation = generations.get(sessionId) ?? 0;
  try {
    const value = await invoke<IssueReview | null>("get_issue_review", { sessionId }, serverOfSession(sessionId));
    if ((generations.get(sessionId) ?? 0) !== generation) return;
    if (value?.submitted || value?.created) {
      dirty.delete(sessionId);
      clearTimeout(timers.get(sessionId));
      rememberIssueReview(sessionId, value);
    } else if (!pending && !dirty.has(sessionId) && !queued.has(sessionId)) {
      put(sessionId, { value, error: null, saving: false, loaded: true });
    }
  } catch (e) {
    if ((generations.get(sessionId) ?? 0) === generation) put(sessionId, { ...(reviews.get(sessionId) ?? EMPTY), error: String(e), loaded: true });
  }
}

export function useIssueReview(sessionId: string | null, active: boolean): ReviewState {
  const state = useSyncExternalStore(changed.subscribe, () => sessionId ? reviews.get(sessionId) ?? EMPTY : EMPTY);
  useEffect(() => {
    startListening();
    if (sessionId && active) void refreshIssueReview(sessionId);
  }, [sessionId, active]);
  return state;
}

export function editIssueReview(sessionId: string, draft: IssueReviewInput): void {
  const state = reviews.get(sessionId);
  if (!state?.value || state.value.submitted || state.value.created) return;
  generations.set(sessionId, (generations.get(sessionId) ?? 0) + 1);
  dirty.add(sessionId);
  put(sessionId, { ...state, value: { ...state.value, draft }, error: null, saving: true });
  clearTimeout(timers.get(sessionId));
  timers.set(sessionId, setTimeout(() => { void flushIssueReview(sessionId).catch(() => {}); }, 300));
}

/// Serializes edits and flushes them before sending a follow-up or confirming creation.
export async function flushIssueReview(sessionId: string): Promise<void> {
  clearTimeout(timers.get(sessionId));
  timers.delete(sessionId);
  while (queued.has(sessionId)) await queued.get(sessionId);
  if (!dirty.has(sessionId)) return;
  const state = reviews.get(sessionId);
  if (!state?.value) return;
  const generation = generations.get(sessionId);
  const operation = (async () => {
    try {
      const value = await invoke<IssueReview>("save_issue_review", { sessionId, draft: state.value!.draft, expectedRevision: state.value!.revision ?? 0 }, serverOfSession(sessionId));
      if (generations.get(sessionId) === generation) {
        dirty.delete(sessionId);
        put(sessionId, { value, error: null, saving: false, loaded: true });
      } else {
        const latest = reviews.get(sessionId);
        if (latest?.value?.requestId === value.requestId && (latest.value.revision ?? 0) <= (value.revision ?? 0)) {
          put(sessionId, { ...latest, value: { ...latest.value, revision: value.revision } });
        }
      }
    } catch (e) {
      if (String(e).startsWith("Issue review changed elsewhere.")) {
        dirty.delete(sessionId);
        clearTimeout(timers.get(sessionId));
        const latest = await invoke<IssueReview | null>("get_issue_review", { sessionId }, serverOfSession(sessionId)).catch(() => null);
        if (latest) rememberIssueReview(sessionId, latest);
      }
      put(sessionId, { ...(reviews.get(sessionId) ?? state), error: String(e), saving: false });
      throw e;
    }
  })();
  queued.set(sessionId, operation);
  try { await operation; }
  finally { if (queued.get(sessionId) === operation) queued.delete(sessionId); }
  if (dirty.has(sessionId)) await flushIssueReview(sessionId);
}

export async function prepareIssueConversation(sessionId: string): Promise<void> {
  const context = pendingIssueConversation(sessionId);
  if (!context) return;
  const value = await invoke<IssueReview>("prepare_issue_conversation", { sessionId, context }, serverOfSession(sessionId));
  rememberIssueReview(sessionId, value);
  delete targets[sessionId];
  writeLocalStorage(TARGETS, targets);
  changed.emit();
}

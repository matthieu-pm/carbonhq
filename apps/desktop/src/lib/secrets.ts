import { useEffect, useSyncExternalStore } from "react";
import { channel } from "@/lib/channel";
import { invoke, listen, noteSession, serverOfSession } from "@/lib/transport";

export type SecretTarget =
  | { kind: "command"; command: string[] }
  | { kind: "file"; path: string; command: string[] }
  | { kind: "browser"; origin: string; fields: { name: string; selector: string }[]; submit: string };

export type SecretHandoff = {
  id: string;
  sessionId: string;
  agent: string;
  purpose: string;
  fields: { name: string; label: string }[];
  target: SecretTarget;
  cwd: string;
  expiresAt: number;
  state: "pending" | "running" | "used" | "failed" | "denied" | "cancelled" | "expired";
  message: string | null;
  keepFile: boolean;
  keepBlocked: string | null;
  submitLabel: string | null;
  clientError?: string;
};

const bySession = new Map<string, SecretHandoff[]>();
const revisions = new Map<string, number>();
const empty: SecretHandoff[] = [];
let pending = new Set<string>();
let started: Promise<unknown> | undefined;
const { emit, subscribe } = channel<void>();

function replace(sessionId: string, requests: SecretHandoff[]) {
  bySession.set(sessionId, requests);
  revisions.set(sessionId, (revisions.get(sessionId) ?? 0) + 1);
  pending = new Set([...bySession].filter(([, rows]) => rows.some((r) => r.state === "pending")).map(([id]) => id));
  emit();
}

function start() {
  return started ??= Promise.all([
    listen<{ sessionId: string; requests: SecretHandoff[] }>("secret_requests_changed", ({ payload, server }) => {
      noteSession(payload.sessionId, server);
      replace(payload.sessionId, payload.requests);
    }),
    listen<{ secrets?: SecretHandoff[] }>("live_state", ({ payload, server }) => {
      for (const sessionId of bySession.keys()) {
        if (serverOfSession(sessionId) === server) replace(sessionId, []);
      }
      const rows = new Map<string, SecretHandoff[]>();
      for (const request of payload.secrets ?? []) {
        noteSession(request.sessionId, server);
        rows.set(request.sessionId, [...(rows.get(request.sessionId) ?? []), request]);
      }
      for (const [sessionId, requests] of rows) replace(sessionId, requests.sort((a, b) => a.expiresAt - b.expiresAt));
    }),
  ]);
}

export function usePendingSecretSessions() {
  useEffect(() => { void start(); }, []);
  return useSyncExternalStore(subscribe, () => pending);
}

/// Metadata can survive navigation; entered values belong only to the card's live form.
export function useSecretRequests(sessionId: string | undefined) {
  useEffect(() => {
    if (!sessionId) return;
    let disposed = false;
    void start().then(async () => {
      const revision = revisions.get(sessionId);
      const requests = await invoke<SecretHandoff[]>("list_secret_requests", { sessionId }).catch(() => null);
      if (!disposed && requests && revisions.get(sessionId) === revision) replace(sessionId, requests);
    });
    return () => { disposed = true; };
  }, [sessionId]);
  return useSyncExternalStore(subscribe, () => sessionId ? bySession.get(sessionId) ?? empty : empty);
}

export async function submitSecret(request: SecretHandoff, values: Record<string, string>, keepFile: boolean) {
  try {
    await invoke("answer_secret_request", { sessionId: request.sessionId, id: request.id, values, keepFile });
  } catch {
    await reconcile(request, "Could not confirm the hand-off. Check its status before requesting another; it may already have run.");
  } finally {
    for (const key of Object.keys(values)) delete values[key];
  }
}

export async function denySecret(request: SecretHandoff) {
  try {
    await invoke("deny_secret_request", { sessionId: request.sessionId, id: request.id });
  } catch {
    await reconcile(request, "Could not confirm cancellation. Check its status; this request will expire.");
  }
}

/// A missing acknowledgement cannot overrule an event or a newer reconnect snapshot.
async function reconcile(request: SecretHandoff, message: string) {
  const current = () => bySession.get(request.sessionId)?.find((row) => row.id === request.id);
  if (current()?.state !== "pending") return;
  const revision = revisions.get(request.sessionId);
  const requests = await invoke<SecretHandoff[]>("list_secret_requests", { sessionId: request.sessionId }).catch(() => null);
  if (requests && revisions.get(request.sessionId) === revision) replace(request.sessionId, requests);
  if (current()?.state !== "pending") return;
  replace(request.sessionId, (bySession.get(request.sessionId) ?? []).map((row) => row.id === request.id
    ? { ...row, clientError: message } : row));
}

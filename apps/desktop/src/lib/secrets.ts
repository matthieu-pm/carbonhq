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
    await invoke("deny_secret_request", { sessionId: request.sessionId, id: request.id }).catch(() => {});
    replace(request.sessionId, (bySession.get(request.sessionId) ?? []).map((row) => row.id === request.id
      ? { ...row, state: "failed", message: "The hand-off could not be confirmed. Ask for a new request; it may already have run." } : row));
  } finally {
    for (const key of Object.keys(values)) delete values[key];
  }
}

export async function denySecret(request: SecretHandoff) {
  await invoke("deny_secret_request", { sessionId: request.sessionId, id: request.id }).catch(() => {
    replace(request.sessionId, (bySession.get(request.sessionId) ?? []).map((row) => row.id === request.id
      ? { ...row, state: "failed", message: "Could not confirm cancellation. This request will expire." } : row));
  });
}

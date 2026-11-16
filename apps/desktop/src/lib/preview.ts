import { useEffect, useSyncExternalStore } from "react";
import { channel } from "@/lib/channel";
import { invoke, listen, LOCAL, noteSession, serverOfSession } from "@/lib/transport";
import type { PreviewConfig, PreviewSetup, PreviewState } from "@/types/events";

export type { PreviewConfig, PreviewSetup, PreviewState };

const previews = new Map<string, PreviewState>();
const revisions = new Map<string, number>();
const { emit, subscribe } = channel<void>();
let listening: Promise<unknown> | undefined;

function replace(sessionId: string, state: PreviewState | null) {
  if (state) previews.set(sessionId, state);
  else previews.delete(sessionId);
  revisions.set(sessionId, (revisions.get(sessionId) ?? 0) + 1);
  emit();
}

function startListening() {
  return listening ??= Promise.all([
    listen<PreviewState>("preview_changed", ({ payload, server }) => {
      noteSession(payload.sessionId, server);
      replace(payload.sessionId, payload);
    }),
    listen<{ previews?: PreviewState[] }>("live_state", ({ payload, server }) => {
      for (const id of previews.keys()) {
        if (serverOfSession(id) === server) replace(id, null);
      }
      for (const state of payload.previews ?? []) {
        noteSession(state.sessionId, server);
        replace(state.sessionId, state);
      }
    }),
  ]);
}

/// A late command reply cannot replace a newer lifecycle event or reconnect snapshot.
async function readState(sessionId: string, command: string, args: Record<string, unknown> = {}) {
  await startListening();
  const revision = revisions.get(sessionId);
  const state = await invoke<PreviewState | null>(command, { sessionId, ...args });
  if (revision === revisions.get(sessionId)) replace(sessionId, state);
  return previews.get(sessionId) ?? null;
}

export function usePreview(sessionId: string) {
  useEffect(() => {
    void readState(sessionId, "preview_status").catch(() => {});
  }, [sessionId]);
  return useSyncExternalStore(subscribe, () => previews.get(sessionId) ?? null);
}

export const previewSetup = (sessionId: string, directory?: string) =>
  invoke<PreviewSetup>("preview_setup", { sessionId, directory });

export const startPreview = (sessionId: string, config?: PreviewConfig) =>
  readState(sessionId, "preview_start", { config });

export const stopPreview = (sessionId: string) => readState(sessionId, "preview_stop");

export const previewLogs = (sessionId: string) => invoke<string>("preview_logs", { sessionId });

/// The remote server admits only its managed preview, keeping credentials out of the page.
export async function previewUrl(state: PreviewState): Promise<string> {
  if (!state.url || state.status !== "running") throw new Error("The preview is not running.");
  const server = serverOfSession(state.sessionId);
  if (server === LOCAL) return state.url;
  const port = await invoke<number>("preview_forward", { server, sessionId: state.sessionId }, LOCAL);
  return `http://127.0.0.1:${port}/`;
}

import { useEffect, useState, useSyncExternalStore } from "react";

import { readLocalStorage, writeLocalStorage } from "@/hooks/useLocalStorage";
import { channel } from "@/lib/channel";
import { invoke, listen, type ServerId } from "@/lib/transport";
import type { ConfigOption, Harness } from "@/types/events";

const KEY = "carbon.agentOptions";
const changed = channel<void>();
const EMPTY: Record<string, string> = {};
let picks = readLocalStorage<Record<string, Record<string, string>>>(KEY, {});
const explicit = new Map<string, Set<string>>();
const notices = new Map<string, string>();
const keyFor = (server: ServerId, harness: Harness) => `${server}|${harness}`;

export function pendingAgentOptions(server: ServerId, harness: Harness): Record<string, string> {
  return picks[keyFor(server, harness)] ?? EMPTY;
}

export function pickAgentOption(server: ServerId, harness: Harness, id: string, value: string) {
  const key = keyFor(server, harness);
  explicit.set(key, new Set([...(explicit.get(key) ?? []), id]));
  notices.delete(key);
  picks = { ...picks, [key]: { ...picks[key], [id]: value } };
  writeLocalStorage(KEY, picks);
  changed.emit();
}

export function clearAgentOptions(server: ServerId, harness: Harness) {
  const next = { ...picks };
  delete next[keyFor(server, harness)];
  explicit.delete(keyFor(server, harness));
  notices.delete(keyFor(server, harness));
  picks = next;
  writeLocalStorage(KEY, picks);
  changed.emit();
}

export function resetAgentOption(server: ServerId, harness: Harness, id: string) {
  const key = keyFor(server, harness);
  const next = { ...picks[key] };
  delete next[id];
  explicit.get(key)?.delete(id);
  picks = { ...picks, [key]: next };
  writeLocalStorage(KEY, picks);
  changed.emit();
}

export function rememberAgentOptions(server: ServerId, harness: Harness) {
  explicit.delete(keyFor(server, harness));
}

export function isAgentOptionExplicit(server: ServerId, harness: Harness, id: string) {
  return explicit.get(keyFor(server, harness))?.has(id) ?? false;
}

export function reconcileAgentOptions(server: ServerId, harness: Harness, options: ConfigOption[]) {
  if (!options.length) return;
  const key = keyFor(server, harness);
  const stale = Object.entries(pendingAgentOptions(server, harness)).filter(([id, value]) =>
    !explicit.get(key)?.has(id) && !options.some((option) => option.id === id && option.options.some((choice) => choice.value === value)));
  if (!stale.length) return;
  const next = { ...picks[key] };
  for (const [id] of stale) delete next[id];
  picks = { ...picks, [key]: next };
  notices.set(key, `The agent no longer offers ${stale.map(([, value]) => value).join(", ")}. Using its default.`);
  writeLocalStorage(KEY, picks);
  changed.emit();
}

export function useAgentOptionNotice(server: ServerId, harness: Harness) {
  return useSyncExternalStore(changed.subscribe, () => notices.get(keyFor(server, harness)) ?? null, () => null);
}

export function usePendingAgentOptions(server: ServerId, harness: Harness) {
  return useSyncExternalStore(changed.subscribe, () => pendingAgentOptions(server, harness), () => EMPTY);
}

export function useAgentOptions(server: ServerId, harness: Harness, sessionId: string | null) {
  const key = `${keyFor(server, harness)}|${sessionId}`;
  const [revision, setRevision] = useState(0);
  const [answer, setAnswer] = useState<{ key: string; options: ConfigOption[]; error: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    let generation = 0;
    const read = () => {
      const request = ++generation;
      void invoke<ConfigOption[]>("agent_options", { harness, sessionId }, server)
        .then((options) => { if (live && request === generation) {
          if (!sessionId) reconcileAgentOptions(server, harness, options);
          setAnswer({ key, options, error: null });
        } })
        .catch((error) => { if (live && request === generation) setAnswer((old) => ({ key, options: old?.key === key ? old.options : [], error: String(error) })); });
    };
    read();
    const stop = listen("models_changed", read);
    return () => { live = false; void stop.then((unlisten) => unlisten()); };
  }, [key, server, harness, sessionId, revision]);
  return { ...(answer?.key === key ? answer : { options: [], error: null }), retry: () => setRevision((value) => value + 1) };
}

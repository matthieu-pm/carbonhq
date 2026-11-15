import { useEffect, useState, useSyncExternalStore } from "react";

import { readLocalStorage, writeLocalStorage } from "@/hooks/useLocalStorage";
import { channel } from "@/lib/channel";
import { invoke, listen, type ServerId } from "@/lib/transport";
import type { ConfigOption, Harness } from "@/types/events";

const KEY = "carbon.agentOptions";
const changed = channel<void>();
const EMPTY: Record<string, string> = {};
let picks = readLocalStorage<Record<string, Record<string, string>>>(KEY, {});
const keyFor = (server: ServerId, harness: Harness) => `${server}|${harness}`;

export function pendingAgentOptions(server: ServerId, harness: Harness): Record<string, string> {
  return picks[keyFor(server, harness)] ?? EMPTY;
}

export function pickAgentOption(server: ServerId, harness: Harness, id: string, value: string) {
  const key = keyFor(server, harness);
  picks = { ...picks, [key]: { ...picks[key], [id]: value } };
  writeLocalStorage(KEY, picks);
  changed.emit();
}

export function clearAgentOptions(server: ServerId, harness: Harness) {
  const next = { ...picks };
  delete next[keyFor(server, harness)];
  picks = next;
  writeLocalStorage(KEY, picks);
  changed.emit();
}

export function usePendingAgentOptions(server: ServerId, harness: Harness) {
  return useSyncExternalStore(changed.subscribe, () => pendingAgentOptions(server, harness), () => EMPTY);
}

export function useAgentOptions(server: ServerId, harness: Harness, sessionId: string | null) {
  const key = `${keyFor(server, harness)}|${sessionId}`;
  const [answer, setAnswer] = useState<{ key: string; options: ConfigOption[]; error: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    let generation = 0;
    const read = () => {
      const request = ++generation;
      void invoke<ConfigOption[]>("agent_options", { harness, sessionId }, server)
        .then((options) => { if (live && request === generation) setAnswer({ key, options, error: null }); })
        .catch((error) => { if (live && request === generation) setAnswer((old) => ({ key, options: old?.key === key ? old.options : [], error: String(error) })); });
    };
    read();
    const stop = listen("models_changed", read);
    return () => { live = false; void stop.then((unlisten) => unlisten()); };
  }, [key, server, harness, sessionId]);
  return answer?.key === key ? answer : { options: [], error: null };
}

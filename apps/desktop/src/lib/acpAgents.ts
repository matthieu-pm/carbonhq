import { useCallback, useSyncExternalStore } from "react";

import { forgetAgentAvailability } from "@/hooks/useAgentAvailability";
import { channel } from "@/lib/channel";
import { invoke, LOCAL, type ServerId } from "@/lib/transport";
import type { AcpAgent, AcpAgentCatalog, CustomAgent, Harness } from "@/types/events";

/// The ACP agents each server knows of — the registry plus the reader's own —
/// as one module store, since the picker, the icon and Settings all read it and
/// per-hook copies would disagree about which are on. Per server, because each
/// keeps its own enabled set and its own installs.
const changed = channel<void>();
const NONE: AcpAgent[] = [];
const lists = new Map<ServerId, AcpAgent[]>();
const loading = new Map<ServerId, Promise<void>>();
const EMPTY_STATUS = { loading: false, error: null as string | null };
const statuses = new Map<ServerId, typeof EMPTY_STATUS>();

/// Reads `server`'s list again. `recheck` throws away the cached binary
/// lookups, for an agent installed while the app is open.
export function loadAcpAgents(recheck = false, server: ServerId = LOCAL): Promise<void> {
  const running = loading.get(server);
  if (running && !recheck) return running;
  statuses.set(server, { loading: true, error: statuses.get(server)?.error ?? null });
  changed.emit();
  const read = invoke<AcpAgentCatalog>("list_acp_agents", { recheck }, server)
    .then((next) => {
      if (loading.get(server) !== read) return;
      if (next.agents.length || !lists.has(server)) lists.set(server, next.agents);
      statuses.set(server, { loading: false, error: next.error });
      forgetAgentAvailability();
      changed.emit();
    })
    .catch((error: unknown) => {
      if (loading.get(server) !== read) return;
      statuses.set(server, { loading: false, error: String(error) });
      changed.emit();
    })
    .finally(() => {
      if (loading.get(server) === read) loading.delete(server);
    });
  loading.set(server, read);
  return read;
}

export function useAcpAgentStatus(server: ServerId = LOCAL) {
  const subscribe = useCallback((listener: () => void) => changed.subscribe(listener), []);
  const snapshot = () => statuses.get(server) ?? EMPTY_STATUS;
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function useAcpAgents(server: ServerId = LOCAL): AcpAgent[] {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!lists.has(server)) void loadAcpAgents(false, server);
      return changed.subscribe(listener);
    },
    [server],
  );
  const snapshot = () => lists.get(server) ?? NONE;
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function isAcp(harness: Harness): boolean {
  return harness.startsWith("acp:");
}

/// The agent behind a harness on `server`. A custom agent can reuse an id on
/// another server, so a requested server never borrows another server's rows.
export function findAcpAgent(harness: Harness, server?: ServerId): AcpAgent | undefined {
  if (server !== undefined) return lists.get(server)?.find((a) => a.harness === harness);
  for (const list of lists.values()) {
    const found = list.find((a) => a.harness === harness);
    if (found) return found;
  }
  return undefined;
}

/// The agent's own name, or its id while no list has landed.
export function acpLabel(harness: Harness, server?: ServerId): string {
  return findAcpAgent(harness, server)?.name ?? harness.slice("acp:".length);
}

export async function setAcpAgentEnabled(harness: Harness, enabled: boolean, server: ServerId = LOCAL) {
  await invoke("set_acp_agent_enabled", { id: harness.slice("acp:".length), enabled }, server);
  loading.delete(server);
  await loadAcpAgents(false, server);
}

export async function saveCustomAcpAgent(agent: CustomAgent, server: ServerId = LOCAL) {
  await invoke("save_custom_acp_agent", { agent }, server);
  loading.delete(server);
  await loadAcpAgents(false, server);
}

export async function removeCustomAcpAgent(id: string, server: ServerId = LOCAL) {
  await invoke("remove_custom_acp_agent", { id }, server);
  loading.delete(server);
  await loadAcpAgents(false, server);
}

export async function setAcpAgentExecutable(id: string, command: string | null, server: ServerId = LOCAL) {
  await invoke("set_acp_agent_executable", { id, command }, server);
  loading.delete(server);
  await loadAcpAgents(false, server);
}

import { useCallback, useEffect, useState } from "react";

import { invoke, LOCAL } from "@/lib/transport";
import type { McpServerEntry, McpSource, McpStatusReport, McpTarget } from "@/types/events";

/// The last answers, for the life of the process, so a second visit draws rows
/// at once while the fresh read runs. The status read is the slow one —
/// Claude Code connects to every server to answer it — so it is drawn from
/// here until its own answer lands.
let lastList: McpSource[] | null = null;
let lastStatus: McpStatusReport | null = null;
let listGeneration = 0;
let statusGeneration = 0;

/// The MCP servers every agent loads, read off their own config files, and the
/// two writes that change them.
///
/// Mounting is the gate, as for `useAgentAccounts`: the settings page switches
/// tab bodies, so this exists only while its tab is on screen, and every open
/// reads again — a server added in a terminal must show the next time the tab
/// opens. Everything goes to this Mac: the files are where the agents run.
export function useMcpServers() {
  const [sources, setSources] = useState<McpSource[] | null>(lastList);
  const [status, setStatus] = useState<McpStatusReport | null>(lastStatus);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const mine = ++listGeneration;
    setBusy(true);
    try {
      const next = await invoke<McpSource[]>("list_mcp_servers", {}, LOCAL);
      if (mine === listGeneration) {
        lastList = next;
        setSources(next);
        setError(null);
      }
    } catch (err) {
      if (mine === listGeneration) setError(String(err));
    } finally {
      if (mine === listGeneration) setBusy(false);
    }
  }, []);

  const check = useCallback(async () => {
    const mine = ++statusGeneration;
    setChecking(true);
    try {
      const next = await invoke<McpStatusReport>("mcp_server_status", {}, LOCAL);
      if (mine === statusGeneration) {
        lastStatus = next;
        setStatus(next);
      }
    } catch {
      // A status read that failed outright leaves the last one standing; the
      // list itself never waits on this.
    } finally {
      if (mine === statusGeneration) setChecking(false);
    }
  }, []);

  const refresh = useCallback(() => {
    void load();
    void check();
  }, [load, check]);

  useEffect(() => {
    refresh();
    return () => {
      ++listGeneration;
      ++statusGeneration;
    };
  }, [refresh]);

  /// Adds or replaces a server, then re-reads. The status read follows too,
  /// since a server just added is the one the reader wants to see connect.
  const save = useCallback(
    async (target: McpTarget, original: string | null, server: McpServerEntry) => {
      await invoke("save_mcp_server", { target, original, server }, LOCAL);
      await load();
      void check();
    },
    [load, check],
  );

  const remove = useCallback(
    async (target: McpTarget, name: string) => {
      await invoke("remove_mcp_server", { target, name }, LOCAL);
      await load();
      void check();
    },
    [load, check],
  );

  return { sources, status, busy, checking, error, refresh, save, remove };
}

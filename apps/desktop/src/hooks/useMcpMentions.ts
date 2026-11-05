import { invoke } from "@/lib/transport";
import { useEffect, useState } from "react";

import type { Harness, McpMention } from "@/types/events";

/// Kept across mounts and keyed by harness and directory, for
/// `useSlashCommands`' reason: the composer remounts on every session switch.
/// Not kept for good — the server's own copy lives a minute, so a server added
/// in Settings → MCP shows up on the next fetch after this one ages out.
const cache = new Map<string, { at: number; servers: McpMention[] }>();
const FRESH_MS = 60_000;

type Answer = { key: string; servers: McpMention[] };

/// The MCP servers `harness` loads in `cwd`, for the `$` picker.
///
/// A failed read answers empty: unlike `/`, the picker has nothing to say for
/// an empty list, so a failure and "none configured" both leave `$` as prose.
export function useMcpMentions(cwd: string | null, harness: Harness): McpMention[] {
  const key = cwd ? `${harness}\u0000${cwd}` : null;
  const [answer, setAnswer] = useState<Answer | null>(null);

  // Read during render, so a project switch never paints the last one's list.
  const hit = key ? cache.get(key) : undefined;
  const current = hit ? { key: key!, servers: hit.servers } : answer?.key === key ? answer : null;
  const stale = !hit || Date.now() - hit.at > FRESH_MS;

  useEffect(() => {
    if (!key || !stale) return;

    // Claude Code's list is a ~1.5s child, which a fast switch can outrun.
    let cancelled = false;
    invoke<McpMention[]>("list_mcp_mentions", { harness, cwd })
      .then((servers) => {
        cache.set(key, { at: Date.now(), servers });
        if (!cancelled) setAnswer({ key, servers });
      })
      .catch((e) => console.error("[mcp mentions]", e));

    return () => {
      cancelled = true;
    };
  }, [cwd, harness, key, stale]);

  return current?.servers ?? NONE;
}

const NONE: McpMention[] = [];

import { useEffect, useMemo, useRef, useState } from "react";

import { mergeSides } from "@/lib/home";
import { remoteServers } from "@/lib/servers";
import { invoke, LOCAL } from "@/lib/transport";
import type { SessionIndexItem } from "@/types/events";

/// Active and settled sessions together, for the home cards: the sidebar's
/// list holds one side at a time, and a count read off it changed with the
/// toggle and lost a session the moment it was settled.
///
/// `shown` is that list and `side` the side it holds (`indexSide`), null
/// before the first read. The other side is read here, again whenever a
/// session joins or leaves `shown` — settling, unsettling and deleting all
/// move one — and only while `enabled`, since nothing else draws it.
export function useAllSessions(
  shown: SessionIndexItem[],
  side: boolean | null,
  enabled: boolean,
): SessionIndexItem[] {
  const [read, setRead] = useState<{ side: boolean; items: SessionIndexItem[] } | null>(null);

  // What each side last drew, so a toggle has the side just left in hand
  // until its read lands; without it the totals dip for that read's length.
  const drawn = useRef(new Map<boolean, SessionIndexItem[]>());
  if (side !== null) drawn.current.set(side, shown);

  const ids = useMemo(() => shown.map((i) => i.sessionId).sort().join("\n"), [shown]);

  useEffect(() => {
    if (side === null || !enabled) return;
    let stale = false;
    const servers = [LOCAL, ...remoteServers().flatMap((s) => (s.status === "connected" ? [s.id] : []))];
    // A server that cannot answer adds nothing rather than failing the rest.
    const reads = servers.map((server) =>
      invoke<SessionIndexItem[]>("list_session_index_items", { archived: !side }, server).catch(
        (): SessionIndexItem[] => [],
      ),
    );
    void Promise.all(reads).then((lists) => {
      if (!stale) setRead({ side: !side, items: lists.flat() });
    });
    return () => {
      stale = true;
    };
  }, [side, ids, enabled]);

  return useMemo(() => {
    if (side === null) return shown;
    const other = read?.side === !side ? read.items : (drawn.current.get(!side) ?? []);
    return mergeSides(shown, other);
  }, [shown, side, read]);
}

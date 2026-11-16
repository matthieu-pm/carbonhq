import type { AgentEvent, QueueChangedEvent, SessionPage } from "@/types/events";
import { retireOldestProvisional } from "@/lib/provisional";
import { isAsk } from "@/lib/earlyEvents";

export type SessionRecovery = SessionPage & { reset: boolean };

/// A reset discards the gap, keeping answerable cards and output received during the read.
export function resetToTail(current: AgentEvent[], held: AgentEvent[], tail: AgentEvent[]): AgentEvent[] {
  const heldIds = new Set(held.map((e) => e.id));
  const tailIds = new Set(tail.map((e) => e.id));
  let lastHeld = -1;
  current.forEach((e, i) => { if (heldIds.has(e.id)) lastHeld = i; });
  const arrived = current.filter((e, i) => i > lastHeld && !tailIds.has(e.id) && !isAsk(e));
  const open = new Map<string, AgentEvent>();
  for (const event of current) {
    const payload = event.payload;
    if (payload.type === "permission_requested" || payload.type === "questions_asked") {
      open.set(payload.requestId, event);
    } else if (payload.type === "permission_decided") {
      open.delete(payload.requestId);
    }
  }
  const asks = [...open.values()];
  return [...tail, ...arrived, ...asks];
}

/// What a `carbon-serve` sends on every connect: what lives in its memory and in
/// no log. A request is only ever answerable by the child that asked, so this
/// is the whole truth about which cards are open — a reconnect that kept its
/// own copy could draw one already answered, or miss one raised meanwhile.
/// See SERVE-PLAN.md.
export type LiveState = {
  asks: AgentEvent[];
  /// The newest `background_tasks_changed` per session, which replaces.
  tasks: AgentEvent[];
  /// Every non-empty queue. Absent from a server that predates it.
  queued?: QueueChangedEvent[];
};

/// The logged events a client missed: everything in `fetched` (a log tail, in
/// log order) after the newest event it already `held`. `null` where the tail
/// shares no event with what is held, so an older page is needed first.
///
/// Matched on event id, never `seq`: a Claude Code subagent numbers its own
/// events from 0 inside the same log, so no seq is a cursor.
export function missedEvents(held: AgentEvent[], fetched: AgentEvent[]): AgentEvent[] | null {
  const ids = new Set(held.map((e) => e.id));
  for (let i = fetched.length - 1; i >= 0; i--) {
    if (ids.has(fetched[i].id)) return fetched.slice(i + 1);
  }
  return held.length === 0 ? fetched : null;
}

/// Puts `fresh` — what a log read returned — into `current`, the session's
/// events now. The read was awaited and live events kept landing meanwhile:
/// whatever `current` holds that `held` (taken before the read) lacked and the
/// read did not return arrived after it, so it goes after every event the read
/// did. Appended instead, older events sat behind newer ones and a backward
/// walk read the wrong one as the newest.
///
/// Arrived means *after* the newest held event: one before it is an older page
/// prepended during the read, and stays where it is.
export function mergeMissed(current: AgentEvent[], held: AgentEvent[], fresh: AgentEvent[]): AgentEvent[] {
  const have = new Set(current.map((e) => e.id));
  if (fresh.every((e) => have.has(e.id))) return current;
  const heldIds = new Set(held.map((e) => e.id));
  const freshIds = new Set(fresh.map((e) => e.id));
  let lastHeld = -1;
  current.forEach((e, i) => {
    if (heldIds.has(e.id)) lastHeld = i;
  });
  let events = current.filter((e, i) => i <= lastHeld && !freshIds.has(e.id));
  const arrived = current.filter((e, i) => i > lastHeld && !freshIds.has(e.id));
  for (const e of fresh) {
    // One that arrived live already retired its own provisional prompt.
    const retire = e.payload.type === "user_message" && !have.has(e.id);
    events = [...(retire ? retireOldestProvisional(events) : events), e];
  }
  return [...events, ...arrived];
}

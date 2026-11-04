import type { AgentEvent } from "@/types/events";

/// Superseded turns remain in the log, with exact prompt ids defining the discarded range.
export function activeMessageEvents(events: AgentEvent[]): AgentEvent[] {
  const removed = new Set<string>();
  for (const event of events) {
    if (event.payload.type !== "turn_replayed") continue;
    const { promptEventId, replacementEventId } = event.payload;
    const start = events.findIndex((e) => e.id === promptEventId);
    const end = events.findIndex((e) => e.id === replacementEventId);
    if (start < 0 || end <= start) continue;
    for (let i = start; i < end; i++) removed.add(events[i].id);
  }
  return removed.size ? events.filter((e) => !removed.has(e.id)) : events;
}

import { useEffect, useState } from "react";

import { invoke } from "@/lib/transport";
import type { ContextBreakdown } from "@/types/events";

// Only a running child can answer, so the last answer is kept for a session
// whose child has since gone.
const lastKnown = new Map<string, ContextBreakdown>();

/// What fills a session's context window, re-read whenever `revision` moves.
export function useContextBreakdown(sessionId: string, enabled: boolean, revision: string): ContextBreakdown | null {
  const [breakdown, setBreakdown] = useState(() => lastKnown.get(sessionId) ?? null);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    invoke<ContextBreakdown | null>("context_breakdown", { sessionId }).then((next) => {
      if (!next) return;
      lastKnown.set(sessionId, next);
      if (current) setBreakdown(next);
    }).catch(() => {});
    return () => { current = false; };
  }, [sessionId, enabled, revision]);
  return breakdown;
}

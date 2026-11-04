import { useCallback, useEffect, useRef, useState } from "react";

import { isWindowFocused, onFocusChange } from "@/lib/focus";
import { invoke, LOCAL } from "@/lib/transport";
import type { SubscriptionUsage } from "@/types/events";

/// Polls account usage while visible and coalesces refreshes without touching any session state.
export function useSubscriptionUsage() {
  const [rows, setRows] = useState<SubscriptionUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(Date.now);
  const busy = useRef(false);
  const mounted = useRef(false);
  const lastRead = useRef(0);

  const refresh = useCallback(async (force = false) => {
    setNow(Date.now());
    if (busy.current || (!force && Date.now() - lastRead.current < 30_000)) return;
    busy.current = true;
    setLoading(true);
    try {
      const next = await invoke<SubscriptionUsage[]>("subscription_usage", { refresh: force }, LOCAL);
      if (mounted.current) {
        setRows(next);
        setError(false);
        lastRead.current = Date.now();
      }
    } catch {
      if (mounted.current) setError(true);
    } finally {
      busy.current = false;
      if (mounted.current) {
        setLoading(false);
        setNow(Date.now());
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const tick = () => {
      setNow(Date.now());
      if (document.visibilityState === "visible" && isWindowFocused()) void refresh();
    };
    const timer = window.setInterval(tick, 60_000);
    const off = onFocusChange((focused) => { if (focused) tick(); });
    document.addEventListener("visibilitychange", tick);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      off();
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh]);

  return { rows, loading, error, now, refresh };
}

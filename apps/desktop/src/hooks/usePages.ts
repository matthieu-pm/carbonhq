import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, listen, LOCAL } from "@/lib/transport";
import { useServers } from "@/lib/servers";
import { locatePage, type LocatedPage, type PageSummary } from "@/lib/pages";

/// Events invalidate the list; reconnects and navigation always read current durable state.
export function usePages(active: boolean, query = "") {
  const servers = useServers();
  const owners = [LOCAL, ...servers.filter((server) => server.status === "connected").map((server) => server.id)];
  const ownerKey = owners.join(",");
  const [pages, setPages] = useState<LocatedPage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++generation.current;
    const results = await Promise.allSettled(owners.map(async (server) => {
      const all = await invoke<PageSummary[]>("list_pages", { trashed: false, query }, server);
      const trash = await invoke<PageSummary[]>("list_pages", { trashed: true, query }, server);
      return [...all, ...trash].map((page) => locatePage(page, server));
    }));
    if (generation.current !== seq) return;
    setPages(results.flatMap((result) => result.status === "fulfilled" ? result.value : []));
    const failed = results.flatMap((result, i) => result.status === "rejected" ? [`${owners[i]}: ${String(result.reason)}`] : []);
    setError(failed.length ? failed.join(" · ") : null);
    setLoading(false);
  // The identity list is the dependency, rather than a new array every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerKey, query]);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const unlisten = listen("pages_changed", () => { if (!stopped) void refresh(); });
    const reconnect = listen("live_state", () => { if (!stopped) void refresh(); });
    void refresh();
    return () => {
      stopped = true;
      generation.current++;
      void unlisten.then((off) => off());
      void reconnect.then((off) => off());
    };
  }, [active, refresh]);
  return { pages, error, loading, refresh };
}

import { useEffect, useState } from "react";
import { FileText, Link2 } from "lucide-react";
import { invoke, listen, LOCAL } from "@/lib/transport";
import { useServers } from "@/lib/servers";
import { locatePage, openPage, pageKey, type LocatedPage, type PageSummary, type PageTarget } from "@/lib/pages";

export default function PageBacklinks({ page, active, visibleProjects }: { page: PageTarget; active: boolean; visibleProjects: string[] | null }) {
  const servers = useServers();
  const owners = [LOCAL, ...servers.filter((server) => server.status === "connected").map((server) => server.id)];
  const ownerKey = owners.join(",");
  const [links, setLinks] = useState<LocatedPage[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let sequence = 0;
    setLinks([]);
    setError(null);
    const refresh = async () => {
      const seq = ++sequence;
      const results = await Promise.allSettled(owners.map(async (server) => {
        const next = await invoke<PageSummary[]>("page_backlinks", { id: page.id, owner: page.server, sourceOwner: server }, server);
        return next.map((link) => locatePage(link, server));
      }));
      if (stopped || seq !== sequence) return;
      setLinks(results.flatMap((result) => result.status === "fulfilled" ? result.value : []));
      const failures = results.flatMap((result, index) => result.status === "rejected" ? [`${owners[index]}: ${String(result.reason)}`] : []);
      setError(failures.length ? failures.join(" · ") : null);
    };
    const off = listen("pages_changed", () => { void refresh(); });
    const reconnect = listen("live_state", () => { void refresh(); });
    void refresh();
    return () => { stopped = true; void off.then((fn) => fn()); void reconnect.then((fn) => fn()); };
    // The owner identities, rather than the fresh array, define the connected stores.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id, page.server, active, ownerKey]);
  const visible = links.filter((link) => visibleProjects === null || link.projectPaths.length === 0 || link.projectPaths.some((path) => visibleProjects.includes(path)));
  return <section className="mt-10 border-t border-border pt-5" aria-label="Backlinks"><h2 className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground"><Link2 className="size-3.5" />Linked from {visible.length ? `· ${visible.length}` : ""}</h2>{error && <p role="alert" className="mb-2 text-xs text-destructive">{error}</p>}{visible.length ? visible.map((link) => <button key={pageKey(link)} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted" onClick={() => openPage({ id: link.id, server: link.server })}><FileText className="size-3.5 text-muted-foreground" />{link.title}</button>) : <p className="text-xs text-muted-foreground">Pages that link here will appear here.</p>}</section>;
}

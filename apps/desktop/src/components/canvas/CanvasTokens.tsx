import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { invoke } from "@/lib/transport";
import type { CanvasTokenCatalog } from "@/types/events";

type State = { key: string; catalog: CanvasTokenCatalog | null; loading: boolean; error: string | null };

export function useCanvasTokens(projectPath: string | null, sessionId: string | null, cwd: string | null, owner: string, enabled: boolean) {
  const key = JSON.stringify([owner, projectPath, sessionId, cwd]);
  const [state, setState] = useState<State | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!projectPath || !enabled) return;
    let stopped = false;
    setState(previous => ({ key, catalog: previous?.key === key ? previous.catalog : null, loading: true, error: null }));
    void invoke<CanvasTokenCatalog>("canvas_project_tokens", { projectPath, sessionId }, owner)
      .then(catalog => { if (!stopped) setState({ key, catalog, loading: false, error: null }); })
      .catch(error => {
        if (!stopped) setState(previous => ({ key, catalog: previous?.catalog ?? null, loading: false, error: String(error) }));
      });
    return () => { stopped = true; };
  }, [key, projectPath, sessionId, owner, enabled, refresh]);
  const current = state?.key === key ? state : null;
  return { key, catalog: current?.catalog ?? null, loading: current?.loading ?? Boolean(projectPath), error: current?.error ?? null, refresh: () => setRefresh(value => value + 1) };
}

const PAGE_SIZE = 100;

export default function CanvasTokens({ sourcePath, catalog, loading, error, refresh }: {
  sourcePath: string | null;
  catalog: CanvasTokenCatalog | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}) {
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const query = search.trim().toLowerCase();
  const rows = useMemo(() => catalog?.tokens.filter(token => !query || [token.name, token.value, token.file, ...token.scope].some(value => value.toLowerCase().includes(query))) ?? [], [catalog, query]);
  if (!sourcePath) return <p className="p-4 text-sm text-muted-foreground">Choose a project to see its tokens.</p>;
  const path = catalog?.source.cwd ?? sourcePath;
  const status = error ? `Couldn’t read project tokens. ${error}`
    : loading ? "Reading project CSS…"
    : catalog?.incomplete ? "Some CSS declarations could not be read."
    : !catalog?.tokens.length ? "No CSS custom properties found."
    : !rows.length ? "No matching tokens."
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col text-ui select-text">
      <div className="flex shrink-0 flex-col gap-2 border-b border-hairline p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">{catalog?.source.worktree ?? "Project CSS"}</p>
            <p className="truncate text-xs text-muted-foreground" title={path}>{path}</p>
          </div>
          <Button variant="ghost" size="sm" aria-label="Refresh project tokens" disabled={loading} onClick={refresh}>Refresh</Button>
        </div>
        <Input value={search} onChange={event => { setSearch(event.target.value); setLimit(PAGE_SIZE); }} placeholder="Search tokens" aria-label="Search project tokens" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {status && <p className="py-3 text-xs text-muted-foreground break-words" role="status">{status}</p>}
        <ul className="divide-y divide-hairline">
          {rows.slice(0, limit).map(({ name, value, file, line, scope }, index) => {
            const location = `${file}:${line}`;
            const context = [scope.join(" › "), location].filter(Boolean).join(" · ");
            return <li key={`${location}:${name}:${index}`} className="py-2.5">
              <div className="flex min-w-0 items-start justify-between gap-3 font-mono text-xs">
                <span className="min-w-0 font-medium break-all">{name}</span>
                <span className="min-w-0 text-right break-all">{value || "(empty)"}</span>
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground" title={context}>{context}</p>
            </li>;
          })}
        </ul>
        {rows.length > limit && <Button variant="ghost" size="sm" className="mt-2" onClick={() => setLimit(value => value + PAGE_SIZE)}>Show more</Button>}
      </div>
    </div>
  );
}

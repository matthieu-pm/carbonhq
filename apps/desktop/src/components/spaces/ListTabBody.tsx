import { useDeferredValue, useMemo, useState } from "react";
import { ChevronDown, FileText, LayoutGrid, List, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import LinearIcon from "@/components/LinearIcon";
import Segmented from "@/components/Segmented";
import PageTable from "./PageTable";
import LinearDocuments from "./LinearDocuments";
import { COMING, spaceTabTitle } from "./sections";
import { useHotkey } from "@/hooks/useHotkey";
import { usePages } from "@/hooks/usePages";
import { pageKey, type PageTarget } from "@/lib/pages";
import type { Filter, SpaceTab, SpaceView } from "@/lib/spaceTabs";
import { LOCAL, type ServerId } from "@/lib/transport";
import { useServers } from "@/lib/servers";
import { cn } from "@/lib/utils";
import type { Project } from "@/types/events";

const FILTER_LABELS: Record<Filter, string> = { all: "All", favorites: "Favorites", recent: "Recently edited" };

/// One list tab's page: its heading and Create menu, then the section it
/// points at. Each tab reads Pages for its own search, so two tabs never share
/// a query, a filter or a selection.
export default function ListTabBody({ tab, shown, active, projects, visibleProjects, creating, onView, onOpen, onCreate, onImport }: {
  tab: SpaceTab;
  shown: boolean;
  active: boolean;
  projects: Project[];
  visibleProjects: string[] | null;
  creating: boolean;
  onView: (patch: Partial<SpaceView>) => void;
  onOpen: (target: PageTarget, title: string) => void;
  onCreate: (server?: ServerId) => void;
  onImport: () => void;
}) {
  const { section, filter, project, query, grid } = tab.view;
  const live = active && shown;
  const deferredQuery = useDeferredValue(query);
  const { pages, error, loading, refresh } = usePages(live, deferredQuery);
  const [actionError, setActionError] = useState<string | null>(null);
  const servers = useServers();
  useHotkey("panel.refresh", () => { void refresh(); }, { enabled: live, page: true });

  const trash = section === "trash";
  const listed = useMemo(() => {
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    return pages
      .filter((p) => visibleProjects === null || p.projectPaths.length === 0 || p.projectPaths.some((path) => visibleProjects.includes(path)))
      .filter((p) => p.trashed === trash && (!project || p.projectPaths.includes(project)) &&
        (trash || filter !== "favorites" || p.favorite) && (trash || filter !== "recent" || p.modified >= weekAgo))
      .sort((a, b) => b.modified.localeCompare(a.modified));
  }, [pages, visibleProjects, trash, filter, project]);

  const coming = COMING[section];
  const listsPages = !coming && section !== "linear";
  const emptyTitle = query ? "No Pages found" : trash ? "Trash is empty" : filter === "favorites" ? "Keep your favorite Pages close" : filter === "recent" ? "Nothing edited this week" : "A place for your ideas";
  const open = (target: PageTarget) => {
    const found = pages.find((p) => pageKey(p) === pageKey(target));
    onOpen(target, found?.title ?? "Untitled");
  };

  return <>
    <header className="spaces-header">
      <h2 className="text-xl font-semibold tracking-tight">{spaceTabTitle(tab, projects)}</h2>
      <div className="ml-auto flex items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="sm" disabled={creating}><Plus />Create<ChevronDown /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onCreate()}><FileText />New Page</DropdownMenuItem>
            <DropdownMenuItem onSelect={onImport}><LinearIcon />Import from Linear</DropdownMenuItem>
            {servers.filter((s) => s.status === "connected").map((s) => <DropdownMenuItem key={s.id} onSelect={() => onCreate(s.id)}>New Page on {s.name}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
    {(actionError || error) && <div role="alert" className="spaces-error">{actionError || error}<button onClick={() => { setActionError(null); void refresh(); }}>Retry</button></div>}
    {coming && <div className="spaces-empty"><coming.Icon className="size-8 text-muted-foreground/60" /><h3>{coming.title}</h3><p>{coming.body}</p></div>}
    {section === "linear" && <LinearDocuments active={live} server={LOCAL} query={deferredQuery} onOpened={(document) => onOpen({ id: document.id, server: document.server }, document.title)} onError={setActionError} />}
    {listsPages && <>
      <div className="spaces-list-tools">
        {/* The issues page's scope chips and its two-way control, so the two
            pages' toolbars read as one kind of row. */}
        {!trash && <div className="flex items-center gap-1.5" role="tablist" aria-label="Page filters">
          {(["all", "favorites", "recent"] as const).map((id) => <button key={id} type="button" role="tab" aria-selected={filter === id}
            className={cn("shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-ui transition-colors",
              filter === id ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:text-foreground")}
            onClick={() => onView({ filter: id })}>{FILTER_LABELS[id]}</button>)}
        </div>}
        <Segmented value={grid ? "grid" : "list"} label="Layout" className="ml-auto" onPick={(layout) => onView({ grid: layout === "grid" })}
          options={[{ value: "list", label: "List view", content: <List className="size-3.5" /> }, { value: "grid", label: "Grid view", content: <LayoutGrid className="size-3.5" /> }]} />
      </div>
      {loading ? <div className="spaces-empty"><Loader2 className="size-5 animate-spin" /><p>Loading Pages…</p></div> : listed.length === 0 ? <div className="spaces-empty"><FileText className="size-8 text-muted-foreground/60" /><h3>{emptyTitle}</h3><p>{query ? "Try another title or a phrase from the document." : "Write a Page, link it to your projects, and work on it with your agents."}</p>{!query && !trash && <Button size="sm" onClick={() => onCreate()}><Plus />Create a Page</Button>}</div>
        : <PageTable key={`${section}:${filter}:${project ?? ""}`} pages={listed} projects={projects} grid={grid} trash={trash} active={live}
            onOpen={open} onChanged={() => void refresh()} onError={setActionError} />}
    </>}
  </>;
}

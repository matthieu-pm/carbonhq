import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, Clock3, Columns3, FileText, Folder, LayoutGrid, List, Loader2, Plus, Search, Star, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import ShortcutKeys from "@/components/ShortcutKeys";
import PageDocument from "./PageDocument";
import PageSnapshot from "./PageSnapshot";
import LinearImportDialog from "./LinearImportDialog";
import { useHotkey } from "@/hooks/useHotkey";
import { openPageDraft } from "@/hooks/usePageDocument";
import { usePages } from "@/hooks/usePages";
import { createPage, locatePage, ownerProjects, pageKey, readPage, type LocatedPage, type Page, type PageTarget } from "@/lib/pages";
import { LOCAL, serverOfPath } from "@/lib/transport";
import { projectLabel, serverName, useServers } from "@/lib/servers";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Project } from "@/types/events";
import "./spaces.css";

type Filter = "all" | "favorites" | "recent" | "trash";
const FILTERS = [
  { id: "all", label: "All Pages", Icon: Columns3 },
  { id: "favorites", label: "Favorites", Icon: Star },
  { id: "recent", label: "Recent", Icon: Clock3 },
] as const;

/// Spaces fills the shell's sheet beside the rail, its own sidebar included,
/// while the task shell keeps its place hidden underneath.
export default function SpacesView({ active, projects, visibleProjects, request, onClose }: {
  active: boolean;
  projects: Project[];
  visibleProjects: string[] | null;
  request?: { target: PageTarget; serial: number } | null;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const { pages, error, loading, refresh } = usePages(active, deferredQuery);
  const [filter, setFilter] = useState<Filter>("all");
  const [project, setProject] = useState<string | null>(null);
  const [grid, setGrid] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [target, setTarget] = useState<PageTarget | null>(null);
  const [page, setPage] = useState<LocatedPage<Page> | null>(null);
  const [opening, setOpening] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const openGeneration = useRef(0);
  const handledRequest = useRef(0);
  const flushCurrent = useRef<() => void>(() => {});
  const currentPage = useRef(page);
  currentPage.current = page;
  const servers = useServers();
  const availableProjects = projects.filter((p) => visibleProjects === null || visibleProjects.includes(p.path));
  const scoped = pages.filter((p) => visibleProjects === null || p.projectPaths.length === 0 || p.projectPaths.some((path) => visibleProjects.includes(path)));
  const recents = [...scoped].filter((p) => !p.trashed).sort((a, b) => b.modified.localeCompare(a.modified)).slice(0, 5);
  const shown = useMemo(() => scoped.filter((p) => p.trashed === (filter === "trash") &&
    (filter !== "favorites" || p.favorite) && (!project || p.projectPaths.includes(project)))
    .sort((a, b) => filter === "recent" ? b.modified.localeCompare(a.modified) : b.modified.localeCompare(a.modified)), [scoped, filter, project]);

  const resetNavigation = () => {
    ++openGeneration.current;
    setOpening(false);
    setTarget(null);
    setPage(null);
  };
  useLayoutEffect(() => {
    if (visibleProjects === null) return;
    if (project && !visibleProjects.includes(project)) setProject(null);
    if (page && page.projectPaths.length > 0 && !page.projectPaths.some((path) => visibleProjects.includes(path))) {
      flushCurrent.current();
      resetNavigation();
    }
  // Drafts live outside navigation, so a Profile change hides content without losing edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleProjects?.join("\n"), page?.id, page?.projectPaths.join("\n")]);

  const leave = () => {
    flushCurrent.current();
    return true;
  };
  const open = async (next: PageTarget) => {
    if (!leave()) return;
    const generation = ++openGeneration.current;
    setTarget(next);
    setPage(null);
    setOpening(true);
    setActionError(null);
    try {
      const document = await readPage(next, next.revision);
      if (next.revision === undefined) openPageDraft(document);
      if (generation === openGeneration.current) setPage(document);
    } catch (reason) {
      if (generation === openGeneration.current) setActionError(String(reason));
    } finally {
      if (generation === openGeneration.current) setOpening(false);
    }
  };
  const back = () => {
    if (!leave()) return;
    resetNavigation();
  };
  const create = async (server = project ? serverOfPath(project) : LOCAL) => {
    if (creating || !leave()) return;
    resetNavigation();
    const generation = openGeneration.current;
    setCreating(true);
    setActionError(null);
    try {
      const created = await createPage(server, project && serverOfPath(project) === server ? [project] : []);
      if (generation !== openGeneration.current) { void refresh(); return; }
      setTarget({ id: created.id, server: created.server });
      setPage(created);
      setFilter("all");
      void refresh();
    } catch (reason) { setActionError(String(reason)); }
    finally { setCreating(false); }
  };
  const chooseFilter = (next: Filter, path: string | null = null) => {
    if (!leave()) return;
    resetNavigation();
    setFilter(next);
    setProject(path);
  };

  useEffect(() => {
    if (!active) return;
    const focus = () => search.current?.focus();
    window.addEventListener("spaces-search", focus);
    return () => { window.removeEventListener("spaces-search", focus); };
  // Navigation flushes through a ref, so the opener never captures an older editor.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  useEffect(() => { if (active) search.current?.focus(); }, [active]);
  useEffect(() => {
    if (active && request && request.serial !== handledRequest.current) {
      handledRequest.current = request.serial;
      void open(request.target);
    }
  // A request is consumed once; reopening Spaces keeps its own navigation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, request]);
  useHotkey("search", () => search.current?.focus(), { enabled: active, page: true });
  useHotkey("panel.refresh", () => { void refresh(); }, { enabled: active, page: true });
  useHotkey("tab.close", () => target ? back() : onClose(), { enabled: active, page: true });

  return <div className={cn("spaces-workspace", !active && "hidden")}>
    <div className="spaces-body">
      <aside className="spaces-sidebar">
        <div className="mb-5 flex items-center justify-between px-2"><h1 className="text-base font-semibold">Spaces</h1><ShortcutKeys ids={["spaces.open"]} /></div>
        <button className="spaces-nav mb-3" onClick={() => void create()} disabled={creating}><Plus />Create</button>
        {FILTERS.map(({ id, label, Icon }) => <button key={id} className="spaces-nav" aria-current={!target && filter === id && !project ? "page" : undefined} onClick={() => chooseFilter(id)}><Icon />{label}</button>)}
        <div className="spaces-section-label">Recents</div>
        {recents.map((recent) => <button key={pageKey(recent)} className="spaces-nav" aria-current={target && pageKey(target) === pageKey(recent) ? "page" : undefined} onClick={() => void open({ id: recent.id, server: recent.server })}><FileText /><span className="truncate">{recent.title}</span></button>)}
        {recents.length === 0 && <p className="px-2 text-xs text-muted-foreground">Your recent Pages appear here.</p>}
        <div className="spaces-section-label">Projects</div>
        <div className="min-h-0 flex-1 overflow-auto">
          {availableProjects.map((p) => <button key={p.path} className="spaces-nav" aria-current={!target && project === p.path ? "page" : undefined} onClick={() => chooseFilter("all", p.path)}><Folder /><span className="truncate">{projectLabel(p)}</span></button>)}
          {availableProjects.length === 0 && <p className="px-2 text-xs text-muted-foreground">Pages can stand on their own.</p>}
        </div>
        <button className="spaces-nav mt-5" aria-current={!target && filter === "trash" ? "page" : undefined} onClick={() => chooseFilter("trash")}><Trash2 />Trash</button>
      </aside>
      <main className="spaces-main">
        <header className="spaces-header">
          {target ? <button className="spaces-back" onClick={back}><ArrowLeft className="size-4" />All Pages</button> : <h2 className="text-xl font-semibold tracking-tight">{project ? projects.find((p) => p.path === project)?.name : filter === "trash" ? "Trash" : filter === "favorites" ? "Favorites" : filter === "recent" ? "Recent" : "All"}</h2>}
          <div className="ml-auto flex items-center gap-3">
            <label className="spaces-search"><Search className="size-3.5 shrink-0" /><input ref={search} value={query} onChange={(e) => { leave(); setQuery(e.target.value); resetNavigation(); }} placeholder="Search" aria-label="Search Pages" /><span className="sr-only">Search document titles and content</span>{query && <button aria-label="Clear search" onClick={() => setQuery("")}><X className="size-3" /></button>}</label>
            <DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" disabled={creating}><Plus />Create<ChevronDown /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => void create()}><FileText />New Page</DropdownMenuItem><DropdownMenuItem onSelect={() => setImportOpen(true)}>Import from Linear</DropdownMenuItem>{servers.filter((s) => s.status === "connected").map((s) => <DropdownMenuItem key={s.id} onSelect={() => void create(s.id)}>New Page on {s.name}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>
          </div>
        </header>
        {(actionError || error) && <div role="alert" className="spaces-error">{actionError || error}<button onClick={() => { setActionError(null); void refresh(); }}>Retry</button></div>}
        {opening ? <div className="spaces-empty"><Loader2 className="size-5 animate-spin" /><p>Opening Page…</p></div> : page ?
          target?.revision !== undefined ? <PageSnapshot page={page} onOpenCurrent={() => void open({ id: page.id, server: page.server })} /> : <PageDocument key={pageKey(page)} page={page} active={active} projects={availableProjects} visibleProjects={visibleProjects} onFlushReady={(flush) => { flushCurrent.current = flush; }} onSaved={(saved) => { setPage((current) => current && pageKey(current) === pageKey(saved) ? saved : current); }} onTrashed={() => { if (currentPage.current && pageKey(currentPage.current) === pageKey(page)) { resetNavigation(); } void refresh(); }} /> : !target && <>
            <div className="spaces-list-tools"><div className="flex gap-1" aria-label="Page filters">{(["all", "favorites", "recent"] as const).map((id) => <button key={id} className={cn("spaces-filter", filter === id && "bg-muted text-foreground")} onClick={() => chooseFilter(id, project)}>{id === "all" ? "All Pages" : id === "favorites" ? "Favorites" : "Recently edited"}</button>)}</div><div className="ml-auto flex gap-1"><button className="spaces-tool" aria-label="List view" aria-pressed={!grid} onClick={() => setGrid(false)}><List /></button><button className="spaces-tool" aria-label="Grid view" aria-pressed={grid} onClick={() => setGrid(true)}><LayoutGrid /></button></div></div>
            {loading ? <div className="spaces-empty"><Loader2 className="size-5 animate-spin" /><p>Loading Pages…</p></div> : shown.length === 0 ? <div className="spaces-empty"><FileText className="size-8 text-muted-foreground/60" /><h3>{query ? "No Pages found" : filter === "trash" ? "Trash is empty" : filter === "favorites" ? "Keep your favorite Pages close" : "A place for your ideas"}</h3><p>{query ? "Try another title or a phrase from the document." : "Write a Page, link it to your projects, and work on it with your agents."}</p>{!query && filter !== "trash" && <Button size="sm" onClick={() => void create()}><Plus />Create a Page</Button>}</div> : <div className={cn("spaces-page-list", grid && "spaces-page-grid")}>
              {!grid && <div className="spaces-list-heading"><span>Name</span><span>Projects</span><span>Last activity</span></div>}
              {shown.map((item) => <button key={pageKey(item)} className="spaces-page-row" onClick={() => void open({ id: item.id, server: item.server })}><span className="flex min-w-0 items-center gap-3"><span className="spaces-page-icon"><FileText /></span><span className="truncate">{item.title}</span>{item.favorite && <Star className="size-3 shrink-0 fill-current text-primary" />}</span><span className="truncate text-muted-foreground">{item.projectPaths.map((path) => projects.find((p) => p.path === path)?.name ?? path.split("/").pop()).join(", ") || "—"}{item.server !== LOCAL && <span className="ml-2 text-xs">{serverName(item.server)}</span>}</span><span className="text-muted-foreground" title={item.modified}>{relativeTime(item.modified)}</span>{grid && item.excerpt && <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{item.excerpt}</p>}</button>)}
            </div>}
          </>}
      </main>
    </div>
    <LinearImportDialog open={importOpen} onOpenChange={setImportOpen} server={project ? serverOfPath(project) : LOCAL}
      projectPaths={project ? ownerProjects([project], serverOfPath(project)) : []}
      onImported={(imported) => {
        leave(); resetNavigation();
        const document = locatePage(imported, project ? serverOfPath(project) : LOCAL);
        setPage(document); setTarget({ id: document.id, server: document.server }); void refresh();
      }} />
  </div>;
}


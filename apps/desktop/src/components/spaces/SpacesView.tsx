import { type CSSProperties, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Folder, Plus, Search, Trash2 } from "lucide-react";
import ShortcutKeys from "@/components/ShortcutKeys";
import { SIDEBAR_TOKENS } from "@/components/layout/AppShell";
import { RAIL_W } from "@/components/layout/Rail";
import { useResizable } from "@/components/ResizeHandle";
import { SIDEBAR_MIN } from "@/components/Sidebar";
import { Kbd } from "@/components/ui/kbd";
import ListTabBody from "./ListTabBody";
import PageTabBody from "./PageTabBody";
import LinearImportDialog from "./LinearImportDialog";
import { SECTIONS } from "./sections";
import { useHotkey } from "@/hooks/useHotkey";
import { usePages } from "@/hooks/usePages";
import { createPage, locatePage, ownerProjects, pageKey, type PageTarget } from "@/lib/pages";
import {
  activeSpaceTab,
  closeSpaceTab,
  editSpaceTabs,
  navigateSpaceTab,
  newSpaceTabId,
  openPageTab,
  setPageTabTitle,
  updateSpaceView,
  useSpaceTabs,
  type Section,
  type SpaceView,
} from "@/lib/spaceTabs";
import { LOCAL, serverOfPath, type ServerId } from "@/lib/transport";
import { projectLabel } from "@/lib/servers";
import { cn } from "@/lib/utils";
import type { Project } from "@/types/events";
import "./spaces.css";

/// Spaces fills the shell's sheet beside the rail, its own sidebar included,
/// while the task shell keeps its place hidden underneath. The body is one
/// pane per tab (`lib/spaceTabs`); the sidebar acts on the lit one.
export default function SpacesView({ active, projects, visibleProjects, request, createSerial = 0, sidebarCollapsed = false, onExpandSidebar, peek = false, onPeekHover, onNavigate, onDockedWidth, closeTabRef, onClose }: {
  active: boolean;
  projects: Project[];
  visibleProjects: string[] | null;
  request?: { target: PageTarget; serial: number } | null;
  /// Bumped by ⌘⇧P; each new value creates one Page.
  createSerial?: number;
  /// The task sidebar's collapse, shared: one toggle and one ⌘B for both.
  sidebarCollapsed?: boolean;
  onExpandSidebar?: () => void;
  /// The collapsed sidebar floating over the page, as Home's does from the rail.
  peek?: boolean;
  onPeekHover?: (over: boolean) => void;
  /// A sidebar row was used: brings Spaces up from wherever the card floated
  /// over, and closes the card, the way a row in Home's peek does.
  onNavigate?: () => void;
  /// The docked sidebar's width, 0 while it is not docked, for the tab strip to
  /// line up with the sheet beside it.
  onDockedWidth?: (width: number) => void;
  /// Where the titlebar strip's close buttons reach this page's `closeTab`.
  closeTabRef?: { current: (id: string) => void };
  onClose: () => void;
}) {
  const state = useSpaceTabs();
  const current = activeSpaceTab(state);
  const view = current.view;
  const [searchOpen, setSearchOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const handledRequest = useRef(0);
  const handledCreate = useRef(0);
  // Each Page tab's editor hands over its flush; a tab leaving its Page, or
  // closing, takes the last keystrokes with it rather than dropping them.
  const flushers = useRef(new Map<string, () => void>());
  const flush = (id: string) => flushers.current.get(id)?.();
  // A tab's pane mounts the first time it is shown and stays, hidden.
  const seen = useRef(new Set<string>());
  seen.current.add(state.active);

  // The rows live in one place at a time: in the floating card from its
  // opening until its 140ms fade has finished, in the docked frame otherwise,
  // so neither animation runs with nothing in it.
  const docked = active && !sidebarCollapsed;
  // The width eases only while the sidebar opens or shuts. Left on, it eased
  // every frame of a resize drag too, so the page trailed the pointer.
  const [motion, setMotion] = useState(false);
  const [lastCollapsed, setLastCollapsed] = useState(sidebarCollapsed);
  if (lastCollapsed !== sidebarCollapsed) { setLastCollapsed(sidebarCollapsed); setMotion(true); }
  useEffect(() => {
    if (!motion) return;
    const timer = window.setTimeout(() => setMotion(false), 220);
    return () => window.clearTimeout(timer);
  }, [motion]);
  const [floating, setFloating] = useState(false);
  useEffect(() => {
    if (docked) { setFloating(false); return; }
    if (peek) { setFloating(true); return; }
    const timer = window.setTimeout(() => setFloating(false), 140);
    return () => window.clearTimeout(timer);
  }, [peek, docked]);
  // The task sidebar's own width and key, so the two are one setting.
  const { style: widthStyle, handle } = useResizable({ storageKey: "ade.sidebarWidth", initial: SIDEBAR_MIN, min: SIDEBAR_MIN, edge: "right", label: "Resize the sidebar" });
  const width = Number(widthStyle.width);
  const widthVar = { "--spaces-sidebar-w": `${width}px` } as CSSProperties;
  useEffect(() => { onDockedWidth?.(docked ? width : 0); }, [docked, width, onDockedWidth]);

  // Recents read every Page, whatever any tab is searching for.
  const { pages } = usePages(active || peek, "");
  const availableProjects = projects.filter((p) => visibleProjects === null || visibleProjects.includes(p.path));
  const recents = pages
    .filter((p) => !p.trashed && (visibleProjects === null || p.projectPaths.length === 0 || p.projectPaths.some((path) => visibleProjects.includes(path))))
    .sort((a, b) => b.modified.localeCompare(a.modified)).slice(0, 5);

  useEffect(() => {
    if (visibleProjects === null) return;
    for (const tab of state.tabs) {
      if (tab.view.project && !visibleProjects.includes(tab.view.project)) {
        editSpaceTabs((s) => updateSpaceView(s, tab.id, { project: null }));
      }
    }
  // Only a Profile change can hide a project a tab already points at.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleProjects?.join("\n")]);

  const navigate = (id: string, patch: Partial<SpaceView>) => {
    flush(id);
    editSpaceTabs((s) => navigateSpaceTab(s, id, patch));
  };
  const openTab = (target: PageTarget, title: string) =>
    editSpaceTabs((s) => openPageTab(s, { ...target, title }, newSpaceTabId()));
  const closeTab = (id: string) => {
    flush(id);
    flushers.current.delete(id);
    editSpaceTabs((s) => closeSpaceTab(s, id));
  };
  if (closeTabRef) closeTabRef.current = closeTab;
  const create = async (server: ServerId = view.project ? serverOfPath(view.project) : LOCAL) => {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createPage(server, view.project && serverOfPath(view.project) === server ? [view.project] : []);
      openTab({ id: created.id, server: created.server }, created.title);
    } catch (reason) { setCreateError(String(reason)); }
    finally { setCreating(false); }
  };
  const chooseSection = (section: Section, project: string | null = null) =>
    navigate(current.id, { section, project, filter: "all" });
  // A search belongs to the lit tab's list, so typing over a Page goes back to it.
  const changeQuery = (query: string) => {
    if (current.page) navigate(current.id, { query });
    else editSpaceTabs((s) => updateSpaceView(s, current.id, { query }));
  };
  const closeSearch = () => { if (view.query) changeQuery(""); setSearchOpen(false); };
  const nav = (action: () => void) => () => { onNavigate?.(); action(); };

  useEffect(() => {
    if (active && request && request.serial !== handledRequest.current) {
      handledRequest.current = request.serial;
      openTab(request.target, "Untitled");
    }
  // A request is consumed once; reopening Spaces keeps its own navigation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, request]);
  useEffect(() => {
    if (active && createSerial !== handledCreate.current) {
      handledCreate.current = createSerial;
      void create();
    }
  // A request is consumed once, like `request` above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, createSerial]);
  // Opens the sidebar too, as on Home: the field lives there.
  useHotkey("search", () => { onExpandSidebar?.(); setSearchOpen(true); search.current?.select(); }, { enabled: active, page: true });
  useHotkey("tab.close", () => {
    if (state.tabs.length > 1) closeTab(current.id);
    else if (current.page) navigate(current.id, {});
    else onClose();
  }, { enabled: active, page: true });

  const listCurrent = (match: boolean) => (!current.page && match ? "page" : undefined);
  const sidebar = (
      <aside className="spaces-sidebar">
        <button className="spaces-nav" onClick={nav(() => void create())} disabled={creating}><Plus />New Page<ShortcutKeys ids={["page.new"]} className="ml-auto" /></button>
        {searchOpen || view.query
          ? <div className="spaces-nav spaces-search-field group mb-3">
              <Search />
              <input ref={search} autoFocus={searchOpen} value={view.query} placeholder="Search" aria-label={view.section === "linear" ? "Search Linear documents" : "Search Pages"}
                onChange={(e) => changeQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key !== "Escape") return; e.preventDefault(); closeSearch(); }}
                onBlur={() => { if (!view.query) setSearchOpen(false); }} />
              {view.query && <Kbd className="hidden group-focus-within:inline-flex">Esc</Kbd>}
              <ShortcutKeys ids={["search"]} className="ml-auto group-focus-within:hidden" />
            </div>
          : <button className="spaces-nav mb-3" onClick={nav(() => { onExpandSidebar?.(); setSearchOpen(true); })}><Search />Search<ShortcutKeys ids={["search"]} className="ml-auto" /></button>}
        {SECTIONS.map(({ id, label, Icon }) => <button key={id} className="spaces-nav" aria-current={listCurrent(view.section === id && !view.project)} onClick={nav(() => chooseSection(id))}><Icon />{label}</button>)}
        <div className="spaces-section-label">Recents</div>
        {recents.map((recent) => <button key={pageKey(recent)} className="spaces-nav" aria-current={current.page && current.page.revision === undefined && pageKey(current.page) === pageKey(recent) ? "page" : undefined} onClick={nav(() => openTab({ id: recent.id, server: recent.server }, recent.title))}><FileText /><span className="truncate">{recent.title}</span></button>)}
        {recents.length === 0 && <p className="px-2 text-xs text-muted-foreground">Your recent Pages appear here.</p>}
        <div className="spaces-section-label">Projects</div>
        <div className="min-h-0 flex-1 overflow-auto">
          {availableProjects.map((p) => <button key={p.path} className="spaces-nav" aria-current={listCurrent(view.project === p.path)} onClick={nav(() => chooseSection("all", p.path))}><Folder /><span className="truncate">{projectLabel(p)}</span></button>)}
          {availableProjects.length === 0 && <p className="px-2 text-xs text-muted-foreground">Pages can stand on their own.</p>}
        </div>
        <button className="spaces-nav mt-5" aria-current={listCurrent(view.section === "trash")} onClick={nav(() => chooseSection("trash"))}><Trash2 />Trash</button>
      </aside>
  );

  const shell = typeof document === "undefined" ? null : document.querySelector<HTMLElement>(".app-shell");
  // Drawn in the shell, not in this page, so it floats over Home and Issues
  // too, from where Home's own card does: Spaces is hidden there.
  const card = !docked && <div className={cn("spaces-sidebar-float sidebar-floating absolute bottom-2.5 z-40 flex overflow-hidden rounded-[8px] border border-edge-surface bg-background shadow-(--shadow-surface)", SIDEBAR_TOKENS)}
    style={{ ...widthVar, left: RAIL_W + 2, top: "calc(var(--titlebar-h) + 0.125rem)" }}
    data-open={peek} aria-hidden={!peek} inert={!peek || undefined}
    onPointerEnter={() => peek && onPeekHover?.(true)} onPointerLeave={() => onPeekHover?.(false)}>{floating && sidebar}</div>;

  return <div className={cn("spaces-workspace", !active && "hidden")} style={widthVar}>
    <div className="spaces-body">
      <div className="spaces-sidebar-frame" data-open={!sidebarCollapsed} data-motion={motion} inert={sidebarCollapsed || undefined}>{!floating && sidebar}{docked && handle}</div>
      <main className="spaces-main">
        {createError && <div role="alert" className="spaces-error mt-4">{createError}<button onClick={() => setCreateError(null)}>Dismiss</button></div>}
        {state.tabs.map((tab) => {
          if (!seen.current.has(tab.id)) return null;
          const shown = tab.id === state.active;
          const page = tab.page;
          return <div key={page ? `${tab.id}:${pageKey(page)}:${page.revision ?? ""}` : `${tab.id}:list`} className={cn("min-h-0 min-w-0 flex-1 flex-col", shown ? "flex" : "hidden")}>
            {page
              ? <PageTabBody page={page} shown={shown} active={active} projects={availableProjects} visibleProjects={visibleProjects}
                  onTitle={(title) => editSpaceTabs((s) => setPageTabTitle(s, page, title))}
                  onFlushReady={(fn) => { flushers.current.set(tab.id, fn); }}
                  onTrashed={() => closeTab(tab.id)}
                  onHidden={() => navigate(tab.id, {})}
                  onOpenCurrent={openTab} />
              : <ListTabBody tab={tab} shown={shown} active={active} projects={projects} visibleProjects={visibleProjects} creating={creating}
                  onView={(patch) => editSpaceTabs((s) => updateSpaceView(s, tab.id, patch))}
                  onOpen={openTab} onCreate={(server) => void create(server)} onImport={() => setImportOpen(true)} />}
          </div>;
        })}
      </main>
    </div>
    {card && (shell ? createPortal(card, shell) : card)}
    <LinearImportDialog open={importOpen} onOpenChange={setImportOpen} server={view.project ? serverOfPath(view.project) : LOCAL}
      projectPaths={view.project ? ownerProjects([view.project], serverOfPath(view.project)) : []}
      onImported={(imported) => {
        const document = locatePage(imported, view.project ? serverOfPath(view.project) : LOCAL);
        openTab({ id: document.id, server: document.server }, document.title);
      }} />
  </div>;
}

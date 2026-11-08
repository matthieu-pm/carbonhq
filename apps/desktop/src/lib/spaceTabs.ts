/// The Spaces page's tab strip. Every tab carries a list view — section,
/// filter, project, search, layout — and may show one Page over it, so a
/// sidebar click navigates the lit tab the way a browser's link does, and a new
/// tab starts on All with nothing shared. Persisted, so a restart puts the strip
/// back as it was.
///
/// A module store rather than state in `App`, for `issueTabs`' reason: the
/// header strip and the page body both read it.
import { useSyncExternalStore } from "react";

import { channel } from "@/lib/channel";
import { readLocalStorage, writeLocalStorage } from "@/hooks/useLocalStorage";
import type { ServerId } from "@/lib/transport";

export const SECTION_IDS = ["all", "pages", "slides", "images", "drive", "linear", "trash"] as const;
export type Section = (typeof SECTION_IDS)[number];
const FILTER_IDS = ["all", "favorites", "recent"] as const;
export type Filter = (typeof FILTER_IDS)[number];

export type SpaceView = {
  section: Section;
  filter: Filter;
  /// A project path narrowing the list, `null` for every Page.
  project: string | null;
  query: string;
  grid: boolean;
};

/// A Page shown in a tab. `title` is stored so a restored tab is named before
/// its document has been read back; `revision` pins a cited snapshot.
export type TabPage = { id: string; server: ServerId; revision?: number; title: string };

export type SpaceTab = { id: string; view: SpaceView; page: TabPage | null };

export type SpaceTabsState = { tabs: SpaceTab[]; active: string };

const KEY = "ade.spaceTabs";

export const FRESH_VIEW: SpaceView = { section: "all", filter: "all", project: null, query: "", grid: false };

let counter = 0;
/// Unique within a run and across restarts, since restored ids sit beside new ones.
export const newSpaceTabId = () => `tab:${Date.now().toString(36)}:${(counter++).toString(36)}`;

export const initialSpaceTabs = (): SpaceTabsState => ({
  tabs: [{ id: "tab:main", view: FRESH_VIEW, page: null }],
  active: "tab:main",
});

const samePage = (a: TabPage, b: Omit<TabPage, "title">) =>
  a.id === b.id && a.server === b.server && a.revision === b.revision;

export function activeSpaceTab(state: SpaceTabsState): SpaceTab {
  return state.tabs.find((t) => t.id === state.active) ?? state.tabs[0];
}

export function addSpaceTab(state: SpaceTabsState, id: string): SpaceTabsState {
  return { tabs: [...state.tabs, { id, view: FRESH_VIEW, page: null }], active: id };
}

/// Opens a Page in its own tab beside the lit one, or moves to the tab already
/// showing it — one tab per document, since two editors on one draft would
/// race each other's saves. The new tab keeps the view it was opened from, so
/// navigating it back to a list lands where the reader was.
export function openPageTab(state: SpaceTabsState, page: TabPage, id: string): SpaceTabsState {
  const open = state.tabs.find((t) => t.page && samePage(t.page, page));
  if (open) return { ...state, active: open.id };
  const at = state.tabs.findIndex((t) => t.id === state.active);
  const from = state.tabs[at];
  const tabs = [...state.tabs];
  tabs.splice(at + 1, 0, { id, view: from?.view ?? FRESH_VIEW, page });
  return { tabs, active: id };
}

/// Points a tab at a list, dropping any Page it showed.
export function navigateSpaceTab(state: SpaceTabsState, id: string, patch: Partial<SpaceView>): SpaceTabsState {
  return {
    ...state,
    tabs: state.tabs.map((t) => (t.id === id ? { ...t, view: { ...t.view, ...patch }, page: null } : t)),
  };
}

/// Changes a tab's view without leaving the Page it shows, if any.
export function updateSpaceView(state: SpaceTabsState, id: string, patch: Partial<SpaceView>): SpaceTabsState {
  let changed = false;
  const tabs = state.tabs.map((t) => {
    if (t.id !== id) return t;
    const view = { ...t.view, ...patch };
    if ((Object.keys(view) as (keyof SpaceView)[]).every((k) => view[k] === t.view[k])) return t;
    changed = true;
    return { ...t, view };
  });
  return changed ? { ...state, tabs } : state;
}

/// Renames every tab showing this Page, after a load or a saved title edit.
export function setPageTabTitle(state: SpaceTabsState, page: Omit<TabPage, "title" | "revision">, title: string): SpaceTabsState {
  let changed = false;
  const tabs = state.tabs.map((t) => {
    if (!t.page || t.page.id !== page.id || t.page.server !== page.server || t.page.title === title) return t;
    changed = true;
    return { ...t, page: { ...t.page, title } };
  });
  return changed ? { ...state, tabs } : state;
}

/// Closing the lit tab moves to its right-hand neighbour, else its left. The
/// strip never empties: closing the last tab puts back a fresh All.
export function closeSpaceTab(state: SpaceTabsState, id: string): SpaceTabsState {
  const at = state.tabs.findIndex((t) => t.id === id);
  if (at === -1) return state;
  const tabs = state.tabs.filter((t) => t.id !== id);
  if (!tabs.length) return initialSpaceTabs();
  if (state.active !== id) return { ...state, tabs };
  return { tabs, active: (tabs[at] ?? tabs[at - 1]).id };
}

export function activateSpaceTab(state: SpaceTabsState, id: string): SpaceTabsState {
  return state.tabs.some((t) => t.id === id) && state.active !== id ? { ...state, active: id } : state;
}

export function moveSpaceTab(state: SpaceTabsState, id: string, to: number): SpaceTabsState {
  const from = state.tabs.findIndex((t) => t.id === id);
  if (from === -1) return state;
  const tabs = [...state.tabs];
  const [tab] = tabs.splice(from, 1);
  tabs.splice(Math.max(0, Math.min(to, tabs.length)), 0, tab);
  return { ...state, tabs };
}

function coerceView(raw: unknown): SpaceView {
  if (!raw || typeof raw !== "object") return FRESH_VIEW;
  const v = raw as Record<string, unknown>;
  return {
    section: SECTION_IDS.includes(v.section as Section) ? (v.section as Section) : "all",
    filter: FILTER_IDS.includes(v.filter as Filter) ? (v.filter as Filter) : "all",
    project: typeof v.project === "string" ? v.project : null,
    query: typeof v.query === "string" ? v.query : "",
    grid: v.grid === true,
  };
}

/// Reads whatever a previous build wrote, keeping only tabs this one can draw.
/// A bad entry costs that tab, never the strip.
export function coerceSpaceTabs(raw: unknown): SpaceTabsState {
  if (!raw || typeof raw !== "object") return initialSpaceTabs();
  const { tabs, active } = raw as { tabs?: unknown; active?: unknown };
  if (!Array.isArray(tabs)) return initialSpaceTabs();
  const seen = new Set<string>();
  const kept: SpaceTab[] = [];
  for (const t of tabs) {
    if (!t || typeof t !== "object" || typeof t.id !== "string" || seen.has(t.id)) continue;
    const p = t.page;
    const page: TabPage | null = p && typeof p === "object" && typeof p.id === "string" && typeof p.server === "string"
      ? { id: p.id, server: p.server, title: typeof p.title === "string" ? p.title : "Untitled", ...(typeof p.revision === "number" ? { revision: p.revision } : {}) }
      : null;
    kept.push({ id: t.id, view: coerceView(t.view), page });
    seen.add(t.id);
  }
  if (!kept.length) return initialSpaceTabs();
  return { tabs: kept, active: kept.some((t) => t.id === active) ? (active as string) : kept[0].id };
}

const changed = channel<void>();
let current: SpaceTabsState | null = null;

function read(): SpaceTabsState {
  current ??= coerceSpaceTabs(readLocalStorage<unknown>(KEY, null));
  return current;
}

/// Applies one of the rules above to the stored strip.
export function editSpaceTabs(edit: (state: SpaceTabsState) => SpaceTabsState): void {
  const next = edit(read());
  if (next === current) return;
  current = next;
  writeLocalStorage(KEY, next);
  changed.emit();
}

export function useSpaceTabs(): SpaceTabsState {
  return useSyncExternalStore(changed.subscribe, read);
}

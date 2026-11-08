/// The issues page's tab strip: list tabs, each its own query, and issue tabs,
/// each one issue drawn full width. Persisted, so a restart puts the strip back
/// as it was.
///
/// A module store rather than state in `App`, for `issueTracker`'s reason: the
/// header strip, the page body and the pane's full-view button all read it.
import { useSyncExternalStore } from "react";

import { channel } from "@/lib/channel";
import { readLocalStorage, writeLocalStorage } from "@/hooks/useLocalStorage";
import { readIssueTracker } from "@/lib/issueTracker";
import type { IssueFilters, IssueQuery, IssueRef, IssueTracker } from "@/types/events";

export type ListTab = {
  kind: "list";
  id: string;
  /// The reader's own name for it, which outranks `label`.
  name: string | null;
  /// Derived from the query, and stored so a restored tab is named before its
  /// filter options have been read back.
  label: string;
  /// `null` until the list reports one — a fresh tab starts on defaults.
  query: IssueQuery | null;
  /// Its own Linear/GitHub pick, so flipping one list leaves the others.
  tracker: IssueTracker;
};

export type IssueTab = { kind: "issue"; id: string; ref: IssueRef };

export type AnyIssueTab = ListTab | IssueTab;

export type IssueTabsState = { tabs: AnyIssueTab[]; active: string };

const KEY = "ade.issueTabs";
const TRACKERS: unknown[] = ["linear", "github"];
const DEFAULT_LABEL = "My issues";

export const issueTabId = (ref: IssueRef) => `issue:${ref.tracker}:${ref.id}`;

const listTab = (id: string, tracker: IssueTracker): ListTab => ({
  kind: "list",
  id,
  name: null,
  label: DEFAULT_LABEL,
  query: null,
  tracker,
});

export const initialIssueTabs = (tracker: IssueTracker = "linear"): IssueTabsState => ({
  tabs: [listTab("list:main", tracker)],
  active: "list:main",
});

/// What a tab's label says: its own name, else what its filters say, else the
/// issue it shows.
export function tabTitle(tab: AnyIssueTab): string {
  if (tab.kind === "issue") return `${tab.ref.identifier} ${tab.ref.title}`;
  return tab.name || tab.label;
}

export function addListTab(state: IssueTabsState, id: string, tracker: IssueTracker): IssueTabsState {
  return { tabs: [...state.tabs, listTab(id, tracker)], active: id };
}

/// Opens an issue in its own tab, or moves to the tab it already has. A new
/// tab lands beside the one it was opened from, as a browser's link does.
export function openIssueTab(state: IssueTabsState, ref: IssueRef): IssueTabsState {
  const id = issueTabId(ref);
  if (state.tabs.some((t) => t.id === id)) return { ...state, active: id };
  const at = state.tabs.findIndex((t) => t.id === state.active);
  const tabs = [...state.tabs];
  tabs.splice(at + 1, 0, { kind: "issue", id, ref });
  return { tabs, active: id };
}

/// Closing the lit tab moves to its right-hand neighbour, else its left. The
/// strip never empties: closing the last tab puts back a fresh list.
export function closeIssueTab(state: IssueTabsState, id: string): IssueTabsState {
  const at = state.tabs.findIndex((t) => t.id === id);
  if (at === -1) return state;
  const tabs = state.tabs.filter((t) => t.id !== id);
  if (!tabs.length) {
    const closed = state.tabs[at];
    return initialIssueTabs(closed.kind === "list" ? closed.tracker : closed.ref.tracker);
  }
  if (state.active !== id) return { ...state, tabs };
  return { tabs, active: (tabs[at] ?? tabs[at - 1]).id };
}

export function activateIssueTab(state: IssueTabsState, id: string): IssueTabsState {
  return state.tabs.some((t) => t.id === id) ? { ...state, active: id } : state;
}

export function moveIssueTab(state: IssueTabsState, id: string, to: number): IssueTabsState {
  const from = state.tabs.findIndex((t) => t.id === id);
  if (from === -1) return state;
  const tabs = [...state.tabs];
  const [tab] = tabs.splice(from, 1);
  tabs.splice(Math.max(0, Math.min(to, tabs.length)), 0, tab);
  return { ...state, tabs };
}

export function updateListTab(
  state: IssueTabsState,
  id: string,
  patch: Partial<Pick<ListTab, "name" | "label" | "query" | "tracker">>,
): IssueTabsState {
  let changed = false;
  const tabs = state.tabs.map((t) => {
    if (t.id !== id || t.kind !== "list") return t;
    const next = { ...t, ...patch };
    if (next.name === t.name && next.label === t.label && next.query === t.query && next.tracker === t.tracker) {
      return t;
    }
    changed = true;
    return next;
  });
  return changed ? { ...state, tabs } : state;
}

const SCOPES: Record<IssueQuery["scope"], string> = {
  assigned: "My issues",
  created: "Created by me",
  all: "All issues",
};

/// Names a list by what narrows it: whose issues, then team or repository,
/// project, label, type, closed, and a search — `All issues · DRA · “login”`.
/// An option whose name has not been read yet is left out rather than drawn
/// as its id.
export function listTabLabel(query: IssueQuery, filters: IssueFilters | null): string {
  const parts = [SCOPES[query.scope] ?? DEFAULT_LABEL];
  if (query.teamId) {
    parts.push(
      query.tracker === "github"
        ? query.teamId.split("/").pop() || query.teamId
        : (filters?.teams.find((t) => t.id === query.teamId)?.name ?? ""),
    );
  }
  if (query.projectId) parts.push(filters?.projects.find((p) => p.id === query.projectId)?.name ?? "");
  if (query.label) parts.push(query.label);
  if (query.issueType) parts.push(query.issueType);
  if (query.settled && query.tracker === "github") parts.push("Closed");
  const text = query.text?.trim();
  if (text) parts.push(`“${text}”`);
  return parts.filter(Boolean).join(" · ");
}

/// Reads whatever a previous build wrote, keeping only tabs this one can
/// draw. Local storage can hold anything, and a bad entry must cost that tab,
/// never the strip.
export function coerceIssueTabs(raw: unknown, fallback: IssueTracker = "linear"): IssueTabsState {
  if (!raw || typeof raw !== "object") return initialIssueTabs(fallback);
  const { tabs, active } = raw as { tabs?: unknown; active?: unknown };
  if (!Array.isArray(tabs)) return initialIssueTabs(fallback);
  const seen = new Set<string>();
  const kept: AnyIssueTab[] = [];
  for (const t of tabs) {
    if (!t || typeof t !== "object" || typeof t.id !== "string" || seen.has(t.id)) continue;
    if (t.kind === "list") {
      const query = t.query && typeof t.query === "object" && typeof t.query.tracker === "string" ? t.query : null;
      kept.push({
        kind: "list",
        id: t.id,
        name: typeof t.name === "string" && t.name ? t.name : null,
        label: typeof t.label === "string" && t.label ? t.label : DEFAULT_LABEL,
        query,
        // A tab saved before trackers were per tab follows its saved query.
        tracker: TRACKERS.includes(t.tracker) ? t.tracker : (query?.tracker ?? fallback),
      });
    } else if (t.kind === "issue" && t.ref && typeof t.ref.id === "string" && typeof t.ref.identifier === "string") {
      kept.push({ kind: "issue", id: t.id, ref: t.ref });
    } else continue;
    seen.add(t.id);
  }
  if (!kept.length) return initialIssueTabs(fallback);
  return { tabs: kept, active: kept.some((t) => t.id === active) ? (active as string) : kept[0].id };
}

const changed = channel<void>();
let current: IssueTabsState | null = null;

function read(): IssueTabsState {
  current ??= coerceIssueTabs(readLocalStorage<unknown>(KEY, null), readIssueTracker());
  return current;
}

/// Applies one of the rules above to the stored strip.
export function editIssueTabs(edit: (state: IssueTabsState) => IssueTabsState): void {
  const next = edit(read());
  if (next === current) return;
  current = next;
  writeLocalStorage(KEY, next);
  changed.emit();
}

export function useIssueTabs(): IssueTabsState {
  return useSyncExternalStore(changed.subscribe, read);
}

let listSerial = 0;
/// A fresh id for a list tab, unique within this run and across restarts.
export const newListTabId = () => `list:${Date.now().toString(36)}${(listSerial++).toString(36)}`;

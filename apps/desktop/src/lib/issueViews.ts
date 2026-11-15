import { useSyncExternalStore } from "react";

import { readLocalStorage, writeLocalStorage } from "@/hooks/useLocalStorage";
import { channel } from "@/lib/channel";
import { addListTab, newListTabId, updateListTab, type IssueTabsState } from "@/lib/issueTabs";
import type { IssueQuery } from "@/types/events";

export type SavedIssueView = { id: string; name: string; query: IssueQuery };
const KEY = "ade.issueViews";
const changed = channel<void>();
let current: SavedIssueView[] | null = null;

export function coerceIssueQuery(raw: unknown): IssueQuery | null {
  if (!raw || typeof raw !== "object") return null;
  const q = raw as Record<string, unknown>;
  if (q.tracker !== "linear" && q.tracker !== "github") return null;
  if (!["assigned", "created", "all"].includes(q.scope as string)) return null;
  const text = (key: string) => typeof q[key] === "string" ? q[key] as string : null;
  return { tracker: q.tracker, scope: q.scope as IssueQuery["scope"], text: text("text"),
    teamId: text("teamId"), projectId: text("projectId"), label: text("label"),
    issueType: text("issueType"), settled: q.settled === true };
}

export function coerceIssueViews(raw: unknown): SavedIssueView[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const query = coerceIssueQuery(value.query);
    if (!query || typeof value.id !== "string" || !value.id || seen.has(value.id) || typeof value.name !== "string" || !value.name.trim()) return [];
    seen.add(value.id);
    return [{ id: value.id, name: value.name.trim().slice(0, 80), query }];
  });
}

function read(): SavedIssueView[] {
  return current ??= coerceIssueViews(readLocalStorage(KEY, []));
}

export function editIssueViews(edit: (views: SavedIssueView[]) => SavedIssueView[]): void {
  current = edit(read());
  writeLocalStorage(KEY, current);
  changed.emit();
}

export function useIssueViews(): SavedIssueView[] {
  return useSyncExternalStore(changed.subscribe, read);
}

export function matchesIssueView(view: SavedIssueView, query: IssueQuery | null): boolean {
  return JSON.stringify(coerceIssueQuery(view.query)) === JSON.stringify(coerceIssueQuery(query));
}

/// Reuses a list when an individual issue is up; creates one only if no list remains.
export function applyIssueView(state: IssueTabsState, view: SavedIssueView): IssueTabsState {
  const tab = state.tabs.find((t) => t.id === state.active && t.kind === "list")
    ?? state.tabs.find((t) => t.kind === "list");
  const base = tab ? { ...state, active: tab.id } : addListTab(state, newListTabId(), view.query.tracker);
  return updateListTab(base, base.active, { query: { ...view.query }, tracker: view.query.tracker });
}

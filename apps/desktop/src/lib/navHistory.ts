/// Back and forward over where the reader has been: the new task page, a
/// session, Issues, Spaces and Settings. A browser's history, minus the URL.

import type { SettingsTab } from "@/components/SettingsPage";

type PagePlace = { page: "tasks" | "issues" | "spaces"; sessionId: string | null };
export type Place = PagePlace | { page: "settings"; tab: SettingsTab; returnTo: PagePlace };

export type NavHistory = { stack: Place[]; index: number };

/// How far back history reaches. Older entries fall off the bottom.
const DEPTH = 50;

/// What makes two places one. Issues and Spaces keep whichever session was
/// selected under them, so it says nothing about where the reader is.
export const placeKey = (place: Place) =>
  place.page === "settings" ? `settings:${place.tab}`
    : place.page === "tasks" ? `tasks:${place.sessionId ?? ""}` : place.page;

/// Arriving somewhere new drops whatever was ahead, as a browser does.
export function visit(history: NavHistory, place: Place): NavHistory {
  const here = history.stack[history.index];
  if (here && placeKey(here) === placeKey(place)) return history;
  const stack = [...history.stack.slice(0, history.index + 1), place].slice(-DEPTH);
  return { stack, index: stack.length - 1 };
}

/// The nearest place `delta`'s way that can still be shown — a deleted
/// session is stepped over rather than landed on. `null` where none is.
export function step(
  history: NavHistory,
  delta: -1 | 1,
  usable: (place: Place) => boolean,
): { history: NavHistory; place: Place } | null {
  const here = history.stack[history.index];
  for (let i = history.index + delta; i >= 0 && i < history.stack.length; i += delta) {
    const place = history.stack[i];
    if (here && placeKey(place) === placeKey(here)) continue;
    if (usable(place)) return { history: { ...history, index: i }, place };
  }
  return null;
}

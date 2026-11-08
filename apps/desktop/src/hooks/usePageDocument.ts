import { useEffect, useSyncExternalStore } from "react";
import { listen } from "@/lib/transport";
import { pageKey, readPage, updatePage, type LocatedPage, type Page, type PageTarget } from "@/lib/pages";

export type PageDraft = {
  base: LocatedPage<Page>;
  title: string;
  markdown: string;
  projectPaths: string[];
  favorite: boolean;
  saving: boolean;
  pending: boolean;
  dirty: boolean;
  error: string | null;
  conflict: boolean;
};
type Entry = { state: PageDraft; listeners: Set<() => void>; timer?: ReturnType<typeof setTimeout>; flight?: Promise<void>; refreshAfterSave?: boolean };
const documents = new Map<string, Entry>();
const STORAGE = "ade.pageDraft.";

/// Prepares a document before navigation, including any locally recovered draft.
export function openPageDraft(page: LocatedPage<Page>): PageDraft { return entryFor(page).state; }

function clean(page: LocatedPage<Page>): PageDraft {
  return { base: page, title: page.title, markdown: page.markdown, projectPaths: page.projectPaths, favorite: page.favorite, saving: false, pending: false, dirty: false, error: null, conflict: false };
}

function entryFor(page: LocatedPage<Page>): Entry {
  const key = pageKey(page);
  const existing = documents.get(key);
  if (existing) return existing;
  let state = clean(page);
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE + key) ?? "null") as PageDraft | null;
    if (saved?.base && pageKey(saved.base) === key && typeof saved.markdown === "string" && typeof saved.title === "string" && Array.isArray(saved.projectPaths)) {
      state = { ...saved, saving: false, pending: false, dirty: true, error: saved.base.revision !== page.revision ? "The saved Page changed while this draft was closed." : null, conflict: saved.base.revision !== page.revision };
    }
  } catch { /* A draft remains usable when browser storage is unavailable. */ }
  const entry: Entry = { state, listeners: new Set() };
  documents.set(key, entry);
  return entry;
}

function persist(state: PageDraft) {
  try {
    const key = STORAGE + pageKey(state.base);
    if (state.dirty) localStorage.setItem(key, JSON.stringify(state));
    else localStorage.removeItem(key);
  } catch { /* The server remains authoritative when local draft storage is full. */ }
}

function publish(entry: Entry, changes: Partial<PageDraft>) {
  const next = { ...entry.state, ...changes };
  next.dirty = next.pending || next.title !== next.base.title || next.markdown !== next.base.markdown ||
    next.favorite !== next.base.favorite || [...next.projectPaths].sort().join("\n") !== [...next.base.projectPaths].sort().join("\n");
  entry.state = next;
  for (const listener of entry.listeners) listener();
}

/// An accepted save only normalizes fields that have not changed since submission.
export function acceptPageSave(current: PageDraft, submitted: PageDraft, saved: LocatedPage<Page>): Partial<PageDraft> {
  return {
    base: saved,
    title: current.title === submitted.title ? saved.title : current.title,
    markdown: current.markdown === submitted.markdown ? saved.markdown : current.markdown,
    projectPaths: current.projectPaths === submitted.projectPaths ? saved.projectPaths : current.projectPaths,
    favorite: current.favorite === submitted.favorite ? saved.favorite : current.favorite,
    saving: false, error: null, conflict: false,
  };
}

/// A live rich edit protects its draft before Markdown serialization has run.
export function markPageDraftPending(target: PageTarget) {
  const entry = documents.get(pageKey(target));
  if (entry) publish(entry, { pending: true });
}

/// The timer belongs to the document, so navigation cannot cancel an autosave.
export function editPageDraft(target: PageTarget, changes: Partial<Pick<PageDraft, "title" | "markdown" | "projectPaths" | "favorite">>) {
  const entry = documents.get(pageKey(target));
  if (!entry) return;
  publish(entry, { ...changes, ...(changes.markdown !== undefined ? { pending: false } : {}) });
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    persist(entry.state);
    if (!entry.state.conflict) void savePageDraft(target);
  }, 700);
}

/// Writes through one queue per Page; later keystrokes remain a separate draft.
export async function savePageDraft(target: PageTarget): Promise<void> {
  const entry = documents.get(pageKey(target));
  if (!entry) return;
  clearTimeout(entry.timer);
  if (entry.flight) { await entry.flight; if (!entry.state.error) await savePageDraft(target); return; }
  if (entry.state.pending || !entry.state.dirty || entry.state.conflict || entry.state.base.trashed) return;
  const submitted = entry.state;
  persist(submitted);
  publish(entry, { saving: true, error: null });
  const flight = (async () => {
    try {
      const saved = await updatePage(submitted.base, {
        title: submitted.title.trim() || "Untitled", markdown: submitted.markdown,
        projectPaths: submitted.projectPaths, favorite: submitted.favorite,
      });
      publish(entry, acceptPageSave(entry.state, submitted, saved));
    } catch (reason) {
      const error = String(reason);
      publish(entry, { saving: false, error, conflict: /conflict/i.test(error) });
    } finally {
      entry.flight = undefined;
      persist(entry.state);
      if (entry.refreshAfterSave) { entry.refreshAfterSave = false; void refreshPageDraft(target); }
      if (entry.state.dirty && !entry.state.error) entry.timer = setTimeout(() => void savePageDraft(target), 100);
    }
  })();
  entry.flight = flight;
  await flight;
}

/// External revisions replace a clean editor and flag a dirty one without changing its base.
export async function refreshPageDraft(target: PageTarget) {
  const entry = documents.get(pageKey(target));
  if (!entry) return;
  if (entry.flight) { entry.refreshAfterSave = true; return; }
  try {
    const remote = await readPage(target);
    if (entry.flight || remote.revision <= entry.state.base.revision) return;
    if (entry.state.dirty) publish(entry, { conflict: true, error: "This Page changed elsewhere. Your draft is kept." });
    else publish(entry, clean(remote));
  } catch (reason) { publish(entry, { error: String(reason) }); }
}

/// Resolution is explicit; saving the draft still compares against the freshly read revision.
export async function resolvePageDraft(target: PageTarget, choice: "saved" | "draft", reviewedRevision?: number) {
  const entry = documents.get(pageKey(target));
  if (!entry) return;
  try {
    const remote = await readPage(target);
    if (choice === "saved") publish(entry, clean(remote));
    else {
      if (remote.revision !== reviewedRevision) {
        publish(entry, { conflict: true, error: "The saved Page changed again. Review the latest version before saving your draft." });
        return;
      }
      publish(entry, { base: remote, conflict: false, error: null });
      await savePageDraft(target);
    }
    persist(entry.state);
  } catch (reason) { publish(entry, { error: String(reason) }); }
}

export function pageDraft(target: PageTarget): PageDraft | undefined { return documents.get(pageKey(target))?.state; }

/// Flushes rich-editor text before its owner navigates or the browser closes.
export function persistPageDraft(target: PageTarget) {
  const state = pageDraft(target);
  if (state) persist(state);
}

/// UI and agents share revisions; reconnects catch changes missed while offline.
export function usePageDocument(page: LocatedPage<Page>, active: boolean) {
  const entry = entryFor(page);
  const state = useSyncExternalStore((listener) => {
    entry.listeners.add(listener);
    return () => { entry.listeners.delete(listener); };
  }, () => entry.state);
  const key = pageKey(page);
  useEffect(() => {
    if (!active) return;
    void refreshPageDraft(page);
    const off = listen<{ id: string }>("pages_changed", ({ payload, server }) => {
      if (server === page.server && payload.id === page.id) void refreshPageDraft(page);
    });
    const reconnect = listen("live_state", ({ server }) => { if (server === page.server) void refreshPageDraft(page); });
    return () => { void off.then((fn) => fn()); void reconnect.then((fn) => fn()); };
  // A Page's stable identity selects its queue, independently of local keystrokes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active]);
  return state;
}

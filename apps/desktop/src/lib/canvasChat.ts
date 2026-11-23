import type { SessionIndexItem } from "@/types/events";
import { createContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { channel } from "./channel";
import { readLocalStorage, writeLocalStorage } from "@/hooks/useLocalStorage";
import { invoke, serverOfPath } from "./transport";
import { canvasKey, type CanvasFile } from "./canvasFile";

export type CanvasChatTab = { id: string; draft: boolean };
type Dock = { open: boolean; active: string; tabs: CanvasChatTab[] };
const storageKey = "carbon.canvas.conversations";
const docks = readLocalStorage<Record<string, Dock>>(storageKey, {});
const changed = channel<void>();

function dockFor(key: string): Dock {
  const stored = docks[key];
  if (stored) return stored;
  const id = crypto.randomUUID();
  const dock = { open: false, active: id, tabs: [{ id, draft: true }] };
  docks[key] = dock;
  return dock;
}

function update(key: string, apply: (dock: Dock) => Dock) {
  docks[key] = apply(dockFor(key));
  writeLocalStorage(storageKey, docks);
  changed.emit();
}

export function moveCanvasChat(from: string, to: string) {
  if (!docks[from] || from === to) return;
  docks[to] = docks[from];
  delete docks[from];
  writeLocalStorage(storageKey, docks);
  changed.emit();
}

export function replaceDeletedCanvasChat(key: string, deletedId: string): string {
  const dock = docks[key];
  if (dock?.tabs[0]?.id !== deletedId) throw Error("This conversation is no longer available.");
  const id = crypto.randomUUID();
  update(key, d => ({
    ...d,
    active: d.active === deletedId ? id : d.active,
    tabs: [{ id, draft: true }, ...d.tabs.slice(1)],
  }));
  return id;
}

export function useCanvasChat(key: string | null) {
  const dock = useSyncExternalStore(changed.subscribe, () => (key ? dockFor(key) : null));
  if (!key || !dock) return null;
  return {
    ...dock,
    setOpen: (open: boolean) => update(key, (d) => ({ ...d, open })),
    select: (id: string) => update(key, (d) => ({ ...d, active: id })),
    add: (id: string, draft: boolean) =>
      update(key, (d) => ({
        ...d,
        open: true,
        active: id,
        tabs: d.tabs.some((t) => t.id === id) ? d.tabs : [...d.tabs, { id, draft }],
      })),
    close: (id: string) =>
      update(key, (d) => {
        if (id === d.tabs[0].id) return d;
        const tabs = d.tabs.filter((t) => t.id !== id);
        return { ...d, tabs, active: d.active === id ? tabs[0].id : d.active };
      }),
    sent: (id: string) =>
      update(key, (d) => ({ ...d, tabs: d.tabs.map((t) => (t.id === id ? { id, draft: false } : t)) })),
  };
}
export type CanvasChatDock = NonNullable<ReturnType<typeof useCanvasChat>>;

export const CanvasCommentTarget = createContext<{
  title: string;
  send: (text: string, image: () => Promise<string>) => Promise<void>;
} | null>(null);

export function tabTitle(tab: CanvasChatTab, dock: CanvasChatDock, items: SessionIndexItem[]) {
  if (tab.id === dock.tabs[0].id) return "Canvas chat";
  return (
    items.find((i) => i.sessionId === tab.id)?.title ?? (tab.draft ? "New conversation" : "Conversation")
  );
}

/// The draft and attachment key for the dock's active conversation. The first
/// tab keys on the canvas rather than its id, since a deleted first conversation
/// is replaced by a fresh id and the half-written prompt must survive that.
export function canvasDraftKey(file: CanvasFile, dock: Pick<CanvasChatDock, "active" | "tabs">) {
  return "canvas-chat:" + (dock.active === dock.tabs[0].id ? canvasKey(file) : dock.active);
}

/// The floating composer, drawn by `App` and placed by the editor inside its
/// stage, so it sits on the canvas it talks about rather than beside it.
export const CanvasComposerSlot = createContext<ReactNode>(null);

/// The project's conversations that a dock could open, read while `open`.
export function useCanvasConversationChoices(project: string, open: boolean) {
  const [choices, setChoices] = useState<SessionIndexItem[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let current = true;
    setError("");
    setChoices(null);
    void invoke<SessionIndexItem[]>("list_session_index_items", { archived: false }, serverOfPath(project))
      .then((all) => {
        if (current) setChoices(all.filter((i) => i.projectPath === project && !i.hidden));
      })
      .catch((e) => {
        if (current) setError(String(e));
      });
    return () => {
      current = false;
    };
  }, [project, open]);
  return { choices, error };
}

let canvasInput: HTMLTextAreaElement | null = null;

/// Called by the floating composer's text box; `null` on unmount.
export function registerCanvasComposer(el: HTMLTextAreaElement | null) {
  canvasInput = el;
}

/// Hands focus back to the floating composer after dictation lands in it.
export function focusCanvasComposer() {
  canvasInput?.focus();
}

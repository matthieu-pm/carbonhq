import type { SessionIndexItem } from "@/types/events";
import { createContext, useSyncExternalStore } from "react";
import { channel } from "./channel";
import { readLocalStorage, writeLocalStorage } from "@/hooks/useLocalStorage";

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

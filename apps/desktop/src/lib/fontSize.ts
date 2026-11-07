import { useSyncExternalStore } from "react";

import { readLocalStorage, writeLocalStorage } from "@/hooks/useLocalStorage";
import { channel } from "@/lib/channel";

export const FONT_SIZES_KEY = "ade.fontSizes";
export const FONT_MIN = 10;
export const FONT_MAX = 24;

/// The two sizes the reader sets, in px since px is what they compare against
/// their editor. Defaults are App.css's rem values at a 16px root.
export const FONT_SLOTS = [
  { id: "ui", label: "UI font size", description: "Chat, composer, sidebar and panels.", px: 13 },
  { id: "code", label: "Code font size", description: "Code blocks, tool output, diffs and the Files view.", px: 14 },
] as const;

export type FontSlot = (typeof FONT_SLOTS)[number]["id"];
export type FontSizes = Record<FontSlot, number>;

export const DEFAULT_FONT_SIZES = Object.fromEntries(
  FONT_SLOTS.map((s) => [s.id, s.px]),
) as FontSizes;

/// Clamps and rounds what it knows and drops the rest. Slots `ade.fontSizes`
/// held before #295 (`chat`, `prompt`) are ignored, so an old pick of those
/// does not come back as a UI size nobody chose.
export function coerceFontSizes(value: unknown): FontSizes {
  const out = { ...DEFAULT_FONT_SIZES };
  if (!value || typeof value !== "object") return out;
  for (const { id } of FONT_SLOTS) {
    const px = (value as Record<string, unknown>)[id];
    if (typeof px === "number" && Number.isFinite(px)) {
      out[id] = Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(px)));
    }
  }
  return out;
}

export function isDefaultFontSizes(sizes: FontSizes): boolean {
  return FONT_SLOTS.every(({ id }) => sizes[id] === DEFAULT_FONT_SIZES[id]);
}

/// The diff library's own size, one px under `text-code` as it is by default
/// (13 against 14), with its 20px row kept in proportion. The Files view's
/// virtualizer is told the same row height, since it places rows by that
/// number rather than by measuring them.
export function diffMetrics(code: number): { fontSize: number; lineHeight: number } {
  const fontSize = code - 1;
  return { fontSize, lineHeight: Math.round((fontSize * 20) / 13) };
}

function apply(sizes: FontSizes) {
  const style = document.documentElement.style;
  const { fontSize, lineHeight } = diffMetrics(sizes.code);
  style.setProperty("--fs-ui", `${sizes.ui}px`);
  style.setProperty("--fs-code", `${sizes.code}px`);
  style.setProperty("--ui-scale", String(sizes.ui / DEFAULT_FONT_SIZES.ui));
  // Custom properties cross the library's shadow root, so the document is
  // enough to reach every diff and file view.
  style.setProperty("--diffs-font-size", `${fontSize}px`);
  style.setProperty("--diffs-line-height", `${lineHeight}px`);
}

const changed = channel<void>();
let current: FontSizes | null = null;

function store(): FontSizes {
  current ??= coerceFontSizes(readLocalStorage<unknown>(FONT_SIZES_KEY, null));
  return current;
}

/// Run once before React mounts, so the first frame is drawn at the stored sizes.
export function applyStoredFontSizes(): void {
  apply(store());
}

export function setFontSize(slot: FontSlot, px: number): void {
  const next = coerceFontSizes({ ...store(), [slot]: px });
  if (next[slot] !== store()[slot]) commit(next);
}

export function resetFontSizes(): void {
  commit({ ...DEFAULT_FONT_SIZES });
}

function commit(next: FontSizes) {
  current = next;
  apply(next);
  writeLocalStorage(FONT_SIZES_KEY, next);
  changed.emit();
}

export function useFontSizes(): FontSizes {
  return useSyncExternalStore(changed.subscribe, store, store);
}

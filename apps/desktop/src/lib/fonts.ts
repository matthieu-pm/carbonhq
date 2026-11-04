import { useSyncExternalStore } from "react";

import { readLocalStorage, writeLocalStorage } from "@/hooks/useLocalStorage";
import { channel } from "@/lib/channel";
import { invoke } from "@/lib/transport";

export const MAIN_FONT_KEY = "ade.mainFont";

type FontState = {
  selected: string | null;
  families: string[] | null;
  error: string | null;
};

const changed = channel<void>();
let state: FontState | null = null;
let pending: Promise<void> | null = null;

export function coerceFont(value: unknown): string | null {
  return typeof value === "string" && value.trim() && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : null;
}

/// A quoted family cannot turn a font named like a CSS keyword into a generic font.
export function fontStack(family: string): string {
  return `${JSON.stringify(family)}, 'Geist Variable', sans-serif`;
}

function store(): FontState {
  state ??= {
    selected: coerceFont(readLocalStorage<unknown>(MAIN_FONT_KEY, null)),
    families: null,
    error: null,
  };
  return state;
}

function apply() {
  const { selected, families, error } = store();
  const available = selected && !error && (families === null || families.includes(selected));
  if (available) document.documentElement.style.setProperty("--app-font", fontStack(selected));
  else document.documentElement.style.removeProperty("--app-font");
}

/// Applies the saved family before React draws, with Geist behind it if it was removed.
export function applyStoredFont(): void {
  apply();
}

/// Re-reads on focus and picker open so installs and removals need no restart.
export function refreshFonts(): Promise<void> {
  pending ??= invoke<string[]>("list_font_families")
    .then((families) => {
      state = { ...store(), families, error: null };
    })
    .catch(() => {
      state = { ...store(), error: "Couldn’t load installed fonts. Carbon is using Geist." };
    })
    .finally(() => {
      pending = null;
      apply();
      changed.emit();
    });
  return pending;
}

/// Saves a device preference and applies it without waiting for a restart.
export function setMainFont(selected: string | null): void {
  const current = store();
  if (selected !== null && !current.families?.includes(selected)) return;
  state = { ...current, selected };
  writeLocalStorage(MAIN_FONT_KEY, selected);
  apply();
  changed.emit();
}

export function useMainFont() {
  return useSyncExternalStore(changed.subscribe, store, store);
}

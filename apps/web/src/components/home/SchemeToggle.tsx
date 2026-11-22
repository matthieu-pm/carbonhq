"use client";

import { Moon, Sun } from "lucide-react";

import { posthog } from "@/lib/posthog";

import { SCHEME_KEY } from "./scheme";

export function SchemeToggle({ className }: { className?: string }) {
  const flip = () => {
    const root = document.documentElement;
    const to = root.dataset.scheme === "light" ? "dark" : "light";
    root.dataset.scheme = to;
    // Holds the pick for this visit even where storage refuses it.
    root.dataset.schemePicked = "1";
    try {
      localStorage.setItem(SCHEME_KEY, to);
    } catch {}
    posthog.capture("scheme_toggle", { to });
  };

  return (
    <button type="button" onClick={flip} className={className}>
      <span className="sr-only">Switch between light and dark</span>
      <Sun aria-hidden className="size-4 light:hidden" />
      <Moon aria-hidden className="hidden size-4 light:block" />
    </button>
  );
}

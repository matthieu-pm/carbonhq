"use client";

import { useId } from "react";

import { posthog } from "@/lib/posthog";

import { SCHEME_KEY } from "./scheme";
import styles from "./scheme-toggle.module.css";

function CelestialIcon() {
  const id = useId();
  const paint = (name: string) => `url(#${id}-${name})`;
  return (
    <svg className={styles.icon} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={id + "-surface"} cx="32%" cy="24%" r="79%">
          <stop className={styles.highlight} />
          <stop offset=".42" className={styles.midtone} />
          <stop offset=".82" className={styles.shadow} />
          <stop offset="1" className={styles.rim} />
        </radialGradient>
        <linearGradient id={id + "-ray"} x2=".8" y2="1" gradientUnits="objectBoundingBox">
          <stop stopColor="#fff1a4" /><stop offset=".5" stopColor="#ffc24b" /><stop offset="1" stopColor="#d97a19" />
        </linearGradient>
        <radialGradient id={id + "-crater"} cx="36%" cy="22%" r="80%">
          <stop stopColor="#7b869c" /><stop offset=".75" stopColor="#acb6c7" /><stop offset="1" stopColor="#f5f5f8" />
        </radialGradient>
      </defs>
      <g className={styles.rays} fill={paint("ray")}>
        {Array.from({ length: 8 }, (_, i) => (
          <path key={i} transform={`rotate(${i * 45} 16 16)`} d="M14.6 4.9 15 2.3a1 1 0 0 1 2 0l.4 2.6c.2 2-3 2-2.8 0Z" />
        ))}
      </g>
      <g className={styles.globe}>
        <circle cx="16" cy="16" r="8.7" fill={paint("surface")} />
        <g className={styles.craters} fill={paint("crater")}>
          <circle cx="12.1" cy="12.8" r="1.75" />
          <circle cx="10.8" cy="16.3" r=".7" />
          <circle cx="13.8" cy="20.3" r="1.2" />
          <circle cx="19.8" cy="16.4" r="1.5" />
          <circle cx="18.5" cy="11.2" r=".65" />
        </g>
      </g>
    </svg>
  );
}

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
      <span className="sr-only light:hidden">Switch to light mode</span>
      <span className="sr-only hidden light:block">Switch to dark mode</span>
      <CelestialIcon />
    </button>
  );
}

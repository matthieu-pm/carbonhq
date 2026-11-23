"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type Tool = "Select" | "Hand" | "Frame" | "Rectangle" | "Text" | "Pen" | "Comment";
export type Point = [number, number];
export type Message = { from: "user" | "agent"; text: string; x?: number; y?: number; strokes?: number };

/// Everything the drawn Design workspace shows. A script is a list of patches
/// to this; the reader's own clicks patch it the same way.
export type Scene = {
  mode: "Design" | "Theme";
  tool: Tool;
  selected: string | null;
  /// `data-target` the cursor rests on; null hides it.
  target: string | null;
  /// Bumped on every scripted click, so the cursor can press.
  press: number;
  brand: string;
  radiusToken: number;
  /// The button's own radius, or null when it is bound to `rounded.lg`.
  buttonRadius: number | null;
  buttonFill: "ink" | "brand";
  /// Which field shows a caret, and what is typed in it so far.
  field: null | "radius" | "token-value";
  fieldText: string;
  tokenMenu: boolean;
  tokenEdit: null | "brand" | "rounded.lg";
  saving: "idle" | "saving" | "saved";
  /// How much of the scripted pen stroke is drawn, 0–1.
  ink: number;
  strokes: Point[][];
  pin: Point | null;
  commentOpen: boolean;
  commentText: string;
  messages: Message[];
  panel: "inspector" | "chat";
};

export const BASE: Scene = {
  mode: "Design",
  tool: "Select",
  selected: null,
  target: null,
  press: 0,
  brand: "#4f5bff",
  radiusToken: 14,
  buttonRadius: 4,
  buttonFill: "ink",
  field: null,
  fieldText: "",
  tokenMenu: false,
  tokenEdit: null,
  saving: "idle",
  ink: 0,
  strokes: [],
  pin: null,
  commentOpen: false,
  commentText: "",
  messages: [],
  panel: "inspector",
};

export type Step = { hold: number; set: Partial<Scene> };

/// A click on `target`: the cursor travels there, then presses.
export function click(target: string, set: Partial<Scene> = {}, travel = 700): Step[] {
  return [
    { hold: travel, set: { target } },
    { hold: 380, set: { ...set, press: NaN } },
  ];
}

/// Types `text` into whatever field is open, a few characters a tick.
export function type(text: string, key: "fieldText" | "commentText" = "fieldText", tick = 55): Step[] {
  const steps: Step[] = [];
  for (let i = 1; i <= text.length; i++) steps.push({ hold: tick, set: { [key]: text.slice(0, i) } });
  return steps;
}

function settle(base: Scene, steps: Step[], upTo: number): Scene {
  let s = base;
  let press = 0;
  for (let i = 0; i <= upTo && i < steps.length; i++) {
    const set = steps[i].set;
    if (Number.isNaN(set.press)) press++;
    s = { ...s, ...set, press };
  }
  return s;
}

/// Plays `steps` while the preview is on screen, the homepage's rule: off
/// screen it holds still, and under reduced motion it shows the finished
/// picture and never moves. The server renders that finished picture too, so
/// the first paint is never an empty window. Any `act` hands the window to the
/// reader until `replay`.
export function useScene(base: Scene, steps: Step[], autoplay = true) {
  const ref = useRef<HTMLDivElement>(null);
  const last = steps.length - 1;
  const [index, setIndex] = useState(autoplay ? last : -1);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [override, setOverride] = useState<Partial<Scene> | null>(null);
  const started = useRef(false);

  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    const el = ref.current;
    if (!el) return () => media.removeEventListener("change", sync);
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => {
      io.disconnect();
      media.removeEventListener("change", sync);
    };
  }, []);

  const playing = autoplay && visible && !reduced && !override;

  useEffect(() => {
    if (!autoplay) return;
    if (reduced) {
      setIndex(last);
      return;
    }
    if (!playing) return;
    if (!started.current) {
      started.current = true;
      setIndex(0);
      return;
    }
    const t = setTimeout(() => setIndex((i) => (i >= last ? 0 : i + 1)), steps[index].hold);
    return () => clearTimeout(t);
  }, [autoplay, playing, reduced, index, last, steps]);

  const scripted = useMemo(() => settle(base, steps, index), [base, steps, index]);
  const state = useMemo<Scene>(() => (override ? { ...scripted, ...override, target: null } : scripted), [scripted, override]);

  const act = useCallback(
    (patch: Partial<Scene> | ((s: Scene) => Partial<Scene>)) =>
      setOverride((o) => {
        const current = { ...scripted, ...o };
        return { ...o, ...(typeof patch === "function" ? patch(current) : patch) };
      }),
    [scripted],
  );

  const replay = useCallback(() => {
    setOverride(null);
    started.current = true;
    setIndex(0);
  }, []);

  return { ref, state, playing, reduced, handsOn: !!override, act, replay, progress: index / last };
}

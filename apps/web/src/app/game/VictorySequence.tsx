"use client";

import { SkipForward } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Cue } from "./audio";
import { drawVictoryFrame, VICTORY_DURATION_MS, VICTORY_IGNITION_MS, VICTORY_SIGNAL_MS, VICTORY_STILL_MS } from "./victory-scene";
import s from "./game.module.css";

let dusk: HTMLImageElement | null = null;

export function preloadVictoryScene() {
  if (!dusk) {
    dusk = new Image();
    dusk.src = "/game/antenna-dusk.webp";
    void dusk.decode().catch(() => {});
  }
}

export function VictorySequence({ playing, onFinish, cue }: {
  playing: boolean;
  onFinish: () => void;
  cue: (kind: Cue) => void | (() => void);
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const skip = useRef<HTMLButtonElement>(null);
  const plate = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (dusk?.complete && dusk.naturalWidth) plate.current = dusk;
  }, []);

  useEffect(() => {
    const surface = canvas.current!;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let elapsed = 0;
    let previous: number | null = null;
    let animation = 0;
    let done = !playing;
    let signalled = false;
    let launched = false;
    let stopRumble: void | (() => void);

    function paint() {
      const time = motion.matches ? VICTORY_STILL_MS : done ? VICTORY_DURATION_MS : elapsed;
      drawVictoryFrame(surface, plate.current, time);
    }
    function finish() {
      if (done) return;
      done = true;
      onFinish();
    }
    function frame(now: number) {
      if (done || document.hidden) return;
      elapsed += previous === null ? 0 : Math.max(0, now - previous);
      previous = now;
      if (!signalled && (motion.matches || elapsed >= VICTORY_SIGNAL_MS)) {
        signalled = true;
        cue("win");
      }
      if (!launched && !motion.matches && elapsed >= VICTORY_IGNITION_MS && elapsed < VICTORY_DURATION_MS) {
        launched = true;
        stopRumble = cue("launch");
      }
      if (!motion.matches) paint();
      if (elapsed >= (motion.matches ? 1600 : VICTORY_DURATION_MS)) finish();
      else animation = requestAnimationFrame(frame);
    }
    function visibility() {
      cancelAnimationFrame(animation);
      previous = null;
      if (document.hidden) stopRumble?.();
      else if (!done) animation = requestAnimationFrame(frame);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape" && !done) { event.preventDefault(); finish(); }
    }
    const observer = new ResizeObserver(paint);
    observer.observe(surface);
    paint();
    motion.addEventListener("change", paint);
    if (playing) {
      skip.current?.focus({ preventScroll: true });
      document.addEventListener("visibilitychange", visibility);
      window.addEventListener("keydown", escape);
      visibility();
    }
    return () => {
      cancelAnimationFrame(animation);
      stopRumble?.();
      observer.disconnect();
      motion.removeEventListener("change", paint);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("keydown", escape);
    };
  }, [playing, onFinish, cue]);

  return <>
    <canvas ref={canvas} className={s.victoryFrame} role="img" aria-hidden={!playing}
      aria-label="The tower lights come on floor by floor. Its rooftop antenna sends a signal, and a rocket rises from a distant launch pad." />
    {playing && <button className={s.skipCinematic} type="button" ref={skip} onClick={onFinish}>
      Skip cinematic <SkipForward size={15} aria-hidden="true" />
    </button>}
  </>;
}

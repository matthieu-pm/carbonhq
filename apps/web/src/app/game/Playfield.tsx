"use client";

import { ArrowLeft, ArrowRight, ArrowUp, Flag, Heart, Pause, Play, RadioTower, UsersRound } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createGame, getContextHint, getSnapshot, stepGame, type Input } from "./engine";
import { drawWorld } from "./render";
import type { Cue } from "./audio";
import s from "./game.module.css";

export type RunResult = { stageIndex: number; recruited: number; status: "won" | "lost"; seconds: number };

export function formatTime(seconds: number) {
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}

const keys: Record<string, keyof Input | undefined> = {
  ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
  Space: "jump", ArrowUp: "jump", KeyW: "jump", KeyE: "use",
};

export function Playfield({ onEnd, onTitle, cue, settings }: {
  onEnd: (result: RunResult) => void; onTitle: () => void; cue: (kind: Cue) => void; settings?: ReactNode;
}) {
  const [game] = useState(createGame);
  const [hud, setHud] = useState(() => getSnapshot(game));
  const [seconds, setSeconds] = useState(0);
  const [paused, setPaused] = useState(false);
  const pauseFlag = useRef(false);
  const focusOnPause = useRef(false);
  const resumeButton = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const group = useRef<HTMLDivElement>(null);
  const inputs = useRef(new Map<string, keyof Input>());
  const taps = useRef<Input>({});

  const hold = useCallback((source: string, action: keyof Input) => {
    if (pauseFlag.current || inputs.current.has(source)) return;
    inputs.current.set(source, action);
    if (action === "jump" || action === "use") taps.current[action] = true;
  }, []);
  const pause = useCallback((moveFocus = false) => {
    if (pauseFlag.current) return;
    pauseFlag.current = true;
    focusOnPause.current = moveFocus;
    inputs.current.clear();
    taps.current = {};
    game.jumpHeld = false;
    game.useHeld = false;
    setPaused(true);
  }, [game]);
  const resume = useCallback(() => {
    pauseFlag.current = false;
    setPaused(false);
    canvas.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    canvas.current?.focus({ preventScroll: true });
    function down(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const inGame = group.current?.contains(document.activeElement);
      if (event.code === "Escape" && (inGame || pauseFlag.current)) {
        event.preventDefault();
        if (!event.repeat) { if (pauseFlag.current) resume(); else pause(true); }
        return;
      }
      const action = keys[event.code];
      if (!inGame || !action || pauseFlag.current) return;
      if (event.code === "Space" && event.target instanceof HTMLButtonElement) return;
      event.preventDefault();
      if (event.repeat) return;
      canvas.current?.focus({ preventScroll: true });
      hold(event.code, action);
    }
    function up(event: KeyboardEvent) { inputs.current.delete(event.code); }
    function autoPause() { pause(); }
    function outsideFocus(event: FocusEvent) {
      if (event.target instanceof Node && !group.current?.contains(event.target)) autoPause();
    }
    function hidden() { if (document.hidden) autoPause(); }
    document.addEventListener("focusin", outsideFocus);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", autoPause);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", autoPause);
      document.removeEventListener("focusin", outsideFocus);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [hold, pause, resume]);

  useEffect(() => {
    if (paused && focusOnPause.current) resumeButton.current?.focus({ preventScroll: true });
  }, [paused]);

  useEffect(() => {
    const surface = canvas.current!;
    const observer = new ResizeObserver(() => drawWorld(surface, game));
    observer.observe(surface);
    return () => observer.disconnect();
  }, [game]);

  useEffect(() => {
    if (paused) return;
    const surface = canvas.current!;
    const clock = 1000 / 60;
    let last: number | null = null;
    let lag = 0;
    let animation = 0;
    let prev = getSnapshot(game);
    let prevSecond = Math.floor(game.frame / 60);

    function frame(now: number) {
      if (pauseFlag.current) return;
      lag += Math.max(0, Math.min(now - (last ?? now), 100));
      last = now;
      while (lag >= clock && game.status === "playing") {
        const input = { ...taps.current };
        for (const action of inputs.current.values()) input[action] = true;
        taps.current = {};
        const hadPrompt = game.prompt;
        const velocity = game.player.vy;
        stepGame(game, input);
        if (game.lives < prev.lives) cue("hurt");
        else if (game.lives > prev.lives) cue("recruit");
        else if (game.stageIndex !== prev.stageIndex) cue("floor");
        else if (input.use && hadPrompt && !game.prompt) cue("crew");
        else if (velocity >= 0 && game.player.vy < -6) cue("jump");
        if (game.stageIndex !== prev.stageIndex || game.lives !== prev.lives || game.prompt !== prev.prompt ||
          game.notice !== prev.notice || game.recruited.length !== prev.recruited.length || game.status !== prev.status ||
          getContextHint(game) !== prev.hint) {
          prev = getSnapshot(game);
          setHud(prev);
        }
        lag -= clock;
      }
      drawWorld(surface, game);
      const elapsed = Math.floor(game.frame / 60);
      if (elapsed !== prevSecond) { prevSecond = elapsed; setSeconds(elapsed); }
      if (game.status !== "playing") {
        onEnd({ status: game.status, stageIndex: game.stageIndex, recruited: game.recruited.length, seconds: elapsed });
        return;
      }
      animation = requestAnimationFrame(frame);
    }
    animation = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animation);
  }, [game, cue, onEnd, paused]);

  function direction(event: ReactPointerEvent<HTMLButtonElement>, action: "left" | "right") {
    if (event.button !== 0) return;
    event.preventDefault();
    canvas.current?.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    hold("pointer-" + event.pointerId, action);
  }
  function release(event: ReactPointerEvent<HTMLButtonElement>) { inputs.current.delete("pointer-" + event.pointerId); }
  function tap(action: "jump" | "use") {
    if (pauseFlag.current) return;
    taps.current[action] = true;
    canvas.current?.focus({ preventScroll: true });
  }
  return <div ref={group} className={s.playfield}>
    <div className={s.hud}>
      <div className={s.stage}><span><Flag size={13} /> Floor 0{hud.stageIndex + 1} / 04</span><strong>{hud.stageName}</strong></div>
      <div className={s.counters}>
        <span aria-label={hud.lives + " lives"}><Heart className={s.heart} size={16} />{hud.lives}</span>
        <span aria-label={hud.recruited.length + " of 4 agents recruited"}><UsersRound size={17} />{hud.recruited.length}/4</span>
        <time>{formatTime(seconds)}</time>
        <button className={s.iconButton} type="button" aria-label="Pause game" onClick={() => pause(true)} disabled={paused}><Pause size={17} /></button>
      </div>
    </div>
    <div className={s.playScreen}>
      <canvas className={s.world} ref={canvas} tabIndex={paused ? -1 : 0} aria-label="Tower Shift playfield. Use left and right arrows to move, Space to jump, E to use crew, and Escape to pause." />
      <div className={s.notice} role="status">{!paused && hud.notice && <span>{hud.notice}</span>}</div>
      {paused && <div className={s.pauseOverlay}><div className={s.pauseCard}>
        <Pause size={22} /><h2>Shift paused.</h2>
        <p>Move with the arrows, jump with Space, and use crew with E.</p>
        <button type="button" className={s.primary} onClick={resume} ref={resumeButton}><Play fill="currentColor" size={15} /> Resume shift</button>
        {settings}
        <button type="button" className={s.textButton} onClick={onTitle}>End run &amp; return to title</button>
      </div></div>}
    </div>
    <div className={s.playRail} inert={paused}>
      <div className={s.desktopKeys}><span><kbd>←</kbd><kbd>→</kbd> Move</span><span><kbd>Space</kbd> Jump</span></div>
      <div className={s.touchKeys}>
        {(["left", "right"] as const).map((action) => <button key={action} className={s.padKey} type="button" aria-label={"Move " + action}
          onPointerDown={(event) => direction(event, action)} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}
          onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); if (!event.repeat) hold("button-" + action, action); } }}
          onKeyUp={() => inputs.current.delete("button-" + action)} onBlur={() => inputs.current.delete("button-" + action)}>
          {action === "left" ? <ArrowLeft /> : <ArrowRight />}
        </button>)}
      </div>
      <div className={s.actions}><div className={s.context} aria-live="polite">{hud.prompt ?
        <button type="button" onClick={() => tap("use")} className={s.crewButton}><kbd>E</kbd><span>Use crew<small>{hud.prompt}</small></span></button> :
        <span className={s.contextHint}><RadioTower size={15} /> {hud.hint}</span>}
      </div>
        <button type="button" className={s.jumpKey} onPointerDown={(e) => { if (e.button === 0) { e.preventDefault(); tap("jump"); } }}
          onClick={(e) => { if (e.detail === 0) tap("jump"); }} aria-label="Jump"><ArrowUp /> Jump</button>
      </div>
    </div>
  </div>;
}

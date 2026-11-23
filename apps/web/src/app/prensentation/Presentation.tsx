"use client";

import { ArrowLeft, ArrowRight, Maximize, Minimize, Scan, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DownloadButton } from "@/components/DownloadButton";
import { Hero } from "@/components/illustrations/Hero";
import { desktopHeroWindow } from "@/components/illustrations/heroWindowSize";
import { Wordmark } from "@/components/Wordmark";
import { AgentPicker, DesignSurface } from "./Scenes";
import styles from "./presentation.module.css";

const chapters = [
  { id: "intro", name: "Carbon", title: "Your agents. One place to build.",
    description: "Run coding agents side by side. Explore Carbon from inside the workspace.", focus: "window" },
  { id: "agents", name: "Agents", title: "Bring your own agent.",
    description: "Pick a harness and model in the new-task composer. Try switching to Codex or pi.", focus: "agents" },
  { id: "coding", name: "Coding", title: "Review the work in context.",
    description: "Open Changes or inspect the checks and comments on this sample pull request.", focus: "pr" },
  { id: "design", name: "Design", title: "Point to what should change.",
    description: "Choose Comment in the canvas toolbar, then pin feedback on the welcome screen.", focus: "canvas" },
  { id: "remote", name: "Run Carbon", title: "Your agents, on your machines.",
    description: "Sessions can run on this Mac or on a Linux server you connect over SSH.", focus: "local" },
] as const;

type Chapter = (typeof chapters)[number];
type CodingFocus = Exclude<Chapter["focus"], "canvas">;
type Workspace = "coding" | "design";
type Size = { width: number; height: number };
type Bounds = Size & { x: number; y: number };
type Camera = { x: number; y: number; scale: number };

const wholeWindow: Bounds = { x: 0, y: 0, width: desktopHeroWindow.width, height: desktopHeroWindow.height };

function frameCamera(viewport: Size, frame: Bounds, margin: number, align = 0.5): Camera {
  const scale = Math.min((viewport.width - margin * 2) / frame.width, (viewport.height - margin * 2) / frame.height);
  return {
    x: viewport.width * align - (frame.x + frame.width / 2) * scale,
    y: viewport.height / 2 - (frame.y + frame.height / 2) * scale,
    scale,
  };
}

function transform({ x, y, scale }: Camera) {
  return `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
}

function locate(surface: HTMLElement, selector: string): Bounds | undefined {
  const target = surface.querySelector(selector)?.getBoundingClientRect();
  if (!target?.width) return;
  const frame = surface.getBoundingClientRect();
  const scale = frame.width / wholeWindow.width;
  return {
    x: (target.left - frame.left) / scale,
    y: (target.top - frame.top) / scale,
    width: target.width / scale,
    height: target.height / scale,
  };
}

function frameFor(surface: HTMLElement, focus: Chapter["focus"], narrow: boolean): Bounds | undefined {
  if (focus === "window") return wholeWindow;
  if (focus === "agents") {
    const trigger = locate(surface, '[data-tour-target="agents"]');
    if (trigger) return { x: trigger.x - (narrow ? 190 : 265), y: trigger.y - 160, width: narrow ? 355 : 550, height: 295 };
  }
  if (focus === "pr") {
    const panel = locate(surface, '[aria-label="Pull request and changes"]');
    if (panel) return { ...panel, x: panel.x - 12, y: panel.y - 14, width: panel.width + 24, height: 440 };
  }
  if (focus === "local") {
    const summary = locate(surface, '[aria-label="Pinned summary"]');
    if (summary) return { ...summary, x: summary.x - 16, y: summary.y - 16, width: summary.width + 32, height: 355 };
  }
  if (focus === "canvas") {
    const artboard = locate(surface, '[data-target="layer-welcome"]');
    const toolbar = locate(surface, '[aria-label="Canvas tools"]');
    if (artboard && toolbar) {
      const top = artboard.y + artboard.height * 0.34;
      return {
        x: artboard.x - 90,
        y: top,
        width: artboard.width + 200,
        height: toolbar.y + toolbar.height - top + 24,
      };
    }
  }
}

export function Presentation() {
  const [index, setIndex] = useState(0);
  const [overview, setOverview] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [traveling, setTraveling] = useState(false);
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [workspace, setWorkspace] = useState<Workspace>("coding");
  const [codingFocus, setCodingFocus] = useState<CodingFocus>("window");
  const activeWorkspace = useRef<Workspace>("coding");
  const preparedCodingFocus = useRef<CodingFocus>("window");
  const viewport = useRef<HTMLElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const coding = useRef<HTMLDivElement>(null);
  const design = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | null>(null);
  const viewedSize = useRef<Size | null>(null);
  const chapter = chapters[index];
  const focus = chapter.focus;

  const go = useCallback((next: number) => {
    if (!chapters[next]) return;
    setOverview(false);
    if (next !== index) {
      window.history.pushState(null, "", `#${chapters[next].id}`);
      setIndex(next);
    }
  }, [index]);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => {
      const { clientWidth: width, clientHeight: height } = element;
      setSize((last) => width === last.width && height === last.height ? last : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = world.current;
    if (!element || !size.width || !size.height) return;
    const cameraWorld = element;
    const nextWorkspace: Workspace = focus === "canvas" ? "design" : "coding";
    const source = nextWorkspace === "design" ? design.current : coding.current;
    if (!source) return;
    const surface = source;
    const resize = viewedSize.current !== size;
    viewedSize.current = size;
    const animate = !resize && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    const narrow = size.width < 700;
    const full = frameCamera(size, wholeWindow, narrow ? 13 : 38);
    let canceled = false;
    let frameId = 0;

    async function move(camera: Camera, duration: number) {
      const from = getComputedStyle(cameraWorld).transform;
      animation.current?.cancel();
      const to = transform(camera);
      cameraWorld.style.transform = to;
      if (!animate || from === "none") return;
      animation.current = cameraWorld.animate([{ transform: from }, { transform: to }],
        { duration, easing: "cubic-bezier(.24,.65,.2,1)" });
      await animation.current.finished.catch(() => {});
    }

    async function travel() {
      setTraveling(animate);
      const changingWorkspace = activeWorkspace.current !== nextWorkspace;
      const changingTask = focus !== "canvas" && preparedCodingFocus.current !== focus &&
        (focus === "agents" || preparedCodingFocus.current === "agents");
      if (changingWorkspace || changingTask) {
        // Pull back before the app opens a new task or switches workspaces.
        await move(full, 390);
        if (canceled) return;
      }
      if (changingWorkspace) {
        activeWorkspace.current = nextWorkspace;
        setWorkspace(nextWorkspace);
      }
      if (focus !== "canvas" && preparedCodingFocus.current !== focus) {
        preparedCodingFocus.current = focus;
        setCodingFocus(focus);
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        if (canceled) return;
      }
      const frame = frameFor(surface, focus, narrow);
      const align = narrow ? 0.5 : focus === "canvas" ? 0.4 : focus === "pr" || focus === "local" ? 0.67 : 0.5;
      const destination = overview || !frame || focus === "window" ? full : frameCamera(size, frame, narrow ? 14 : 30, align);
      await move(destination, 780);
      if (canceled) return;
      setReady(true);
      setTraveling(false);
    }

    // The chapter also changes which session and composer the app preview renders.
    frameId = requestAnimationFrame(() => { frameId = requestAnimationFrame(() => { void travel(); }); });
    return () => {
      canceled = true;
      cancelAnimationFrame(frameId);
    };
  }, [focus, overview, size]);

  useEffect(() => {
    const syncChapter = () => {
      setIndex(Math.max(0, chapters.findIndex(({ id }) => `#${id}` === window.location.hash)));
      setOverview(false);
    };
    const syncFullscreen = () => setFullscreen(document.fullscreenElement === shell.current);
    syncChapter();
    setCanFullscreen(document.fullscreenEnabled);
    window.addEventListener("hashchange", syncChapter);
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => {
      window.removeEventListener("hashchange", syncChapter);
      document.removeEventListener("fullscreenchange", syncFullscreen);
      animation.current?.cancel();
    };
  }, []);

  useEffect(() => {
    function navigate(event: KeyboardEvent) {
      const target = event.target instanceof Element ? event.target : null;
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey ||
        target?.closest("[data-surface], input, textarea, select, [contenteditable]")) return;
      if (event.key === "Escape" && overview) { setOverview(false); return; }
      if (event.key === " " && target?.closest("button, a")) return;
      const destinations: Partial<Record<string, number>> = {
        ArrowLeft: index - 1, PageUp: index - 1, ArrowRight: index + 1, PageDown: index + 1,
        " ": index + 1, Home: 0, End: chapters.length - 1,
      };
      const next = destinations[event.key];
      if (typeof next !== "number") return;
      event.preventDefault();
      go(next);
    }
    window.addEventListener("keydown", navigate);
    return () => window.removeEventListener("keydown", navigate);
  }, [go, index, overview]);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === shell.current) await document.exitFullscreen();
      else await shell.current?.requestFullscreen();
    } catch {
      setCanFullscreen(false);
    }
  }

  return (
    <div ref={shell} className={styles.shell} data-scheme="dark">
      <header className={styles.header}>
        <a href="/" className={styles.brand} aria-label="Carbon website"><Wordmark /></a>
        <div className={styles.toolbar}>
          <button type="button" className={styles.control} aria-pressed={overview} disabled={focus === "window"}
            onClick={() => setOverview(!overview)}>
            {overview ? <Scan aria-hidden="true" /> : <ZoomOut aria-hidden="true" />}
            <span>{overview ? "Refocus" : "Full window"}</span>
          </button>
          {canFullscreen && <button type="button" className={styles.control} onClick={toggleFullscreen}
            aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}>
            {fullscreen ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}
          </button>}
        </div>
      </header>

      <section className={styles.caption} aria-live="polite">
        <div><h1>{chapter.title}</h1><p>{chapter.description}</p></div>
        {focus === "local" && <DownloadButton className={styles.download} />}
      </section>

      <main ref={viewport} className={styles.viewport} aria-label="Carbon workspace preview" aria-busy={traveling}>
        <div ref={world} className={styles.world} data-ready={ready} style={{ width: wholeWindow.width, height: wholeWindow.height }}>
          <div ref={coding} data-surface="coding" className={styles.surface} data-active={workspace === "coding"}
            inert={traveling || workspace !== "coding"} aria-hidden={traveling || workspace !== "coding"}>
            <Hero onWorkspaceChange={(next) => { if (next === "Design") go(3); }}
              presentation={{ focus: codingFocus, modelPicker: <AgentPicker key={codingFocus} initiallyOpen={codingFocus === "agents"} /> }} />
          </div>
          <div ref={design} data-surface="design" className={styles.surface} data-active={workspace === "design"}
            inert={traveling || workspace !== "design"} aria-hidden={traveling || workspace !== "design"}>
            <DesignSurface onCoding={() => go(2)} />
          </div>
        </div>
      </main>

      <footer className={styles.footer}>
        <nav className={styles.route} aria-label="Presentation chapters">
          {chapters.map(({ id, name }, item) => (
            <button type="button" key={id} aria-current={index === item ? "step" : undefined}
              onClick={() => go(item)}><span aria-hidden />{name}</button>
          ))}
        </nav>
        <div className={styles.direction}>
          <button type="button" className={styles.control} aria-label="Previous chapter" aria-disabled={index === 0}
            onClick={() => go(index - 1)}><ArrowLeft aria-hidden="true" /></button>
          <button type="button" className={styles.control} aria-label="Next chapter" aria-disabled={index === chapters.length - 1}
            onClick={() => go(index + 1)}><ArrowRight aria-hidden="true" /></button>
        </div>
      </footer>
    </div>
  );
}

"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  File,
  Frame,
  Hand,
  Layers,
  MessageSquare,
  MousePointer2,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Square,
  Type,
} from "lucide-react";
import { AssistantText, UserBubble } from "@/components/app/Chat";
import { ItemTab, PanelToggle } from "@/components/app/Tabs";
import { WorkspaceSwitch, type Workspace } from "@/components/app/WorkspaceSwitch";
import Window, { TrafficLights, cx } from "@/components/app/Window";
import { desktopHeroWindow, mobileHeroImage } from "@/components/illustrations/heroWindowSize";
import { ScaledWindow } from "@/components/illustrations/ScaledWindow";
import type { Point, Scene, Tool, useScene } from "./scene";

type Control = ReturnType<typeof useScene>;

const demoWindow = { width: 1280, height: 780 };
const mobileHeroWidth = 640;
const mobileHeroHeight = mobileHeroWidth * mobileHeroImage.height / mobileHeroImage.width;
const FRAME_W = 393;
const FRAME_H = 852;
const INK = "#168bf0";

const TOOLS: { name: Tool; key: string; icon: typeof Frame }[] = [
  { name: "Select", key: "V", icon: MousePointer2 },
  { name: "Hand", key: "H", icon: Hand },
  { name: "Frame", key: "F", icon: Frame },
  { name: "Rectangle", key: "R", icon: Square },
  { name: "Text", key: "T", icon: Type },
  { name: "Pen", key: "P", icon: Pencil },
  { name: "Comment", key: "C", icon: MessageSquare },
];

const LAYERS: { id: string; name: string; kind: "Frame" | "Rectangle" | "Text"; depth: number }[] = [
  { id: "welcome", name: "iPhone 16 — Welcome", kind: "Frame", depth: 0 },
  { id: "headline", name: "Headline", kind: "Text", depth: 1 },
  { id: "art", name: "Hero art", kind: "Rectangle", depth: 1 },
  { id: "chip", name: "Chip", kind: "Text", depth: 1 },
  { id: "body", name: "Body", kind: "Text", depth: 1 },
  { id: "button", name: "Button", kind: "Frame", depth: 1 },
  { id: "label", name: "Label", kind: "Text", depth: 2 },
];

export const BRANDS = ["#4f5bff", "#ef5a3c", "#14a37f", "#c9417e"];
export const RADII = [6, 14, 28];

/// The pen stroke the scripts draw, round the button, in frame units.
const LOOP = "M14 734 C 60 712, 330 712, 378 736 C 396 760, 388 812, 352 820 C 260 834, 90 834, 30 818 C 6 806, 2 760, 22 738";
/// Where scripted comments pin, on the button's top-right corner.
export const PIN: Point = [338, 752];

const tokensOf = (s: Scene) => [
  { name: "colors.brand", id: "brand" as const, kind: "Color", value: s.brand, linked: 3 },
  { name: "colors.ink", id: null, kind: "Color", value: "#121212", linked: 2 },
  { name: "colors.muted", id: null, kind: "Color", value: "#6b6b6b", linked: 1 },
  { name: "rounded.lg", id: "rounded.lg" as const, kind: "Radius", value: s.radiusToken + "px", linked: s.buttonRadius === null ? 2 : 1 },
  { name: "spacing.4", id: null, kind: "Spacing", value: "16px", linked: 0 },
];

/// Both layouts share the same scene so resizing preserves playback and edits.
export function DesignPreview({
  ctl,
  story,
  compactPanel,
  hero = false,
  file = "onboarding",
  onWorkspaceChange,
  desktopOnly = false,
}: {
  ctl: Control;
  /// What the loop shows, said once under the window.
  story?: string;
  compactPanel: "inspector" | "chat" | "theme";
  hero?: boolean;
  file?: string;
  onWorkspaceChange?: (workspace: Workspace) => void;
  desktopOnly?: boolean;
}) {
  const { state } = ctl;
  const full = useRef<HTMLDivElement>(null);
  const compact = useRef<HTMLDivElement>(null);

  const compactWindow = (
    <div ref={compact} data-app-window className={cx("app-frame relative overflow-hidden rounded-xl border border-border text-foreground shadow-window", hero && "flex h-full flex-col")}>
      <div className="flex h-9 items-center gap-3 px-3">
        <TrafficLights className="shrink-0 [&>span]:size-2.5" />
        <WorkspaceSwitch value="Design" navigate onPick={onWorkspaceChange} />
        <span className="min-w-0 truncate text-ui text-muted-foreground">{file}.canvas</span>
      </div>
      <div className={cx("mx-1.5 mb-1.5 overflow-hidden rounded-[8px] shadow-[0_0_0_1px_var(--color-hairline)]", hero && "grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_240px]")}>
        <div className={hero ? "min-h-0" : "h-[392px]"}>
          <Stage ctl={ctl} zoom={hero ? 0.34 : 0.36} compact />
        </div>
        <div className={cx("app-sheet border-hairline", hero ? "min-h-0 border-l" : "border-t")}>
          {compactPanel === "chat" ? (
            <div className={hero ? "h-full" : "h-[360px]"}>
              <ChatPanel ctl={ctl} />
            </div>
          ) : compactPanel === "theme" ? (
            <div className="p-2">
              <TokenList ctl={ctl} />
            </div>
          ) : (
            <div className="pb-2">
              <Inspector ctl={ctl} />
            </div>
          )}
        </div>
      </div>
      <Cursor root={compact} state={state} />
    </div>
  );

  return (
    <div ref={ctl.ref} className={hero ? "w-full" : "mx-auto max-w-[1280px]"}>
      <div className={desktopOnly ? undefined : "max-sm:hidden"}>
        <ScaledWindow {...(hero ? desktopHeroWindow : demoWindow)}>
          <div ref={full} className="relative h-full w-full">
            <Window
              workspace="Design"
              interactive
              onWorkspaceChange={onWorkspaceChange}
              className="h-full w-full"
              sidebarWidth={248}
              sidebar={<Navigator ctl={ctl} file={file} />}
              tabs={
                <>
                  <ItemTab icon={<Layers className="size-3.5 text-muted-foreground" />} label={`${file}.canvas`} active />
                  <ItemTab icon={<MessageSquare className="size-3.5 text-muted-foreground" />} label="Canvas chat" onClick={() => ctl.act((s) => ({ panel: s.panel === "chat" ? "inspector" : "chat" }))} active={state.panel === "chat"} />
                </>
              }
              headerEnd={
                <>
                  <span className="text-ui text-muted-foreground tabular-nums">{state.saving === "saving" ? "Saving…" : "62%"}</span>
                  <PanelToggle />
                </>
              }
              main={<Stage ctl={ctl} zoom={hero ? 1.05 : 0.7} />}
              panel={<div className="flex h-full w-[300px] flex-col">{state.panel === "chat" ? <ChatPanel ctl={ctl} /> : <Inspector ctl={ctl} />}</div>}
            />
            <Cursor root={full} state={state} />
          </div>
        </ScaledWindow>
      </div>

      {!desktopOnly && <div className="sm:hidden">
        {hero ? (
          <ScaledWindow width={mobileHeroWidth} height={mobileHeroHeight}>
            {compactWindow}
          </ScaledWindow>
        ) : compactWindow}
      </div>}

      {story && <Caption ctl={ctl} story={story} />}
    </div>
  );
}

/// The one line under a preview: what plays, and the control for it.
function Caption({ ctl, story }: { ctl: Control; story: string }) {
  const status = ctl.reduced ? "Finished state" : ctl.handsOn ? "Your turn" : ctl.playing ? "Playing" : "Paused";
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 font-mono text-[11px] leading-[14px] tracking-[0.06em] text-[#8A8A8A] uppercase light:text-[#6B6B6B]">
      <span className="flex items-center gap-2">
        <span aria-hidden className={cx("size-1.5 rounded-full", ctl.playing ? "bg-[#3FB950]" : "bg-[#8A8A8A]")} />
        <span>
          {status} · {story}
        </span>
      </span>
      <span className="flex items-center gap-4">
        {ctl.handsOn && !ctl.reduced ? (
          <button type="button" onClick={ctl.replay} className="flex items-center gap-1.5 uppercase hover:text-white focus-visible:text-white light:hover:text-[#0A0A0A]">
            <RotateCcw className="size-3" /> Replay
          </button>
        ) : (
          <button
            type="button"
            onClick={() => ctl.act({})}
            className="flex items-center gap-1.5 uppercase hover:text-white focus-visible:text-white light:hover:text-[#0A0A0A]"
          >
            {ctl.playing ? <Pause className="size-3" /> : <Play className="size-3" />} {ctl.playing ? "Pause and try it" : ctl.handsOn ? "Your turn" : "Try it"}
          </button>
        )}
      </span>
    </div>
  );
}

/// The demo cursor. It finds its `data-target` inside its own layout and
/// glides there, so the scripts name controls rather than coordinates.
function Cursor({ root, state }: { root: React.RefObject<HTMLDivElement | null>; state: Scene }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [pressed, setPressed] = useState(false);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el || !state.target) {
      setAt(null);
      return;
    }
    const place = () => {
      const target = el.querySelector<HTMLElement>(`[data-target="${state.target}"]`);
      const box = el.getBoundingClientRect();
      if (!target || !box.width) return setAt(null);
      const scale = box.width / el.offsetWidth;
      const r = target.getBoundingClientRect();
      if (!r.width) return setAt(null);
      setAt({ x: (r.left + r.width * 0.6 - box.left) / scale, y: (r.top + r.height * 0.6 - box.top) / scale });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [root, state.target, state.mode, state.tokenEdit, state.selected, state.commentOpen, state.tokenMenu, state.panel]);

  useEffect(() => {
    if (!state.press) return;
    setPressed(true);
    const t = setTimeout(() => setPressed(false), 180);
    return () => clearTimeout(t);
  }, [state.press]);

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-0 left-0 z-40 transition-[transform,opacity] duration-[650ms] ease-[cubic-bezier(.3,.7,.2,1)] motion-reduce:transition-none"
      style={{ transform: `translate(${at?.x ?? 0}px, ${at?.y ?? 0}px)`, opacity: at ? 1 : 0 }}
    >
      <span className={cx("absolute -top-3 -left-3 size-6 rounded-full bg-[#168bf0]/30 transition-transform duration-200", pressed ? "scale-100" : "scale-0")} />
      <svg width="20" height="22" viewBox="0 0 12 16" className={cx("relative transition-transform duration-150", pressed && "scale-90")}>
        <path d="M1 1 L1 13 L4.5 9.8 L7 15 L9 14 L6.6 9 L11 9 Z" fill="#FFFFFF" stroke="#000000" strokeWidth="0.9" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/// The canvas navigation column: Design shows pages and layers, Theme shows
/// the tokens.
function Navigator({ ctl, file }: { ctl: Control; file: string }) {
  const { state, act } = ctl;
  return (
    <div className="flex w-[248px] flex-col gap-2 p-2 text-ui">
      <div className="flex items-center gap-2 px-2 pt-1">
        <Layers className="size-3.5 text-muted-foreground" />
        <span className="font-medium">{file}</span>
      </div>
      <div role="tablist" aria-label="Canvas navigation mode" className="flex rounded-lg bg-surface-frame p-0.5">
        {(["Design", "Theme"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            data-target={`mode-${m}`}
            aria-selected={state.mode === m}
            onClick={() => act({ mode: m })}
            className={cx("h-7 flex-1 rounded-md", state.mode === m ? "bg-surface-thumb text-foreground ring-1 ring-hairline" : "text-muted-foreground hover:text-foreground")}
          >
            {m}
          </button>
        ))}
      </div>
      {state.mode === "Design" ? (
        <>
          <div className="flex items-center gap-1 px-2 pt-1 text-muted-foreground">
            <ChevronDown className="size-3" /> Pages
          </div>
          {["Welcome", "Pricing"].map((p, i) => (
            <div key={p} className={cx("flex h-7 items-center gap-2 rounded-md px-2", i === 0 && "bg-sidebar-accent")}>
              <File className="size-3.5 text-muted-foreground" />
              {p}
              {i === 0 && <Check className="ml-auto size-3 text-muted-foreground" />}
            </div>
          ))}
          <nav aria-label="Layers" className="mt-1 flex flex-col border-t border-hairline pt-2">
            {LAYERS.map((l) => {
              const Glyph = l.kind === "Frame" ? Frame : l.kind === "Text" ? Type : Square;
              return (
                <button
                  key={l.id}
                  type="button"
                  data-target={`row-${l.id}`}
                  aria-pressed={state.selected === l.id}
                  onClick={() => act({ selected: l.id, tokenMenu: false, panel: "inspector" })}
                  style={{ paddingLeft: 8 + l.depth * 14 }}
                  className={cx(
                    "flex h-7 items-center gap-2 rounded-md pr-2 text-left",
                    state.selected === l.id ? "bg-sidebar-accent text-foreground shadow-[inset_2px_0_0_#168bf0]" : "hover:bg-sidebar-accent/50",
                  )}
                >
                  <Glyph className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{l.name}</span>
                </button>
              );
            })}
          </nav>
        </>
      ) : (
        <TokenList ctl={ctl} />
      )}
    </div>
  );
}

function TokenList({ ctl }: { ctl: Control }) {
  const { state, act } = ctl;
  return (
    <div className="flex flex-col text-ui">
      <div className="flex items-center justify-between px-2 pt-1 pb-1.5 text-muted-foreground">
        <span>Tokens · imported from DESIGN.md</span>
      </div>
      {tokensOf(state).map((t) => {
        const open = t.id && state.tokenEdit === t.id;
        const editing = open && state.field === "token-value";
        return (
          <div key={t.name} className={cx("rounded-md", open && "bg-sidebar-accent")}>
            <button
              type="button"
              data-target={t.id ? `token-${t.id}` : undefined}
              disabled={!t.id}
              onClick={() => t.id && act({ tokenEdit: open ? null : t.id, field: null })}
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left enabled:hover:bg-sidebar-accent/50"
            >
              {t.kind === "Color" ? (
                <i className="size-3.5 shrink-0 rounded-[4px] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.15)] transition-colors duration-300" style={{ background: t.value }} />
              ) : (
                <i className="grid size-3.5 shrink-0 place-items-center rounded-[4px] bg-muted text-[8px] not-italic text-muted-foreground">{t.kind[0]}</i>
              )}
              <span className="flex-1 truncate">{t.name}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{t.value}</span>
            </button>
            {open && (
              <div className="flex flex-col gap-2 px-2 pt-1 pb-2.5">
                <label className="flex h-7 items-center justify-between rounded-md bg-surface-frame px-2">
                  <span className="text-muted-foreground">Value</span>
                  <span data-target="token-value" className={cx("font-mono text-[11px]", editing && "rounded-sm px-1 ring-1 ring-[#168bf0]")}>
                    {editing ? state.fieldText : t.value}
                    {editing && <span className="ml-px inline-block h-3 w-px animate-pulse bg-foreground align-middle" />}
                  </span>
                </label>
                <div role="radiogroup" aria-label={`${t.name} value`} className="flex gap-1.5">
                  {t.id === "brand"
                    ? BRANDS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          role="radio"
                          data-target={`swatch-${c}`}
                          aria-checked={state.brand === c}
                          aria-label={c}
                          onClick={() => act({ brand: c, field: null })}
                          className={cx("size-6 rounded-full", state.brand === c ? "ring-2 ring-foreground ring-offset-2 ring-offset-sidebar-accent" : "ring-1 ring-hairline")}
                          style={{ background: c }}
                        />
                      ))
                    : RADII.map((r) => (
                        <button
                          key={r}
                          type="button"
                          role="radio"
                          data-target={`radius-${r}`}
                          aria-checked={state.radiusToken === r}
                          onClick={() => act({ radiusToken: r, field: null })}
                          className={cx("h-6 rounded-md px-2 font-mono text-[11px]", state.radiusToken === r ? "bg-foreground text-background" : "ring-1 ring-hairline")}
                        >
                          {r}px
                        </button>
                      ))}
                </div>
                <span className="text-muted-foreground">
                  {t.linked} linked layer{t.linked === 1 ? "" : "s"} follow this token
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/// The board and its floating toolbar.
function Stage({ ctl, zoom, compact = false }: { ctl: Control; zoom: number; compact?: boolean }) {
  const { state, act } = ctl;
  const frame = useRef<HTMLDivElement>(null);
  const [drawing, setDrawing] = useState<Point[] | null>(null);

  function local(e: { clientX: number; clientY: number }): Point {
    const r = frame.current!.getBoundingClientRect();
    const k = r.width / FRAME_W;
    return [Math.round((e.clientX - r.left) / k), Math.round((e.clientY - r.top) / k)];
  }

  function down(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    if (state.tool === "Pen") {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrawing([local(e)]);
      act({});
    } else if (state.tool === "Comment") {
      act({ pin: local(e), commentOpen: true, commentText: "", field: null });
    } else {
      act({ selected: null, tokenMenu: false });
    }
  }

  const top = compact ? 22 : 40;
  const frameStyle: CSSProperties = { width: FRAME_W, height: FRAME_H, transform: `scale(${zoom})`, transformOrigin: "top left" };

  return (
    <div
      className={cx("@container relative h-full overflow-hidden bg-[#282828] select-none", state.tool === "Pen" || state.tool === "Comment" ? "cursor-crosshair touch-none" : "")}
      style={{ backgroundImage: "radial-gradient(rgb(255 255 255 / 0.06) 1px, transparent 1px)", backgroundSize: "16px 16px" }}
      onPointerDown={down}
      onPointerMove={(e) => drawing && setDrawing([...drawing, local(e)])}
      onPointerUp={() => {
        if (drawing && drawing.length > 1) act((s) => ({ strokes: [...s.strokes, drawing] }));
        setDrawing(null);
      }}
    >
      <div className="absolute left-1/2" style={{ top, width: FRAME_W * zoom, marginLeft: -(FRAME_W * zoom) / 2 }}>
        <span className="absolute bottom-full left-0 mb-1.5 text-[11px] whitespace-nowrap text-white/50">iPhone 16 — Welcome</span>
        <div style={{ width: FRAME_W * zoom, height: FRAME_H * zoom }}>
          <div ref={frame} style={frameStyle}>
            <Artboard state={state} onSelect={(id) => state.tool === "Select" && act({ selected: id, tokenMenu: false, panel: "inspector" })} />
            <Markup state={state} drawing={drawing} />
          </div>
        </div>
        {state.pin && state.commentOpen && <CommentBox ctl={ctl} zoom={zoom} />}
      </div>
      <div role="toolbar" aria-label="Canvas tools" className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-0.5 rounded-xl bg-popover p-1 shadow-[0_0_0_1px_var(--color-hairline),0_10px_24px_-10px_rgb(0_0_0/0.6)]">
        {TOOLS.map(({ name, key, icon: Icon }) => (
          <button
            key={name}
            type="button"
            data-target={`tool-${name}`}
            aria-label={`${name} (${key})`}
            aria-pressed={state.tool === name}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => act({ tool: name, commentOpen: false })}
            className={cx("grid place-items-center rounded-lg", compact ? "size-7" : "size-8", state.tool === name ? "bg-[#168bf0] text-white" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground")}
          >
            <Icon className="size-3.5" />
          </button>
        ))}
      </div>
    </div>
  );
}

/// The phone frame being designed. Every fill reads the scene's tokens, so a
/// token edit repaints whatever is bound to it.
function Artboard({ state, onSelect }: { state: Scene; onSelect?: (id: string) => void }) {
  const radius = state.buttonRadius ?? state.radiusToken;
  const sel = (id: string) =>
    cx("absolute transition-[background,border-radius,color,box-shadow] duration-500 motion-reduce:transition-none", state.selected === id && "outline-[3px] outline-[#168bf0] outline-solid");
  const pick = (id: string) => (e: PointerEvent) => {
    if (state.tool !== "Select") return;
    e.stopPropagation();
    onSelect?.(id);
  };
  return (
    <div data-target="layer-welcome" className={cx(sel("welcome"), "inset-0 overflow-hidden bg-white font-inter text-[#121212]")} onPointerDown={pick("welcome")}>
      <div data-target="layer-headline" className={sel("headline")} style={{ left: 32, top: 104, width: 329, fontSize: 34, fontWeight: 600, lineHeight: 1.1, letterSpacing: "-0.02em" }} onPointerDown={pick("headline")}>
        Ship the screen you sketched.
      </div>
      <div
        data-target="layer-art"
        className={sel("art")}
        style={{ left: 32, top: 212, width: 329, height: 290, borderRadius: state.radiusToken, background: `linear-gradient(140deg, ${state.brand}, color-mix(in srgb, ${state.brand} 35%, #fff))` }}
        onPointerDown={pick("art")}
      />
      <div
        data-target="layer-chip"
        className={sel("chip")}
        style={{ left: 32, top: 528, padding: "4px 12px", borderRadius: 999, fontSize: 14, fontWeight: 600, color: state.brand, background: `color-mix(in srgb, ${state.brand} 14%, #fff)` }}
        onPointerDown={pick("chip")}
      >
        New
      </div>
      <div data-target="layer-body" className={sel("body")} style={{ left: 32, top: 576, width: 329, fontSize: 18, lineHeight: 1.45, color: "#6b6b6b" }} onPointerDown={pick("body")}>
        Sketch it here, hand it to the agent, and review the diff.
      </div>
      <div
        data-target="layer-button"
        className={cx(sel("button"), "grid place-items-center text-[17px] font-semibold text-white")}
        style={{ left: 32, top: 744, width: 329, height: 60, borderRadius: radius, background: state.buttonFill === "brand" ? state.brand : "#121212" }}
        onPointerDown={pick("button")}
      >
        Get started
      </div>
    </div>
  );
}

/// Pen strokes and comment pins over the frame.
function Markup({ state, drawing }: { state: Scene; drawing?: Point[] | null }) {
  return (
    <>
      <svg className="pointer-events-none absolute inset-0 overflow-visible" width={FRAME_W} height={FRAME_H} aria-hidden>
        <g fill="none" stroke={INK} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round">
          {state.ink > 0 && (
            <path
              d={LOOP}
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - state.ink}
              className="transition-[stroke-dashoffset] duration-[1100ms] ease-in-out motion-reduce:transition-none"
            />
          )}
          {[...state.strokes, ...(drawing ? [drawing] : [])].map((pts, i) => (
            <polyline key={i} points={pts.map((p) => p.join(",")).join(" ")} />
          ))}
        </g>
      </svg>
      <span aria-hidden data-target="pin-spot" className="pointer-events-none absolute size-6" style={{ left: PIN[0] - 4, top: PIN[1] - 20 }} />
      {state.pin && (
        <span
          data-target="pin"
          className="pointer-events-none absolute grid size-10 -translate-y-full place-items-center rounded-[50%_50%_50%_0] bg-[#168bf0] text-[17px] font-semibold text-white shadow-[0_0_0_3px_#fff]"
          style={{ left: state.pin[0], top: state.pin[1] }}
        >
          1
        </span>
      )}
    </>
  );
}

function CommentBox({ ctl, zoom }: { ctl: Control; zoom: number }) {
  const { state, act } = ctl;
  const [x, y] = state.pin!;
  function send() {
    const text = state.commentText.trim();
    if (!text) return;
    act((s) => ({
      commentOpen: false,
      panel: "chat",
      messages: [...s.messages, { from: "user", text, x: s.pin![0], y: s.pin![1], strokes: s.strokes.length }],
    }));
  }
  // The frame is centered in the stage. Keep the send button inside the stage when a pin is near its right edge.
  const pinLeft = Math.min(x * zoom + 18, FRAME_W * zoom - 60);
  const left = `min(${pinLeft}px, calc(50cqw + ${FRAME_W * zoom / 2}px - 228px))`;
  return (
    <form
      onPointerDown={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      className="absolute z-10 grid w-[220px] grid-cols-[1fr_auto] gap-1.5 rounded-lg bg-popover p-1.5 text-ui shadow-[0_0_0_1px_var(--color-hairline),0_12px_28px_-8px_rgb(0_0_0/0.6)]"
      style={{ left, top: y * zoom - 70 }}
    >
      <input
        aria-label="Add a comment"
        placeholder="Add a comment"
        value={state.commentText}
        onChange={(e) => act({ commentText: e.target.value })}
        className="min-w-0 rounded-md bg-surface-frame px-2 py-1.5 outline-none placeholder:text-muted-foreground"
      />
      <button type="submit" data-target="comment-send" aria-label="Send to Canvas chat" disabled={!state.commentText.trim()} className="grid w-7 place-items-center rounded-md bg-[#168bf0] text-white disabled:opacity-40">
        <ArrowUp className="size-3.5" />
      </button>
      <span className="col-span-2 px-0.5 text-[11px] text-muted-foreground">To Canvas chat</span>
    </form>
  );
}

function Field({ label, children, target, active, wide }: { label: string; children: ReactNode; target?: string; active?: boolean; wide?: boolean }) {
  return (
    <div data-target={target} className={cx("flex h-7 min-w-0 items-center justify-between gap-2 rounded-md bg-surface-frame px-2", wide && "col-span-2", active && "ring-1 ring-[#168bf0]")}>
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5 truncate tabular-nums">{children}</span>
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return <b className="rounded-[4px] bg-[#168bf0]/20 px-1.5 font-medium text-[#168bf0] light:text-[#0f6fc4]">{children}</b>;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-hairline px-3 py-2.5">
      <h4 className="mb-2 text-[11px] text-muted-foreground">{title}</h4>
      <div className="grid grid-cols-2 gap-1.5">{children}</div>
    </section>
  );
}

/// The inspector for the selected layer, with the two controls the stories
/// change: the button's radius and its fill.
function Inspector({ ctl }: { ctl: Control }) {
  const { state, act } = ctl;
  const id = state.selected;
  const layer = LAYERS.find((l) => l.id === id);
  const radius = state.buttonRadius ?? state.radiusToken;
  const typing = state.field === "radius";
  return (
    <div className="flex flex-col text-ui">
      <div className="flex h-10 items-center justify-between px-3 text-muted-foreground">
        <span aria-live="polite">{state.saving === "saving" ? "Saving…" : state.saving === "saved" ? "Saved to canvases/" : "Autosave on"}</span>
        <span className="tabular-nums">62%</span>
      </div>
      {!layer ? (
        <>
          <div className="px-3 pb-2.5">
            <div className="text-[11px] text-muted-foreground">Page</div>
            <div className="font-medium">Welcome</div>
          </div>
          <Group title="Page">
            <Field label="Background" wide>
              <i className="size-3 rounded-[3px] bg-[#282828] ring-1 ring-hairline" />
              #282828
            </Field>
          </Group>
          <p className="px-3 py-2 text-muted-foreground">Select a layer on the board or in Layers.</p>
        </>
      ) : (
        <>
          <div className="px-3 pb-2.5">
            <div className="text-[11px] text-muted-foreground">{layer.kind}</div>
            <div className="font-medium">{layer.name}</div>
          </div>
          <Group title="Layout">
            <Field label="X">32</Field>
            <Field label="Y">{id === "button" ? 744 : id === "art" ? 212 : 104}</Field>
            <Field label="W">329</Field>
            <Field label="H">{id === "button" ? 60 : id === "art" ? 290 : "fit"}</Field>
          </Group>
          {(id === "button" || id === "art") && (
            <Group title="Radius">
              {id === "button" ? (
                <Field label="All corners" wide target="radius-field" active={typing}>
                  {state.buttonRadius === null ? (
                    <Chip>rounded.lg</Chip>
                  ) : typing ? (
                    <span>
                      {state.fieldText}
                      <span className="ml-px inline-block h-3 w-px animate-pulse bg-foreground align-middle" />
                    </span>
                  ) : (
                    <>
                      <button type="button" aria-label="Smaller radius" onClick={() => act({ buttonRadius: Math.max(0, radius - 4) })} className="px-1 text-muted-foreground hover:text-foreground">
                        −
                      </button>
                      {radius}px
                      <button type="button" aria-label="Larger radius" onClick={() => act({ buttonRadius: Math.min(30, radius + 4) })} className="px-1 text-muted-foreground hover:text-foreground">
                        +
                      </button>
                    </>
                  )}
                </Field>
              ) : (
                <Field label="All corners" wide>
                  <Chip>rounded.lg</Chip>
                </Field>
              )}
            </Group>
          )}
          <Group title="Effects">
            <div className="relative col-span-2">
              <button
                type="button"
                data-target="fill-row"
                onClick={() => id === "button" && act((s) => ({ tokenMenu: !s.tokenMenu }))}
                className={cx("flex h-7 w-full items-center justify-between gap-2 rounded-md bg-surface-frame px-2", state.tokenMenu && "ring-1 ring-[#168bf0]")}
              >
                <span className="text-muted-foreground">Fill · Solid</span>
                <span className="flex items-center gap-1.5">
                  <i
                    className="size-3 rounded-[3px] ring-1 ring-hairline transition-colors duration-500"
                    style={{ background: id === "button" ? (state.buttonFill === "brand" ? state.brand : "#121212") : id === "art" || id === "chip" ? state.brand : "#fff" }}
                  />
                  {id === "button" ? state.buttonFill === "brand" ? <Chip>brand</Chip> : <Chip>ink</Chip> : id === "art" || id === "chip" ? <Chip>brand</Chip> : "#ffffff"}
                </span>
              </button>
              {state.tokenMenu && (
                <div role="menu" className="absolute top-full right-0 left-0 z-10 mt-1 rounded-lg bg-popover p-1 shadow-[0_0_0_1px_var(--color-hairline),0_12px_24px_-8px_rgb(0_0_0/0.5)]">
                  {(
                    [
                      ["brand", state.brand],
                      ["ink", "#121212"],
                    ] as const
                  ).map(([name, value]) => (
                    <button
                      key={name}
                      type="button"
                      role="menuitem"
                      data-target={`menu-${name}`}
                      onClick={() => act({ buttonFill: name, tokenMenu: false })}
                      className="flex h-7 w-full items-center gap-2 rounded-md px-2 hover:bg-sidebar-accent"
                    >
                      <i className="size-3 rounded-[3px]" style={{ background: value }} />
                      {name}
                      <span className="ml-auto font-mono text-[11px] text-muted-foreground">{value}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {id === "button" && <Field label="Shadow" wide>0 10 24 −8</Field>}
          </Group>
        </>
      )}
    </div>
  );
}

/// Canvas chat: the conversation docked beside the canvas.
function ChatPanel({ ctl }: { ctl: Control }) {
  const { state } = ctl;
  return (
    <div className="flex h-full flex-col text-ui">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-hairline px-2">
        <ItemTab icon={<MessageSquare className="size-3.5 text-muted-foreground" />} label="Canvas chat" active fixed />
        <ItemTab label="Polish onboarding" fixed />
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-hidden p-3">
        {state.messages.length === 0 && <p className="text-muted-foreground">Pin a comment on the canvas. It lands here with a snapshot of the spot.</p>}
        {state.messages.map((m, i) =>
          m.from === "user" ? (
            <UserBubble key={i} className="[&>div]:max-w-[94%] [&>div]:p-1.5">
              <Snapshot state={state} at={[m.x ?? PIN[0], m.y ?? PIN[1]]} />
              <span className="mt-1.5 block px-1 text-ui">{m.text}</span>
              <span className="block px-1 pb-0.5 text-[11px] opacity-70">
                Page: Welcome ({m.x}, {m.y})
              </span>
            </UserBubble>
          ) : (
            <AssistantText key={i} className="text-ui!">
              {m.text}
            </AssistantText>
          ),
        )}
      </div>
      <div className="m-2 flex items-center justify-between rounded-xl border border-border bg-composer px-3 py-2 text-muted-foreground">
        Message…
        <span className="grid size-6 place-items-center rounded-md bg-muted">
          <ArrowUp className="size-3.5" />
        </span>
      </div>
    </div>
  );
}

/// What Carbon attaches: the board around the pin, with ink and pin drawn on.
function Snapshot({ state, at }: { state: Scene; at: Point }) {
  const k = 0.32;
  const w = 236;
  const h = 118;
  return (
    <div aria-hidden className="relative overflow-hidden rounded-lg bg-[#282828]" style={{ width: w, height: h }}>
      <div className="absolute top-0 left-0" style={{ width: FRAME_W, height: FRAME_H, transformOrigin: "0 0", transform: `translate(${w / 2 - at[0] * k}px, ${h / 2 - at[1] * k}px) scale(${k})` }}>
        <Artboard state={{ ...state, selected: null }} />
        <Markup state={{ ...state, pin: at }} />
      </div>
    </div>
  );
}

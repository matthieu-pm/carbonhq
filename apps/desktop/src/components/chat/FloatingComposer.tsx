import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, MessageCircle, Minus } from "lucide-react";

import AgentIcon from "@/components/AgentIcon";
import Orb from "@/components/Orb";
import SessionMenu, { type SessionActions } from "@/components/chat/SessionMenu";
import { HeaderIconButton } from "@/components/layout/IssueTabs";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { setBrowserHole } from "@/lib/browser";
import { REVEAL_FLOATING_COMPOSER as REVEAL } from "@/lib/composerFocus";
import { serverOfPath } from "@/lib/transport";
import { cn } from "@/lib/utils";
import type { SessionIndexItem } from "@/types/events";

/// Space kept between the card and the column's edges.
const GAP = 12;
const MIN_W = 360;
const MIN_H = 280;
const DEFAULT_SIZE = { width: 520, height: 560 };
/// How far the top edge must travel up before a collapsed card opens.
const OPEN_PULL = 24;

type Size = { width: number; height: number };
type Edges = { readonly left: boolean; readonly top: boolean };

/// The session's composer floating at the lower right of a tab that is not
/// Chat — Files, Changes, a full terminal — so the agent stays one keystroke
/// away. The title row folds the conversation in and out; the top and left
/// edges resize; minimise leaves a round chat button in the corner.
///
/// Size, fold and minimise are one reader preference across sessions, so the
/// card is where it was left whichever task it is showing.
///
/// A new task's full browser has no session yet: the card is the composer
/// under a "New task" row, with nothing to fold out and no task to act on.
/// The first send keeps the new task's id, so the reader stays on the page.
export default function FloatingComposer({
  item,
  busy,
  actions,
  transcript,
  composer,
}: {
  item: SessionIndexItem | null;
  busy: boolean;
  actions: Omit<SessionActions, "onRename"> & { onRename: (title: string) => void };
  /// Mounted only while the card is open.
  transcript?: () => ReactNode;
  composer: ReactNode;
}) {
  const [stored, setStored] = useLocalStorage<Size>("carbon.floatingComposer.size", DEFAULT_SIZE);
  const [folded, setExpanded] = useLocalStorage("carbon.floatingComposer.expanded", false);
  const expanded = folded && !!item;
  const [hidden, setHidden] = useLocalStorage("carbon.floatingComposer.hidden", false);
  // The size mid-drag, written to storage once on release.
  const [live, setLive] = useState<Size | null>(null);
  // Which edges are lit: the hovered handle's, held through its drag.
  const [hovered, setHovered] = useState<Edges | null>(null);
  const [dragging, setDragging] = useState<Edges | null>(null);
  const lit = dragging ?? hovered;
  const [renaming, setRenaming] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLElement>(null);
  const room = useRoom(card, hidden);
  useBrowserHole(surface, hidden);
  const minWidth = Math.max(MIN_W, useToolbarFloor(surface, hidden, item?.sessionId));

  const size = live ?? stored;
  const width = clamp(size.width, minWidth, room.width - GAP * 2);
  const height = clamp(size.height, MIN_H, room.height - GAP * 2);

  useEffect(() => setRenaming(false), [item?.sessionId]);
  useEffect(() => {
    const reveal = () => setHidden(false);
    window.addEventListener(REVEAL, reveal);
    return () => window.removeEventListener(REVEAL, reveal);
  }, [setHidden]);

  const startResize = (e: React.PointerEvent, edges: Edges) => {
    const box = surface.current;
    if (!box || e.button !== 0) return;
    e.preventDefault();
    setDragging(edges);
    const from = { x: e.clientX, y: e.clientY, width, height: box.offsetHeight };
    let opened = expanded;
    let last: Size = { width, height: opened ? height : stored.height };
    const move = (ev: PointerEvent) => {
      const pulled = from.y - ev.clientY;
      // A collapsed card has no height of its own to grow; pulling its top
      // edge far enough is asking to see the conversation.
      if (edges.top && !opened && item && pulled > OPEN_PULL) {
        opened = true;
        setExpanded(true);
      }
      last = {
        width: edges.left ? from.width + (from.x - ev.clientX) : last.width,
        height: edges.top && opened ? Math.max(from.height + pulled, MIN_H) : last.height,
      };
      setLive(last);
    };
    // On the window, so the drag holds when the pointer outruns the thin handle.
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      setStored({
        width: clamp(last.width, minWidth, room.width - GAP * 2),
        height: clamp(last.height, MIN_H, room.height - GAP * 2),
      });
      setLive(null);
      setDragging(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  if (hidden) {
    return (
      <div ref={card} className="pointer-events-none absolute inset-0 z-30">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              ref={surface as React.RefObject<HTMLButtonElement>}
              type="button"
              aria-label="Show composer"
              onClick={() => setHidden(false)}
              style={{ right: GAP, bottom: GAP }}
              className="group pointer-events-auto absolute flex size-9 cursor-pointer items-center justify-center rounded-full border border-edge-surface bg-composer p-[3px] text-foreground shadow-(--shadow-surface) backdrop-blur-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {/* The hover fill sits inset from the rim, a disc inside the disc. */}
              <span className="flex size-full items-center justify-center rounded-full transition-colors group-hover:bg-foreground/12">
                <MessageCircle className="size-4" />
              </span>
              {busy && <Orb state="working" label="Working" size={12} className="absolute -top-0.5 -right-0.5" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Show composer</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  const handle = "absolute z-20 touch-none";
  return (
    // The inset layer measures the column; only the card takes the pointer.
    <div ref={card} className="pointer-events-none absolute inset-0 z-30">
      <section
        ref={surface}
        aria-label="Composer"
        style={{ right: GAP, bottom: GAP, width, height: expanded ? height : undefined }}
        className="pointer-events-auto absolute flex flex-col rounded-2xl border border-edge-surface bg-composer shadow-(--shadow-surface) backdrop-blur-xl"
      >
        {([
          [{ left: false, top: true }, "inset-x-3 -top-1 h-2 cursor-ns-resize"],
          [{ left: true, top: false }, "inset-y-3 -left-1 w-2 cursor-ew-resize"],
          [{ left: true, top: true }, "-top-1 -left-1 size-4 cursor-nwse-resize"],
        ] as const).map(([edges, place]) => (
          <div
            key={place}
            aria-hidden
            onPointerDown={(e) => startResize(e, edges)}
            onPointerEnter={() => setHovered(edges)}
            onPointerLeave={() => setHovered(null)}
            className={cn(handle, place)}
          />
        ))}
        {/* A hairline over the border, fading out before the rounded corners. */}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-6 -top-px h-px bg-linear-to-r from-transparent via-white/60 to-transparent opacity-0 transition-opacity duration-150",
            lit?.top && "opacity-100",
          )}
        />
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-6 -left-px w-px bg-linear-to-b from-transparent via-white/60 to-transparent opacity-0 transition-opacity duration-150",
            lit?.left && "opacity-100",
          )}
        />

        {/* The toggle lies under the row's controls, so a click anywhere on
            the row that is not one of them folds the conversation. */}
        <div className="relative flex h-12 shrink-0 items-center gap-1 pr-2 pl-3.5">
          {item && (
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={expanded ? "Hide conversation" : "Show conversation"}
              onClick={() => setExpanded(!expanded)}
              className="absolute inset-0 cursor-pointer rounded-t-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          )}
          {item ? (
            <AgentIcon harness={item.harness} server={serverOfPath(item.cwd)} className="pointer-events-none relative size-4 shrink-0 text-muted-foreground" />
          ) : (
            <MessageCircle className="size-4 shrink-0 text-muted-foreground" />
          )}
          {!item ? (
            <span className="ml-1 min-w-0 truncate text-ui font-medium">New task</span>
          ) : renaming ? (
            <RenameField
              title={item.title}
              onDone={(title) => {
                setRenaming(false);
                if (title && title !== item.title) actions.onRename(title);
              }}
            />
          ) : (
            <span className="pointer-events-none relative ml-1 min-w-0 truncate text-ui font-medium">{item.title}</span>
          )}
          {item && (
            <SessionMenu item={item} busy={busy} actions={{ ...actions, onRename: () => setRenaming(true) }}>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Task options"
                className="relative shrink-0 text-muted-foreground"
              >
                <ChevronDown className="size-3.5" />
              </Button>
            </SessionMenu>
          )}
          <span className="flex-1" />
          {busy && <Orb state="working" label="Working" size={16} className="pointer-events-none relative mr-1" />}
          <span className="relative">
            <HeaderIconButton label="Minimise" onClick={() => setHidden(true)}>
              <Minus className="size-4" />
            </HeaderIconButton>
          </span>
        </div>

        {expanded && transcript && (
          <div className="min-h-0 flex-1 overflow-hidden border-t border-hairline">{transcript()}</div>
        )}
        <div className="shrink-0 border-t border-hairline">{composer}</div>
      </section>
    </div>
  );
}

function RenameField({ title, onDone }: { title: string; onDone: (title: string | null) => void }) {
  const [value, setValue] = useState(title);
  const done = useRef(false);
  const finish = (next: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(next?.trim() || null);
  };
  return (
    <input
      autoFocus
      aria-label="Task title"
      value={value}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(value);
        if (e.key === "Escape") {
          e.stopPropagation();
          finish(null);
        }
      }}
      className="relative ml-1 h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-1.5 text-ui font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    />
  );
}

/// Tells the browser where the card is, so a page under it is cut away and
/// the card stays on top. A picker open above the text is part of the card.
function useBrowserHole(ref: React.RefObject<HTMLElement | null>, hidden: boolean) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const report = () => {
      const r = el.getBoundingClientRect();
      let { left, top, right, bottom } = r;
      for (const menu of el.querySelectorAll("[data-picker-menu]")) {
        const m = menu.getBoundingClientRect();
        left = Math.min(left, m.left);
        top = Math.min(top, m.top);
        right = Math.max(right, m.right);
        bottom = Math.max(bottom, m.bottom);
      }
      const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      setBrowserHole({ x: left, y: top, width: right - left, height: bottom - top, radius });
    };
    const soon = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(report);
    };
    report();
    const resize = new ResizeObserver(soon);
    resize.observe(el);
    if (el.parentElement) resize.observe(el.parentElement);
    const menus = new MutationObserver(soon);
    menus.observe(el, { childList: true, subtree: true });
    window.addEventListener("resize", soon);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      menus.disconnect();
      window.removeEventListener("resize", soon);
      setBrowserHole(null);
    };
  }, [ref, hidden]);
}

/// The narrowest card that still fits the toolbar's pickers side by side.
/// They keep their labels whole rather than truncate, so a narrower row lays
/// them over each other and over Send. Each child's `scrollWidth` is its full
/// width even where the row has squeezed it, so the sum holds at any card width.
function useToolbarFloor(ref: React.RefObject<HTMLElement | null>, hidden: boolean, session?: string): number {
  const [floor, setFloor] = useState(0);
  useLayoutEffect(() => {
    const card = ref.current;
    const row = card?.querySelector<HTMLElement>("[data-composer-toolbar]");
    if (!card || !row) return setFloor(0);
    let frame = 0;
    const read = () => {
      const kids = [...row.children] as HTMLElement[];
      const style = getComputedStyle(row);
      const gap = parseFloat(style.columnGap) || 0;
      const pad = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const natural =
        kids.reduce((sum, kid) => sum + kid.scrollWidth, 0) + gap * Math.max(0, kids.length - 1) + pad;
      // Whatever sits beside the row in the card — Send on a new task, the
      // card's own padding — is the card's width less the row's.
      setFloor(Math.ceil(natural + card.offsetWidth - row.clientWidth));
    };
    const soon = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(read);
    };
    read();
    const resize = new ResizeObserver(soon);
    resize.observe(row);
    for (const kid of row.children) resize.observe(kid);
    // A picker's label changing — another model, another branch — moves it.
    const labels = new MutationObserver(soon);
    labels.observe(row, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      labels.disconnect();
    };
  }, [ref, hidden, session]);
  return floor;
}

/// The column the card floats in, so it never grows past it.
function useRoom(ref: React.RefObject<HTMLDivElement | null>, hidden: boolean): Size {
  const [room, setRoom] = useState<Size>({ width: Infinity, height: Infinity });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      // A hidden column reads zero; keep the last real size.
      if (el.clientWidth > 0) setRoom({ width: el.clientWidth, height: el.clientHeight });
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, hidden]);
  return room;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

import { useRef, useState } from "react";

const DEAD_ZONE = 4;
const EDGE = 24;
const SPEED = 8;

/// Keeps section dragging and keyboard reordering on the same path.
export function useDragReorder<T>(
  items: readonly T[],
  keyOf: (item: T) => string | number,
  onMove: (item: T, delta: number, to: number) => Promise<unknown> | void,
  axis: "x" | "y" = "y",
) {
  const [order, setOrder] = useState<readonly T[] | null>(null);
  const [drag, setDrag] = useState<{ from: number; to: number; d: number; step: number } | null>(
    null,
  );
  const list = useRef<HTMLDivElement>(null);
  const latest = useRef(items);
  latest.current = items;
  const pending = useRef(false);
  const shown = order ?? items;

  const start = (e: React.PointerEvent<HTMLElement>, from: number) => {
    if (e.button !== 0 || !list.current || pending.current) return;
    if (!e.currentTarget.contains(e.target as Node)) return;
    if ((e.target as Element).closest("button:not([data-grip]), input, textarea")) return;
    e.preventDefault();
    const el = e.currentTarget;
    const lo = axis === "x" ? "left" : "top";
    const hi = axis === "x" ? "right" : "bottom";
    const at = (ev: { clientX: number; clientY: number }) =>
      axis === "x" ? ev.clientX : ev.clientY;
    const origin = at(e);
    const before = shown.map(keyOf).join("\n");
    const rects = [...list.current.children]
      .slice(0, shown.length)
      .map((child) => child.getBoundingClientRect());
    const gap = rects.length > 1 ? rects[1][lo] - rects[0][hi] : 0;
    const step = rects[from][hi] - rects[from][lo] + gap;
    const scale = (rects[from][hi] - rects[from][lo]) / (axis === "x" ? el.offsetWidth : el.offsetHeight);
    const mids = rects.map((r) => (r[lo] + r[hi]) / 2);
    const min = rects[0][lo] - rects[from][lo];
    const max = rects[rects.length - 1][hi] - rects[from][hi];
    let to = from;
    let moved = false;
    const box = list.current;
    const scroll = axis === "x" ? "scrollLeft" : "scrollTop";
    const scrollable =
      axis === "x" ? box.scrollWidth > box.clientWidth : box.scrollHeight > box.clientHeight;
    const scroll0 = box[scroll];
    const edges = box.getBoundingClientRect();
    let pointer = origin;
    let frame = 0;
    el.setPointerCapture(e.pointerId);

    const tick = () => {
      const v = pointer < edges[lo] + EDGE ? -SPEED : pointer > edges[hi] - EDGE ? SPEED : 0;
      if (v) {
        box[scroll] += v;
        update();
      }
      frame = requestAnimationFrame(tick);
    };

    const move = (ev: PointerEvent) => {
      pointer = at(ev);
      if (!moved && Math.abs(pointer - origin) < DEAD_ZONE) return;
      if (!moved) {
        document.body.classList.add("session-drag");
        if (scrollable) frame = requestAnimationFrame(tick);
      }
      moved = true;
      update();
    };

    const update = () => {
      const raw = pointer - origin + box[scroll] - scroll0;
      const d = Math.min(max, Math.max(min, raw));
      const lead = rects[from][lo] + d;
      const trail = rects[from][hi] + d;
      to = from;
      while (to < mids.length - 1 && trail > mids[to + 1]) to++;
      while (to > 0 && lead < mids[to - 1]) to--;
      // Pointer coordinates include the preview scale; CSS transforms use its native pixels.
      setDrag({ from, to, d: d / scale, step: step / scale });
    };

    const end = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      cancelAnimationFrame(frame);
      document.body.classList.remove("session-drag");
      setDrag(null);
      if (!moved || ev.type !== "pointerup") return;
      if (latest.current.map(keyOf).join("\n") !== before) return;
      commit(from, to);
    };

    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  };

  const commit = (from: number, to: number) => {
    const items = latest.current;
    if (pending.current || to === from || to < 0 || to >= items.length) return;
    const next = [...items];
    next.splice(to, 0, ...next.splice(from, 1));
    pending.current = true;
    setOrder(next);
    void Promise.resolve(onMove(items[from], to - from, to))
      .catch(() => undefined)
      .finally(() => {
        pending.current = false;
        setOrder(null);
      });
  };

  const offset = (i: number) => {
    let d = 0;
    if (drag && i === drag.from) d = drag.d;
    else if (drag && drag.from < drag.to && i > drag.from && i <= drag.to) d = -drag.step;
    else if (drag && drag.to < drag.from && i >= drag.to && i < drag.from) d = drag.step;
    return `translate${axis === "x" ? "X" : "Y"}(${d}px)`;
  };

  return { list, shown, drag, start, commit, offset };
}

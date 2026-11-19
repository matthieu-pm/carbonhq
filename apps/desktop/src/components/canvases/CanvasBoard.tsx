import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import {
  layerAppearance,
  newLayer,
  percent,
  resolve,
  type Document,
  type Layer,
  type LayerKind,
  type Page,
} from "./document";
import type { Change } from "./CanvasTheme";

export type Tool = "Select" | "Hand" | LayerKind;
export type View = { x: number; y: number; zoom: number };
export function zoomAt(view: View, next: number, x: number, y: number): View {
  const zoom = Math.min(8, Math.max(0.05, next)),
    ratio = zoom / view.zoom;
  return { zoom, x: x - (x - view.x) * ratio, y: y - (y - view.y) * ratio };
}
type Point = { x: number; y: number };
type Box = Point & { w: number; h: number; angle: number };
type Drag = {
  pointer: number;
  start: Point;
  view: View;
  delta: Point;
  mode: "pan" | "move" | "draw" | "resize";
  local: Point;
  angle: number;
  parent: string | null;
  layer?: Layer;
  size?: Point;
  corner?: string;
};
function vector(p: Point, degrees: number): Point {
  const rad = (degrees * Math.PI) / 180,
    c = Math.cos(rad),
    s = Math.sin(rad);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}
function degrees(value: string) {
  const n = parseFloat(value) || 0;
  return value.endsWith("turn") ? n * 360 : value.endsWith("rad") ? (n * 180) / Math.PI : n;
}
export function CanvasBoard({
  doc,
  page,
  selected,
  select,
  tool,
  setTool,
  view,
  setView,
  change,
}: {
  doc: Document;
  page: Page;
  selected?: Layer;
  select: (id: string | null) => void;
  tool: Tool;
  setTool: (t: Tool) => void;
  view: View;
  setView: React.Dispatch<React.SetStateAction<View>>;
  change: Change;
}) {
  const board = useRef<HTMLDivElement>(null);
  const gesture = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const layers = doc.elements.filter((l) => l.page === page.id);
  const find = (id: string | null) => layers.find((l) => l.id === id);
  function angle(id: string | null) {
    let sum = 0,
      layer = find(id);
    while (layer) {
      sum += degrees(layer.style.rotate ?? "0deg");
      layer = find(layer.parent);
    }
    return sum;
  }
  function geometry(l: Layer, g: Drag | null) {
    if (g?.layer?.id !== l.id) return { x: l.x, y: l.y, style: l.style };
    if (g.mode === "move") return { x: l.x + g.delta.x, y: l.y + g.delta.y, style: l.style };
    if (g.mode === "resize" && g.size && g.corner) {
      const left = g.corner.includes("w"),
        top = g.corner.includes("n");
      const w = Math.max(1, g.size.x + (left ? -1 : 1) * g.delta.x),
        h = Math.max(1, g.size.y + (top ? -1 : 1) * g.delta.y);
      const dw = w - g.size.x,
        dh = h - g.size.y;
      const shift = vector(
        { x: dw * (left ? -0.5 : 0.5), y: dh * (top ? -0.5 : 0.5) },
        degrees(l.style.rotate),
      );
      return {
        x: l.x + shift.x - dw / 2,
        y: l.y + shift.y - dh / 2,
        style: { ...l.style, width: Math.round(w) + "px", height: Math.round(h) + "px" },
      };
    }
    return { x: l.x, y: l.y, style: l.style };
  }
  function node(id: string) {
    return board.current?.querySelector<HTMLElement>('[data-layer="' + CSS.escape(id) + '"]');
  }
  useLayoutEffect(() => {
    const el = selected && node(selected.id),
      root = board.current;
    if (!el || !root) {
      setBox(null);
      return;
    }
    const measure = () => {
      const r = el.getBoundingClientRect(),
        b = root.getBoundingClientRect(),
        w = el.offsetWidth * view.zoom,
        h = el.offsetHeight * view.zoom;
      setBox({
        x: r.left - b.left + r.width / 2 - w / 2,
        y: r.top - b.top + r.height / 2 - h / 2,
        w,
        h,
        angle: angle(selected.id),
      });
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    obs.observe(root);
    return () => obs.disconnect();
  }, [doc, selected, view, drag]);
  useEffect(() => {
    const root = board.current;
    if (!root) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = root.getBoundingClientRect();
      setView((v) =>
        e.ctrlKey || e.metaKey
          ? zoomAt(v, v.zoom * Math.exp(-e.deltaY * 0.012), e.clientX - r.left, e.clientY - r.top)
          : { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY },
      );
    };
    root.addEventListener("wheel", wheel, { passive: false });
    return () => root.removeEventListener("wheel", wheel);
  }, [setView]);
  function down(e: PointerEvent<HTMLDivElement>) {
    if (gesture.current || (e.button !== 0 && e.button !== 1)) return;
    const root = e.currentTarget,
      r = root.getBoundingClientRect(),
      target = e.target as HTMLElement;
    root.focus({ preventScroll: true });
    const corner = target.closest<HTMLElement>("[data-corner]")?.dataset.corner;
    const hit = find(
      target.closest<HTMLElement>("[data-layer], [data-frame-label]")?.dataset.layer ??
        target.closest<HTMLElement>("[data-frame-label]")?.dataset.frameLabel ??
        null,
    );
    const pan = tool === "Hand" || e.button === 1;
    const draw = !pan && tool !== "Select";
    const layer = corner ? selected : hit;
    if (!pan && !draw) select(layer?.id ?? null);
    if (!pan && !draw && !corner && (!layer || find(layer.parent)?.style.display === "flex")) return;
    const parent = draw ? (hit?.kind === "Frame" ? hit.id : (hit?.parent ?? null)) : (layer?.parent ?? null);
    const parentEl = parent && node(parent),
      parentAngle = angle(parent);
    let local = { x: (e.clientX - r.left - view.x) / view.zoom, y: (e.clientY - r.top - view.y) / view.zoom };
    if (parentEl) {
      const p = parentEl.getBoundingClientRect(),
        offset = vector(
          {
            x: (e.clientX - p.left - p.width / 2) / view.zoom,
            y: (e.clientY - p.top - p.height / 2) / view.zoom,
          },
          -parentAngle,
        );
      local = {
        x: offset.x + parentEl.offsetWidth / 2 - parentEl.clientLeft,
        y: offset.y + parentEl.offsetHeight / 2 - parentEl.clientTop,
      };
    }
    const el = layer && node(layer.id);
    const g: Drag = {
      pointer: e.pointerId,
      start: { x: e.clientX, y: e.clientY },
      view,
      delta: { x: 0, y: 0 },
      local,
      parent,
      mode: pan ? "pan" : draw ? "draw" : corner ? "resize" : "move",
      angle: corner && layer ? angle(layer.id) : parentAngle,
      layer,
      corner,
      size: el ? { x: el.offsetWidth, y: el.offsetHeight } : undefined,
    };
    root.setPointerCapture(e.pointerId);
    gesture.current = g;
    setDrag(g);
    e.preventDefault();
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId) return;
    const dx = e.clientX - g.start.x,
      dy = e.clientY - g.start.y;
    if (g.mode === "pan") setView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy });
    const offset = vector({ x: dx / g.view.zoom, y: dy / g.view.zoom }, -g.angle);
    const next = { ...g, delta: { x: Math.round(offset.x), y: Math.round(offset.y) } };
    gesture.current = next;
    setDrag(next);
  }
  function up(e: PointerEvent<HTMLDivElement>) {
    if (gesture.current?.pointer !== e.pointerId) return;
    move(e);
    const g = gesture.current!;
    if (g.mode === "draw" && tool !== "Select" && tool !== "Hand") {
      const sized = Math.hypot(g.delta.x, g.delta.y) * view.zoom > 4;
      const l = newLayer(
        tool,
        page.id,
        g.parent,
        Math.round(g.local.x + (sized ? Math.min(0, g.delta.x) : 0)),
        Math.round(g.local.y + (sized ? Math.min(0, g.delta.y) : 0)),
      );
      if (sized) {
        l.style.width = Math.max(1, Math.abs(g.delta.x)) + "px";
        l.style.height = Math.max(1, Math.abs(g.delta.y)) + "px";
      }
      change((d) => ({ ...d, elements: [...d.elements, l] }));
      select(l.id);
      setTool("Select");
    } else if ((g.mode === "move" || g.mode === "resize") && g.layer && (g.delta.x || g.delta.y)) {
      change((d) => ({
        ...d,
        elements: d.elements.map((l) => (l.id === g.layer?.id ? { ...l, ...geometry(l, g) } : l)),
      }));
    }
    gesture.current = null;
    setDrag(null);
  }
  function render(l: Layer, flex: boolean): React.ReactNode {
    const g = geometry(l, drag),
      children = layers.filter((c) => c.parent === l.id);
    const style: CSSProperties = {
      ...layerAppearance({ ...l, style: g.style }, doc.tokens),
      position: flex ? "relative" : "absolute",
      left: flex ? undefined : g.x,
      top: flex ? undefined : g.y,
      flexShrink: 0,
      boxSizing: "border-box",
    };
    return (
      <div key={l.id} data-layer={l.id} aria-label={l.name} style={style}>
        {l.kind === "Text" ? l.text : children.map((c) => render(c, l.style.display === "flex"))}
      </div>
    );
  }
  const roots = layers.filter((l) => !l.parent);
  return (
    <div
      ref={board}
      className="ce-board"
      role="region"
      aria-label="Canvas drawing area"
      tabIndex={0}
      data-tool={tool}
      style={{
        backgroundColor: `color-mix(in srgb, ${resolve(page.background, doc.tokens)} ${percent(resolve(page.opacity ?? "100%", doc.tokens))}, transparent)`,
      }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onLostPointerCapture={() => {
        gesture.current = null;
        setDrag(null);
      }}
      onPointerCancel={() => {
        gesture.current = null;
        setDrag(null);
      }}
    >
      <div
        className="ce-world"
        style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.zoom})` }}
      >
        {roots.map((l) => render(l, false))}
        {roots
          .filter((l) => l.kind === "Frame")
          .map((l) => {
            const g = geometry(l, drag);
            return (
              <button
                key={l.id}
                data-frame-label={l.id}
                className="ce-frame-label"
                style={{ left: g.x, top: g.y, transform: `scale(${1 / view.zoom}) translateY(-100%)` }}
                onClick={() => select(l.id)}
              >
                {l.name}
              </button>
            );
          })}
      </div>
      {box && selected && (
        <div
          className="ce-selection"
          style={{
            left: box.x,
            top: box.y,
            width: box.w,
            height: box.h,
            transform: `rotate(${box.angle}deg)`,
          }}
        >
          {["nw", "ne", "sw", "se"].map((c) => (
            <span key={c} className={"ce-handle " + c} data-corner={c} />
          ))}
          <span className="ce-dimensions">
            {Math.round(box.w / view.zoom)} × {Math.round(box.h / view.zoom)}
          </span>
        </div>
      )}
      {drag?.mode === "draw" && (
        <div
          className="ce-marquee"
          style={{
            left:
              Math.min(drag.start.x, drag.start.x + vector(drag.delta, drag.angle).x * view.zoom) -
              (board.current?.getBoundingClientRect().left ?? 0),
            top:
              Math.min(drag.start.y, drag.start.y + vector(drag.delta, drag.angle).y * view.zoom) -
              (board.current?.getBoundingClientRect().top ?? 0),
            width: Math.abs(drag.delta.x) * view.zoom,
            height: Math.abs(drag.delta.y) * view.zoom,
          }}
        />
      )}
    </div>
  );
}

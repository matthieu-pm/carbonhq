import { commitPreview } from "./geometryPreview";
import { editLayer } from "./layerEdit";
import {
  createContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent,
} from "react";
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
import type { CanvasSession } from "./useCanvasDocument";
import { GraphicsBatch, GraphicsPage, hitGraphics } from "./GraphicsBatch";
import {
  intersection,
  paintViewport,
  previewGeometry,
  type Bounds,
  type GraphicsScene,
  type PageLayers,
  type PaintItem,
  type PaintGroup,
} from "./graphicsScene";
import { CanvasCamera, zoomAt, type View } from "./canvasCamera";
import { CanvasMarkup } from "./CanvasMarkup";

export type Tool = "Select" | "Hand" | "Pen" | "Comment" | LayerKind;
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
const DragGeometry = createContext<Drag | null>(null);

function vector(p: Point, degrees: number): Point {
  const rad = (degrees * Math.PI) / 180,
    c = Math.cos(rad),
    s = Math.sin(rad);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}
function degrees(value = "0deg") {
  const n = parseFloat(value) || 0;
  if (value.endsWith("turn")) return n * 360;
  if (value.endsWith("grad")) return n * 0.9;
  if (value.endsWith("rad")) return (n * 180) / Math.PI;
  return n;
}
export function CanvasBoard({
  tree,
  scene,
  graphics,
  reference = false,
  doc,
  page,
  selected,
  select,
  tool,
  setTool,
  camera,
  session,
}: {
  tree: PageLayers;
  scene: GraphicsScene;
  graphics: boolean;
  reference?: boolean;
  doc: Document;
  page: Page;
  selected?: Layer;
  select: (id: string | null) => void;
  tool: Tool;
  setTool: (t: Tool) => void;
  camera: CanvasCamera;
  session: CanvasSession;
}) {
  const change = session.change;
  const board = useRef<HTMLDivElement>(null);
  const gesture = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = board.current!;
    const measure = () =>
      setSize((prev) =>
        prev.w === el.clientWidth && prev.h === el.clientHeight
          ? prev
          : { w: el.clientWidth, h: el.clientHeight },
      );
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  const worldElement = useRef<HTMLDivElement>(null);
  const labelContainer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const world = worldElement.current!;
    let zoom = 0;
    const transform = () => {
      const v = camera.get();
      world.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.zoom})`;
      if (zoom !== v.zoom) {
        zoom = v.zoom;
        labelContainer.current!.style.setProperty("--ce-inverse-zoom", String(1 / zoom));
      }
    };
    transform();
    return camera.subscribe(transform);
  }, [camera]);
  const readViewport = useMemo(() => {
    let retained: ReturnType<typeof paintViewport> | null = null;
    return () => {
      const v = camera.get();
      const area = { x: -v.x / v.zoom, y: -v.y / v.zoom, w: size.w / v.zoom, h: size.h / v.zoom };
      retained = paintViewport(retained, area, v.zoom);
      return retained;
    };
  }, [camera, size]);
  const viewport = useSyncExternalStore(camera.subscribe, readViewport);
  const editing =
    drag && (drag.mode === "move" || drag.mode === "resize") && (drag.delta.x !== 0 || drag.delta.y !== 0);
  const retainedPreview = useRef<{ source: GraphicsScene; drag: Drag; scene: GraphicsScene } | null>(null);
  const preview = useMemo(() => {
    if (!graphics || !editing || !drag?.layer) return;
    const previous = retainedPreview.current;
    const source = previous?.source === scene && previous.drag.start === drag.start ? previous.scene : scene;
    return previewGeometry(source, { ...drag.layer, ...geometry(drag.layer, drag) });
  }, [graphics, scene, drag, editing]);
  useLayoutEffect(() => {
    retainedPreview.current = preview && drag?.layer ? { source: scene, drag, scene: preview } : null;
  }, [scene, preview, drag]);
  const flat = graphics ? (preview ?? scene).flat : undefined;
  const showFlat = !!flat && (!editing || !!preview);
  const visible = useMemo(() => (showFlat ? [] : scene.visible(viewport.area)), [showFlat, scene, viewport]);
  const find = (id: string | null) => (id ? tree.byId.get(id) : undefined);
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
    const painted = selected && (preview ?? scene).byId.get(selected.id);
    if (graphics && !el && (flat || painted?.paint) && painted?.layout) {
      setBox({ ...painted.layout, angle: 0 });
      return;
    }
    if (!el || !root) {
      setBox(null);
      return;
    }
    const measure = () => {
      const view = camera.get();
      const r = el.getBoundingClientRect(),
        b = root.getBoundingClientRect(),
        w = el.offsetWidth,
        h = el.offsetHeight;
      setBox({
        x: (r.left - b.left - view.x + r.width / 2) / view.zoom - w / 2,
        y: (r.top - b.top - view.y + r.height / 2) / view.zoom - h / 2,
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
  }, [doc, selected, camera, viewport, drag, scene, preview, graphics, size]);
  useEffect(() => {
    const root = board.current;
    if (!root) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = camera.latest();
      if (e.ctrlKey || e.metaKey) {
        const r = root.getBoundingClientRect();
        camera.move(zoomAt(v, v.zoom * Math.exp(-e.deltaY * 0.012), e.clientX - r.left, e.clientY - r.top));
      } else {
        camera.move({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    root.addEventListener("wheel", wheel, { passive: false });
    return () => root.removeEventListener("wheel", wheel);
  }, [camera]);
  function down(e: PointerEvent<HTMLDivElement>) {
    if (gesture.current || (e.button !== 0 && e.button !== 1)) return;
    const view = camera.get(),
      root = e.currentTarget;
    root.focus({ preventScroll: true });
    if (tool === "Hand" || e.button === 1) {
      gesture.current = {
        mode: "pan",
        pointer: e.pointerId,
        start: { x: e.clientX, y: e.clientY },
        view,
        delta: { x: 0, y: 0 },
        local: { x: 0, y: 0 },
        angle: 0,
        parent: null,
      };
      root.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    const r = root.getBoundingClientRect(),
      target = e.target as HTMLElement;
    const corner = target.closest<HTMLElement>("[data-corner]")?.dataset.corner;
    const point = {
      x: (e.clientX - r.left - view.x) / view.zoom,
      y: (e.clientY - r.top - view.y) / view.zoom,
    };
    let hit: Layer | undefined;
    for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
      if (el === root) break;
      if (!root.contains(el)) continue;
      const id = el.getAttribute("data-layer") ?? el.getAttribute("data-frame-label");
      if (id) {
        hit = find(id);
        break;
      }
      if (el instanceof HTMLCanvasElement && el.dataset.paintStart !== undefined) {
        const id = hitGraphics(el, point.x, point.y);
        if (id) {
          hit = find(id);
          break;
        }
      }
    }
    const draw = tool !== "Select";
    const layer = corner ? selected : hit;
    if (!draw) select(layer?.id ?? null);
    if (!draw && !corner && (!layer || find(layer.parent)?.style.display === "flex")) return;
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
    if (parent && !parentEl) {
      const b = scene.byId.get(parent)?.layout;
      if (b) local = { x: point.x - b.x, y: point.y - b.y };
    }
    const el = layer && node(layer.id);
    const bounds = layer && scene.byId.get(layer.id)?.layout;
    const g: Drag = {
      pointer: e.pointerId,
      start: { x: e.clientX, y: e.clientY },
      view,
      delta: { x: 0, y: 0 },
      local,
      parent,
      mode: draw ? "draw" : corner ? "resize" : "move",
      angle: corner && layer ? angle(layer.id) : parentAngle,
      layer,
      corner,
      size: el ? { x: el.offsetWidth, y: el.offsetHeight } : bounds && { x: bounds.w, y: bounds.h },
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
    if (g.mode === "pan") {
      camera.move({ ...g.view, x: g.view.x + dx, y: g.view.y + dy });
      return;
    }
    const offset = vector({ x: dx / g.view.zoom, y: dy / g.view.zoom }, -g.angle);
    const next = { ...g, delta: { x: Math.round(offset.x), y: Math.round(offset.y) } };
    gesture.current = next;
    setDrag(next);
  }
  function up(e: PointerEvent<HTMLDivElement>) {
    if (gesture.current?.pointer !== e.pointerId) return;
    move(e);
    const g = gesture.current!;
    if (g.mode === "draw" && (tool === "Frame" || tool === "Text" || tool === "Rectangle")) {
      const sized = Math.hypot(g.delta.x, g.delta.y) * g.view.zoom > 4;
      const l = newLayer(
        tool,
        page.id,
        g.parent,
        Math.round(g.local.x + (sized ? Math.min(0, g.delta.x) : 0)),
        Math.round(g.local.y + (sized ? Math.min(0, g.delta.y) : 0)),
      );
      if (tool === "Text" && !g.parent) {
        const sample = document.createElement("canvas").getContext("2d");
        if (sample) {
          sample.fillStyle = "#282828";
          sample.fillRect(0, 0, 1, 1);
          sample.fillStyle = getComputedStyle(e.currentTarget).backgroundColor;
          sample.fillRect(0, 0, 1, 1);
          const [r, g, b] = sample.getImageData(0, 0, 1, 1).data;
          l.effects[0].fields.color = 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 ? "#202020" : "#fafafa";
        }
      }
      if (sized) {
        l.style.width = Math.max(1, Math.abs(g.delta.x)) + "px";
        l.style.height = Math.max(1, Math.abs(g.delta.y)) + "px";
      }
      change((d) => ({ ...d, elements: [...d.elements, l] }));
      select(l.id);
      setTool("Select");
    } else if ((g.mode === "move" || g.mode === "resize") && g.layer && (g.delta.x || g.delta.y)) {
      const layer = g.layer;
      const last = retainedPreview.current;
      change((d) => {
        if (
          last?.source === scene &&
          last.drag.start === g.start &&
          last.drag.delta.x === g.delta.x &&
          last.drag.delta.y === g.delta.y
        ) {
          const next = commitPreview(d, layer, scene, last.scene);
          if (next) return next;
        }
        return editLayer(d, layer, (l) => ({ ...l, ...geometry(l, g) }));
      });
    }
    gesture.current = null;
    setDrag(null);
  }
  const activeLayer = drag?.mode === "move" || drag?.mode === "resize" ? drag.layer : undefined;
  function render(l: Layer, flex: boolean, contents?: React.ReactNode): React.ReactNode {
    const body =
      l.kind === "Text"
        ? l.text
        : (contents ?? tree.children.get(l.id)?.map((c) => render(c, l.style.display === "flex")));
    function element(current: Drag | null) {
      const g = geometry(l, current);
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
          {body}
        </div>
      );
    }
    return l === activeLayer ? (
      <DragGeometry.Consumer key={l.id}>{element}</DragGeometry.Consumer>
    ) : (
      element(null)
    );
  }
  const rasterZoom = viewport.zoom;
  function paintWorld(
    group: PaintGroup,
    items: PaintItem[],
    viewport: Bounds,
    origin: Point,
  ): React.ReactNode[] {
    const nodes: React.ReactNode[] = [];
    let batch: PaintItem[] = [];
    function flush() {
      if (!batch.length) return;
      if (batch.length === 1) {
        nodes.push(render(batch[0].layer, false));
        batch = [];
        return;
      }
      const first = batch[0].order,
        last = batch[batch.length - 1].order;
      const hit = (x: number, y: number) =>
        group
          .visible({ x, y, w: 0, h: 0 })
          .reverse()
          .find(
            (i) =>
              i.order >= first && i.order <= last && i.paint && i.paint.bounds.w > 0 && i.paint.bounds.h > 0,
          )?.layer.id;
      nodes.push(
        <GraphicsBatch
          key={"paint:" + nodes.length}
          items={batch}
          viewport={viewport}
          origin={origin}
          zoom={rasterZoom}
          hit={hit}
        />,
      );
      batch = [];
    }
    for (const item of items) {
      if (item.paint && item.layer !== activeLayer) {
        batch.push(item);
        continue;
      }
      flush();
      let contents: React.ReactNode;
      if (item.group && item.layer !== activeLayer) {
        const inner = item.bounds ? intersection(item.bounds, viewport) : viewport;
        contents = paintWorld(item.group, item.group.visible(inner), inner, {
          x: origin.x + item.layer.x,
          y: origin.y + item.layer.y,
        });
      }
      nodes.push(render(item.layer, false, contents));
    }
    flush();
    return nodes;
  }
  const world = useMemo(
    () =>
      showFlat
        ? null
        : graphics
          ? paintWorld(scene, visible, viewport.area, { x: 0, y: 0 })
          : visible.map((i) => render(i.layer, false)),
    [showFlat, scene, visible, graphics, viewport, doc, activeLayer],
  );
  const capture = (region: Bounds) => scene.visible(region).map((i) => render(i.layer, false));
  const labels = useMemo(
    () => (preview ?? scene).visibleLabels(viewport.area, viewport.zoom),
    [scene, preview, viewport],
  );
  return (
    <div
      ref={board}
      className="ce-board"
      role="region"
      aria-label={reference ? "DOM reference board" : "Canvas drawing area"}
      data-renderer={graphics ? "graphics" : "dom"}
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
      <div className="ce-world" ref={worldElement}>
        {flat && (
          <div hidden={!showFlat}>
            <GraphicsPage flat={flat} area={viewport.area} zoom={viewport.zoom} />
          </div>
        )}
        <DragGeometry.Provider value={drag}>{world}</DragGeometry.Provider>
        <div ref={labelContainer}>
          {labels.map((l) => {
            const g = geometry(find(l.id) ?? l, drag);
            return (
              <button
                key={l.id}
                data-frame-label={l.id}
                className="ce-frame-label"
                style={{ left: g.x, top: g.y, transform: "scale(var(--ce-inverse-zoom)) translateY(-100%)" }}
                onClick={() => select(l.id)}
              >
                {l.name}
              </button>
            );
          })}
        </div>
      </div>
      {reference && <span className="ce-reference-label">DOM reference</span>}
      {box && selected && <Selection box={box} camera={camera} />}
      <CanvasMarkup
        reference={reference}
        capture={capture}
        key={page.id}
        page={page}
        camera={camera}
        tool={tool}
        session={session}
      />
      {drag?.mode === "draw" && (
        <div
          className="ce-marquee"
          style={{
            left:
              Math.min(drag.start.x, drag.start.x + vector(drag.delta, drag.angle).x * drag.view.zoom) -
              (board.current?.getBoundingClientRect().left ?? 0),
            top:
              Math.min(drag.start.y, drag.start.y + vector(drag.delta, drag.angle).y * drag.view.zoom) -
              (board.current?.getBoundingClientRect().top ?? 0),
            width: Math.abs(drag.delta.x) * drag.view.zoom,
            height: Math.abs(drag.delta.y) * drag.view.zoom,
          }}
        />
      )}
    </div>
  );
}

function Selection({ box, camera }: { box: Box; camera: CanvasCamera }) {
  const view = useSyncExternalStore(camera.subscribe, camera.get);
  return (
    <div
      className="ce-selection"
      style={{
        left: view.x + box.x * view.zoom,
        top: view.y + box.y * view.zoom,
        width: box.w * view.zoom,
        height: box.h * view.zoom,
        transform: `rotate(${box.angle}deg)`,
      }}
    >
      {["nw", "ne", "sw", "se"].map((c) => (
        <span key={c} className={"ce-handle " + c} data-corner={c} />
      ))}
      <span className="ce-dimensions">
        {Math.round(box.w)} × {Math.round(box.h)}
      </span>
    </div>
  );
}

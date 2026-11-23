import { useLayoutEffect, useRef, useState } from "react";
import {
  intersection,
  packVertices,
  union,
  type GraphicsScene,
  type Bounds,
  type PaintItem,
} from "./graphicsScene";

const vertex = `#version 300 es
layout(location=0) in vec4 box;
layout(location=1) in vec4 tint;
uniform vec2 size;
uniform vec2 origin;
out vec4 color;
void main() {
  vec2 corner = vec2(gl_VertexID & 1, gl_VertexID >> 1);
  vec2 p = (box.xy - origin + corner * box.zw) / size;
  gl_Position = vec4(p * vec2(2., -2.) + vec2(-1., 1.), 0., 1.);
  color = vec4(tint.rgb * tint.a, tint.a);
}`;
const fragment = `#version 300 es
precision mediump float;
in vec4 color;
out vec4 pixel;
void main() { pixel = color; }`;

export function createPainter(surface: HTMLCanvasElement) {
  const gl = surface.getContext("webgl2", { alpha: true, antialias: true, depth: false, stencil: false });
  if (!gl) return null;
  const program = gl.createProgram()!;
  for (const [kind, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(kind)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  const size = gl.getUniformLocation(program, "size");
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, true, 20, 16);
  gl.vertexAttribDivisor(0, 1);
  gl.vertexAttribDivisor(1, 1);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const origin = gl.getUniformLocation(program, "origin");
  let uploaded:
    | {
        revision: object;
        items: NonNullable<GraphicsScene["flat"]>["index"]["items"];
      }
    | undefined;
  function draw(start: number, count: number) {
    gl!.vertexAttribPointer(0, 4, gl!.FLOAT, false, 20, start * 20);
    gl!.vertexAttribPointer(1, 4, gl!.UNSIGNED_BYTE, true, 20, start * 20 + 16);
    gl!.drawArraysInstanced(gl!.TRIANGLE_STRIP, 0, 4, count);
  }
  const paint = (
    flat: NonNullable<GraphicsScene["flat"]>,
    area: Bounds,
    ranges: { start: number; end: number }[],
  ) => {
    if (gl.isContextLost()) return;
    gl.viewport(0, 0, surface.width, surface.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(size, area.w, area.h);
    gl.uniform2f(origin, area.x, area.y);
    if (uploaded?.revision !== flat.revision) {
      const items = flat.index.items;
      if (uploaded && uploaded.items.positions === items.positions) {
        let updates = flat.dirty;
        if (uploaded.revision !== flat.from) {
          // Preview and commit can be siblings, so compare retained chunks across branches.
          updates = [];
          let start = 0;
          for (let i = 0; i < items.chunks.length; i++) {
            const end = start + items.chunks[i].length;
            if (items.chunks[i] !== uploaded.items.chunks[i]) {
              const last = updates.at(-1);
              if (last?.end === start) last.end = end;
              else updates.push({ start, end });
            }
            start = end;
          }
        }
        for (const { start, end } of updates) {
          gl.bufferSubData(gl.ARRAY_BUFFER, start * 20, new Uint8Array(packVertices(flat, start, end)));
        }
      } else gl.bufferData(gl.ARRAY_BUFFER, packVertices(flat), gl.DYNAMIC_DRAW);
      uploaded = { revision: flat.revision, items };
    }
    for (const r of ranges) draw(r.start, r.end - r.start);
  };
  return Object.assign(paint, {
    dispose() {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    },
  });
}

const sources = new WeakMap<PaintItem["layer"], HTMLImageElement>();
function backingSize(canvas: HTMLCanvasElement, w: number, h: number) {
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
}

const hits = new WeakMap<HTMLCanvasElement, (x: number, y: number) => string | undefined>();
export function hitGraphics(el: HTMLCanvasElement, x: number, y: number) {
  return hits.get(el)?.(x, y);
}
export function GraphicsBatch({
  items,
  viewport,
  zoom,
  origin,
  hit,
}: {
  items: PaintItem[];
  viewport: Bounds;
  zoom: number;
  origin: { x: number; y: number };
  hit: (x: number, y: number) => string | undefined;
}) {
  const area = intersection(
    viewport,
    items.reduce<Bounds | undefined>((b, item) => union(b, item.paint!.bounds), undefined)!,
  );
  const ref = useRef<HTMLCanvasElement>(null);
  const [revision, refresh] = useState(0);
  useLayoutEffect(() => {
    const canvas = ref.current!;
    hits.set(canvas, hit);
    if (!area.w || !area.h) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(area.w * zoom * dpr)),
      h = Math.max(1, Math.round(area.h * zoom * dpr));
    backingSize(canvas, w, h);
    const ctx = canvas.getContext("2d")!;
    const pending = new Set<HTMLImageElement>();
    const repaint = () => refresh((n) => n + 1);
    ctx.setTransform(w / area.w, 0, 0, h / area.h, (-area.x * w) / area.w, (-area.y * h) / area.h);
    ctx.clearRect(area.x, area.y, area.w, area.h);
    for (const item of items) {
      const { bounds: b, color, image } = item.paint!;
      if (!image) {
        ctx.fillStyle = "#" + color.toString(16).padStart(8, "0");
        ctx.fillRect(b.x, b.y, b.w, b.h);
        continue;
      }
      let source = sources.get(item.layer);
      if (!source) {
        source = new Image();
        source.src = image.src;
        sources.set(item.layer, source);
      }
      if (!source.complete) {
        pending.add(source);
        source.addEventListener("load", repaint, { once: true });
        continue;
      }
      if (!source.naturalWidth || !b.w || !b.h) continue;
      const fit = image.fit === "cover" ? Math.max : Math.min;
      const scale = fit(b.w / source.naturalWidth, b.h / source.naturalHeight);
      const width = source.naturalWidth * scale,
        height = source.naturalHeight * scale;
      ctx.save();
      ctx.beginPath();
      ctx.rect(b.x, b.y, b.w, b.h);
      ctx.clip();
      ctx.drawImage(source, b.x + (b.w - width) / 2, b.y + (b.h - height) / 2, width, height);
      ctx.restore();
    }
    return () => pending.forEach((source) => source.removeEventListener("load", repaint));
  }, [items, viewport, zoom, hit, revision]);
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      data-backend="2d"
      data-paint-start={items[0].order}
      data-paint-end={items[items.length - 1].order}
      style={{
        position: "absolute",
        left: area.x - origin.x,
        top: area.y - origin.y,
        width: area.w,
        height: area.h,
      }}
    />
  );
}

export function GraphicsPage({
  flat,
  area,
  zoom,
}: {
  flat: NonNullable<GraphicsScene["flat"]>;
  area: Bounds;
  zoom: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const paint = useRef<ReturnType<typeof createPainter>>(null);
  const [fallback, setFallback] = useState(false);
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    paint.current = createPainter(canvas);
    const lost = () => setFallback(true);
    if (!paint.current) lost();
    canvas.addEventListener("webglcontextlost", lost);
    return () => {
      canvas.removeEventListener("webglcontextlost", lost);
      paint.current?.dispose();
      paint.current = null;
    };
  }, []);
  const hit = (x: number, y: number) => flat.visible({ x, y, w: 0, h: 0 }).at(-1)?.layer.id;
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas || !paint.current || !area.w || !area.h) return;
    hits.set(canvas, hit);
    const scale = zoom * (window.devicePixelRatio || 1);
    backingSize(canvas, Math.max(1, Math.round(area.w * scale)), Math.max(1, Math.round(area.h * scale)));
    paint.current(flat, area, flat.ranges(area));
  }, [flat, area, zoom]);
  if (fallback) {
    const items = flat.visible(area);
    return items.length ? (
      <GraphicsBatch items={items} viewport={area} origin={{ x: 0, y: 0 }} zoom={zoom} hit={hit} />
    ) : null;
  }
  return (
    <canvas
      aria-hidden="true"
      ref={ref}
      data-backend="webgl2"
      data-paint-start="0"
      style={{ position: "absolute", left: area.x, top: area.y, width: area.w, height: area.h }}
    />
  );
}

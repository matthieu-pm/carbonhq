import { committedPreview } from "./geometryPreview";
import { editedSlot } from "./layerEdit";
import { SceneIndex, SceneMap } from "./sceneIndex";
import { resolve, type Layer, type Token } from "./document";

export type Bounds = { x: number; y: number; w: number; h: number };
export type PaintItem = {
  layer: Layer;
  order: number;
  bounds?: Bounds;
  layout?: Bounds;
  group?: PaintGroup;
  paint?: { bounds: Bounds; color: number; image?: { src: string; fit: "cover" | "contain" } };
};

export type PageLayers = {
  elements: Layer[];
  page: string | undefined;
  revision: object;
  topology: object;
  byId: SceneMap<string, Layer>;
  children: SceneMap<string | null, Layer[]>;
  delta?: { from: object; before: Layer; after: Layer };
};

export function pageLayers(elements: Layer[], page: string | undefined, previous?: PageLayers): PageLayers {
  if (previous && previous.page === page && previous.elements === elements) return previous;
  if (previous && previous.page === page && previous.elements.length === elements.length) {
    const hint = editedSlot(previous.elements, elements);
    let changed = hint ?? -1;
    if (hint === undefined) {
      for (let i = 0; i < elements.length; i++) {
        if (elements[i] === previous.elements[i]) continue;
        if (changed !== -1) {
          changed = -2;
          break;
        }
        changed = i;
      }
    }
    if (changed === -1) return { ...previous, elements, delta: undefined };
    if (changed >= 0) {
      const before = previous.elements[changed],
        after = elements[changed];
      if (before.id === after.id && before.page === after.page && before.parent === after.parent) {
        if (after.page !== page) return { ...previous, elements, delta: undefined };
        const siblings = previous.children.get(after.parent)!;
        return {
          elements,
          page,
          revision: {},
          topology: previous.topology,
          byId: previous.byId.with(new Map([[after.id, after]])),
          children: previous.children.with(
            new Map([[after.parent, siblings.map((l) => (l.id === after.id ? after : l))]]),
          ),
          delta: { from: previous.revision, before, after },
        };
      }
    }
  }
  const byId = new Map<string, Layer>();
  const children = new Map<string | null, Layer[]>();
  for (const layer of elements) {
    if (layer.page !== page) continue;
    byId.set(layer.id, layer);
    const siblings = children.get(layer.parent);
    if (siblings) siblings.push(layer);
    else children.set(layer.parent, [layer]);
  }
  return {
    elements,
    page,
    revision: {},
    topology: {},
    byId: SceneMap.from(byId),
    children: SceneMap.from(children),
  };
}

function pixels(value?: string) {
  return value && /^(?:\d+(?:\.\d+)?|\.\d+)px$/.test(value) ? parseFloat(value) : NaN;
}

export function intersection(a: Bounds, b: Bounds): Bounds {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x),
    h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y),
  };
}

type PaintViewport = { area: Bounds; zoom: number };

// The compositor moves the retained content until the camera exposes an edge or needs a new resolution.
export function paintViewport(previous: PaintViewport | null, view: Bounds, zoom: number): PaintViewport {
  if (previous) {
    const { area } = previous;
    if (
      zoom >= previous.zoom * 0.8 &&
      zoom <= previous.zoom * 1.25 &&
      view.x >= area.x &&
      view.y >= area.y &&
      view.x + view.w <= area.x + area.w &&
      view.y + view.h <= area.y + area.h &&
      area.w <= view.w * 2 &&
      area.h <= view.h * 2
    )
      return previous;
  }
  const dx = view.w / 4,
    dy = view.h / 4;
  return { area: { x: view.x - dx, y: view.y - dy, w: view.w + 2 * dx, h: view.h + 2 * dy }, zoom };
}

function fixedBounds(layer: Layer, tokens: Token[], x: number, y: number): Bounds | undefined {
  const s = layer.style;
  if (s.rotate && !["none", "0", "0deg"].includes(resolve(s.rotate, tokens))) return;
  const w = pixels(resolve(s.width, tokens)),
    h = pixels(resolve(s.height, tokens));
  if (Number.isFinite(w) && Number.isFinite(h)) return { x: x + layer.x, y: y + layer.y, w, h };
}

// A texture caches one frame. Keep animated images in CSS so their playback continues.
function staticImage(src: string) {
  if (src.startsWith("data:image/jpeg;base64,")) return true;
  const prefix = "data:image/png;base64,";
  if (!src.startsWith(prefix)) return false;
  let header: string;
  try {
    header = atob(src.slice(prefix.length, prefix.length + 2048));
  } catch {
    return false;
  }
  for (let i = 8; i + 8 <= header.length;) {
    const kind = header.slice(i + 4, i + 8);
    if (kind === "IDAT") return true;
    if (kind === "acTL") return false;
    const size =
      header.charCodeAt(i) * 2 ** 24 +
      header.charCodeAt(i + 1) * 2 ** 16 +
      header.charCodeAt(i + 2) * 256 +
      header.charCodeAt(i + 3);
    i += 12 + size;
  }
  return false;
}

function paintFor(layer: Layer, tokens: Token[], bounds: Bounds) {
  const s = layer.style;
  if (
    (s.overflow && !["hidden", "clip", "visible"].includes(s.overflow)) ||
    layer.kind === "Text" ||
    (s.display && s.display !== "block") ||
    (s.mixBlendMode && s.mixBlendMode !== "normal") ||
    (s.opacity && !["1", "100%"].includes(resolve(s.opacity, tokens))) ||
    Object.entries(s).some(
      ([key, value]) =>
        (key.endsWith("Radius") || key === "padding") && !["0", "0px"].includes(resolve(value, tokens)),
    )
  )
    return;
  const effects = layer.effects.filter((e) => e.enabled);
  if (!effects.length) return { bounds, color: 0 };
  const f = effects[0].fields;
  if (
    effects.length !== 1 ||
    effects[0].kind !== "Fill" ||
    (f.opacity && !["100%", "1"].includes(resolve(f.opacity, tokens)))
  )
    return;
  if (f.type === "Image" && f.image && staticImage(f.image) && (f.fit === "cover" || f.fit === "contain")) {
    return { bounds, color: 0xffffffff, image: { src: f.image, fit: f.fit as "cover" | "contain" } };
  }
  if (f.type !== "Solid") return;
  let color = resolve(f.color, tokens);
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(color);
  if (rgb)
    color =
      "#" +
      rgb
        .slice(1)
        .map((c) => Math.min(255, Number(c)).toString(16).padStart(2, "0"))
        .join("");
  if (!/^#(?:[a-f\d]{3,4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(color)) return;
  color = color.slice(1);
  if (color.length < 5) color = Array.from(color, (c) => c + c).join("");
  return { bounds, color: parseInt(color.length === 6 ? color + "ff" : color, 16) };
}

function spatialIndex(items: PaintItem[]) {
  return SceneIndex.from(
    items.map((item) => [item.layer.id, item] as const),
    (item) => item.paint?.bounds ?? item.bounds,
  );
}

export type PaintGroup = { index: SceneIndex<string, PaintItem>; visible: (area: Bounds) => PaintItem[] };
type FlatPage = {
  revision: object;
  from?: object;
  dirty: { start: number; end: number }[];
  index: SceneIndex<string, PaintItem>;
  visible: (area: Bounds) => PaintItem[];
  ranges: (area: Bounds) => { start: number; end: number }[];
};
export type GraphicsScene = PaintGroup & {
  tree: PageLayers;
  tokens: Token[];
  flat: FlatPage | undefined;
  byId: SceneMap<string, PaintItem>;
  extent: Bounds | undefined;
  labels: SceneIndex<string, Layer>;
  visibleLabels: (area: Bounds, zoom: number) => Layer[];
};

function labelQuery(labels: SceneIndex<string, Layer>) {
  return (area: Bounds, zoom: number) =>
    labels.visible({
      x: area.x - 240 / zoom,
      y: area.y,
      w: area.w + 240 / zoom,
      h: area.h + 32 / zoom,
    });
}

export function graphicsScene(tree: PageLayers, tokens: Token[], previous?: GraphicsScene): GraphicsScene {
  if (previous && previous.tokens === tokens) {
    const preview = committedPreview(previous, tree);
    if (preview) return preview;
    if (previous.tree.revision === tree.revision) return { ...previous, tree };
    const delta = tree.delta;
    if (delta?.from === previous.tree.revision && geometryOnly(delta.before, delta.after)) {
      const next = editGeometry(previous, tree, delta.after);
      if (next) return next;
    }
  }
  const byId = new Map<string, PaintItem>();
  let order = 0;
  let homogeneous = true;
  const quads: PaintItem[] = [];
  let extent: Bounds | undefined;
  const frames = (tree.children.get(null) ?? []).filter((l) => l.kind === "Frame");
  const labels = SceneIndex.from(
    frames.map((f) => [f.id, f] as const),
    (f) => ({ x: f.x, y: f.y, w: 0, h: 0 }),
  );

  function group(parent: string | null, x: number, y: number, clip?: Bounds): PaintGroup {
    const items: PaintItem[] = [];
    for (const layer of tree.children.get(parent) ?? []) {
      const bounds = fixedBounds(layer, tokens, x, y);
      const paint = bounds && paintFor(layer, tokens, bounds);
      const kids = tree.children.has(layer.id);
      const item: PaintItem = { layer, order: order++, layout: bounds };
      if (!paint || paint.image) homogeneous = false;
      if (homogeneous && bounds && paint) {
        const b = clip ? intersection(clip, bounds) : bounds;
        quads.push({ ...item, bounds: b, paint: { bounds: b, color: paint.color } });
      }
      if (bounds && paint && !kids) {
        item.bounds = bounds;
        item.paint = paint;
      } else {
        const effects = layer.effects.filter((e) => e.enabled);
        const clipped = ["hidden", "clip"].includes(layer.style.overflow);
        if (bounds && clipped && !effects.some((e) => ["Shadow", "Outline", "Filter"].includes(e.kind))) {
          item.bounds = bounds;
        }
        // Absolute children of a borderless block share the page's axes. CSS keeps the frame's
        // clipping, opacity and stacking context while the inner graphics plane paints its leaves.
        if (
          kids &&
          bounds &&
          (!layer.style.display || layer.style.display === "block") &&
          !effects.some((e) => e.kind === "Border") &&
          (!layer.style.padding || ["0px", "0"].includes(resolve(layer.style.padding, tokens)))
        ) {
          item.group = group(
            layer.id,
            bounds.x,
            bounds.y,
            clipped ? (clip ? intersection(clip, bounds) : bounds) : clip,
          );
        } else if (kids) {
          homogeneous = false;
        }
      }
      if (parent === null && item.bounds) extent = union(extent, item.bounds);
      items.push(item);
      byId.set(layer.id, item);
    }
    const index = spatialIndex(items);
    return { index, visible: index.visible };
  }
  const root = group(null, 0, 0);
  const flat = homogeneous && quads.length ? staticPage(quads) : undefined;
  return {
    ...root,
    tree,
    tokens,
    flat,
    byId: SceneMap.from(byId),
    extent,
    labels,
    visibleLabels: labelQuery(labels),
  };
}

export function union(a: Bounds | undefined, b: Bounds): Bounds {
  if (!a) return b;
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function packVertices(flat: FlatPage, start = 0, end = flat.index.items.positions.size) {
  const bytes = new ArrayBuffer((end - start) * 20);
  const floats = new Float32Array(bytes),
    colors = new Uint8Array(bytes);
  for (let slot = start; slot < end; slot++) {
    const i = slot - start;
    const { bounds: b, color } = flat.index.items.at(slot).paint!;
    floats[i * 5] = b.x;
    floats[i * 5 + 1] = b.y;
    floats[i * 5 + 2] = b.w;
    floats[i * 5 + 3] = b.h;
    colors[i * 20 + 16] = color >>> 24;
    colors[i * 20 + 17] = color >>> 16;
    colors[i * 20 + 18] = color >>> 8;
    colors[i * 20 + 19] = color;
  }
  return bytes;
}

// Empty clipped slots stay allocated so an edit can reveal them without changing painter order.
function staticPage(quads: PaintItem[]): FlatPage {
  const index = SceneIndex.from(
    quads.map((item) => [item.layer.id, item] as const),
    (item) => {
      const b = item.paint!.bounds;
      return b.w > 0 && b.h > 0 ? b : null;
    },
  );
  return { revision: {}, dirty: [], index, visible: index.visible, ranges: index.ranges };
}

function geometryOnly(before: Layer, after: Layer) {
  if (before.id !== after.id || before.page !== after.page || before.parent !== after.parent) return false;
  if (
    before.kind !== after.kind ||
    before.name !== after.name ||
    before.text !== after.text ||
    before.effects !== after.effects
  )
    return false;
  const keys = new Set([...Object.keys(before.style), ...Object.keys(after.style)]);
  for (const key of keys)
    if (key !== "width" && key !== "height" && before.style[key] !== after.style[key]) return false;
  return Number.isFinite(after.x) && Number.isFinite(after.y);
}

export function previewGeometry(scene: GraphicsScene, layer: Layer): GraphicsScene | undefined {
  if (!scene.flat) return;
  const before = scene.tree.byId.get(layer.id);
  if (!before || !geometryOnly(before, layer)) return;
  return editGeometry(scene, scene.tree, layer);
}

function editGeometry(scene: GraphicsScene, tree: PageLayers, layer: Layer): GraphicsScene | undefined {
  // Descendants managed entirely by CSS have no spatial entry of their own.
  if (!scene.flat && !scene.byId.has(layer.id)) return { ...scene, tree };
  const changed = new Map<string, PaintItem>();
  const quads = new Map<string, PaintItem>();
  let clip: Bounds | undefined;
  let parent = tree.byId.get(layer.parent ?? "");
  const origin = parent ? scene.byId.get(parent.id)?.layout : undefined;
  while (parent) {
    const bounds = scene.byId.get(parent.id)?.layout;
    if (!bounds) return;
    if (["hidden", "clip"].includes(parent.style.overflow)) clip = clip ? intersection(clip, bounds) : bounds;
    parent = tree.byId.get(parent.parent ?? "");
  }
  function update(layer: Layer, x: number, y: number, clip?: Bounds): PaintItem | undefined {
    const old = scene.byId.get(layer.id);
    const bounds = fixedBounds(layer, scene.tokens, x, y);
    if (!old || !!old.layout !== !!bounds) return;
    const item: PaintItem = {
      ...old,
      layer,
      layout: bounds,
      bounds: old.bounds && bounds,
      paint: old.paint && bounds ? { ...old.paint, bounds } : undefined,
    };
    const clipped = bounds && (clip ? intersection(clip, bounds) : bounds);
    if (scene.flat) {
      const paint = scene.flat.index.items.get(layer.id)?.paint;
      if (!paint || !clipped) return;
      quads.set(layer.id, {
        layer,
        order: old.order,
        layout: bounds,
        bounds: clipped,
        paint: { ...paint, bounds: clipped },
      });
    }
    if (old.group && bounds) {
      const kids = new Map<string, PaintItem>();
      const childClip = ["hidden", "clip"].includes(layer.style.overflow) ? clipped : clip;
      for (const child of tree.children.get(layer.id) ?? []) {
        const next = update(child, bounds.x, bounds.y, childClip);
        if (!next) return;
        kids.set(child.id, next);
      }
      const index = old.group.index.with(kids);
      item.group = { index, visible: index.visible };
    }
    changed.set(layer.id, item);
    return item;
  }
  let item = update(layer, origin?.x ?? 0, origin?.y ?? 0, clip);
  if (!item) return;
  let parentId = layer.parent;
  while (parentId) {
    const old = scene.byId.get(parentId);
    if (!old?.group) return;
    const index = old.group.index.with(new Map([[item.layer.id, item]]));
    item = { ...old, group: { index, visible: index.visible } };
    changed.set(parentId, item);
    parentId = old.layer.parent;
  }
  const index = scene.index.with(new Map([[item.layer.id, item]]));
  let extent = scene.extent;
  if (layer.parent === null) {
    extent = undefined;
    for (const chunk of index.items.chunks)
      for (const root of chunk) if (root.bounds) extent = union(extent, root.bounds);
  }
  const labels =
    layer.parent === null && layer.kind === "Frame"
      ? scene.labels.with(new Map([[layer.id, layer]]))
      : scene.labels;
  let flat = scene.flat;
  if (flat) {
    const flatIndex = flat.index.with(quads);
    const slots = [...quads.values()].sort((a, b) => a.order - b.order);
    const dirty: { start: number; end: number }[] = [];
    for (const quad of slots) {
      const slot = quad.order;
      const last = dirty.at(-1);
      if (last?.end === slot) last.end++;
      else dirty.push({ start: slot, end: slot + 1 });
    }
    flat = {
      revision: {},
      from: flat.revision,
      dirty,
      index: flatIndex,
      visible: flatIndex.visible,
      ranges: flatIndex.ranges,
    };
  }
  return {
    ...scene,
    tree,
    index,
    visible: index.visible,
    byId: scene.byId.with(changed),
    extent,
    labels,
    visibleLabels: labelQuery(labels),
    flat,
  };
}

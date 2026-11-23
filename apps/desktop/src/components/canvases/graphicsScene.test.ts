import { describe, expect, it, vi } from "vitest";
import { newLayer, type Layer } from "./document";
import {
  graphicsScene,
  packVertices,
  pageLayers,
  paintViewport,
  previewGeometry,
  type GraphicsScene,
} from "./graphicsScene";

import { createPainter } from "./GraphicsBatch";

const scene = (...layers: Layer[]) => graphicsScene(pageLayers(layers, "page"), []);
const at = (x: number, y: number) => ({ x, y, w: 0, h: 0 });

describe("graphics board", () => {
  it("picks the topmost painted child inside the frame clip", () => {
    const frame = newLayer("Frame", "page", null, 300, 10);
    frame.style.width = "100px";
    const a = newLayer("Rectangle", "page", frame.id, 80, 5);
    const b = { ...a, id: "above" };
    const result = scene(frame, a, b);
    expect(result.flat?.visible(at(390, 25)).map((item) => item.layer.id)).toEqual([frame.id, a.id, b.id]);
    expect(result.flat?.visible(at(410, 25))).toEqual([]);
    expect(result.byId.get(b.id)?.layout).toMatchObject({ x: 380, y: 15, w: 120 });
    expect(result.flat?.ranges(at(-500, 25))).toEqual([]);
    expect(result.flat?.ranges(at(390, 25))).toEqual([{ start: 0, end: 3 }]);
  });

  it("keeps CSS layout intact and batches solid siblings around a text layer in source order", () => {
    const frame = newLayer("Frame", "page", null, 20, 30);
    const solid = newLayer("Rectangle", "page", frame.id, 5, 5);
    const text = newLayer("Text", "page", frame.id, 5, 5);
    const above = { ...solid, id: "above" };
    const result = scene(frame, solid, text, above);
    expect(result.flat).toBeUndefined();
    const hits = result.byId.get(frame.id)?.group?.visible(at(40, 50)) ?? [];
    expect(hits.map((hit) => [hit.layer.id, Boolean(hit.paint)])).toEqual([
      [solid.id, true],
      [text.id, false],
      [above.id, true],
    ]);
    frame.style.display = "flex";
    expect(scene(frame, solid, text).byId.get(frame.id)?.group).toBeUndefined();
  });

  it("uses the full document bounds for fit, including culled layers and labels", () => {
    const a = newLayer("Rectangle", "page", null, -100, 0);
    const b = newLayer("Frame", "page", null, 5000, 100);
    const result = scene(a, b);
    expect(result.extent).toEqual({ x: -100, y: 0, w: 5475, h: 400 });
    expect(result.visible(at(0, 10)).map((i) => i.layer.id)).toEqual([a.id]);
    expect(result.visibleLabels({ x: 5020, y: 80, w: 10, h: 8 }, 1)).toEqual([b]);
  });
});

describe("paint viewport", () => {
  const camera = { x: -120, y: 50, w: 800, h: 600 };
  const first = paintViewport(null, camera, 1);

  it("reuses painted content during nearby pans and pinch zooms", () => {
    expect(paintViewport(first, { ...camera, x: -180, y: 195 }, 1)).toBe(first);
    expect(paintViewport(first, { ...camera, w: 720, h: 540 }, 1.1)).toBe(first);
  });

  it("repaints on leaving any edge, a large scale change, or a viewport resize", () => {
    for (const change of [{ x: -321 }, { x: 81 }, { y: -101 }, { y: 201 }, { w: 1300 }, { w: 100 }]) {
      const view = { ...camera, ...change };
      const next = paintViewport(first, view, 1);
      expect(next).not.toBe(first);
      expect(next.area.x).toBeLessThanOrEqual(view.x);
      expect(next.area.y).toBeLessThanOrEqual(view.y);
      expect(next.area.x + next.area.w).toBeGreaterThanOrEqual(view.x + view.w);
      expect(next.area.y + next.area.h).toBeGreaterThanOrEqual(view.y + view.h);
    }
    expect(paintViewport(first, camera, 2).zoom).toBe(2);
    expect(paintViewport(first, camera, 0.5).zoom).toBe(0.5);
  });
});

const edit = (before: GraphicsScene, layer: Layer) => {
  const elements = before.tree.elements.map((l) => (l.id === layer.id ? layer : l));
  return graphicsScene(pageLayers(elements, before.tree.page, before.tree), before.tokens, before);
};
const ids = (result: GraphicsScene, x: number, y: number) =>
  result.flat!.visible(at(x, y)).map((i) => i.layer.id);
function matchesRebuild(result: GraphicsScene) {
  const rebuilt = graphicsScene(pageLayers(result.tree.elements, result.tree.page), result.tokens);
  expect(Boolean(result.flat)).toBe(Boolean(rebuilt.flat));
  if (result.flat && rebuilt.flat)
    expect(new Uint8Array(packVertices(result.flat))).toEqual(new Uint8Array(packVertices(rebuilt.flat)));
  expect(result.extent).toEqual(rebuilt.extent);
  for (const l of result.tree.elements) {
    const actual = result.byId.get(l.id),
      expected = rebuilt.byId.get(l.id);
    expect(actual?.layout).toEqual(expected?.layout);
    expect(actual?.bounds).toEqual(expected?.bounds);
    expect(actual?.layer).toBe(expected?.layer);
    expect(result.tree.byId.get(l.id)).toBe(l);
    if (actual?.layout) {
      const { x, y, w, h } = actual.layout;
      const area = { x, y, w, h };
      expect(result.flat?.visible(area).map((i) => i.layer.id)).toEqual(
        rebuilt.flat?.visible(area).map((i) => i.layer.id),
      );
      expect(result.visible(area).map((i) => i.layer.id)).toEqual(
        rebuilt.visible(area).map((i) => i.layer.id),
      );
      expect(actual.group?.visible(area).map((i) => i.layer.id)).toEqual(
        expected?.group?.visible(area).map((i) => i.layer.id),
      );
    }
  }
}

describe("incremental geometry", () => {
  it("updates only touched chunks, hit indices and packed slots without changing old scenes", () => {
    const layers = Array.from({ length: 600 }, (_, i) => ({
      ...newLayer("Rectangle", "page", null, i * 200, 0),
      id: `rect-${i}`,
    }));
    const before = scene(...layers),
      bytes = packVertices(before.flat!).slice(0);
    const moved = { ...layers[300], x: -500, y: 800 };
    const after = edit(before, moved);
    expect(after.flat!.from).toBe(before.flat!.revision);
    expect(after.tree.topology).toBe(before.tree.topology);
    expect(after.flat!.dirty).toEqual([{ start: 300, end: 301 }]);
    expect(after.flat!.index.items.chunks[0]).toBe(before.flat!.index.items.chunks[0]);
    expect(after.flat!.index.items.chunks[1]).not.toBe(before.flat!.index.items.chunks[1]);
    expect(after.flat!.index.items.chunks[2]).toBe(before.flat!.index.items.chunks[2]);
    expect(ids(after, 60010, 10)).toEqual([]);
    expect(ids(after, -490, 810)).toEqual([moved.id]);
    expect(after.visible(at(-490, 810)).map((i) => i.layer.id)).toEqual([moved.id]);
    expect(ids(before, 60010, 10)).toEqual([moved.id]);
    expect(before.tree.byId.get(moved.id)).toBe(layers[300]);
    expect(before.tree.children.get(null)?.[300]).toBe(layers[300]);
    expect(new Uint8Array(packVertices(before.flat!))).toEqual(new Uint8Array(bytes));
    expect(after.tree.byId.get(moved.id)).toBe(moved);
    expect(after.tree.children.get(null)?.[300]).toBe(moved);
    expect(after.flat!.ranges(at(-490, 810))).toEqual([{ start: 256, end: 512 }]);
    matchesRebuild(after);
  });

  it("retains clipped slots and reveals them with the right order after moves and frame resizes", () => {
    const frame = newLayer("Frame", "page", null, 300, 10);
    frame.style.width = "100px";
    const hidden = newLayer("Rectangle", "page", frame.id, 150, 5);
    const top = { ...hidden, id: "top" };
    const before = scene(frame, hidden, top);
    expect(ids(before, 460, 25)).toEqual([]);
    expect(packVertices(before.flat!).byteLength).toBe(60);
    const moved = edit(before, { ...hidden, x: 50 });
    expect(ids(moved, 360, 25)).toEqual([frame.id, hidden.id]);
    expect(moved.flat!.dirty).toEqual([{ start: 1, end: 2 }]);
    matchesRebuild(moved);
    const resized = edit(moved, { ...frame, style: { ...frame.style, width: "300px" } });
    expect(ids(resized, 460, 25)).toEqual([frame.id, hidden.id, top.id]);
    expect(resized.flat!.dirty).toEqual([{ start: 0, end: 3 }]);
    matchesRebuild(resized);
    const collapsed = edit(resized, {
      ...resized.tree.byId.get(frame.id)!,
      style: { ...frame.style, width: "0px" },
    });
    expect(ids(collapsed, 300, 25)).toEqual([]);
    matchesRebuild(collapsed);
  });

  it("moves frame descendants, nested clips, labels and fit bounds", () => {
    const frame = newLayer("Frame", "page", null, 10, 20);
    frame.style.width = "100px";
    const nested = newLayer("Frame", "page", frame.id, 60, 0);
    nested.style.width = "80px";
    const child = newLayer("Rectangle", "page", nested.id, 30, 5);
    const before = scene(frame, nested, child);
    const moved = edit(before, { ...frame, x: 2000, y: -200 });
    expect(ids(moved, 2095, -190)).toEqual([frame.id, nested.id, child.id]);
    expect(ids(moved, 2110, -190)).toEqual([]);
    expect(ids(moved, 105, 30)).toEqual([]);
    expect(moved.extent).toEqual({ x: 2000, y: -200, w: 100, h: 300 });
    expect(moved.visibleLabels({ x: 2000, y: -210, w: 100, h: 20 }, 1).map((l) => l.id)).toEqual([frame.id]);
    expect(moved.visibleLabels({ x: 10, y: 0, w: 100, h: 20 }, 1)).toEqual([]);
    matchesRebuild(moved);
    const resized = edit(moved, { ...nested, x: 20, style: { ...nested.style, width: "20px" } });
    expect(ids(resized, 2060, -190)).toEqual([frame.id]);
    matchesRebuild(resized);
  });

  it("keeps previews disposable and supports consecutive previews, undo and redo", () => {
    const frame = newLayer("Frame", "page", null, 10, 20);
    const layer = newLayer("Rectangle", "page", frame.id, 5, 5);
    const before = scene(frame, layer);
    const moved = { ...layer, x: 200, style: { ...layer.style, width: "80px", height: "60px" } };
    const preview = previewGeometry(before, moved)!;
    const preview2 = previewGeometry(preview, { ...moved, x: 250 })!;
    expect(preview2.flat!.from).toBe(preview.flat!.revision);
    expect(preview2.byId.get(layer.id)?.layout).toEqual({ x: 260, y: 25, w: 80, h: 60 });
    expect(preview.tree).toBe(before.tree);
    expect(before.byId.get(layer.id)?.layout?.x).toBe(15);
    const after = edit(before, moved);
    const undo = edit(after, layer),
      redo = edit(undo, moved);
    for (const current of [after, undo, redo]) matchesRebuild(current);
    expect(new Uint8Array(packVertices(undo.flat!))).toEqual(new Uint8Array(packVertices(before.flat!)));
    expect(new Uint8Array(packVertices(redo.flat!))).toEqual(new Uint8Array(packVertices(after.flat!)));
  });

  it("updates solid leaf geometry and indices on mixed pages without rebuilding text or other groups", () => {
    const frame = newLayer("Frame", "page", null, 100, 50);
    frame.style.width = "300px";
    frame.style.height = "200px";
    const leaf = newLayer("Rectangle", "page", frame.id, 5, 5);
    const text = newLayer("Text", "page", frame.id, 5, 5);
    const top = { ...leaf, id: "top", x: 200 };
    const other = newLayer("Frame", "page", null, 2000, 0);
    const otherText = newLayer("Text", "page", other.id, 5, 5);
    const before = scene(frame, leaf, text, top, other, otherText);
    const movedLayer = { ...leaf, x: 150, y: 20, style: { ...leaf.style, width: "40px", height: "30px" } };
    const after = edit(before, movedLayer);
    expect(after.flat).toBeUndefined();
    expect(after.byId.positions).toBe(before.byId.positions);
    expect(after.tree.byId.positions).toBe(before.tree.byId.positions);
    expect(after.byId.get(text.id)).toBe(before.byId.get(text.id));
    expect(after.byId.get(other.id)).toBe(before.byId.get(other.id));
    expect(after.labels).toBe(before.labels);
    expect(after.byId.get(leaf.id)?.layout).toEqual({ x: 250, y: 70, w: 40, h: 30 });
    const group = after.byId.get(frame.id)!.group!;
    expect(group.visible(at(110, 60)).map((i) => i.layer.id)).not.toContain(leaf.id);
    expect(group.visible(at(260, 80)).map((i) => i.layer.id)).toEqual([leaf.id, text.id]);
    expect(
      before.byId
        .get(frame.id)!
        .group!.visible(at(110, 60))
        .map((i) => i.layer.id),
    ).toContain(leaf.id);
    matchesRebuild(after);
    const outside = edit(after, { ...movedLayer, x: 400 });
    expect(outside.byId.positions).toBe(after.byId.positions);
    matchesRebuild(outside);
    const undo = edit(outside, leaf);
    matchesRebuild(undo);
    const resizedText = edit(before, { ...text, style: { ...text.style, width: "90px" } });
    expect(resizedText.byId.positions).toBe(before.byId.positions);
    matchesRebuild(resizedText);
    const movedFrame = edit(before, { ...frame, x: 300 });
    expect(movedFrame.byId.positions).toBe(before.byId.positions);
    matchesRebuild(movedFrame);
    const flex = { ...frame, style: { ...frame.style, display: "flex" } };
    const css = scene(flex, leaf, text);
    const nested = edit(css, { ...leaf, x: 50 });
    expect(nested.index).toBe(css.index);
    expect(nested.tree.children.get(flex.id)?.[0].x).toBe(50);
    matchesRebuild(nested);
  });

  it("keeps row topology stable while current layer values and scene revisions change", () => {
    const layer = newLayer("Rectangle", "page", null, 0, 0);
    const before = pageLayers([layer], "page");
    const renamed = { ...layer, name: "Renamed" };
    const after = pageLayers([renamed], "page", before);
    expect(after.topology).toBe(before.topology);
    expect(after.revision).not.toBe(before.revision);
    expect(after.byId.get(layer.id)?.name).toBe("Renamed");
    const changedKind = pageLayers([{ ...renamed, kind: "Text" }], "page", after);
    expect(changedKind.topology).toBe(before.topology);
    expect(changedKind.byId.get(layer.id)?.kind).toBe("Text");
    expect(pageLayers(changedKind.elements.slice(), "page", changedKind).topology).toBe(before.topology);
  });

  it("matches full rebuilds through repeated nested geometry edits", () => {
    const layers: Layer[] = [];
    for (let i = 0; i < 4; i++) {
      const frame = newLayer("Frame", "page", null, i * 500, i * -300);
      if (i % 2) frame.style.overflow = "visible";
      layers.push(frame);
      for (let j = 0; j < 3; j++) {
        const nested = newLayer("Frame", "page", frame.id, j * 90 - 30, j * 30);
        nested.style.width = "160px";
        nested.style.height = "120px";
        layers.push(nested);
        for (let k = 0; k < 3; k++) layers.push(newLayer("Rectangle", "page", nested.id, k * 70, k * -20));
      }
    }
    let current = scene(...layers),
      seed = 173;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    for (let i = 0; i < 40; i++) {
      const l = current.tree.elements[random() % layers.length];
      current = edit(current, {
        ...l,
        x: (random() % 500) - 250,
        y: (random() % 400) - 200,
        style: { ...l.style, width: (random() % 400) + "px", height: (random() % 300) + "px" },
      });
      expect(current.flat!.from).toBeDefined();
      matchesRebuild(current);
    }
  });

  it("rebuilds for unsupported styles, effects, tokens, structural changes and page switches", () => {
    const frame = newLayer("Frame", "page", null, 0, 0);
    const child = newLayer("Rectangle", "page", frame.id, 5, 5);
    const before = scene(frame, child);
    for (const style of [
      { rotate: "20deg" },
      { display: "flex" },
      { width: "auto" },
      { opacity: "50%" },
    ] as Record<string, string>[]) {
      const after = edit(before, { ...frame, style: { ...frame.style, ...style } });
      expect(after.flat).toBeUndefined();
      expect(previewGeometry(before, { ...frame, style: { ...frame.style, ...style } })).toBeUndefined();
    }
    const color = edit(before, {
      ...child,
      effects: [{ ...child.effects[0], fields: { ...child.effects[0].fields, color: "#f00" } }],
    });
    expect(color.flat!.from).toBeUndefined();
    expect(new Uint8Array(packVertices(color.flat!))).not.toEqual(new Uint8Array(packVertices(before.flat!)));
    const tokenScene = graphicsScene(before.tree, [...before.tokens], before);
    expect(tokenScene.flat!.from).toBeUndefined();
    for (const elements of [
      [child, frame],
      [frame],
      [frame, { ...child, parent: null }],
      [frame, child, { ...child, id: "added" }],
      [
        { ...frame, x: 1 },
        { ...child, x: 2 },
      ],
    ]) {
      const tree = pageLayers(elements, "page", before.tree);
      const result = graphicsScene(tree, before.tokens, before);
      expect(result.flat?.from).toBeUndefined();
      expect(result.tree.topology).not.toBe(before.tree.topology);
      expect(result.tree.elements).toBe(elements);
    }
    const other = pageLayers(before.tree.elements, "other", before.tree);
    expect(graphicsScene(other, before.tokens, before).flat).toBeUndefined();
    expect(other.topology).not.toBe(before.tree.topology);
    const text = newLayer("Text", "page", frame.id, 5, 5);
    const mixed = scene(frame, text, child);
    const changed = edit(mixed, { ...child, x: 30 });
    expect(changed.flat).toBeUndefined();
    expect(
      changed.byId
        .get(frame.id)
        ?.group?.visible(at(35, 10))
        .map((i) => i.layer.id),
    ).toContain(child.id);
  });
});

describe("geometry uploads", () => {
  it("uploads changed slots or chunks across skipped previews, sibling commits, cancel and undo", () => {
    let gpu = new Uint8Array();
    const gl = {
      ARRAY_BUFFER: 1,
      VERTEX_SHADER: 2,
      FRAGMENT_SHADER: 3,
      createProgram: () => ({}),
      createShader: () => ({}),
      createBuffer: () => ({}),
      shaderSource: vi.fn(),
      compileShader: vi.fn(),
      attachShader: vi.fn(),
      deleteShader: vi.fn(),
      linkProgram: vi.fn(),
      getProgramParameter: () => true,
      useProgram: vi.fn(),
      getUniformLocation: () => ({}),
      bindBuffer: vi.fn(),
      enableVertexAttribArray: vi.fn(),
      vertexAttribPointer: vi.fn(),
      vertexAttribDivisor: vi.fn(),
      enable: vi.fn(),
      blendFunc: vi.fn(),
      drawArraysInstanced: vi.fn(),
      isContextLost: () => false,
      viewport: vi.fn(),
      clear: vi.fn(),
      uniform2f: vi.fn(),
      deleteBuffer: vi.fn(),
      deleteProgram: vi.fn(),
      bufferData: vi.fn((_target, data: ArrayBuffer) => {
        gpu = new Uint8Array(data.slice(0));
      }),
      bufferSubData: vi.fn((_target, offset: number, data: Uint8Array) => {
        gpu.set(data, offset);
      }),
    };
    const surface = { getContext: () => gl, width: 100, height: 100 } as unknown as HTMLCanvasElement;
    const painter = createPainter(surface)!;
    const layers = Array.from({ length: 600 }, (_, i) => ({
      ...newLayer("Rectangle", "page", null, i * 200, 0),
      id: `rect-${i}`,
    }));
    const b = layers[300],
      c = layers[550];
    const first = scene(...layers),
      second = edit(first, { ...b, x: 600 }),
      third = edit(second, { ...c, x: 700 });
    const area = { x: 0, y: 0, w: 1000, h: 1000 };
    const draw = (s: GraphicsScene) => {
      painter(s.flat!, area, s.flat!.ranges(area));
      expect(gpu).toEqual(new Uint8Array(packVertices(s.flat!)));
    };
    draw(first);
    draw(second);
    draw(second);
    expect(gl.bufferData).toHaveBeenCalledTimes(1);
    expect(gl.bufferSubData).toHaveBeenCalledTimes(1);
    expect(gl.bufferSubData.mock.calls[0][1]).toBe(300 * 20);
    expect(gl.bufferSubData.mock.calls[0][2].byteLength).toBe(20);
    const fourth = edit(third, { ...b, x: 800 });
    draw(fourth);
    expect(gl.bufferData).toHaveBeenCalledTimes(1);
    expect(gl.bufferSubData.mock.calls[1][1]).toBe(256 * 20);
    expect(gl.bufferSubData.mock.calls[1][2].byteLength).toBe((600 - 256) * 20);
    const sibling = edit(first, { ...b, x: 800 });
    draw(sibling);
    expect(gl.bufferData).toHaveBeenCalledTimes(1);
    draw(first);
    expect(gl.bufferData).toHaveBeenCalledTimes(1);
    expect(gl.bufferSubData.mock.calls.at(-1)![1]).toBe(256 * 20);
    expect(gl.bufferSubData.mock.calls.at(-1)![2].byteLength).toBe(256 * 20);
    const preview = previewGeometry(first, { ...b, x: 900 })!;
    draw(preview);
    const commit = edit(first, { ...b, x: 900 });
    draw(commit);
    expect(gl.bufferData).toHaveBeenCalledTimes(1);
    expect(gl.bufferSubData.mock.calls.at(-1)![1]).toBe(256 * 20);
    expect(gl.bufferSubData.mock.calls.at(-1)![2].byteLength).toBe(256 * 20);
    draw(first);
    expect(gl.bufferData).toHaveBeenCalledTimes(1);
    const structural = scene(...layers, { ...b, id: "added" });
    draw(structural);
    expect(gl.bufferData).toHaveBeenCalledTimes(2);
    painter.dispose();
    expect(gl.deleteBuffer).toHaveBeenCalledOnce();
  });
});

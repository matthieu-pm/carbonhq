import { describe, expect, it } from "vitest";
import type { CanvasFrame, CanvasNode } from "@/types/events";
import type { LayerBox } from "./canvasBoard";
import { applyCanvasEdit, duplicatePicks, layerSlot, reorderLayer, resizedLayer, resolveCanvasToken } from "./canvasEditing";

const element = (id: string, children: CanvasNode[] = []): CanvasNode => ({ id, name: id, kind: "element", tag: "div", attributes: {}, styles: {}, children });
const text: CanvasNode = { id: "text", name: "Text", kind: "text", text: "Label" };
const frame = (nodes: CanvasNode[]): CanvasFrame => ({
  id: "frame", name: "Frame", geometry: { x: 0, y: 0, width: 320, height: 320 },
  content: { nodes, css: "@media (min-width: 300px) { div { gap: 12px } }", assetIds: [] },
});
const box = (id: string, x: number, y: number, styles: Record<string, string> = {}): LayerBox => ({ id, x, y, width: 40, height: 40, styles, text: "" });

describe("Canvas manual edits", () => {
  it("reorders within the original flex parent without changing sizes or authored CSS", () => {
    const items = [element("a"), element("b"), element("c")];
    const original = frame([element("row", items), element("other")]);
    const boxes = [box("row", 0, 0, { display: "flex", "flex-direction": "row" }), box("a", 0, 0), box("b", 48, 0), box("c", 96, 0)];
    const move = reorderLayer(original, "a", boxes, 132, 19);
    expect(move).toMatchObject({ index: 2, edge: { x: 136, width: 0 } });
    const updated = applyCanvasEdit([original], { kind: "reorder", frameId: "frame", nodeId: "a", index: move!.index })[0];
    expect(layerSlot(updated.content.nodes, "a")?.siblings).toEqual([items[1], items[2], items[0]]);
    expect(updated.content.css).toBe(original.content.css);
    expect(updated.geometry).toEqual(original.geometry);
  });

  it("uses the preceding DOM position at the right edge of a reversed flex row", () => {
    const original = frame([element("row", [element("a"), element("b"), element("c")])]);
    const boxes = [box("row", 0, 0, { display: "flex", "flex-direction": "row-reverse" }), box("a", 96, 0), box("b", 48, 0), box("c", 0, 0)];
    expect(reorderLayer(original, "c", boxes, 130, 20)?.index).toBe(0);
  });

  it("uses the target row when reordering across a grid", () => {
    const original = frame([element("grid", [element("a"), element("b"), element("c"), element("d")])]);
    const boxes = [box("grid", 0, 0, { display: "grid", "grid-auto-flow": "row" }), box("a", 0, 0), box("b", 48, 0), box("c", 0, 48), box("d", 48, 48)];
    expect(reorderLayer(original, "a", boxes, 83, 70)).toMatchObject({ index: 3, edge: { x: 88, y: 48 } });
  });

  it("uses root flex direction and changes CSS order only when moving into another order group", () => {
    const original = frame([element("a"), element("b"), element("c")]);
    const boxes = [box("frame", 0, 0, { display: "flex", "flex-direction": "row-reverse" }),
      box("a", 96, 0, { order: "-1" }), box("b", 48, 0), box("c", 0, 0)];
    const move = reorderLayer(original, "a", boxes, 3, 15);
    expect(move).toMatchObject({ index: 2, order: "0" });
    const [edited] = applyCanvasEdit([original], { kind: "reorder", frameId: "frame", nodeId: "a", index: move!.index, order: move!.order });
    expect(edited.content.nodes.at(-1)).toMatchObject({ id: "a", styles: { order: "0" } });
  });

  it("resizes a flex item on its main axis and leaves the other axis alone", () => {
    const parent = box("parent", 0, 0, { display: "flex", "flex-direction": "column" });
    expect(resizedLayer(box("item", 0, 0, { width: "40px", height: "60px" }), 0, 15, false, parent))
      .toEqual({ height: "75px", "flex-basis": "75px", "flex-grow": "0", "flex-shrink": "0" });
  });

  it("resolves project token aliases and nested CSS fallbacks without keeping a missing dependency", () => {
    const tokens = new Map([["--spacing", "calc(var(--base) * 2)"], ["--base", "8px"],
      ["--fill", "var(--missing, rgb(20 40 60 / 60%))"], ["--loop", "var(--loop)"]]);
    expect(resolveCanvasToken("--spacing", tokens)).toBe("calc(8px * 2)");
    expect(resolveCanvasToken("--fill", tokens)).toBe("rgb(20 40 60 / 60%)");
    expect(resolveCanvasToken("--loop", tokens)).toBeUndefined();
  });

  it("edits old nodes carrying non-array style-order metadata", () => {
    const node = { ...element("old"), carbonStyleOrder: 42 };
    const [edited] = applyCanvasEdit([frame([node])], { kind: "style", frameId: "frame", nodeId: "old", styles: { color: "red" }, label: "Colour" });
    expect(edited.content.nodes[0]).toMatchObject({ carbonStyleOrder: ["color"], styles: { color: "red" } });
  });

  it("gives text style a stable layer identity and duplicates descendants only once", () => {
    const [styled] = applyCanvasEdit([frame([text])], { kind: "style", frameId: "frame", nodeId: "text", styles: { color: "red" }, label: "Colour" });
    const wrapper = styled.content.nodes[0];
    expect(wrapper).toMatchObject({ id: text.id, kind: "element", styles: { color: "red" }, children: [{ text: "Label" }] });
    if (wrapper.kind !== "element") throw new Error("Expected the styled text layer");
    const duplicated = duplicatePicks([styled], [{ frameId: "frame", nodeId: wrapper.id }, { frameId: "frame", nodeId: wrapper.children[0].id }]);
    expect(duplicated.picks).toHaveLength(1);
    expect(duplicated.frames[0].content.nodes).toHaveLength(2);
    expect(duplicated.frames[0].content.nodes[1].id).not.toBe(wrapper.id);
  });
});

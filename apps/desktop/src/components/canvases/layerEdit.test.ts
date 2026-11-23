import { expect, it } from "vitest";
import { newLayer, type Document } from "./document";
import { commitPreview } from "./geometryPreview";
import { graphicsScene, pageLayers, previewGeometry } from "./graphicsScene";
import { editLayer, editedSlot } from "./layerEdit";

const a = newLayer("Rectangle", "p", null, 0, 0);
const b = newLayer("Rectangle", "p", null, 200, 0);
const doc: Document = { version: 1, elements: [a, b], tokens: [], pages: [] };

it("uses the same slot in both directions and ignores unrelated versions", () => {
  const first = editLayer(doc, b, (l) => ({ ...l, x: 300 }));
  const second = editLayer(first, b, (l) => ({ ...l, y: 400 }));
  expect(second.elements[1]).toMatchObject({ x: 300, y: 400 });
  expect(editedSlot(doc.elements, first.elements)).toBe(1);
  expect(editedSlot(first.elements, doc.elements)).toBe(1);
  expect(editedSlot(doc.elements, second.elements)).toBeUndefined();
  expect(editLayer(doc, { ...a, id: "deleted" }, (l) => l)).toBe(doc);
});

it("keeps the displayed vertices on release and refuses a preview of stale geometry", () => {
  const tree = pageLayers(doc.elements, "p");
  const base = graphicsScene(tree, doc.tokens);
  const replacement = { ...a, x: 77 };
  const preview = previewGeometry(base, replacement)!;
  const saved = commitPreview(doc, a, base, preview)!;
  const next = graphicsScene(pageLayers(saved.elements, "p", tree), doc.tokens, base);
  expect(next.flat).toBe(preview.flat);
  expect(next.tree.byId.get(a.id)).toBe(next.byId.get(a.id)?.layer);
  expect(next.flat?.visible({ x: 80, y: 5, w: 1, h: 1 }).at(-1)?.layer.id).toBe(a.id);
  const changed = editLayer(doc, b, (l) => ({ ...l, y: 20 }));
  expect(commitPreview(changed, a, base, preview)).toBeUndefined();
});

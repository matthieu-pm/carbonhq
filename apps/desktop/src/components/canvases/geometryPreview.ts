import type { Document, Layer } from "./document";
import type { GraphicsScene, PageLayers } from "./graphicsScene";
import { editLayer } from "./layerEdit";

const commits = new WeakMap<GraphicsScene, { elements: Layer[]; preview: GraphicsScene }>();

export function commitPreview(doc: Document, original: Layer, base: GraphicsScene, preview: GraphicsScene) {
  if (doc.elements !== base.tree.elements || base.tree.byId.get(original.id) !== original) return;
  const painted = preview.byId.get(original.id)?.layer;
  if (!painted) return;
  const next = editLayer(doc, original, () => painted);
  commits.set(base, { elements: next.elements, preview });
  return next;
}

export function committedPreview(base: GraphicsScene, tree: PageLayers) {
  const match = commits.get(base);
  if (match?.elements === tree.elements) return { ...match.preview, tree };
}

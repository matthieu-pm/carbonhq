import type { Document, Layer } from "./document";

// Weak keys let undo use the same edit in reverse without retaining discarded history.
const slots = new WeakMap<Layer[], WeakMap<Layer[], number>>();

export function editedSlot(before: Layer[], after: Layer[]) {
  return slots.get(after)?.get(before) ?? slots.get(before)?.get(after);
}

export function editLayer(doc: Document, target: Layer, update: (layer: Layer) => Layer): Document {
  const before = doc.elements;
  let index = before.indexOf(target);
  if (index < 0) index = before.findIndex((layer) => layer.id === target.id);
  if (index < 0) return doc;
  const layer = update(before[index]);
  if (layer === before[index]) return doc;
  const elements = before.slice();
  elements[index] = layer;
  slots.set(elements, new WeakMap([[before, index]]));
  return { ...doc, elements };
}

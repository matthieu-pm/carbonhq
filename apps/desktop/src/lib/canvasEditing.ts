import type { CanvasFrame, CanvasGeometry, CanvasNode } from "@/types/events";
import type { CanvasPick, LayerBox } from "./canvasBoard";

type StylePatch = Record<string, string>;
type AuthoredStyles = {
  carbonStyleOrder?: string[];
  tokenReferences?: Record<string, unknown>;
};

export type CanvasEditIntent =
  | { kind: "frames"; geometry: Record<string, Partial<CanvasGeometry>>; label: string }
  | { kind: "reorder"; frameId: string; nodeId: string; index: number }
  | { kind: "style"; frameId: string; nodeId: string | null; styles: StylePatch; label: string }
  | { kind: "text"; frameId: string; nodeId: string; text: string };

export function layerSlot(nodes: CanvasNode[], id: string, parent: CanvasNode | null = null): { siblings: CanvasNode[]; parent: CanvasNode | null; index: number } | null {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (node.id === id) return { siblings: nodes, parent, index };
    if (node.kind === "element") {
      const slot = layerSlot(node.children, id, node);
      if (slot) return slot;
    }
  }
  return null;
}

function editLayers(nodes: CanvasNode[], id: string, edit: (nodes: CanvasNode[], index: number) => CanvasNode[]): CanvasNode[] {
  const index = nodes.findIndex(node => node.id === id);
  if (index !== -1) return edit(nodes, index);
  for (const [index, node] of nodes.entries()) {
    if (node.kind === "text") continue;
    const children = editLayers(node.children, id, edit);
    if (children === node.children) continue;
    const next = [...nodes];
    next[index] = { ...node, children };
    return next;
  }
  return nodes;
}

export function insertLayer(nodes: CanvasNode[], layer: CanvasNode, after?: string | null): CanvasNode[] {
  return after ? editLayers(nodes, after, (siblings, index) => [...siblings.slice(0, index + 1), layer, ...siblings.slice(index + 1)])
    : [...nodes, layer];
}

export function editableText(node: CanvasNode | undefined): Extract<CanvasNode, { kind: "text" }> | undefined {
  if (node?.kind === "text") return node;
  if (node?.children.length === 1 && node.children[0].kind === "text") return node.children[0];
}

export function frameStyles(frame: CanvasFrame): StylePatch {
  return (frame.content as { bodyStyles?: StylePatch }).bodyStyles ?? {};
}

function styleNode(node: CanvasNode, patch: StylePatch): CanvasNode {
  if (node.kind === "text") {
    const styles = "width" in patch || "height" in patch ? { display: "inline-block", ...patch } : patch;
    return { kind: "element", id: node.id, tag: "span", name: node.name, attributes: {}, styles, children: [{ ...node, id: crypto.randomUUID() }] };
  }
  const existing = node as typeof node & AuthoredStyles;
  const keys = Object.keys(patch);
  const order = [...new Set([...(existing.carbonStyleOrder ?? []), ...Object.keys(node.styles)])];
  const tokenReferences = existing.tokenReferences && Object.fromEntries(Object.entries(existing.tokenReferences).filter(([key]) => !Object.hasOwn(patch, key)));
  return { ...node, styles: { ...node.styles, ...patch }, carbonStyleOrder: [...order.filter(key => !Object.hasOwn(patch, key)), ...keys], ...(tokenReferences && { tokenReferences }) } as CanvasNode;
}

export function applyCanvasEdit(frames: CanvasFrame[], edit: CanvasEditIntent): CanvasFrame[] {
  return frames.map(frame => {
    if (edit.kind === "frames") return edit.geometry[frame.id] ? { ...frame, geometry: { ...frame.geometry, ...edit.geometry[frame.id] } } : frame;
    if (frame.id !== edit.frameId) return frame;
    if (!edit.nodeId) {
      if (edit.kind !== "style") return frame;
      const bodyStyles = { ...frameStyles(frame) };
      for (const [key, value] of Object.entries(edit.styles)) {
        delete bodyStyles[key];
        bodyStyles[key] = value;
      }
      return { ...frame, content: { ...frame.content, bodyStyles } as CanvasFrame["content"] };
    }
    const nodes = editLayers(frame.content.nodes, edit.nodeId, (siblings, index) => {
      const updated = [...siblings];
      const node = siblings[index];
      if (edit.kind === "reorder") {
        updated.splice(index, 1);
        updated.splice(edit.index, 0, node);
      } else if (edit.kind === "text" && node.kind === "text") {
        updated[index] = { ...node, text: edit.text };
      } else if (edit.kind === "style") {
        updated[index] = styleNode(node, edit.styles);
      }
      return updated;
    });
    return { ...frame, content: { ...frame.content, nodes } };
  });
}

export function rootPicks(frames: CanvasFrame[], picks: CanvasPick[]): CanvasPick[] {
  const selected = new Set(picks.map(pick => pick.nodeId ?? pick.frameId));
  return picks.filter(pick => {
    if (!pick.nodeId) return true;
    if (selected.has(pick.frameId)) return false;
    const nodes = frames.find(frame => frame.id === pick.frameId)?.content.nodes ?? [];
    let parent = layerSlot(nodes, pick.nodeId)?.parent;
    while (parent) {
      if (selected.has(parent.id)) return false;
      parent = layerSlot(nodes, parent.id)?.parent;
    }
    return true;
  });
}

export function deletePicks(frames: CanvasFrame[], picks: CanvasPick[]): CanvasFrame[] {
  const removed = new Set(picks.map(pick => pick.nodeId ?? pick.frameId));
  const filter = (nodes: CanvasNode[]): CanvasNode[] => nodes.filter(node => !removed.has(node.id)).map(node =>
    node.kind === "element" ? { ...node, children: filter(node.children) } : node);
  return frames.filter(frame => !removed.has(frame.id)).map(frame => {
    if (!picks.some(pick => pick.frameId === frame.id)) return frame;
    return { ...frame, content: { ...frame.content, nodes: filter(frame.content.nodes) } };
  });
}

export function duplicatePicks(frames: CanvasFrame[], picks: CanvasPick[]): { frames: CanvasFrame[]; picks: CanvasPick[] } {
  const selected = new Set(rootPicks(frames, picks).map(pick => pick.nodeId ?? pick.frameId));
  const copies: CanvasPick[] = [];
  let right = Math.max(0, ...frames.map(frame => frame.geometry.x + frame.geometry.width));
  const clone = (node: CanvasNode): CanvasNode => {
    const id = crypto.randomUUID();
    return node.kind === "text" ? { ...node, id } : { ...node, id, children: node.children.map(clone) };
  };
  return {
    frames: frames.flatMap(frame => {
      if (selected.has(frame.id)) {
        const id = crypto.randomUUID();
        const x = right + 80;
        right = x + frame.geometry.width;
        copies.push({ frameId: id, nodeId: null });
        return [frame, {
          ...frame, id, name: `${[...frame.name].slice(0, 235).join("")} copy`, geometry: { ...frame.geometry, x },
          content: { ...frame.content, nodes: frame.content.nodes.map(clone) },
        }];
      }
      if (!picks.some(pick => pick.frameId === frame.id)) return [frame];
      const duplicate = (nodes: CanvasNode[]): CanvasNode[] => nodes.flatMap(node => {
        if (selected.has(node.id)) {
          const copy = clone(node);
          copies.push({ frameId: frame.id, nodeId: copy.id });
          return [node, copy];
        }
        return [node.kind === "element" ? { ...node, children: duplicate(node.children) } : node];
      });
      return [{ ...frame, content: { ...frame.content, nodes: duplicate(frame.content.nodes) } }];
    }),
    picks: copies,
  };
}

export function reorderLayer(frame: CanvasFrame, nodeId: string, boxes: LayerBox[], x: number, y: number) {
  const slot = layerSlot(frame.content.nodes, nodeId);
  if (!slot) return null;
  const measured = new Map(boxes.map(box => [box.id, box]));
  const parent = slot.parent ? measured.get(slot.parent.id)?.styles : undefined;
  const direction = parent?.["flex-direction"];
  const grid = parent?.display?.includes("grid");
  const flex = parent?.display?.includes("flex");
  const source = measured.get(nodeId);
  const siblings = slot.siblings.filter(node => node.id !== nodeId);
  const candidates = siblings.flatMap((sibling, index) => {
    const box = measured.get(sibling.id);
    if (!box || !box.width || !box.height || ["fixed", "absolute"].includes(box.styles.position)) return [];
    return [{ box, index }];
  });
  const closest = candidates.reduce<(typeof candidates)[number] | null>((best, candidate) => {
    const distance = (box: LayerBox) => Math.hypot(
      Math.max(box.x - x, 0, x - box.x - box.width),
      Math.max(box.y - y, 0, y - box.y - box.height),
    );
    return !best || distance(candidate.box) < distance(best.box) ? candidate : best;
  }, null);
  if (!closest) return null;
  const { box, index } = closest;
  const horizontal = flex ? direction?.startsWith("row") : grid ? !parent?.["grid-auto-flow"]?.startsWith("column")
    : !!source && Math.abs(source.y - box.y) < Math.min(source.height, box.height) / 2;
  const beforeSide = horizontal
    ? (parent?.direction === "rtl") !== Boolean(flex && direction === "row-reverse")
    : Boolean(flex && direction === "column-reverse");
  const leading = horizontal ? x < box.x + box.width / 2 : y < box.y + box.height / 2;
  const nextIndex = index + (leading !== beforeSide ? 0 : 1);
  if (nextIndex === slot.index) return null;
  const edge = horizontal
    ? { x: box.x + (leading ? 0 : box.width), y: box.y, width: 0, height: box.height }
    : { x: box.x, y: box.y + (leading ? 0 : box.height), width: box.width, height: 0 };
  return { index: nextIndex, edge };
}

export function resizedLayer(box: LayerBox, dx: number, dy: number, text: boolean): StylePatch {
  const styles: StylePatch = {};
  if (text || box.styles.display === "inline") styles.display = "inline-block";
  const [width, height] = text ? [box.width, box.height] : [parseFloat(box.styles.width), parseFloat(box.styles.height)];
  if (Math.round(dx)) styles.width = `${Math.max(1, Math.round((Number.isFinite(width) ? width : box.width) + dx))}px`;
  if (Math.round(dy)) styles.height = `${Math.max(1, Math.round((Number.isFinite(height) ? height : box.height) + dy))}px`;
  return styles;
}

export function movedLayer(box: LayerBox, dx: number, dy: number, text: boolean): StylePatch {
  const values = text ? [] : box.styles.translate?.match(/(?:[^\s(]+\([^)]*\)|[^\s]+)/g) ?? [];
  const [x, y = "0px", z] = values[0] === "none" ? ["0px"] : values;
  const axis = (value: string | undefined, delta: number) => !value || value === "0px" ? `${delta}px` : `calc(${value} + ${delta}px)`;
  return { ...((text || box.styles.display === "inline") && { display: "inline-block" }), translate: [axis(x, dx), axis(y, dy), z].filter(Boolean).join(" ") };
}

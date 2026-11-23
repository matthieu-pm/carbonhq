import { editedSlot } from "./layerEdit";
import { readDocument } from "./model.js";
import type { Document } from "./document";

export type CanvasSavePayload = { previous: string; content: string; gzip?: boolean };
export type CanvasPatch = {
  keys: string[];
  values: [string, unknown][];
  arrays: [string, { length: number; entries: [number, unknown][] }][];
};

// Reference comparisons keep a one-layer edit from cloning every untouched layer into the worker.
export function canvasPatch(before: Document, after: Document): CanvasPatch {
  const old = before as unknown as Record<string, unknown>;
  const next = after as unknown as Record<string, unknown>;
  const patch: CanvasPatch = { keys: Object.keys(next), values: [], arrays: [] };
  for (const key of patch.keys) {
    const a = old[key],
      b = next[key];
    if (a === b) continue;
    if (Array.isArray(a) && Array.isArray(b)) {
      const entries: [number, unknown][] = [];
      const slot = key === "elements" ? editedSlot(before.elements, after.elements) : undefined;
      if (slot !== undefined) entries.push([slot, b[slot]]);
      else for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) entries.push([i, b[i]]);
      patch.arrays.push([key, { length: b.length, entries }]);
    } else patch.values.push([key, b]);
  }
  return patch;
}

export function applyCanvasPatch(doc: Document, patch: CanvasPatch): Document {
  const values = new Map(patch.values);
  const arrays = new Map(patch.arrays);
  const previous = doc as unknown as Record<string, unknown>;
  return Object.fromEntries(
    patch.keys.map((key) => {
      if (values.has(key)) return [key, values.get(key)];
      const delta = arrays.get(key);
      const value = previous[key];
      if (delta && Array.isArray(value)) {
        value.length = delta.length;
        for (const [index, item] of delta.entries) value[index] = item;
      }
      return [key, value];
    }),
  ) as Document;
}

export function canvasContent(doc: Document) {
  return JSON.stringify(doc, null, 2) + "\n";
}

export async function prepareCanvasSave(previous: string, content: string): Promise<CanvasSavePayload> {
  if (
    previous.length + content.length < 1 << 20 ||
    typeof CompressionStream === "undefined" ||
    !globalThis.crypto?.subtle
  )
    return { previous, content };
  const [digest, data] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(previous)),
    new Response(new Blob([content]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer(),
  ]);
  const bytes = new Uint8Array(data);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return {
    previous: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(""),
    content: btoa(binary),
    gzip: true,
  };
}

export async function inflateCanvasGzip(base64: string) {
  const binary = atob(base64);
  const compressed = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) compressed[i] = binary.charCodeAt(i);
  return new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
}

export type CanvasSaveRequest =
  | { type: "reset"; raw: string }
  | { type: "prepare"; patch: CanvasPatch }
  | { type: "commit" }
  | { type: "previous"; raw: string }
  | { type: "matches"; raw: string }
  | { type: "plain" };
export type CanvasSaveReply = CanvasSavePayload | boolean | undefined;

export class CanvasSaveState {
  private doc!: Document;
  private previous = "";
  private content = "";
  async request(request: CanvasSaveRequest): Promise<CanvasSaveReply> {
    switch (request.type) {
      case "reset":
        this.doc = readDocument(request.raw);
        this.previous = request.raw;
        return;
      case "prepare":
        this.doc = applyCanvasPatch(this.doc, request.patch);
        this.content = canvasContent(this.doc);
        return prepareCanvasSave(this.previous, this.content);
      case "commit":
        this.previous = this.content;
        return;
      case "previous":
        this.previous = request.raw;
        return;
      case "matches":
        return this.previous === request.raw;
      case "plain":
        return { previous: this.previous, content: this.content };
    }
  }
}

import { createHash, webcrypto } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { afterEach, expect, it, vi } from "vitest";
import { readDocument, type Document } from "./document";
import {
  applyCanvasPatch,
  canvasContent,
  canvasPatch,
  prepareCanvasSave,
  type CanvasSavePayload,
} from "./canvasSave";

const raw = '{"version":1,"elements":[],"extra":{"unicode":"é ☁️"}}';
afterEach(() => vi.unstubAllGlobals());

it("preserves serialization bytes, property order and unknown fields across edits, deletion and undo", () => {
  let before = readDocument(raw);
  let mirror = structuredClone(before);
  const history = [before];
  for (let n = 0; n < 4; n++) {
    const next = {
      ...before,
      pages: [
        { ...before.pages[0], name: `Page ${n}`, comments: [{ id: "pin", x: n, y: 8, text: 'é ☁️ \\ "\n' }] },
      ],
      elements:
        n % 2
          ? []
          : [
              {
                id: "layer",
                page: "page-1",
                parent: null,
                kind: "Rectangle" as const,
                name: "box",
                text: "",
                x: n,
                y: 0,
                style: {},
                effects: [],
              },
            ],
    };
    mirror = applyCanvasPatch(mirror, structuredClone(canvasPatch(before, next)));
    expect(canvasContent(mirror)).toBe(canvasContent(next));
    history.push(next);
    before = next;
  }
  for (const next of history.reverse()) {
    mirror = applyCanvasPatch(mirror, structuredClone(canvasPatch(before, next)));
    expect(canvasContent(mirror)).toBe(canvasContent(next));
    before = next;
  }
  const reordered = {
    tokens: before.tokens,
    elements: before.elements,
    version: before.version,
    pages: before.pages,
  };
  mirror = applyCanvasPatch(mirror, structuredClone(canvasPatch(before, reordered)));
  expect(canvasContent(mirror)).toBe(canvasContent(reordered));
});

it("posts only the changed layer for a 100,000-layer document", () => {
  const doc = readDocument(raw);
  doc.elements = Array.from({ length: 100_000 }, (_, i) => ({
    id: String(i),
    page: "page-1",
    parent: null,
    kind: "Rectangle",
    name: "box",
    text: "",
    x: i,
    y: 0,
    style: { width: "10px" },
    effects: [],
  }));
  const next: Document = {
    ...doc,
    elements: doc.elements.map((layer, i) => (i === 50_000 ? { ...layer, x: 4 } : layer)),
  };
  const patch = canvasPatch(doc, next);
  expect(patch.arrays[0][1].entries).toEqual([[50_000, next.elements[50_000]]]);
  expect(JSON.stringify(patch).length).toBeLessThan(400);
  const mirror = applyCanvasPatch(structuredClone(doc), structuredClone(patch));
  expect(canvasContent(mirror)).toBe(canvasContent(next));
});

it("gzip keeps UTF-8 content exact and hashes the original disk bytes", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const previous = raw + " ".repeat(1 << 20);
  const content = canvasContent(readDocument(raw));
  const encoded = await prepareCanvasSave(previous, content);
  expect(encoded.gzip).toBe(true);
  expect(encoded.previous).toBe(createHash("sha256").update(previous).digest("hex"));
  expect(gunzipSync(Buffer.from(encoded.content, "base64")).toString()).toBe(content);
});

it.each(["CompressionStream", "crypto"])("keeps plain saves available without %s", async (key) => {
  vi.stubGlobal(key, undefined);
  const previous = raw + " ".repeat(1 << 20);
  expect(await prepareCanvasSave(previous, raw)).toEqual({
    previous,
    content: raw,
  } satisfies CanvasSavePayload);
});

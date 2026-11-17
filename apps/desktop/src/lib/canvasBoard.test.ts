import { describe, expect, it } from "vitest";
import { blankFrame, bounds, canvasSession, fitCamera, frameDocument, frameMarkup, intersects, previewKey, togglePick, zoomCamera } from "./canvasBoard";
import type { CanvasFrame, CanvasNode } from "@/types/events";

const frame = (): CanvasFrame => ({ id: "frame", name: "Checkout", geometry: { x: -100, y: 40, width: 390, height: 844 }, content: { css: "@media(min-width:600px){body{color:red}}", assetIds: [], nodes: [] } });
const element = (attributes: Record<string, string> = {}, tag = "div"): CanvasNode => ({ kind: "element", id: "layer", name: "Card", tag, attributes, styles: { padding: "20px", "border-radius": "var(--radius)" }, children: [{ kind: "text", id: "text", name: "Label", text: '<Pay & "confirm">' }] });

describe("canvas coordinates and selection", () => {
  it("fits negative coordinates and tall frames without clipping", () => {
    const box = bounds([frame().geometry, { x: 400, y: -100, width: 1440, height: 900 }])!;
    const camera = fitCamera(box, 1000, 600);
    expect(camera.x + box.x * camera.zoom).toBeGreaterThanOrEqual(47);
    expect(camera.y + box.y * camera.zoom).toBeGreaterThanOrEqual(47);
    expect(camera.x + (box.x + box.width) * camera.zoom).toBeLessThanOrEqual(953);
    expect(camera.y + (box.y + box.height) * camera.zoom).toBeLessThanOrEqual(553);
  });
  it("holds the pointer's world position while zooming and clamps extreme gestures", () => {
    const camera = { x: -120, y: 50, zoom: 0.5 };
    const next = zoomCamera(camera, 3, 200, 300);
    expect((200 - next.x) / next.zoom).toBe((200 - camera.x) / camera.zoom);
    expect((300 - next.y) / next.zoom).toBe((300 - camera.y) / camera.zoom);
    expect(zoomCamera(camera, 100, 0, 0).zoom).toBe(4);
    expect(zoomCamera(camera, 0, 0, 0).zoom).toBe(0.02);
  });
  it("shift toggles one stable selection and replacement keeps only the new target", () => {
    const a = { frameId: "a", nodeId: null }, b = { frameId: "b", nodeId: "node" };
    expect(togglePick([a], b, true)).toEqual([a, b]);
    expect(togglePick([a, b], a, true)).toEqual([b]);
    expect(togglePick([a], b, false)).toEqual([b]);
  });
  it("finds intersecting frame bounds", () => {
    expect(intersects({ x: 0, y: 0, width: 20, height: 20 }, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
    expect(intersects({ x: 0, y: 0, width: 20, height: 20 }, { x: 30, y: 10, width: 20, height: 20 })).toBe(false);
  });
  it("places blank frames beyond the rightmost frame and leaves the source untouched", () => {
    const original = frame();
    const next = blankFrame("Mobile", 390, 844, [original]);
    expect(next.geometry.x).toBe(370);
    expect(next.content.nodes).toEqual([]);
    expect(next.id).not.toBe(original.id);
    expect(original.geometry.x).toBe(-100);
  });
  it("invalidates content, viewport and tokens, but keeps snapshots when only position changes", () => {
    const a = frame(), b = { ...a, geometry: { ...a.geometry, x: 500 } };
    expect(previewKey(a, {})).toBe(previewKey(b, {}));
    expect(previewKey(a, {})).not.toBe(previewKey({ ...a, geometry: { ...a.geometry, width: 1440 } }, {}));
    expect(previewKey(a, {})).not.toBe(previewKey(a, { "--radius": "12px" }));
  });
});

describe("isolated frame document", () => {
  it("keeps scoped CSS variables with numeric token names", () => {
    const f = frame(); const node = element();
    if (node.kind === "element") node.styles = { "--space-2": "12px", padding: "var(--space-2)", "-webkit-line-clamp": "2" };
    f.content.nodes = [node];
    expect(frameMarkup(f, {}, {})).toContain("--space-2:12px;padding:var(--space-2);-webkit-line-clamp:2");
  });

  it("preserves CSS cascade order across sorted property storage", () => {
    const f = frame();
    const node = element();
    if (node.kind === "element") {
      node.styles = { padding: "var(--space-2)", "padding-left": "24px", "--space-2": "12px" };
      Object.assign(node, { carbonStyleOrder: ["--space-2", "padding-left", "padding"] });
    }
    f.content.nodes = [node];
    expect(frameMarkup(f, {}, {})).toContain("--space-2:12px;padding-left:24px;padding:var(--space-2)");
  });
  it("escapes text and attributes while retaining stable element and text ids", () => {
    const f = frame(); f.content.nodes = [element({ title: '\" onmouseover=\"alert(1)' })];
    const markup = frameMarkup(f, { "--radius": "12px" }, {});
    expect(markup).toContain('data-canvas-id="layer"');
    expect(markup).toContain("<!--canvas-text:text-->");
    expect(markup).toContain("&lt;Pay &amp; &quot;confirm&quot;&gt;");
    expect(markup).toContain('title="&quot; onmouseover=&quot;alert(1)"');
  });
  it("strips active content, navigation, event handlers and app-origin resources", () => {
    const f = frame(); f.content.nodes = [element({ onclick: "alert(1)", href: "javascript:alert(1)", srcdoc: "<script>x</script>", nonce: "fake", "data-canvas-id": "forged", style: "bad" }), element({}, "script"), element({}, "iframe"), element({}, "custom-element")];
    const markup = frameMarkup(f, {}, {});
    expect(markup).not.toMatch(/onclick=|href=|srcdoc=|nonce=|forged|<script|<iframe|<custom-element/);
    const doc = frameDocument(markup, "test-nonce", true);
    expect(doc).toContain("default-src 'none'; img-src data:");
    expect(doc).toContain("script-src 'nonce-test-nonce'");
    expect(doc).toContain("form-action 'none'");
  });
  it("resolves file-owned images and neutralizes stylesheet termination", () => {
    const f = frame(); f.content.nodes = [element({ src: "carbon-canvas-asset://image-id" }, "img")]; f.content.css = "</STYLE><script>bad</script>";
    const markup = frameMarkup(f, {}, { "image-id": "data:image/png;base64,AAAA" });
    expect(markup).toContain('src="data:image/png;base64,AAAA"');
    expect(markup.match(/<\/style>/gi)).toHaveLength(1);
  });
});

it("restores a project session without choosing an archived, removed or foreign session", () => {
  const make = (sessionId: string, projectPath = "/a", archived = false, worktreeRemoved = false) => ({ sessionId, projectPath, archived, worktreeRemoved, hidden: false, aside: false });
  const sessions = [make("current"), make("remembered"), make("other", "/b"), make("archived", "/a", true), make("removed", "/a", false, true)];
  expect(canvasSession("/a", "current", "remembered", sessions)).toBe("current");
  expect(canvasSession("/a", "other", "remembered", sessions)).toBe("remembered");
  expect(canvasSession("/a", "archived", "removed", sessions.filter((s) => ["archived", "removed", "other"].includes(s.sessionId)))).toBeNull();
  expect(canvasSession("/a", null, undefined, sessions.map((s) => ({ ...s, modified: s.sessionId === "remembered" ? "2026-11-17" : "2026-11-16" })))).toBe("remembered");
  expect(canvasSession("carbon://remote/a", "current", "remembered", sessions)).toBeNull();
});

it("never routes Canvas chat into a hidden reviewer or a session set aside", () => {
  const base = { projectPath: "/a", archived: false, worktreeRemoved: false, hidden: false, aside: false };
  const sessions = [{ ...base, sessionId: "visible", modified: "2026-11-16" }, { ...base, sessionId: "reviewer", hidden: true, modified: "2026-11-17" }, { ...base, sessionId: "aside", aside: true, modified: "2026-11-18" }];
  expect(canvasSession("/a", "reviewer", "aside", sessions)).toBe("visible");
  expect(canvasSession("/a", null, undefined, sessions.slice(1))).toBeNull();
});

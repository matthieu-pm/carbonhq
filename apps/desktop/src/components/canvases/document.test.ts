import { describe, expect, it } from "vitest";
import { importTokens, normalizeToken } from "./importTokens";
import { layerAppearance, newEffect, newLayer, readDocument, removeToken, type Token } from "./document";

describe("project canvas documents", () => {
  const legacy = '{"version":1,"elements":[]}';
  it("opens existing empty canvases on their first page", () => {
    const doc = readDocument(legacy);
    expect(doc.pages).toHaveLength(1);
    expect(readDocument(JSON.stringify(doc))).toEqual(doc);
  });
  it("round trips page markup and rejects a stroke with malformed coordinates", () => {
    const doc = readDocument(legacy);
    doc.pages[0].strokes = [{ id: "stroke", points: [[-4.5, 22], [17, 30]] }];
    doc.pages[0].comments = [{ id: "pin", x: 17, y: 30, text: "Round this corner" }];
    expect(readDocument(JSON.stringify(doc))).toEqual(doc);
    doc.pages[0].strokes[0].points[1][0] = NaN;
    expect(() => readDocument(JSON.stringify(doc))).toThrow();
  });
  it("rejects unsupported versions and cyclic layer trees", () => {
    const doc = readDocument(legacy);
    const frame = newLayer("Frame", doc.pages[0].id, null, 0, 0);
    frame.parent = frame.id;
    expect(() => readDocument(JSON.stringify({ ...doc, elements: [frame] }))).toThrow(/hierarchy/);
    expect(() => readDocument('{"version":2,"elements":[]}')).toThrow(/format/);
  });
  it("updates bound paint on multiple layers and detaches to the latest value on deletion", () => {
    const doc = readDocument(legacy);
    const token: Token = { id: "ink", kind: "Color", name: "Brand", value: "#123abc" };
    doc.tokens = [token];
    doc.pages[0].background = "@ink";
    doc.elements = ["Frame", "Text"].map((_, i) =>
      newLayer(i ? "Text" : "Frame", doc.pages[0].id, null, 0, 0),
    );
    doc.elements.forEach((l) => {
      l.effects[0].fields.color = "@ink";
    });
    token.value = "#abcdef";
    doc.elements.forEach((l) => expect(layerAppearance(l, doc.tokens).background).toContain("#abcdef"));
    const detached = removeToken(doc, token);
    expect(detached.pages[0].background).toBe("#abcdef");
    expect(detached.elements.map((l) => l.effects[0].fields.color)).toEqual(["#abcdef", "#abcdef"]);
  });
  it("composes independent outlines, borders, shadows, text stroke and ordered filters", () => {
    const layer = newLayer("Text", "page-1", null, 0, 0);
    layer.effects.push(
      ...(
        [
          "Outline",
          "Border",
          "Shadow",
          "Inner shadow",
          "Text stroke",
          "Filter",
          "Backdrop filter",
          "Filter",
        ] as const
      ).map(newEffect),
    );
    layer.effects.at(-1)!.fields = { type: "invert", amount: "50%" };
    const style = layerAppearance(layer, []);
    expect(style.filter).toBe("blur(4px) invert(50%)");
    expect(style.backdropFilter).toBe("blur(4px)");
    expect(style.boxShadow).toContain(", inset ");
    expect(style.outline).toBe("1px solid #222222");
    expect(style.borderRight).toBe("1px solid #222222");
    expect(style.WebkitTextStroke).toBe("1px #222222");
    layer.effects.at(-1)!.enabled = false;
    expect(layerAppearance(layer, []).filter).toBe("blur(4px)");
  });
  it("reads typed front matter, references, interleaved YAML and CSS variables", () => {
    const source = [
      "---",
      "colors:",
      "  primary: '#112233'",
      "  link: '{colors.primary}'",
      "rounded: {card: 8}",
      "typography:",
      "  heading:",
      "    fontSize: 2rem",
      "    fontFamily: Geist",
      "---",
      "```yaml",
      "spacing: {gutter: 16px}",
      "```",
      "```css",
      ":root { --color-accent: #123abc; }",
      "```",
    ].join("\n");
    expect(importTokens(source).map((t) => [t.name, t.kind, t.value])).toEqual([
      ["primary", "Color", "#112233"],
      ["link", "Color", "#112233"],
      ["card", "Radius", "8px"],
      ["heading.fontSize", "Font size", "2rem"],
      ["heading.fontFamily", "Font family", "Geist"],
      ["gutter", "Spacing", "16px"],
      ["color-accent", "Color", "#123abc"],
    ]);
  });
  it("uses the top enabled border for each side", () => {
    const layer = newLayer("Frame", "page-1", null, 0, 0);
    const top = newEffect("Border");
    top.fields.sides = "Top";
    top.fields.width = "4px";
    layer.effects = [top, newEffect("Border")];
    expect(layerAppearance(layer, []).borderTop).toBe("4px solid #222222");
    expect(layerAppearance(layer, []).borderBottom).toBe("1px solid #222222");
    top.enabled = false;
    expect(layerAppearance(layer, []).borderTop).toBe("1px solid #222222");
  });
  it("accepts embedded raster fills and restricts styles to canvas properties and local values", () => {
    const layer = newLayer("Frame", "page-1", null, 0, 0);
    const canvas = () => JSON.stringify({ ...readDocument(legacy), elements: [layer] });
    layer.effects[0].fields.image = "data:image/png;base64,AAAA";
    expect(() => readDocument(canvas())).not.toThrow();
    layer.style.position = "fixed";
    expect(() => readDocument(canvas())).toThrow();
    delete layer.style.position;
    layer.effects[0].fields.image = "https://example.com/image.png";
    expect(() => readDocument(canvas())).toThrow();
    delete layer.effects[0].fields.image;
    layer.effects[0].fields.color = "var(--primary)";
    expect(() => readDocument(canvas())).toThrow();
  });
  it("imports self-contained values and resolves whole-token aliases", () => {
    const tokens = importTokens(
      "--color-ink: #334455; --color-title: var(--color-ink); --radius-sm: calc(var(--radius) - 4px);",
    );
    expect(tokens.map((t) => t.value)).toEqual(["#334455", "#334455"]);
    expect(["0.5", "50", "50%"].map((v) => normalizeToken("Opacity", v))).toEqual(["50%", "50%", "50%"]);
  });
});

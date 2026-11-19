import type { CSSProperties } from "react";

export const tokenDefaults = {
  Color: "#1612f3",
  Opacity: "100%",
  Radius: "4px",
  Spacing: "8px",
  Container: "1024px",
  Breakpoint: "768px",
  "Font family": "Inter, sans-serif",
  "Font weight": "400",
  "Font size": "16px",
  "Line height": "1.5",
  "Letter spacing": "0px",
};
export type TokenKind = keyof typeof tokenDefaults;
export type Token = { id: string; kind: TokenKind; name: string; value: string };
export type LayerKind = "Frame" | "Rectangle" | "Text";
export const effectTypes = [
  "Fill",
  "Outline",
  "Border",
  "Shadow",
  "Inner shadow",
  "Filter",
  "Backdrop filter",
  "Text stroke",
] as const;
export type EffectKind = (typeof effectTypes)[number];
export type GradientStop = { id: string; color: string; at: string };
export type Effect = {
  stops?: GradientStop[];
  id: string;
  kind: EffectKind;
  enabled: boolean;
  fields: Record<string, string>;
};
export type Layer = {
  id: string;
  page: string;
  parent: string | null;
  kind: LayerKind;
  name: string;
  text: string;
  x: number;
  y: number;
  style: Record<string, string>;
  effects: Effect[];
};
export type Page = { id: string; name: string; background: string; opacity?: string };
export type Document = { version: 1; pages: Page[]; elements: Layer[]; tokens: Token[] };
const styleKeys = new Set([
  "width",
  "height",
  "rotate",
  "opacity",
  "borderRadius",
  "borderTopLeftRadius",
  "borderTopRightRadius",
  "borderBottomLeftRadius",
  "borderBottomRightRadius",
  "mixBlendMode",
  "overflow",
  "display",
  "flexDirection",
  "alignItems",
  "justifyContent",
  "flexWrap",
  "gap",
  "padding",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "fontStyle",
  "textDecoration",
  "textTransform",
]);
const embeddedImage = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
export function localCssValue(value: string) {
  return !/[\\]|\/\*|(?:url|src|image|image-set|paint|element|var|attr)\s*\(/i.test(value);
}
export const uid = () => crypto.randomUUID();
export const filterDefaults: Record<string, string> = {
  blur: "4px",
  brightness: "120%",
  contrast: "120%",
  grayscale: "100%",
  "hue-rotate": "90deg",
  invert: "100%",
  opacity: "50%",
  saturate: "150%",
  sepia: "100%",
  "drop-shadow": "0px 4px 8px #0006",
};
export const blendModes = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
  "plus-lighter",
];
export function newEffect(kind: EffectKind): Effect {
  let fields: Record<string, string>;
  switch (kind) {
    case "Fill":
      fields = {
        type: "Solid",
        opacity: "100%",
        color: "#dddddd",
        end: "#666666",
        angle: "90deg",
        image: "",
        fit: "cover",
      };
      break;
    case "Filter":
    case "Backdrop filter":
      fields = { type: "blur", amount: "4px" };
      break;
    case "Border":
    case "Outline":
    case "Text stroke":
      fields = { color: "#222222", width: "1px", style: "solid", offset: "0px" };
      break;
    default:
      fields = { x: "0px", y: "4px", blur: "12px", spread: "0px", color: "#00000040" };
  }
  return { id: uid(), kind, enabled: true, fields };
}
export function newLayer(kind: LayerKind, page: string, parent: string | null, x: number, y: number): Layer {
  const fill = newEffect("Fill");
  fill.fields.color =
    kind === "Text" ? (parent ? "#202020" : "#fafafa") : kind === "Frame" ? "#ffffff" : "#b9b9be";
  return {
    id: uid(),
    page,
    parent,
    kind,
    name: kind,
    text: kind === "Text" ? "Text" : "",
    x,
    y,
    effects: [fill],
    style: {
      width: kind === "Frame" ? "375px" : "120px",
      height: kind === "Frame" ? "300px" : kind === "Text" ? "fit-content" : "80px",
      rotate: "0deg",
      opacity: "100%",
      borderRadius: "0px",
      mixBlendMode: "normal",
      overflow: kind === "Frame" ? "hidden" : "visible",
      display: "block",
      flexDirection: "column",
      alignItems: "flex-start",
      justifyContent: "flex-start",
      gap: "0px",
      padding: "0px",
      fontFamily: "system-ui",
      fontSize: "16px",
      fontWeight: "400",
      lineHeight: "1.4",
      letterSpacing: "0px",
      textAlign: "left",
    },
  };
}
export function readDocument(raw: string): Document {
  const doc = JSON.parse(raw);
  if (doc?.version !== 1 || !Array.isArray(doc.elements)) throw Error("Unsupported canvas format.");
  doc.pages ??= [{ id: "page-1", name: "Page 1", background: "#282828" }];
  doc.tokens ??= [];
  const validId = (id: unknown) => typeof id === "string" && id.length > 0;
  const strings = (record: unknown) =>
    record != null &&
    typeof record === "object" &&
    !Array.isArray(record) &&
    Object.values(record).every((v) => typeof v === "string");
  const unique = (items: { id: string }[]) => new Set(items.map((i) => i.id)).size === items.length;
  const validEffect = (e: Effect) =>
    e &&
    validId(e.id) &&
    effectTypes.includes(e.kind) &&
    typeof e.enabled === "boolean" &&
    strings(e.fields) &&
    Object.entries(e.fields).every(([key, value]) =>
      key === "image" ? !value || embeddedImage.test(value) : localCssValue(value),
    ) &&
    (e.stops === undefined ||
      (Array.isArray(e.stops) &&
        e.stops.every(
          (s) =>
            s &&
            validId(s.id) &&
            typeof s.color === "string" &&
            typeof s.at === "string" &&
            localCssValue(s.color) &&
            localCssValue(s.at),
        ) &&
        unique(e.stops)));
  if (
    !Array.isArray(doc.pages) ||
    !doc.pages.length ||
    !Array.isArray(doc.tokens) ||
    !doc.pages.every(
      (p: Page) =>
        p &&
        validId(p.id) &&
        typeof p.name === "string" &&
        typeof p.background === "string" &&
        localCssValue(p.background) &&
        (p.opacity === undefined || (typeof p.opacity === "string" && localCssValue(p.opacity))),
    ) ||
    !doc.tokens.every(
      (t: Token) =>
        t &&
        validId(t.id) &&
        Object.hasOwn(tokenDefaults, t.kind) &&
        typeof t.value === "string" &&
        localCssValue(t.value) &&
        typeof t.name === "string",
    ) ||
    !doc.elements.every(
      (l: Layer) =>
        l &&
        validId(l.id) &&
        (l.parent === null || validId(l.parent)) &&
        typeof l.name === "string" &&
        typeof l.text === "string" &&
        Number.isFinite(l.x) &&
        Number.isFinite(l.y) &&
        ["Frame", "Rectangle", "Text"].includes(l.kind) &&
        strings(l.style) &&
        Object.entries(l.style).every(([key, value]) => styleKeys.has(key) && localCssValue(value)) &&
        Array.isArray(l.effects) &&
        l.effects.every(validEffect) &&
        unique(l.effects),
    ) ||
    !unique(doc.tokens)
  )
    throw Error("This canvas contains unsupported data.");
  const layers = new Map<string, Layer>(doc.elements.map((l: Layer) => [l.id, l]));
  const pages = new Set(doc.pages.map((p: Page) => p.id));
  if (layers.size !== doc.elements.length || pages.size !== doc.pages.length)
    throw Error("Duplicate canvas identifiers.");
  for (const layer of layers.values()) {
    if (!pages.has(layer.page)) throw Error("Missing canvas page.");
    const visited = new Set([layer.id]);
    let parent = layer.parent;
    while (parent != null) {
      const container = layers.get(parent);
      if (visited.has(parent) || container?.kind !== "Frame" || container.page !== layer.page)
        throw Error("Invalid layer hierarchy.");
      visited.add(parent);
      parent = container.parent;
    }
  }
  return doc;
}
export function resolve(value: string, tokens: Token[]) {
  return value?.startsWith("@") ? (tokens.find((t) => "@" + t.id === value)?.value ?? "") : value;
}
export function percent(value: string) {
  return value.endsWith("%") ? value : Number.isFinite(Number(value)) ? Number(value) * 100 + "%" : value;
}
export function layerAppearance(layer: Layer, tokens: Token[]): CSSProperties {
  const css = Object.fromEntries(
    Object.entries(layer.style).map(([k, v]) => [
      k === "borderRadius" ? "--ce-layer-radius" : k,
      resolve(v, tokens),
    ]),
  ) as CSSProperties;
  const fills: string[] = [],
    shadows: string[] = [],
    filters: string[] = [],
    backdrop: string[] = [];
  for (const effect of layer.effects.filter((e) => e.enabled)) {
    const f = Object.fromEntries(Object.entries(effect.fields).map(([k, v]) => [k, resolve(v, tokens)]));
    switch (effect.kind) {
      case "Fill":
        {
          const opacity = percent(f.opacity || "100%");
          const paint = (color: string) =>
            opacity === "100%" ? color : `color-mix(in srgb, ${color} ${opacity}, transparent)`;
          const stops = [
            paint(f.color) + " " + (f.startAt || "0%"),
            ...(effect.stops ?? []).map((stop) => paint(resolve(stop.color, tokens)) + " " + stop.at),
            paint(f.end) + " " + (f.endAt || "100%"),
          ].join(", ");
          if (f.type === "Image") {
            if (f.image?.startsWith("data:image/")) {
              const image = 'url("' + f.image + '")';
              const source =
                opacity === "100%"
                  ? image
                  : `-webkit-cross-fade(linear-gradient(transparent, transparent), ${image}, ${opacity})`;
              fills.push(source + " center / " + f.fit + " no-repeat");
            }
          } else if (f.type === "Linear") fills.push(`linear-gradient(${f.angle}, ${stops})`);
          else if (f.type === "Radial") fills.push(`radial-gradient(${stops})`);
          else if (f.type === "Conic") fills.push(`conic-gradient(from ${f.angle}, ${stops})`);
          else fills.push(`linear-gradient(${paint(f.color)}, ${paint(f.color)})`);
        }
        break;
      case "Shadow":
      case "Inner shadow":
        shadows.push(
          [effect.kind === "Inner shadow" ? "inset" : "", f.x, f.y, f.blur, f.spread, f.color]
            .join(" ")
            .trim(),
        );
        break;
      case "Filter":
      case "Backdrop filter":
        (effect.kind === "Filter" ? filters : backdrop).push(`${f.type}(${f.amount})`);
        break;
      case "Border": {
        const stroke = `${f.width} ${f.style} ${f.color}`;
        for (const side of ["Top", "Right", "Bottom", "Left"] as const)
          if (!f.sides || f.sides === "All" || f.sides === side) css[`border${side}`] ??= stroke;
        break;
      }
      case "Outline":
        css.outline = `${f.width} ${f.style} ${f.color}`;
        css.outlineOffset = f.offset;
        break;
      case "Text stroke":
        css.WebkitTextStroke = `${f.width} ${f.color}`;
        break;
    }
  }
  css.background = fills.join(", ");
  if (layer.kind === "Text") {
    css.backgroundClip = "text";
    css.WebkitBackgroundClip = "text";
    css.color = "transparent";
    css.whiteSpace = "pre-wrap";
  }
  css.boxShadow = shadows.join(", ");
  css.filter = filters.join(" ");
  css.backdropFilter = css.WebkitBackdropFilter = backdrop.join(" ");
  return css;
}
export function removeToken(doc: Document, token: Token): Document {
  const detach = (v: string) => (v === "@" + token.id ? token.value : v);
  const fields = (record: Record<string, string>) =>
    Object.fromEntries(Object.entries(record).map(([k, v]) => [k, detach(v)]));
  return {
    ...doc,
    tokens: doc.tokens.filter((t) => t.id !== token.id),
    pages: doc.pages.map((p) => ({
      ...p,
      background: detach(p.background),
      opacity: p.opacity && detach(p.opacity),
    })),
    elements: doc.elements.map((l) => ({
      ...l,
      style: fields(l.style),
      effects: l.effects.map((e) => ({
        ...e,
        fields: fields(e.fields),
        stops: e.stops?.map((s) => ({ ...s, color: detach(s.color) })),
      })),
    })),
  };
}

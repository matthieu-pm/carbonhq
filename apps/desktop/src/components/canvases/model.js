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
export const effectTypes = [
  "Fill",
  "Outline",
  "Border",
  "Shadow",
  "Inner shadow",
  "Filter",
  "Backdrop filter",
  "Text stroke",
];
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
export function localCssValue(value) {
  return !/[\\]|\/\*|(?:url|src|image|image-set|paint|element|var|attr)\s*\(/i.test(value);
}
export const uid = () => crypto.randomUUID();
export const filterDefaults = {
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
export function newEffect(kind) {
  let fields;
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
      fields = {
        type: "blur",
        amount: "4px",
      };
      break;
    case "Border":
    case "Outline":
    case "Text stroke":
      fields = {
        color: "#222222",
        width: "1px",
        style: "solid",
        offset: "0px",
      };
      break;
    default:
      fields = {
        x: "0px",
        y: "4px",
        blur: "12px",
        spread: "0px",
        color: "#00000040",
      };
  }
  return {
    id: uid(),
    kind,
    enabled: true,
    fields,
  };
}
export function newLayer(kind, page, parent, x, y) {
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
export function readDocument(raw) {
  const doc = JSON.parse(raw);
  if (doc?.version !== 1 || !Array.isArray(doc.elements)) throw Error("Unsupported canvas format.");
  doc.pages ??= [
    {
      id: "page-1",
      name: "Page 1",
      background: "#282828",
    },
  ];
  doc.tokens ??= [];
  const validId = (id) => typeof id === "string" && id.length > 0;
  const strings = (record) =>
    record != null &&
    typeof record === "object" &&
    !Array.isArray(record) &&
    Object.values(record).every((v) => typeof v === "string");
  const unique = (items) => new Set(items.map((i) => i.id)).size === items.length;
  const validEffect = (e) =>
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
      (p) =>
        p &&
        validId(p.id) &&
        typeof p.name === "string" &&
        typeof p.background === "string" &&
        localCssValue(p.background) &&
        (p.strokes === undefined ||
          (Array.isArray(p.strokes) &&
            p.strokes.every(
              (s) =>
                s &&
                validId(s.id) &&
                Array.isArray(s.points) &&
                s.points.length > 0 &&
                s.points.every((pt) => Array.isArray(pt) && pt.length === 2 && pt.every(Number.isFinite)),
            ) &&
            unique(p.strokes))) &&
        (p.comments === undefined ||
          (Array.isArray(p.comments) &&
            p.comments.every(
              (c) =>
                c &&
                validId(c.id) &&
                Number.isFinite(c.x) &&
                Number.isFinite(c.y) &&
                typeof c.text === "string",
            ) &&
            unique(p.comments))) &&
        (p.opacity === undefined || (typeof p.opacity === "string" && localCssValue(p.opacity))),
    ) ||
    !doc.tokens.every(
      (t) =>
        t &&
        validId(t.id) &&
        Object.hasOwn(tokenDefaults, t.kind) &&
        typeof t.value === "string" &&
        localCssValue(t.value) &&
        typeof t.name === "string",
    ) ||
    !doc.elements.every(
      (l) =>
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
  const layers = new Map(doc.elements.map((l) => [l.id, l]));
  const pages = new Set(doc.pages.map((p) => p.id));
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
export function resolve(value, tokens) {
  return value?.startsWith("@") ? (tokens.find((t) => "@" + t.id === value)?.value ?? "") : value;
}
export function percent(value) {
  return value.endsWith("%") ? value : Number.isFinite(Number(value)) ? Number(value) * 100 + "%" : value;
}
export function removeToken(doc, token) {
  const detach = (v) => (v === "@" + token.id ? token.value : v);
  const fields = (record) => Object.fromEntries(Object.entries(record).map(([k, v]) => [k, detach(v)]));
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
        stops: e.stops?.map((s) => ({
          ...s,
          color: detach(s.color),
        })),
      })),
    })),
  };
}

export const presets = {
  Phone: { "iPhone 16": [393, 852], "Android compact": [360, 800] },
  Tablet: { "iPad mini": [744, 1133], "iPad Pro 13″": [1032, 1376] },
  Desktop: {
    "MacBook Air": [1280, 832],
    "MacBook Pro 14″": [1512, 982],
    "MacBook Pro 16″": [1728, 1117],
    "iMac 24″": [2240, 1260],
    "Studio Display 27″": [2560, 1440],
    "Full HD": [1920, 1080],
    Wireframe: [1440, 1024],
  },
  Presentation: { "16:9": [1920, 1080], "4:3": [1024, 768] },
  Smartwatch: { "Apple Watch": [198, 242] },
  Paper: { A4: [794, 1123], "US Letter": [816, 1056] },
  "Social media": { Square: [1080, 1080], Story: [1080, 1920] },
};

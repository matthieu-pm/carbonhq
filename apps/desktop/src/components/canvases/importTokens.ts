import { parse } from "yaml";
import { uid, type Token, type TokenKind } from "./document";

const groups: Record<string, TokenKind> = {
  colors: "Color",
  opacity: "Opacity",
  rounded: "Radius",
  radius: "Radius",
  spacing: "Spacing",
  containers: "Container",
  breakpoints: "Breakpoint",
  fontFamily: "Font family",
  fontWeight: "Font weight",
  fontSize: "Font size",
  lineHeight: "Line height",
  letterSpacing: "Letter spacing",
};
const lengthKinds = new Set<TokenKind>([
  "Radius",
  "Spacing",
  "Container",
  "Breakpoint",
  "Font size",
  "Letter spacing",
]);
export function normalizeToken(kind: TokenKind, value: string) {
  const v = value.trim();
  if (kind === "Opacity" && /^(?:\d+\.?\d*|\.\d+)$/.test(v)) {
    const n = Number(v);
    return (n <= 1 ? n * 100 : n) + "%";
  }
  if (lengthKinds.has(kind) && /^-?\d+(\.\d+)?$/.test(v)) return v + "px";
  return v;
}
export const tokenProperty: Record<TokenKind, string> = {
  Color: "color",
  Opacity: "opacity",
  Radius: "border-radius",
  Spacing: "gap",
  Container: "width",
  Breakpoint: "width",
  "Font family": "font-family",
  "Font weight": "font-weight",
  "Font size": "font-size",
  "Line height": "line-height",
  "Letter spacing": "letter-spacing",
};

export function importTokens(markdown: string): Token[] {
  const entries = new Map<string, { name: string; kind: TokenKind; raw: string }>();
  const walk = (node: unknown, path: string[], kind?: TokenKind) => {
    if (node && typeof node === "object" && !Array.isArray(node)) {
      for (const [name, child] of Object.entries(node)) {
        const next = Object.hasOwn(groups, name) ? groups[name] : kind;
        if (path.length || next || name === "typography") walk(child, [...path, name], next);
      }
    } else if (kind && (typeof node === "string" || typeof node === "number")) {
      const name = path.slice(1).join(".");
      if (name) entries.set(path.join("."), { name, kind, raw: String(node) });
    }
  };
  const lines = markdown.replaceAll("\r\n", "\n");
  const blocks = [
    lines.match(/^---[ \t]*\n([\s\S]*?)\n---(?:\n|$)/)?.[1],
    ...Array.from(lines.matchAll(/^```(?:yaml|yml|design-tokens)[ \t]*\n([\s\S]*?)^```/gim), (m) => m[1]),
  ];
  for (const block of blocks) {
    if (block) walk(parse(block, { maxAliasCount: 0 }), []);
  }
  for (const match of lines.matchAll(/--([\w-]+)\s*:\s*([^;{}\n]+);/g)) {
    const [, name, raw] = match;
    const prefixes: [RegExp, TokenKind][] = [
      [/^radius-/, "Radius"],
      [/^(spacing|space|gap)-/, "Spacing"],
      [/^breakpoint-/, "Breakpoint"],
      [/^container-/, "Container"],
      [/^font-weight-/, "Font weight"],
      [/^(text|font-size)-/, "Font size"],
      [/^font-/, "Font family"],
      [/^leading-/, "Line height"],
      [/^tracking-/, "Letter spacing"],
      [/^opacity-/, "Opacity"],
    ];
    const kind = prefixes.find(([pattern]) => pattern.test(name))?.[1] ?? "Color";
    if (
      kind !== "Color" ||
      /^#|^(rgba?|hsla?|oklch|oklab|color|var)\(/i.test(raw.trim()) ||
      name.startsWith("color-")
    )
      entries.set("--" + name, { name, kind, raw: raw.trim() });
  }
  const valueOf = (key: string, seen: Set<string>): string | undefined => {
    const entry = entries.get(key);
    if (!entry || seen.has(key)) return undefined;
    const ref = entry.raw.match(/^\{([\w.-]+)\}$|^var\((--[\w-]+)\)$/);
    return ref ? valueOf(ref[1] || ref[2], seen.add(key)) : normalizeToken(entry.kind, entry.raw);
  };
  const tokens: Token[] = [];
  for (const [key, entry] of entries) {
    const value = valueOf(key, new Set());
    if (value && (typeof CSS === "undefined" || CSS.supports(tokenProperty[entry.kind], value)))
      tokens.push({ id: uid(), name: entry.name, kind: entry.kind, value });
  }
  return tokens;
}

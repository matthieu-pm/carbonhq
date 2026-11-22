import type { CSSProperties } from "react";
import { tokenDefaults, effectTypes, resolve, percent } from "./model.js";
export * from "./model.js";

export type TokenKind = keyof typeof tokenDefaults;
export type Token = { id: string; kind: TokenKind; name: string; value: string };
export type LayerKind = "Frame" | "Rectangle" | "Text";
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
export type InkPoint = [number, number];
export type Stroke = { id: string; points: InkPoint[] };
export type CommentPin = { id: string; x: number; y: number; text: string };
export type Page = {
  id: string;
  name: string;
  background: string;
  opacity?: string;
  strokes?: Stroke[];
  comments?: CommentPin[];
};
export type Document = { version: 1; pages: Page[]; elements: Layer[]; tokens: Token[] };

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

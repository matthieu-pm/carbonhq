import type { Document, Effect, EffectKind, Layer, LayerKind, Token } from "./document";
export const tokenDefaults: Record<
  | "Color"
  | "Opacity"
  | "Radius"
  | "Spacing"
  | "Container"
  | "Breakpoint"
  | "Font family"
  | "Font weight"
  | "Font size"
  | "Line height"
  | "Letter spacing",
  string
>;
export const effectTypes: readonly [
  "Fill",
  "Outline",
  "Border",
  "Shadow",
  "Inner shadow",
  "Filter",
  "Backdrop filter",
  "Text stroke",
];
export const filterDefaults: Record<string, string>;
export const blendModes: string[];
export function localCssValue(value: string): boolean;
export function uid(): string;
export function newEffect(kind: EffectKind): Effect;
export function newLayer(kind: LayerKind, page: string, parent: string | null, x: number, y: number): Layer;
export function readDocument(raw: string): Document;
export function resolve(value: string, tokens: Token[]): string;
export function percent(value: string): string;
export function removeToken(doc: Document, token: Token): Document;
export const presets: Record<string, Record<string, [number, number]>>;

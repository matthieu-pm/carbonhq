import type { CanvasFrame, CanvasGeometry } from "@/types/events";
export function frameMarkup(frame: CanvasFrame, tokens: Record<string, string>, assets: Record<string, string> | null): string;
export function frameDocument(markup: string, token: string, capture: boolean, viewport?: Pick<CanvasGeometry, "width" | "height">, point?: { x: number; y: number }, detail?: string): string;

import { frameDocument } from "./canvasRenderer.js";
import type { CanvasCamera, CanvasFrame, CanvasGeometry, CanvasNode, SessionIndexItem } from "@/types/events";

export const CANVAS_PANEL_TABS = ["chat", "preview", "properties"] as const;
export type CanvasPanelTab = typeof CANVAS_PANEL_TABS[number];

export type CanvasPick = { frameId: string; nodeId: string | null };
export type LayerBox = CanvasGeometry & { id: string; styles: Record<string, string>; text: string };
export type CanvasAssetSource = { id: string; revision: number; ids: string[]; owner: string };
export type FramePreview = { key: string; url: string; markup: string; viewport: Pick<CanvasGeometry, "width" | "height">; assets: CanvasAssetSource; boxes: LayerBox[]; bytes: number };
export const PREVIEW_BUDGET = 24 * 1024 * 1024;

type CanvasSession = Pick<SessionIndexItem, "sessionId" | "projectPath" | "archived" | "worktreeRemoved" | "hidden" | "aside"> & { modified?: string };

export function availableCanvasSessions<T extends CanvasSession>(path: string | null, sessions: T[]): T[] {
  return sessions.filter((s) => s.projectPath === path && !s.archived && !s.worktreeRemoved && !s.hidden && !s.aside);
}

/// Keep the reader's current session, then their remembered choice, before choosing the newest.
export function canvasSession(path: string, selected: string | null, remembered: string | undefined, sessions: CanvasSession[]): string | null {
  const available = availableCanvasSessions(path, sessions);
  return available.find((s) => s.sessionId === selected)?.sessionId ?? available.find((s) => s.sessionId === remembered)?.sessionId ?? available.sort((a, b) => (b.modified ?? "").localeCompare(a.modified ?? ""))[0]?.sessionId ?? null;
}

export function bounds(boxes: CanvasGeometry[]): CanvasGeometry | null {
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
}

export function fitCamera(box: CanvasGeometry | null, width: number, height: number): CanvasCamera {
  if (!box) return { x: width / 2, y: height / 2, zoom: 1 };
  const zoom = Math.max(0.02, Math.min(2, (width - 96) / Math.max(1, box.width), (height - 96) / Math.max(1, box.height)));
  return { x: (width - box.width * zoom) / 2 - box.x * zoom, y: (height - box.height * zoom) / 2 - box.y * zoom, zoom };
}

export function zoomCamera(camera: CanvasCamera, factor: number, x: number, y: number): CanvasCamera {
  const zoom = Math.max(0.02, Math.min(4, camera.zoom * factor));
  return { zoom, x: x - (x - camera.x) * zoom / camera.zoom, y: y - (y - camera.y) * zoom / camera.zoom };
}

export function intersects(a: CanvasGeometry, b: CanvasGeometry): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

export function togglePick(picks: CanvasPick[], pick: CanvasPick, additive: boolean): CanvasPick[] {
  if (!additive) return [pick];
  const exists = picks.some((p) => p.frameId === pick.frameId && p.nodeId === pick.nodeId);
  return exists ? picks.filter((p) => p.frameId !== pick.frameId || p.nodeId !== pick.nodeId) : [...picks, pick];
}

export function flattenNodes(nodes: CanvasNode[], depth = 0): { node: CanvasNode; depth: number }[] {
  return nodes.flatMap((node) => [{ node, depth }, ...(node.kind === "element" ? flattenNodes(node.children, depth + 1) : [])]);
}

export function blankFrame(name: string, width: number, height: number, frames: CanvasFrame[]): CanvasFrame {
  return { id: crypto.randomUUID(), name, geometry: { x: frames.length ? Math.max(...frames.map((f) => f.geometry.x + f.geometry.width)) + 80 : 0, y: 0, width, height }, content: { nodes: [], css: "body { background: #fff; color: #111; }", assetIds: [] } };
}

export function previewKey(frame: CanvasFrame, tokens: Record<string, string>): string {
  const source = JSON.stringify([frame.id, frame.geometry.width, frame.geometry.height, frame.content, tokens]);
  let a = 2166136261, b = 5381;
  for (let i = 0; i < source.length; i++) { a = Math.imul(a ^ source.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ source.charCodeAt(i); }
  return `${frame.id}:${source.length}:${a >>> 0}:${b >>> 0}`;
}

/// Let the browser resolve stacking, clipping and wrapped text in one short-lived sandbox.
export function pickLayer(markup: string, viewport: Pick<CanvasGeometry, "width" | "height">, x: number, y: number, signal: AbortSignal): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe");
    const token = crypto.randomUUID();
    const cleanup = () => { clearTimeout(timeout); window.removeEventListener("message", receive); signal.removeEventListener("abort", abort); iframe.remove(); };
    const abort = () => { cleanup(); reject(new DOMException("Selection cancelled", "AbortError")); };
    const receive = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow || event.data?.canvasToken !== token) return;
      cleanup();
      if (event.data.error) reject(new Error(String(event.data.error)));
      else resolve(typeof event.data.hit === "string" ? event.data.hit : null);
    };
    const timeout = window.setTimeout(() => { cleanup(); reject(new Error("Layer selection timed out. Refresh to try again.")); }, 8000);
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    window.addEventListener("message", receive);
    iframe.title = "Selecting layer"; iframe.tabIndex = -1; iframe.setAttribute("aria-hidden", "true"); iframe.sandbox.add("allow-scripts");
    iframe.style.cssText = `position:fixed;left:-20000px;top:0;width:${viewport.width}px;height:${viewport.height}px;border:0;pointer-events:none`;
    iframe.onload = () => { iframe.getBoundingClientRect(); iframe.contentWindow?.postMessage({ canvasRender: token }, "*"); };
    iframe.srcdoc = frameDocument(markup, token, true, viewport, { x, y });
    document.body.append(iframe);
  });
}

export { frameMarkup, frameDocument } from "./canvasRenderer.js";

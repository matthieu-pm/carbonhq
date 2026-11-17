import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { frameDocument, frameMarkup, previewKey, PREVIEW_BUDGET, type CanvasAssetSource, type FramePreview, type LayerBox } from "@/lib/canvasBoard";
import { invoke, serverOfPath } from "@/lib/transport";
import type { Canvas, CanvasAssetData, CanvasFrame } from "@/types/events";

async function assetsFor(source: CanvasAssetSource, signal: AbortSignal): Promise<Record<string, string>> {
  const assets: Record<string, string> = {};
  let bytes = 0;
  for (const id of source.ids) {
    signal.throwIfAborted();
    const data = await invoke<CanvasAssetData>("read_canvas_asset", { id: source.id, assetId: id, version: source.revision }, source.owner);
    signal.throwIfAborted();
    bytes += data.data.length;
    if (bytes > 16 * 1024 * 1024) throw new Error("This frame's images exceed the 16 MiB preview limit.");
    assets[id] = `data:${data.asset.mimeType};base64,${data.data}`;
  }
  return assets;
}

/// Resolve historical assets only for the active hit test, rather than retaining base64 in every thumbnail.
export async function resolvePreviewMarkup(preview: FramePreview, signal: AbortSignal): Promise<string> {
  const assets = await assetsFor(preview.assets, signal);
  return preview.markup.replace(/carbon-canvas-asset:\/\/([a-zA-Z0-9-]+)/g, (_, id: string) => assets[id] ?? "data:,");
}

async function rasterize(html: string, width: number, height: number, maxSize: number): Promise<{ url: string; bytes: number }> {
  const scale = Math.min(1, maxSize / width, maxSize / height);
  const w = Math.max(1, Math.ceil(width * scale)), h = Math.max(1, Math.ceil(height * scale));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${width} ${height}"><foreignObject width="100%" height="100%">${html}</foreignObject></svg>`;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const bitmap = document.createElement("canvas");
  bitmap.width = w; bitmap.height = h;
  const context = bitmap.getContext("2d");
  if (!context) throw new Error("Frame rendering is unavailable.");
  context.drawImage(image, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => bitmap.toBlob((value) => value ? resolve(value) : reject(new Error("Could not render this frame.")), "image/png"));
  bitmap.width = 0; bitmap.height = 0;
  return { url: URL.createObjectURL(blob), bytes: w * h * 4 + blob.size };
}

function Capture({ canvas, frame, owner, maxSize, onReady, onError }: { canvas: Canvas; frame: CanvasFrame; owner: string; maxSize: number; onReady(preview: Omit<FramePreview, "key">): void; onError(message: string): void }) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const [source, setSource] = useState("");
  const markup = useRef("");
  const token = useRef(crypto.randomUUID()).current;
  const callbacks = useRef({ onReady, onError });
  callbacks.current = { onReady, onError };
  useEffect(() => {
    let stopped = false, received = false, finished = false;
    const controller = new AbortController();
    const fail = (message: string) => { if (!stopped && !finished) { finished = true; received = true; callbacks.current.onError(message); } };
    const timeout = window.setTimeout(() => fail("Frame preview timed out. Refresh to try again."), 15000);
    const listener = (event: MessageEvent) => {
      if (stopped || received || event.source !== iframe.current?.contentWindow || event.data?.canvasToken !== token) return;
      received = true;
      if (event.data.error) { fail(event.data.error); return; }
      if (typeof event.data.html !== "string" || !Array.isArray(event.data.boxes)) { fail("Invalid frame preview."); return; }
      void rasterize(event.data.html, frame.geometry.width, frame.geometry.height, maxSize).then((image) => {
        if (stopped || finished) URL.revokeObjectURL(image.url);
        else { finished = true; callbacks.current.onReady({ ...image, markup: markup.current, viewport: { width: frame.geometry.width, height: frame.geometry.height }, assets: { id: canvas.id, revision: canvas.revision, ids: frame.content.assetIds, owner }, boxes: event.data.boxes as LayerBox[] }); }
      }).catch((e) => { fail(String(e)); });
    };
    window.addEventListener("message", listener);
    void assetsFor({ id: canvas.id, revision: canvas.revision, ids: frame.content.assetIds, owner }, controller.signal).then((assets) => { if (!stopped) { markup.current = frameMarkup(frame, canvas.tokens, null); setSource(frameDocument(frameMarkup(frame, canvas.tokens, assets), token, true, frame.geometry)); } }).catch((e) => { fail(String(e)); });
    return () => { stopped = true; controller.abort(); clearTimeout(timeout); window.removeEventListener("message", listener); };
  // The component key fixes the canvas, content and dimensions for this capture.
  }, [owner, token, maxSize]);
  return source ? <iframe ref={iframe} onLoad={() => { iframe.current?.getBoundingClientRect(); iframe.current?.contentWindow?.postMessage({ canvasRender: token }, "*"); }} title="Rendering frame" tabIndex={-1} aria-hidden sandbox="allow-scripts" srcDoc={source}
    style={{ position: "fixed", left: -20000, top: 0, width: frame.geometry.width, height: frame.geometry.height, border: 0, pointerEvents: "none" }} /> : null;
}

/// At most one capture runs; thumbnail resolution follows the visible set's memory budget.
export function useFramePreviews(canvas: Canvas | null, owner: string, ids: string[], active: boolean) {
  const cache = useRef(new Map<string, FramePreview>());
  const [revision, setRevision] = useState(0);
  const failures = useRef(new Map<string, string>());
  const candidates = ids;
  const maxSize = Math.min(640, Math.max(32, Math.floor(Math.sqrt(PREVIEW_BUDGET / Math.max(1, ids.length) / 8))));
  const keys = useMemo(() => new Map(canvas?.frames.map((f) => [f.id, `${previewKey(f, canvas.tokens)}:${maxSize}`]) ?? []), [canvas?.frames, canvas?.tokens, maxSize]);
  const candidateKey = candidates.join(",");
  useEffect(() => {
    const keep = new Set(candidates);
    for (const [id, value] of cache.current) if (!keep.has(id)) { URL.revokeObjectURL(value.url); cache.current.delete(id); }
    for (const key of failures.current.keys()) if (![...keys.values()].includes(key)) failures.current.delete(key);
  }, [candidateKey, keys]);
  useEffect(() => () => { cache.current.forEach((p) => URL.revokeObjectURL(p.url)); cache.current.clear(); }, [canvas?.id, owner]);
  const next = active && canvas ? candidates.find((id) => cache.current.get(id)?.key !== keys.get(id) && !failures.current.has(keys.get(id)!)) : null;
  const frame = canvas?.frames.find((f) => f.id === next);
  const key = next ? keys.get(next)! : "";
  const renderer: ReactNode = canvas && frame && next ? <Capture key={`${owner}:${canvas.id}:${key}`} canvas={canvas} frame={frame} owner={owner} maxSize={maxSize} onReady={(result) => {
    const previous = cache.current.get(next);
    const bytes = result.bytes + (key.length + result.markup.length) * 2 + (JSON.stringify(result.boxes).length + JSON.stringify(result.assets).length) * 2;
    const used = [...cache.current.values()].reduce((total, p) => total + p.bytes, 0) - (previous?.bytes ?? 0);
    if (used + bytes > PREVIEW_BUDGET) {
      URL.revokeObjectURL(result.url);
      failures.current.set(key, "Preview memory limit reached. Zoom in to inspect fewer frames.");
    } else {
      if (previous) URL.revokeObjectURL(previous.url);
      cache.current.set(next, { ...result, bytes, key });
    }
    setRevision((n) => n + 1);
  }} onError={(message) => { failures.current.set(key, message); setRevision((n) => n + 1); }} /> : null;
  const retry = () => { failures.current.clear(); cache.current.forEach((p) => { p.key = ""; }); setRevision((n) => n + 1); };
  return { previews: cache.current, errors: new Map(candidates.flatMap((id) => { const error = failures.current.get(keys.get(id)!); return error ? [[id, error]] : []; })), renderer, retry, revision,
    stats: { captures: frame && active ? 1 : 0, cached: cache.current.size, bytes: [...cache.current.values()].reduce((n, p) => n + p.bytes, 0) } };
}

/// The focused frame alone stays live, at its original CSS dimensions inside an opaque sandbox.
export default function LiveFrame({ canvas, frame, owner }: { canvas: Canvas; frame: CanvasFrame; owner?: string }) {
  const [state, setState] = useState<{ key: string; source: string; error: string | null }>({ key: "", source: "", error: null });
  const token = useRef(crypto.randomUUID()).current;
  const key = `${canvas.id}:${previewKey(frame, canvas.tokens)}`;
  const sourceOwner = owner ?? serverOfPath(canvas.projectPath);
  useEffect(() => {
    let stopped = false;
    const controller = new AbortController();
    void assetsFor({ id: canvas.id, revision: canvas.revision, ids: frame.content.assetIds, owner: sourceOwner }, controller.signal).then((assets) => {
      if (!stopped) setState({ key, source: frameDocument(frameMarkup(frame, canvas.tokens, assets), token, false, frame.geometry), error: null });
    }).catch((e) => { if (!stopped) setState({ key, source: "", error: String(e) }); });
    return () => { stopped = true; controller.abort(); };
    // The content key includes the file, viewport and asset IDs; unrelated reads keep the live document.
  }, [key, sourceOwner, token]);
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="border-b border-hairline px-3 py-2 text-xs text-muted-foreground">{frame.name} · {frame.geometry.width} × {frame.geometry.height} <span className="ml-1">Frame preview</span></div>
    <div className="min-h-0 flex-1 overflow-auto bg-surface-well p-4">
      {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : state.key === key && state.source ? <iframe title={`Preview ${frame.name}`} sandbox="allow-scripts" srcDoc={state.source} className="block border-0 bg-white shadow-(--shadow-ring)" style={{ width: frame.geometry.width, height: frame.geometry.height }} /> : <p role="status" className="text-sm text-muted-foreground">Loading frame…</p>}
    </div>
  </div>;
}

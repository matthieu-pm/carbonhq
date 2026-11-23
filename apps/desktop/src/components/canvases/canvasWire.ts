import { inflateCanvasGzip, type CanvasSavePayload } from "./canvasSave";
import { invoke } from "@/lib/transport";

export type CanvasLocation = { projectPath: string; folder: string; name: string; archived: boolean };

export async function readCanvas(args: CanvasLocation) {
  const raw = await invoke<string>("read_canvas_document", {
    ...args,
    gzip: typeof DecompressionStream !== "undefined",
  });
  return decodeCanvas(raw);
}

export async function readCanvasWithPreview(args: CanvasLocation) {
  const result = await invoke<string | { content: string; preview: string }>("read_canvas_document", {
    ...args,
    gzip: typeof DecompressionStream !== "undefined",
    includePreview: true,
  });
  if (typeof result === "string") return { content: await decodeCanvas(result), preview: null };
  const [content, preview] = await Promise.all([decodeCanvas(result.content), decodeCanvas(result.preview)]);
  return { content, preview };
}

function decodeCanvas(raw: string) {
  if (!raw.startsWith("gzip:")) return raw;
  return inflateCanvasGzip(raw.slice(5));
}

export async function saveCanvas(args: CanvasLocation, payload: CanvasSavePayload, plain: () => Promise<CanvasSavePayload>) {
  if (!payload.gzip) return invoke("save_canvas_document", { ...args, previous: payload.previous, content: payload.content });
  try {
    return await invoke("save_canvas_document_gzip", { ...args, previous: payload.previous, content: payload.content });
  } catch (error) {
    if (!String(error).includes("unknown command")) throw error;
    const fallback = await plain();
    return invoke("save_canvas_document", { ...args, previous: fallback.previous, content: fallback.content });
  }
}

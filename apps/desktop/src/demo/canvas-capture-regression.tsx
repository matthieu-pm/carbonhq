import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { useFramePreviews } from "@/components/canvas/FrameRenderer";
import type { Canvas, CanvasFrame } from "@/types/events";

function Probe({ canvas }: { canvas: Canvas }) {
  const capture = useFramePreviews(canvas, "local", [canvas.frames[0].id], true);
  return <div data-cached={capture.stats.cached}>{capture.renderer}</div>;
}

async function waitFor(predicate: () => boolean, message: string) {
  const deadline = performance.now() + 4000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/// Keeps a pending image decode alive across a refresh that changes only another frame.
export async function verifyCaptureInvalidation() {
  const marker = `canvas-regression-${crypto.randomUUID()}`;
  const frame = (): CanvasFrame => ({ id: crypto.randomUUID(), name: marker, geometry: { x: 0, y: 0, width: 390, height: 844 }, content: { nodes: [{ kind: "text", id: crypto.randomUUID(), name: "Label", text: marker }], css: "body{background:white}", assetIds: [] } });
  const canvas: Canvas = {
    id: crypto.randomUUID(), projectPath: "/canvas-regression", projectKey: "/canvas-regression", name: marker, revision: 1,
    created: "2026-11-17T00:00:00Z", modified: "2026-11-17T00:00:00Z", frames: [frame(), frame()], camera: null, tokens: {}, assets: [],
    change: { id: crypto.randomUUID(), beforeRevision: 0, afterRevision: 1, restoredFrom: null, author: { sessionId: null, turnId: null, label: null } },
  };
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;opacity:0;pointer-events:none";
  document.body.append(host);
  const root = createRoot(host);
  const originalDecode = HTMLImageElement.prototype.decode;
  let release: (() => void) | null = null;
  let gated = false;
  HTMLImageElement.prototype.decode = function () {
    if (gated || !this.src.startsWith("data:image/svg+xml") || !this.src.includes(marker)) return originalDecode.call(this);
    gated = true;
    return new Promise<void>((resolve, reject) => {
      release = () => { void originalDecode.call(this).then(resolve, reject); };
    });
  };
  try {
    flushSync(() => root.render(<Probe canvas={canvas} />));
    await waitFor(() => release !== null, "The regression capture never reached image decode.");
    const changed = structuredClone(canvas);
    changed.revision++;
    changed.frames[1].name = "Updated elsewhere";
    flushSync(() => root.render(<Probe canvas={changed} />));
    const resume = release as unknown as () => void;
    resume();
    await waitFor(() => host.firstElementChild?.getAttribute("data-cached") === "1", "An unrelated frame refresh discarded the pending capture.");
    return { captureSurvivedUnrelatedRefresh: true };
  } finally {
    HTMLImageElement.prototype.decode = originalDecode;
    flushSync(() => root.unmount());
    host.remove();
  }
}

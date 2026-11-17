import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// Run against this session's open Vite preview; each probe removes its own opaque iframe.
const probe = async () => {
  const { frameDocument, frameMarkup } = await import(`/src/lib/canvasBoard.ts?verify=${Date.now()}`);
  const results = [];
  for (const [width, height] of [[390, 844], [1440, 900], [800, 600], ...Array.from({ length: 7 }, () => [390, 844])]) {
    const token = crypto.randomUUID();
    const frame = { id: token, name: "Viewport regression", geometry: { x: 0, y: 0, width, height }, content: {
      assetIds: [], css: "main{min-height:100vh;display:flex;flex-direction:column;padding:24px}h1{font-size:32px;margin:0}button{margin-top:auto;padding:16px}@media(min-width:600px){h1{font-size:48px}}",
      nodes: [{ kind: "element", id: "root", name: "Page", tag: "main", attributes: {}, styles: {}, children: [
        { kind: "element", id: "heading", name: "Title", tag: "h1", attributes: {}, styles: {}, children: [{ kind: "text", id: "title", name: "Title", text: "Checkout" }] },
        { kind: "element", id: "button", name: "Pay", tag: "button", attributes: {}, styles: {}, children: [{ kind: "text", id: "label", name: "Label", text: "Pay" }] },
      ] }],
    } };
    const iframe = document.createElement("iframe");
    iframe.sandbox = "allow-scripts";
    iframe.style.cssText = `position:fixed;left:-20000px;top:0;border:0;width:${width}px;height:${height}px`;
    iframe.onload = () => { iframe.getBoundingClientRect(); iframe.contentWindow.postMessage({ canvasRender: token }, "*"); };
    const start = performance.now();
    const result = await new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timeout); window.removeEventListener("message", receive); iframe.remove(); };
      const receive = (event) => {
        if (event.source !== iframe.contentWindow || event.data?.canvasToken !== token) return;
        const data = event.data;
        cleanup();
        if (data.error) { reject(new Error(data.error)); return; }
        const frozen = new DOMParser().parseFromString(data.html, "application/xhtml+xml");
        resolve({ width, height, root: data.boxes.find((b) => b.id === "root"), heading: data.boxes.find((b) => b.id === "heading"), button: data.boxes.find((b) => b.id === "button"), frozenHeight: frozen.querySelector("main")?.style.minHeight, ms: performance.now() - start });
      };
      const timeout = setTimeout(() => { cleanup(); reject(new Error("Capture timed out")); }, 8000);
      window.addEventListener("message", receive);
      iframe.srcdoc = frameDocument(frameMarkup(frame, {}, {}), token, true, frame.geometry);
      document.body.append(iframe);
    });
    results.push(result);
  }
  const { verifyCaptureInvalidation } = await import("/src/demo/canvas-capture-regression.tsx");
  return JSON.stringify({ results, capture: await verifyCaptureInvalidation() });
};

const raw = execFileSync("carbon", ["browser", "eval", `(${probe.toString()})()`], { encoding: "utf8", timeout: 30000 });
const { results, capture } = JSON.parse(raw.trim());
assert.equal(capture.captureSurvivedUnrelatedRefresh, true);
for (const result of results) {
  assert.equal(result.root.width, result.width);
  assert.equal(result.root.height, result.height);
  assert.equal(result.heading.styles["font-size"], result.width >= 600 ? "48px" : "32px");
  assert.ok(Math.abs(result.button.y + result.button.height - result.height + 24) < 1);
  assert.equal(result.frozenHeight, `${result.height}px`);
}
const times = results.map((r) => r.ms).sort((a, b) => a - b);
console.log(JSON.stringify({ captures: results.length, viewportAndFrozenStyles: "passed", ...capture, medianMs: times[Math.floor(times.length / 2)], maxMs: Math.max(...times) }));

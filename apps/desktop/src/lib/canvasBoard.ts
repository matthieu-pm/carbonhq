import type { CanvasCamera, CanvasFrame, CanvasGeometry, CanvasNode, SessionIndexItem } from "@/types/events";

export type CanvasPick = { frameId: string; nodeId: string | null };
export type LayerBox = CanvasGeometry & { id: string; styles: Record<string, string>; text: string };
export type FramePreview = { key: string; url: string; boxes: LayerBox[]; bytes: number };
export const PREVIEW_BUDGET = 24 * 1024 * 1024;

export function canvasSession(path: string, selected: string | null, remembered: string | undefined, sessions: (Pick<SessionIndexItem, "sessionId" | "projectPath" | "archived" | "worktreeRemoved"> & { modified?: string })[]): string | null {
  const available = sessions.filter((s) => s.projectPath === path && !s.archived && !s.worktreeRemoved);
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

export function pickLayer(boxes: LayerBox[], x: number, y: number): string | null {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const box = boxes[i];
    if (box.width > 0 && box.height > 0 && x >= box.x && y >= box.y && x <= box.x + box.width && y <= box.y + box.height) return box.id;
  }
  return null;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const forbidden = new Set(["script", "style", "link", "meta", "base", "iframe", "object", "embed", "applet", "frame", "frameset", "portal", "foreignobject", "animate", "animatetransform", "set"]);
const voids = new Set(["area", "br", "col", "hr", "img", "input", "source", "track", "wbr"]);

/// Stored markup never receives the app's origin, network access, or executable attributes.
export function frameMarkup(frame: CanvasFrame, tokens: Record<string, string>, assets: Record<string, string>): string {
  const resolve = (s: string) => s.replace(/carbon-canvas-asset:\/\/([a-zA-Z0-9-]+)/g, (_, id: string) => assets[id] ?? "data:,");
  const render = (node: CanvasNode): string => {
    if (node.kind === "text") return `<!--canvas-text:${escape(node.id)}-->${escape(node.text)}`;
    const tag = node.tag;
    if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(tag) || forbidden.has(tag.toLowerCase()) || tag.includes("-")) return "";
    const attrs = Object.entries(node.attributes).filter(([key]) => /^[a-zA-Z_:][\w:.-]*$/.test(key) && !/^on|^data-canvas-|^(style|srcdoc|nonce|formaction|action|href|xlink:href|srcset|autofocus|is)$/i.test(key));
    const style = Object.entries(node.styles).filter(([key]) => /^[-a-zA-Z]+$/.test(key)).map(([key, value]) => `${key}:${resolve(value)}`).join(";");
    return `<${tag} data-canvas-id="${escape(node.id)}"${attrs.map(([key, value]) => ` ${key}="${escape(resolve(value))}"`).join("")} style="${escape(style)}">${voids.has(tag.toLowerCase()) ? "" : node.children.map(render).join("") + `</${tag}>`}`;
  };
  const vars = Object.entries(tokens).filter(([key]) => /^--[\w-]+$/.test(key)).map(([key, value]) => `${key}:${resolve(value)}`).join(";");
  const css = `:root{${vars}}html{width:100%;height:100%}body{margin:0;min-height:100%;font-family:system-ui,sans-serif}*{box-sizing:border-box}\n${resolve(frame.content.css)}`;
  return `<style>${css.replace(/<\/style/gi, "<\\/style")}</style></head><body>${frame.content.nodes.map(render).join("")}</body>`;
}

/// One bounded capture is enough for an overview; zoom never resizes its CSS viewport.
export function frameDocument(markup: string, token: string, capture: boolean, viewport?: Pick<CanvasGeometry, "width" | "height">): string {
  const script = `(${frameBridge.toString()})(${JSON.stringify(token)},${capture},${JSON.stringify(viewport ?? null)})`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; script-src 'nonce-${token}'; base-uri 'none'; form-action 'none'">${markup}<script nonce="${token}">${script}</script></html>`;
}

function frameBridge(token: string, capture: boolean, viewport: { width: number; height: number } | null) {
  const send = (value: Record<string, unknown>) => parent.postMessage({ canvasToken: token, ...value }, "*");
  document.addEventListener("submit", (e) => e.preventDefault());
  document.addEventListener("click", (e) => { if ((e.target as Element).closest("a")) e.preventDefault(); });
  if (!capture) return;
  const hostReady = new Promise<void>((resolve) => {
    const receive = (event: MessageEvent) => {
      if (event.source !== parent || event.data?.canvasRender !== token) return;
      window.removeEventListener("message", receive); resolve();
    };
    window.addEventListener("message", receive);
  });
  const freeze = document.createElement("style");
  freeze.textContent = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";
  document.head.append(freeze);
  const properties = ["display", "visibility", "position", "z-index", "flex-direction", "align-items", "justify-content", "gap", "padding-top", "padding-right", "padding-bottom", "padding-left", "margin-top", "margin-right", "margin-bottom", "margin-left", "background-color", "background-image", "color", "border-radius", "font-family", "font-size", "font-weight", "line-height", "letter-spacing"];
  const collect = async () => {
    if (document.readyState !== "complete") await new Promise((resolve) => window.addEventListener("load", resolve, { once: true }));
    await hostReady;
    const ready = () => document.documentElement.clientWidth > 0 && innerHeight > 0 && (!viewport || (innerWidth === viewport.width && innerHeight === viewport.height));
    // A new iframe can run its script before its owner has assigned the layout viewport.
    for (let attempt = 0; !ready() && attempt < 100; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
    if (!ready()) throw new Error("Frame layout is not ready. Refresh to try again.");
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
    if (document.querySelectorAll("*").length > 2000) throw new Error("This frame exceeds the 2,000-element preview limit.");
    const boxes: LayerBox[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node.nodeType === 1 ? node as HTMLElement : node.parentElement;
      const id = node.nodeType === 1 ? element?.getAttribute("data-canvas-id") : node.textContent?.startsWith("canvas-text:") ? node.textContent.slice(12) : null;
      if (!id || !element) continue;
      let rect = element.getBoundingClientRect();
      if (node.nodeType === 8 && node.nextSibling?.nodeType === 3) { const range = document.createRange(); range.selectNode(node.nextSibling); rect = range.getBoundingClientRect(); }
      const styles = getComputedStyle(element);
      boxes.push({ id, x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height, styles: Object.fromEntries(properties.map((p) => [p, styles.getPropertyValue(p)])), text: (node.nodeType === 8 ? node.nextSibling?.textContent : element.textContent)?.slice(0, 4000) ?? "" });
    }
    const html = document.documentElement.cloneNode(true) as HTMLElement;
    const sources = [document.documentElement, ...document.documentElement.querySelectorAll("*")];
    const targets = [html, ...html.querySelectorAll("*")];
    const inline = (target: HTMLElement | SVGElement, styles: CSSStyleDeclaration) => {
      target.removeAttribute("style");
      for (const property of styles) target.style.setProperty(property, styles.getPropertyValue(property), "important");
    };
    // Freeze used styles before rasterizing: SVG image dimensions must not re-evaluate vh or media queries.
    sources.forEach((source, index) => {
      const target = targets[index];
      if (!(target instanceof HTMLElement) && !(target instanceof SVGElement)) return;
      inline(target, getComputedStyle(source));
      for (const pseudo of ["::before", "::after"]) {
        const styles = getComputedStyle(source, pseudo);
        if (!styles.content || ["none", "normal", '""'].includes(styles.content)) continue;
        const span = document.createElement("span");
        try { span.textContent = JSON.parse(styles.content); } catch { continue; }
        inline(span, styles); span.style.removeProperty("content");
        if (pseudo === "::before") target.prepend(span); else target.append(span);
      }
    });
    html.querySelectorAll("script,meta,style").forEach((n) => n.remove());
    html.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    const serialized = new XMLSerializer().serializeToString(html);
    if (serialized.length > 16 * 1024 * 1024) throw new Error("This frame exceeds the preview size limit.");
    send({ boxes, html: serialized });
  };
  void collect().catch((e) => send({ error: String(e) }));
}

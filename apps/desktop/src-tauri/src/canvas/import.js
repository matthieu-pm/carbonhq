function captureCanvasStyle(style) {
  const styles = {}, carbonStyleOrder = [];
  const text = style.cssText;
  let start = 0, quote = null, depth = 0;
  for (let index = 0; index <= text.length; index++) {
    const char = text[index];
    if (char === "\\") { index++; continue; }
    if (quote) { if (char === quote) quote = null; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if ("([{".includes(char)) depth++;
    if (")]}".includes(char)) depth--;
    if (index === text.length || (char === ";" && depth === 0)) {
      const declaration = text.slice(start, index), colon = declaration.indexOf(":");
      if (colon !== -1) {
        const key = declaration.slice(0, colon).trim();
        styles[key] = declaration.slice(colon + 1).trim();
        carbonStyleOrder.push(key);
      }
      start = index + 1;
    }
  }
  return { styles, carbonStyleOrder };
}

function parseCanvasHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const forbidden = new Set(["script", "link", "meta", "base", "iframe", "object", "embed", "applet", "frame", "frameset", "portal", "foreignobject", "animate", "animatetransform", "set"]);
  let count = 0;
  const assets = new Set();
  const references = (value) => {
    for (const match of value.matchAll(/carbon-canvas-asset:\/\/([a-zA-Z0-9-]+)/g)) assets.add(match[1]);
    if (/(?:https?:|file:|\/\/)/i.test(value.replace(/carbon-canvas-asset:\/\/[a-zA-Z0-9-]+/g, ""))) throw new Error("Import file-owned images with carbon-canvas-asset:// references. External resources are not rendered.");
  };
  const walk = (source, depth = 0) => {
    if (depth > 48) throw new Error("HTML exceeds the 48-level nesting limit.");
    const nodes = [];
    for (const node of source.childNodes) {
      if (node.nodeType === 8) continue;
      if (++count > 2000) throw new Error("HTML exceeds the 2,000-layer rendering limit.");
      const id = `import-${count}`;
      if (node.nodeType === 3) { if (node.textContent) nodes.push({ kind: "text", id, name: "Text", text: node.textContent }); continue; }
      if (node.nodeType !== 1) throw new Error("Unsupported HTML node.");
      const tag = node.localName;
      if (tag === "style") continue;
      if (forbidden.has(tag.toLowerCase()) || tag.includes("-")) throw new Error(`Unsupported Canvas element: <${tag}>. Use static HTML and CSS.`);
      const attributes = {};
      for (const attr of node.attributes) {
        if (attr.name === "style") continue;
        if (/^on|^data-canvas-|^(srcdoc|nonce|formaction|action|href|xlink:href|srcset|autofocus|is)$/i.test(attr.name)) throw new Error(`Unsupported executable or navigation attribute: ${attr.name}`);
        if (["src", "poster", "background"].includes(attr.name)) references(attr.value);
        attributes[attr.name] = attr.value;
      }
      const style = captureCanvasStyle(node.style);
      for (const value of Object.values(style.styles)) references(value);
      nodes.push({ kind: "element", id, name: node.getAttribute("aria-label") || node.id || tag, tag, attributes, ...style, children: walk(node, depth + 1) });
    }
    return nodes;
  };
  for (const element of doc.head.children) if (forbidden.has(element.localName) && element.localName !== "meta") throw new Error(`Unsupported head element: <${element.localName}>.`);
  const css = [...doc.querySelectorAll("style")].map(style => style.textContent).join("\n");
  references(css);
  const nodes = walk(doc.body);
  return { nodes, css, assetIds: [...assets] };
}

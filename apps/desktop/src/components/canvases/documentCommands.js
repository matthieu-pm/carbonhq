import {
  effectTypes,
  presets,
  newEffect,
  newLayer,
  readDocument,
  removeToken,
  tokenDefaults,
  uid,
} from "./model.js";
import { normalizeToken, parseTokens } from "./tokenModel.js";

function item(items, id) {
  const found = items.find((entry) => entry.id === id);
  if (!found) throw Error("Unknown Canvas ID: " + id);
  return found;
}

function remove(items, id) {
  items.splice(items.indexOf(item(items, id)), 1);
}

function subtree(doc, root) {
  const ids = new Set([root]);
  for (const id of ids) {
    for (const layer of doc.elements) if (layer.parent === id) ids.add(layer.id);
  }
  return ids;
}

function pageAction(doc, a) {
  if (a.op === "list") return doc.pages;
  if (a.op === "add") {
    const page = { id: uid(), name: a.name, background: "#282828" };
    doc.pages.push(page);
    return page;
  }
  const page = item(doc.pages, a.id);
  switch (a.op) {
    case "rename":
      page.name = a.name;
      break;
    case "paint":
      page.background = a.background;
      if (a.opacity != null) page.opacity = a.opacity;
      break;
    case "remove":
      if (doc.pages.length === 1) throw Error("Keep at least one canvas page.");
      remove(doc.pages, a.id);
      doc.elements = doc.elements.filter((layer) => layer.page !== a.id);
      break;
    default:
      throw Error("Unknown page action.");
  }
  return { id: page.id };
}

function layerAction(doc, a) {
  if (a.op === "presets") return presets;
  if (a.op === "list") return doc.elements.filter((layer) => !a.page || layer.page === a.page);
  if (a.op === "add") {
    const layer = newLayer(a.kind, a.page, a.parent, a.x ?? 0, a.y ?? 0);
    if (a.name != null) layer.name = a.name;
    doc.elements.push(layer);
    return { id: layer.id };
  }
  const l = item(doc.elements, a.id);
  switch (a.op) {
    case "rename":
      l.name = a.name;
      break;
    case "text":
      if (l.kind !== "Text") throw Error("Choose a text layer.");
      l.text = a.text;
      break;
    case "move":
      l.x = a.x;
      l.y = a.y;
      break;
    case "nudge":
      l.x += a.dx;
      l.y += a.dy;
      break;
    case "preset": {
      const size = Object.values(presets).find((group) => Object.hasOwn(group, a.name))?.[a.name];
      if (!size || l.kind !== "Frame") throw Error("Choose a named preset and a frame.");
      Object.assign(l.style, { width: size[0] + "px", height: size[1] + "px" });
      break;
    }
    case "resize":
      Object.assign(l.style, { width: a.width, height: a.height });
      break;
    case "parent":
      l.parent = a.parent;
      break;
    case "style":
      Object.defineProperty(l.style, a.property, {
        value: a.value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      break;
    case "remove": {
      const ids = subtree(doc, l.id);
      doc.elements = doc.elements.filter((layer) => !ids.has(layer.id));
      break;
    }
    case "replace-color":
      for (const id of subtree(doc, l.id)) {
        for (const e of item(doc.elements, id).effects) {
          if (!e.enabled || !e.fields.color || (e.kind === "Fill" && e.fields.type === "Image")) continue;
          if (e.fields.color === a.old) e.fields.color = a.new;
          if (e.kind === "Fill" && e.fields.type !== "Solid") {
            if (e.fields.end === a.old) e.fields.end = a.new;
            for (const stop of e.stops ?? []) if (stop.color === a.old) stop.color = a.new;
          }
        }
      }
      break;
    default:
      throw Error("Unknown layer action.");
  }
  return { id: l.id };
}

function effectAction(doc, a, input) {
  const effects = item(doc.elements, a.layer).effects;
  if (a.op === "list") return effects;
  if (a.op === "add") {
    if (a.kind === "Text stroke" && item(doc.elements, a.layer).kind !== "Text")
      throw Error("Text stroke requires a text layer.");
    if (["Outline", "Text stroke"].includes(a.kind) && effects.some((e) => e.kind === a.kind))
      throw Error("This layer already has that effect.");
    if (!effectTypes.includes(a.kind)) throw Error("Unknown effect kind.");
    const effect = newEffect(a.kind);
    effects.unshift(effect);
    return { id: effect.id };
  }
  const e = item(effects, a.id);
  switch (a.op) {
    case "set":
      if (["constructor", "__proto__", "prototype"].includes(a.field)) throw Error("Unknown effect field.");
      e.fields[a.field] = a.value;
      break;
    case "image":
      if (e.kind !== "Fill") throw Error("Choose a fill effect.");
      Object.assign(e.fields, { type: "Image", image: input });
      break;
    case "enable":
    case "disable":
      e.enabled = a.op === "enable";
      break;
    case "move":
      if (a.index >= effects.length) throw Error("Effect index is out of range.");
      remove(effects, e.id);
      effects.splice(a.index, 0, e);
      break;
    case "remove":
      remove(effects, e.id);
      break;
    case "add-stop": {
      const stop = { id: uid(), color: a.color, at: a.at };
      (e.stops ??= []).push(stop);
      e.stops.sort((a, b) => parseFloat(a.at) - parseFloat(b.at));
      return { id: stop.id };
    }
    case "set-stop":
      Object.assign(item(e.stops ?? [], a.stop), { color: a.color, at: a.at });
      e.stops.sort((a, b) => parseFloat(a.at) - parseFloat(b.at));
      break;
    case "remove-stop":
      remove(e.stops ?? [], a.stop);
      break;
    default:
      throw Error("Unknown effect action.");
  }
  return { id: e.id };
}

function tokenAction(doc, a, input) {
  if (a.op === "list")
    return doc.tokens.filter((t) => t.name.toLowerCase().includes((a.query ?? "").toLowerCase()));
  if (a.op === "import") {
    const incoming = parseTokens(input, (source) => JSON.parse(globalThis.parseCanvasYaml(source)));
    if (!incoming.length) throw Error("No supported tokens found.");
    const ids = [];
    for (const token of incoming) {
      if (doc.tokens.some((t) => t.name === token.name && t.kind === token.kind)) continue;
      doc.tokens.push(token);
      ids.push(token.id);
    }
    return { ids };
  }
  if (a.op === "add") {
    if (!Object.hasOwn(tokenDefaults, a.kind)) throw Error("Unknown token kind.");
    const token = { id: uid(), kind: a.kind, name: a.name, value: normalizeToken(a.kind, a.value) };
    doc.tokens.push(token);
    return { id: token.id };
  }
  const t = item(doc.tokens, a.id);
  switch (a.op) {
    case "rename":
      t.name = a.name;
      break;
    case "set":
      t.value = normalizeToken(t.kind, a.value);
      break;
    case "duplicate": {
      const copy = { ...t, id: uid(), name: t.name + " copy" };
      doc.tokens.push(copy);
      return { id: copy.id };
    }
    case "apply":
      return layerAction(doc, { op: "style", id: a.layer, property: a.property, value: "@" + t.id });
    case "remove":
      Object.assign(doc, removeToken(doc, t));
      break;
    default:
      throw Error("Unknown token action.");
  }
  return { id: t.id };
}

function markupAction(doc, group, a) {
  const p = item(doc.pages, a.page);
  const key = group === "stroke" ? "strokes" : "comments";
  if (a.op === "list") return p[key] ?? [];
  const items = (p[key] ??= []);
  if (a.op === "erase" || a.op === "remove") {
    remove(items, a.id);
    return { id: a.id };
  }
  if (a.op === "edit") {
    item(items, a.id).text = a.text;
    return { id: a.id };
  }
  const entry =
    group === "stroke"
      ? { id: uid(), points: JSON.parse(a.points) }
      : { id: uid(), x: a.x, y: a.y, text: a.text };
  items.push(entry);
  return { id: entry.id };
}

export function execute(raw, command, input) {
  const doc = readDocument(raw);
  const { group, args } = JSON.parse(command);
  let data;
  switch (group) {
    case "read":
      return JSON.stringify({ data: doc });
    case "page":
      data = pageAction(doc, args);
      break;
    case "layer":
      data = layerAction(doc, args);
      break;
    case "effect":
      data = effectAction(doc, args, input);
      break;
    case "token":
      data = tokenAction(doc, args, input);
      break;
    case "stroke":
    case "comment":
      data = markupAction(doc, group, args);
      break;
    default:
      throw Error("Unknown document action.");
  }
  if (args.op === "list" || args.op === "presets") return JSON.stringify({ data });
  const content = JSON.stringify(doc, null, 2) + "\n";
  readDocument(content);
  return JSON.stringify({ data, content });
}

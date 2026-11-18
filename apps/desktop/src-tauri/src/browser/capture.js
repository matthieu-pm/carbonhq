(query, handle, tokenReader) => {
  const ignored = new Set("script style link meta title base template noscript source track".split(" "));
  const raster = new Set("iframe frame frameset portal object embed applet video audio canvas foreignobject input textarea select".split(" "));
  const attributes = new Set("alt colspan rowspan start reversed dir lang viewBox d points x y x1 x2 y1 y2 cx cy r rx ry width height transform fill stroke stroke-width fill-rule clip-rule offset stop-color stop-opacity gradientUnits gradientTransform preserveAspectRatio clip-path mask filter id".split(" "));
  const styleKeys = (
    "display visibility box-sizing position top right bottom left z-index float clear overflow-x overflow-y " +
    "width height min-width max-width min-height max-height aspect-ratio margin-top margin-right margin-bottom margin-left " +
    "padding-top padding-right padding-bottom padding-left flex-direction flex-wrap flex-grow flex-shrink flex-basis order " +
    "justify-content justify-items justify-self align-content align-items align-self row-gap column-gap " +
    "grid-template-columns grid-template-rows grid-template-areas grid-auto-columns grid-auto-rows grid-auto-flow grid-column-start grid-column-end grid-row-start grid-row-end " +
    "color color-scheme font-family font-size font-weight font-style font-stretch font-feature-settings font-variation-settings font-kerning font-variant-numeric " +
    "line-height letter-spacing word-spacing white-space overflow-wrap word-break text-align text-indent text-overflow text-transform " +
    "text-decoration-line text-decoration-color text-decoration-style text-decoration-thickness text-underline-offset text-shadow vertical-align writing-mode direction " +
    "background-color background-image background-size background-repeat background-position background-origin background-clip background-attachment " +
    "border-top-width border-top-style border-top-color border-right-width border-right-style border-right-color border-bottom-width border-bottom-style border-bottom-color border-left-width border-left-style border-left-color " +
    "border-top-left-radius border-top-right-radius border-bottom-left-radius border-bottom-right-radius border-collapse border-spacing table-layout " +
    "box-shadow outline-color outline-style outline-width outline-offset opacity filter backdrop-filter mix-blend-mode isolation transform transform-origin translate rotate scale " +
    "clip-path mask-image mask-size mask-repeat mask-position object-fit object-position list-style-type list-style-position list-style-image " +
    "fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-dasharray stroke-linecap stroke-linejoin"
  ).split(" ");
  const pageUrl = location.href;
  if (!["http:", "https:"].includes(location.protocol)) throw new Error("Open a web page to capture it.");
  const pagePath = location.pathname;
  const documentTimeOrigin = performance.timeOrigin;
  const capturedAt = new Date().toISOString();
  const pageRoot = document.documentElement;
  const scroll = { x: scrollX, y: scrollY };
  const picker = window.__carbonPick;
  const target = query.picker ? picker?.canvasTarget(query.picker, query.fullPage) : null;
  if (query.picker && !target) throw new Error("This capture is no longer active. Try capturing again.");
  let selected = target?.element ?? null;
  if (query.selector) {
    try { selected = document.querySelector(query.selector); }
    catch { throw new Error("Enter a valid CSS selector."); }
    if (!selected) throw new Error("No element matches that selector on this page.");
  }
  if (selected && !selected.isConnected) throw new Error("The selected element has changed. Pick it again.");
  const selector = (target?.selector ?? query.selector ?? null)?.slice(0, 1024) ?? null;
  const fullPage = !selected;
  const viewport = { width: innerWidth, height: innerHeight, scale: devicePixelRatio };
  const absolute = el => {
    const r = el.getBoundingClientRect();
    return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height };
  };
  const bounds = selected ? absolute(selected) : { x: 0, y: 0, width: viewport.width, height: Math.max(viewport.height, pageRoot.scrollHeight) };
  const clip = { x: Math.max(0, bounds.x), y: Math.max(0, bounds.y) };
  clip.width = Math.min(10000, bounds.x + bounds.width - clip.x);
  clip.height = Math.min(10000, bounds.y + bounds.height - clip.y);
  if (!(clip.width > 0 && clip.height > 0)) throw new Error("This capture has no visible area.");
  const warnings = new Set();
  const tokenReferences = tokenReader(document);
  const tokenTheme = new Set();
  for (let element = selected ?? document.body; element; element = element.parentElement) {
    for (const attribute of ["data-theme", "data-mode", "data-color-mode", "data-color-scheme"]) {
      const value = element.getAttribute(attribute);
      if (value && /^[\w-]{1,48}$/.test(value) && ![...tokenTheme].some(theme => theme.startsWith(attribute + "="))) {
        tokenTheme.add(attribute + "=" + value);
      }
    }
    for (const name of ["dark", "light"]) if (element.classList.contains(name)) tokenTheme.add("." + name);
    if (tokenTheme.size === 6) break;
  }
  if (query.selector != null && query.selector.length > 1024) throw new Error("Use a shorter CSS selector.");
  if (clip.width + clip.x < bounds.x + bounds.width || clip.height + clip.y < bounds.y + bounds.height || bounds.x < 0 || bounds.y < 0) {
    warnings.add("Capture was cropped to the available area and the 10,000 px limit.");
  }
  if (fullPage && pageRoot.scrollWidth > viewport.width) warnings.add("Content beyond the viewport width was cropped.");

  const hex = [...crypto.getRandomValues(new Uint8Array(12))].map(n => n.toString(16).padStart(2, "0")).join("");
  let next = 0;
  const id = () => hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-4" + hex.slice(12, 15) + "-8" + hex.slice(15, 18) + "-" + hex.slice(18) + (++next).toString(16).padStart(6, "0");
  const urlPattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
  const resources = new Map();
  let bytes = 0, savedBytes = 0;
  const assetRef = asset => "carbon-canvas-asset://" + asset.id;
  const resource = (address, kind, base = document.baseURI) => {
    if (!address) return null;
    let key;
    try { key = new URL(address, base); } catch { return null; }
    if (!["http:", "https:", "data:", "blob:"].includes(key.protocol)) return null;
    const url = key.href;
    const cacheKey = kind + ":" + url;
    if (resources.has(cacheKey)) return resources.get(cacheKey);
    if (resources.size >= 64 || url.length > 3_500_000) return null;
    const asset = { id: id(), kind, data: "" };
    resources.set(cacheKey, asset);
    asset.done = (async () => {
      const response = await fetch(url, { credentials: "same-origin", signal: AbortSignal.timeout(3500) });
      if (!response.ok || !response.body) return;
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          bytes += chunk.value.byteLength;
          if (size > 2_500_000 || bytes > 8_000_000) return;
          chunks.push(chunk.value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      let blob = new Blob(chunks, { type: response.headers.get("content-type") ?? "" });
      const signature = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
      const ascii = String.fromCharCode(...signature);
      const supportedImage = ascii.startsWith("\x89PNG\r\n\x1a\n") || ascii.startsWith("\xff\xd8\xff") ||
        ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a") ||
        (ascii.startsWith("RIFF") && ascii.slice(8) === "WEBP") || /^ftypavi[fs]$/.test(ascii.slice(4));
      if (kind === "image" && !supportedImage) {
        const imageUrl = URL.createObjectURL(blob);
        try {
          const image = new Image();
          image.src = imageUrl;
          await image.decode();
          if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 4_000_000) return;
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          canvas.getContext("2d").drawImage(image, 0, 0);
          blob = await new Promise(resolve => canvas.toBlob(resolve));
          if (!blob || blob.size > 2_500_000) return;
        } finally { URL.revokeObjectURL(imageUrl); }
      }
      if (savedBytes + blob.size > 8_000_000) return;
      savedBytes += blob.size;
      asset.data = await new Promise((resolve, reject) => {
        const file = new FileReader();
        file.onload = () => resolve(String(file.result).split(",")[1] ?? "");
        file.onerror = reject;
        file.readAsDataURL(blob);
      });
    })().catch(() => {});
    return asset;
  };
  const uses = [];
  const fonts = new Set();
  const family = value => value.trim().replace(/^["']|["']$/g, "").toLowerCase();
  const css = (get, keys = styleKeys) => Object.fromEntries(keys.flatMap(prop => {
    const value = get.getPropertyValue(prop);
    if (!value) return [];
    if (prop === "font-family") for (const name of value.split(",")) fonts.add(family(name));
    if (value.length > 3_500_000) {
      warnings.add("A " + prop + " value exceeded the capture limit.");
      return [];
    }
    const uris = [];
    const safe = value.replace(urlPattern, (_, a, b, c) => {
      const url = a ?? b ?? c;
      if (/^#[\w-]+$/.test(url)) return "url(" + url + ")";
      const asset = resource(url, "image");
      uris.push(asset);
      return asset ? "url(" + assetRef(asset) + ")" : "url(data:,)";
    });
    if (uris.length) uses.push(() => {
      if (uris.some(asset => !asset?.data)) warnings.add("A " + prop + " resource could not be copied.");
    });
    if (safe.length > 2048 || /(?:https?:\/\/|file:\/\/|javascript:)/i.test(safe)) {
      warnings.add("A " + prop + " resource could not be copied.");
      return [];
    }
    return [[prop, safe]];
  }));
  let count = 0;
  const layer = (tag, name, styles, attrs = {}, children = []) => ({ kind: "element", id: id(), name, tag, attributes: attrs, styles, children });
  const text = value => ({ kind: "text", id: id(), name: "Text", text: value.replaceAll("carbon-canvas-asset://", "") });
  const imageRegion = (node, label, box) => {
    node.tag = "div";
    node.name = label + " · Image reference";
    node.attributes = {};
    node.children = [];
    node.rasterRegion = box;
    delete node.tokenReferences;
    Object.assign(node.styles, {
      width: box.width + "px", height: box.height + "px", "box-sizing": "border-box",
      color: "transparent", "border-color": "transparent", "box-shadow": "none",
      transform: "none", translate: "none", rotate: "none", scale: "none", opacity: "1", filter: "none",
    });
    for (const edge of ["top", "right", "bottom", "left"]) node.styles["border-" + edge + "-color"] = "transparent";
    if (node.styles.display === "inline") node.styles.display = "inline-block";
    warnings.add(label + " was captured as an image.");
  };
  const redact = el => el.matches("input:not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]),textarea,select,[contenteditable]:not([contenteditable=false])");
  const pseudo = (el, type) => {
    const computed = getComputedStyle(el, type);
    const content = computed.content;
    if (!content || content === "none" || content === "normal" || computed.display === "none") return [];
    if (!/^"(?:[^"\\]|\\.)*"$/.test(content)) {
      warnings.add("Some generated content could not be copied.");
      return [];
    }
    const value = content.slice(1, -1).replace(/\\([0-9a-f]{1,6})\s?|\\(.)/gi, (_, code, char) => {
      const n = parseInt(code, 16);
      return char ?? (n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "\ufffd");
    });
    count += value ? 2 : 1;
    if (count > 1600) throw new Error("This screen exceeds the editable layer limit.");
    return [layer("span", type, css(computed), {}, value ? [text(value)] : [])];
  };
  const copy = (current, depth) => {
    if (count > 1600 || depth > 38) throw new Error("This screen exceeds the editable layer limit.");
    if (current.nodeType === Node.TEXT_NODE) {
      if (current.data.length > 64_000) throw new Error("This screen exceeds the editable text limit.");
      count++;
      return text(current.data);
    }
    if (current.nodeType !== Node.ELEMENT_NODE) return null;
    const tag = current.localName;
    if (ignored.has(tag) || current.hasAttribute("data-carbon-inspect-overlay")) return null;
    const computed = getComputedStyle(current);
    if (computed.display === "none" || computed.contentVisibility === "hidden" || computed.opacity === "0" ||
      (computed.visibility !== "visible" && !current.children.length)) return null;
    count++;
    const styles = css(computed);
    const nestedScroll = current !== document.scrollingElement &&
      ((/auto|scroll/.test(styles["overflow-y"] ?? "") && current.scrollHeight > current.clientHeight) ||
        (/auto|scroll/.test(styles["overflow-x"] ?? "") && current.scrollWidth > current.clientWidth));
    if (fullPage && nestedScroll) {
      warnings.add("Nested scroll areas show their current view.");
    }
    const svg = current.namespaceURI === "http://www.w3.org/2000/svg";
    const attrs = {};
    for (const { name, value } of current.attributes) {
      if (!attributes.has(name) || value.includes("carbon-canvas-asset://") || value.length > 64_000) continue;
      if (name === "id" && (!svg || !/^[\w-]+$/.test(value))) continue;
      if (/\burl\((?!#[\w-]+\))/.test(value)) continue;
      attrs[name] = value;
    }
    const node = layer(tag === "body" || tag === "html" ? "div" : tag, tag, styles, attrs);
    if (redact(current)) {
      node.tag = "div";
      if (node.styles.display === "inline") node.styles.display = "inline-block";
      node.name = "Form field · Value omitted";
      warnings.add("Form field values were omitted.");
    } else if (nestedScroll && (current.scrollTop || current.scrollLeft)) {
      imageRegion(node, "Scrolled area", absolute(current));
    } else if (raster.has(tag) || current.shadowRoot || tag.includes("-") || (tag === "svg" && current.querySelector("use, foreignObject, image"))) {
      imageRegion(node, tag === "iframe" ? "Embedded page" : tag, absolute(current));
    } else if (tag === "img") {
      const image = resource(current.currentSrc || current.src, "image");
      const at = absolute(current);
      if (image) node.attributes.src = assetRef(image);
      uses.push(() => { if (!image?.data) imageRegion(node, "Image", at); });
    } else {
      if (!svg) node.children.push(...pseudo(current, "::before"));
      for (const child of current.childNodes) {
        if (child.nodeType === Node.TEXT_NODE && computed.visibility !== "visible") continue;
        const result = copy(child, depth + 1);
        if (result) node.children.push(result);
      }
      if (!svg) node.children.push(...pseudo(current, "::after"));
    }
    if (!node.rasterRegion && !redact(current)) {
      const refs = tokenReferences(current, computed, styles);
      if (styles.position === "fixed") {
        delete refs["margin-top"];
        delete refs["margin-left"];
      }
      if (Object.keys(refs).length) node.tokenReferences = refs;
    }
    if (styles.position === "fixed" || styles.position === "sticky") {
      const at = absolute(current);
      if (styles.position === "fixed") Object.assign(styles, {
        top: (at.y - clip.y) + "px", left: (at.x - clip.x) + "px", right: "auto", bottom: "auto",
        "margin-top": "0", "margin-left": "0",
      });
      else styles.position = "relative";
    }
    return node;
  };

  let nodes = [], imageOnly = false, pageCss = "";
  const root = selected ?? document.body ?? pageRoot;
  try {
    if (selected) {
      for (let ancestor = selected; ancestor; ancestor = ancestor.parentElement ?? ancestor.getRootNode().host) {
        const style = getComputedStyle(ancestor);
        const matrix = new DOMMatrix(style.transform === "none" ? undefined : style.transform);
        if (!matrix.is2D || matrix.a !== 1 || matrix.b !== 0 || matrix.c !== 0 || matrix.d !== 1 ||
          style.scale !== "none" || style.rotate !== "none" || Number(style.zoom) !== 1) {
          throw new Error("The selected element’s transform was captured as an image.");
        }
      }
    }
    const node = copy(root, 0);
    if (!node || node.kind !== "element") throw new Error("This screen could only be captured as an image.");
    if (selected?.ownerSVGElement) throw new Error("This SVG selection was captured as an image.");
    if (selected) {
      Object.assign(node.styles, {
        position: "relative", top: "auto", right: "auto", bottom: "auto", left: "auto",
        "margin-top": "0", "margin-left": "0", "margin-right": "0", "margin-bottom": "0",
        transform: "none", translate: "none",
      });
      if (node.styles.display === "inline") node.styles.display = "block";
      for (const side of ["top", "right", "bottom", "left"]) delete node.tokenReferences?.["margin-" + side];
    }
    if (!selected) {
      const background = css(getComputedStyle(pageRoot), styleKeys.filter(key => key.startsWith("background-")));
      pageCss = "html{" + Object.entries(background).map(([key, value]) => key + ":" + value).join(";") + "}";
    }
    nodes = [node];
  } catch (error) {
    warnings.add(error.message);
    imageOnly = true;
  }
  const definitions = [];
  if (!imageOnly) {
    const fontRules = (rules, base, depth = 0) => {
      if (depth > 8 || definitions.length >= 64) return;
      for (const rule of rules) {
        if (rule instanceof CSSFontFaceRule) {
          const name = rule.style.getPropertyValue("font-family");
          if (!fonts.has(family(name)) || /[;{}<>]/.test(name)) continue;
          const assets = [...rule.style.getPropertyValue("src").matchAll(urlPattern)]
            .map(([, a, b, c]) => resource(a ?? b ?? c, "font", base))
            .filter(Boolean);
          const properties = ["font-style", "font-weight", "font-stretch", "unicode-range", "font-display"]
            .map(prop => [prop, rule.style.getPropertyValue(prop)]).filter(([, value]) => value);
          definitions.push({ name, assets, properties });
        } else {
          try {
            if (rule.styleSheet) fontRules(rule.styleSheet.cssRules, rule.styleSheet.href ?? base, depth + 1);
            else if (rule.cssRules) fontRules(rule.cssRules, base, depth + 1);
          } catch {}
        }
      }
    };
    for (const sheet of [...document.styleSheets, ...document.adoptedStyleSheets]) {
      try { fontRules(sheet.cssRules, sheet.href ?? document.baseURI); } catch {}
    }
  }

  const masks = new Map();
  const hide = (element, prop, value) => {
    if (!masks.has(element)) masks.set(element, { original: element.getAttribute("style"), masked: null, restore: [] });
    const mask = masks.get(element);
    const original = element.style.getPropertyValue(prop);
    const priority = element.style.getPropertyPriority(prop);
    element.style.setProperty(prop, value, "important");
    mask.masked = element.getAttribute("style");
    const applied = element.style.getPropertyValue(prop);
    mask.restore.push(() => {
      if (element.style.getPropertyValue(prop) !== applied || element.style.getPropertyPriority(prop) !== "important") return;
      if (original) element.style.setProperty(prop, original, priority);
      else element.style.removeProperty(prop);
    });
  };
  const fadeOut = element => {
    hide(element, "transition", "none");
    hide(element, "opacity", "0");
  };
  const uncover = picker?.coverCapture();
  for (const el of document.querySelectorAll("[data-carbon-inspect-overlay=inspect]")) fadeOut(el);
  const roots = [document];
  const frameDocuments = new Map();
  for (const tree of roots) {
    for (const el of tree.querySelectorAll("*")) {
      if (el.shadowRoot) roots.push(el.shadowRoot);
      if (el.localName === "iframe" || el.localName === "frame") {
        const embedded = el.contentDocument;
        frameDocuments.set(el, embedded);
        if (embedded) roots.push(embedded);
        else if (el.getClientRects().length) {
          fadeOut(el);
          warnings.add("An embedded page was hidden because its form fields could not be inspected.");
        }
      }
      if (!redact(el)) continue;
      hide(el, "transition", "none");
      hide(el, "-webkit-text-fill-color", "transparent");
      hide(el, "text-shadow", "none");
      hide(el, "caret-color", "transparent");
      hide(el, "-webkit-text-stroke-width", "0px");
      if (el.isContentEditable || el.localName === "select") hide(el, "opacity", "0");
    }
  }
  let changed = false, released = false;
  const invalidate = () => { changed = true; };
  const observer = new MutationObserver(invalidate);
  for (const tree of roots) observer.observe(tree, { subtree: true, attributes: true, childList: true, characterData: true });
  document.addEventListener("scroll", invalidate, true);
  document.addEventListener("load", invalidate, true);
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(timer);
    observer.disconnect();
    document.removeEventListener("scroll", invalidate, true);
    document.removeEventListener("load", invalidate, true);
    uncover?.();
    for (const [element, mask] of masks) {
      if (element.getAttribute("style") !== mask.masked) {
        for (const undo of mask.restore.reverse()) undo();
        if (mask.original === null && element.getAttribute("style") === "") element.removeAttribute("style");
      } else if (mask.original === null) element.removeAttribute("style");
      else element.setAttribute("style", mask.original);
    }
  };
  const timer = setTimeout(release, 5000);
  const unchanged = () => !released && !changed && !observer.takeRecords().length &&
    location.href === pageUrl && document.documentElement === pageRoot &&
    [...frameDocuments].every(([frame, doc]) => frame.contentDocument === doc) &&
    scrollX === scroll.x && scrollY === scroll.y &&
    innerWidth === viewport.width && innerHeight === viewport.height
    && (!selected || selected.isConnected && Object.entries(bounds).every(([key, value]) => Math.abs(absolute(selected)[key] - value) <= 1));
  const astro = root.closest("[data-astro-source-file]")?.getAttribute("data-astro-source-file");
  const source = astro ? { confidence: "approximate", file: astro.split(/[?#]/)[0].slice(0, 1024), line: null, framework: "Astro" } : null;
  window[handle] = {
    release,
    async finish() {
      const stable = unchanged();
      release();
      delete window[handle];
      if (!stable) throw new Error("The page changed or capture expired. Try again.");
      await Promise.all([...resources.values()].map(asset => asset.done));
      for (const use of uses) use();
      const loadedFamilies = new Set();
      const fontCss = definitions.flatMap(({ name, assets, properties }) => {
        const available = assets.filter(asset => asset.data);
        if (!available.length) return [];
        loadedFamilies.add(family(name));
        return ["@font-face{font-family:" + name + ";src:" + available.map(asset => "url(" + assetRef(asset) + ")").join(",") +
          ";" + properties.map(([key, value]) => key + ":" + value).join(";") + "}"];
      }).join("\n");
      if (!imageOnly) for (const face of document.fonts) {
        if (face.status === "loaded" && fonts.has(family(face.family)) && !loadedFamilies.has(family(face.family))) {
          warnings.add("Font " + face.family + " could not be copied.");
        }
      }
      return {
        viewport, bounds, clip, pagePath, capturedAt, selector,
        source, nodes, css: pageCss + fontCss, warnings: [...warnings], tokenTheme: [...tokenTheme],
        imageOnly: imageOnly || !!selected && !!nodes[0]?.rasterRegion,
        assets: [...resources.values()].map(({ id, kind, data }) => ({ id, kind, data })),
      };
    },
  };
  return new Promise(resolve => {
    const ready = () => resolve({ clip, scale: viewport.scale, sourceLookup: source ? null : { selector, pagePath, documentTimeOrigin } });
    const timeout = setTimeout(ready, 150);
    requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timeout); ready(); }));
  });
}

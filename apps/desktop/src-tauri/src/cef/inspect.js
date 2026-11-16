(() => {
  window.__carbonPick?.stop();
  const documentId = '__CARBON_DOCUMENT_ID__';
  const host = document.createElement('div');
  host.setAttribute('data-carbon-inspect-overlay', '');
  host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important';
  const shadow = host.attachShadow({ mode: 'closed' });
  const stylesheet = new CSSStyleSheet();
  stylesheet.replaceSync(`
    *{box-sizing:border-box} .box{position:fixed;pointer-events:none;border:2px solid #f5c400;background:#f5c40018;border-radius:3px}
    .picked{border-color:#f5c400;background:#f5c40012} .padding{border:0;background:#65bb762e} .margin{border:1px dashed #edaa64;background:#edaa6420}
    .label{position:fixed;max-width:420px;padding:7px 10px;border-radius:6px;background:#202020;color:#fff;font:12px/1.6 ui-monospace,monospace;white-space:pre-wrap;box-shadow:0 2px 8px #0004}
  `);
  shadow.adoptedStyleSheets = [stylesheet];
  document.documentElement.append(host);
  // Frame input never bubbles through the app's earlier window capture listeners.
  const shield = document.createElement('iframe');
  shield.name = '__carbon_inspect_input_' + documentId;
  shield.title = 'Inspect input';
  shield.tabIndex = -1;
  shield.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;background:transparent;pointer-events:auto;color-scheme:normal';
  shadow.append(shield);
  const input = shield.contentWindow;
  const inputDocument = shield.contentDocument;
  if (!input || !inputDocument) { host.remove(); throw new Error('Inspect could not create its input layer'); }
  inputDocument.documentElement.style.background = 'transparent';
  inputDocument.body.style.cssText = 'margin:0;background:transparent';
  const paint = document.createElement('div');
  shadow.append(paint);
  const layer = document.createElement('div');
  paint.append(layer);
  const hover = document.createElement('div');
  hover.className = 'box';
  const label = document.createElement('div');
  label.className = 'label';
  const margin = document.createElement('div');
  margin.className = 'box margin';
  const padding = document.createElement('div');
  padding.className = 'box padding';
  paint.append(margin, padding, hover, label);
  let selected = [];
  let drag = null;
  let pointer = null;
  let alt = false;
  let paused = false;
  let revision = 0;
  const pagePath = () => location.pathname;
  let path = location.href;
  const say = (action = 'change') => console.log('__carbon_pick__' + JSON.stringify({ documentId, count: selected.length, action }));
  const block = (event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  const bounds = (r) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
  const region = (a, b) => ({ x: Math.max(0, Math.min(a.x, b.x)), y: Math.max(0, Math.min(a.y, b.y)), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
  const box = (node, r) => {
    node.hidden = !r || r.width <= 0 || r.height <= 0;
    if (r) Object.assign(node.style, { left: r.x + 'px', top: r.y + 'px', width: r.width + 'px', height: r.height + 'px' });
  };
  const pointOf = event => {
    const r = shield.getBoundingClientRect();
    return { x: r.x + event.clientX * r.width / shield.clientWidth, y: r.y + event.clientY * r.height / shield.clientHeight };
  };
  const elementAt = (event) => {
    const point = pointOf(event);
    shield.style.pointerEvents = 'none';
    try {
      let node = document.elementFromPoint(point.x, point.y);
      while (node?.shadowRoot?.elementFromPoint) {
        observer.observe(node.shadowRoot, observeOptions);
        const inner = node.shadowRoot.elementFromPoint(point.x, point.y);
        if (!inner || inner === node) break;
        node = inner;
      }
      return node === host ? null : node;
    }
    finally { shield.style.pointerEvents = 'auto'; }
  };
  const selectorOf = (el) => {
    const parts = [];
    for (let node = el; node; node = node.parentElement) {
      let part = node.localName;
      if (node.id) {
        part += '#' + CSS.escape(node.id);
        parts.unshift(part);
        if (node.getRootNode().querySelectorAll('#' + CSS.escape(node.id)).length === 1) break;
        parts.shift();
      }
      const siblings = node.parentElement ? [...node.parentElement.children].filter(n => n.localName === node.localName) : [];
      if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      parts.unshift(part);
    }
    const root = el.getRootNode();
    const local = parts.join(' > ');
    return root.host ? selectorOf(root.host) + ' >>> ' + local : local;
  };
  const unavailable = () => ({ confidence: 'unavailable', file: null, line: null, framework: null });
  const sourceOf = (el) => {
    try {
      const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
      const fiber = key && el[key];
      if (fiber?._debugSource?.fileName) return { confidence: 'exact', file: fiber._debugSource.fileName, line: fiber._debugSource.lineNumber || null, framework: 'React' };
      for (let f = fiber; f; f = f.return) {
        if (f._debugSource?.fileName) return { confidence: 'approximate', file: f._debugSource.fileName, line: f._debugSource.lineNumber || null, framework: 'React' };
        const stack = f._debugStack?.stack;
        const match = typeof stack === 'string' && stack.match(/(?:\(|at )((?:file:\/\/|https?:\/\/|\/).*?):(\d+):\d+\)?/);
        if (match) return { confidence: 'approximate', file: match[1], line: Number(match[2]), framework: 'React' };
      }
      if (el.__svelte_meta?.loc?.file) return { confidence: 'exact', file: el.__svelte_meta.loc.file, line: el.__svelte_meta.loc.line || null, framework: 'Svelte' };
      const file = el.__vueParentComponent?.type?.__file;
      if (file) return { confidence: 'approximate', file, line: null, framework: 'Vue' };
      const astro = el.closest('[data-astro-source-file]');
      if (astro) return { confidence: 'approximate', file: astro.getAttribute('data-astro-source-file'), line: null, framework: 'Astro' };
    } catch {}
    return unavailable();
  };
  const cssKeys = ['display','position','box-sizing','width','height','min-width','max-width','min-height','max-height','padding-top','padding-right','padding-bottom','padding-left','margin-top','margin-right','margin-bottom','margin-left','gap','row-gap','column-gap','grid-template-columns','grid-template-rows','flex-direction','flex-wrap','align-items','justify-content','font-family','font-size','font-weight','line-height','letter-spacing','color','background-color','border-radius','border-width','border-color','box-shadow','opacity','overflow'];
  const markupOf = (el) => {
    // An inert document has no custom-element registry that could rerun app constructors.
    const copy = document.implementation.createHTMLDocument('').importNode(el, true);
    for (const n of [copy, ...copy.querySelectorAll('*')]) {
      if (/^(script|style|noscript)$/i.test(n.localName) || n.hasAttribute('data-carbon-inspect-overlay')) { n.remove(); continue; }
      for (const attr of [...n.attributes]) {
        if (/^on/i.test(attr.name) || /^(value|srcdoc|nonce|data-carbon-ref)$/i.test(attr.name)) n.removeAttribute(attr.name);
        else if (/^(href|src|action|formaction)$/i.test(attr.name)) {
          try { const url = new URL(attr.value, location.href); n.setAttribute(attr.name, url.pathname); }
          catch { n.removeAttribute(attr.name); }
        }
      }
    }
    return copy.outerHTML.slice(0, 12000);
  };
  const changed = () => { revision++; render(); say(); };
  const render = () => {
    layer.replaceChildren();
    for (const item of selected) {
      const node = document.createElement('div');
      node.className = 'box picked';
      box(node, item.element ? item.element.getBoundingClientRect() : item.rect);
      layer.append(node);
    }
  };
  const measure = () => {
    const el = pointer && elementAt(pointer);
    const r = el?.getBoundingClientRect();
    box(hover, r);
    label.hidden = !r;
    margin.hidden = padding.hidden = true;
    if (!r) return;
    const cs = getComputedStyle(el);
    let text = el.localName + '  ' + Math.round(r.width) + ' × ' + Math.round(r.height);
    if (alt) {
      const values = prefix => ['Top','Right','Bottom','Left'].map(side => cs[prefix + side]).join(' ');
      text += '\npadding ' + values('padding') + '\nmargin  ' + values('margin') + '\ngap     ' + cs.rowGap + ' / ' + cs.columnGap;
      const mt = parseFloat(cs.marginTop) || 0, mr = parseFloat(cs.marginRight) || 0, mb = parseFloat(cs.marginBottom) || 0, ml = parseFloat(cs.marginLeft) || 0;
      box(margin, { x: r.x - ml, y: r.y - mt, width: r.width + ml + mr, height: r.height + mt + mb });
      box(padding, bounds(r));
      Object.assign(padding.style, { background: 'transparent', borderStyle: 'solid', borderColor: '#65bb7640', borderWidth: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' ') });
    }
    label.textContent = text;
    label.style.left = Math.max(8, Math.min(r.x, innerWidth - 420)) + 'px';
    label.style.top = Math.max(8, Math.min(r.bottom + 8, innerHeight - (alt ? 110 : 40))) + 'px';
  };
  const move = event => {
    if (paused) { block(event); return; }
    pointer = event;
    alt = event.altKey;
    const point = pointOf(event);
    if (drag && Math.hypot(point.x - drag.x, point.y - drag.y) > 4) {
      drag.moved = true;
      box(hover, region(drag, point));
      label.hidden = margin.hidden = padding.hidden = true;
    } else measure();
    block(event);
  };
  const down = event => {
    block(event);
    if (paused || event.button !== 0) return;
    input.focus();
    try { inputDocument.documentElement.setPointerCapture(event.pointerId); } catch {}
    drag = { ...pointOf(event), moved: false, shift: event.shiftKey };
  };
  const up = event => {
    block(event);
    if (paused || !drag || event.button !== 0) return;
    const point = pointOf(event);
    if (drag.moved) {
      const r = region(drag, point);
      if (!drag.shift) selected = [];
      if (r.width > 4 && r.height > 4 && selected.length < 20) selected.push({ rect: r });
    } else {
      const element = elementAt(event);
      const found = selected.findIndex(item => item.element === element);
      if (!drag.shift) selected = [];
      if (element && (!drag.shift || found < 0) && selected.length < 20) selected.push({ element });
      else if (drag.shift && found >= 0) selected.splice(found, 1);
    }
    drag = null;
    changed();
    measure();
  };
  const cancel = event => { block(event); drag = null; measure(); };
  const key = event => {
    if (event.key === 'Escape') { block(event); stop(); say('cancel'); }
    else if (event.key === 'Alt') { alt = event.type === 'keydown'; measure(); }
    else if (!event.metaKey && !event.ctrlKey) block(event);
  };
  const refresh = () => {
    const nextPath = location.href;
    const kept = nextPath === path ? selected.filter(item => !item.element || item.element.isConnected) : [];
    path = nextPath;
    if (kept.length !== selected.length) { selected = kept; changed(); }
    else render();
  };
  const scroll = () => {
    // A region is viewport-relative; scrolling must never move its capture onto other content.
    selected = selected.filter(item => item.element);
    changed();
    measure();
  };
  const observer = new MutationObserver(records => {
    const pageChanged = records.some(record => record.target !== host && !host.contains(record.target));
    if (!pageChanged) return;
    if (paused) revision++;
    refresh();
  });
  const observeOptions = { childList: true, subtree: true, attributes: true, characterData: true };
  observer.observe(document.documentElement, observeOptions);
  const observeRoots = root => {
    for (const element of root.querySelectorAll('*')) {
      if (!element.shadowRoot) continue;
      observer.observe(element.shadowRoot, observeOptions);
      observeRoots(element.shadowRoot);
    }
  };
  const listeners = [['pointermove',move],['pointerdown',down],['pointerup',up],['pointercancel',cancel],['lostpointercapture',cancel],['click',block],['dblclick',block],['contextmenu',block],['keydown',key],['keyup',key]];
  const pageListeners = [['scroll',scroll],['resize',scroll],['popstate',refresh]];
  const stop = () => {
    observer.disconnect();
    for (const [type, fn] of listeners) input.removeEventListener(type, fn, true);
    for (const [type, fn] of pageListeners) window.removeEventListener(type, fn, true);
    host.remove();
    delete window.__carbonPick;
  };
  window.__carbonPick = {
    documentId,
    stop,
    capture() {
      refresh();
      if (paused) throw new Error('An inspection capture is already in progress');
      observeRoots(document);
      const capturedRevision = revision;
      const viewport = { width: innerWidth, height: innerHeight, scale: devicePixelRatio };
      const items = selected.map(item => {
        const el = item.element;
        const r = el ? el.getBoundingClientRect() : item.rect;
        const cs = el && getComputedStyle(el);
        return { kind: el ? 'element' : 'region', selector: el ? selectorOf(el) : null, pagePath: pagePath(), title: document.title.slice(0, 300), viewport, bounds: bounds(r), markup: el ? markupOf(el) : null, styles: cs ? Object.fromEntries(cssKeys.map(k => [k, cs.getPropertyValue(k)])) : {}, source: el ? sourceOf(el) : unavailable(), tabId: 0, documentId, capturedAt: new Date().toISOString() };
      });
      paused = true;
      paint.style.setProperty('visibility', 'hidden', 'important');
      return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve({ documentId, revision: capturedRevision, items }))));
    },
    finish(capturedRevision, clear) {
      paused = false;
      paint.style.removeProperty('visibility');
      if (clear && capturedRevision === revision) { selected = []; changed(); }
      measure();
    },
    valid(capturedRevision) { refresh(); return revision === capturedRevision; },
  };
  for (const [type, fn] of listeners) input.addEventListener(type, fn, { capture: true, passive: false });
  for (const [type, fn] of pageListeners) window.addEventListener(type, fn, { capture: true, passive: true });
  input.focus();
  hover.hidden = label.hidden = margin.hidden = padding.hidden = true;
  say();
})();

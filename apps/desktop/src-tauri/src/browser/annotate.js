// Injected into a page by Ask (cef.rs, `ANNOTATE_JS`): click to annotate the
// element under the pointer, drag to annotate an area. Everything it tells
// Carbon goes out as one `console.log` line prefixed `__carbon_annotate__`;
// Carbon answers a crop request by calling `window.__carbonAnnotate.shot`.
// `window.__carbonAnnotateInit` carries what was already saved, so a reload
// or a navigation keeps the list and draws the markers made on this URL.
//
// Built without innerHTML and styled through a constructed sheet, since a
// page's Trusted Types or CSP would refuse both of the shorter routes.
(() => {
  const init = window.__carbonAnnotateInit || { items: [] };
  delete window.__carbonAnnotateInit;
  if (window.__carbonAnnotate) window.__carbonAnnotate.stop();

  const say = (message) => console.log("__carbon_annotate__" + JSON.stringify(message));
  const BLUE = "#2f6feb";

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .layer { position: fixed; inset: 0; pointer-events: none; font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif; color: #ececec; }
    .hover { position: fixed; display: none; border: 1.5px solid ${BLUE}; background: rgba(47,111,235,.08); border-radius: 3px; }
    .drag, .sel { position: fixed; display: none; border: 1.5px dashed ${BLUE}; background: rgba(47,111,235,.06); }
    .marker { position: fixed; width: 24px; height: 24px; margin-top: -24px; border-radius: 50% 50% 50% 2px; background: ${BLUE}; color: #fff; border: 1.5px solid rgba(255,255,255,.9); box-shadow: 0 2px 6px rgba(0,0,0,.35); font-size: 11px; font-weight: 600; display: flex; align-items: center; justify-content: center; pointer-events: auto; cursor: pointer; }
    .marker:hover { filter: brightness(1.12); }
    .comment { position: fixed; display: none; width: 300px; align-items: flex-end; gap: 4px; padding: 6px 6px 6px 14px; border-radius: 22px; background: #1f1f1f; border: 1px solid rgba(255,255,255,.08); box-shadow: 0 8px 24px rgba(0,0,0,.4); pointer-events: auto; cursor: default; }
    textarea { flex: 1; min-width: 0; height: 28px; max-height: 120px; padding: 5px 0; border: 0; outline: 0; resize: none; background: transparent; color: #ececec; font: inherit; cursor: text; }
    textarea::placeholder { color: #8a8a8a; }
    button { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; cursor: pointer; color: #e6e6e6; }
    button:disabled { opacity: .35; cursor: default; }
    button svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .round { width: 28px; height: 28px; border-radius: 50%; }
    .round svg { width: 16px; height: 16px; }
    .submit { background: #e8e8e8; color: #111; }
    .submit:disabled { background: rgba(255,255,255,.14); color: #ddd; opacity: 1; }
    .ghost:hover:not(:disabled) { background: rgba(255,255,255,.08); }
    .bar { position: fixed; display: flex; align-items: center; gap: 2px; height: 44px; padding: 0 6px; border-radius: 16px; background: #1e1e1e; border: 1px solid rgba(255,255,255,.08); box-shadow: 0 8px 24px rgba(0,0,0,.4); pointer-events: auto; cursor: default; user-select: none; -webkit-user-select: none; }
    .bar .ghost { width: 32px; height: 32px; border-radius: 10px; }
    .grip { width: 22px; height: 32px; cursor: grab; color: #8a8a8a; }
    .grip:active { cursor: grabbing; }
    .label { padding: 0 8px 0 2px; font-size: 14px; font-weight: 500; white-space: nowrap; }
    .send { height: 32px; padding: 0 14px; margin: 0 2px 0 4px; border-radius: 10px; background: ${BLUE}; color: #fff; font-size: 14px; font-weight: 500; }
    .send:hover:not(:disabled) { filter: brightness(1.1); }
  `;

  const ICONS = {
    grip: [["circle", { cx: 9, cy: 5, r: 1 }], ["circle", { cx: 9, cy: 12, r: 1 }], ["circle", { cx: 9, cy: 19, r: 1 }], ["circle", { cx: 15, cy: 5, r: 1 }], ["circle", { cx: 15, cy: 12, r: 1 }], ["circle", { cx: 15, cy: 19, r: 1 }]],
    focus: [["circle", { cx: 12, cy: 12, r: 3 }], ["path", { d: "M3 7V5a2 2 0 0 1 2-2h2" }], ["path", { d: "M17 3h2a2 2 0 0 1 2 2v2" }], ["path", { d: "M21 17v2a2 2 0 0 1-2 2h-2" }], ["path", { d: "M7 21H5a2 2 0 0 1-2-2v-2" }]],
    eye: [["path", { d: "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" }], ["circle", { cx: 12, cy: 12, r: 3 }]],
    eyeOff: [["path", { d: "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" }], ["path", { d: "M14.084 14.158a3 3 0 0 1-4.242-4.242" }], ["path", { d: "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" }], ["path", { d: "m2 2 20 20" }]],
    trash: [["path", { d: "M3 6h18" }], ["path", { d: "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" }], ["path", { d: "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" }]],
    x: [["path", { d: "M18 6 6 18" }], ["path", { d: "m6 6 12 12" }]],
    up: [["path", { d: "m5 12 7-7 7 7" }], ["path", { d: "M12 19V5" }]],
  };

  const el = (tag, cls, children = []) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    for (const child of children) node.append(child);
    return node;
  };
  const icon = (name) => {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    for (const [tag, attrs] of ICONS[name]) {
      const part = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) part.setAttribute(k, String(v));
      svg.append(part);
    }
    return svg;
  };
  const button = (cls, label, content) => {
    const b = el("button", cls, [content]);
    b.type = "button";
    b.title = label;
    b.setAttribute("aria-label", label);
    return b;
  };

  // `all: initial` on the host keeps the page's own rules off it; the shadow
  // root keeps them off everything inside.
  const host = document.createElement("carbon-annotate");
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
  const root = host.attachShadow({ mode: "closed" });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(CSS);
  root.adoptedStyleSheets = [sheet];
  const cursor = new CSSStyleSheet();
  const pin = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M2 22V12a10 10 0 1 1 10 10Z" fill="${BLUE}" stroke="white" stroke-width="1.5"/></svg>`;
  cursor.replaceSync(`html, html * { cursor: url("data:image/svg+xml,${encodeURIComponent(pin)}") 2 22, crosshair !important; }`);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, cursor];

  const hoverBox = el("div", "hover");
  const dragBox = el("div", "drag");
  const selBox = el("div", "sel");
  const markers = el("div", "");

  const input = document.createElement("textarea");
  input.rows = 1;
  input.placeholder = "Add a comment…";
  const remove = button("round ghost", "Delete annotation", icon("trash"));
  const submit = button("round submit", "Save comment", icon("up"));
  const comment = el("div", "comment", [input, remove, submit]);

  const label = el("span", "label");
  const shotButton = button("ghost", "Take a screenshot", icon("focus"));
  const hideButton = button("ghost", "Hide markers", icon("eyeOff"));
  const clearButton = button("ghost", "Discard annotations", icon("trash"));
  const sendButton = button("send", "Send annotations to the chat", "Send");
  const closeButton = button("ghost", "Stop annotating", icon("x"));
  const grip = button("grip", "Move", icon("grip"));
  const bar = el("div", "bar", [grip, label, shotButton, hideButton, clearButton, sendButton, closeButton]);

  const layer = el("div", "layer", [hoverBox, dragBox, selBox, markers, comment, bar]);
  root.append(layer);
  document.documentElement.appendChild(host);

  /// Saved annotations, in the order the pill will list them. `area` and
  /// `marker` are page coordinates, so they scroll with the page; `rect` is
  /// what the agent is told, the viewport rect at the time.
  let items = Array.isArray(init.items) ? init.items : [];
  const newId = () => crypto.getRandomValues(new Uint32Array(1))[0];
  let hidden = false;
  /// The annotation whose comment box is open: a new one, or a saved one
  /// being edited (`editing`).
  let draft = null;
  let press = null;
  let dragging = false;
  let barAt = init.bar || null;
  let waiting = null;
  let capturing = null;
  let pendingShot = null;
  let sendAfterRequest = false;

  const inUi = (ev) => ev.composedPath().includes(host);
  const here = (item) => item.url === location.href;
  const toView = (p) => ({ x: p.x - scrollX, y: p.y - scrollY });

  const place = (node, r) => {
    const v = toView(r);
    node.style.left = v.x + "px";
    node.style.top = v.y + "px";
    node.style.width = r.width + "px";
    node.style.height = r.height + "px";
  };

  const selectorOf = (node) => {
    const parts = [];
    for (let e = node, i = 0; e && e.nodeType === 1 && i < 5; e = e.parentElement, i++) {
      let s = e.tagName.toLowerCase();
      if (e.id) { parts.unshift(s + "#" + CSS_escape(e.id)); break; }
      const cls = [...e.classList].filter((c) => !/^[a-z]+-\[|:/.test(c)).slice(0, 2);
      if (cls.length) s += "." + cls.map(CSS_escape).join(".");
      const p = e.parentElement;
      if (p) {
        const same = [...p.children].filter((c) => c.tagName === e.tagName);
        if (same.length > 1) s += ":nth-of-type(" + (same.indexOf(e) + 1) + ")";
      }
      parts.unshift(s);
    }
    return parts.join(" > ");
  };
  const CSS_escape = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s);

  const elementAt = (x, y) => {
    const node = document.elementFromPoint(x, y);
    return node && node !== host ? node : null;
  };

  function render() {
    label.textContent = "Annotating · " + items.length;
    sendButton.disabled = items.length === 0 && !(draft && input.value.trim());
    clearButton.disabled = items.length === 0 && !draft;
    hideButton.replaceChildren(icon(hidden ? "eye" : "eyeOff"));
    hideButton.title = hidden ? "Show markers" : "Hide markers";
    hideButton.setAttribute("aria-label", hideButton.title);

    markers.replaceChildren();
    if (!hidden) {
      items.forEach((item, i) => {
        if (!here(item) || (draft && draft.editing && draft.id === item.id)) return;
        const m = el("div", "marker", [String(i + 1)]);
        const v = toView(item.marker);
        m.style.left = v.x + "px";
        m.style.top = v.y + "px";
        m.title = item.note;
        m.addEventListener("click", () => edit(item));
        markers.append(m);
      });
    }

    if (draft) {
      hoverBox.style.display = "none";
      const n = draft.editing ? items.findIndex((i) => i.id === draft.id) + 1 : 0;
      const m = el("div", "marker", n ? [String(n)] : []);
      const v = toView(draft.marker);
      m.style.left = v.x + "px";
      m.style.top = v.y + "px";
      markers.append(m);
      selBox.style.display = draft.target.kind === "page" ? "none" : "block";
      place(selBox, draft.area);
      comment.style.display = "flex";
      placeComment();
      remove.style.display = draft.editing ? "" : "none";
      submit.disabled = !input.value.trim();
    } else {
      selBox.style.display = "none";
      comment.style.display = "none";
    }

    if (barAt) {
      bar.style.left = barAt.x + "px";
      bar.style.top = barAt.y + "px";
      bar.style.transform = "";
    } else {
      bar.style.left = "50%";
      bar.style.top = innerHeight - 64 + "px";
      bar.style.transform = "translateX(-50%)";
    }
  }

  /// Beside the marker where there is room — right, then left, then below
  /// or above the selection — and never over the marker or the toolbar.
  function placeComment() {
    const v = toView(draft.marker);
    const a = toView(draft.area);
    const w = 300;
    const h = comment.offsetHeight || 42;
    const avoid = bar.getBoundingClientRect();
    const fits = (x, y) =>
      x >= 8 && y >= 8 && x + w <= innerWidth - 8 && y + h <= innerHeight - 8 &&
      !(x < avoid.right && x + w > avoid.left && y < avoid.bottom && y + h > avoid.top);
    const midX = Math.min(Math.max(8, v.x - w / 2), innerWidth - w - 8);
    const spots = [
      [v.x + 32, v.y - 30],
      [v.x - w - 8, v.y - 30],
      [midX, Math.max(v.y, a.y + draft.area.height) + 8],
      [midX, Math.min(v.y - 24, a.y) - h - 8],
    ];
    // A page too small for any of those still shows it, just above the bar.
    const fallback = [midX, Math.max(8, avoid.top - h - 8)];
    const sideY = Math.max(8, Math.min(v.y, innerHeight - h - 8));
    const outside = ([x, y]) => x >= a.x + draft.area.width || x + w <= a.x || y >= a.y + draft.area.height || y + h <= a.y;
    const candidates = [...spots, [a.x + draft.area.width + 8, sideY], [a.x - w - 8, sideY], fallback];
    const [x, y] = candidates.find((p) => fits(...p) && outside(p)) ?? spots.find((p) => fits(...p)) ?? fallback;
    comment.style.left = x + "px";
    comment.style.top = y + "px";
  }

  function grow() {
    input.style.height = "28px";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  }

  // Focus in the selection event so typing never waits for a screenshot.
  function begin(target, rect, marker) {
    if (capturing !== null) return;
    commit();
    const id = newId();
    capturing = id;
    draft = {
      id,
      editing: false,
      target,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      area: { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height },
      marker: { x: marker.x + scrollX, y: marker.y + scrollY },
      url: location.href,
      title: document.title,
    };
    input.value = "";
    // Mask just the selected pixels. Controls outside the crop stay on screen.
    const x = Math.max(0, rect.x), y = Math.max(0, rect.y);
    const r = Math.min(innerWidth, rect.x + rect.width), b = Math.min(innerHeight, rect.y + rect.height);
    layer.style.clipPath = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${x}px ${y}px, ${r}px ${y}px, ${r}px ${b}px, ${x}px ${b}px, ${x}px ${y}px)`;
    render();
    grow();
    input.focus({ preventScroll: true });
    const viewport = { width: innerWidth, height: innerHeight };
    const shot = { id, request: () => say({ type: "shot", id, rect, viewport }) };
    pendingShot = shot;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (pendingShot !== shot) return;
      pendingShot = null;
      shot.request();
      waiting = setTimeout(() => shown(id), 3000);
      if (sendAfterRequest) {
        sendAfterRequest = false;
        send();
      }
    }));
  }

  function shown(id) {
    if (capturing !== id) return;
    capturing = null;
    clearTimeout(waiting);
    layer.style.clipPath = "";
  }

  function edit(item) {
    commit();
    draft = { ...item, editing: true };
    input.value = item.note;
    render();
    grow();
    input.focus({ preventScroll: true });
  }

  /// Saves the open comment if it says anything, else drops it — or, for a
  /// saved one emptied, removes it.
  function commit() {
    if (!draft) return;
    const note = input.value.trim();
    const { editing, ...item } = draft;
    draft = null;
    if (note) {
      item.note = note;
      const at = items.findIndex((i) => i.id === item.id);
      if (at >= 0) items[at] = item;
      else items.push(item);
      say({ type: "save", item });
    } else if (editing) {
      items = items.filter((i) => i.id !== item.id);
      say({ type: "remove", id: item.id });
    }
    render();
  }

  // The page sees none of the pointer: a press here is a selection.
  const swallow = (ev) => {
    if (inUi(ev)) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
  };
  const pass = (ev) => {
    if (inUi(ev)) return;
    ev.stopImmediatePropagation();
  };

  const onDown = (ev) => {
    if (inUi(ev) || ev.button !== 0) return;
    swallow(ev);
    press = { x: ev.clientX, y: ev.clientY };
    dragging = false;
  };

  const onMove = (ev) => {
    if (press) {
      if (!dragging && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > 4) dragging = true;
      if (dragging) {
        hoverBox.style.display = "none";
        dragBox.style.display = "block";
        dragBox.style.left = Math.min(press.x, ev.clientX) + "px";
        dragBox.style.top = Math.min(press.y, ev.clientY) + "px";
        dragBox.style.width = Math.abs(ev.clientX - press.x) + "px";
        dragBox.style.height = Math.abs(ev.clientY - press.y) + "px";
      }
      return;
    }
    if (draft || inUi(ev)) {
      hoverBox.style.display = "none";
      return;
    }
    const node = elementAt(ev.clientX, ev.clientY);
    if (!node) return;
    const r = node.getBoundingClientRect();
    hoverBox.style.display = "block";
    hoverBox.style.left = r.left + "px";
    hoverBox.style.top = r.top + "px";
    hoverBox.style.width = r.width + "px";
    hoverBox.style.height = r.height + "px";
  };

  const onUp = (ev) => {
    if (!press) return;
    swallow(ev);
    const start = press;
    press = null;
    dragBox.style.display = "none";
    if (dragging) {
      dragging = false;
      const rect = {
        x: Math.min(start.x, ev.clientX),
        y: Math.min(start.y, ev.clientY),
        width: Math.abs(ev.clientX - start.x),
        height: Math.abs(ev.clientY - start.y),
      };
      begin({ kind: "region" }, rect, { x: ev.clientX, y: ev.clientY });
      return;
    }
    const node = elementAt(start.x, start.y);
    if (!node) return;
    const r = node.getBoundingClientRect();
    begin(
      {
        kind: "element",
        selector: selectorOf(node),
        tag: node.tagName.toLowerCase(),
        text: (node.innerText || node.textContent || "").trim().replace(/\s+/g, " ").slice(0, 200),
      },
      { x: r.left, y: r.top, width: r.width, height: r.height },
      { x: start.x, y: start.y },
    );
  };

  const onKey = (ev) => {
    if (ev.key !== "Escape" || ev.isComposing) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    close();
  };

  const onScroll = () => render();

  input.addEventListener("input", () => {
    grow();
    if (draft) placeComment();
    submit.disabled = !input.value.trim();
    sendButton.disabled = items.length === 0 && !input.value.trim();
  });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      if (input.value.trim()) commit();
    }
  });
  submit.addEventListener("click", () => commit());
  remove.addEventListener("click", () => {
    if (!draft) return;
    input.value = "";
    commit();
  });

  shotButton.addEventListener("click", () => {
    begin({ kind: "page" }, { x: 0, y: 0, width: innerWidth, height: innerHeight }, { x: innerWidth - 40, y: 40 });
  });
  hideButton.addEventListener("click", () => {
    hidden = !hidden;
    render();
  });
  clearButton.addEventListener("click", () => {
    draft = null;
    items = [];
    say({ type: "clear" });
    render();
  });
  function send() {
    commit();
    if (!items.length) return;
    if (pendingShot) {
      sendAfterRequest = true;
      return;
    }
    say({ type: "send" });
    stop();
  }
  sendButton.addEventListener("click", send);
  closeButton.addEventListener("click", () => close());

  // The toolbar moves by its grip and stays inside the window.
  grip.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    const box = bar.getBoundingClientRect();
    const dx = ev.clientX - box.left;
    const dy = ev.clientY - box.top;
    grip.setPointerCapture(ev.pointerId);
    const move = (e) => {
      barAt = {
        x: Math.min(Math.max(4, e.clientX - dx), innerWidth - box.width - 4),
        y: Math.min(Math.max(4, e.clientY - dy), innerHeight - box.height - 4),
      };
      render();
    };
    const up = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      if (barAt) say({ type: "bar", at: barAt });
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
  });

  // What happens inside the overlay stays there: the page would read a click
  // on the toolbar as a click on its own document.
  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "keydown", "keyup", "keypress", "input", "wheel"]) {
    root.addEventListener(type, (ev) => ev.stopPropagation());
  }

  const opts = { capture: true };
  const listeners = [
    ["pointerdown", pass],
    ["pointerup", pass],
    ["mousedown", onDown],
    ["mousemove", onMove],
    ["mouseup", onUp],
    ["click", swallow],
    ["dblclick", swallow],
    ["auxclick", swallow],
    ["contextmenu", swallow],
    ["keydown", onKey],
  ];
  for (const [type, fn] of listeners) window.addEventListener(type, fn, opts);
  window.addEventListener("scroll", onScroll, { capture: true, passive: true });
  window.addEventListener("resize", onScroll);

  function stop() {
    pendingShot = null;
    capturing = null;
    clearTimeout(waiting);
    for (const [type, fn] of listeners) window.removeEventListener(type, fn, opts);
    window.removeEventListener("scroll", onScroll, { capture: true });
    window.removeEventListener("resize", onScroll);
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== cursor);
    host.remove();
    delete window.__carbonAnnotate;
  }

  function close() {
    if (draft && input.value.trim()) commit();
    const shot = pendingShot;
    stop();
    if (shot && items.some((item) => item.id === shot.id)) shot.request();
    say({ type: "close" });
  }

  window.__carbonAnnotate = { stop, close, shot: (id) => shown(id) };
  render();
})();

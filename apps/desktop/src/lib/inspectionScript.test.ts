import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const script = readFileSync(new URL("../../src-tauri/src/cef/inspect.js", import.meta.url), "utf8");

function page() {
  const frames: (() => void)[] = [];
  const observers: { callback: (records: { target: Element }[]) => void; roots: Set<Root | Element> }[] = [];
  const messages: { count: number; action: string }[] = [];
  const eventWindow = () => {
    const handlers = new Map<string, Set<(event: any) => void>>();
    return {
      focus() {},
      addEventListener(type: string, fn: (event: any) => void) {
        if (!handlers.has(type)) handlers.set(type, new Set());
        handlers.get(type)!.add(fn);
      },
      removeEventListener(type: string, fn: (event: any) => void) { handlers.get(type)?.delete(fn); },
      emit(type: string, data: Record<string, unknown> = {}) {
        const event = { type, clientX: 100, clientY: 100, button: 0, pointerId: 1,
          altKey: false, shiftKey: false, metaKey: false, ctrlKey: false, stopped: false,
          preventDefault() {}, stopImmediatePropagation() { this.stopped = true; }, ...data };
        for (const fn of handlers.get(type) ?? []) { fn(event); if (event.stopped) break; }
      },
    };
  };
  const window = eventWindow() as ReturnType<typeof eventWindow> & { __carbonPick?: any };
  let appInputs = 0;
  let constructors = 0;
  window.addEventListener("pointerdown", () => appInputs++);
  let pointTarget: Element | null = null;
  let shield: Element;
  const style = () => ({
    setProperty(key: string, value: string) { Object.assign(this, { [key]: value }); },
    removeProperty(key: string) { delete (this as any)[key]; },
  });
  class Root {
    children: Element[] = [];
    constructor(readonly host?: Element) {}
    append(...nodes: Element[]) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
    contains(node: Element): boolean { return this.children.some(child => child === node || child.contains(node)); }
    querySelectorAll(selector: string): Element[] {
      const nodes = this.children.flatMap(child => [child, ...child.querySelectorAll("*")]);
      return selector === "*" ? nodes : nodes.filter(node => `#${node.id}` === selector);
    }
    elementFromPoint() {
      const overlayRoot = shield?.getRootNode();
      if (shield?.style.pointerEvents === "auto" && overlayRoot instanceof Root) return overlayRoot.host ?? null;
      let node = pointTarget;
      while (node && node.getRootNode() !== this) {
        const root = node.getRootNode();
        if (!(root instanceof Root) || !root.host) break;
        node = root.host;
      }
      return node;
    }
  }
  class Element {
    parentNode: Root | Element | null = null;
    children: Element[] = [];
    shadowRoot: Root | null = null;
    style: any = style();
    hidden = false;
    textContent = "Save";
    clientWidth = 800;
    clientHeight = 600;
    contentWindow = eventWindow();
    contentDocument: any;
    values = new Map<string, string>();
    constructor(readonly localName: string, id = "") { if (id) this.setAttribute("id", id); }
    get id() { return this.values.get("id") ?? ""; }
    get attributes() { return [...this.values].map(([name, value]) => ({ name, value })); }
    get parentElement(): Element | null { return this.parentNode instanceof Element ? this.parentNode : null; }
    get isConnected(): boolean {
      const root = this.getRootNode();
      return root === document || (root instanceof Root && !!root.host?.isConnected);
    }
    getRootNode(): Root | Element {
      let node: Root | Element = this;
      while (node instanceof Element && node.parentNode) node = node.parentNode;
      return node;
    }
    append(...nodes: Element[]) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
    replaceChildren() { for (const child of this.children) child.parentNode = null; this.children = []; }
    contains(node: Element): boolean { return this.children.some(child => child === node || child.contains(node)); }
    querySelectorAll(selector: string): Element[] {
      const nodes = this.children.flatMap(child => [child, ...child.querySelectorAll("*")]);
      return selector === "*" ? nodes : nodes.filter(node => `#${node.id}` === selector);
    }
    attachShadow({ mode }: { mode: string }) { const root = new Root(this); if (mode === "open") this.shadowRoot = root; return root; }
    getBoundingClientRect() { return { x: 0, y: 0, width: 800, height: 600, bottom: 600 }; }
    setAttribute(name: string, value: string) { this.values.set(name, value); }
    hasAttribute(name: string) { return this.values.has(name); }
    getAttribute(name: string) { return this.values.get(name) ?? null; }
    removeAttribute(name: string) { this.values.delete(name); }
    closest() { return null; }
    setPointerCapture() {}
    remove() {
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this);
      this.parentNode = null;
    }
    cloneNode() { return this.copy(false); }
    copy(inert: boolean): Element {
      if (!inert && this.localName.includes("-")) constructors++;
      const copy = new Element(this.localName, this.id);
      copy.values = new Map(this.values);
      copy.textContent = this.textContent;
      copy.append(...this.children.map(child => child.copy(inert)));
      return copy;
    }
    get outerHTML(): string { return `<${this.localName}>${this.textContent}${this.children.map(child => child.outerHTML).join("")}</${this.localName}>`; }
  }
  const document = Object.assign(new Root(), {
    documentElement: new Element("html"), title: "App",
    implementation: { createHTMLDocument: () => ({ importNode: (node: Element) => node.copy(true) }) },
    createElement(tag: string) {
      const node = new Element(tag);
      if (tag === "iframe") {
        node.contentDocument = { documentElement: new Element("html"), body: new Element("body") };
        shield = node;
      }
      return node;
    },
  });
  document.append(document.documentElement);
  const button = new Element("button", "save");
  document.documentElement.append(button);
  pointTarget = button;
  runInNewContext(script, {
    window, document, location: { href: "http://localhost/settings?private=1", pathname: "/settings" },
    innerWidth: 800, innerHeight: 600, devicePixelRatio: 2, CSS: { escape: (text: string) => text },
    CSSStyleSheet: class { replaceSync() {} },
    MutationObserver: class {
      entry: (typeof observers)[number];
      constructor(callback: (records: { target: Element }[]) => void) { this.entry = { callback, roots: new Set() }; observers.push(this.entry); }
      observe(root: Root | Element) { this.entry.roots.add(root); }
      disconnect() { this.entry.roots.clear(); }
    },
    requestAnimationFrame: (fn: () => void) => frames.push(fn),
    getComputedStyle: () => ({ getPropertyValue: () => "12px" }),
    console: { log: (text: string) => messages.push(JSON.parse(text.slice("__carbon_pick__".length))) },
  });
  const emit = (type: string, data?: Record<string, unknown>) => shield.contentWindow.emit(type, data);
  const mutate = (target: Element) => {
    for (const entry of observers) if ([...entry.roots].some(root => root === target || root.contains(target))) entry.callback([{ target }]);
  };
  return {
    window, button, document, messages, emit, mutate, shield: shield!, appInputs: () => appInputs, constructors: () => constructors,
    pick(node = button, shiftKey = false) { pointTarget = node; emit("pointerdown", { shiftKey }); emit("pointerup", { shiftKey }); emit("click"); },
    frame() { const pending = frames.splice(0); for (const fn of pending) fn(); },
    shadow(id: string) {
      const host = new Element("app-card", id); document.documentElement.append(host);
      const root = host.attachShadow({ mode: "open" }); const child = new Element("button", "save"); root.append(child);
      return { host, root, child };
    },
  };
}

describe("inspection page script", () => {
  it("rejects metadata when the page changes during either settling frame", async () => {
    const p = page();
    p.pick();
    const capture = p.window.__carbonPick.capture();
    p.frame();
    p.button.textContent = "Changed";
    p.mutate(p.button);
    p.frame();
    const batch = await capture;
    expect(batch.items[0].markup).toContain("Save");
    expect(p.window.__carbonPick.valid(batch.revision)).toBe(false);
  });

  it("keeps successful batches usable repeatedly and clears their highlights", async () => {
    const p = page();
    for (let batch = 0; batch < 2; batch++) {
      p.pick();
      const capture = p.window.__carbonPick.capture(); p.frame(); p.frame();
      const captured = await capture;
      expect(captured.items).toHaveLength(1);
      expect(p.window.__carbonPick.valid(captured.revision)).toBe(true);
      p.window.__carbonPick.finish(captured.revision, true);
      expect(p.messages.at(-1)?.count).toBe(0);
      expect(p.window.__carbonPick).toBeDefined();
    }
  });

  it("distinguishes duplicate selectors in different open shadow roots", async () => {
    const p = page();
    const first = p.shadow("first"); const second = p.shadow("second");
    p.pick(first.child); p.pick(second.child, true);
    const capture = p.window.__carbonPick.capture(); p.frame(); p.frame();
    expect((await capture).items.map((item: any) => item.selector)).toEqual([
      "app-card#first >>> button#save", "app-card#second >>> button#save",
    ]);
  });

  it("drops replaced shadow elements before Add to chat", () => {
    const p = page(); const { child, root } = p.shadow("first");
    p.pick(child); child.remove(); p.mutate(root as any);
    expect(p.messages.at(-1)?.count).toBe(0);
  });

  it("rejects region captures when a shadow root changes during settling", async () => {
    const p = page(); const { child } = p.shadow("first");
    p.emit("pointerdown"); p.emit("pointermove", { clientX: 300, clientY: 200 }); p.emit("pointerup", { clientX: 300, clientY: 200 });
    const capture = p.window.__carbonPick.capture();
    p.mutate(child); p.frame(); p.frame();
    expect(p.window.__carbonPick.valid((await capture).revision)).toBe(false);
  });

  it("keeps pointer and keyboard input inside the shield, including while capturing", async () => {
    const p = page();
    p.pick();
    expect(p.messages.at(-1)?.count).toBe(1);
    const capture = p.window.__carbonPick.capture();
    p.pick(); p.frame(); p.frame();
    expect((await capture).items).toHaveLength(1);
    expect(p.appInputs()).toBe(0);
    expect(p.shield.style.visibility).not.toBe("hidden");
    p.emit("keydown", { key: "Escape" });
    expect(p.window.__carbonPick).toBeUndefined();
  });

  it("leaves command shortcuts to the app registry on both key edges", () => {
    const p = page();
    p.pick();
    p.emit("keydown", { key: "l", metaKey: true });
    p.emit("keyup", { key: "l", metaKey: true });
    expect(p.messages.every(message => message.action !== "add")).toBe(true);
  });

  it("serializes components and containers without rerunning custom-element constructors", async () => {
    for (const container of [false, true]) {
      const p = page();
      const { host } = p.shadow("component");
      p.pick(container ? p.document.documentElement : host);
      const capture = p.window.__carbonPick.capture(); p.frame(); p.frame();
      expect((await capture).items).toHaveLength(1);
      expect(p.constructors()).toBe(0);
    }
  });

  it("abandons a cancelled drag", () => {
    const p = page();
    p.emit("pointerdown"); p.emit("pointermove", { clientX: 300 }); p.emit("pointercancel"); p.emit("pointerup");
    expect(p.messages.at(-1)?.count).toBe(0);
  });
});

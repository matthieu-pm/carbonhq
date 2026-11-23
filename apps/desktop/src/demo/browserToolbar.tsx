import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";

import BrowserPane from "@/components/browser/BrowserPane";
import { TooltipProvider } from "@/components/ui/tooltip";
import DemoThemeBar from "@/demo/ThemeBar";
import "../App.css";

/// The browser's URL row at the widths it is drawn at: the right panel at its
/// 320px floor and its 512px default, and the full view.
///
/// Each mount is its own session, so the three never share a tab or a picker.
/// The bridge is stubbed: tabs come from here, and the overflow's native menu
/// (`plugin:menu|*`) is drawn as a plain list where macOS would put its own, so
/// its items and their actions can be checked without the app.
type Tab = {
  id: number;
  url: string;
  title: string;
  favicon: string;
  loading: boolean;
  active: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error: null;
  background?: string;
};

const page = (id: number, url: string, title: string, background?: string): Tab => ({
  id,
  url,
  title,
  favicon: "",
  loading: false,
  active: true,
  canGoBack: true,
  canGoForward: false,
  error: null,
  background,
});

const TABS: Record<string, Tab[]> = {
  narrow: [page(1, "https://carbonhq.sh/", "Carbon", "rgb(0, 0, 0)")],
  panel: [page(2, "http://localhost:3000/pricing", "Acme — Pricing")],
  full: [page(3, "https://carbonhq.sh/", "Carbon — Run every coding agent", "rgb(0, 0, 0)")],
  light: [page(4, "https://docs.carbonhq.sh/guide/getting-started", "Getting started", "rgb(255, 255, 255)")],
  orange: [page(5, "https://shop.example.com/", "Shop", "rgb(255, 102, 0)")],
  w440: [page(6, "http://localhost:5173/settings", "Settings", "rgb(250, 250, 249)")],
  w768: [page(7, "https://github.com/matthieu-pm/carbonhq/pull/70", "Pull request", "rgb(13, 17, 23)")],
  blank: [],
};

type MenuItem = { text?: string; item?: string; checked?: boolean; enabled?: boolean; items?: MenuItem[]; handler?: { id: number } };

const callbacks = new Map<number, (event: unknown) => void>();
const handlers = new Map<string, number[]>();
const menus = new Map<number, MenuItem[]>();
let nextId = 1;
const log: string[] = [];
const watchers = new Set<() => void>();
const render = () => watchers.forEach((w) => w());

/// Re-renders the caller whenever the stub logs a call or opens a menu.
function useBridge() {
  const [, bump] = useState(0);
  useEffect(() => {
    const w = () => bump((n) => n + 1);
    watchers.add(w);
    return () => void watchers.delete(w);
  }, []);
}
let popup: { items: MenuItem[]; x: number; y: number; done: () => void } | null = null;

function note(line: string) {
  log.unshift(line);
  render();
}

Object.assign(window, {
  __TAURI_INTERNALS__: {
    transformCallback: (cb: (event: unknown) => void) => {
      const id = nextId++;
      callbacks.set(id, cb);
      return id;
    },
    invoke: async (cmd: string, args: Record<string, unknown>) => {
      switch (cmd) {
        case "plugin:event|listen":
          handlers.set(args.event as string, [...(handlers.get(args.event as string) ?? []), args.handler as number]);
          return args.handler;
        case "chromium_status":
          return { state: "ready", version: "demo", sizeBytes: 0 };
        case "browser_tabs":
          return TABS[args.sessionId as string] ?? [];
        case "plugin:menu|new": {
          const rid = nextId++;
          menus.set(rid, ((args.options as { items?: MenuItem[] })?.items ?? []) as MenuItem[]);
          return [rid, "menu-demo"];
        }
        case "plugin:menu|popup": {
          // Through JSON, as the real IPC sends it: `Position` serializes itself.
          const at =
            (JSON.parse(JSON.stringify(args.at)) as { Logical?: { x: number; y: number } } | null)?.Logical ??
            { x: 0, y: 0 };
          return new Promise<void>((done) => {
            popup = { items: menus.get(args.rid as number) ?? [], x: at.x, y: at.y, done };
            render();
          });
        }
        case "browser_pick":
        case "browser_nav":
        case "browser_devtools":
        case "browser_open":
          note(`${cmd} ${JSON.stringify(args)}`);
          return null;
        // What `transport` routes to the server that owns the session.
        case "server_invoke":
          return ["list_local_servers", "browser_history"].includes(args.cmd as string) ? [] : null;
        case "list_local_servers":
        case "list_servers":
        case "browser_history":
          return [];
        case "local_server":
        case "browser_snapshot":
        case "browser_layout":
        case "browser_shutter_ready":
        case "plugin:event|unlisten":
        case "plugin:resources|close":
          return null;
        default:
          note(`unstubbed ${cmd}`);
          return null;
      }
    },
  },
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
});

/// What macOS would draw for the native menu: its items, in order, with the
/// checkmark and the disabled state, each firing its own channel.
function FakeMenu() {
  useBridge();
  if (!popup) return null;
  const close = () => {
    popup?.done();
    popup = null;
    render();
  };
  const fire = (item: MenuItem) => {
    if (item.handler) callbacks.get(item.handler.id)?.({ index: 0, message: item.text });
    note(`menu → ${item.text}`);
    close();
  };
  const rows = (items: MenuItem[], depth: number): React.ReactNode =>
    items.map((item, i) =>
      item.item === "Separator" ? (
        <hr key={i} className="my-1 border-border" />
      ) : (
        <div key={i}>
          <button
            type="button"
            data-menu-item={item.text}
            disabled={item.enabled === false || !!item.items}
            onClick={() => fire(item)}
            className="flex w-full items-center gap-2 rounded px-2 py-0.5 text-left disabled:opacity-50 enabled:hover:bg-blue-500 enabled:hover:text-white"
            style={{ paddingLeft: 8 + depth * 14 }}
          >
            <span className="w-3">{item.checked ? "✓" : ""}</span>
            {item.text}
            {item.items ? " ▸" : ""}
          </button>
          {item.items && rows(item.items, depth + 1)}
        </div>
      ),
    );
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={close} />
      <div
        id="fake-menu"
        className="fixed z-50 w-56 rounded-md border border-border bg-card p-1 text-[13px] shadow-lg"
        style={{ left: popup.x, top: popup.y }}
      >
        {rows(popup.items, 0)}
      </div>
    </>
  );
}

function Log() {
  useBridge();
  return (
    <pre id="bridge-log" className="max-h-32 overflow-auto text-xs text-muted-foreground">
      {log.join("\n") || "Bridge calls land here."}
    </pre>
  );
}

function Frame({ id, width, mode, label }: { id: string; width?: number; mode: "panel" | "full"; label: string }) {
  return (
    <section className="flex flex-col gap-2" style={{ width }}>
      <h2 className="text-ui text-muted-foreground">{label}</h2>
      <div data-session={id} className="flex h-40 flex-col overflow-hidden rounded-lg border border-border bg-card">
        <BrowserPane sessionId={id} active mode={mode} onChat={() => note(`chat ← ${id}`)} />
      </div>
    </section>
  );
}

function Demo() {
  return (
    <TooltipProvider>
      <div className="flex flex-col gap-8 p-10 pb-24">
        <h1 className="text-lg font-medium">Browser toolbar</h1>
        <Log />
        <Frame id="full" mode="full" label="Full view, a dark page" />
        <Frame id="light" mode="full" label="Full view, a light page" />
        <Frame id="orange" mode="full" label="Full view, a coloured page: the row stays neutral" />
        <Frame id="w768" width={768} mode="full" label="768px" />
        <div className="flex flex-wrap items-start gap-8">
          <Frame id="panel" width={512} mode="panel" label="Right panel, 512px default" />
          <Frame id="w440" width={440} mode="panel" label="Right panel, 440px" />
          <Frame id="narrow" width={320} mode="panel" label="Right panel, 320px floor" />
          <Frame id="blank" width={512} mode="full" label="Nothing open" />
        </div>
      </div>
      <FakeMenu />
      <DemoThemeBar />
    </TooltipProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Demo />
  </React.StrictMode>,
);

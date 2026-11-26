import { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";

import AnnotationPill from "@/components/chat/AnnotationPill";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import DemoThemeBar from "@/demo/ThemeBar";
import type { AnnotationRect, AnnotationTarget } from "@/types/events";
import script from "../../src-tauri/src/browser/annotate.js?raw";
import "../App.css";

/// Ask's page script, run in a plain iframe with this page standing in for
/// the Rust half (`cef/annotate.rs`): it answers crop requests with a drawn
/// placeholder, keeps the saved list, and hands Send's list to a real pill.
/// Reload page re-injects with that list, as a navigation does in the app.

type Item = { id: number; note: string; url: string; title: string; target: AnnotationTarget; rect: AnnotationRect };
type Pending = Item & { crop: string };

const PAGE = `<!doctype html><html><head><style>
  body { margin: 0; font: 16px/1.5 system-ui, sans-serif; background: #0b0b0c; color: #ddd; }
  header { display: flex; gap: 24px; padding: 16px 32px; border-bottom: 1px solid #222; }
  a { color: #9ab; }
  main { padding: 48px 32px; max-width: 760px; }
  h1 { font-size: 40px; line-height: 1.15; font-weight: 400; margin: 0 0 24px; }
  h1 span { color: #888; }
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 32px; }
  .card { border: 1px solid #2a2a2a; border-radius: 10px; padding: 16px; background: #141416; }
  button { margin-top: 24px; padding: 8px 14px; border-radius: 8px; border: 0; background: #ddd; color: #111; }
  .tall { height: 900px; }
</style></head><body>
  <header><b>Carbon</b><a href="#">Docs</a><a href="#">Changelog</a><a href="#">Download</a></header>
  <main>
    <h1>Orchestrate agents however you work. <span>Plan with one model, then hand the build to another.</span></h1>
    <p>Steer sessions from one chat, or jump into any of them directly.</p>
    <div class="cards"><div class="card">Upload API</div><div class="card">Retry uploads</div><div class="card">Progress UI</div></div>
    <button onclick="document.title = 'clicked!'">Get started</button>
    <div class="tall"></div>
  </main>
</body></html>`;

/// A stand-in crop: the real one is Chromium's own capture of the page.
function placeholder(rect: AnnotationRect, label: string): string {
  const c = document.createElement("canvas");
  const scale = Math.min(1, 320 / Math.max(rect.width, rect.height, 1));
  c.width = Math.max(24, rect.width * scale);
  c.height = Math.max(24, rect.height * scale);
  const g = c.getContext("2d")!;
  g.fillStyle = "#1c2a44";
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = "#2f6feb";
  g.lineWidth = 2;
  g.strokeRect(1, 1, c.width - 2, c.height - 2);
  g.fillStyle = "#cfe0ff";
  g.font = "12px system-ui";
  g.fillText(label, 8, Math.min(c.height - 8, 20));
  return c.toDataURL("image/png");
}

function Demo() {
  const frame = useRef<HTMLIFrameElement>(null);
  const saved = useRef<{ items: unknown[]; crops: Map<number, string>; bar: unknown }>({ items: [], crops: new Map(), bar: null });
  const [active, setActive] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [composer, setComposer] = useState<Pending[]>([]);
  const [sent, setSent] = useState<Pending[][]>([]);

  const note = (line: string) => setLog((l) => [...l.slice(-30), line]);

  const inject = (items: unknown[], bar: unknown) => {
    const win = frame.current?.contentWindow as (Window & { eval: (s: string) => void }) | null;
    if (!win) return;
    win.eval(`window.__carbonAnnotateInit = ${JSON.stringify({ items, bar })};\n${script}`);
  };

  // The console line is the whole channel, as in the app.
  const hook = () => {
    const win = frame.current?.contentWindow as (Window & { console: Console; __carbonAnnotate?: { shot: (id: number) => void } }) | null;
    if (!win) return;
    const original = win.console.log.bind(win.console);
    win.console.log = (...args: unknown[]) => {
      const text = String(args[0]);
      if (!text.startsWith("__carbon_annotate__")) return original(...args);
      const line = JSON.parse(text.slice("__carbon_annotate__".length));
      note(`${line.type} ${JSON.stringify(line.item ?? line.rect ?? line.id ?? line.at ?? "")}`);
      const state = saved.current;
      switch (line.type) {
        case "shot":
          state.crops.set(line.id, placeholder(line.rect, `${Math.round(line.rect.width)}×${Math.round(line.rect.height)}`));
          setTimeout(() => win.__carbonAnnotate?.shot(line.id), 120);
          break;
        case "save": {
          const at = state.items.findIndex((i) => (i as Item).id === line.item.id);
          if (at >= 0) state.items[at] = line.item;
          else state.items.push(line.item);
          break;
        }
        case "remove":
          state.items = state.items.filter((i) => (i as Item).id !== line.id);
          break;
        case "clear":
          state.items = [];
          state.crops.clear();
          break;
        case "bar":
          state.bar = line.at;
          break;
        case "send":
          setComposer((c) => [
            ...c,
            ...(state.items as Item[]).map((i) => ({ ...i, crop: state.crops.get(i.id) ?? "" })),
          ]);
          saved.current = { items: [], crops: new Map(), bar: state.bar };
          setActive(false);
          break;
        case "close": {
          const ids = new Set((state.items as Item[]).map((item) => item.id));
          for (const id of state.crops.keys()) if (!ids.has(id)) state.crops.delete(id);
          setActive(false);
          break;
        }
      }
    };
  };

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onLoad = () => {
      hook();
      if (active) inject(saved.current.items, saved.current.bar);
    };
    el.addEventListener("load", onLoad);
    return () => el.removeEventListener("load", onLoad);
  });

  const start = () => {
    setActive(true);
    inject(saved.current.items, saved.current.bar);
  };
  const stop = () => {
    (frame.current?.contentWindow as { __carbonAnnotate?: { close: () => void } } | null)?.__carbonAnnotate?.close();
    setActive(false);
  };
  const reload = () => frame.current?.contentWindow?.location.reload();

  const pillItems = (list: Pending[]) =>
    list.map((a) => ({ key: String(a.id) + a.url, note: a.note, target: a.target, url: a.url, src: a.crop || null }));

  return (
    <TooltipProvider>
      <main className="min-h-screen bg-background p-8 text-foreground">
        <h1 className="text-lg font-medium">Annotate</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Ask's page script in an iframe. Click an element or drag an area, write a comment, then Send. Crops here are
          drawn placeholders; the app's are Chromium's own.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button size="sm" variant={active ? "secondary" : "default"} onClick={active ? stop : start} id="ask">
            {active ? "Stop Ask" : "Ask"}
          </Button>
          <Button size="sm" variant="ghost" onClick={reload} id="reload">
            Reload page
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-[1fr_360px] gap-6">
          <iframe
            ref={frame}
            title="page"
            srcDoc={PAGE}
            className="h-[560px] w-full rounded-xl border border-hairline-strong bg-black"
          />

          <div className="flex flex-col gap-6">
            <section>
              <h2 className="mb-2 text-ui text-muted-foreground">Composer</h2>
              <div className="flex min-h-24 flex-col gap-2 rounded-2xl border border-hairline bg-card p-3">
                <AnnotationPill
                  items={pillItems(composer)}
                  onClear={() => setComposer([])}
                  onEdit={(key, text) => setComposer((c) => c.map((a) => (String(a.id) + a.url === key ? { ...a, note: text } : a)))}
                  onDelete={(key) => setComposer((c) => c.filter((a) => String(a.id) + a.url !== key))}
                />
                <div className="flex items-center justify-between text-ui text-muted-foreground">
                  <span>{composer.length ? "Ready to send" : "Nothing annotated yet"}</span>
                  <Button
                    size="sm"
                    id="send"
                    disabled={!composer.length}
                    onClick={() => {
                      setSent((s) => [...s, composer]);
                      setComposer([]);
                    }}
                  >
                    Send message
                  </Button>
                </div>
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-ui text-muted-foreground">Sent</h2>
              <div className="flex flex-col items-end gap-3">
                {sent.map((list, i) => (
                  <AnnotationPill key={i} align="end" items={pillItems(list)} />
                ))}
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-ui text-muted-foreground">Console lines</h2>
              <pre id="log" className="max-h-56 overflow-auto rounded-lg bg-card p-2 text-[11px] leading-4 text-muted-foreground">
                {log.join("\n")}
              </pre>
            </section>
          </div>
        </div>
        <DemoThemeBar />
      </main>
    </TooltipProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Demo />);

import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import ChatInput from "@/components/ChatInput";
import FloatingComposer from "@/components/chat/FloatingComposer";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import DemoThemeBar from "@/demo/ThemeBar";
import type { SessionIndexItem } from "@/types/events";
import "../App.css";

(window as unknown as { __TAURI_EVENT_PLUGIN_INTERNALS__: unknown }).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
  unregisterListener: () => {},
};
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  transformCallback: () => 1,
  invoke: async (outer: string, outerArgs: Record<string, unknown>) => {
    const cmd = outer === "server_invoke" ? (outerArgs.cmd as string) : outer;
    console.log("invoke", cmd, outerArgs);
    if (cmd.startsWith("plugin:event|")) return 1;
    if (cmd === "list_open_apps") return [];
    return null;
  },
};

const item = {
  sessionId: "s-hardcore",
  title: "Add hardcore game mode",
  harness: "codex",
  cwd: "/Users/demo/carbon",
  projectPath: "/Users/demo/carbon",
  branch: "worktree-hardcore",
  pinned: false,
  archived: false,
} as unknown as SessionIndexItem;

const LINES = [
  "I’ll trace how /game starts a run, handles lives and traps, and records a finish.",
  "I found the existing five-floor route and run timer. Hardcore will use the same route with extra traps.",
  "The mode is wired through the title screen, HUD, and results.",
  "The full Hardcore route cleared all five floors in 1:45 with one life.",
];

const frame = () => new Promise((r) => requestAnimationFrame(r));

/// Drags the card's top-left corner up and left with synthetic pointer
/// events, since `carbon browser` has no drag verb, and reports both sizes.
async function resizeCheck(): Promise<string> {
  const card = document.querySelector<HTMLElement>('section[aria-label="Composer"]');
  const corner = card?.querySelector<HTMLElement>(".cursor-nwse-resize");
  if (!card || !corner) return "no card on screen";
  const before = card.getBoundingClientRect();
  const r = corner.getBoundingClientRect();
  const x = r.left + 4;
  const y = r.top + 4;
  const ev = (type: string, cx: number, cy: number) =>
    new PointerEvent(type, { bubbles: true, clientX: cx, clientY: cy, button: 0, pointerId: 1 });
  corner.dispatchEvent(ev("pointerdown", x, y));
  for (let i = 1; i <= 5; i++) {
    window.dispatchEvent(ev("pointermove", x - 40 * i, y - 30 * i));
    await frame();
  }
  window.dispatchEvent(ev("pointerup", x - 200, y - 150));
  await frame();
  await frame();
  const after = card.getBoundingClientRect();
  const size = (b: DOMRect) => `${Math.round(b.width)}×${Math.round(b.height)}`;
  return `before ${size(before)} after ${size(after)}`;
}

function Demo() {
  const [busy, setBusy] = useState(true);
  const [title, setTitle] = useState(item.title);
  const [pinned, setPinned] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const note = (line: string) => setLog((l) => [line, ...l].slice(0, 6));

  return (
    <div className="flex h-screen flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <DemoThemeBar />
        <Button size="sm" variant="secondary" onClick={() => setBusy(!busy)}>{busy ? "Stop turn" : "Start turn"}</Button>
        <Button size="sm" variant="secondary" onClick={() => setNarrow(!narrow)}>{narrow ? "Wide column" : "Narrow column"}</Button>
        <Button size="sm" variant="secondary" onClick={() => setFresh(!fresh)}>{fresh ? "Session" : "New task"}</Button>
        <Button size="sm" variant="secondary" onClick={() => void resizeCheck().then(note)}>Run resize check</Button>
        <output aria-label="Last action" className="text-ui text-muted-foreground">{log[0]}</output>
      </div>
      {/* Stands in for the Files tab: a column the card floats over. */}
      <div
        className="content-backdrop relative min-h-0 flex-1 overflow-hidden rounded-lg border border-hairline"
        style={{ maxWidth: narrow ? 520 : undefined }}
      >
        <pre className="h-full overflow-auto p-4 font-mono text-xs text-muted-foreground">
          {Array.from({ length: 80 }, (_, i) => `${String(i + 1).padStart(3)}  const floor${i} = buildFloor(${i}, { traps: hardcore ? 3 : 1 });`).join("\n")}
        </pre>
        <FloatingComposer
          item={fresh ? null : ({ ...item, title, pinned } as SessionIndexItem)}
          busy={!fresh && busy}
          actions={{
            onRename: (t) => { setTitle(t); note(`renamed to ${t}`); },
            onSetFlags: (f) => { if (f.pinned !== undefined) setPinned(f.pinned); note(`flags ${JSON.stringify(f)}`); },
            onFork: (w) => note(`fork ${w ? "worktree" : "here"}`),
            onDelete: () => note("delete"),
          }}
          transcript={() => (
            <div className="h-full overflow-y-auto px-5 py-4 text-prompt">
              {Array.from({ length: 6 }, (_, i) => LINES.map((l, j) => <p key={`${i}-${j}`} className="mb-3">{l}</p>))}
            </div>
          )}
          composer={
            <ChatInput floating busy={!fresh && busy} isNewTask={fresh} sessionId={fresh ? null : item.sessionId} onSend={(m) => note(`sent: ${m}`)}
              // Stands in for the new-task pickers: labels that never truncate.
              toolbar={
                <div data-composer-toolbar className="flex min-w-0 items-center gap-0.5 px-1 text-ui text-muted-foreground">
                  {["carbonhq", "Worktree", "main", "Bypass permissions"].map((l) => (
                    <span key={l} className="shrink-0 px-2 py-1 whitespace-nowrap">{l}</span>
                  ))}
                  <span className="ml-auto flex min-w-0 items-center whitespace-nowrap px-2">Opus 5.5 · High</span>
                </div>
              }
              onStop={() => setBusy(false)}
              commands={[{ name: "review", description: "Review the diff", source: "builtin" } as never]} />
          }
        />
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TooltipProvider>
      <Demo />
    </TooltipProvider>
  </React.StrictMode>,
);

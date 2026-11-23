import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { CanvasEditor } from "@/components/canvases/CanvasEditor";
import { CanvasComposer } from "@/components/canvases/CanvasComposer";
import { newLayer } from "@/components/canvases/document";
import { Button } from "@/components/ui/button";
import DictateControl from "@/components/composer/DictateControl";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CanvasComposerSlot, useCanvasChat } from "@/lib/canvasChat";
import { canvasKey } from "@/lib/canvasFile";
import DemoThemeBar from "@/demo/ThemeBar";
import type { Attachment, SessionIndexItem } from "@/types/events";
import "../App.css";

const file = { project: "/Users/demo/carbon", folder: "", name: "Home" };
const frame = { ...newLayer("Frame", "page-1", null, 80, 60), name: "Home" };
const card = { ...newLayer("Rectangle", "page-1", frame.id, 24, 24), name: "Card" };
let saved = JSON.stringify({
  version: 1,
  pages: [{ id: "page-1", name: "Page 1", background: "#282828" }],
  elements: [frame, card],
  tokens: [],
});

const sessions = [
  { sessionId: "s-ruler", title: "Fix top ruler number spacing" },
  { sessionId: "s-tokens", title: "Port the colour tokens" },
].map((s) => ({ ...s, projectPath: file.project, hidden: false, archived: false }) as unknown as SessionIndexItem);

const attachment = (path: string): Attachment => ({
  path,
  name: path.split("/").pop()!,
  mimeType: "text/plain",
  size: 2048,
  isImage: false,
  preview: null,
});

(window as unknown as { __TAURI_EVENT_PLUGIN_INTERNALS__: unknown }).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
  unregisterListener: () => {},
};
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  transformCallback: () => 1,
  invoke: async (outer: string, outerArgs: Record<string, unknown>) => {
    const wrapped = outer === "server_invoke";
    const cmd = wrapped ? (outerArgs.cmd as string) : outer;
    const args = (wrapped ? outerArgs.args : outerArgs) as Record<string, unknown>;
    if (cmd === "read_canvas_document") return saved;
    if (cmd === "save_canvas_document") {
      saved = String(args.content);
      return null;
    }
    if (cmd === "list_session_index_items") return sessions;
    if (cmd === "read_attachments") return (args.paths as string[]).map(attachment);
    if (cmd === "plugin:dialog|open") return ["/Users/demo/notes/ruler-spec.md"];
    if (cmd === "paste_attachments") return [];
    if (cmd === "search_files" || cmd === "list_servers") return [];
    if (cmd.startsWith("plugin:event|")) return 1;
    throw new Error(`demo: nothing stubbed for ${cmd}`);
  },
};

const widths = { Wide: "100%", Medium: "1100px", Narrow: "760px", Tight: "380px" } as const;

/// The canvas editor with the floating composer in its stage: the two-row card,
/// its conversation menu, collapse, attachments, options and send. Sends land in
/// the log under the bar after a short wait, so the in-flight state is visible.
function Demo() {
  const dock = useCanvasChat(canvasKey(file))!;
  const [width, setWidth] = useState<keyof typeof widths>("Wide");
  const [busy, setBusy] = useState(false);
  const [inspector, setInspector] = useState(true);
  const [fail, setFail] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const composer = (
    <CanvasComposer
      file={file}
      dock={dock}
      items={sessions}
      modelTakesImages
      busy={busy}
      send={async (text, attachments) => {
        await new Promise((r) => setTimeout(r, 600));
        if (fail) throw Error("This conversation is no longer available.");
        if (!dock.open) dock.setOpen(true);
        dock.sent(dock.active);
        setLog((l) => [...l, `${dock.active}: ${text} [${attachments.map((a) => a.name).join(", ")}]`]);
      }}
      onStop={async () => setBusy(false)}
      onOpenInTasks={() => setLog((l) => [...l, `open in Tasks: ${dock.active}`])}
      dictation={
        <DictateControl state="idle" level={0} savedAudio={null} onStart={() => setLog((l) => [...l, "dictate"])}
          onStop={() => {}} onCancel={() => {}} onRetry={() => {}} onReveal={() => {}} />
      }
      dictating={false}
      onCancelRecording={() => false}
      appError={null}
      onDismissAppError={() => {}}
    />
  );
  return (
    <TooltipProvider>
      <div className="app-shell relative flex h-screen flex-col bg-background">
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3 py-2 text-ui">
          {(Object.keys(widths) as (keyof typeof widths)[]).map((w) => (
            <Button key={w} size="sm" variant={w === width ? "default" : "outline"} onClick={() => setWidth(w)}>
              {w}
            </Button>
          ))}
          <Button size="sm" variant={inspector ? "default" : "outline"} onClick={() => setInspector(!inspector)}>
            Inspector
          </Button>
          <Button size="sm" variant={busy ? "default" : "outline"} onClick={() => setBusy(!busy)}>
            Turn running
          </Button>
          <Button size="sm" variant={fail ? "default" : "outline"} onClick={() => setFail(!fail)}>
            Fail sends
          </Button>
          <span data-testid="log" className="truncate text-muted-foreground">
            {log.at(-1) ?? "Nothing sent yet"}
          </span>
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 border-r border-hairline" style={{ width: widths[width] }}>
            <CanvasComposerSlot.Provider value={composer}>
              <CanvasEditor
                file={file}
                projects={[]}
                collapsed
                controlsOpen={inspector}
                sidebarStyle={{ width: 240 }}
                resizeHandle={null}
                libraryError=""
              />
            </CanvasComposerSlot.Provider>
          </div>
        </div>
        <div className="shrink-0 [&>div]:static [&>div]:flex-row [&>div]:items-center">
          <DemoThemeBar />
        </div>
      </div>
    </TooltipProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Demo />
  </React.StrictMode>,
);

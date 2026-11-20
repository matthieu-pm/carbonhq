import React from "react";
import ReactDOM from "react-dom/client";
import { CanvasEditor } from "@/components/canvases/CanvasEditor";
import { newLayer } from "@/components/canvases/document";
import { TooltipProvider } from "@/components/ui/tooltip";
import DemoThemeBar from "@/demo/ThemeBar";
import "../App.css";

const frame = { ...newLayer("Frame", "page-1", null, 80, 60), name: "Home" };
const card = { ...newLayer("Rectangle", "page-1", frame.id, 24, 24), name: "Card" };
let saved = JSON.stringify({
  version: 1,
  pages: [{ id: "page-1", name: "Page 1", background: "#282828" }],
  elements: [frame, card],
  tokens: [],
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
    if (cmd === "search_files" || cmd === "list_servers") return [];
    if (cmd.startsWith("plugin:event|")) return 1;
    throw new Error(`demo: nothing stubbed for ${cmd}`);
  },
};

/// The canvas editor over a faked document, for judging the floating tool bar at the canvas's bottom centre.
function Demo() {
  return (
    <TooltipProvider>
      <div className="app-shell relative flex h-screen flex-col bg-background">
        <DemoThemeBar />
        <div className="flex min-h-0 flex-1">
          <CanvasEditor
            file={{ project: "/Users/demo/carbon", folder: "", name: "Home.canvas" }}
            projects={[]}
            collapsed={false}
            sidebarStyle={{ width: 240 }}
            resizeHandle={null}
            libraryError=""
          />
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

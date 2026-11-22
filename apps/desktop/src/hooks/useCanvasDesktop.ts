import { flushSync } from "react-dom";
import { openCanvasDocument } from "@/components/canvases/useCanvasDocument";
import { canvasKey, type useCanvasLibrary } from "./useCanvasLibrary";
import { canvasWindowPart, useCanvasWindow, visibility, waitForCanvasEditor } from "@/lib/canvasWindow";
import type { CanvasChatDock } from "@/lib/canvasChat";
import { invoke } from "@/lib/transport";
import type { SessionIndexItem } from "@/types/events";

type Desktop = {
  library: ReturnType<typeof useCanvasLibrary>;
  visible: boolean;
  dock: CanvasChatDock | null;
  controls: boolean;
  sidebar: boolean;
  setSidebar: (show: boolean) => void;
  setControls: (show: boolean) => void;
  design: (project: string) => void;
  navigate: (forward: boolean) => void;
  send: (text: string) => Promise<void>;
};

export function useCanvasDesktop(ui: Desktop) {
  useCanvasWindow(async (req) => {
    const { command, project, folder, canvas } = req;
    const { library, dock } = ui;
    const active = library.active;
    if (command.group === "view") {
      switch (command.args.op) {
        case "state":
          return {
            visible: ui.visible,
            tabs: library.tabs,
            active: active ?? null,
            inspector: !!active && ui.visible && ui.controls && !dock?.open,
            sidebar: ui.sidebar,
            chat: ui.visible && !!dock?.open,
            library: ui.visible ? canvasWindowPart("library", req) : null,
            editor: ui.visible && active ? await canvasWindowPart("editor", req) : null,
          };
        case "all-projects":
          ui.design("");
          library.setLocation({ project: "", folder: "", archived: false });
          library.select(null);
          return;
        case "refresh":
          library.refresh();
          return;
        case "width":
          if (!ui.visible) throw Error("Open the Canvas workspace first.");
          if (command.args.panel === "sidebar") return canvasWindowPart("library", req);
          break;
        case "panel":
          if (command.args.panel !== "sidebar") break;
          if (!ui.visible) throw Error("Open the Canvas workspace first.");
          ui.setSidebar(visibility(command.args.visibility));
          return;
        case "back":
        case "forward":
          ui.navigate(command.args.op === "forward");
          return;
        case "open":
        case "library": {
          const action = command.args;
          const inventory = await invoke<{
            folders: string[];
            canvases: { name: string; folder: string; archived: boolean }[];
          }>("canvas_library", { projectPath: project });
          if (
            action.op === "open" &&
            !inventory.canvases.some((f) => !f.archived && f.name === canvas && f.folder === folder)
          )
            throw Error("Canvas unavailable. Check --canvas and --folder.");
          if (action.op === "library" && folder && !inventory.folders.includes(folder))
            throw Error("Unknown folder.");
          flushSync(() => {
            ui.design(project);
            library.setLocation({ project, folder, archived: action.op === "library" && action.archived });
            if (action.op === "open" && canvas) library.open({ project, folder, name: canvas });
            else library.select(null);
          });
          if (action.op === "open" && canvas)
            await waitForCanvasEditor(canvasKey({ project, folder, name: canvas }));
          return;
        }
        case "close": {
          const file = canvas ? { project, folder, name: canvas } : active;
          if (!file || file.project !== project || !library.tabs.some((t) => canvasKey(t) === canvasKey(file)))
            throw Error("Canvas tab is not open.");
          library.close(canvasKey(file));
          return;
        }
        case "search":
        case "layout":
          if (!ui.visible) throw Error("Open the Canvas library first.");
          return canvasWindowPart("library", req);
      }
    }
    if (
      !ui.visible ||
      !active ||
      active.project !== project ||
      (canvas && (active.name !== canvas || active.folder !== folder))
    ) {
      throw Error("Open the target canvas in the desktop window first.");
    }
    if (command.group === "view" && command.args.op === "width") {
      if (command.args.panel === "chat" && dock?.open) return canvasWindowPart("chat", req);
      throw Error("Choose an open sidebar or chat panel.");
    }
    if (command.group === "view" && command.args.op === "panel") {
      const { panel, visibility: value } = command.args;
      const show = visibility(value);
      if (panel === "inspector") {
        if (show) dock?.setOpen(false);
        ui.setControls(show);
        return;
      }
      if (panel === "chat") {
        dock?.setOpen(show);
        return;
      }
    }
    if (command.group === "comment" || (command.group === "view" &&
        ["select", "page", "tree", "fit", "token"].includes(command.args.op))) {
      const key = canvasKey(active);
      await openCanvasDocument(active).synchronize();
      await waitForCanvasEditor(key);
    }
    if (command.group === "view" && (command.args.op === "token" || command.args.op === "token-search"))
      return canvasWindowPart("theme", req);
    if (command.group === "view") return canvasWindowPart("editor", req);
    if (command.group === "comment") return canvasWindowPart("markup", req);
    if (!dock) throw Error("Canvas conversation is unavailable.");
    const chat = command.args;
    switch (chat.op) {
      case "list":
        return { active: dock.active, tabs: dock.tabs };
      case "new": {
        const id = crypto.randomUUID();
        dock.add(id, true);
        return { id };
      }
      case "open": {
        const sessions = await invoke<SessionIndexItem[]>(
          "list_session_index_items",
          { archived: false },
          "local",
        );
        if (!sessions.some((s) => s.sessionId === chat.id && s.projectPath === project && !s.hidden))
          throw Error("Unknown conversation in this project.");
        flushSync(() => dock.add(chat.id, false));
        return;
      }
      case "close":
      case "select":
        if (!dock.tabs.some((t) => t.id === chat.id)) throw Error("Conversation tab is not open.");
        if (chat.op === "select") {
          dock.select(chat.id);
          dock.setOpen(true);
        } else {
          if (chat.id === dock.tabs[0].id) throw Error("The primary canvas conversation stays open.");
          dock.close(chat.id);
        }
        return;
      case "send":
        if (!chat.text.trim()) throw Error("Enter message text.");
        await ui.send(chat.text);
        return;
      case "stop":
        await invoke("interrupt_session", { sessionId: dock.active }, "local");
        return;
    }
  });
}

import { createContext, useContext, useEffect, useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { listenLocalRequest } from "./transport";

export type ViewAction =
  | { op: "all-projects" | "refresh" }
  | { op: "width"; panel: string; pixels: number }
  | { op: "token"; id: string | null }
  | { op: "token-search"; query: string }
  | {
      op:
        | "state"
        | "open"
        | "close"
        | "back"
        | "forward"
        | "fit"
        | "undo"
        | "redo"
        | "save"
        | "reload"
        | "keep-mine";
    }
  | { op: "library"; archived: boolean }
  | { op: "search"; query: string }
  | { op: "layout"; layout: string }
  | { op: "page"; id: string }
  | { op: "tree"; id: string; visibility: string }
  | { op: "select"; id: string | null }
  | { op: "tool"; tool: string }
  | { op: "mode"; mode: string }
  | { op: "pan"; x: number; y: number }
  | { op: "zoom"; factor: number }
  | { op: "panel"; panel: string; visibility: string };
export type WindowRequest = {
  session_id?: string;
  project: string;
  folder: string;
  canvas: string | null;
  command:
    | { group: "view"; args: ViewAction }
    | { group: "comment"; args: { op: "send"; id: string } }
    | {
        group: "chat";
        args:
          | { op: "list" | "new" | "stop" }
          | { op: "open" | "close" | "select"; id: string }
          | { op: "send"; text: string };
      };
};

export const EmbeddedCanvas = createContext(false);

type WindowPart = "library" | "editor" | "markup" | "theme" | "chat";
type Handler = (request: WindowRequest) => unknown;
const handlers = new Map<WindowPart, Handler>();

export function useCanvasWindowPart(part: WindowPart, handler: Handler, enabled = true) {
  const embedded = useContext(EmbeddedCanvas);
  useLayoutEffect(() => {
    if (!enabled || embedded) return;
    handlers.set(part, handler);
    return () => {
      handlers.delete(part);
    };
  }, [part, handler, enabled, embedded]);
}

export function canvasWindowPart(part: WindowPart, req: WindowRequest) {
  const handler = handlers.get(part);
  if (!handler) throw Error("Open the canvas " + part + " first.");
  return flushSync(() => handler(req));
}

export function visibility(value: string) {
  if (value === "show") return true;
  if (value === "hide") return false;
  throw Error("Choose show or hide.");
}

export function useCanvasWindow(handler: Handler) {
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    const off = listenLocalRequest<WindowRequest>("canvas-command", (request) => flushSync(() => latest.current(request)));
    return () => {
      void off.then((remove) => remove());
    };
  }, []);
}

type EditorStatus = { key: string; ready: boolean; error: string };
let editor: EditorStatus | null = null;
const updates = new Set<() => void>();

export function useEditorStatus(key: string, ready: boolean, error: string) {
  const embedded = useContext(EmbeddedCanvas);
  useLayoutEffect(() => {
    if (embedded) return;
    editor = { key, ready, error };
    for (const notify of updates) notify();
    return () => {
      editor = null;
    };
  }, [key, ready, error, embedded]);
}

/** An open command can mount a lazy editor and then start its first document read. */
export function waitForCanvasEditor(key: string) {
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: string) => {
      clearTimeout(timeout);
      updates.delete(check);
      if (error) reject(Error(error));
      else resolve();
    };
    const check = () => {
      if (editor?.key !== key) return;
      if (editor.error) finish(editor.error);
      else if (editor.ready) finish();
    };
    const timeout = setTimeout(() => finish("The target canvas did not finish opening."), 15000);
    updates.add(check);
    check();
  });
}

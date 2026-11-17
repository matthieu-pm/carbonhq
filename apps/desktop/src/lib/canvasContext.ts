import type { CanvasFocus } from "@/types/events";
import { displayPath } from "@/lib/transport";

let view: { project: string; focus: CanvasFocus } | null = null;

/// The sender copies this synchronously before uploads or other awaited work.
export function setCanvasFocus(project: string, focus: CanvasFocus | null) {
  view = focus ? { project, focus } : null;
}

export function captureCanvasFocus(project: string | null): CanvasFocus | null {
  return view?.project === project ? structuredClone({ ...view.focus, projectPath: displayPath(view.project) }) : null;
}

export type CanvasPreviewTarget = { revealId: string; canvasId: string; projectPath: string; frameId: string; sessionId: string; url: string };

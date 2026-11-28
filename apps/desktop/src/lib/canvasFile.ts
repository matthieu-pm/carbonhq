import type { CanvasLink } from "@/types/events";

export type CanvasFile = CanvasLink;

export const canvasKey = (file: CanvasFile) => JSON.stringify([file.project, file.folder, file.name]);

export const canvasPath = ({ project, folder, name }: CanvasFile) =>
  [project.replace(/\/$/, ""), "canvases", ...(folder ? [folder] : []), name + ".canvas.json"].join("/");

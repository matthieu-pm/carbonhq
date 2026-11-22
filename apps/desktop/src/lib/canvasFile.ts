export type CanvasFile = { project: string; folder: string; name: string };

export const canvasKey = (file: CanvasFile) => JSON.stringify([file.project, file.folder, file.name]);

import type { Attachment, CanvasReference, ImageRef } from "@/types/events";
import { invoke, listen, type ServerId } from "@/lib/transport";

export function canvasReferences(attachments: Attachment[]): CanvasReference[] {
  return attachments.flatMap((attachment) => attachment.canvas ? [attachment.canvas] : []);
}

export function withoutCanvasPreviews(images: ImageRef[], references: CanvasReference[]): ImageRef[] {
  if (!references.length) return images;
  return images.filter((image) => !references.some(({ preview }) =>
    (image.path && image.path === preview.path) || (image.url && image.url === preview.url)));
}

const watches = new Map<string, { refresh: Set<() => void>; close(): void }>();

/// Chips in the same client share one server watch per canvas, including after reconnect.
export function watchCanvasReference(server: ServerId, id: string, refresh: () => void) {
  const key = JSON.stringify([server, id]);
  let watch = watches.get(key);
  if (!watch) {
    const scope = `reference:${crypto.randomUUID()}`;
    const callbacks = new Set<() => void>();
    const register = (ids: string[]) => void invoke("watch_canvases", { scope, ids }, server).catch(console.error);
    const invalidate = () => callbacks.forEach((callback) => callback());
    const off = ["canvas_changed", "canvas_deleted", "canvas_problem"].map((name) =>
      listen<{ id: string }>(name, ({ server: owner, payload }) => {
        if (owner === server && payload.id === id) invalidate();
      }));
    off.push(listen("live_state", ({ server: owner }) => {
      if (owner !== server || !callbacks.size) return;
      register([id]);
      invalidate();
    }));
    watch = {
      refresh: callbacks,
      close: () => {
        off.forEach((subscription) => void subscription.then((unsubscribe) => unsubscribe()).catch(console.error));
        register([]);
      },
    };
    watches.set(key, watch);
    register([id]);
  }
  const current = watch;
  current.refresh.add(refresh);
  return () => {
    current.refresh.delete(refresh);
    if (!current.refresh.size) {
      current.close();
      watches.delete(key);
    }
  };
}

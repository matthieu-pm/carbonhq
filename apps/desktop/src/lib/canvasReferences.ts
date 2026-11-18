import type { Attachment, CanvasReference, ImageRef } from "@/types/events";

export function canvasReferences(attachments: Attachment[]): CanvasReference[] {
  return attachments.flatMap((attachment) => attachment.canvas ? [attachment.canvas] : []);
}

export function withoutCanvasPreviews(images: ImageRef[], references: CanvasReference[]): ImageRef[] {
  return images.filter((image) => !references.some(({ preview }) =>
    (image.path && image.path === preview.path) || (image.url && image.url === preview.url)));
}

import { useCallback, useSyncExternalStore } from "react";

import { channel } from "@/lib/channel";
import { invoke, LOCAL } from "@/lib/transport";
import type { AnnotationInput, Attachment } from "@/types/events";

/// One annotation Ask sent to the composer, waiting for the prompt it rides
/// on. `crop` is its picture, described like an attachment so the pill can
/// draw it and a remote send can upload it.
export type PendingAnnotation = AnnotationInput & { id: string; crop: Attachment | null };

/// Keyed like `useAttachments`, and for its reasons: two writers in two
/// places, and a composer that remounts. Not persisted either — the crops it
/// points at wait in the browser's own directory, not the session's.
const byKey = new Map<string | null, PendingAnnotation[]>();
const { emit, subscribe } = channel<void>();
const EMPTY: PendingAnnotation[] = [];

function write(key: string | null, next: PendingAnnotation[]) {
  if (next.length) byKey.set(key, next);
  else byKey.delete(key);
  emit();
}

export const readAnnotations = (key: string | null): PendingAnnotation[] => byKey.get(key) ?? EMPTY;

/// Adds what one Send carried, after what is already waiting. The crops are
/// read on this Mac, where the browser took them.
export async function addAnnotations(key: string | null, inputs: AnnotationInput[]) {
  const paths = inputs.flatMap((a) => (a.imagePath ? [a.imagePath] : []));
  const crops = paths.length
    ? await invoke<Attachment[]>("read_attachments", { paths }, LOCAL).catch(() => [] as Attachment[])
    : [];
  const added = inputs.map((a) => ({
    ...a,
    id: crypto.randomUUID(),
    crop: crops.find((c) => c.path === a.imagePath) ?? null,
  }));
  write(key, [...readAnnotations(key), ...added]);
}

export function editAnnotation(key: string | null, id: string, note: string) {
  write(
    key,
    readAnnotations(key).map((a) => (a.id === id ? { ...a, note } : a)),
  );
}

export function removeAnnotation(key: string | null, id: string) {
  write(
    key,
    readAnnotations(key).filter((a) => a.id !== id),
  );
}

export function clearAnnotations(key: string | null) {
  if (byKey.has(key)) write(key, EMPTY);
}

/// Puts back what a failed send took, ahead of anything added since.
export function restoreAnnotations(key: string | null, annotations: PendingAnnotation[]) {
  if (!annotations.length) return;
  const now = readAnnotations(key).filter((a) => !annotations.some((b) => b.id === a.id));
  write(key, [...annotations, ...now]);
}

export function useAnnotations(key: string | null): PendingAnnotation[] {
  const getSnapshot = useCallback(() => byKey.get(key) ?? EMPTY, [key]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/// The wire shape, with each crop named by where it now is — the server's
/// own copy, for a remote send.
export function toInputs(annotations: PendingAnnotation[], cropPath: (a: PendingAnnotation) => string | null): AnnotationInput[] {
  return annotations.map((pending) => {
    const { id: _id, crop: _crop, ...a } = pending;
    return { ...a, imagePath: cropPath(pending) };
  });
}

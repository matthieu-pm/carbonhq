import type { Page } from "@/types/events";
import { ownerProjects, type LocatedPage, type PageTarget } from "@/lib/pages";
import { invoke, type ServerId } from "@/lib/transport";

export type LinearDocumentSummary = {
  id: string;
  title: string;
  url: string;
  updatedAt: string;
  trashed: boolean;
  project: { id: string; name: string } | null;
};

export type LinearDocument = LinearDocumentSummary & { markdown: string };
export type LinearDocumentList = { documents: LinearDocumentSummary[]; nextCursor: string | null };

export type LinearPageLink = {
  documentId: string;
  url: string;
  lastSyncedAt: string;
  remoteUpdatedAt: string;
};

export type LinearPageConflict = {
  baseTitle: string;
  localRevision: number;
  remote: LinearDocumentSummary;
  remotePreview: string;
  remoteBytes: number;
};

export type PageSyncState = {
  page: Page;
  link: LinearPageLink | null;
  status: "synced" | "local_changes" | "conflict" | "missing" | "error" | "unlinked";
  error: string | null;
  conflict: LinearPageConflict | null;
};

export type LinearResolution = "carbon" | "linear";

export function listLinearDocuments(server: ServerId, query: string, after: string | null = null): Promise<LinearDocumentList> {
  return invoke("list_linear_documents", { query: query.trim() || null, after }, server);
}

export function importLinearDocument(server: ServerId, documentId: string, projectPaths: string[]): Promise<PageSyncState> {
  return invoke("import_linear_document", { documentId, projectPaths: ownerProjects(projectPaths, server) }, server);
}

export function readLinearSync(page: PageTarget): Promise<PageSyncState> {
  return invoke("page_sync_status", { id: page.id }, page.server);
}

export function readLinearDocument(server: ServerId, documentId: string): Promise<LinearDocument> {
  return invoke("read_linear_document", { documentId }, server);
}

/// Conflict decisions name the versions shown, rather than a newly read version the user has not seen.
export function syncLinearPage(page: LocatedPage<Page>, decision?: { resolution: LinearResolution; localRevision: number; remoteUpdatedAt: string }): Promise<PageSyncState> {
  return invoke("sync_linear_page", {
    id: page.id,
    revision: decision?.localRevision ?? page.revision,
    resolution: decision?.resolution ?? null,
    expectedRemoteUpdatedAt: decision?.remoteUpdatedAt ?? null,
  }, page.server);
}

export function unlinkLinearPage(page: LocatedPage<Page>): Promise<PageSyncState> {
  return invoke("unlink_linear_page", { id: page.id, revision: page.revision }, page.server);
}

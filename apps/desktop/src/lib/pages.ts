import { invoke, LOCAL, qualify, splitPath, type ServerId } from "@/lib/transport";

import type { Page, PageSummary } from "@/types/events";
export type { Page, PageSummary, PageAsset } from "@/types/events";

export type LocatedPage<T = PageSummary> = T & { server: ServerId };
import type { PageTarget } from "@/lib/pageLinks";
export { pageUrl, parsePageUrl, pageMention, pagePromptContext, type PageTarget } from "@/lib/pageLinks";

/// A server is part of document identity, just as it is part of project identity.
export function pageKey(page: PageTarget): string {
  return `${page.server}:${page.id}`;
}

export function locatePage<T extends { projectPaths: string[] }>(page: T, server: ServerId): T & { server: ServerId } {
  return { ...page, server, projectPaths: page.projectPaths.map((path) => qualify(path, server)) };
}

/// Only the owner can interpret a local project path; links never move the document.
export function ownerProjects(paths: string[], server: ServerId): string[] {
  return paths.map((path) => {
    const project = splitPath(path);
    if (project.server !== server) throw new Error("Link projects on the Page’s server.");
    return project.path;
  });
}

export async function readPage(target: Pick<PageTarget, "id" | "server">, revision?: number): Promise<LocatedPage<Page>> {
  const command = revision === undefined ? "read_page" : "read_page_version";
  return locatePage(await invoke<Page>(command, { id: target.id, ...(revision === undefined ? {} : { version: revision }) }, target.server), target.server);
}

export async function updatePage(page: LocatedPage<Page>, changes: Partial<Pick<Page, "title" | "markdown" | "projectPaths" | "favorite">>): Promise<LocatedPage<Page>> {
  const args = { ...changes, id: page.id, revision: page.revision };
  if (args.projectPaths) args.projectPaths = ownerProjects(args.projectPaths, page.server);
  return locatePage(await invoke<Page>("update_page", args, page.server), page.server);
}

export async function createPage(server = LOCAL, projectPaths: string[] = []): Promise<LocatedPage<Page>> {
  return locatePage(await invoke<Page>("create_page", {
    title: "Untitled", markdown: "", projectPaths: ownerProjects(projectPaths, server),
  }, server), server);
}

type PageOpener = (page: PageTarget) => void;
let opener: PageOpener | null = null;
export function setPageOpener(next: PageOpener | null) { opener = next; }
export function openPage(target: PageTarget) { opener?.(target); }

let useInTask: ((page: LocatedPage<Page>) => void) | null = null;
export function setPageTaskHandler(next: typeof useInTask) { useInTask = next; }
export function referencePageInTask(page: LocatedPage<Page>) { useInTask?.(page); }

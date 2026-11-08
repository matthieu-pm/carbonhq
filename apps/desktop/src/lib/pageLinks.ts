import type { ServerId } from "@/lib/transport";

export type PageTarget = { id: string; server: ServerId; revision?: number; relative?: boolean };

export function pageUrl(page: PageTarget): string {
  const owner = page.relative ? "local" : page.server === "local" ? "this-mac" : page.server;
  return `carbon-page://${encodeURIComponent(owner)}/${page.id}${page.revision === undefined ? "" : `?revision=${page.revision}`}`;
}

/// A renderer can carry validated Page links through Markdown's protocol sanitizer as fragments.
export function parsePageUrl(url: string): PageTarget | null {
  try {
    const raw = url.startsWith("#carbon-page=") ? decodeURIComponent(url.slice(13)) : url;
    const parsed = new URL(raw);
    if (parsed.protocol !== "carbon-page:" || !parsed.hostname || parsed.username || parsed.password || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.pathname.slice(1))) return null;
    const revision = parsed.searchParams.get("revision");
    if (revision !== null && (!/^[1-9]\d*$/.test(revision) || !Number.isSafeInteger(Number(revision)))) return null;
    const owner = decodeURIComponent(parsed.hostname);
    return { server: owner === "this-mac" ? "local" : owner, id: parsed.pathname.slice(1), ...(owner === "local" ? { relative: true } : {}), ...(revision === null ? {} : { revision: Number(revision) }) };
  } catch { return null; }
}

export function pageMention(page: PageTarget & { title: string; revision: number }): string {
  const title = page.title.replace(/[\\[\]]/g, "\\$&");
  return `[${title}](${pageUrl(page)})`;
}

/// A receiving agent may not share the app's server aliases, so foreign references carry exact content.
export function pagePromptContext(page: PageTarget & { title: string; revision: number; markdown: string }, receivingServer: ServerId): string {
  const reference = pageMention(page);
  if (page.server === receivingServer) return `${reference}\nRead the cited revision with \`carbon pages read ${page.id} --version ${page.revision}\`.`;
  const fences = page.markdown.match(/`+/g) ?? [];
  const fence = "`".repeat(Math.max(3, ...fences.map((part) => part.length + 1)));
  return `${reference}\n\nPage snapshot at revision ${page.revision}:\n${fence}markdown\n${page.markdown}\n${fence}`;
}

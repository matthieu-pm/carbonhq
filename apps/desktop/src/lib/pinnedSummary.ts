import { basename } from "@/lib/format";
import { highlightSegments, withLineBreaks } from "@/lib/highlight";
import { fileTarget, mcpCall, toolSummary } from "@/lib/tools";
import type { AgentEvent, AgentEventPayload, ImageRef } from "@/types/events";

export const SUMMARY_WIDTH = 320;
export const SUMMARY_GAP = 12;
export const SUMMARY_CLEARANCE = 32;

/// A pinned card lies over the transcript's right side, so it wants a readable lane left beside it and room for its own controls.
export function summaryPresentation(width: number, height: number, canPin = true): "pinned" | "popover" {
  return canPin && width >= SUMMARY_WIDTH + SUMMARY_GAP + SUMMARY_CLEARANCE + 48 + 640 && height >= 184
    ? "pinned"
    : "popover";
}

/// A rail takes the canvas's right margin and never the chat column's own
/// width, so it needs that margin on both sides of the centred 768px column.
export function summaryDocks(width: number): boolean {
  return width >= 768 + 2 * SUMMARY_WIDTH;
}

export const SUMMARY_ITEMS = [
  { id: "workspace", label: "Workspace and editor", defaultVisible: true },
  { id: "branch", label: "Branch", defaultVisible: true },
  { id: "changes", label: "Changes", defaultVisible: true },
  { id: "prs", label: "Pull requests", defaultVisible: true },
  { id: "tasks", label: "Tasks", defaultVisible: true },
  { id: "subagents", label: "Subagents", defaultVisible: true },
  { id: "sources", label: "Sources", defaultVisible: true },
  { id: "context", label: "Context window", defaultVisible: true },
] as const;
export type SummaryItemId = (typeof SUMMARY_ITEMS)[number]["id"];
export type SummaryItems = Partial<Record<SummaryItemId, boolean>>;

/// An absent choice inherits the item's default, including newly added details.
export function summaryItemVisible(items: SummaryItems, id: SummaryItemId): boolean {
  return items[id] ?? SUMMARY_ITEMS.find((item) => item.id === id)!.defaultVisible;
}

/// Keep only exceptions so later defaults still reach readers who never changed them.
export function setSummaryItem(items: SummaryItems, id: SummaryItemId, visible: boolean): SummaryItems {
  const { [id]: _previous, ...rest } = items;
  return visible === SUMMARY_ITEMS.find((item) => item.id === id)!.defaultVisible ? rest : { ...rest, [id]: visible };
}

/// The card's sections as drawn, which is coarser than `SUMMARY_ITEMS`: branch and changes share one.
export const SUMMARY_SECTIONS = ["workspace", "git", "prs", "crew", "tasks", "subagents", "sources", "context"] as const;
export type SummarySectionId = (typeof SUMMARY_SECTIONS)[number];

/// The saved order brought up to date. Unknown ids drop out, and a section the
/// save never named lands after the one it follows by default, so a section
/// added in a later build appears where it was designed to.
export function summaryOrder(saved: readonly string[]): SummarySectionId[] {
  const known = new Set<string>(SUMMARY_SECTIONS);
  const order = [...new Set(saved)].filter((id): id is SummarySectionId => known.has(id));
  SUMMARY_SECTIONS.forEach((id, i) => {
    if (order.includes(id)) return;
    const before = i > 0 ? order.indexOf(SUMMARY_SECTIONS[i - 1]) : -1;
    order.splice(before + 1, 0, id);
  });
  return order;
}

/// Moves `id` to index `to` among the sections on screen. Hidden and empty
/// sections keep their slots, so showing one again puts it back where it was.
export function moveSummarySection(order: readonly SummarySectionId[], shown: readonly SummarySectionId[], id: SummarySectionId, to: number): SummarySectionId[] {
  const next = shown.filter((key) => key !== id);
  next.splice(to, 0, id);
  const visible = new Set(shown);
  let i = 0;
  return order.map((key) => visible.has(key) ? next[i++] : key);
}

export type SummarySource = { id: string; label: string } & (
  | { kind: "attachment"; path: string }
  | { kind: "image"; image: ImageRef }
  | { kind: "mcp"; server: string | null }
  | { kind: "search" }
  | { kind: "link" | "web"; url: string }
);

type ToolCall = Extract<AgentEventPayload, { type: "tool_call_started" }>;

function objectInput(value: ToolCall["input"] | undefined) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function webUrl(value: string): URL | null {
  if (!/^https?:\/\//i.test(value) || /[\s"<>]/.test(value)) return null;
  try {
    const url = new URL(value);
    return !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

/// Conversation history is the source of truth, including tools called by subagents.
export function summarySources(events: readonly AgentEvent[]): SummarySource[] {
  const sources = new Map<string, SummarySource>();
  const calls = new Map<string, ToolCall>();
  const add = (source: SummarySource) => {
    if (!sources.has(source.id)) sources.set(source.id, source);
  };
  const addLink = (href: string, kind: "link" | "web", label?: string) => {
    const url = webUrl(href);
    if (!url) return;
    const id = `url:${url.href}`;
    const previous = sources.get(id);
    if (!previous || (kind === "web" && previous.kind === "link")) {
      sources.set(id, {
        id, kind, url: url.href,
        label: label || previous?.label || `${url.host}${url.pathname === "/" ? "" : url.pathname}`,
      });
    }
  };
  const addImages = (images: readonly ImageRef[], fallback: string) => {
    for (const image of images) {
      const key = image.path || image.url;
      if (!key) continue;
      const name = image.path ? basename(image.path) : "";
      const label = !name || /^[0-9a-f-]{36}\.[\w]+$/i.test(name) ? fallback : name;
      add({ id: `image:${key}`, kind: "image", label, image });
    }
  };

  for (const { sessionId, subagent, harness, payload } of events) {
    if (payload.type === "user_message" || payload.type === "assistant_text") {
      const message = withLineBreaks(payload.text);
      if (payload.type === "user_message") {
        addImages(payload.images ?? [], "Attached image");
        // File attachments are saved in the prompt as a line of absolute mentions or as prose.
        const attachments = harness === "claude_code"
          ? [...message.matchAll(/^@\/[^\n]+$/gm)].flatMap(([line]) => line.slice(1).split(/ @(?=\/)/))
          : [...message.matchAll(/^Attached file: (\/.+)$/gm)].map(([, path]) => path);
        for (const path of attachments) {
          add({ id: `file:${path}`, kind: "attachment", label: basename(path), path });
        }
        for (const issue of payload.issues ?? []) {
          if (issue.url) addLink(issue.url, "link", issue.title || issue.identifier);
        }
      }
      for (const segment of highlightSegments(message)) {
        if (segment.href) addLink(segment.href, "link", segment.kind === "link" ? segment.inner : undefined);
      }
      for (const [, href] of message.matchAll(/<(https?:\/\/[^\s<>]+)>/gi)) addLink(href, "link");
      continue;
    }

    if (payload.type !== "tool_call_started" && payload.type !== "tool_call_completed") continue;
    const key = JSON.stringify([sessionId, subagent?.id, payload.callId]);
    if (payload.type === "tool_call_started") {
      calls.set(key, payload);
      continue;
    }

    const call = calls.get(key);
    const path = call?.toolType === "file_read" ? fileTarget(call.toolType, call.input) : null;
    addImages(payload.result.images ?? [], path ? basename(path) : "Tool image");
    if (!call || payload.result.isError) continue;

    const { name, title, toolType, input } = call;
    const mcpName = name === "use_tool" ? toolSummary(name, toolType, input) : name;
    if (mcpName && (toolType === "mcp" || mcpName.includes("__"))) {
      const { serverId, server, label } = mcpCall(mcpName, title);
      if (serverId || toolType === "mcp") {
        add({ id: `mcp:${serverId ?? mcpName}`, kind: "mcp", server: serverId, label: server ?? label });
      }
    }

    const webName = mcpName ?? name;
    const isSearch = /(?:^|[_.])(?:web_?search|search_web)$/i.test(webName) || (harness === "grok" && name === "search");
    const isFetch = /(?:^|[_.])web_?fetch$/i.test(webName);
    if (toolType !== "web" && !isSearch && !isFetch) continue;
    const rawArgs = objectInput(input);
    const args = name === "use_tool" ? objectInput(rawArgs.tool_input) : rawArgs;
    const queries = Array.isArray(args.queries) ? args.queries : [args.query];
    for (const query of queries) {
      if (typeof query !== "string" || !query.trim()) continue;
      const label = query.trim();
      add({ id: `search:${label}`, kind: "search", label });
    }
    const urls = Array.isArray(args.urls) ? args.urls : [args.url];
    for (const url of urls) {
      if (typeof url === "string") addLink(url, "web");
    }
    if (isSearch || queries.some((query) => typeof query === "string")) {
      const result = payload.result.text ?? "";
      // Codex flattens each hit to a title followed by its URL on a separate line.
      for (const [, label, href] of result.matchAll(/^([^\n]+)\n(https?:\/\/\S+)[ \t]*$/gim)) {
        if (!webUrl(label)) addLink(href, "web", label.trim());
      }
      for (const segment of highlightSegments(result)) {
        if (segment.href && (segment.kind === "link" || /^https?:\/\//i.test(segment.text))) {
          addLink(segment.href, "web", segment.inner);
        }
      }
      for (const [, href] of result.matchAll(/["<](https?:\/\/[^\s"<>]+)[">]/gi)) addLink(href, "web");
    }
  }
  return [...sources.values()];
}

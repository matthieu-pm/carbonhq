import type { AgentEvent, McpServer } from "@/types/events";

export const SUMMARY_WIDTH = 320;
export const SUMMARY_GAP = 12;
export const SUMMARY_CLEARANCE = 32;

/// A pinned card must leave a readable chat lane and room for its own controls.
export function summaryPresentation(width: number, height: number, canPin = true): "pinned" | "popover" {
  return canPin && width >= SUMMARY_WIDTH + SUMMARY_GAP + SUMMARY_CLEARANCE + 48 + 640 && height >= 184
    ? "pinned"
    : "popover";
}

export const SUMMARY_ITEMS = [
  { id: "workspace", label: "Workspace and editor", defaultVisible: true },
  { id: "branch", label: "Branch", defaultVisible: true },
  { id: "changes", label: "Changes", defaultVisible: true },
  { id: "prs", label: "Pull requests", defaultVisible: true },
  { id: "subagents", label: "Subagents", defaultVisible: true },
  { id: "sources", label: "Sources", defaultVisible: true },
  { id: "context", label: "Context window", defaultVisible: false },
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

/// Only the latest main-thread init describes this child's connections.
export function summarySources(events: readonly AgentEvent[]): McpServer[] | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.subagent || event.payload.type !== "turn_started") continue;
    // Other harnesses synthesize an empty SessionInfo without querying MCP.
    if (event.harness !== "claude_code" && event.payload.mcpServers.length === 0) return null;
    return [...new Map(event.payload.mcpServers.map((server) => [server.name, server])).values()];
  }
  return null;
}

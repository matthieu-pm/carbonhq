import { describe, expect, it } from "vitest";

import { setSummaryItem, summaryItemVisible, summaryPresentation, summarySources } from "@/lib/pinnedSummary";
import type { AgentEvent, Harness, McpServer } from "@/types/events";

function init(servers: McpServer[], harness: Harness = "claude_code", subagent: AgentEvent["subagent"] = null): AgentEvent {
  return { harness, subagent, payload: { type: "turn_started", mcpServers: servers } } as AgentEvent;
}

describe("summarySources", () => {
  it("takes the latest main-thread connection report, including removals", () => {
    const old = init([{ name: "Linear", status: "connected" }]);
    const current = init([{ name: "GitHub", status: "needs-auth" }]);
    const child = init([{ name: "Neon", status: "connected" }], "claude_code", { id: "child", label: null });
    expect(summarySources([old, current, child])).toEqual([{ name: "GitHub", status: "needs-auth" }]);
    expect(summarySources([old, init([])])).toEqual([]);
  });

  it("does not claim a harness's synthesized empty init reports no connections", () => {
    expect(summarySources([init([], "codex")])).toBeNull();
    expect(summarySources([])).toBeNull();
  });

  it("keeps each source once with its final reported status", () => {
    expect(summarySources([init([
      { name: "Linear", status: "pending" },
      { name: "Linear", status: "connected" },
    ])])).toEqual([{ name: "Linear", status: "connected" }]);
  });
});

it("uses a popover before pinning would squeeze the chat or leave an unusable card", () => {
  expect(summaryPresentation(1051, 600)).toBe("popover");
  expect(summaryPresentation(1052, 184)).toBe("pinned");
  expect(summaryPresentation(1400, 183)).toBe("popover");
  expect(summaryPresentation(1400, 600, false)).toBe("popover");
});

it("forgets an override when a detail returns to its default without losing other choices", () => {
  const items = { workspace: false, context: true };
  const restored = setSummaryItem(items, "workspace", true);
  expect(restored).toEqual({ context: true });
  expect(summaryItemVisible(restored, "workspace")).toBe(true);
  expect(summaryItemVisible(restored, "context")).toBe(true);
  expect(setSummaryItem(restored, "context", false)).toEqual({});
});

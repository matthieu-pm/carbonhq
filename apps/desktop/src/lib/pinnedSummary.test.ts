import { describe, expect, it } from "vitest";

import { moveSummarySection, setSummaryItem, summaryDocks, summaryItemVisible, summaryOrder, summaryPresentation, summarySources, SUMMARY_SECTIONS } from "@/lib/pinnedSummary";
import type { AgentEvent, AgentEventPayload, ImageRef } from "@/types/events";

function event(payload: AgentEventPayload, scope: Partial<AgentEvent> = {}): AgentEvent {
  return { id: "event", sessionId: "session", harness: "claude_code", seq: 0, ts: "", turnId: null, subagent: null, payload, ...scope };
}

function message(text: string, images: ImageRef[] = [], scope?: Partial<AgentEvent>): AgentEvent {
  return event({ type: "user_message", text, images, issues: [], mcpServers: [], baseline: null, queued: false, from: null, cwd: null }, scope);
}

function call(callId: string, name: string, props: Partial<Extract<AgentEventPayload, { type: "tool_call_started" }>> = {}, scope?: Partial<AgentEvent>) {
  return event({ type: "tool_call_started", callId, name, toolType: "other", input: {}, rawInput: null, title: null, ...props }, scope);
}

function result(callId: string, text = "", images: ImageRef[] = [], scope?: Partial<AgentEvent>, isError = false) {
  return event({ type: "tool_call_completed", callId, result: { text, images, isError, structured: null, exitCode: null, durationMs: null } }, scope);
}

describe("summarySources", () => {
  it("shows attached files and images without listing routine file reads", () => {
    const image = { path: "/attachments/019fc123-1234-7000-8000-123456789abc.png", url: null, mimeType: "image/png" };
    const screenshot = { path: "/attachments/screenshot.png", url: null, mimeType: "image/png" };
    expect(summarySources([
      message("Check these.\n@/tmp/a report.pdf @/tmp/data.csv", [image]),
      message("Attached file: /tmp/data.csv\nAttached file: /tmp/other report.pdf", [], { harness: "codex" }),
      call("read", "Read", { toolType: "file_read", input: { file_path: "/work/main.rs" } }),
      result("read", "Code with https://example.com/in-a-file"),
      result("image", "", [screenshot, image]),
    ])).toMatchObject([
      { kind: "image", label: "Attached image", image },
      { kind: "attachment", label: "a report.pdf", path: "/tmp/a report.pdf" },
      { kind: "attachment", label: "data.csv", path: "/tmp/data.csv" },
      { kind: "attachment", label: "other report.pdf", path: "/tmp/other report.pdf" },
      { kind: "image", label: "screenshot.png", image: screenshot },
    ]);
  });

  it("uses completed MCP calls across harnesses and scopes the call ID to the subagent", () => {
    const child = { subagent: { id: "child", label: null } };
    const codex = { harness: "codex" } as const;
    const grok = { harness: "grok" } as const;
    expect(summarySources([
      event({ type: "turn_started", mcpServers: [{ name: "Unused", status: "connected" }] } as AgentEventPayload),
      call("same", "mcp__linear-server__get_issue", { toolType: "mcp" }),
      call("same", "mcp__neon__query", { toolType: "mcp" }, child),
      result("same"),
      result("same", "", [], child),
      call("codex", "save_issue", { toolType: "mcp", title: "linear-server · save_issue" }, codex),
      result("codex", "", [], codex),
      call("grok", "use_tool", { input: { tool_name: "supermemory-ai__search_memory" } }, grok),
      result("grok", "", [], grok),
      call("failed", "mcp__unused__read", { toolType: "mcp" }),
      result("failed", "Denied", [], undefined, true),
    ])).toMatchObject([
      { kind: "mcp", server: "linear-server" },
      { kind: "mcp", server: "neon" },
      { kind: "mcp", server: "supermemory-ai" },
    ]);
  });

  it("deduplicates chat links and web pages and uses the completed Codex search query", () => {
    expect(summarySources([
      message("Read [Docs](https://example.com/docs)."),
      call("search", "web_search", { toolType: "web", input: { query: "" } }),
      call("search", "web_search", { toolType: "web", input: { query: "example docs" } }),
      result("search", "Example Docs\nhttps://example.com/docs\n\nOther result\nhttps://example.com/other"),
      call("fetch", "WebFetch", { toolType: "web", input: { url: "https://example.com/guide" } }),
      result("fetch", "Page body with https://example.com/merely-mentioned"),
      event({ type: "assistant_text", block: null, text: "Also <https://example.com/extra> and [invalid](https://user:secret@example.com/)." }),
    ])).toMatchObject([
      { kind: "web", label: "Example Docs", url: "https://example.com/docs" },
      { kind: "search", label: "example docs" },
      { kind: "web", label: "Other result", url: "https://example.com/other" },
      { kind: "web", url: "https://example.com/guide" },
      { kind: "link", url: "https://example.com/extra" },
    ]);
  });

  it("includes web searches dispatched through an MCP server", () => {
    expect(summarySources([
      call("brave", "mcp__brave__brave_web_search", { toolType: "mcp", input: { query: "example docs" } }),
      result("brave", '{"url":"https://example.com/docs"}'),
    ])).toMatchObject([
      { kind: "mcp", server: "brave" },
      { kind: "search", label: "example docs" },
      { kind: "web", url: "https://example.com/docs" },
    ]);
  });
});

it("uses a popover before pinning would squeeze the chat or leave an unusable card", () => {
  expect(summaryPresentation(1051, 600)).toBe("popover");
  expect(summaryPresentation(1052, 184)).toBe("pinned");
  expect(summaryPresentation(1400, 183)).toBe("popover");
  expect(summaryPresentation(1400, 600, false)).toBe("popover");
});

it("docks only where the rail clears the centred chat column", () => {
  expect(summaryDocks(1407)).toBe(false);
  expect(summaryDocks(1408)).toBe(true);
});

it("forgets an override when a detail returns to its default without losing other choices", () => {
  const items = { workspace: false, context: false };
  const restored = setSummaryItem(items, "workspace", true);
  expect(restored).toEqual({ context: false });
  expect(summaryItemVisible(restored, "workspace")).toBe(true);
  expect(summaryItemVisible(restored, "context")).toBe(false);
  expect(setSummaryItem(restored, "context", true)).toEqual({});
});

describe("summaryOrder", () => {
  it("starts from the default order", () => {
    expect(summaryOrder([])).toEqual([...SUMMARY_SECTIONS]);
  });

  it("drops unknown and repeated ids and slots missing sections after their default neighbour", () => {
    expect(summaryOrder(["context", "gone", "prs", "context", "workspace"])).toEqual(
      ["context", "prs", "crew", "tasks", "subagents", "sources", "workspace", "git"],
    );
  });
});

describe("moveSummarySection", () => {
  const order = [...SUMMARY_SECTIONS];

  it("moves among the shown sections and leaves hidden ones in their slots", () => {
    const shown = ["workspace", "git", "tasks", "context"] as const;
    expect(moveSummarySection(order, shown, "context", 0)).toEqual(
      ["context", "workspace", "prs", "crew", "git", "subagents", "sources", "tasks"],
    );
  });

  it("moves down", () => {
    expect(moveSummarySection(order, order, "workspace", 2)).toEqual(
      ["git", "prs", "workspace", "crew", "tasks", "subagents", "sources", "context"],
    );
  });
});

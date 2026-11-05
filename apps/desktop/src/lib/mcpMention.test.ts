import { describe, expect, it } from "vitest";

import { highlightSegments } from "@/lib/highlight";
import { applyMcp, filterMcp, mcpFace, mcpSpan, withMcpServers } from "@/lib/mcpMention";
import { chipLabel } from "@/lib/richText";

const join = (segments: { text: string }[]) => segments.map((s) => s.text).join("");

describe("mcpSpan", () => {
  it("opens on a `$` that starts a word", () => {
    expect(mcpSpan("use $lin", 8)).toEqual({ start: 4, end: 8, query: "lin" });
    expect(mcpSpan("$", 1)).toEqual({ start: 0, end: 1, query: "" });
  });

  it("stays shut mid-word", () => {
    expect(mcpSpan("cost$5", 6)).toBeNull();
    expect(mcpSpan("plain", 3)).toBeNull();
  });
});

describe("applyMcp", () => {
  it("replaces the token and leaves one space after it", () => {
    const text = "ask $li about it";
    expect(applyMcp(text, mcpSpan(text, 7)!, "linear")).toEqual({
      text: "ask $linear about it",
      caret: 12,
    });
    expect(applyMcp("$", mcpSpan("$", 1)!, "linear")).toEqual({ text: "$linear ", caret: 8 });
  });
});

describe("filterMcp", () => {
  const servers = [
    { name: "plugin:figma:figma", scope: "plugin" },
    { name: "figma-local", scope: "user" },
    { name: "linear", scope: "user" },
  ];

  it("ranks names starting with the query first", () => {
    expect(filterMcp(servers, "fig").map((s) => s.name)).toEqual([
      "figma-local",
      "plugin:figma:figma",
    ]);
    expect(filterMcp(servers, "")).toHaveLength(3);
  });
});

describe("withMcpServers", () => {
  const names = ["linear", "plugin:figma:figma"];

  it("marks only names the agent loads, and keeps the text whole", () => {
    const text = "check $linear, not $HOME or cost$linear";
    const segments = withMcpServers(highlightSegments(text), names);

    expect(join(segments)).toBe(text);
    expect(segments.filter((s) => s.kind === "mcp").map((s) => s.text)).toEqual(["$linear"]);
  });

  it("leaves a `$name` inside code alone", () => {
    const segments = withMcpServers(highlightSegments("run `$linear` now"), names);
    expect(segments.some((s) => s.kind === "mcp")).toBe(false);
  });

  it("draws a plugin's server by its last name", () => {
    const [segment] = withMcpServers(highlightSegments("$plugin:figma:figma"), names);
    expect(segment.kind).toBe("mcp");
    expect(chipLabel(segment)).toBe("$figma");
    expect(mcpFace("linear")).toBe("linear");
  });
});

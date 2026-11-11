import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { contextBar, contextRows } from "@/lib/contextBreakdown";
import type { ContextBreakdown } from "@/types/events";

const reply = JSON.parse(readFileSync(
  new URL("../../src-tauri/src/harness/claude_code/fixtures/context_usage.jsonl", import.meta.url), "utf8",
)).response.response;
const breakdown: ContextBreakdown = {
  categories: reply.categories, usedTokens: reply.totalTokens, maxTokens: reply.maxTokens,
};

describe("contextRows", () => {
  const rows = contextRows(breakdown);

  it("puts used rows largest first, then buffer, free and deferred", () => {
    expect(rows.map((row) => row.id)).toEqual([
      "memory_files", "system_tools", "skills", "system_prompt", "custom_agents", "messages",
      "autocompact_buffer", "free_space", "system_tools_deferred",
    ]);
  });

  it("gives deferred tools no share and keeps them and free space out of the bar", () => {
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId.system_tools_deferred.percent).toBeNull();
    expect(byId.system_tools_deferred.inBar).toBe(false);
    expect(byId.free_space.inBar).toBe(false);
    expect(byId.autocompact_buffer.inBar).toBe(true);
    expect(byId.autocompact_buffer.percent).toBeCloseTo(3.3);
  });

  it("colours by rank: four hues, then grey, with the buffer darker", () => {
    expect(rows.slice(0, 4).map((row) => row.color)).toEqual(["#4f8fe8", "#d9703c", "#4fae92", "#d9a23b"]);
    expect(rows[4].color).toBe(rows[5].color);
    expect(rows[6].color).not.toBe(rows[5].color);
  });

  it("draws the bar by size, greys as one Other, the buffer last", () => {
    const bar = contextBar(rows);
    expect(bar.map((segment) => segment.id)).toEqual(["memory_files", "system_tools", "skills", "system_prompt", "other", "autocompact_buffer"]);
    expect(bar[4].tokens).toBe(2320 + 10);
    // Other moves ahead of a smaller coloured block.
    const grown = contextBar(rows.map((row) => row.id === "messages" ? { ...row, tokens: 20_000 } : row));
    expect(grown.map((segment) => segment.id).indexOf("other")).toBe(1);
  });

  it("drops an empty category", () => {
    const rows = contextRows({
      usedTokens: 5, maxTokens: 100,
      categories: [{ id: "new_thing", name: "New thing", tokens: 5, kind: "used" }, { id: "skills", name: "Skills", tokens: 0, kind: "used" }],
    });
    expect(rows.map((row) => row.id)).toEqual(["new_thing"]);
  });
});

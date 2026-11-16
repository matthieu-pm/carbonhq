import { describe, expect, it } from "vitest";
import { lockedMidTurn, type Control } from "./liveControls";
import type { Harness } from "@/types/events";

describe("composer controls during a turn", () => {
  it("allows fx's deferred picks and locks controls that cannot reach the next prompt", () => {
    const controls: Control[] = ["model", "effort", "stance", "fast"];
    for (const control of controls) {
      expect(lockedMidTurn("fx", control, true)).toBe(false);
      expect(lockedMidTurn("codex", control, true)).toBe(true);
      expect(lockedMidTurn("acp:fixture" as Harness, control, true)).toBe(true);
      expect(lockedMidTurn("codex", control, false)).toBe(false);
    }
    expect(lockedMidTurn("claude_code", "model", true)).toBe(false);
    expect(lockedMidTurn("claude_code", "effort", true)).toBe(true);
    expect(lockedMidTurn("pi", "model", true)).toBe(false);
    expect(lockedMidTurn("pi", "stance", true)).toBe(true);
    expect(lockedMidTurn("grok", "effort", true)).toBe(false);
    expect(lockedMidTurn("grok", "stance", true)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { combinedRemaining, resetLabel, subscriptionRemaining, USAGE_FRESH_MS } from "@/lib/subscriptionUsage";
import type { SubscriptionUsage } from "@/types/events";

const NOW = Date.parse("2026-11-04T20:00:00Z");
function row(remaining: number[], extra: Partial<SubscriptionUsage> = {}): SubscriptionUsage {
  return {
    harness: "codex", plan: null, checkedAt: new Date(NOW).toISOString(), unavailableReason: null,
    windows: remaining.map((remainingPercent, i) => ({ label: `Window ${i}`, remainingPercent, resetsAt: null })),
    ...extra,
  };
}

describe("subscription allowance", () => {
  it("takes the most restrictive window once per provider before averaging", () => {
    expect(combinedRemaining([row([94]), row([68, 90]), row([58])], NOW)).toEqual({ percent: 220 / 3, count: 3 });
  });
  it("excludes unavailable accounts rather than treating them as zero or full", () => {
    expect(combinedRemaining([row([80]), row([], { unavailableReason: "Not signed in" }), row([])], NOW)).toEqual({ percent: 80, count: 1 });
    expect(combinedRemaining([], NOW)).toEqual({ percent: null, count: 0 });
    expect(combinedRemaining([row([0]), row([100])], NOW)).toEqual({ percent: 50, count: 2 });
  });
  it("expires stale readings and windows that have reached their reset", () => {
    expect(subscriptionRemaining(row([80]), NOW + USAGE_FRESH_MS)).toBeNull();
    expect(subscriptionRemaining(row([80], { checkedAt: "bad date" }), NOW)).toBeNull();
    expect(subscriptionRemaining(row([80], { windows: [{ label: "Weekly", remainingPercent: 80, resetsAt: new Date(NOW).toISOString() }] }), NOW)).toBeNull();
  });
  it("rejects invalid percentages without hiding a real exhausted subscription", () => {
    for (const n of [-1, 101, NaN, Infinity]) expect(subscriptionRemaining(row([n]), NOW)).toBeNull();
    expect(subscriptionRemaining(row([0]), NOW)).toBe(0);
  });
  it("distinguishes an unknown reset from a reset that needs refreshing", () => {
    expect(resetLabel(null, NOW)).toBe("Reset time unavailable");
    expect(resetLabel("bad date", NOW)).toBe("Reset time unavailable");
    expect(resetLabel(new Date(NOW - 1).toISOString(), NOW)).toBe("Reset reached · refresh usage");
    expect(resetLabel(new Date(NOW + 61 * 60_000).toISOString(), NOW)).toBe("Resets in 1h 1m");
    expect(resetLabel(new Date(NOW + 262 * 60_000).toISOString(), NOW, "Updates")).toBe("Updates in 4h 22m");
  });
});

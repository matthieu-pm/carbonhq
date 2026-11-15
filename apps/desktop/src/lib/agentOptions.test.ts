import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConfigOption, Harness } from "@/types/events";

vi.mock("@/lib/transport", () => ({ invoke: vi.fn(), listen: vi.fn() }));

const harness: Harness = "acp:fixture";
const offered: ConfigOption[] = [{
  id: "mode", name: "Mode", category: "mode", description: null, currentValue: "code",
  pendingValue: null, rejection: null, options: [{ value: "code", name: "Code", description: null }],
}];

beforeEach(() => {
  vi.resetModules();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("new-session agent selections", () => {
  it("drops stale remembered choices without dropping explicit choices", async () => {
    localStorage.setItem("carbon.agentOptions", JSON.stringify({ [`local|${harness}`]: { mode: "retired" } }));
    const picks = await import("./agentOptions");
    picks.reconcileAgentOptions("local", harness, offered);
    expect(picks.pendingAgentOptions("local", harness)).toEqual({});

    picks.pickAgentOption("local", harness, "mode", "retired");
    picks.reconcileAgentOptions("local", harness, offered);
    expect(picks.pendingAgentOptions("local", harness)).toEqual({ mode: "retired" });
    expect(picks.isAgentOptionExplicit("local", harness, "mode")).toBe(true);

    picks.rememberAgentOptions("local", harness);
    picks.reconcileAgentOptions("local", harness, offered);
    expect(picks.pendingAgentOptions("local", harness)).toEqual({});
  });

  it("resets one selection without changing other settings or servers", async () => {
    const picks = await import("./agentOptions");
    picks.pickAgentOption("local", harness, "mode", "plan");
    picks.pickAgentOption("local", harness, "thinking", "adaptive");
    picks.pickAgentOption("remote", harness, "mode", "plan");
    picks.resetAgentOption("local", harness, "mode");
    expect(picks.pendingAgentOptions("local", harness)).toEqual({ thinking: "adaptive" });
    expect(picks.pendingAgentOptions("remote", harness)).toEqual({ mode: "plan" });
    expect(picks.isAgentOptionExplicit("local", harness, "mode")).toBe(false);
  });

  it("keeps remembered preferences when the server has no learned options yet", async () => {
    localStorage.setItem("carbon.agentOptions", JSON.stringify({ [`local|${harness}`]: { mode: "plan" } }));
    const picks = await import("./agentOptions");
    picks.reconcileAgentOptions("local", harness, []);
    expect(picks.pendingAgentOptions("local", harness)).toEqual({ mode: "plan" });
    expect(picks.isAgentOptionExplicit("local", harness, "mode")).toBe(false);
  });
});

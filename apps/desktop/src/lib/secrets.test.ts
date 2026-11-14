import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  effects: false,
  handlers: new Map<string, (event: unknown) => void>(),
  invoke: vi.fn(),
}));
vi.mock("react", () => ({
  useEffect: (effect: () => unknown) => { if (mocks.effects) effect(); },
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock("@/lib/transport", () => ({
  invoke: mocks.invoke,
  listen: vi.fn((event, handler) => { mocks.handlers.set(event, handler); return Promise.resolve(() => {}); }),
  noteSession: vi.fn(),
  serverOfSession: () => "local",
}));

type Secrets = typeof import("./secrets");
type Handoff = import("./secrets").SecretHandoff;
let secrets: Secrets;
const request: Handoff = {
  id: "request", sessionId: "session", agent: "Test", purpose: "Synthetic test",
  fields: [{ name: "TOKEN", label: "Token" }], target: { kind: "command", command: ["true"] },
  cwd: "/tmp", expiresAt: Date.now() + 60_000, state: "pending", message: null,
  keepFile: false, keepBlocked: null, submitLabel: null,
};
const deliver = (state: Handoff["state"]) => mocks.handlers.get("secret_requests_changed")?.({
  server: "local", payload: { sessionId: "session", requests: [{ ...request, state }] },
});
const current = () => secrets.useSecretRequests("session")[0];

beforeEach(async () => {
  vi.resetModules();
  mocks.invoke.mockReset();
  mocks.handlers.clear();
  secrets = await import("./secrets");
  mocks.effects = true;
  secrets.usePendingSecretSessions();
  mocks.effects = false;
  deliver("pending");
});

describe("secret acknowledgement reconciliation", () => {
  it.each(["running", "used", "failed", "denied"] as const)("preserves an authoritative %s received before a lost acknowledgement", async (state) => {
    mocks.invoke.mockImplementation(async () => { deliver(state); throw new Error("lost acknowledgement"); });
    const values = { TOKEN: "synthetic-secret" };
    await secrets.submitSecret(request, values, false);
    expect(current().state).toBe(state);
    expect(current().clientError).toBeUndefined();
    expect(values).toEqual({});
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("discards a stale status read when an outcome arrives during reconciliation", async () => {
    mocks.invoke.mockImplementation(async (cmd) => {
      if (cmd === "answer_secret_request") throw new Error("lost acknowledgement");
      deliver("used");
      return [request];
    });
    await secrets.submitSecret(request, { TOKEN: "synthetic-secret" }, false);
    expect(current().state).toBe("used");
    expect(current().clientError).toBeUndefined();
  });

  it("recovers an outcome from the server when its event was missed", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("lost acknowledgement")).mockResolvedValueOnce([{ ...request, state: "used" }]);
    await secrets.submitSecret(request, { TOKEN: "synthetic-secret" }, false);
    expect(current().state).toBe("used");
  });

  it("reports uncertainty without cancelling or inventing a failed server state", async () => {
    mocks.invoke.mockRejectedValue(new Error("offline"));
    await secrets.submitSecret(request, { TOKEN: "synthetic-secret" }, false);
    expect(current().state).toBe("pending");
    expect(current().clientError).toContain("Could not confirm");
    expect(mocks.invoke.mock.calls.map(([cmd]) => cmd)).toEqual(["answer_secret_request", "list_secret_requests"]);
    deliver("used");
    expect(current().state).toBe("used");
    expect(current().clientError).toBeUndefined();
  });

  it("preserves a confirmed denial when its acknowledgement is lost", async () => {
    mocks.invoke.mockImplementation(async () => { deliver("denied"); throw new Error("lost acknowledgement"); });
    await secrets.denySecret(request);
    expect(current().state).toBe("denied");
    expect(current().clientError).toBeUndefined();
  });
});

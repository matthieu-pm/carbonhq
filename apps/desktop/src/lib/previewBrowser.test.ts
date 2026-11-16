import { describe, expect, it, vi } from "vitest";

const { invoke, handlers } = vi.hoisted(() => ({
  invoke: vi.fn(async (_command: string, _args?: unknown) => null),
  handlers: new Map<string, (event: { payload: any; server: string }) => void>(),
}));
vi.mock("@/lib/transport", () => ({
  invoke, LOCAL: "local", serverOfSession: () => "local",
  listen: vi.fn((event, handler) => { handlers.set(event, handler); return Promise.resolve(() => {}); }),
}));
vi.stubGlobal("MutationObserver", class { observe() {} });
vi.stubGlobal("document", { body: {} });

import { openPreviewInBrowser } from "@/lib/browser";

const tabs = (sessionId: string, id: number, url: string) => handlers.get("browser_tabs")!({
  server: "local", payload: { sessionId, tabs: [{ id, url, active: true }] },
});

describe("preview browser tab ownership", () => {
  it("reuses the same tab after a slash normalization or same-origin redirect", async () => {
    const session = crypto.randomUUID();
    await openPreviewInBrowser(session, "http://127.0.0.1:3000");
    tabs(session, 41, "http://127.0.0.1:3000/login");
    invoke.mockClear();
    await openPreviewInBrowser(session, "http://127.0.0.1:5000");
    expect(invoke.mock.calls).toEqual([
      ["browser_activate", { sessionId: session, id: 41 }],
      ["browser_open", { sessionId: session, url: "http://127.0.0.1:5000", newTab: false }],
    ]);
  });

  it("leaves a tab the agent is driving in place", async () => {
    const session = crypto.randomUUID();
    await openPreviewInBrowser(session, "http://127.0.0.1:3001");
    tabs(session, 42, "http://127.0.0.1:3001/");
    handlers.get("browser_driven")!({ server: "local", payload: { run: 1, tab: 42, verb: "click" } });
    invoke.mockClear();
    await openPreviewInBrowser(session, "http://127.0.0.1:5001/");
    expect(invoke.mock.calls).toEqual([
      ["browser_open", { sessionId: session, url: "http://127.0.0.1:5001/", newTab: true }],
    ]);
  });

  it("opens a new tab if the previous one disappears while activating", async () => {
    const session = crypto.randomUUID();
    await openPreviewInBrowser(session, "http://[::1]:3002");
    tabs(session, 43, "http://[::1]:3002/");
    invoke.mockClear();
    invoke.mockRejectedValueOnce(new Error("Tab closed"));
    await openPreviewInBrowser(session, "http://[::1]:5002");
    expect(invoke).toHaveBeenLastCalledWith("browser_open", { sessionId: session, url: "http://[::1]:5002", newTab: true });
  });
});

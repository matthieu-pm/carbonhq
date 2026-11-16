import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, handlers, servers } = vi.hoisted(() => ({
  invoke: vi.fn(),
  handlers: new Map<string, (event: { payload: any; server: string }) => void>(),
  servers: new Map<string, string>(),
}));
vi.mock("@/lib/transport", () => ({
  invoke,
  LOCAL: "local",
  listen: vi.fn((event, handler) => { handlers.set(event, handler); return Promise.resolve(() => {}); }),
  noteSession: (id: string, server: string) => { servers.set(id, server); },
  serverOfSession: (id: string) => servers.get(id) ?? "local",
}));
vi.mock("react", () => ({ useEffect: () => {}, useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() }));

import { previewUrl, startPreview, usePreview, type PreviewState } from "@/lib/preview";

const state = (sessionId: string, status: PreviewState["status"]): PreviewState => ({
  sessionId, status, config: { directory: ".", command: "pnpm dev --port {port}" },
  port: 12345, url: status === "running" ? "http://[::1]:12345/" : null, message: null,
});

beforeEach(() => { invoke.mockReset(); });

describe("managed previews", () => {
  it("keeps the running event when an older start reply arrives afterwards", async () => {
    const id = crypto.randomUUID();
    let reply!: (value: PreviewState) => void;
    invoke.mockImplementation(() => new Promise((resolve) => { reply = resolve; }));
    const starting = startPreview(id);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
    handlers.get("preview_changed")!({ payload: state(id, "running"), server: "local" });
    reply(state(id, "starting"));
    expect((await starting)?.status).toBe("running");
    expect(usePreview(id)?.status).toBe("running");
  });

  it("reconciles one server on reconnect without clearing another server's preview", async () => {
    const local = crypto.randomUUID(), remote = crypto.randomUUID();
    invoke.mockResolvedValue(null);
    await startPreview(local);
    handlers.get("preview_changed")!({ payload: state(local, "running"), server: "local" });
    handlers.get("preview_changed")!({ payload: state(remote, "running"), server: "box" });
    handlers.get("live_state")!({ payload: { previews: [] }, server: "local" });
    expect(usePreview(local)).toBe(null);
    expect(usePreview(remote)?.status).toBe("running");
    handlers.get("live_state")!({ payload: { previews: [state(remote, "failed")] }, server: "box" });
    expect(usePreview(remote)?.status).toBe("failed");
  });

  it("opens the verified local address and uses authenticated forwarding for a remote preview", async () => {
    const local = state(crypto.randomUUID(), "running");
    expect(await previewUrl(local)).toBe("http://[::1]:12345/");
    expect(invoke).not.toHaveBeenCalled();
    servers.set("remote", "box");
    invoke.mockResolvedValue(54321);
    expect(await previewUrl(state("remote", "running"))).toBe("http://127.0.0.1:54321/");
    expect(invoke).toHaveBeenCalledWith("preview_forward", { server: "box", sessionId: "remote" }, "local");
  });
});

import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn(async () => 51234);
const listeners = new Map<string, (event: { payload: unknown }) => void>();
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock("@/lib/transport", () => ({
  LOCAL: "local",
  invoke: (...args: unknown[]) => invoke(...(args as [])),
  listen: (event: string, callback: (event: { payload: unknown }) => void) => {
    listeners.set(event, callback);
    return Promise.resolve(() => listeners.delete(event));
  },
  serverOfSession: (id: string) => (id === "remote" ? "vps" : "local"),
}));

const { annotate, reachableUrl, browserTarget, normalizeUrl, setAnnotateHandler, useAnnotating, useBrowserTabs } = await import("@/lib/browser");

describe("Ask", () => {
  it("stages late crops without switching off a reopened annotation session", async () => {
    const stage = vi.fn();
    const sessionId = "ask";
    const receive = (annotations: unknown) =>
      listeners.get("browser_annotate")!({ payload: { sessionId, annotations } });
    vi.stubGlobal("document", { body: {} });
    vi.stubGlobal("MutationObserver", class { observe() {} });
    try {
      useBrowserTabs(null);
      setAnnotateHandler(stage);
      await annotate(sessionId, true);
      receive(null);
      expect(useAnnotating(sessionId)).toBe(false);
      await annotate(sessionId, true);
      const annotations = [{ note: "Keep this" }];
      receive(annotations);
      expect(stage).toHaveBeenCalledWith(sessionId, annotations);
      expect(useAnnotating(sessionId)).toBe(true);
    } finally {
      setAnnotateHandler(null);
      await annotate(sessionId, false);
      vi.unstubAllGlobals();
    }
  });
});

describe("browserTarget", () => {
  it("reads loopback, .localhost, .local and private LAN hosts as localhost", () => {
    for (const url of [
      "http://localhost:5173/",
      "http://LOCALHOST:3000",
      "http://app.localhost:8080/x",
      "http://127.0.0.1:3000",
      "http://127.4.5.6",
      "http://[::1]:3000/",
      "http://0.0.0.0:8000",
      "http://10.0.0.7:3000",
      "http://172.16.0.1",
      "http://172.31.255.255:80",
      "http://192.168.1.20:5173",
      "http://mac-mini.local:3000",
      "https://dev.local",
    ]) {
      expect(browserTarget(url), url).toBe("localhost");
    }
  });

  it("reads every other http(s) page as a site", () => {
    for (const url of [
      "https://example.com",
      "https://localhost.example.com",
      "http://localhost.evil.test:3000",
      "https://GitHub.com/a/b",
      "http://172.15.0.1",
      "http://172.32.0.1",
      "http://11.0.0.1",
      "http://8.8.8.8",
      "http://[2001:db8::1]/",
      "https://local.example.com",
    ]) {
      expect(browserTarget(url), url).toBe("site");
    }
  });

  it("reports nothing for what is no web page", () => {
    expect(browserTarget("about:blank")).toBeNull();
    expect(browserTarget("data:text/html,hi")).toBeNull();
    expect(browserTarget("not a url")).toBeNull();
    expect(browserTarget("")).toBeNull();
  });

  it("classifies URL-bar input once normalized", () => {
    expect(browserTarget(normalizeUrl("localhost:5173"))).toBe("localhost");
    expect(browserTarget(normalizeUrl("[::1]:3000"))).toBe("localhost");
    expect(browserTarget(normalizeUrl("example.com"))).toBe("site");
    expect(browserTarget(normalizeUrl("how to center a div"))).toBe("site");
  });
});

describe("reachableUrl", () => {
  it("forwards a remote session's loopback port, keeping the path", async () => {
    expect(await reachableUrl("remote", "http://127.0.0.1:3000/a?b=1#c")).toBe("http://localhost:51234/a?b=1#c");
    expect(invoke).toHaveBeenLastCalledWith("forward_port", { server: "vps", port: 3000 }, "local");
    await reachableUrl("remote", "http://localhost/");
    expect(invoke).toHaveBeenLastCalledWith("forward_port", { server: "vps", port: 80 }, "local");
  });

  it("leaves local sessions, public hosts and non-URLs alone", async () => {
    invoke.mockClear();
    expect(await reachableUrl("mine", "http://localhost:3000")).toBe("http://localhost:3000");
    expect(await reachableUrl("remote", "https://example.com")).toBe("https://example.com");
    expect(await reachableUrl("remote", "not a url")).toBe("not a url");
    expect(invoke).not.toHaveBeenCalled();
  });
});

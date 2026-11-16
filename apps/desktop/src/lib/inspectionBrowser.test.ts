import { describe, expect, it, vi } from "vitest";

const { invoke, restore, handlers } = vi.hoisted(() => ({
  invoke: vi.fn<(...args: any[]) => Promise<any>>(async () => null),
  restore: vi.fn(),
  handlers: new Map<string, (event: { payload: any }) => void>(),
}));
vi.mock("@/lib/transport", () => ({
  invoke, LOCAL: "local", serverOfSession: () => "local",
  listen: (event: string, handler: (event: any) => void) => {
    handlers.set(event, handler);
    return Promise.resolve(() => {});
  },
}));
vi.mock("@/hooks/useAttachments", () => ({ restoreAttachments: restore }));
vi.mock("react", () => ({ useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() }));
vi.stubGlobal("MutationObserver", class { observe() {} });
vi.stubGlobal("document", { body: {} });

import { addPickedElements, openPreviewInBrowser, pickElement, useInspection } from "./browser";

function tabs(sessionId: string, active: number) {
  handlers.get("browser_tabs")!({ payload: { sessionId, tabs: [1, 2].map(id => ({ id, active: id === active, url: "http://localhost/" })) } });
}

function picked(sessionId: string, tabId: number, count: number, active = true) {
  handlers.get("browser_pick")!({ payload: { sessionId, tabId, count, active, add: false } });
}

describe("inspection ownership", () => {
  it("keeps a capture on its original tab and composer while the reader switches tabs", async () => {
    const session = crypto.randomUUID();
    await openPreviewInBrowser(session, "http://localhost/");
    tabs(session, 1);
    await pickElement(session, true);
    picked(session, 1, 2);
    let complete!: (value: unknown) => void;
    invoke.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const capture = addPickedElements(session);
    expect(useInspection(session).busy).toBe(true);
    await addPickedElements(session);
    expect(invoke).toHaveBeenLastCalledWith("browser_inspect_add", { sessionId: session, tabId: 1 });
    tabs(session, 2);
    expect(useInspection(session).active).toBe(false);
    picked(session, 1, 0);
    const attachments = [{ path: "/saved/selection.carbon-inspect" }];
    complete(attachments);
    await capture;
    expect(restore).toHaveBeenLastCalledWith(session, attachments);
    tabs(session, 1);
    expect(useInspection(session)).toMatchObject({ active: true, busy: false, count: 0 });
    picked(session, 1, 1);
    invoke.mockResolvedValueOnce(attachments);
    await addPickedElements(session);
    expect(restore).toHaveBeenCalledTimes(2);
  });

  it("retains selections after capture failure and rolls back a failed mode change", async () => {
    const session = crypto.randomUUID();
    await openPreviewInBrowser(session, "http://localhost/");
    tabs(session, 1);
    await pickElement(session, true);
    picked(session, 1, 1);
    invoke.mockRejectedValueOnce(new Error("Page changed during capture"));
    await addPickedElements(session);
    expect(useInspection(session)).toMatchObject({ active: true, count: 1, busy: false, error: "Error: Page changed during capture" });
    invoke.mockRejectedValueOnce(new Error("Browser unavailable"));
    await pickElement(session, false);
    expect(useInspection(session)).toMatchObject({ active: true, count: 1, error: "Error: Browser unavailable" });
    picked(session, 1, 0, false);
    expect(useInspection(session)).toMatchObject({ active: false, count: 0 });
  });
});

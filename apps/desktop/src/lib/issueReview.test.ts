import { describe, expect, it, vi } from "vitest";
import type { IssueReview } from "@/lib/issueDraft";

const { invoke, handlers, effects } = vi.hoisted(() => ({ invoke: vi.fn(), handlers: new Map<string, (event: {server: string}) => void>(), effects: { run: false } }));
vi.mock("@/lib/transport", () => ({ invoke, listen: vi.fn((event, handler) => { handlers.set(event, handler); return Promise.resolve(() => {}); }), serverOfSession: () => "local" }));
vi.mock("react", () => ({ useEffect: (effect: () => void) => { if (effects.run) effect(); }, useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot() }));

import { editIssueReview, flushIssueReview, refreshIssueReview, rememberIssueReview, useIssueReview } from "@/lib/issueDraft";

describe("issue review persistence", () => {
  it("serializes a newer edit behind an in-flight save and flushes the latest draft before send", async () => {
    const sessionId = crypto.randomUUID();
    const review: IssueReview = { requestId: crypto.randomUUID(), submitted: null, created: null,
      draft: { sourceKey: "one", tracker: "github", destination: "acme/web", projectId: null, title: "Initial", description: "Details" } };
    rememberIssueReview(sessionId, review);
    let release: (() => void) | undefined;
    let calls = 0;
    invoke.mockImplementation(async (_cmd, { draft }) => {
      if (++calls === 1) await new Promise<void>((resolve) => { release = resolve; });
      return { ...review, draft };
    });
    editIssueReview(sessionId, { ...review.draft, title: "First edit" });
    const first = flushIssueReview(sessionId);
    editIssueReview(sessionId, { ...review.draft, title: "Latest edit" });
    const second = flushIssueReview(sessionId);
    expect(invoke).toHaveBeenCalledTimes(1);
    release!();
    await Promise.all([first, second]);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1][1].draft.title).toBe("Latest edit");
  });

  it("keeps a saved manual edit when a refresh starts while the edit is pending", async () => {
    const sessionId = crypto.randomUUID();
    const review: IssueReview = { requestId: crypto.randomUUID(), submitted: null, created: null,
      draft: { sourceKey: "one", tracker: "github", destination: "acme/web", projectId: null, title: "Initial", description: "Details" } };
    rememberIssueReview(sessionId, review);
    let releaseRead: (() => void) | undefined;
    invoke.mockImplementation(async (command, { draft }) => {
      if (command === "get_issue_review") {
        await new Promise<void>((resolve) => { releaseRead = resolve; });
        return review;
      }
      return { ...review, draft };
    });
    editIssueReview(sessionId, { ...review.draft, title: "Edited title" });
    const refresh = refreshIssueReview(sessionId);
    await flushIssueReview(sessionId);
    releaseRead?.();
    await refresh;
    expect(useIssueReview(sessionId, true).value?.draft.title).toBe("Edited title");
  });
  it("recovers a creation completed during a dropped connection", async () => {
    const sessionId = crypto.randomUUID();
    const review: IssueReview = { requestId: crypto.randomUUID(), submitted: null, created: null,
      draft: { sourceKey: "one", tracker: "github", destination: "acme/web", projectId: null, title: "Draft", description: "Details" } };
    rememberIssueReview(sessionId, review);
    let remote = review;
    invoke.mockImplementation(async () => remote);
    effects.run = true;
    useIssueReview(sessionId, true);
    effects.run = false;
    await refreshIssueReview(sessionId);
    editIssueReview(sessionId, { ...review.draft, title: "Pending offline edit" });
    remote = { ...review, linked: true, created: { tracker: "github", id: "I_1", identifier: "acme/web#1", title: "Draft", url: "https://github.com/acme/web/issues/1" } };
    handlers.get("live_state")!({ server: "local" });
    await vi.waitFor(() => expect(useIssueReview(sessionId, true).value?.created?.id).toBe("I_1"));
    expect(useIssueReview(sessionId, true).saving).toBe(false);
  });

});

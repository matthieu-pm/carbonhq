import { describe, expect, it, vi } from "vitest";
import type { IssueReview } from "@/lib/issueDraft";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/transport", () => ({ invoke, listen: vi.fn(() => Promise.resolve(() => {})), serverOfSession: () => "local" }));

import { editIssueReview, flushIssueReview, rememberIssueReview } from "@/lib/issueDraft";

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
});

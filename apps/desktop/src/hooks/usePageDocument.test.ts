import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ update: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/pages", async (original) => ({ ...(await original<typeof import("@/lib/pages")>()), updatePage: calls.update, readPage: calls.read }));
vi.mock("@/lib/transport", () => ({ listen: vi.fn(async () => () => {}), LOCAL: "local", qualify: (p: string) => p }));
import { editPageDraft, markPageDraftPending, openPageDraft, pageDraft, refreshPageDraft, resolvePageDraft, savePageDraft } from "./usePageDocument";
import type { LocatedPage, Page } from "@/lib/pages";

let id = 0;
const page = (): LocatedPage<Page> => ({ id: `test-${++id}`, server: "local", title: "Original", markdown: "# Original\n", projectPaths: ["/a"], revision: 1, favorite: false, trashed: false, created: "2026-11-08", modified: "2026-11-08" });

beforeEach(() => { vi.useFakeTimers(); calls.update.mockReset(); calls.read.mockReset(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("managed Page drafts", () => {
  it("does not save or normalize an untouched document", async () => {
    const original = page();
    openPageDraft(original);
    await savePageDraft(original);
    expect(calls.update).not.toHaveBeenCalled();
    expect(pageDraft(original)?.markdown).toBe(original.markdown);
  });

  it("keeps edits made while a save is in flight", async () => {
    const original = page();
    openPageDraft(original);
    let finish!: (saved: LocatedPage<Page>) => void;
    calls.update.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    editPageDraft(original, { markdown: "first edit" });
    const saving = savePageDraft(original);
    editPageDraft(original, { markdown: "second edit" });
    finish({ ...original, markdown: "first edit", revision: 2 });
    await saving;
    expect(pageDraft(original)).toMatchObject({ markdown: "second edit", dirty: true, base: { revision: 2, markdown: "first edit" } });
  });

  it("normalizes only the submitted title and project order after acceptance", async () => {
    const original = page();
    openPageDraft(original);
    editPageDraft(original, { title: "  New title  ", projectPaths: ["/z", "/a"] });
    calls.update.mockResolvedValue({ ...original, title: "New title", projectPaths: ["/a", "/z"], revision: 2 });
    await savePageDraft(original);
    expect(pageDraft(original)).toMatchObject({ title: "New title", projectPaths: ["/a", "/z"], dirty: false });
  });

  it("protects rich input before its delayed Markdown serialization", async () => {
    const original = page();
    openPageDraft(original);
    markPageDraftPending(original);
    calls.read.mockResolvedValue({ ...original, markdown: "agent edit", revision: 2 });
    await refreshPageDraft(original);
    await savePageDraft(original);
    expect(calls.update).not.toHaveBeenCalled();
    expect(pageDraft(original)).toMatchObject({ conflict: true, markdown: original.markdown, base: { revision: 1 } });
  });

  it("stops autosave at a conflict until the user resolves it", async () => {
    const original = page();
    openPageDraft(original);
    editPageDraft(original, { markdown: "my draft" });
    calls.update.mockRejectedValueOnce("Page conflict: expected revision 1, found 2");
    await savePageDraft(original);
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls.update).toHaveBeenCalledTimes(1);
    expect(pageDraft(original)).toMatchObject({ markdown: "my draft", conflict: true, dirty: true });
    calls.read.mockResolvedValue({ ...original, revision: 2, markdown: "agent edit" });
    calls.update.mockResolvedValue({ ...original, revision: 3, markdown: "my draft" });
    await resolvePageDraft(original, "draft", 2);
    expect(calls.update.mock.calls[1][0].revision).toBe(2);
    expect(pageDraft(original)).toMatchObject({ dirty: false, conflict: false, base: { revision: 3 } });
  });

  it("refuses to overwrite a remote revision that changed after comparison", async () => {
    const original = page();
    openPageDraft(original);
    editPageDraft(original, { markdown: "my draft" });
    calls.read.mockResolvedValue({ ...original, revision: 3, markdown: "unseen agent edit" });
    await resolvePageDraft(original, "draft", 2);
    expect(calls.update).not.toHaveBeenCalled();
    expect(pageDraft(original)).toMatchObject({ markdown: "my draft", conflict: true, base: { revision: 1 } });
  });

  it("catches up on an agent change delivered before the UI save reply", async () => {
    const original = page();
    openPageDraft(original);
    let finish!: (saved: LocatedPage<Page>) => void;
    calls.update.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    calls.read.mockResolvedValue({ ...original, revision: 3, markdown: "agent edit after UI commit" });
    editPageDraft(original, { markdown: "UI edit" });
    const saving = savePageDraft(original);
    await refreshPageDraft(original);
    finish({ ...original, markdown: "UI edit", revision: 2 });
    await saving;
    await Promise.resolve();
    expect(calls.read).toHaveBeenCalledTimes(1);
    expect(pageDraft(original)).toMatchObject({ markdown: "agent edit after UI commit", dirty: false, base: { revision: 3 } });
  });
});

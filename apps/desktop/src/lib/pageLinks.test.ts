import { describe, expect, it } from "vitest";
import { pageMention, pagePromptContext, pageUrl, parsePageUrl } from "./pageLinks";
import { highlightSegments } from "./highlight";

const id = "019a1234-abcd-7000-8000-123456789abc";
describe("Page references", () => {
  it("preserves the owner and cited revision", () => {
    const page = { id, server: "local", revision: 12 };
    expect(parsePageUrl(pageUrl(page))).toEqual(page);
    expect(parsePageUrl(`#carbon-page=${encodeURIComponent(pageUrl(page))}`)).toEqual(page);
  });
  it("rejects executable or malformed references", () => {
    expect(parsePageUrl("javascript:alert(1)")).toBeNull();
    expect(parsePageUrl(`carbon-page://local/${id}?revision=-1`)).toBeNull();
    expect(parsePageUrl(`carbon-page://local/${id}?revision=9007199254740992`)).toBeNull();
  });
  it("keeps document references clickable in sent messages", () => {
    const mention = pageMention({ id, server: "local", revision: 3, title: "Plan [draft]" });
    expect(mention).toContain("Plan \\[draft\\]");
    expect(highlightSegments(`[Plan](${pageUrl({ id, server: "local", revision: 3 })})`).some((part) => part.href?.startsWith("carbon-page:"))).toBe(true);
  });
});

describe("Page ownership and agent context", () => {
  it("distinguishes relative owner links from absolute This Mac links", () => {
    expect(parsePageUrl(pageUrl({ id, server: "remote", relative: true }))).toEqual({ id, server: "local", relative: true });
    expect(parsePageUrl(pageUrl({ id, server: "local" }))).toEqual({ id, server: "local" });
    expect(parsePageUrl(pageUrl({ id, server: "remote" }))).toEqual({ id, server: "remote" });
  });
  it("instructs same-owner agents to read the immutable cited revision", () => {
    const context = pagePromptContext({ id, server: "local", revision: 7, title: "Plan", markdown: "body" }, "local");
    expect(context).toContain(`carbon pages read ${id} --version 7`);
    expect(context).not.toContain("Page snapshot");
  });
  it("includes exact foreign content with a fence that cannot close early", () => {
    const markdown = "# Remote\n```ts\ncode\n```\n````";
    const context = pagePromptContext({ id, server: "remote", revision: 7, title: "Plan", markdown }, "local");
    expect(context).toContain(`\n\`\`\`\`\`markdown\n${markdown}\n\`\`\`\`\``);
    expect(context).not.toContain("carbon pages read");
  });
});

import { describe, expect, it } from "vitest";
import { issueProposal, splitIssueProposal } from "@/lib/issueDraft";

const fence = (title: string, description: string) => `\`\`\`carbon-issue\n${JSON.stringify({ title, description })}\n\`\`\``;

describe("inline issue proposals", () => {
  it("extracts a review while keeping the conversational reply", () => {
    const description = "## Reproduce\n1. Search for login.\n2. Press Escape.\n\nKeep `code` and Markdown.";
    const result = splitIssueProposal(`Here is a draft.\n\n${fence("Clear the issue search", description)}\n\nWhat else should it cover?`);
    expect(result.text).toBe("Here is a draft.\n\n\n\nWhat else should it cover?");
    expect(result.proposal).toEqual(issueProposal("Clear the issue search", description));
  });

  it("hides an unfinished review during streaming and keeps the completed prose", () => {
    const result = splitIssueProposal('I updated it.\n\n```carbon-issue\n{"title":"Clear', true);
    expect(result).toEqual({ text: "I updated it.", proposal: null });
  });

  it("leaves ordinary JSON, malformed proposals, and empty titles readable", () => {
    for (const text of ['```json\n{"title":"Example"}\n```', '```carbon-issue\nnot JSON\n```', fence(" ", "Details")]) {
      expect(splitIssueProposal(text)).toEqual({ text, proposal: null });
    }
  });

  it("uses the last complete proposal and a stable key for the same draft", () => {
    const result = splitIssueProposal(`${fence("Before", "Old")}\n${fence("After", "New")}`);
    expect(result.proposal).toEqual(issueProposal("After", "New"));
    expect(issueProposal("After", "New").sourceKey).not.toBe(issueProposal("After", "Edited").sourceKey);
  });
});

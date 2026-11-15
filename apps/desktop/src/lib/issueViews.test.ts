import { describe, expect, it } from "vitest";

import { addListTab, initialIssueTabs, openIssueTab } from "@/lib/issueTabs";
import { applyIssueView, coerceIssueViews, matchesIssueView, type SavedIssueView } from "@/lib/issueViews";

const view: SavedIssueView = { id: "bugs", name: "Website bugs", query: {
  tracker: "github", scope: "all", teamId: "acme/web", projectId: null,
  text: "login", label: "bug", issueType: null, settled: false,
} };

describe("saved issue views", () => {
  it("applies tracker and every filter to the active list without adding tabs or changing its neighbours", () => {
    const state = addListTab(initialIssueTabs(), "second", "linear");
    const next = applyIssueView(state, view);
    expect(next.active).toBe("second");
    expect(next.tabs).toHaveLength(2);
    expect(next.tabs[0]).toBe(state.tabs[0]);
    expect(next.tabs[1]).toMatchObject({ tracker: "github", query: view.query });
    expect(matchesIssueView(view, next.tabs[1].kind === "list" ? next.tabs[1].query : null)).toBe(true);
    expect(matchesIssueView(view, { ...view.query, label: null })).toBe(false);
  });

  it("returns to an existing list when an issue is open", () => {
    const state = openIssueTab(initialIssueTabs(), { tracker: "linear", id: "uuid", identifier: "CBN-1", title: "Test", url: "https://linear.app/x/CBN-1" });
    const next = applyIssueView(state, view);
    expect(next.active).toBe("list:main");
    expect(next.tabs).toHaveLength(2);
    expect(next.tabs[1]).toBe(state.tabs[1]);
  });

  it("restores valid views independently of malformed or duplicate records", () => {
    expect(coerceIssueViews([view, { ...view, name: "Duplicate" }, { id: "broken", name: "Broken", query: {} }, null])).toEqual([view]);
    expect(coerceIssueViews({})).toEqual([]);
    expect(coerceIssueViews([{ ...view, query: { ...view.query, label: 42 } }])[0].query.label).toBeNull();
  });
});

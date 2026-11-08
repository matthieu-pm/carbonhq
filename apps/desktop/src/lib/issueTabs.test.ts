import { describe, expect, it } from "vitest";

import {
  addListTab,
  closeIssueTab,
  coerceIssueTabs,
  initialIssueTabs,
  issueTabId,
  listTabLabel,
  moveIssueTab,
  openIssueTab,
  updateListTab,
} from "./issueTabs";
import type { IssueQuery, IssueRef } from "@/types/events";

const ref = (n: number): IssueRef => ({
  tracker: "linear",
  id: `uuid-${n}`,
  identifier: `CBN-${n}`,
  title: `Issue ${n}`,
  url: `https://linear.app/x/issue/CBN-${n}`,
});

const query = (patch: Partial<IssueQuery> = {}): IssueQuery => ({
  tracker: "linear",
  text: null,
  scope: "assigned",
  teamId: null,
  projectId: null,
  label: null,
  issueType: null,
  settled: false,
  ...patch,
});

describe("issue tabs", () => {
  it("opens an issue beside the tab it came from, and reuses its tab", () => {
    let s = addListTab(initialIssueTabs(), "list:b", "linear");
    s = { ...s, active: "list:main" };
    s = openIssueTab(s, ref(1));
    expect(s.tabs.map((t) => t.id)).toEqual(["list:main", issueTabId(ref(1)), "list:b"]);
    expect(s.active).toBe(issueTabId(ref(1)));
    s = { ...s, active: "list:b" };
    const again = openIssueTab(s, ref(1));
    expect(again.tabs).toHaveLength(3);
    expect(again.active).toBe(issueTabId(ref(1)));
  });

  it("closing the lit tab lands on its right, then its left, and never empties", () => {
    let s = openIssueTab(openIssueTab(initialIssueTabs(), ref(1)), ref(2));
    // main, 1, 2 with 2 lit — opening from 1 put 2 after it.
    s = { ...s, active: issueTabId(ref(1)) };
    expect(closeIssueTab(s, issueTabId(ref(1))).active).toBe(issueTabId(ref(2)));
    s = { ...s, active: issueTabId(ref(2)) };
    expect(closeIssueTab(s, issueTabId(ref(2))).active).toBe(issueTabId(ref(1)));
    expect(closeIssueTab(initialIssueTabs(), "list:main")).toEqual(initialIssueTabs());
  });

  it("moves a tab to a place", () => {
    const s = openIssueTab(initialIssueTabs(), ref(1));
    expect(moveIssueTab(s, issueTabId(ref(1)), 0).tabs[0].id).toBe(issueTabId(ref(1)));
  });

  it("keeps the same state when an update changes nothing", () => {
    const s = initialIssueTabs();
    expect(updateListTab(s, "list:main", { label: "My issues" })).toBe(s);
    expect(updateListTab(s, "list:main", { name: "Bugs" }).tabs[0]).toMatchObject({ name: "Bugs" });
  });

  it("names a list by what narrows it", () => {
    const filters = {
      teams: [{ id: "t1", name: "Carbon" }],
      projects: [{ id: "p1", name: "Desktop" }],
      labels: [],
      issueTypes: [],
      teamStates: {},
    } as never;
    expect(listTabLabel(query(), null)).toBe("My issues");
    expect(listTabLabel(query({ scope: "all", teamId: "t1", projectId: "p1", text: " login " }), filters)).toBe(
      "All issues · Carbon · Desktop · “login”",
    );
    // An option not read yet is left out rather than drawn as its id.
    expect(listTabLabel(query({ teamId: "t1" }), null)).toBe("My issues");
    expect(listTabLabel(query({ tracker: "github", teamId: "acme/web", settled: true }), null)).toBe(
      "My issues · web · Closed",
    );
  });

  it("keeps each list's own tracker", () => {
    const s = addListTab(initialIssueTabs("linear"), "list:b", "github");
    const flipped = updateListTab(s, "list:b", { tracker: "linear" });
    expect(s.tabs.map((t) => t.kind === "list" && t.tracker)).toEqual(["linear", "github"]);
    expect(flipped.tabs[0]).toBe(s.tabs[0]);
    // Closing the last tab keeps the tracker it was on.
    const lone = { tabs: [s.tabs[1]], active: "list:b" };
    expect(closeIssueTab(lone, "list:b").tabs[0]).toMatchObject({ tracker: "github" });
  });

  it("reads back only the tabs it can draw", () => {
    expect(coerceIssueTabs("junk")).toEqual(initialIssueTabs());
    const s = coerceIssueTabs({
      tabs: [{ kind: "list", id: "list:a", label: "" }, { kind: "issue", id: "x" }, { kind: "issue", id: "i", ref: ref(3) }],
      active: "gone",
    });
    expect(s.tabs.map((t) => t.id)).toEqual(["list:a", "i"]);
    expect(s.active).toBe("list:a");
    expect(s.tabs[0]).toMatchObject({ label: "My issues", name: null, query: null, tracker: "linear" });
    // A tab saved before trackers were per tab follows its saved query.
    const old = coerceIssueTabs({ tabs: [{ kind: "list", id: "l", query: query({ tracker: "github" }) }], active: "l" });
    expect(old.tabs[0]).toMatchObject({ tracker: "github" });
  });
});

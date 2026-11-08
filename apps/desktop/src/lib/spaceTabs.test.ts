import { describe, expect, it } from "vitest";

import {
  addSpaceTab,
  closeSpaceTab,
  coerceSpaceTabs,
  FRESH_VIEW,
  initialSpaceTabs,
  navigateSpaceTab,
  openPageTab,
  setPageTabTitle,
  updateSpaceView,
} from "./spaceTabs";

const page = (n: number, revision?: number) => ({ id: `p${n}`, server: "local", title: `Page ${n}`, ...(revision === undefined ? {} : { revision }) });

describe("space tabs", () => {
  it("a new tab starts on All, sharing nothing with the lit one", () => {
    const searched = updateSpaceView(initialSpaceTabs(), "tab:main", { section: "trash", query: "plan" });
    const next = addSpaceTab(searched, "t2");
    expect(next.active).toBe("t2");
    expect(next.tabs[1].view).toEqual(FRESH_VIEW);
    expect(next.tabs[0].view.query).toBe("plan");
  });

  it("opens a Page beside the lit tab, keeping its view, and reuses an open one", () => {
    let s = addSpaceTab(initialSpaceTabs(), "t2");
    s = updateSpaceView(s, "tab:main", { section: "pages" });
    s = { ...s, active: "tab:main" };
    s = openPageTab(s, page(1), "t3");
    expect(s.tabs.map((t) => t.id)).toEqual(["tab:main", "t3", "t2"]);
    expect(s.tabs[1].view.section).toBe("pages");
    const again = openPageTab({ ...s, active: "t2" }, page(1), "t4");
    expect(again.active).toBe("t3");
    expect(again.tabs).toHaveLength(3);
    // A cited revision is a different document view, so it gets its own tab.
    expect(openPageTab(s, page(1, 4), "t5").tabs).toHaveLength(4);
  });

  it("navigating drops the Page and keeps the rest of the view", () => {
    let s = openPageTab(updateSpaceView(initialSpaceTabs(), "tab:main", { grid: true }), page(1), "t2");
    s = navigateSpaceTab(s, "t2", { section: "trash" });
    expect(s.tabs[1].page).toBeNull();
    expect(s.tabs[1].view).toMatchObject({ section: "trash", grid: true });
  });

  it("renames every tab showing a Page", () => {
    const s = setPageTabTitle(openPageTab(initialSpaceTabs(), page(1), "t2"), { id: "p1", server: "local" }, "Renamed");
    expect(s.tabs[1].page?.title).toBe("Renamed");
  });

  it("never empties the strip", () => {
    expect(closeSpaceTab(initialSpaceTabs(), "tab:main")).toEqual(initialSpaceTabs());
    const s = closeSpaceTab(openPageTab(initialSpaceTabs(), page(1), "t2"), "t2");
    expect(s.active).toBe("tab:main");
  });

  it("keeps what it can read from storage", () => {
    const s = coerceSpaceTabs({
      tabs: [
        { id: "a", view: { section: "nope", query: "x" }, page: null },
        { id: "a", view: {}, page: null },
        { id: "b", view: {}, page: { id: "p1", server: "local" } },
        "junk",
      ],
      active: "missing",
    });
    expect(s.tabs.map((t) => t.id)).toEqual(["a", "b"]);
    expect(s.tabs[0].view).toEqual({ ...FRESH_VIEW, query: "x" });
    expect(s.tabs[1].page).toEqual({ id: "p1", server: "local", title: "Untitled" });
    expect(s.active).toBe("a");
    expect(coerceSpaceTabs(null)).toEqual(initialSpaceTabs());
  });
});

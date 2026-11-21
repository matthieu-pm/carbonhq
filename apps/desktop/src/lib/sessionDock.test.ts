import { describe, expect, it } from "vitest";
import { closeDockTab, dockTab, EMPTY_DOCK, expandTab, reconcileTerminals } from "./sessionDock";

describe("coding session tabs", () => {
  it("moves a tab between rails once and keeps its siblings", () => {
    const side = dockTab(dockTab(EMPTY_DOCK, "plan"), "changes");
    const full = expandTab(expandTab(side, "changes"), "changes");

    expect(full.side).toEqual(["plan"]);
    expect(full.full).toEqual(["changes"]);
    expect(dockTab(dockTab(full, "changes"), "changes")).toEqual(side);
  });

  it("selects the next side tab on close and returns to the terminal after the last one", () => {
    const side = dockTab(dockTab({ ...EMPTY_DOCK, terminals: true }, "issue"), "docs");
    const remaining = closeDockTab(dockTab(side, "issue"), "issue");

    expect(remaining.active).toBe("docs");
    expect(closeDockTab(remaining, "docs")).toEqual({ ...EMPTY_DOCK, active: "terminal", terminals: true });
  });

  it("keeps expanded shells out of the side strip when the shell list changes", () => {
    const main = { id: "a", number: 1 };
    const side = { id: "b", number: 2 };
    const dock = { ...dockTab(EMPTY_DOCK, "docs"), active: "terminal" as const, fullTerminals: [main] };
    expect(reconcileTerminals(dock, [main, side])).toMatchObject({ active: "terminal", terminals: true });
    expect(reconcileTerminals(dock, [main])).toMatchObject({ active: "docs", terminals: false, fullTerminals: [main] });
    expect(reconcileTerminals(dock, [side])).toMatchObject({ active: "terminal", terminals: true, fullTerminals: [] });
  });
});

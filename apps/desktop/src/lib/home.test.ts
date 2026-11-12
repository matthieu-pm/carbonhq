import { describe, expect, it } from "vitest";

import { buildHeatmap, buildWeekStats, mergeSides, recentSessions, sessionPrs, signedDelta } from "@/lib/home";
import type { PrMark } from "@/types/events";

/// Wednesday 11 November 2026, mid-afternoon local time.
const NOW = new Date(2026, 10, 11, 15, 0, 0);

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString();

describe("buildHeatmap", () => {
  it("ends on the current week, Monday first", () => {
    const map = buildHeatmap([], NOW, 4);
    expect(map.weeks).toHaveLength(4);
    const lastWeek = map.weeks[3];
    expect(lastWeek[0].date).toEqual(new Date(2026, 10, 9));
    expect(lastWeek[6].date).toEqual(new Date(2026, 10, 15));
    expect(map.weeks[0][0].date).toEqual(new Date(2026, 9, 19));
  });

  it("marks the days after today as future", () => {
    const week = buildHeatmap([], NOW, 1).weeks[0];
    expect(week.map((cell) => cell.future)).toEqual([false, false, false, true, true, true, true]);
  });

  it("counts by local day and levels against the busiest", () => {
    const map = buildHeatmap(
      [
        { created: at(2026, 10, 11, 1) },
        { created: at(2026, 10, 11, 23) },
        { created: at(2026, 10, 11) },
        { created: at(2026, 10, 11) },
        { created: at(2026, 10, 10) },
        { created: at(2026, 10, 9) },
        { created: at(2026, 10, 9) },
        // Before the window, and unparseable: neither counts.
        { created: at(2026, 9, 1) },
        { created: "nonsense" },
      ],
      NOW,
      1,
    );
    const week = map.weeks[0];
    expect(week.map((cell) => cell.count)).toEqual([2, 1, 4, 0, 0, 0, 0]);
    expect(week.map((cell) => cell.level)).toEqual([2, 1, 4, 0, 0, 0, 0]);
    expect(map.total).toBe(7);
    expect(map.activeDays).toBe(3);
  });

  it("levels nothing when nothing happened", () => {
    const map = buildHeatmap([], NOW, 2);
    expect(map.weeks.flat().every((cell) => cell.level === 0)).toBe(true);
    expect(map.total).toBe(0);
  });
});

describe("buildWeekStats", () => {
  it("compares with last week through the same weekday", () => {
    const stats = buildWeekStats(
      [
        { created: at(2026, 10, 9), projectPath: "/a" },
        { created: at(2026, 10, 11), projectPath: "/a" },
        { created: at(2026, 10, 11), projectPath: "/b" },
        // Last week, Monday to Wednesday: counted.
        { created: at(2026, 10, 2), projectPath: "/a" },
        { created: at(2026, 10, 4), projectPath: "/a" },
        { created: at(2026, 10, 4), projectPath: "/c" },
        { created: at(2026, 10, 4), projectPath: "/d" },
        // Last week's Friday: past the same weekday, so left out.
        { created: at(2026, 10, 6), projectPath: "/e" },
      ],
      NOW,
    );
    expect(stats.days).toEqual([1, 0, 2, 0, 0, 0, 0]);
    expect(stats.todayIndex).toBe(2);
    expect(stats.sessions).toBe(3);
    expect(stats.projects).toBe(2);
    expect(stats.sessionsDelta).toBe(-1);
    expect(stats.projectsDelta).toBe(-1);
  });
});

describe("recentSessions", () => {
  it("orders by last activity and skips hidden ones", () => {
    const rows = recentSessions(
      [
        { id: "old", modified: at(2026, 10, 1), hidden: false },
        { id: "new", modified: at(2026, 10, 11), hidden: false },
        { id: "crew", modified: at(2026, 10, 11, 14), hidden: true },
        { id: "mid", modified: at(2026, 10, 5), hidden: false },
      ],
      2,
    );
    expect(rows.map((row) => row.id)).toEqual(["new", "mid"]);
  });
});

describe("sessionPrs", () => {
  const mark = (number: number, state: PrMark["state"], isDraft = false): PrMark => ({
    number,
    headRefName: `b${number}`,
    isDraft,
    state,
    checksState: "CLEAR",
    mergeable: null,
    mergeStateStatus: null,
  });
  const session = (id: string, branch: string, day: number, worktreeName: string | null = null) => ({
    id,
    projectPath: "/repo",
    branch,
    worktreeName,
    worktreeRemoved: false,
    modified: at(2026, 10, day),
  });

  it("puts open before draft before merged, one row per pull request", () => {
    const marks: Record<string, PrMark> = {
      merged: mark(1, "MERGED"),
      draft: mark(2, "OPEN", true),
      open: mark(3, "OPEN"),
      "worktree-calm": mark(4, "OPEN"),
    };
    const rows = sessionPrs(
      [
        session("m", "merged", 11),
        session("d", "draft", 10),
        session("o-old", "open", 3),
        session("o-new", "open", 9),
        session("none", "nothing", 11),
        session("w", "main", 8, "calm"),
      ],
      (_repo, branch) => (branch ? marks[branch] : undefined),
    );
    expect(rows.map((row) => [row.session.id, row.pr.number])).toEqual([
      ["o-new", 3],
      ["w", 4],
      ["d", 2],
      ["m", 1],
    ]);
  });
});

describe("signedDelta", () => {
  it("signs the difference", () => {
    expect(signedDelta(3)).toBe("+3");
    expect(signedDelta(-2)).toBe("−2");
  });
});

describe("mergeSides", () => {
  const ids = (list: { sessionId: string }[]) => list.map((s) => s.sessionId);

  it("counts a session on both sides once, as the shown side has it", () => {
    const shown = [{ sessionId: "a", archived: true }, { sessionId: "b", archived: false }];
    const merged = mergeSides(shown, [{ sessionId: "a", archived: false }, { sessionId: "c", archived: true }]);
    expect(ids(merged)).toEqual(["a", "b", "c"]);
    expect(merged[0].archived).toBe(true);
  });

  it("keeps the shown list's identity with nothing to add", () => {
    const shown = [{ sessionId: "a" }];
    expect(mergeSides(shown, [])).toBe(shown);
    expect(mergeSides(shown, [{ sessionId: "a" }])).toBe(shown);
  });
});

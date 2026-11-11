import { sessionBranch } from "@/lib/pr";
import type { PrMark, SessionIndexItem } from "@/types/events";

/// The figures the new-task home draws, all read off the session index. Days
/// are **local calendar days** and weeks start on Monday, so a session started
/// at 11pm counts for the day the reader was sitting in.

const DAY_MS = 86_400_000;

/// Weeks the heatmap covers: half a year, which fills a half-width card at a
/// cell size that still reads as a square.
export const HEATMAP_WEEKS = 26;

export type DayCell = {
  /// Local midnight.
  date: Date;
  count: number;
  /// 0 for none, then 1–4 against the busiest day shown.
  level: 0 | 1 | 2 | 3 | 4;
  /// After today — drawn as a gap, since the last column is the current week.
  future: boolean;
};

export type Heatmap = {
  /// One array per week, Monday first, oldest week first.
  weeks: DayCell[][];
  total: number;
  activeDays: number;
};

function startOfDay(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate());
}

/// Monday of the week `at` falls in.
function startOfWeek(at: Date): Date {
  const day = startOfDay(at);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
}

/// Calendar days between two local midnights. Rounded, since a DST change
/// makes one of them 23 or 25 hours long.
function dayIndex(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

function addDays(at: Date, days: number): Date {
  const next = new Date(at);
  next.setDate(next.getDate() + days);
  return next;
}

/// Sessions started per day over the last `weeks` weeks, the current one last.
export function buildHeatmap(
  sessions: Pick<SessionIndexItem, "created">[],
  now: Date,
  weeks = HEATMAP_WEEKS,
): Heatmap {
  const today = startOfDay(now);
  const first = addDays(startOfWeek(now), -(weeks - 1) * 7);
  const counts = new Array<number>(weeks * 7).fill(0);

  for (const session of sessions) {
    const at = Date.parse(session.created);
    if (Number.isNaN(at)) continue;
    const index = dayIndex(first, startOfDay(new Date(at)));
    if (index >= 0 && index < counts.length) counts[index] += 1;
  }

  const max = Math.max(...counts);
  const cells = counts.map((count, index): DayCell => {
    const date = addDays(first, index);
    return {
      date,
      count,
      level: count === 0 ? 0 : (Math.ceil((count / max) * 4) as DayCell["level"]),
      future: date > today,
    };
  });

  return {
    weeks: Array.from({ length: weeks }, (_, week) => cells.slice(week * 7, week * 7 + 7)),
    total: counts.reduce((sum, count) => sum + count, 0),
    activeDays: counts.filter((count) => count > 0).length,
  };
}

export type WeekStats = {
  /// Monday to Sunday of this week; days after today hold 0.
  days: number[];
  /// 0 for Monday.
  todayIndex: number;
  sessions: number;
  projects: number;
  /// Against last week **up to the same weekday**: a Wednesday compared with a
  /// whole week reads as a collapse every Wednesday.
  sessionsDelta: number;
  projectsDelta: number;
};

/// This week's sessions and the projects they ran in, beside last week's.
export function buildWeekStats(
  sessions: Pick<SessionIndexItem, "created" | "projectPath">[],
  now: Date,
): WeekStats {
  const monday = startOfWeek(now);
  const todayIndex = dayIndex(monday, startOfDay(now));
  const days = new Array<number>(7).fill(0);
  const projects = new Set<string>();
  const lastProjects = new Set<string>();
  let last = 0;

  for (const session of sessions) {
    const at = Date.parse(session.created);
    if (Number.isNaN(at)) continue;
    const index = dayIndex(monday, startOfDay(new Date(at)));
    if (index >= 0 && index <= todayIndex) {
      days[index] += 1;
      projects.add(session.projectPath);
    } else if (index >= -7 && index <= todayIndex - 7) {
      last += 1;
      lastProjects.add(session.projectPath);
    }
  }

  const count = days.reduce((sum, day) => sum + day, 0);
  return {
    days,
    todayIndex,
    sessions: count,
    projects: projects.size,
    sessionsDelta: count - last,
    projectsDelta: projects.size - lastProjects.size,
  };
}

/// The newest sessions by last activity. A crew member hidden under its parent
/// has no row in the sidebar and gets none here either.
export function recentSessions<T extends Pick<SessionIndexItem, "modified" | "hidden">>(
  sessions: T[],
  limit: number,
): T[] {
  return sessions
    .filter((session) => !session.hidden)
    .sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified))
    .slice(0, limit);
}

export type HomePr<T> = { session: T; pr: PrMark };

type PrSession = Pick<
  SessionIndexItem,
  "projectPath" | "branch" | "worktreeName" | "worktreeRemoved" | "modified"
>;

/// The pull requests on these sessions' branches, one row per PR: open ones
/// first, then drafts, then merged, newest session first inside each. Two
/// sessions on one branch share a PR, and the most recently touched names it.
export function sessionPrs<T extends PrSession>(
  sessions: T[],
  prFor: (repoPath: string, branch: string | null) => PrMark | undefined,
): HomePr<T>[] {
  const rank = (pr: PrMark) => (pr.state !== "OPEN" ? 2 : pr.isDraft ? 1 : 0);
  const seen = new Set<string>();
  const rows: HomePr<T>[] = [];

  const newestFirst = [...sessions].sort(
    (a, b) => Date.parse(b.modified) - Date.parse(a.modified),
  );
  for (const session of newestFirst) {
    const pr = prFor(session.projectPath, sessionBranch(session));
    if (!pr) continue;
    const key = `${session.projectPath}\n${pr.number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ session, pr });
  }

  // Stable, so the newest-first order survives inside each rank.
  return rows.sort((a, b) => rank(a.pr) - rank(b.pr));
}

/// "+3", "−2" or "same" — a delta against last week, signed in words.
export function deltaLabel(delta: number): string {
  if (delta === 0) return "same as last week";
  return `${delta > 0 ? "+" : "−"}${Math.abs(delta)} vs last week`;
}

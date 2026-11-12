import { useMemo, useState, type ReactNode } from "react";
import {
  CalendarDays,
  ChartNoAxesColumn,
  Gauge,
  GitPullRequest,
  History,
  type LucideIcon,
} from "lucide-react";

import AgentIcon from "@/components/AgentIcon";
import Orb from "@/components/Orb";
import PrStateIcon from "@/components/PrStateIcon";
import { useSubscriptionUsage } from "@/hooks/useSubscriptionUsage";
import { basename, relativeTime } from "@/lib/format";
import {
  buildHeatmap,
  buildWeekStats,
  compactTokens,
  recentSessions,
  sessionPrs,
  signedDelta,
  type DayCell,
} from "@/lib/home";
import {
  combinedRemaining,
  PROVIDERS,
  resetLabel,
  subscriptionRemaining,
  usageColor,
} from "@/lib/subscriptionUsage";
import { cn } from "@/lib/utils";
import type { PrMark, SessionIndexItem, SessionStatus } from "@/types/events";

type HomeCardsProps = {
  /// The sessions in scope, active and settled both: narrowed by the profile
  /// and the project filter as the sidebar is, but never by which side it lists.
  sessions: SessionIndexItem[];
  statusBySession: Record<string, SessionStatus | undefined>;
  /// Sessions waiting on an answer from the reader.
  asking?: ReadonlySet<string>;
  prFor: (repoPath: string, branch: string | null) => PrMark | undefined;
  onOpenSession: (sessionId: string) => void;
};

const RECENT_ROWS = 4;
const PR_ROWS = 3;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/// The cards under the new-task composer: what has been going on, and the ways
/// back into it. Every figure is read off what the app already holds — the
/// session index, the sidebar's PR marks and subscription usage — so the page
/// costs no read of its own beyond the usage poll and `App`'s read of the
/// index's other side.
///
/// Drawn with no sessions in scope too, each card in its empty state: a
/// profile or project with nothing in it is still the same page, and hiding
/// the cards there read as the page being broken for that one scope.
export default function HomeCards({
  sessions,
  statusBySession,
  asking,
  prFor,
  onOpenSession,
}: HomeCardsProps) {
  // The calendar day is a dependency so a page left open past midnight moves on.
  const today = new Date().toDateString();
  const heatmap = useMemo(() => buildHeatmap(sessions, new Date()), [sessions, today]);
  const week = useMemo(() => buildWeekStats(sessions, new Date()), [sessions, today]);

  // Settled and set-aside sessions are history: counted above, not offered as
  // somewhere to go back to.
  const live = useMemo(() => sessions.filter((s) => !s.archived && !s.aside), [sessions]);
  const recent = useMemo(() => recentSessions(live, RECENT_ROWS), [live]);
  const prs = useMemo(() => sessionPrs(live, prFor), [live, prFor]);

  return (
    // A container, so the grid follows the column it is given rather than the
    // window: the sidebar and a peeked panel both take width from it.
    <div className="@container mx-auto w-full max-w-5xl px-4">
      <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-12">
        <Card icon={CalendarDays} title="Activity" className="col-span-2 @3xl:col-span-6">
          <ActivityHeatmap {...heatmap} />
        </Card>

        <Card icon={History} title="Recent sessions" className="col-span-2 @3xl:col-span-6">
          {recent.length ? (
            <ul className="px-1.5 pb-1.5">
              {recent.map((session) => (
                <li key={session.sessionId}>
                  <Row
                    onClick={() => onOpenSession(session.sessionId)}
                    mark={
                      <StatusMark
                        status={statusBySession[session.sessionId] ?? session.status}
                        asking={asking?.has(session.sessionId) ?? false}
                      />
                    }
                    title={session.title}
                    meta={`${basename(session.projectPath)} · ${relativeTime(session.modified)}`}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <Empty>{sessions.length ? "No open sessions." : "No sessions yet."}</Empty>
          )}
        </Card>

        <Card icon={Gauge} title="Usage" className="@3xl:col-span-3">
          <UsageRecap />
        </Card>

        {/* Last on a narrow column so the two short cards share a row. */}
        <Card
          icon={GitPullRequest}
          title="Pull requests"
          className="order-last col-span-2 @3xl:order-none @3xl:col-span-6"
        >
          {prs.length ? (
            <>
              <ul className="px-1.5">
                {prs.slice(0, PR_ROWS).map(({ session, pr }) => (
                  <li key={`${session.projectPath}#${pr.number}`}>
                    <Row
                      onClick={() => onOpenSession(session.sessionId)}
                      mark={<PrStateIcon pr={pr} strokeWidth={1.5} />}
                      title={session.title}
                      meta={[`#${pr.number}`, basename(session.projectPath), checksLabel(pr)]
                        .filter(Boolean)
                        .join(" · ")}
                    />
                  </li>
                ))}
              </ul>
              <p className="px-4 pt-1 pb-3 text-xs text-muted-foreground">
                {prs.length > PR_ROWS ? `${prs.length - PR_ROWS} more` : " "}
              </p>
            </>
          ) : (
            <Empty>
              {live.length ? "No pull requests on these sessions' branches." : "No pull requests yet."}
            </Empty>
          )}
        </Card>

        <Card icon={ChartNoAxesColumn} title="This week" className="@3xl:col-span-3">
          <WeekActivity {...week} />
        </Card>
      </div>
    </div>
  );
}

/// One card: `--card`'s veil, since these sit in the page rather than float
/// over it, and the light-mode shadow that goes with that.
function Card({
  icon: Icon,
  title,
  className,
  children,
}: {
  icon: LucideIcon;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        "flex min-w-0 flex-col rounded-xl border border-hairline bg-card shadow-(--shadow-card)",
        className,
      )}
    >
      <h2 className="flex items-center gap-2 px-4 pt-3 pb-2 text-ui font-normal text-muted-foreground">
        <Icon className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
        {title}
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 pb-4 text-ui text-muted-foreground/70">{children}</p>;
}

/// A row that opens a session. Inset 6px from the card so its 8px corner is
/// concentric with the card's 14px one.
function Row({
  onClick,
  mark,
  title,
  meta,
}: {
  onClick: () => void;
  mark: ReactNode;
  title: string;
  meta: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left outline-none hover:bg-sidebar-accent/50 focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <span className="flex size-4 shrink-0 items-center justify-center">{mark}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui" title={title}>
          {title}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{meta}</span>
      </span>
    </button>
  );
}

/// The sidebar rail's own vocabulary: yellow waits on the reader, the orb is a
/// turn running, green is finished and unread.
function StatusMark({ status, asking }: { status: SessionStatus; asking: boolean }) {
  if (asking)
    return <span className="size-1.5 rounded-full bg-accent-command" aria-label="Needs an answer" />;
  if (status === "in_progress") return <Orb state="working" label="Working" />;
  if (status === "completed")
    return <span className="size-1.5 rounded-full bg-accent-add" aria-label="Done, unread" />;
  return <span className="size-1.5 rounded-full bg-foreground/20" aria-hidden />;
}

function checksLabel(pr: PrMark): string | null {
  if (pr.state !== "OPEN") return null;
  if (pr.checksState === "FAILING") return "checks failing";
  if (pr.checksState === "RUNNING") return "checks running";
  return null;
}

const LEVELS = [
  "bg-foreground/[0.07]",
  "bg-primary/25",
  "bg-primary/45",
  "bg-primary/70",
  "bg-primary",
] as const;

const DAY_FORMAT: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };

function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

/// Sessions started per day, a column per week.
///
/// The hovered day is read out in the footer rather than in a tooltip: 182
/// cells would each mount one, and the line under the grid is where the eye
/// already goes for the totals.
function ActivityHeatmap({
  weeks,
  total,
  activeDays,
  tokens,
}: {
  weeks: DayCell[][];
  total: number;
  activeDays: number;
  tokens: number;
}) {
  const [hovered, setHovered] = useState<DayCell | null>(null);
  const first = weeks[0][0].date;
  const last = weeks[weeks.length - 1][6].date;
  const month = (date: Date) => date.toLocaleDateString(undefined, { month: "short" });
  // Nothing counted reads as nothing said: Codex reports no spend, and a
  // "0 tokens" beside its sessions would state a figure nobody measured.
  const spent = (count: number) => (count > 0 ? ` · ${compactTokens(count)} tokens` : "");
  const summary = `${plural(total, "session")} · ${plural(activeDays, "active day")}${spent(tokens)}`;

  return (
    <div className="flex flex-1 flex-col justify-between gap-2.5 px-4 pb-3">
      <div
        role="img"
        aria-label={`${summary} in the last ${weeks.length} weeks`}
        className="grid grid-flow-col grid-rows-7 gap-[3px]"
        style={{ gridAutoColumns: "minmax(0, 1fr)" }}
        onPointerLeave={() => setHovered(null)}
      >
        {weeks.flat().map((cell) => (
          <span
            key={cell.date.getTime()}
            onPointerEnter={() => setHovered(cell.future ? null : cell)}
            className={cn(
              "aspect-square rounded-[3px]",
              cell.future ? "bg-transparent" : LEVELS[cell.level],
              hovered === cell && "outline outline-1 outline-foreground/50",
            )}
          />
        ))}
      </div>

      <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground tabular-nums">
        <span className="truncate">
          {hovered
            ? `${hovered.date.toLocaleDateString(undefined, DAY_FORMAT)} · ${plural(hovered.count, "session")}${spent(hovered.tokens)}`
            : summary}
        </span>
        <span className="shrink-0">
          {month(first)} – {month(last)}
        </span>
      </div>
    </div>
  );
}

/// What is left on each subscription. The rail's ring has the detail; this is
/// the same reading at a glance, so it draws no controls of its own.
function UsageRecap() {
  const { rows, loading, error, now } = useSubscriptionUsage();
  const { percent, count } = combinedRemaining(error ? [] : rows, now);
  const shown = percent === null ? null : Math.floor(percent);

  // The soonest reset among the windows that have one.
  const resets = rows
    .flatMap((row) => row.windows.map((window) => window.resetsAt))
    .filter((reset): reset is string => !!reset && Date.parse(reset) > now)
    .sort((a, b) => Date.parse(a) - Date.parse(b));

  return (
    <div className="flex flex-1 flex-col justify-between gap-3 px-4 pb-3" aria-busy={loading}>
      <div>
        <p className={cn("text-2xl font-medium tracking-tight tabular-nums", usageColor(percent))}>
          {shown === null ? "—" : `${shown}%`}
        </p>
        <p className="text-xs text-muted-foreground">
          {shown !== null
            ? `remaining across ${count} ${count === 1 ? "subscription" : "subscriptions"}`
            : loading && !rows.length
              ? "Checking subscriptions…"
              : "Usage unavailable"}
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {PROVIDERS.map(({ harness, label }) => {
          const row = rows.find((r) => r.harness === harness);
          const remaining = row && !error ? subscriptionRemaining(row, now) : null;
          return (
            <li key={harness} className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-xs">
                <AgentIcon harness={harness} className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{label}</span>
                <span className={cn("tabular-nums", usageColor(remaining))}>
                  {remaining === null ? "—" : `${Math.floor(remaining)}%`}
                </span>
              </div>
              <div
                role="meter"
                aria-label={`${label} remaining`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={remaining ?? undefined}
                className="h-1 overflow-hidden rounded-full bg-foreground/10"
              >
                {remaining !== null && (
                  <div
                    className={cn("h-full rounded-full bg-current", usageColor(remaining))}
                    style={{ width: `${remaining}%` }}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="truncate text-xs text-muted-foreground">
        {resets.length ? resetLabel(resets[0], now, "Updates") : " "}
      </p>
    </div>
  );
}

/// This week beside last week through the same weekday, over a bar per day.
function WeekActivity({
  days,
  todayIndex,
  sessions,
  projects,
  sessionsDelta,
  projectsDelta,
}: {
  days: number[];
  todayIndex: number;
  sessions: number;
  projects: number;
  sessionsDelta: number;
  projectsDelta: number;
}) {
  const max = Math.max(...days, 1);

  return (
    <div className="flex flex-1 flex-col justify-between gap-3 px-4 pb-3">
      <div
        role="img"
        aria-label={`Sessions per day: ${days
          .slice(0, todayIndex + 1)
          .map((count, i) => `${WEEKDAYS[i]} ${count}`)
          .join(", ")}`}
        className="flex gap-1.5"
      >
        {days.map((count, i) => (
          <div key={WEEKDAYS[i]} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <div className="flex h-10 w-full items-end">
              <div
                className={cn(
                  "min-h-0.5 w-full rounded-[3px]",
                  count === 0
                    ? i > todayIndex
                      ? "bg-foreground/[0.04]"
                      : "bg-foreground/10"
                    : i === todayIndex
                      ? "bg-primary"
                      : "bg-primary/45",
                )}
                style={{ height: `${(count / max) * 100}%` }}
              />
            </div>
            <span
              className={cn(
                "text-[0.625rem] leading-none",
                i === todayIndex ? "text-foreground" : "text-muted-foreground/70",
              )}
            >
              {WEEKDAYS[i][0]}
            </span>
          </div>
        ))}
      </div>

      <dl className="flex flex-col gap-2">
        <Stat label="Sessions" value={sessions} delta={sessionsDelta} />
        <Stat label="Projects" value={projects} delta={projectsDelta} />
      </dl>
    </div>
  );
}

/// The delta is drawn as a diff draws a line: green up, red down, in the pair
/// the transcript's own diffs use. No change is said in words and left muted.
function Stat({ label, value, delta }: { label: string; value: number; delta: number }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex items-baseline gap-2">
        <span className="text-lg leading-tight font-medium tabular-nums">{value}</span>
        <span className="truncate text-xs text-muted-foreground tabular-nums">
          {delta === 0 ? (
            "same as last week"
          ) : (
            <>
              <span className={delta > 0 ? "text-accent-add" : "text-destructive"}>
                {signedDelta(delta)}
              </span>{" "}
              vs last week
            </>
          )}
        </span>
      </dd>
    </div>
  );
}

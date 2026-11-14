import { useState, type ReactNode } from "react";
import { CalendarDays, ChartNoAxesColumn, Gauge, GitPullRequest, History, type LucideIcon } from "lucide-react";

import { ClaudeGlyph } from "@/components/ClaudeGlyph";
import { OpenAIGlyph } from "@/components/OpenAIGlyph";
import { GrokGlyph } from "@/components/GrokGlyph";
import { cx } from "./Window";

type HomeSession = { id: string; title: string; meta: string; mark: ReactNode };

const LEVELS = ["bg-blue-500/[0.08]", "bg-blue-500/25", "bg-blue-500/45", "bg-blue-500/70", "bg-blue-500"];
const DAYS = Array.from({ length: 182 }, (_, i) => {
  const date = new Date(Date.UTC(2026, 4, 18 + i));
  const count = (i * 7 + Math.floor(i / 7) * 3) % 11;
  return { date, count, level: count === 0 ? 0 : Math.ceil(count / 2.5) };
});

/// Uses the preview's sessions so the home's shortcuts open the same conversations as the sidebar.
export function HomeCards({ recent, pullRequests, onOpen }: {
  recent: HomeSession[];
  pullRequests: HomeSession[];
  onOpen: (id: string) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const day = hovered === null ? null : DAYS[hovered];
  const total = DAYS.reduce((sum, cell) => sum + cell.count, 0);
  const activeDays = DAYS.filter((cell) => cell.count > 0).length;

  return (
    <div className="@container mx-auto w-full max-w-5xl px-4">
      <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-12">
        <Card icon={CalendarDays} title="Activity" className="col-span-2 @3xl:col-span-6">
          <div className="flex flex-1 flex-col justify-between gap-2.5 px-4 pb-3">
            <div role="img" aria-label="Session activity over the last 26 weeks" className="grid grid-flow-col grid-rows-7 gap-[3px]" style={{ gridAutoColumns: "minmax(0, 1fr)" }} onPointerLeave={() => setHovered(null)}>
              {DAYS.map((cell, i) => <span key={i} onPointerEnter={() => setHovered(i)} className={cx("aspect-square rounded-[4px]", LEVELS[cell.level], hovered === i && "outline outline-1 outline-foreground/50")} />)}
            </div>
            <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground tabular-nums">
              <span className="truncate">{day ? `${day.date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} · ${day.count} sessions` : `${total} sessions · ${activeDays} active days · 8.2M tokens`}</span>
              <span className="shrink-0">May – Nov</span>
            </div>
          </div>
        </Card>
        <Card icon={History} title="Recent sessions" className="col-span-2 @3xl:col-span-6">
          <Rows sessions={recent} onOpen={onOpen} />
        </Card>
        <Card icon={Gauge} title="Usage" className="@3xl:col-span-3">
          <div className="flex flex-1 flex-col justify-between gap-3 px-4 pb-3">
            <div>
              <p className="text-2xl font-medium tracking-tight text-foreground tabular-nums">74%</p>
              <p className="text-xs text-muted-foreground">remaining across 3 subscriptions</p>
            </div>
            <ul className="flex flex-col gap-2">
              {[
                { label: "Codex", icon: OpenAIGlyph, percent: 74 },
                { label: "Claude Code", icon: ClaudeGlyph, percent: 82 },
                { label: "Grok", icon: GrokGlyph, percent: 66 },
              ].map(({ label, icon: Icon, percent }) => (
                <li key={label} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 text-xs">
                    <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{label}</span>
                    <span className="text-foreground tabular-nums">{percent}%</span>
                  </div>
                  <div role="meter" aria-label={`${label} remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1 overflow-hidden rounded-full bg-foreground/10">
                    <div className="h-full rounded-full bg-foreground" style={{ width: `${percent}%` }} />
                  </div>
                </li>
              ))}
            </ul>
            <p className="truncate text-xs text-muted-foreground">Updates in 2h</p>
          </div>
        </Card>
        <Card icon={GitPullRequest} title="Pull requests" className="order-last col-span-2 @3xl:order-none @3xl:col-span-6">
          <Rows sessions={pullRequests} onOpen={onOpen} />
        </Card>
        <Card icon={ChartNoAxesColumn} title="This week" className="@3xl:col-span-3">
          <div className="flex flex-1 flex-col justify-between gap-3 px-4 pb-3">
            <div role="img" aria-label="Sessions per day: Monday 3, Tuesday 5, Wednesday 4, Thursday 7, Friday 6, Saturday 4" className="flex gap-1.5">
              {[3, 5, 4, 7, 6, 4, 0].map((count, i) => (
                <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <div className="flex h-10 w-full items-end"><div className={cx("min-h-0.5 w-full rounded-[3px]", i === 5 ? "bg-primary" : i === 6 ? "bg-foreground/[0.04]" : "bg-primary/45")} style={{ height: `${count / 7 * 100}%` }} /></div>
                  <span className={cx("text-[0.625rem] leading-none", i === 5 ? "text-foreground" : "text-muted-foreground/70")}>{["M", "T", "W", "T", "F", "S", "S"][i]}</span>
                </div>
              ))}
            </div>
            <dl className="flex flex-col gap-2">
              {[{ label: "Sessions", value: 29, delta: 5 }, { label: "Projects", value: 3, delta: 1 }].map(({ label, value, delta }) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="flex items-baseline gap-2"><span className="text-lg leading-tight font-medium tabular-nums">{value}</span><span className="truncate text-xs text-muted-foreground"><span className="text-accent-add">+{delta}</span> vs last week</span></dd>
                </div>
              ))}
            </dl>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Card({ icon: Icon, title, className, children }: { icon: LucideIcon; title: string; className?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className={cx("flex min-w-0 flex-col rounded-xl border border-hairline bg-card shadow-(--shadow-card)", className)}>
      <h2 className="flex items-center gap-2 px-4 pt-3 pb-2 text-ui font-normal text-muted-foreground"><Icon className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />{title}</h2>
      {children}
    </section>
  );
}

function Rows({ sessions, onOpen }: { sessions: HomeSession[]; onOpen: (id: string) => void }) {
  return (
    <ul className="px-1.5 pb-1.5">
      {sessions.map((session) => (
        <li key={session.id}>
          <button type="button" onClick={() => onOpen(session.id)} className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left outline-none hover:bg-sidebar-accent/50 focus-visible:ring-2 focus-visible:ring-ring/50">
            <span className="flex size-4 shrink-0 items-center justify-center">{session.mark}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-ui">{session.title}</span><span className="block truncate text-xs text-muted-foreground">{session.meta}</span></span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/// What ties a Linear issue to others: blockers, what it blocks, sub-issues,
/// and the cycle it is planned into.
///
/// The row chips, the pane's lists and the unassigned face live together
/// because they are one feature drawn at two sizes, and every one of them
/// opens a related issue the same way — through [openIssue], so ⌘-click leaves
/// for Linear here as it does on a tag.
///
/// [openIssue]: ../lib/issue.ts
import { Box } from "lucide-react";
import { useState } from "react";

import { CircleMinusGlyph12, CirclePlayOutline12, FlagOutline18 } from "@/components/icons/nucleo";
import { ISSUE_CHIP } from "@/components/IssueLabelChip";
import IssueStateIcon, { IssuePriorityIcon, PRIORITY_LABEL } from "@/components/IssueStateIcon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cycleReading, openIssue } from "@/lib/issue";
import { cn } from "@/lib/utils";
import type { IssueCycle, RelatedIssue, SubIssues } from "@/types/events";

type Direction = "blockedBy" | "blocking";

const WORDS: Record<Direction, string> = { blockedBy: "Blocked by", blocking: "Blocking" };

function DirectionIcon({ direction }: { direction: Direction }) {
  return direction === "blockedBy" ? (
    <CircleMinusGlyph12 className="size-3 shrink-0 text-destructive" />
  ) : (
    <FlagOutline18 className="size-3.5 shrink-0 text-destructive" />
  );
}

/// A relation still in force. A blocker that shipped, or blocked work that was
/// dropped, is history rather than something standing in the way — Linear's
/// own row stops counting it too. The pane still lists every one.
function live(issue: RelatedIssue): boolean {
  return issue.state.kind !== "completed" && issue.state.kind !== "canceled";
}

/// Blocked-by or blocking, as a count on a row.
///
/// Hover answers "by what" without a click: one issue draws its card, several
/// draw a count sentence, since a stack of cards is a list and the menu is
/// where lists go. A click opens that list either way, and a pick opens the
/// issue in the pane. A `span` for the reason `GlyphMenu`'s trigger is one:
/// the row is a `role="button"` and cannot hold a real button. Clicks are
/// stopped on trigger and content alike, since a portal bubbles through the
/// React tree into the row's own `onClick`.
export function RelationChip({
  direction,
  issues,
  className,
}: {
  direction: Direction;
  issues: RelatedIssue[];
  className?: string;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const open = issues.filter(live);
  if (open.length === 0) return null;

  const words = WORDS[direction];
  const summary = `${words} ${open.length} ${open.length === 1 ? "issue" : "issues"}`;

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      {/* No hover card while the menu is up: it would sit over the list it
          summarises. */}
      <Tooltip delayDuration={300} open={menuOpen ? false : undefined}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <span
              role="button"
              tabIndex={0}
              aria-label={summary}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                ISSUE_CHIP,
                "inline-flex gap-1 tabular-nums transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                className,
              )}
            >
              <DirectionIcon direction={direction} />
              {open.length}
            </span>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        {open.length === 1 ? (
          <TooltipContent side="bottom" align="end" className="block w-max max-w-md p-0">
            <RelatedCard words={words} issue={open[0]} />
          </TooltipContent>
        ) : (
          <TooltipContent side="bottom">{summary}</TooltipContent>
        )}
      </Tooltip>

      <DropdownMenuContent
        align="end"
        className="w-96"
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenuLabel>{words}</DropdownMenuLabel>
        {open.map((issue) => (
          <DropdownMenuItem
            key={issue.id}
            // `onClick` rather than `onSelect`: it carries the modifier that
            // sends ⌘-click to Linear, and Radix turns Enter into a click too.
            onClick={(e) => openIssue(issue, e)}
          >
            <RelatedLine issue={issue} />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/// Status, identifier, title and priority on one line — a menu row and a pane
/// row are the same reading.
function RelatedLine({ issue }: { issue: RelatedIssue }) {
  return (
    <>
      <IssueStateIcon kind={issue.state.kind} color={issue.state.color} label={issue.state.name} />
      <span className="shrink-0 text-muted-foreground tabular-nums">{issue.identifier}</span>
      <span className="min-w-0 flex-1 truncate">{issue.title}</span>
      <IssuePriorityIcon priority={issue.priority} />
    </>
  );
}

/// Linear's hover card for a single related issue.
function RelatedCard({ words, issue }: { words: string; issue: RelatedIssue }) {
  return (
    <div className="flex flex-col text-ui">
      <div className="flex flex-col gap-1 px-3 pt-2.5 pb-2">
        <span className="text-xs text-muted-foreground">
          {words} {issue.identifier}
        </span>
        <span className="line-clamp-2 text-foreground">{issue.title}</span>
      </div>
      <div className="flex items-center gap-3 border-t border-border px-3 py-2 whitespace-nowrap text-muted-foreground">
        <span className="flex shrink-0 items-center gap-1.5">
          <IssueStateIcon kind={issue.state.kind} color={issue.state.color} />
          {issue.state.name}
        </span>
        {issue.project && (
          <span className="flex min-w-0 items-center gap-1.5">
            <Box className="size-3.5 shrink-0" />
            <span className="truncate">{issue.project}</span>
          </span>
        )}
        {issue.priority !== "none" && (
          <span className="flex shrink-0 items-center gap-1.5">
            <IssuePriorityIcon priority={issue.priority} />
            {PRIORITY_LABEL[issue.priority]}
          </span>
        )}
      </div>
    </div>
  );
}

/// Sub-issue progress, finished over total, beside a ring filled to match.
export function SubIssuesChip({ subIssues, className }: { subIssues: SubIssues; className?: string }) {
  if (subIssues.total === 0) return null;
  const { done, total } = subIssues;

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <span className={cn(ISSUE_CHIP, "inline-flex gap-1 tabular-nums", className)}>
          <ProgressRing fraction={done / total} />
          {done}/{total}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {done} of {total} sub-issues done
      </TooltipContent>
    </Tooltip>
  );
}

/// The cycle an issue is planned into, as its number alone — the tooltip says
/// the rest: the cycle's name, its phase and its dates.
export function CycleChip({ cycle, className }: { cycle: IssueCycle; className?: string }) {
  const { label, phase } = cycleReading(cycle, Date.now());
  const dates = `${monthDay(cycle.startsAt)} – ${monthDay(cycle.endsAt)}`;

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <span className={cn(ISSUE_CHIP, "inline-flex gap-1 tabular-nums", className)}>
          <CirclePlayOutline12 className="size-3 shrink-0" />
          {cycle.number}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label} · {phase} · {dates}
      </TooltipContent>
    </Tooltip>
  );
}

function monthDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ProgressRing({ fraction }: { fraction: number }) {
  const r = 5;
  const length = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 14 14" className="size-3.5 shrink-0 -rotate-90" aria-hidden>
      <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeOpacity={0.35} strokeWidth="1.5" />
      <circle
        cx="7"
        cy="7"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray={`${length * fraction} ${length}`}
      />
    </svg>
  );
}

/// Linear's face for nobody: a dashed ring round a head and shoulders, the
/// same size as `Avatar` so an assigned row and an unassigned one line up.
export function UnassignedAvatar({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      role="img"
      aria-label="Unassigned"
      className={cn("size-4 shrink-0 text-muted-foreground", className)}
    >
      <circle cx="8" cy="8" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.1" strokeDasharray="2 1.6" />
      <circle cx="8" cy="6.4" r="2.1" fill="currentColor" />
      <path d="M4.4 11.6c.7-1.5 2-2.3 3.6-2.3s2.9.8 3.6 2.3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/// The pane's Blocked by / Blocking list, every relation kept — settled ones
/// included, since the pane is where the reader checks what *was* in the way.
export function RelationList({ direction, issues }: { direction: Direction; issues: RelatedIssue[] }) {
  if (issues.length === 0) return null;

  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1.5 pb-0.5 text-ui text-muted-foreground">
        <DirectionIcon direction={direction} />
        {WORDS[direction]}
      </span>
      {issues.map((issue) => (
        <button
          key={issue.id}
          type="button"
          onClick={(e) => openIssue(issue, e)}
          className="-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-ui transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <RelatedLine issue={issue} />
        </button>
      ))}
    </div>
  );
}

import { useId, useState } from "react";
import { Popover } from "radix-ui";
import { RefreshCw, X } from "lucide-react";
import { Cog6ToothIcon } from "@heroicons/react/16/solid";

import AgentIcon from "@/components/AgentIcon";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSubscriptionUsage } from "@/hooks/useSubscriptionUsage";
import { combinedRemaining, resetLabel, subscriptionRemaining } from "@/lib/subscriptionUsage";
import { cn } from "@/lib/utils";
import type { Harness, SubscriptionUsage } from "@/types/events";

const PROVIDERS: { harness: Harness; label: string }[] = [
  { harness: "codex", label: "Codex" },
  { harness: "claude_code", label: "Claude Code" },
  { harness: "grok", label: "Grok" },
];

function usageColor(percent: number | null): string {
  return percent !== null && percent <= 10 ? "text-destructive" : percent !== null && percent <= 25 ? "text-accent-command" : "text-foreground";
}

function UsageRing({ percent, partial, className }: { percent: number | null; partial: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-5 shrink-0", className)} fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" opacity="0.18" />
      <circle
        cx="12" cy="12" r="9" pathLength="100" stroke="currentColor" strokeWidth="1.7"
        strokeLinecap="round" strokeDasharray={percent === null ? "3 5" : "100"}
        strokeDashoffset={percent === null ? 0 : 100 - percent}
        transform="rotate(-90 12 12)" opacity={percent === null ? 0.5 : percent === 0 ? 0 : 1}
      />
      <path d="m12 8 4 4-4 4-4-4z" fill="currentColor" opacity="0.5" />
      {partial && <circle cx="19.5" cy="19.5" r="2" fill="currentColor" />}
    </svg>
  );
}

function ProviderUsage({ harness, label, row, loading, failed, now }: {
  harness: Harness; label: string; row?: SubscriptionUsage; loading: boolean; failed: boolean; now: number;
}) {
  const remaining = row ? subscriptionRemaining(row, now) : null;
  const stale = Boolean(row && !row.unavailableReason && row.windows.length && (failed || remaining === null));
  return (
    <section className="flex flex-col gap-3 px-4 py-4" aria-label={`${label} usage`}>
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true"><AgentIcon harness={harness} className="size-4 text-muted-foreground" /></span>
        <span className="flex-1 text-ui font-medium">{label}</span>
        {row?.plan && <span className="text-xs text-muted-foreground capitalize">{row.plan.replaceAll("_", " ")}</span>}
      </div>
      {row?.windows.length ? (
        <div className="flex flex-col gap-3">
          {row.windows.map((window) => (
            <div key={window.label} className={cn("flex flex-col gap-1.5", stale && "opacity-50")}>
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="text-muted-foreground">{window.label}</span>
                <span className={cn("tabular-nums", usageColor(window.remainingPercent))}>
                  {Math.floor(window.remainingPercent)}% remaining
                </span>
              </div>
              <div role="meter" aria-label={`${label} ${window.label} remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={window.remainingPercent} className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
                <div className={cn("h-full origin-left rounded-full bg-current", usageColor(window.remainingPercent))} style={{ width: `${window.remainingPercent}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">{resetLabel(window.resetsAt, now)}</p>
            </div>
          ))}
          {stale && <p className="text-xs text-accent-command">Last known usage · refresh for current limits</p>}
        </div>
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {row?.unavailableReason ?? (loading ? "Checking subscription…" : "Usage unavailable. Refresh to try again.")}
        </p>
      )}
    </section>
  );
}

/// Account usage lives beside Settings because it spans projects and conversations.
export default function SubscriptionUsageButton({ onAccounts }: { onAccounts: () => void }) {
  const { rows, loading, error, now, refresh } = useSubscriptionUsage();
  const [open, setOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const heading = useId();
  const { percent, count } = combinedRemaining(error ? [] : rows, now);
  const shown = percent === null ? null : Math.floor(percent);
  const summary = shown === null ? "Subscription usage unavailable" : `${shown}% remaining across ${count} ${count === 1 ? "subscription" : "subscriptions"}`;

  return (
    <Popover.Root open={open} onOpenChange={(next) => { setOpen(next); if (next) void refresh(); }}>
      <Tooltip open={!open && tooltipOpen} onOpenChange={setTooltipOpen}>
        <TooltipTrigger asChild>
          <Popover.Trigger asChild>
            <Button
              variant="ghost" size="icon-sm" aria-label={`Subscription usage: ${summary}`}
              className={cn("transition-[color,background-color] duration-150 ease-out", shown === null ? "text-muted-foreground" : usageColor(percent))}
            >
              <UsageRing percent={percent} partial={count > 0 && count < 3} />
            </Button>
          </Popover.Trigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{loading && !rows.length ? "Checking subscription usage…" : `Combined • ${shown === null ? "—" : `${shown}%`}`}</TooltipContent>
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          align="start" side="bottom" sideOffset={10} collisionPadding={12}
          aria-labelledby={heading}
          className="z-50 flex max-h-(--radix-popover-content-available-height) w-80 max-w-[calc(100vw-24px)] origin-(--radix-popover-content-transform-origin) flex-col overflow-y-auto rounded-xl border border-border bg-popover text-popover-foreground shadow-md outline-none backdrop-blur-xl"
        >
          <div className="flex items-center justify-between gap-3 px-4 pt-4">
            <h2 id={heading} className="text-ui font-medium">Subscription usage</h2>
            <div className="-mr-1 -mt-1 flex items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-xs" aria-label="Refresh usage" disabled={loading} onClick={() => void refresh(true)} className="text-muted-foreground">
                    <RefreshCw className={cn("size-3.5", loading && "animate-spin motion-reduce:animate-none")} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Refresh usage</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-xs" aria-label="Account settings" onClick={() => { setOpen(false); onAccounts(); }} className="text-muted-foreground">
                    <Cog6ToothIcon className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Account settings</TooltipContent>
              </Tooltip>
              <Popover.Close asChild>
                <Button variant="ghost" size="icon-xs" aria-label="Close usage" className="text-muted-foreground"><X className="size-3.5" /></Button>
              </Popover.Close>
            </div>
          </div>
          <div className="px-4 pt-4" aria-live="polite" aria-busy={loading}>
            <div className="flex items-center gap-2">
              <span className={usageColor(percent)}><UsageRing percent={percent} partial={count > 0 && count < 3} className="size-7" /></span>
              <div className="flex items-baseline gap-2">
                <span className={cn("text-2xl font-medium tabular-nums tracking-tight", usageColor(percent))}>{shown === null ? "—" : `${shown}%`}</span>
                <span className="text-xs text-muted-foreground">{shown === null ? "No current usage" : "combined remaining"}</span>
              </div>
            </div>
            {count > 0 && count < 3 && <p className="mt-1.5 text-xs text-accent-command">{3 - count} {count === 2 ? "subscription excluded" : "subscriptions excluded"} · usage unavailable</p>}
            {error && <p role="alert" className="mt-2 text-xs text-destructive">Couldn't refresh usage. Check your connection and try again.</p>}
          </div>
          <div className="mt-1 divide-y divide-border/60">
            {PROVIDERS.map((provider) => <ProviderUsage key={provider.harness} {...provider} row={rows.find((row) => row.harness === provider.harness)} loading={loading} failed={error} now={now} />)}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

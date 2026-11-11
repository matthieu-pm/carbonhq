import type { Harness, SubscriptionUsage } from "@/types/events";

export const USAGE_FRESH_MS = 2 * 60_000;

/// The agents whose subscriptions report usage, in the order they are listed.
export const PROVIDERS: { harness: Harness; label: string }[] = [
  { harness: "codex", label: "Codex" },
  { harness: "claude_code", label: "Claude Code" },
  { harness: "grok", label: "Grok" },
];

/// The text colour for a remaining share: red at 10% or under, yellow at 25%.
export function usageColor(percent: number | null): string {
  return percent !== null && percent <= 10 ? "text-destructive" : percent !== null && percent <= 25 ? "text-accent-command" : "text-foreground";
}

/// An expired window needs a new provider reading; the last value cannot predict its replacement.
export function subscriptionRemaining(row: SubscriptionUsage, now: number): number | null {
  const checked = Date.parse(row.checkedAt);
  if (row.unavailableReason || !Number.isFinite(checked) || now - checked >= USAGE_FRESH_MS || !row.windows.length) return null;
  const values: number[] = [];
  for (const window of row.windows) {
    if (!Number.isFinite(window.remainingPercent) || window.remainingPercent < 0 || window.remainingPercent > 100) return null;
    if (window.resetsAt) {
      const reset = Date.parse(window.resetsAt);
      if (!Number.isFinite(reset) || reset <= now) return null;
    }
    values.push(window.remainingPercent);
  }
  return Math.min(...values);
}

/// Equal weight per known subscription; incomparable token allowances are never added together.
export function combinedRemaining(rows: SubscriptionUsage[], now: number): { percent: number | null; count: number } {
  const values = rows.map((row) => subscriptionRemaining(row, now)).filter((value): value is number => value !== null);
  return {
    percent: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    count: values.length,
  };
}

/// `verb` is "Updates" on the home card, whose one line sits under a combined
/// figure that moves at the soonest reset without going back to full.
export function resetLabel(reset: string | null, now: number, verb = "Resets"): string {
  if (!reset) return "Reset time unavailable";
  const time = Date.parse(reset);
  if (!Number.isFinite(time)) return "Reset time unavailable";
  const minutes = Math.ceil((time - now) / 60_000);
  if (minutes <= 0) return "Reset reached · refresh usage";
  if (minutes < 60) return `${verb} in ${minutes}m`;
  if (minutes < 24 * 60) return `${verb} in ${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
  return `${verb} ${new Date(time).toLocaleDateString(undefined, {
    ...(minutes < 7 * 24 * 60 ? { weekday: "short" as const } : { month: "short" as const, day: "numeric" as const }),
    hour: "numeric", minute: "2-digit",
  })}`;
}

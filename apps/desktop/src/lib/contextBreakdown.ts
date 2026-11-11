import type { ContextBreakdown } from "@/types/events";

export type ContextRow = {
  id: string;
  name: string;
  tokens: number;
  kind: string;
  color: string;
  /// Share of the window, or `null` for deferred tools, which sit outside it.
  percent: number | null;
  /// Free space is the bar's track and deferred tools are not in the window.
  inBar: boolean;
};

// By rank, not by category: the largest slice is always blue, as in Claude
// Code's own view. Fixed hues rather than theme accents, so the bar reads the
// same on every palette; each holds on a light and a dark surface.
const RANKED = ["#4f8fe8", "#d9703c", "#4fae92", "#d9a23b"];
const REST = "#9b9b9b";
const KIND_COLORS: Record<string, string> = { buffer: "#6b6b6b", deferred: "#6b6b6b", free: "var(--muted)" };
const KIND_ORDER = ["used", "buffer", "free", "deferred"];

/// Rows in reading order: what fills the window largest first, then the
/// reserve, the room left, and last what is deferred out of it.
export function contextRows({ categories, maxTokens }: ContextBreakdown): ContextRow[] {
  const rank = (kind: string) => {
    const at = KIND_ORDER.indexOf(kind);
    return at < 0 ? 0 : at;
  };
  return categories
    .filter((category) => category.tokens > 0)
    .sort((a, b) => rank(a.kind) - rank(b.kind) || (a.kind === "used" ? b.tokens - a.tokens : 0))
    .map(({ id, name, tokens, kind }, index) => ({
      id, name, tokens, kind,
      color: KIND_COLORS[kind] ?? RANKED[index] ?? REST,
      percent: kind === "deferred" ? null : tokens / maxTokens * 100,
      inBar: kind !== "free" && kind !== "deferred",
    }));
}

export type ContextSegment = Pick<ContextRow, "id" | "name" | "tokens" | "color"> & { percent: number };

/// The bar: one block per coloured row, every grey row folded into one "Other",
/// largest first, and the reserve always last so it sits against the free space.
export function contextBar(rows: readonly ContextRow[]): ContextSegment[] {
  const segment = ({ id, name, tokens, color, percent }: ContextRow) => ({ id, name, tokens, color, percent: percent ?? 0 });
  const used = rows.filter((row) => row.kind === "used");
  const rest = used.filter((row) => row.color === REST);
  const other = rest.length > 1
    ? [{ id: "other", name: "Other", color: REST, tokens: rest.reduce((sum, row) => sum + row.tokens, 0), percent: rest.reduce((sum, row) => sum + (row.percent ?? 0), 0) }]
    : rest.map(segment);
  return [
    ...[...used.filter((row) => row.color !== REST).map(segment), ...other].sort((a, b) => b.tokens - a.tokens),
    ...rows.filter((row) => row.kind === "buffer").map(segment),
  ];
}

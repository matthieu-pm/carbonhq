import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { contextBar, contextRows } from "@/lib/contextBreakdown";
import { compactTokens } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ContextBreakdown } from "@/types/events";

/// The context window by category. Without a breakdown it is the total alone.
export default function ContextDetails({ breakdown, total }: {
  breakdown: ContextBreakdown | null;
  total: { used: number; max: number } | null;
}) {
  const used = breakdown?.usedTokens ?? total?.used ?? 0;
  const max = Math.max(1, breakdown?.maxTokens ?? total?.max ?? 0);
  const rows = breakdown ? contextRows(breakdown) : [];
  const bar = breakdown
    ? contextBar(rows)
    : [{ id: "used", name: "Used", tokens: used, color: "#4f8fe8", percent: used / max * 100 }];
  const percent = Math.round(used / max * 100);
  return (
    <div className="px-2.5 pb-1 text-xs">
      <div className="flex min-h-5 items-baseline justify-between gap-2">
        <span className="text-foreground">{percent}% used</span>
        <span className="tabular-nums text-muted-foreground">{compactTokens(used)} / {compactTokens(max)}</span>
      </div>
      {/* Taller than the bar it draws, so a 6px segment is still easy to hover. */}
      <div role="img" aria-label={`Context ${percent}% used`} className="relative flex h-3.5 gap-px">
        <span className="absolute inset-x-0 top-1 h-1.5 rounded-l-[2px] rounded-r-full bg-muted" />
        {bar.map((segment) => <Tooltip key={segment.id}>
          <TooltipTrigger asChild>
            <span className="relative flex h-full shrink-0 items-center"
              style={{ width: `${Math.min(segment.percent ?? 0, 100)}%`, minWidth: 2 }}>
              <span className={cn("h-1.5 w-full rounded-[2px]", segment.id.endsWith("_buffer") && "rounded-r-full")} style={{ background: segment.color }} />
            </span>
          </TooltipTrigger>
          <TooltipContent>{segment.name}: {compactTokens(segment.tokens)}, {Math.round(segment.percent ?? 0)}%</TooltipContent>
        </Tooltip>)}
      </div>
      {rows.length > 0 && <ul className="mt-1">
        {rows.map((row) => <li key={row.id} className="flex min-h-6 items-center gap-2.5">
          <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: row.color }} />
          <span className="min-w-0 flex-1 truncate text-muted-foreground" title={row.name}>{row.name}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">{compactTokens(row.tokens)}</span>
          <span className="w-11 shrink-0 text-right tabular-nums text-foreground/80">
            {row.percent === null ? <span className="text-muted-foreground">—</span> : `${row.percent.toFixed(1)}%`}
          </span>
        </li>)}
      </ul>}
    </div>
  );
}

import { Check, Copy, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCopied } from "@/hooks/useCopied";
import { messageTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/// Copies the message's source text so Markdown survives the rendered view.
/// Hidden until the message is hovered or the button focused, through the
/// `group/message` the caller draws.
///
/// The row keeps its height while hidden. Laid over the gap instead, it would
/// cover the first line of the reply below whenever the cursor crossed the
/// bubble.
export default function MessageActions({
  text,
  ts,
  copyLabel = "Copy message",
  tooltipAlign = "end",
}: {
  text: string;
  ts?: string;
  copyLabel?: string;
  tooltipAlign?: "start" | "end";
}) {
  const [copied, copy, failed] = useCopied<true>();
  const [open, setOpen] = useState(false);
  const [pointerOver, setPointerOver] = useState(false);
  const time = ts ? messageTime(ts) : "";
  const label = failed ? "Couldn't copy" : copied ? "Copied" : copyLabel;
  const settled = copied !== null || failed;

  return (
    // `will-change` keeps the row on its own layer for good. WebKit lifts it
    // onto one only for the fade, at a fractional offset, then repaints it
    // pixel-snapped once the fade ends, so the icon jumped a pixel after it
    // appeared.
    <div
      className={cn(
        "flex items-center gap-1 opacity-0 will-change-[opacity] transition-opacity duration-150 group-hover/message:opacity-100 focus-within:opacity-100",
        settled && "opacity-100",
      )}
    >
      {time && <span className="pr-1 text-ui text-muted-foreground tabular-nums">{time}</span>}
      {/* Radix closes a tooltip on the click that triggered it and reopens it
          only on the next pointer move, so the label vanished under a still
          cursor. The pointer and the answer both hold it open instead. */}
      <Tooltip open={open || pointerOver || settled} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            className="text-muted-foreground"
            onPointerEnter={() => setPointerOver(true)}
            onPointerLeave={() => setPointerOver(false)}
            onClick={() => void copy(text, true)}
          >
            {failed ? (
              <X className="text-destructive" />
            ) : copied ? (
              <Check />
            ) : (
              <Copy />
            )}
          </Button>
        </TooltipTrigger>
        {/* Pinned to one edge: centred, the label's width
            change between "Copy message" and "Copied" slid it sideways. */}
        <TooltipContent align={tooltipAlign}>{label}</TooltipContent>
      </Tooltip>
      <span className="sr-only" aria-live="polite">
        {settled ? label : ""}
      </span>
    </div>
  );
}

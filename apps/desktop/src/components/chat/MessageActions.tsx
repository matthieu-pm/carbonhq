import { Check, Copy, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCopied } from "@/hooks/useCopied";
import { messageTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/// The row under a sent message: when it was sent, and a button copying it.
/// Hidden until the message is hovered or the button focused, through the
/// `group/message` the caller draws.
///
/// The row keeps its height while hidden. Laid over the gap instead, it would
/// cover the first line of the reply below whenever the cursor crossed the
/// bubble.
export default function MessageActions({ text, ts }: { text: string; ts?: string }) {
  const [copied, copy, failed] = useCopied<true>();
  const [hovered, setHovered] = useState(false);
  const time = ts ? messageTime(ts) : "";
  const label = failed ? "Couldn't copy" : copied ? "Copied" : "Copy message";
  const settled = copied !== null || failed;

  return (
    <div
      className={cn(
        "flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/message:opacity-100 focus-within:opacity-100",
        settled && "opacity-100",
      )}
    >
      {time && <span className="pr-1 text-ui text-muted-foreground tabular-nums">{time}</span>}
      {/* Held open while the answer shows: Radix closes a tooltip on the
          click that triggered it, which would take "Copied" with it. */}
      <Tooltip open={hovered || settled} onOpenChange={setHovered}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            className="text-muted-foreground"
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
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <span className="sr-only" aria-live="polite">
        {settled ? label : ""}
      </span>
    </div>
  );
}

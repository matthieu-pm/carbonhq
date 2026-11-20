import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { UpdateStatus } from "@/types/events";

/// The update offer, at the rail's foot above usage. The rail is always drawn,
/// so an update found while the sidebar is collapsed is still on screen.
///
/// Shown from the moment a download starts, so the reader sees an update coming
/// rather than one appearing from nowhere; it only installs once ready.
export default function UpdateRailButton({
  status,
  blocked,
  onInstall,
}: {
  status: UpdateStatus | null;
  /// A turn is in flight somewhere, and installing relaunches the app.
  blocked: boolean;
  onInstall: () => void;
}) {
  if (!status) return null;

  const downloading = status.state === "downloading";
  const percent = downloading ? status.percent : null;
  const waiting = downloading || blocked;
  const label = downloading
    ? `Downloading v${status.version}${percent === null ? "" : ` · ${percent}%`}`
    : blocked
      ? "Waiting for the running turn to finish."
      : `Restart to update to v${status.version}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* `aria-disabled` rather than `disabled`: a disabled button fires no
            pointer events, so the tooltip saying why could never open. */}
        <Button
          size="icon"
          aria-label={label}
          aria-disabled={waiting}
          onClick={() => !waiting && onInstall()}
          className={cn(
            "relative size-9 overflow-hidden bg-accent-update text-accent-update-foreground shadow-(--shadow-button) hover:bg-accent-update-hover active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-4.5",
            "aria-disabled:cursor-default aria-disabled:hover:bg-accent-update",
            blocked && !downloading && "opacity-60",
          )}
        >
          <Download className={cn(downloading && percent === null && "animate-pulse motion-reduce:animate-none")} />
          {downloading && percent !== null && (
            <span aria-hidden className="absolute inset-x-1.5 bottom-1 h-0.5 overflow-hidden rounded-full bg-accent-update-foreground/30">
              <span className="block h-full rounded-full bg-accent-update-foreground transition-[width] duration-200 ease-out" style={{ width: `${percent}%` }} />
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

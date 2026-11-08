import type { ReactNode } from "react";
import { CircleDot } from "lucide-react";

import { FilesGlyph18, House3Glyph18 } from "@/components/icons/nucleo";

import ShortcutKeys from "@/components/ShortcutKeys";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ShortcutId } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

/// The rail's width. Every pane width that is a share of the window takes this
/// off first, since the rail is drawn whatever else is open.
export const RAIL_W = 52;

export type RailPlace = "home" | "spaces" | "issues" | "settings";

/// The always-on column at the window's left edge: where you are, and the
/// app-wide controls that belong to no list. Sits on the frame, under the
/// titlebar row, so the traffic lights keep the corner to themselves.
export default function Rail({
  place,
  spaces,
  onHome,
  onSpaces,
  onIssues,
  onHomeHover,
  peeks,
  onSpacesHover,
  spacesPeeks = false,
  footer,
}: {
  place: RailPlace;
  /// Absent while Pages is off, which drops the button rather than drawing a
  /// door to a page that refuses to open.
  spaces: boolean;
  onHome: () => void;
  onSpaces: () => void;
  onIssues: () => void;
  /// Hovering Home peeks the task sidebar where it is not docked; `false` on
  /// leave, so the card can close once the pointer is in neither.
  onHomeHover: (over: boolean) => void;
  /// Hovering Home opens the sidebar card, which its tooltip would cover.
  peeks: boolean;
  /// Hovering Spaces peeks its own sidebar while that one is collapsed.
  onSpacesHover?: (over: boolean) => void;
  spacesPeeks?: boolean;
  /// Usage and Settings, pinned to the foot.
  footer: ReactNode;
}) {
  return (
    <nav
      aria-label="Navigation"
      className="flex shrink-0 flex-col items-center gap-1 pt-1 pb-2"
      style={{ width: RAIL_W }}
    >
      <RailButton
        label="Home"
        shortcut="session.new"
        current={place === "home"}
        onClick={onHome}
        onHover={onHomeHover}
        tooltip={!peeks}
      >
        <House3Glyph18 />
      </RailButton>
      {spaces && (
        <RailButton label="Spaces" shortcut="spaces.open" current={place === "spaces"} onClick={onSpaces} onHover={onSpacesHover} tooltip={!spacesPeeks}>
          <FilesGlyph18 />
        </RailButton>
      )}
      <RailButton label="Issues" shortcut="issues.open" current={place === "issues"} onClick={onIssues}>
        <CircleDot />
      </RailButton>
      <div className="flex-1" />
      <div className="flex flex-col items-center gap-1">{footer}</div>
    </nav>
  );
}

function RailButton({
  label,
  shortcut,
  current,
  onClick,
  onHover,
  tooltip = true,
  children,
}: {
  label: string;
  shortcut: ShortcutId;
  current: boolean;
  onClick: () => void;
  onHover?: (over: boolean) => void;
  tooltip?: boolean;
  children: ReactNode;
}) {
  return (
    // `open={false}` rather than dropping the wrapper, so the button keeps its
    // place in the tree and a hover in progress survives the switch.
    <Tooltip open={tooltip ? undefined : false}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-current={current ? "page" : undefined}
          onClick={onClick}
          onPointerEnter={onHover && (() => onHover(true))}
          onPointerLeave={onHover && (() => onHover(false))}
          className={cn(
            "size-9 text-muted-foreground transition-none hover:bg-sidebar-accent/50 hover:text-foreground active:not-aria-[haspopup]:translate-y-0 dark:hover:bg-sidebar-accent/50 [&_svg:not([class*='size-'])]:size-4.5",
            current && "bg-sidebar-accent text-foreground hover:bg-sidebar-accent dark:hover:bg-sidebar-accent",
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {label}
        <ShortcutKeys ids={[shortcut]} />
      </TooltipContent>
    </Tooltip>
  );
}

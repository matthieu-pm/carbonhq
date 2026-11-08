import { ArrowLeft, ArrowRight } from "lucide-react";

import ShortcutKeys from "@/components/ShortcutKeys";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ShortcutId } from "@/lib/shortcuts";

/// Back and forward, before the sidebar toggle where a browser keeps them.
export default function NavButtons({
  canBack,
  canForward,
  onBack,
  onForward,
}: {
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
}) {
  return (
    <>
      <NavButton label="Back" shortcut="nav.back" enabled={canBack} onClick={onBack}>
        <ArrowLeft className="size-4" />
      </NavButton>
      <NavButton label="Forward" shortcut="nav.forward" enabled={canForward} onClick={onForward}>
        <ArrowRight className="size-4" />
      </NavButton>
    </>
  );
}

function NavButton({
  label,
  shortcut,
  enabled,
  onClick,
  children,
}: {
  label: string;
  shortcut: ShortcutId;
  enabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* `aria-disabled` rather than `disabled`, so the tooltip still opens
            and says which chord this is. */}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-disabled={!enabled || undefined}
          onClick={() => enabled && onClick()}
          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground active:not-aria-[haspopup]:translate-y-0 aria-disabled:opacity-40 aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-foreground dark:aria-disabled:hover:bg-transparent"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        <ShortcutKeys ids={[shortcut]} />
      </TooltipContent>
    </Tooltip>
  );
}

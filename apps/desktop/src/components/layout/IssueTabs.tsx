import type { ReactNode } from "react";
import { CircleDot, Plus } from "lucide-react";

import GitHubIcon from "@/components/GitHubIcon";
import LinearIcon from "@/components/LinearIcon";
import ShortcutKeys from "@/components/ShortcutKeys";
import { ItemTab } from "@/components/layout/ViewTabs";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDragReorder } from "@/hooks/useDragReorder";
import { useDigitHotkey, useHotkey } from "@/hooks/useHotkey";
import type { ShortcutId } from "@/lib/shortcuts";
import { readIssueTracker } from "@/lib/issueTracker";
import { cn } from "@/lib/utils";
import {
  activateIssueTab,
  addListTab,
  closeIssueTab,
  editIssueTabs,
  moveIssueTab,
  newListTabId,
  tabTitle,
  updateListTab,
  type AnyIssueTab,
  type IssueTabsState,
} from "@/lib/issueTabs";

const MARK = "size-3.5 shrink-0 text-muted-foreground";

/// The issues page's titlebar strip: list tabs and issue tabs in one row the
/// reader arranges, + at the end for another list. Lines up with the sheet the
/// way the session's view tabs do.
export default function IssueTabs({ state, alignX = 0, visible = true }: { state: IssueTabsState; alignX?: number; visible?: boolean }) {
  const { tabs, active } = state;
  const drag = useDragReorder(
    tabs,
    (tab) => tab.id,
    (tab, _delta, to) => editIssueTabs((s) => moveIssueTab(s, tab.id, to)),
    "x",
  );

  const pick = (id: string) => editIssueTabs((s) => activateIssueTab(s, id));
  const pickAt = (i: number) => drag.shown[i] && pick(drag.shown[i].id);
  useDigitHotkey("tab.pick", (slot) => pickAt(slot === 8 ? drag.shown.length - 1 : slot), { enabled: visible });
  const step = (delta: number) => {
    const at = drag.shown.findIndex((tab) => tab.id === active);
    pickAt((at + delta + drag.shown.length) % drag.shown.length);
  };
  useHotkey("tab.prev", () => step(-1), { enabled: visible });
  useHotkey("tab.next", () => step(1), { enabled: visible });

  // On the reader's latest pick, which every list's switch writes through to.
  const newList = () => editIssueTabs((s) => addListTab(s, newListTabId(), readIssueTracker()));
  const lone = tabs.length === 1;

  return (
    <div
      ref={drag.list}
      role="tablist"
      className={cn("-mx-1 min-w-0 flex-1 items-center gap-0.5 self-stretch overflow-hidden px-1", visible ? "flex" : "hidden")}
      // `ViewTabs`' own sum: start where the sheet does, from `--tabs-lead`.
      style={{
        marginLeft:
          alignX > 0 ? `max(-0.25rem, calc(${alignX}px - 0.25rem - var(--tabs-lead)))` : "-0.25rem",
      }}
    >
      {drag.shown.map((tab, i) => (
        <ItemTab
          key={tab.id}
          icon={tabIcon(tab)}
          label={tabTitle(tab)}
          active={tab.id === active}
          onPick={() => pick(tab.id)}
          onClose={lone ? undefined : () => editIssueTabs((s) => closeIssueTab(s, tab.id))}
          rename={
            tab.kind === "list"
              ? {
                  title: tabTitle(tab),
                  // Cleared, the tab goes back to being named by its filters.
                  save: (name) => editIssueTabs((s) => updateListTab(s, tab.id, { name: name.trim() || null })),
                }
              : undefined
          }
          onPointerDown={(e) => drag.start(e, i)}
          transform={drag.offset(i)}
          held={drag.drag?.from === i}
          gliding={!!drag.drag && drag.drag.from !== i}
          plain={lone}
        />
      ))}
      <Tooltip delayDuration={700}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="New list"
            onClick={newList}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <Plus className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">New list</TooltipContent>
      </Tooltip>
      {!lone && (
        <span className="flex h-7 min-w-0 flex-1 flex-wrap items-center overflow-hidden">
          <span aria-hidden className="h-7" />
          <span className="flex whitespace-nowrap pl-2 opacity-50">
            <ShortcutKeys ids={["tab.prev", "tab.next"]} />
          </span>
        </span>
      )}
    </div>
  );
}

function tabIcon(tab: AnyIssueTab) {
  if (tab.kind === "list") return <CircleDot className={MARK} />;
  return tab.ref.tracker === "github" ? <GitHubIcon className={MARK} /> : <LinearIcon className={MARK} />;
}

/// A titlebar icon button with its name, and chord where it has one, in a real
/// tooltip. Chrome, so held back until hovered.
export function HeaderIconButton({
  label,
  shortcut,
  size = "icon-sm",
  onClick,
  children,
}: {
  label: string;
  shortcut?: ShortcutId;
  size?: "icon-sm" | "icon-xs";
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size={size}
          aria-label={label}
          onClick={onClick}
          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground active:not-aria-[haspopup]:translate-y-0"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        {shortcut && <ShortcutKeys ids={[shortcut]} />}
      </TooltipContent>
    </Tooltip>
  );
}

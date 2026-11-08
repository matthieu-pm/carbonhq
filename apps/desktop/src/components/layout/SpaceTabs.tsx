import { Plus } from "lucide-react";

import ShortcutKeys from "@/components/ShortcutKeys";
import { spaceTabIcon, spaceTabTitle } from "@/components/spaces/sections";
import { ItemTab } from "@/components/layout/ViewTabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDragReorder } from "@/hooks/useDragReorder";
import { useDigitHotkey, useHotkey } from "@/hooks/useHotkey";
import {
  activateSpaceTab,
  addSpaceTab,
  editSpaceTabs,
  moveSpaceTab,
  newSpaceTabId,
  type SpaceTabsState,
} from "@/lib/spaceTabs";
import type { Project } from "@/types/events";

const MARK = "size-3.5 shrink-0 text-muted-foreground";

/// The Spaces page's titlebar strip: one tab per list or Page, + for a fresh
/// All. Closing goes through `onClose` so the page can flush an open editor
/// first. Lines up with the sheet the way the issues strip does.
export default function SpaceTabs({ state, projects, active, onClose, alignX = 0 }: {
  state: SpaceTabsState;
  projects: Project[];
  /// The page is on screen, so its chords answer; Spaces suspends the shell's.
  active: boolean;
  onClose: (id: string) => void;
  alignX?: number;
}) {
  const { tabs } = state;
  const drag = useDragReorder(
    tabs,
    (tab) => tab.id,
    (tab, _delta, to) => editSpaceTabs((s) => moveSpaceTab(s, tab.id, to)),
    "x",
  );

  const pick = (id: string) => editSpaceTabs((s) => activateSpaceTab(s, id));
  const pickAt = (i: number) => drag.shown[i] && pick(drag.shown[i].id);
  useDigitHotkey("tab.pick", (slot) => pickAt(slot === 8 ? drag.shown.length - 1 : slot), { enabled: active, page: true });
  const step = (delta: number) => {
    const at = drag.shown.findIndex((tab) => tab.id === state.active);
    pickAt((at + delta + drag.shown.length) % drag.shown.length);
  };
  useHotkey("tab.prev", () => step(-1), { enabled: active, page: true });
  useHotkey("tab.next", () => step(1), { enabled: active, page: true });

  const lone = tabs.length === 1;

  return (
    <div
      ref={drag.list}
      role="tablist"
      className="tab-strip-motion -mx-1 flex min-w-0 flex-1 items-center gap-0.5 self-stretch overflow-hidden px-1"
      style={{
        marginLeft:
          alignX > 0 ? `max(-0.25rem, calc(${alignX}px - 0.25rem - var(--tabs-lead)))` : "-0.25rem",
      }}
    >
      {drag.shown.map((tab, i) => {
        const Icon = spaceTabIcon(tab);
        return (
          <ItemTab
            key={tab.id}
            icon={<Icon className={MARK} />}
            label={spaceTabTitle(tab, projects)}
            active={tab.id === state.active}
            onPick={() => pick(tab.id)}
            onClose={lone ? undefined : () => onClose(tab.id)}
            onPointerDown={(e) => drag.start(e, i)}
            transform={drag.offset(i)}
            held={drag.drag?.from === i}
            gliding={!!drag.drag && drag.drag.from !== i}
            plain={lone}
          />
        );
      })}
      <Tooltip delayDuration={700}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="New tab"
            onClick={() => editSpaceTabs((s) => addSpaceTab(s, newSpaceTabId()))}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <Plus className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">New tab</TooltipContent>
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

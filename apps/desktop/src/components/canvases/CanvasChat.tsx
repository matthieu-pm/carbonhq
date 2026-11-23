import { useCanvasWindowPart } from "@/lib/canvasWindow";
import { useState } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, Plus, X } from "lucide-react";
import type { CanvasFile } from "@/hooks/useCanvasLibrary";
import { PanelCard } from "@/components/layout/AppShell";
import { HeaderIconButton } from "@/components/layout/IssueTabs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { ItemTab } from "@/components/layout/ViewTabs";
import { useResizable } from "@/components/ResizeHandle";
import Chat from "@/components/Chat";
import type { PaneChat } from "@/components/SplitView";
import type { PaneState } from "@/hooks/useSessions";
import { tabTitle, useCanvasConversationChoices, type CanvasChatDock } from "@/lib/canvasChat";
import type { SessionIndexItem } from "@/types/events";

export function CanvasChatPanel({
  dock,
  items,
  pane,
  chat,
  file,
  rail,
}: {
  file: CanvasFile;
  rail: HTMLElement | null;
  dock: CanvasChatDock;
  items: SessionIndexItem[];
  pane: PaneState;
  chat: PaneChat;
}) {
  const { style, handle, resize } = useResizable({
    storageKey: "carbon.canvas.chatWidth",
    initial: 380,
    min: 260,
    edge: "left",
    label: "Canvas chat width",
  });
  useCanvasWindowPart("chat", ({command}) => {
    if (command.group === "view" && command.args.op === "width") resize(command.args.pixels);
  });
  const active = dock.tabs.find((t) => t.id === dock.active)!;
  const [picking, setPicking] = useState(false);
  const { choices, error: pickerError } = useCanvasConversationChoices(file.project, picking);
  return (
    <PanelCard resizeHandle={handle}>
      <aside
        aria-label="Canvas chat panel"
        style={style}
        className="flex min-h-0 min-w-0 flex-col bg-background text-ui"
      >
        {rail &&
          createPortal(
            <div
              style={style}
              className="flex h-(--titlebar-h) min-w-0 items-center gap-1 px-1"
            >
              <div
                role="tablist"
                aria-label="Canvas conversations"
                className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto"
              >
                {dock.tabs.map((tab, index) => (
                  <ItemTab
                    key={tab.id}
                    label={tabTitle(tab, dock, items)}
                    icon={<MessageSquare className="size-3.5" />}
                    active={tab.id === active.id}
                    onPick={() => dock.select(tab.id)}
                    onClose={index ? () => dock.close(tab.id) : undefined}
                  />
                ))}
              </div>
              <DropdownMenu open={picking} onOpenChange={setPicking}>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-xs" variant="ghost" aria-label="Add conversation tab">
                    <Plus />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-80 max-w-80 overflow-y-auto">
                  <DropdownMenuItem onSelect={() => dock.add(crypto.randomUUID(), true)}>
                    <Plus />
                    New conversation
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Open existing conversation</DropdownMenuLabel>
                  {pickerError ? (
                    <DropdownMenuItem disabled>{pickerError}</DropdownMenuItem>
                  ) : choices === null ? (
                    <DropdownMenuItem disabled>Loading conversations…</DropdownMenuItem>
                  ) : choices.length ? (
                    choices.map((i) => (
                      <DropdownMenuItem key={i.sessionId} onSelect={() => dock.add(i.sessionId, false)}>
                        <span className="truncate">{i.title}</span>
                      </DropdownMenuItem>
                    ))
                  ) : (
                    <DropdownMenuItem disabled>No conversations in this project</DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <HeaderIconButton label="Hide canvas chat" onClick={() => dock.setOpen(false)}>
                <X className="size-4" />
              </HeaderIconButton>
            </div>,
            rail,
          )}
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <Chat key={active.id} {...pane} {...chat} crowded rail={false} />
        </div>
      </aside>
    </PanelCard>
  );
}

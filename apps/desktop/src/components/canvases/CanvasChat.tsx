import { useCanvasWindowPart } from "@/lib/canvasWindow";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, MessageSquare, Plus, Square, X } from "lucide-react";
import { canvasKey, type CanvasFile } from "@/hooks/useCanvasLibrary";
import { readDraft, useDraft } from "@/hooks/useDraft";
import { PanelCard } from "@/components/layout/AppShell";
import { HeaderIconButton } from "@/components/layout/IssueTabs";
import { invoke, serverOfPath } from "@/lib/transport";
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
import { tabTitle, type CanvasChatDock } from "@/lib/canvasChat";
import type { SessionIndexItem } from "@/types/events";

function ChatComposer({
  send,
  stop,
  title,
  id,
}: {
  id: string;
  title: string;
  send: (text: string) => Promise<void>;
  stop?: () => Promise<void>;
}) {
  const [text, setText] = useDraft(id);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    if (!text.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      await send(text.trim());
      if (readDraft(id) === text) setText("");
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  }
  return (
    <form
      className="m-2 rounded-xl border border-border bg-composer p-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <textarea
        aria-label={`Message ${title}`}
        placeholder="Message…"
        rows={2}
        readOnly={sending}
        value={text}
        className="w-full resize-none bg-transparent px-1 outline-none"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <div className="flex justify-end gap-1">
        {stop && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Stop response"
            onClick={() => void stop().catch((e) => setError(String(e)))}
          >
            <Square />
          </Button>
        )}
        <Button size="icon-xs" aria-label="Send message" disabled={!text.trim() || sending}>
          <ArrowUp />
        </Button>
      </div>
    </form>
  );
}

export function CanvasChatPanel({
  dock,
  items,
  pane,
  chat,
  send,
  file,
  rail,
}: {
  file: CanvasFile;
  rail: HTMLElement | null;
  dock: CanvasChatDock;
  items: SessionIndexItem[];
  pane: PaneState;
  chat: PaneChat;
  send: (text: string) => Promise<void>;
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
  const project = file.project;
  const active = dock.tabs.find((t) => t.id === dock.active)!;
  const draftKey = "canvas-chat:" + (active.id === dock.tabs[0].id ? canvasKey(file) : active.id);
  const [picking, setPicking] = useState(false);
  const [choices, setChoices] = useState<SessionIndexItem[] | null>(null);
  const [pickerError, setPickerError] = useState("");
  useEffect(() => {
    if (!picking) return;
    let current = true;
    setPickerError("");
    setChoices(null);
    void invoke<SessionIndexItem[]>("list_session_index_items", { archived: false }, serverOfPath(project))
      .then((all) => {
        if (current) setChoices(all.filter((i) => i.projectPath === project && !i.hidden));
      })
      .catch((e) => {
        if (current) setPickerError(String(e));
      });
    return () => {
      current = false;
    };
  }, [project, picking]);
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
              className="flex h-(--titlebar-h) min-w-0 items-center gap-1 border-l border-hairline px-1"
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
        <ChatComposer
          id={draftKey}
          key={draftKey}
          title={tabTitle(active, dock, items)}
          send={send}
          stop={
            pane.busy
              ? () => invoke("interrupt_session", { sessionId: active.id }, serverOfPath(project))
              : undefined
          }
        />
      </aside>
    </PanelCard>
  );
}

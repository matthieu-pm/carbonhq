import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  MessageSquare,
  Minus,
  PanelRight,
  Plus,
  SlidersHorizontal,
  Square,
  X,
} from "lucide-react";
import AttachmentTray from "@/components/composer/AttachmentTray";
import { HeaderIconButton } from "@/components/layout/IssueTabs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CanvasFile } from "@/hooks/useCanvasLibrary";
import {
  addAttachmentPaths,
  pasteAttachments,
  pickAttachments,
  readAttachments,
  removeAttachment,
  sendWithAttachments,
  useAttachments,
} from "@/hooks/useAttachments";
import { readDraft, useDraft } from "@/hooks/useDraft";
import { useHotkey } from "@/hooks/useHotkey";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import {
  canvasDraftKey,
  registerCanvasComposer,
  tabTitle,
  useCanvasConversationChoices,
  type CanvasChatDock,
} from "@/lib/canvasChat";
import { LOCAL, serverOfPath } from "@/lib/transport";
import { forget, keepUploading } from "@/lib/uploads";
import { cn } from "@/lib/utils";
import type { Attachment, SessionIndexItem } from "@/types/events";

const MAX_TEXT_HEIGHT = 160;

/// The Design workspace's composer: a card floating at the canvas's lower
/// right, naming the conversation it sends into above the text.
///
/// The transcript stays in the docked panel; this only writes. Drafts and the
/// attachment tray are keyed exactly as the panel's old composer keyed them, so
/// a prompt half-written before this existed is still there.
export function CanvasComposer({
  file,
  dock,
  items,
  modelTakesImages,
  busy,
  send,
  onStop,
  onOpenInTasks,
  dictation,
  dictating,
  onCancelRecording,
  appError,
  onDismissAppError,
}: {
  file: CanvasFile;
  dock: CanvasChatDock;
  items: SessionIndexItem[];
  modelTakesImages: boolean;
  busy: boolean;
  send: (text: string, attachments: Attachment[]) => Promise<void>;
  onStop: () => Promise<void>;
  /// Opens the active conversation in Tasks. Absent until it has been sent to.
  onOpenInTasks?: () => void;
  dictation: ReactNode;
  dictating: boolean;
  onCancelRecording: () => boolean;
  /// The app's own error slot — dictation reports there — drawn here since the
  /// session composer that normally shows it is hidden.
  appError: string | null;
  onDismissAppError: () => void;
}) {
  const active = dock.tabs.find((t) => t.id === dock.active) ?? dock.tabs[0];
  const title = tabTitle(active, dock, items);
  const key = canvasDraftKey(file, dock);
  const server = serverOfPath(file.project);
  const [text, setText] = useDraft(key);
  const attachments = useAttachments(key);
  const [collapsed, setCollapsed] = useLocalStorage("carbon.canvas.composerCollapsed", false);
  const [sendStates, setSendStates] = useState<Record<string, { sending?: boolean; error?: string }>>({});
  const { sending = false, error = "" } = sendStates[key] ?? {};
  const updateSend = (change: { sending?: boolean; error?: string }) =>
    setSendStates(states => ({ ...states, [key]: { ...states[key], ...change } }));
  const setError = (error: string) => updateSend({ error });
  const [dragging, setDragging] = useState(false);
  const [picking, setPicking] = useState(false);
  const { choices, error: pickerError } = useCanvasConversationChoices(file.project, picking);
  const input = useRef<HTMLTextAreaElement | null>(null);

  const canSend = (!!text.trim() || attachments.length > 0) && !sending;
  const stopping = busy && !canSend && !sending;

  // A dictation started with ⌘D while folded has nowhere to draw its level.
  useEffect(() => {
    if (dictating) setCollapsed(false);
  }, [dictating, setCollapsed]);

  useEffect(
    () => (server === LOCAL ? undefined : keepUploading(server, () => readAttachments(key))),
    [server, key, attachments],
  );

  const attachFiles = () => {
    setCollapsed(false);
    void pickAttachments(key).catch((e) => setError(String(e)));
  };
  useHotkey("attach", attachFiles, { page: true });

  // The window is the drop target, as in the session composer: while a canvas
  // is open that composer is hidden and stands down, so the file lands here.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let live = true;
    let webview;
    try {
      webview = getCurrentWebview();
    } catch {
      return;
    }
    void webview
      .onDragDropEvent((event) => {
        const kind = event.payload.type;
        setDragging(kind === "enter" || kind === "over");
        if (kind === "drop") {
          setCollapsed(false);
          void addAttachmentPaths(key, event.payload.paths).catch((e) => setError(String(e)));
        }
      })
      .then((off) => {
        if (live) unlisten = off;
        else off();
      });
    return () => {
      live = false;
      unlisten?.();
    };
  }, [key, setCollapsed]);

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    // An empty box stays one line: scrollHeight counts a wrapped placeholder.
    const fit = () => {
      el.style.height = "auto";
      if (el.value) el.style.height = Math.min(el.scrollHeight, MAX_TEXT_HEIGHT) + "px";
    };
    fit();
    // The card can mount before the stage has a width, which wraps the
    // placeholder a word per line; a narrower canvas rewraps the draft too.
    let width = el.clientWidth;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [text, collapsed]);

  async function submit() {
    if (!canSend) return;
    const message = text.trim();
    updateSend({ sending: true, error: "" });
    try {
      await sendWithAttachments(key, pins => send(message, pins));
      if (readDraft(key) === text) setText("");
    } catch (e) {
      setError(String(e));
    } finally {
      updateSend({ sending: false });
    }
  }

  const openTabs = new Set(dock.tabs.map((t) => t.id));
  const others = choices?.filter((c) => !openTabs.has(c.sessionId));

  return (
    <form
      aria-label="Canvas composer"
      data-collapsed={collapsed || undefined}
      className="ce-composer relative flex flex-col rounded-(--ce-composer-radius) border border-hairline bg-composer text-ui shadow-(--shadow-surface) backdrop-blur-xl"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-(--ce-composer-radius) border-2 border-muted-foreground/25 bg-background/70 text-muted-foreground">
          Drop to attach
        </div>
      )}
      <div className={cn("flex h-[45px] shrink-0 items-center gap-1 pr-2 pl-2.5", !collapsed && "border-b border-hairline")}>
        <DropdownMenu open={picking} onOpenChange={setPicking}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Conversation: ${title}`}
              className="min-w-0 max-w-full justify-start gap-2 px-1.5 font-medium text-foreground active:not-aria-[haspopup]:translate-y-0"
            >
              <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{title}</span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
            <DropdownMenuLabel>Conversations on this canvas</DropdownMenuLabel>
            {dock.tabs.map((tab) => (
              <DropdownMenuItem key={tab.id} onSelect={() => dock.select(tab.id)}>
                <MessageSquare />
                <span className="truncate">{tabTitle(tab, dock, items)}</span>
                {tab.id === active.id && <Check className="ml-auto" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onSelect={() => dock.add(crypto.randomUUID(), true)}>
              <Plus />
              New conversation
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Open existing conversation</DropdownMenuLabel>
            {pickerError ? (
              <DropdownMenuItem disabled>{pickerError}</DropdownMenuItem>
            ) : !others ? (
              <DropdownMenuItem disabled>Loading conversations…</DropdownMenuItem>
            ) : others.length ? (
              others.map((i) => (
                <DropdownMenuItem key={i.sessionId} onSelect={() => dock.add(i.sessionId, false)}>
                  <span className="truncate">{i.title}</span>
                </DropdownMenuItem>
              ))
            ) : (
              <DropdownMenuItem disabled>No other conversations in this project</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="flex-1" />
        <HeaderIconButton
          label={collapsed ? "Expand composer" : "Collapse composer"}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronUp className="size-4" /> : <Minus className="size-4" />}
        </HeaderIconButton>
      </div>
      {!collapsed && (
        <>
          {(error || appError) && (
            <div role="alert" className="flex items-start gap-2 px-3 pt-2 text-destructive">
              <p className="min-w-0 flex-1 break-words">{error || appError}</p>
              <button
                type="button"
                aria-label="Dismiss error"
                className="shrink-0"
                onClick={() => (error ? setError("") : onDismissAppError())}
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}
          {attachments.length > 0 && (
            <div className="px-3 pt-3">
              <AttachmentTray
                attachments={attachments}
                server={server}
                onRemove={(path) => {
                  removeAttachment(key, path);
                  forget(server, [path]);
                }}
                modelTakesImages={modelTakesImages}
              />
            </div>
          )}
          <div className="flex min-h-[45px] items-end gap-1 px-2 py-[8.5px]">
            <HeaderIconButton label="Attach files" shortcut="attach" onClick={attachFiles}>
              <Plus className="size-4" />
            </HeaderIconButton>
            <textarea
              ref={(el) => {
                input.current = el;
                registerCanvasComposer(el);
              }}
              aria-label={`Message ${title}`}
              placeholder={busy ? "Queue a follow-up…" : "Ask about this canvas…"}
              rows={1}
              readOnly={sending}
              value={text}
              className="min-h-7 min-w-0 flex-1 resize-none self-center bg-transparent px-1 py-1 leading-5 text-foreground outline-none placeholder:text-muted-foreground"
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                if (!e.clipboardData.types.includes("Files")) return;
                e.preventDefault();
                void pasteAttachments(key);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape" && onCancelRecording()) {
                  e.preventDefault();
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Conversation options"
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <SlidersHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Conversation options</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={() => dock.setOpen(!dock.open)}>
                  <PanelRight />
                  {dock.open ? "Hide transcript" : "Show transcript"}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!onOpenInTasks} onSelect={() => onOpenInTasks?.()}>
                  <ExternalLink />
                  Open in Tasks
                </DropdownMenuItem>
                {active.id !== dock.tabs[0].id && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => dock.close(active.id)}>
                      <X />
                      Close conversation tab
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {dictation}
            {!dictating && (
              <Button
                type={stopping ? "button" : "submit"}
                size="icon-sm"
                aria-label={stopping ? "Stop response" : busy ? "Queue message" : "Send message"}
                disabled={!stopping && !canSend}
                onClick={
                  stopping
                    ? () => void onStop().catch((e) => setError(String(e)))
                    : undefined
                }
                // Foreground on background: a light disc in dark mode and a
                // dark one in light, as in the reference. Dimmed, never
                // swapped to a fill, when there is nothing to send.
                className="shrink-0 rounded-full bg-foreground text-background hover:bg-foreground/90 disabled:opacity-35"
              >
                {stopping ? <Square className="fill-current" /> : <ArrowUp strokeWidth={2} />}
              </Button>
            )}
          </div>
        </>
      )}
    </form>
  );
}

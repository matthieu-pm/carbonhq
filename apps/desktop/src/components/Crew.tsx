import { useEffect, useMemo, useRef, useState } from "react";
import { CircleDashed, Eye } from "lucide-react";

import BotAvatar from "@/components/BotAvatar";
import Chat from "@/components/Chat";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import PermissionRequest from "@/components/chat/PermissionRequest";
import QuestionRequest from "@/components/chat/QuestionRequest";
import Orb from "@/components/Orb";
import PrStateIcon, { prStateLabel } from "@/components/PrStateIcon";
import type { PaneChat } from "@/components/SplitView";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PaneState } from "@/hooks/useSessions";
import type { CrewRow } from "@/lib/crew";
import { truncate } from "@/lib/format";
import { toolArgument } from "@/lib/tools";
import { buildTranscript } from "@/lib/transcript";
import { CREW_TAIL } from "@/lib/turnWindow";
import { cn } from "@/lib/utils";
import type { AgentEvent, PrMark } from "@/types/events";

type CrewProps = {
  rows: CrewRow[];
  open: ReadonlySet<string>;
  selectedId: string | null;
  paneState: (sessionId: string) => PaneState;
  prFor: (repoPath: string, branch: string | null) => PrMark | undefined;
  onToggle: (sessionId: string) => void;
  onFocus: (sessionId: string) => void;
  onOpenInMain: (sessionId: string) => void;
  onShowInSidebar: (sessionId: string) => void;
  composing: boolean;
  active: boolean;
  chat: PaneChat;
};

/// Crew rows share the summary's width and scroll; questions remain answerable here.
export default function Crew({
  rows, open, selectedId, paneState, prFor, onToggle, onFocus,
  onOpenInMain, onShowInSidebar, composing, active, chat,
}: CrewProps) {
  const running = rows.filter((row) => row.busy || row.asking);
  const done = rows.filter((row) => !row.busy && !row.asking);
  const [doneExpanded, setDoneExpanded] = useState(false);
  // A member finishing must not close the transcript somebody is already reading.
  const expanded = doneExpanded || done.some((row) => open.has(row.item.sessionId));
  const renderRow = (row: CrewRow) => {
    const id = row.item.sessionId;
    // A question opens its card without selecting the session or claiming the composer.
    const openFully = open.has(id);
    const focused = selectedId === id;
    const pane = paneState(id);
    return (
      <div key={id} className="flex min-w-0 flex-col">
        <CrewHeader row={row} focused={focused}
          pr={prFor(row.item.projectPath, row.item.branch)}
          onOpenInMain={() => onOpenInMain(id)}
          onShowInSidebar={() => onShowInSidebar(id)} />
        {(openFully || row.asking) && <div
          onPointerDown={() => openFully && !focused && onFocus(id)}
          onFocus={() => openFully && !focused && onFocus(id)}
          className={cn("min-w-0 transition-opacity duration-150 ease-out",
            openFully && "flex h-80 max-h-[60vh] min-h-0 flex-col overflow-hidden",
            composing && !focused && "opacity-35")}>
          {openFully ? <Chat {...pane} {...chat} crowded rail={false} tail={CREW_TAIL} active={active && focused} />
            : <PendingCard row={row} events={pane.session?.events} chat={chat} onOpenInMain={() => onOpenInMain(id)} />}
        </div>}
      </div>
    );
  };
  return (
    <div className="flex min-w-0 flex-col">
      {running.map(renderRow)}
      {done.length > 0 && <>
        <button type="button" aria-expanded={expanded}
          aria-label={`${expanded ? "Hide" : "Show"} ${done.length} completed crew ${done.length === 1 ? "member" : "members"}`}
          className="flex min-h-8 w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-1 text-left text-xs text-foreground/80 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={() => {
            if (expanded) done.filter((row) => open.has(row.item.sessionId)).forEach((row) => onToggle(row.item.sessionId));
            setDoneExpanded(!expanded);
          }}>
          <span className="flex shrink-0 -space-x-1">
            {done.slice(0, 3).map((row) => <BotAvatar key={row.item.sessionId} seed={row.item.sessionId} />)}
          </span>
          <span className="flex-1">{done.length} done</span>
        </button>
        {expanded && done.map(renderRow)}
      </>}
    </div>
  );
}

/// The question a row was opened by, and nothing else.
///
/// The crew opened this row on its own — the reader did not ask to read a
/// transcript, they were handed a decision — and a card at the foot of one is a
/// card the row has to be scrolled to find. It also keeps the cost of the
/// interruption proportionate: a question is three lines, where a transcript
/// takes every open row's height to show a conversation nobody asked to see.
///
/// The session header opens its full conversation. Answering the card keeps
/// the reader here.
function PendingCard({
  row,
  events,
  chat,
  onOpenInMain,
}: {
  row: CrewRow;
  events: AgentEvent[] | undefined;
  onOpenInMain: () => void;
  chat: Pick<
    React.ComponentProps<typeof Chat>,
    "onRespondPermission" | "onAnswerQuestions"
  >;
}) {
  // `buildTranscript`'s own pairing rather than a walk of our own: it is what
  // matches a request to its decision, drops one the CLI took back, and knows
  // that a `questions_asked` rides the same channel. A second reading here
  // would answer differently on exactly the lines nobody tested.
  const ask = useMemo(() => buildTranscript(events ?? [], true).pendingAsks[0], [events]);

  // The column scrolls, and this card opened its own row — so on a fan-out of
  // any size it can arrive below the fold, which is the one thing it must not
  // do: `announce` takes a drawn crew as the reader having seen the question
  // and raises nothing, and a card nobody scrolled to holds the agent's turn
  // until somebody goes looking for it. Answered by making that reading true
  // rather than by weakening it back into a second notice.
  //
  // `nearest` and not `center`: a card already in view moves nothing, so the
  // rows somebody is reading stay where they are. Keyed on the request, so a
  // second question in the same row scrolls again and a re-render does not.
  const cardRef = useRef<HTMLDivElement>(null);
  const requestId = ask?.requestId;
  useEffect(() => {
    if (requestId) cardRef.current?.scrollIntoView({ block: "nearest" });
  }, [requestId]);

  // The card is read out of the transcript, which may still be loading or may
  // have failed to. Open is the retry: an unloaded session goes through the
  // select path, which reads it again and reports a failure. A *loaded* one
  // without the ask gets no button, since Open would redraw the same transcript.
  if (!ask) {
    if (events) return null;
    return (
      <div className="flex items-center justify-between gap-2 px-3 pb-3 text-ui text-muted-foreground">
        Loading the request…
        <Button variant="outline" size="xs" onClick={onOpenInMain}>
          Open
        </Button>
      </div>
    );
  }

  const id = row.item.sessionId;
  return (
    <div ref={cardRef} className="px-3 pb-3">
      {ask.type === "questions_asked" ? (
        // `autoFocus` off, unlike the main column's: there the card is in the
        // transcript the reader is already in, where this one arrives in a
        // column they were not looking at. Taking the caret would put their next
        // keystroke in a form belonging to a session they have not chosen to
        // talk to — the same reason the row expands without selecting.
        <QuestionRequest
          requestId={ask.requestId}
          questions={ask.questions}
          autoFocus={false}
          onAnswer={(answers) => chat.onAnswerQuestions(id, ask.requestId, answers)}
        />
      ) : (
        <PermissionRequest
          // The agent writes a description for nearly every call; the tool's own
          // name is the floor, so the card always has a subject. Capped: with no
          // description the title is often the whole command, already drawn in
          // full just above it, and this column is 320px wide.
          description={truncate(
            ask.description ?? ask.title ?? ask.displayName ?? ask.toolName,
            140,
          )}
          argument={toolArgument(ask.input)}
          options={ask.options}
          onRespond={(optionId) => chat.onRespondPermission(id, ask.requestId, optionId)}
        />
      )}
    </div>
  );
}

/// Crew rows open the full conversation while their question cards remain answerable here.
function CrewHeader({
  row,
  focused,
  pr,
  onOpenInMain,
  onShowInSidebar,
}: {
  row: CrewRow;
  focused: boolean;
  pr: PrMark | undefined;
  onOpenInMain: () => void;
  onShowInSidebar: () => void;
}) {
  // The avatar cannot carry the two states on its own: its hue is seeded from
  // the session id, so yellow and green have nowhere to live on it — it says
  // *which* session, never what that session wants. So the title takes the
  // sidebar's own pair and the pose reads as its second half.
  const tone = row.asking
    ? "text-accent-command"
    : row.unread
      ? "text-accent-add"
      : undefined;

  return (
    // **The whole row is the button**, not the title inside it. It was the
    // title alone for a while, which left the avatar, the state mark and every
    // pixel of gap between them dead: the row was plainly one control, so a
    // click anywhere but on the words read as the app ignoring it. A `button`
    // rather than a div with a handler, since it is one — that is what gets it
    // Enter, Space and a tab stop for free.
    //
    // The menu opens on a hidden row alone: showing it in the sidebar is the one
    // thing it offers, and a shown row has nothing to put there.
    <ContextMenu>
    <Tooltip delayDuration={TIP_DELAY}>
      <TooltipTrigger asChild>
        <ContextMenuTrigger asChild disabled={!row.item.hidden}>
        <button
          type="button"
          onClick={onOpenInMain}
          className={cn(
            "group relative flex h-8 w-full shrink-0 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-left text-xs select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            // Selection is weight and colour, no fill. A filled row is how a
            // *list* marks the one thing it is showing, and in a column with no
            // borders it was the loudest shape on screen — a lit band across
            // the crew for a session that is merely where the composer happens
            // to point. Hover is the same currency one step quieter, since a
            // hover fill under an unfilled selection would make passing the
            // cursor look more selected than selecting.
            focused ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <RowAvatar row={row} />
          <span className={cn("truncate", focused && "font-medium", tone)}>
            {row.item.title}
          </span>
          {/* The tone above is the whole of what says a row wants answering or
              has finished, and colour alone says it to nobody using a screen
              reader. The sidebar's own words, since the pair means the same
              thing there. */}
          {(row.asking || row.unread) && (
            <span className="sr-only">{row.asking ? "Waiting for you" : "Unread"}</span>
          )}
      {/* One slot, three tenants, and the order is the sidebar's own — so a
          reader who has learnt it over there already knows it here.

          Checks win: the orb says the agent is working, which the reader set
          going and the row's own face is already saying, where CI reports from a
          machine elsewhere on somebody else's schedule and nothing in the
          transcript will ever mention that it went red. The orb comes next,
          because a row with a turn in flight is the one row whose PR state is
          the least live thing about it — and the state is a standing fact, so
          it comes back the moment the turn ends. */}
          <span
            // `role="img"` or the label is dropped on the floor: a bare `span`
            // takes no accessible name, so the PR state was stated to nobody.
            role={pr ? "img" : undefined}
            className="ml-auto flex size-5 shrink-0 items-center justify-center"
            aria-label={pr ? `Pull request #${pr.number}, ${prStateLabel(pr).toLowerCase()}` : undefined}
          >
            {pr?.checksState === "RUNNING" ? (
              <CircleDashed
                className="size-3.5 animate-spin text-accent-command [animation-duration:3s]"
                strokeWidth={1.5}
                aria-label="Checks running"
              />
            ) : row.busy ? (
              <Orb state="working" label="Working" />
            ) : (
              pr && <PrStateIcon pr={pr} strokeWidth={1.5} />
            )}
          </span>
        </button>
        </ContextMenuTrigger>
      </TooltipTrigger>
      <TooltipContent side="left">Open conversation</TooltipContent>
    </Tooltip>
      <ContextMenuContent className="w-40">
        <ContextMenuItem className="text-ui" onSelect={onShowInSidebar}>
          <Eye />
          Show in sidebar
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/// Long enough that crossing the crew does not trigger it, short enough for
/// anybody who stopped.
///
/// Every other tooltip in this app runs at the provider's 0, which is right for
/// a control the cursor went to on purpose and wrong for a strip of half a
/// dozen rows it passes through on the way somewhere else.
const TIP_DELAY = 700;

/// The same session id draws the same character in the crew and message references.
function RowAvatar({ row }: { row: CrewRow }) {
  return <BotAvatar seed={row.item.sessionId} working={row.busy} className="ml-0.5" />;
}

import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { activeMessageEvents } from "@/lib/messageEdit";
import { invoke, serverOfSession } from "@/lib/transport";
import type { MessageEditEligibility, SessionSnapshot } from "@/types/events";

type Editing = { eventId: string; original: string; text: string };
type MessageEditor = {
  latest: string | null;
  revised: Set<string>;
  editing: Editing | null;
  eligibility: MessageEditEligibility | null;
  error: string | null;
  submitting: boolean;
  busy: boolean;
  open: (id: string) => void;
  change: (text: string) => void;
  cancel: () => void;
  submit: () => void;
};
const EditContext = createContext<MessageEditor | null>(null);
const EditingIdContext = createContext<string | null>(null);

/// The draft outlives its original bubble, including a failed send after the native rewind.
export function SentMessageEditorProvider({ session, busy, children }: { session: Pick<SessionSnapshot, "sessionId" | "events"> | null; busy: boolean; children: ReactNode }) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [eligibility, setEligibility] = useState<MessageEditEligibility | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const generation = useRef(0);
  const sessionId = session?.sessionId ?? null;
  useEffect(() => { generation.current++; setEditing(null); setError(null); setEligibility(null); }, [sessionId]);
  const events = useMemo(() => activeMessageEvents(session?.events ?? []), [session?.events]);
  const latest = [...events].reverse().find((event) => event.subagent === null && event.payload.type === "user_message");
  const revised = new Set(events.flatMap((event) => event.payload.type === "turn_replayed" ? [event.payload.replacementEventId] : []));

  const open = async (id: string) => {
    const event = events.find((e) => e.id === id);
    if (!sessionId || event?.payload.type !== "user_message") return;
    const mine = ++generation.current;
    setEditing({ eventId: id, original: event.payload.text, text: event.payload.text });
    setEligibility(null);
    setError(null);
    try {
      const result = await invoke<MessageEditEligibility>("message_edit_eligibility", { sessionId, eventId: id }, serverOfSession(sessionId));
      if (mine === generation.current) setEligibility(result);
    } catch (err) {
      if (mine === generation.current) setError(String(err));
    }
  };

  const submit = async () => {
    if (!editing || !sessionId || submitting || !eligibility?.allowed || !editing.text.trim() || editing.text === editing.original) return;
    const mine = generation.current;
    setSubmitting(true);
    setError(null);
    try {
      await invoke("edit_sent_message", { sessionId, eventId: editing.eventId, prompt: editing.text }, serverOfSession(sessionId));
      if (mine === generation.current) setEditing(null);
    } catch (err) {
      if (mine === generation.current) setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };
  // Keep a failed draft visible even if a replacement marker removed its original bubble.
  const editorId = editing ? (events.some((event) => event.id === editing.eventId) ? editing.eventId : latest?.id ?? null) : null;
  return (
    <EditContext value={{
      latest: latest?.id ?? null, revised, editing, eligibility, error, submitting, busy,
      open: (id) => void open(id),
      change: (text) => setEditing((current) => current && ({ ...current, text })),
      cancel: () => { if (!submitting) { generation.current++; setEditing(null); } },
      submit: () => void submit(),
    }}>
      <EditingIdContext value={editorId}>{children}</EditingIdContext>
    </EditContext>
  );
}

export function useSentMessageEditing(eventId?: string) {
  const editorId = useContext(EditingIdContext);
  return !!eventId && editorId === eventId;
}

/// The bubble itself becomes the editor, so the prompt stays in its transcript position.
export function SentMessageInlineEditor() {
  const context = useContext(EditContext);
  const input = useRef<HTMLTextAreaElement>(null);
  const descriptionId = useId();
  const text = context?.editing?.text ?? "";
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [text]);
  if (!context?.editing) return null;
  const { editing, eligibility, error, submitting, busy, change, cancel, submit } = context;
  return (
    <form aria-label="Edit sent message" aria-busy={submitting}
      onSubmit={(event) => { event.preventDefault(); submit(); }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.nativeEvent.isComposing && !submitting) {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
      className="user-bubble flex w-full min-w-0 flex-col gap-3 rounded-xl bg-card p-3 text-card-foreground shadow-(--shadow-card) focus-within:ring-2 focus-within:ring-ring/30">
      <p id={descriptionId} className="sr-only">{busy ? "Sending stops the running turn and replays your revised prompt in this chat." : "Sending replaces the latest turn and replays your revised prompt in this chat."} Editing is blocked if Carbon cannot undo every effect.</p>
      <textarea ref={input} aria-label="Revised message" aria-describedby={descriptionId} autoFocus
        rows={3} value={text} disabled={submitting} onChange={(event) => change(event.target.value)}
        className="min-h-20 max-h-[45vh] w-full resize-none bg-transparent text-chat outline-none disabled:opacity-60" />
      {!eligibility && !error && <p role="status" className="text-ui text-muted-foreground">Checking whether this turn can be undone…</p>}
      {eligibility?.reason && <p role="status" className="text-ui text-muted-foreground">{eligibility.reason}</p>}
      {error && <p role="alert" className="text-ui text-destructive">{error} Your revised text is kept here.</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={submitting} onClick={cancel}>Cancel</Button>
        <Button type="submit" disabled={submitting || !eligibility?.allowed || !text.trim() || text === editing.original}>
          {submitting ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}

/// Editing is offered on the latest own prompt; the server decides whether replay is safe.
export default function SentMessageEditAction({ eventId, own }: { eventId?: string; own: boolean }) {
  const context = useContext(EditContext);
  if (!context || !eventId) return null;
  const edited = context.revised.has(eventId);
  return (
    <>
      {edited && <span className="text-ui text-muted-foreground">Edited · replayed</span>}
      {own && context.latest === eventId && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label="Edit message" onClick={() => context.open(eventId)}
              className="text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/message:opacity-100 focus-visible:opacity-100">
              <Pencil className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Edit message</TooltipContent>
        </Tooltip>
      )}
    </>
  );
}

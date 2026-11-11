import type { AgentEvent } from "@/types/events";

export type Todo = {
  content: string;
  /// Unrecognised words read as pending, the safe direction: a list item drawn
  /// as not-done is wrong about one row, where dropping it hides work.
  status: "pending" | "in_progress" | "completed";
  id?: string;
};

/// Whether a call is a task list write at all. Claude Code's `TodoWrite` and
/// grok's `todo_write` are the same tool under two spellings, and Codex's
/// `update_plan` is the same act under its own keys (`plan`, `step`).
///
/// Claude Code's `TaskCreate`/`TaskUpdate` are deliberately absent: each names
/// one task, so no single call draws a list and their rows keep their arguments.
///
/// Asked separately from reading the list, because a *merge* update carries no
/// item text at all — so "is this a todo call" and "does this call draw a
/// checklist" are two questions, and the row's arguments have to be dropped on
/// the first rather than the second or a merge expands onto its own JSON.
export function isTodoCall(toolName: string): boolean {
  return toolName === "TodoWrite" || toolName === "todo_write" || toolName === "update_plan";
}

type Written = { merge: boolean; items: { id?: string; content?: string; status: Todo["status"] }[] };

/// Codex's live protocol spells it `inProgress` where its own rollout log and
/// every other harness spell it `in_progress`.
function statusOf(raw: unknown): Todo["status"] {
  if (raw === "completed") return "completed";
  return raw === "in_progress" || raw === "inProgress" ? "in_progress" : "pending";
}

/// What a list-writing call says, without deciding what it means for the list.
function written(input: unknown): Written | null {
  if (!input || typeof input !== "object") return null;
  const call = input as Record<string, unknown>;
  const rows = Array.isArray(call.todos) ? call.todos : call.plan;
  if (!Array.isArray(rows)) return null;

  const items = rows.flatMap((raw): Written["items"] => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const text = item.content ?? item.step;
    return [
      {
        id: typeof item.id === "string" ? item.id : undefined,
        content: typeof text === "string" && text ? text : undefined,
        status: statusOf(item.status),
      },
    ];
  });

  return items.length > 0 ? { merge: call.merge === true, items } : null;
}

/// The task list a single call carries, or `null` where it carries none.
///
/// This is the *row's* reading, so it answers for a call in isolation: a merge
/// update naming ids and statuses and no text has nothing to draw, and says so
/// rather than inventing rows. The panel reads the whole log instead — see
/// `currentTodos`.
export function todoList(toolName: string, input: unknown): Todo[] | null {
  if (!isTodoCall(toolName)) return null;
  const call = written(input);
  if (!call) return null;

  const list = call.items.flatMap((item) =>
    item.content ? [{ content: item.content, status: item.status, id: item.id }] : [],
  );
  return list.length > 0 ? list : null;
}

/// Folds one write onto the list before it.
///
/// **`merge` is grok's, and getting it wrong lost the whole list.** A merge
/// update names `id` and `status` and *no content at all*, so read as a list in
/// its own right it is three items with nothing to say — which is how a session
/// that had ticked every box ended up drawing its raw JSON instead of a
/// checklist. Matched on `id` alone, which is the only thing such an update
/// carries; an id the list has not met is appended where it brings text of its
/// own and dropped where it does not, since a row with no words is not a row.
function fold(previous: Todo[] | null, call: Written): Todo[] | null {
  if (!call.merge || !previous) {
    const list = call.items.flatMap((item) =>
      item.content ? [{ content: item.content, status: item.status, id: item.id }] : [],
    );
    // A write that replaces the list with nothing drawable leaves the previous
    // one standing: losing the list is the worse of the two wrong answers.
    return list.length > 0 ? list : previous;
  }

  const merged = previous.map((todo) => {
    const update = call.items.find((item) => item.id !== undefined && item.id === todo.id);
    return update ? { ...todo, status: update.status, content: update.content ?? todo.content } : todo;
  });

  const seen = new Set(previous.map((todo) => todo.id));
  const added = call.items.flatMap((item) =>
    item.content && !seen.has(item.id)
      ? [{ content: item.content, status: item.status, id: item.id }]
      : [],
  );

  return [...merged, ...added];
}

/// Whether the agent has started a *different* list, rather than ticking an
/// item off the one it was already working through.
///
/// This is what the panel opens itself on, and the distinction is the whole
/// reason it can: `todo_write` fires on every status change, so a rule reading
/// "the list moved" would yank the pane open several times a turn. A list the
/// reader has already been shown does not need showing again — but a session
/// that finishes its plan and starts on something else does.
///
/// The test is **no shared item text**. A tick keeps every line, adding a step
/// keeps most, and replacing the work replaces all of them — so overlap is a
/// cleaner signal than any threshold, and it needs nothing remembered beyond
/// the previous list.
export function startsNewList(previous: Todo[] | null, next: Todo[]): boolean {
  if (!previous || previous.length === 0) return true;
  const before = new Set(previous.map((todo) => todo.content));
  return !next.some((todo) => before.has(todo.content));
}

/// The session's current task list.
///
/// **Read back out of the log rather than tracked in a map**, the bargain the
/// context ring already makes: everything moving this list is persisted, so a
/// reopened session shows what it showed live and nothing has to be kept in
/// step with the turn.
///
/// The walk runs **forwards**, since a merge update only means anything against
/// the list it updates — a backwards walk stopping at the newest call reads the
/// last tick as the whole list.
///
/// A finished list is **kept**, not retired. It is the record of what the turn
/// actually did, which is worth as much as the list of what is left.
///
/// **Claude Code's `TaskCreate`/`TaskUpdate` build the list one task a call**
/// (v2.1.322), and the id an update names exists only in the create's *result*
/// (`tool_use_result.task.id`, echoed as "Task #1 created"), so this walk reads
/// completions too. A create landing on a list with nothing left open starts a
/// new one: the CLI numbers tasks for the whole session and never retires
/// them, so without that every plan the session ever made stacks up here.
export function currentTodos(events: AgentEvent[]): Todo[] | null {
  let list: Todo[] | null = null;
  const creating = new Map<string, Todo>();
  for (const event of events) {
    // A child runs its own context and keeps its own list, so folding its
    // writes in here lets a subagent replace what the conversation is tracking
    // — and `startsNewList` then reads that as news and drags the pane open on
    // somebody else's work. `subagent` is `null` for the main thread.
    if (event.subagent) continue;
    const payload = event.payload;
    if (payload.type === "tool_call_completed") {
      const created = creating.get(payload.callId);
      if (!created || !list) continue;
      creating.delete(payload.callId);
      const id = payload.result.isError ? null : createdTaskId(payload.result);
      // A create that failed, or answered with no id an update could name, made no task.
      list = id ? list.map((todo) => (todo === created ? { ...todo, id } : todo)) : list.filter((todo) => todo !== created);
      continue;
    }
    if (payload.type !== "tool_call_started") continue;
    const input = (payload.input ?? {}) as Record<string, unknown>;
    if (payload.name === "TaskCreate") {
      if (typeof input.subject !== "string" || !input.subject) continue;
      const todo: Todo = { content: input.subject, status: "pending" };
      const open: Todo[] = list?.some((item) => item.status !== "completed") ? list : [];
      list = [...open, todo];
      creating.set(payload.callId, todo);
    } else if (payload.name === "TaskUpdate") {
      if (!list || typeof input.taskId !== "string") continue;
      const { taskId, status, subject } = input;
      list = status === "deleted"
        ? list.filter((todo) => todo.id !== taskId)
        : list.map((todo) => todo.id !== taskId ? todo : {
            ...todo,
            status: typeof status === "string" ? statusOf(status) : todo.status,
            content: typeof subject === "string" && subject ? subject : todo.content,
          });
    } else if (isTodoCall(payload.name)) {
      const call = written(payload.input);
      if (call) list = fold(list, call);
    }
  }
  return list && list.length > 0 ? list : null;
}

function createdTaskId(result: { text: string; structured?: unknown }): string | null {
  const task = (result.structured as { task?: { id?: unknown } } | null | undefined)?.task;
  if (typeof task?.id === "string" && task.id) return task.id;
  return /Task #(\S+) created/.exec(result.text)?.[1] ?? null;
}

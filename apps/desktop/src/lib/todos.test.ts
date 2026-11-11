import { describe, expect, it } from "vitest";

import { planAsked } from "./plan";
import { currentTodos, isTodoCall, startsNewList, todoList } from "./todos";
import { namedParts } from "./tools";
import type { AgentEvent } from "@/types/events";

function toolCall(name: string, input: unknown): AgentEvent {
  return {
    payload: { type: "tool_call_started", name, input },
  } as unknown as AgentEvent;
}

describe("todoList", () => {
  it("reads both harnesses' spelling of the same list", () => {
    const claude = { todos: [{ content: "Fix it", status: "in_progress" }] };
    const grok = { merge: false, todos: [{ content: "Fix it", id: "1", status: "in_progress" }] };

    expect(todoList("TodoWrite", claude)).toEqual([
      { content: "Fix it", status: "in_progress", id: undefined },
    ]);
    expect(todoList("todo_write", grok)).toEqual([
      { content: "Fix it", status: "in_progress", id: "1" },
    ]);
  });

  it("reads an unknown status as pending rather than dropping the row", () => {
    const list = todoList("todo_write", { todos: [{ content: "Wait", status: "deferred" }] });
    expect(list?.[0].status).toBe("pending");
  });

  it("answers null for anything that is not a task list", () => {
    expect(todoList("Bash", { todos: [{ content: "x", status: "pending" }] })).toBeNull();
    expect(todoList("todo_write", { todos: [] })).toBeNull();
    expect(todoList("todo_write", { todos: "soon" })).toBeNull();
  });
});

function result(callId: string, text: string, structured: unknown = null, isError = false): AgentEvent {
  return {
    payload: { type: "tool_call_completed", callId, result: { text, structured, isError } },
  } as unknown as AgentEvent;
}

function create(callId: string, subject: string, id: string): AgentEvent[] {
  return [
    { payload: { type: "tool_call_started", callId, name: "TaskCreate", input: { subject } } } as unknown as AgentEvent,
    result(callId, `Task #${id} created successfully: ${subject}`, { task: { id, subject } }),
  ];
}

describe("Codex's update_plan", () => {
  it("reads steps and the live protocol's camelCase status", () => {
    const plan = { explanation: null, plan: [{ step: "Read", status: "completed" }, { step: "Fix", status: "inProgress" }] };
    expect(isTodoCall("update_plan")).toBe(true);
    expect(todoList("update_plan", plan)?.map((todo) => [todo.content, todo.status])).toEqual([
      ["Read", "completed"],
      ["Fix", "in_progress"],
    ]);
    expect(currentTodos([toolCall("update_plan", plan)])).toHaveLength(2);
  });
});

// Shapes from fixtures/task_list.jsonl (v2.1.322), as the mapper hands them on.
describe("Claude Code's TaskCreate and TaskUpdate", () => {
  it("builds the list a task at a time and joins updates on the result's id", () => {
    const events = [
      ...create("a", "Think", "1"),
      ...create("b", "Count", "2"),
      toolCall("TaskUpdate", { taskId: "1", status: "completed" }),
      toolCall("TaskUpdate", { taskId: "2", status: "in_progress" }),
    ];
    expect(currentTodos(events)).toEqual([
      { content: "Think", status: "completed", id: "1" },
      { content: "Count", status: "in_progress", id: "2" },
    ]);
  });

  it("joins parallel creates to their own results", () => {
    const [startA, doneA] = create("a", "Think", "1");
    const [startB, doneB] = create("b", "Count", "2");
    const events = [startA, startB, doneB, doneA, toolCall("TaskUpdate", { taskId: "2", status: "completed" })];
    expect(currentTodos(events)?.map((todo) => todo.status)).toEqual(["pending", "completed"]);
  });

  it("falls back to the result's sentence for the id", () => {
    const [start] = create("a", "Think", "7");
    const events = [start, result("a", "Task #7 created successfully: Think"), toolCall("TaskUpdate", { taskId: "7", status: "completed" })];
    expect(currentTodos(events)?.[0]).toEqual({ content: "Think", status: "completed", id: "7" });
  });

  it("shows a task before its create answers, and drops one that failed", () => {
    const [start] = create("a", "Think", "1");
    expect(currentTodos([start])).toEqual([{ content: "Think", status: "pending" }]);
    expect(currentTodos([start, result("a", "nope", null, true)])).toBeNull();
  });

  it("starts a new list once the old one has nothing left open", () => {
    const events = [
      ...create("a", "Think", "1"),
      toolCall("TaskUpdate", { taskId: "1", status: "completed" }),
      ...create("b", "Next job", "2"),
    ];
    expect(currentTodos(events)?.map((todo) => todo.content)).toEqual(["Next job"]);
  });

  it("removes a deleted task and renames on a new subject", () => {
    const events = [
      ...create("a", "Think", "1"),
      ...create("b", "Count", "2"),
      toolCall("TaskUpdate", { taskId: "1", status: "deleted" }),
      toolCall("TaskUpdate", { taskId: "2", subject: "Count to 3" }),
    ];
    expect(currentTodos(events)).toEqual([{ content: "Count to 3", status: "pending", id: "2" }]);
  });
});

describe("currentTodos", () => {
  const pending = [{ content: "Fix it", status: "pending" }];
  const done = [{ content: "Fix it", status: "completed" }];

  it("takes the newest list, since a write replaces rather than adds", () => {
    const events = [
      toolCall("todo_write", { todos: [{ content: "Old", status: "pending" }] }),
      toolCall("Bash", { command: "ls" }),
      toolCall("todo_write", { todos: pending }),
    ];
    expect(currentTodos(events)?.[0].content).toBe("Fix it");
  });

  it("keeps a finished list, which the strip folds rather than dropping", () => {
    expect(currentTodos([toolCall("todo_write", { todos: done })])).toEqual([
      { content: "Fix it", status: "completed", id: undefined },
    ]);
  });

  it("answers null for a session that never wrote one", () => {
    expect(currentTodos([toolCall("Bash", { command: "ls" })])).toBeNull();
  });

  // grok ticks an item off with `merge: true` and sends `id` and `status` and
  // no text at all, which read as a list in its own right is rows with nothing
  // to say — the reading that lost the whole checklist and drew raw JSON in
  // its place. Folded forwards, the words come from the write that had them.
  it("folds a merge update onto the list it updates", () => {
    const events = [
      toolCall("todo_write", {
        merge: false,
        todos: [
          { id: "1", content: "Read it", status: "in_progress" },
          { id: "2", content: "Fix it", status: "pending" },
        ],
      }),
      toolCall("todo_write", {
        merge: true,
        todos: [
          { id: "1", status: "completed" },
          { id: "2", status: "in_progress" },
        ],
      }),
    ];

    expect(currentTodos(events)).toEqual([
      { content: "Read it", status: "completed", id: "1" },
      { content: "Fix it", status: "in_progress", id: "2" },
    ]);
  });

  // A child runs its own context and keeps its own list, so folding its writes
  // in would let a subagent replace what the conversation is tracking — and
  // `startsNewList` would then read that as news and open the pane on somebody
  // else's work.
  it("ignores a subagent's own list", () => {
    const child = toolCall("todo_write", { todos: [{ content: "Child step", status: "pending" }] });
    (child as { subagent: unknown }).subagent = { id: "a1", label: "explore" };

    const events = [
      toolCall("todo_write", { todos: [{ content: "Parent step", status: "in_progress" }] }),
      child,
    ];

    expect(currentTodos(events)?.map((todo) => todo.content)).toEqual(["Parent step"]);
  });

  it("appends an id the list has not met, where it brings words of its own", () => {
    const events = [
      toolCall("todo_write", { todos: [{ id: "1", content: "Read it", status: "pending" }] }),
      toolCall("todo_write", {
        merge: true,
        todos: [{ id: "2", content: "Ship it", status: "pending" }],
      }),
    ];

    expect(currentTodos(events)?.map((todo) => todo.content)).toEqual(["Read it", "Ship it"]);
  });
});

describe("todoList against a merge update", () => {
  // The row's reading and the panel's are two questions. A merge update draws
  // no checklist — there is nothing in it to draw — but it is still a todo
  // call, which is what makes the row drop its arguments rather than expanding
  // onto the bare ids.
  it("is a todo call with no list to draw", () => {
    const merge = { merge: true, todos: [{ id: "1", status: "completed" }] };
    expect(isTodoCall("todo_write")).toBe(true);
    expect(todoList("todo_write", merge)).toBeNull();
  });
});

describe("startsNewList", () => {
  const todo = (content: string, status = "pending") =>
    ({ content, status }) as Parameters<typeof startsNewList>[1][number];

  it("is not news when an item is ticked off, which is most writes", () => {
    const before = [todo("Read it"), todo("Fix it")];
    const after = [todo("Read it", "completed"), todo("Fix it", "in_progress")];
    expect(startsNewList(before, after)).toBe(false);
  });

  it("is not news when a step is added to work already under way", () => {
    const before = [todo("Read it")];
    expect(startsNewList(before, [todo("Read it"), todo("Fix it")])).toBe(false);
  });

  it("is news for the session's first list", () => {
    expect(startsNewList(null, [todo("Read it")])).toBe(true);
  });

  it("is news when the plan is finished and different work starts", () => {
    const before = [todo("Read it", "completed"), todo("Fix it", "completed")];
    expect(startsNewList(before, [todo("Ship it"), todo("Write it up")])).toBe(true);
  });
});

describe("namedParts", () => {
  it("splits a namespaced tool id and title-cases both halves", () => {
    expect(namedParts("supermemory-ai__search_supermemory_memory_api_for")).toEqual({
      server: "Supermemory Ai",
      method: "Search Supermemory Memory Api For",
    });
  });

  it("refuses anything that is not two identifier runs", () => {
    expect(namedParts("run_terminal_command")).toBeNull();
    expect(namedParts("cat a__b.txt | wc -l")).toBeNull();
    expect(namedParts("/tmp/a__b/c")).toBeNull();
  });
});

describe("planAsked", () => {
  it("reads the plan off either harness's tool name", () => {
    expect(planAsked("exit_plan_mode", { plan: "## Step one" })).toBe("## Step one");
    expect(planAsked("ExitPlanMode", { plan: "## Step one" })).toBe("## Step one");
  });

  it("answers null for a tool that merely carries a plan field", () => {
    expect(planAsked("Bash", { plan: "## Step one" })).toBeNull();
    expect(planAsked("exit_plan_mode", { plan: "  " })).toBeNull();
    expect(planAsked("exit_plan_mode", {})).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { step, visit, type NavHistory, type Place } from "./navHistory";

const tasks = (sessionId: string | null): Place => ({ page: "tasks", sessionId });
const issues: Place = { page: "issues", sessionId: "a" };
const all = () => true;

const walk = (...places: Place[]) =>
  places.reduce<NavHistory>((h, p) => visit(h, p), { stack: [tasks(null)], index: 0 });

describe("nav history", () => {
  it("records new places and ignores the one it is on", () => {
    const h = walk(tasks("a"), tasks("a"), issues, { page: "issues", sessionId: "b" });
    expect(h.stack).toHaveLength(3);
    expect(h.index).toBe(2);
  });

  it("steps back and forward, and a new visit drops what was ahead", () => {
    let h = walk(tasks("a"), issues);
    const back = step(h, -1, all)!;
    expect(back.place).toEqual(tasks("a"));
    h = back.history;
    expect(step(h, 1, all)!.place).toEqual(issues);
    h = visit(h, tasks("b"));
    expect(h.stack.map((p) => p.sessionId)).toEqual([null, "a", "b"]);
    expect(step(h, 1, all)).toBeNull();
  });

  it("steps over places that can no longer be shown", () => {
    const h = walk(tasks("gone"), tasks("b"));
    expect(step(h, -1, (p) => p.sessionId !== "gone")!.place).toEqual(tasks(null));
    expect(step(walk(tasks("gone")), -1, (p) => p.sessionId === "gone")).toBeNull();
  });
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@/lib/transport";
import { CanvasSession, openCanvasDocument } from "./useCanvasDocument";
import type { Document } from "./document";

vi.mock("@/lib/transport", () => ({ invoke: vi.fn() }));
const original = JSON.stringify({ version: 1, elements: [] });
let disk: string;
const file = { project: "/studio", folder: "", name: "test" };
const background =
  (value: string) =>
  (d: Document): Document => ({
    ...d,
    pages: [{ ...d.pages[0], background: value }],
  });

beforeEach(() => {
  vi.useFakeTimers();
  disk = original;
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command, args) => {
      if (command === "read_canvas_document") return disk;
      if (command !== "save_canvas_document") throw new Error("Unexpected command");
      if (args?.previous !== disk) throw new Error("Canvas changed on disk");
      disk = String(args.content);
    });
});
afterEach(() => vi.useRealTimers());

it("coalesces continuous edits into one save and undo step", async () => {
  const session = new CanvasSession(file);
  await session.load();
  session.change(background("red"));
  for (let i = 0; i < 100; i++) session.change(background(String(i)), "typing");
  expect(invoke).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(250);
  expect(invoke).toHaveBeenCalledTimes(2);
  session.travel(false);
  expect(session.get().doc?.pages[0].background).toBe("red");
  session.travel(false);
  expect(session.get().doc?.pages[0].background).toBe("#282828");
  await session.flush();
});

it("refreshes clean documents and preserves edits made while a refresh was in flight", async () => {
  const session = new CanvasSession(file);
  await session.load();
  disk = JSON.stringify(background("blue")(session.get().doc!));
  await session.load(true);
  expect(session.get().doc?.pages[0].background).toBe("blue");
  const refresh = session.load(true);
  session.change(background("green"));
  await refresh;
  expect(session.get().doc?.pages[0].background).toBe("green");
  await session.flush();
});

it("keeps local edits on conflict and compares again if the external revision changes", async () => {
  const session = new CanvasSession(file);
  await session.load();
  session.change(background("green"));
  disk = JSON.stringify(background("red")(session.get().doc!));
  await session.flush();
  expect(session.get().conflict).toBe(true);
  const newer = JSON.stringify(background("blue")(session.get().doc!));
  disk = newer;
  await session.keepMine();
  expect(disk).toBe(newer);
  expect(session.get().conflict).toBe(true);
  await session.keepMine();
  expect(JSON.parse(disk).pages[0].background).toBe("green");
  expect(session.get().conflict).toBe(false);
});

it("flushes pending edits when the tab closes", async () => {
  const session = new CanvasSession(file);
  const close = session.subscribe(() => {});
  await session.load();
  session.change(background("green"));
  close();
  await Promise.resolve();
  expect(JSON.parse(disk).pages[0].background).toBe("green");
});

it("keeps edits and a delivered pin together when a canvas is reopened during send", async () => {
  const session = openCanvasDocument(file);
  const close = session.subscribe(() => {});
  await session.load();
  const pin = { id: "corner", text: "Round this", x: 15, y: 30 };
  let deliver!: () => void;
  const sending = session.sendComment("page-1", pin, () => new Promise(resolve => { deliver = resolve; }));
  close();
  await Promise.resolve();
  const reopened = openCanvasDocument(file);
  expect(reopened).toBe(session);
  const leave = reopened.subscribe(() => {});
  reopened.change(background("green"));
  deliver();
  await sending;
  await reopened.flush();
  expect(JSON.parse(disk).pages[0]).toMatchObject({ background: "green", comments: [pin] });
  leave();
});

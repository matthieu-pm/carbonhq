import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke, listen } from "@/lib/transport";
import { watchDocs } from "@/lib/servers";
import { CanvasSession, openCanvasDocument, relocateCanvasDocument } from "./useCanvasDocument";
import type { Document } from "./document";

vi.mock("@/lib/transport", async (original) => ({
  ...await original<typeof import("@/lib/transport")>(),
  invoke: vi.fn(),
  listen: vi.fn(),
}));
vi.mock("@/lib/servers", () => ({ watchDocs: vi.fn().mockResolvedValue(undefined) }));
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
  await vi.waitFor(() => expect(JSON.parse(disk).pages?.[0].background).toBe("green"));
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

it("a CLI flush waits for the editor's pending save", async () => {
  const session = new CanvasSession(file);
  await session.load();
  session.change(background("blue"));
  let finish!: () => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const originalSave = session.flush();
  let answered = false;
  const cliSave = session.flush().then(() => { answered = true; });
  await Promise.resolve();
  expect(answered).toBe(false);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  finish();
  await Promise.all([originalSave, cliSave]);
  expect(answered).toBe(true);
});

it("waits for an outstanding read and picks up the next CLI edit before returning", async () => {
  const session = new CanvasSession(file);
  await session.load();
  let finish!: (raw: string) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
  const pending = session.load(true);
  disk = JSON.stringify(background("red")(session.get().doc!));
  let answered = false;
  const command = session.synchronize().then(() => { answered = true; });
  await Promise.resolve();
  expect(answered).toBe(false);
  finish(original);
  await Promise.all([pending, command]);
  expect(session.get().doc?.pages[0].background).toBe("red");
});

it("keeps dirty edits through a move during a write and through archive and restore", async () => {
  const source = { ...file, name: "relocated" };
  const moved = { ...source, folder: "design" };
  const session = openCanvasDocument(source);
  const close = session.subscribe(() => {});
  await session.load();
  session.change(background("green"));
  let fail!: (error: Error) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  const writing = session.flush();
  await vi.waitFor(() => expect(fail).toBeTypeOf("function"));
  relocateCanvasDocument(source, moved, false);
  expect(openCanvasDocument(moved)).toBe(session);
  fail(Error("source moved"));
  await writing;
  expect(invoke).toHaveBeenLastCalledWith("save_canvas_document", expect.objectContaining({ folder: "design", archived: false }));
  expect(JSON.parse(disk).pages[0].background).toBe("green");

  session.change(background("blue"));
  relocateCanvasDocument(moved, moved, true);
  await session.flush();
  expect(invoke).toHaveBeenLastCalledWith("save_canvas_document", expect.objectContaining({ folder: "design", archived: true }));
  relocateCanvasDocument(moved, moved, false, true);
  expect(openCanvasDocument(moved)).toBe(session);
  expect(JSON.parse(disk).pages[0].background).toBe("blue");
  close();
});

it("discards focused and debounced edits when reloading the document", async () => {
  const session = new CanvasSession(file);
  await session.load();
  session.change(background("red"));
  await session.reload(() => session.change(background("green")));
  await vi.advanceTimersByTimeAsync(300);
  expect(session.get().doc?.pages[0].background).toBe("#282828");
  expect(disk).toBe(original);
});

it("shows successive file edits on the open canvas without a CLI event or refocus", async () => {
  const file = { project: "carbon://mac/studio", folder: "design/mobile", name: "Home" };
  const path = "carbon://mac/studio/canvases/design/mobile/Home.canvas.json";
  const handlers = new Map<string, (event: { payload: string; server: string }) => void>();
  vi.mocked(listen<string>).mockImplementation(async (name, callback) => {
    handlers.set(name, event => callback({ ...event, event: name, id: 0 }));
    return () => { handlers.delete(name); };
  });
  const session = new CanvasSession(file);
  await session.load();
  const close = session.watchFile();
  await vi.advanceTimersByTimeAsync(0);
  const scope = vi.mocked(watchDocs).mock.calls[0][0];
  expect(watchDocs).toHaveBeenCalledWith(scope, [path]);

  for (const color of ["blue", "green"]) {
    disk = JSON.stringify(background(color)(session.get().doc!));
    handlers.get("doc_changed")?.({ payload: path, server: "mac" });
    await vi.advanceTimersByTimeAsync(0);
    expect(session.get().doc?.pages[0].background).toBe(color);
  }
  disk = JSON.stringify(background("red")(session.get().doc!));
  handlers.get("doc_changed")?.({ payload: path + ".other", server: "mac" });
  await vi.advanceTimersByTimeAsync(0);
  expect(session.get().doc?.pages[0].background).toBe("green");
  handlers.get("live_state")?.({ payload: "", server: "mac" });
  await vi.advanceTimersByTimeAsync(0);
  expect(session.get().doc?.pages[0].background).toBe("red");

  close();
  await vi.advanceTimersByTimeAsync(0);
  expect(watchDocs).toHaveBeenLastCalledWith(scope, []);
  expect(handlers.size).toBe(0);
});

it("keeps the agent preview out of local edits and undo history", async () => {
  const session = new CanvasSession(file);
  await session.load();
  const saved = session.get().doc!;
  const preview = JSON.stringify(background("blue")(saved));
  vi.mocked(invoke).mockResolvedValueOnce({ content: original, preview });
  await session.load(true);
  expect(session.get().doc).toBe(saved);
  expect(session.get().preview?.pages[0].background).toBe("blue");
  expect(session.travel(false)).toBeUndefined();
  session.change(background("green"));
  expect(session.get().preview).toBeNull();
  await session.flush();
  expect(JSON.parse(disk).pages[0].background).toBe("green");
});

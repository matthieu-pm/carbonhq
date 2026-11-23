import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@/lib/transport";
import { CanvasSession, openCanvasDocument } from "./useCanvasDocument";
import { canvasContent, CanvasSaveState, type CanvasSaveRequest } from "./canvasSave";
import { newLayer, readDocument, type Document } from "./document";

vi.mock("@/lib/transport", () => ({ invoke: vi.fn() }));
const file = { project: "/studio", folder: "", name: "worker" };
const original = JSON.stringify({ version: 1, elements: [] });
const largeOriginal = original + " ".repeat(1 << 19);
let disk: string;
let unknownGzip = false;
let prepareGate: Promise<void> | undefined;
let holdWrite: (() => Promise<void>) | undefined;
let matchGate: Promise<void> | undefined;
const background =
  (color: string) =>
  (doc: Document): Document => ({ ...doc, pages: [{ ...doc.pages[0], background: color }] });

class SaveWorker {
  static instances: SaveWorker[] = [];
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  state = new CanvasSaveState();
  queue = Promise.resolve();
  terminated = false;
  requests: CanvasSaveRequest[] = [];
  constructor() {
    SaveWorker.instances.push(this);
  }
  postMessage(message: { id: number; request: CanvasSaveRequest }) {
    const { id, request } = structuredClone(message);
    this.requests.push(request);
    this.queue = this.queue.then(async () => {
      if (request.type === "prepare") await prepareGate;
      if (request.type === "matches") await matchGate;
      try {
        const result = await this.state.request(request);
        if (!this.terminated) this.onmessage?.({ data: { id, result } });
      } catch (error) {
        this.onmessage?.({ data: { id, error: String(error) } });
      }
    });
  }
  terminate() {
    this.terminated = true;
  }
}

beforeEach(() => {
  disk = largeOriginal;
  unknownGzip = false;
  prepareGate = undefined;
  holdWrite = undefined;
  matchGate = undefined;
  SaveWorker.instances = [];
  vi.stubGlobal("Worker", SaveWorker);
  vi.mocked(invoke)
    .mockReset()
    .mockImplementation(async (command, args) => {
      if (command === "read_canvas_document") return disk;
      await holdWrite?.();
      if (command === "save_canvas_document_gzip") {
        if (unknownGzip) throw Error("unknown command: save_canvas_document_gzip");
        if (args?.previous !== createHash("sha256").update(disk).digest("hex"))
          throw Error("Canvas changed on disk");
        disk = gunzipSync(Buffer.from(String(args.content), "base64")).toString();
      } else {
        if (args?.previous !== disk) throw Error("Canvas changed on disk");
        disk = String(args.content);
      }
    });
});
afterEach(() => vi.unstubAllGlobals());
const tick = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

it("keeps queued edits, concurrent flushes, undo and redo through a delayed worker save", async () => {
  const session = new CanvasSession(file);
  await session.load();
  let release!: () => void;
  prepareGate = new Promise((resolve) => {
    release = resolve;
  });
  session.change(background("red"));
  const first = session.flush();
  await tick();
  let answered = false;
  const second = session.flush().then(() => {
    answered = true;
  });
  session.change(background("blue"));
  session.travel(false);
  session.travel(true);
  expect(answered).toBe(false);
  release();
  await Promise.all([first, second]);
  expect(disk).toBe(canvasContent(session.get().doc!));
  expect(JSON.parse(disk).pages[0].background).toBe("blue");
  expect(SaveWorker.instances[0].requests.filter((r) => r.type === "prepare")).toHaveLength(2);
});

it("checks the acknowledged revision after conflicts and on each keep-local retry", async () => {
  const session = new CanvasSession(file);
  await session.load();
  session.change(background("green"));
  disk = original + " ";
  await session.flush();
  expect(session.get().conflict).toBe(true);
  const local = session.get().doc;
  await session.load(true);
  expect(session.get().doc).toBe(local);
  expect(session.get().conflict).toBe(true);
  disk = original + "  ";
  await session.keepMine();
  expect(session.get().conflict).toBe(true);
  expect(disk).toBe(original + "  ");
  await session.keepMine();
  expect(session.get().conflict).toBe(false);
  expect(disk).toBe(canvasContent(session.get().doc!));
  const saved = session.get().doc;
  await session.load(true);
  expect(session.get().doc).toBe(saved);
  disk = canvasContent(background("blue")(readDocument(disk)));
  await session.load(true);
  session.change(background("red"));
  await session.flush();
  expect(disk).toBe(canvasContent(session.get().doc!));
  expect(JSON.parse(disk).pages[0].background).toBe("red");
});

it("flushes the last queued change after closing and releases the worker only after saving", async () => {
  const session = openCanvasDocument({ ...file, name: "closing-worker" });
  const close = session.subscribe(() => {});
  await session.load();
  let release!: () => void;
  holdWrite = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  session.change(background("red"));
  const saving = session.flush();
  await tick();
  session.change(background("blue"));
  close();
  await tick();
  expect(SaveWorker.instances[0].terminated).toBe(false);
  holdWrite = undefined;
  release();
  await saving;
  expect(JSON.parse(disk).pages[0].background).toBe("blue");
  expect(SaveWorker.instances[0].terminated).toBe(true);
});

it("keeps edits made while an external refresh is comparing revisions", async () => {
  const session = new CanvasSession(file);
  await session.load();
  disk = original + " ";
  let release!: () => void;
  matchGate = new Promise((resolve) => {
    release = resolve;
  });
  const refresh = session.load(true);
  await tick();
  session.change(background("green"));
  release();
  await refresh;
  expect(session.get().doc?.pages[0].background).toBe("green");
  await session.flush();
  expect(session.get().conflict).toBe(true);
});

it("uses the exact raw revision for old-server gzip fallback and clean refreshes", async () => {
  disk = original + " ".repeat(1 << 20);
  unknownGzip = true;
  const session = new CanvasSession(file);
  await session.load();
  session.change(background("green"));
  await session.flush();
  expect(invoke).toHaveBeenCalledWith("save_canvas_document_gzip", expect.anything());
  expect(session.get().error).toBe("");
  expect(disk).toBe(canvasContent(session.get().doc!));
  const doc = session.get().doc;
  await session.load(true);
  expect(session.get().doc).toBe(doc);
  disk = canvasContent(background("blue")(readDocument(disk)));
  await session.load(true);
  expect(session.get().doc?.pages[0].background).toBe("blue");
});

it("falls back when worker construction or startup is blocked", async () => {
  vi.stubGlobal(
    "Worker",
    class {
      constructor() {
        throw Error("blocked");
      }
    },
  );
  const session = new CanvasSession(file);
  await session.load();
  session.change(background("green"));
  await session.flush();
  expect(disk).toBe(canvasContent(session.get().doc!));
  vi.stubGlobal(
    "Worker",
    class extends SaveWorker {
      override postMessage() {}
    },
  );
  disk += " ".repeat(1 << 19);
  const second = new CanvasSession(file);
  await second.load();
  SaveWorker.instances[0].onerror?.();
  second.change(background("blue"));
  await second.flush();
  expect(disk).toBe(canvasContent(second.get().doc!));
});

it("recovers the exact saved revision if the worker fails after a gzip save", async () => {
  disk = original + " ".repeat(1 << 20);
  const session = new CanvasSession(file);
  await session.load();
  session.change(background("green"));
  await session.flush();
  session.change(background("blue"));
  SaveWorker.instances[0].onerror?.();
  await session.flush();
  expect(disk).toBe(canvasContent(session.get().doc!));
  expect(session.get().doc?.pages[0].background).toBe("blue");
  expect(session.get().error).toBe("");
});

it("retries a failed write and can undo an unacknowledged worker revision", async () => {
  const session = new CanvasSession(file);
  await session.load();
  const before = disk;
  session.change(background("red"));
  vi.mocked(invoke).mockRejectedValueOnce(Error("connection dropped"));
  await session.flush();
  expect(disk).toBe(before);
  expect(session.get().error).toContain("connection dropped");
  session.travel(false);
  await session.flush();
  expect(disk).toBe(before);
  session.travel(true);
  await session.flush();
  expect(disk).toBe(canvasContent(session.get().doc!));
  expect(JSON.parse(disk).pages[0].background).toBe("red");
});

it("falls back without losing edits when a worker dies during preparation", async () => {
  const session = new CanvasSession(file);
  await session.load();
  let release!: () => void;
  prepareGate = new Promise((resolve) => {
    release = resolve;
  });
  session.change(background("red"));
  const saving = session.flush();
  await tick();
  session.change(background("blue"));
  SaveWorker.instances[0].onerror?.();
  await saving;
  expect(disk).toBe(canvasContent(session.get().doc!));
  expect(JSON.parse(disk).pages[0].background).toBe("blue");
  expect(session.get().error).toBe("");
  release();
});

it("keeps small canvases on the direct save path", async () => {
  disk = original;
  const session = new CanvasSession(file);
  await session.load();
  session.change(background("green"));
  await session.flush();
  expect(SaveWorker.instances).toHaveLength(0);
  expect(disk).toBe(canvasContent(session.get().doc!));
});

it("promotes a small canvas when a pasted layer introduces a large string", async () => {
  disk = original;
  const session = new CanvasSession(file);
  await session.load();
  session.change(background("green"));
  await session.flush();
  const previous = disk;
  session.change((doc) => ({
    ...doc,
    elements: [
      {
        id: "pasted",
        page: "page-1",
        parent: null,
        kind: "Text",
        name: "text",
        text: "é".repeat(1 << 19),
        x: 0,
        y: 0,
        style: {},
        effects: [],
      },
    ],
  }));
  await session.flush();
  expect(SaveWorker.instances).toHaveLength(1);
  expect(SaveWorker.instances[0].requests[0]).toEqual({ type: "reset", raw: previous });
  expect(disk).toBe(canvasContent(session.get().doc!));
  session.change(background("blue"));
  await session.flush();
  expect(disk).toBe(canvasContent(session.get().doc!));
});

it("falls back if startup cannot deliver a message", async () => {
  vi.stubGlobal(
    "Worker",
    class extends SaveWorker {
      override postMessage() {}
    },
  );
  const session = new CanvasSession(file);
  await session.load();
  SaveWorker.instances[0].onmessageerror?.();
  session.change(background("green"));
  await session.flush();
  expect(disk).toBe(canvasContent(session.get().doc!));
  expect(session.get().error).toBe("");
});

it("recovers after a postMessage failure and retries against the exact disk revision", async () => {
  const session = new CanvasSession(file);
  await session.load();
  await tick();
  const before = disk;
  vi.spyOn(SaveWorker.instances[0], "postMessage").mockImplementationOnce(() => {
    throw Error("post failed");
  });
  vi.mocked(invoke).mockRejectedValueOnce(Error("write failed"));
  session.change(background("red"));
  await session.flush();
  expect(disk).toBe(before);
  expect(session.get().error).toContain("write failed");
  session.change(background("blue"));
  await session.flush();
  expect(disk).toBe(canvasContent(session.get().doc!));
  expect(session.get().error).toBe("");
});

it("recovers from a prepare error reply before the worker applies the patch", async () => {
  const session = new CanvasSession(file);
  await session.load();
  await tick();
  vi.spyOn(SaveWorker.instances[0].state, "request").mockRejectedValueOnce(Error("prepare failed"));
  session.change(background("red"));
  await session.flush();
  expect(disk).toBe(canvasContent(session.get().doc!));
  session.change(background("blue"));
  await session.flush();
  expect(disk).toBe(canvasContent(session.get().doc!));
  expect(session.get().error).toBe("");
});

it("recovers when a prepared response cannot be delivered", async () => {
  const session = new CanvasSession(file);
  await session.load();
  await tick();
  let release!: () => void;
  prepareGate = new Promise((resolve) => {
    release = resolve;
  });
  session.change(background("red"));
  const saving = session.flush();
  await tick();
  SaveWorker.instances[0].onmessageerror?.();
  await saving;
  expect(disk).toBe(canvasContent(session.get().doc!));
  expect(session.get().error).toBe("");
  release();
});

it("keeps only local content when a conflict makes a small canvas eligible for a worker", async () => {
  disk = original;
  const session = new CanvasSession(file);
  await session.load();
  session.change(background("green"));
  disk = canvasContent({ ...readDocument(original), elements: [newLayer("Rectangle", "page-1", null, 0, 0)] }) + " ".repeat(1 << 19);
  await session.flush();
  expect(session.get().conflict).toBe(true);
  await session.keepMine();
  expect(session.get().error).toBe("");
  expect(disk).toBe(canvasContent(session.get().doc!));
});

it("keeps the worker alive through a queued refresh after the last tab closes", async () => {
  const session = openCanvasDocument({ ...file, name: "closing-refresh" });
  const close = session.subscribe(() => {});
  await session.load();
  let finish!: (value: string) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
  const firstRead = session.load(true);
  void session.load(true);
  close();
  await tick();
  expect(SaveWorker.instances[0].terminated).toBe(false);
  finish(disk);
  await firstRead;
  await tick();
  expect(SaveWorker.instances.map(worker => worker.terminated)).toEqual([true]);
});

import { describe, expect, it, vi } from "vitest";
import { invoke, listen, type ServerEvent } from "@/lib/transport";
import { watchCanvasReference } from "./canvasReferences";

vi.mock("@/lib/transport", () => ({ invoke: vi.fn(), listen: vi.fn() }));

describe("Canvas reference watches", () => {
  it("shares a watch, rearms it on reconnect, and releases it after the last chip leaves", async () => {
    const handlers = new Map<string, (event: ServerEvent<unknown>) => void>();
    vi.mocked(invoke).mockResolvedValue(undefined);
    vi.mocked(listen).mockImplementation(async (event, callback) => {
      handlers.set(event, callback as (event: ServerEvent<unknown>) => void);
      return () => { handlers.delete(event); };
    });
    const emit = (event: string, server: string, payload: unknown = null) =>
      handlers.get(event)?.({ event, server, payload, id: 0 });
    const first = vi.fn(), second = vi.fn();
    const closeFirst = watchCanvasReference("owner", "canvas", first);
    const closeSecond = watchCanvasReference("owner", "canvas", second);
    expect(invoke).toHaveBeenCalledTimes(1);
    const [, subscription] = vi.mocked(invoke).mock.calls[0];

    emit("live_state", "other");
    expect(invoke).toHaveBeenCalledTimes(1);
    emit("live_state", "owner");
    expect(invoke).toHaveBeenLastCalledWith("watch_canvases", subscription, "owner");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    closeFirst();
    emit("canvas_deleted", "owner", { id: "canvas" });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    closeSecond();
    expect(invoke).toHaveBeenLastCalledWith("watch_canvases", { ...subscription, ids: [] }, "owner");
    await Promise.resolve();
    expect(handlers.size).toBe(0);
  });
});

import { beforeEach, expect, it, vi } from "vitest";
import { useCanvasWindow, type WindowRequest } from "@/lib/canvasWindow";
import { useCanvasDesktop } from "./useCanvasDesktop";

vi.mock("@/lib/canvasWindow", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/canvasWindow")>(),
  useCanvasWindow: vi.fn(),
  canvasWindowPart: () => "selected",
}));

const active = { project: "/repo", folder: "mobile", name: "checkout" };

beforeEach(() => {
  vi.clearAllMocks();
});

async function request(command: WindowRequest["command"], canvas: string | null = null, session_id?: string) {
  const ui = {
    visible: true,
    library: { active, refresh: vi.fn() },
  } as unknown as Parameters<typeof useCanvasDesktop>[0];
  useCanvasDesktop(ui);
  const [[handle]] = vi.mocked(useCanvasWindow).mock.calls;
  return handle({ project: active.project, folder: "", canvas, command, session_id });
}

it("reports the actual canvas for a session acting on the active editor", async () => {
  const tool = { group: "view", args: { op: "tool", tool: "Pen" } } as const;
  await expect(request(tool, null, "session")).resolves.toEqual({ usedCanvas: active, canvasResult: "selected" });
  await expect(request(tool)).resolves.toBe("selected");
  await expect(request(tool, "missing", "session")).rejects.toThrow("Open the target canvas");
});

it("refreshing the library ignores a supplied canvas name", async () => {
  await expect(request({ group: "view", args: { op: "refresh" } }, "missing", "session")).resolves.toBeUndefined();
});

import { beforeEach, describe, expect, it, vi } from "vitest";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/transport", () => ({ invoke, LOCAL: "local", qualify: (path: string) => path, splitPath: (path: string) => ({ server: "local", path }) }));
import { readPage } from "./pages";
const page = { id: "019a1234-abcd-7000-8000-123456789abc", server: "local", revision: 2, projectPaths: [] };
beforeEach(() => { invoke.mockReset(); invoke.mockResolvedValue(page); });
describe("Current and historical Page reads", () => {
  it("reads current content even when a cached summary carries an older revision", async () => {
    await readPage(page);
    expect(invoke).toHaveBeenCalledWith("read_page", { id: page.id }, "local");
  });
  it("reads a historical version only when explicitly requested", async () => {
    await readPage(page, 1);
    expect(invoke).toHaveBeenCalledWith("read_page_version", { id: page.id, version: 1 }, "local");
  });
});

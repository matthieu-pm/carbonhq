import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@/lib/transport", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

let storage: Map<string, string>;
let styles: Map<string, string>;

beforeEach(() => {
  vi.resetModules();
  invoke.mockReset();
  storage = new Map();
  styles = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.stubGlobal("document", {
    documentElement: { style: {
      setProperty: (key: string, value: string) => styles.set(key, value),
      removeProperty: (key: string) => styles.delete(key),
    } },
  });
});

describe("main font", () => {
  it("restores a selection after a fresh module load and resets to the default", async () => {
    let fonts = await import("./fonts");
    invoke.mockResolvedValue(["Arial", "Times New Roman"]);
    await fonts.refreshFonts();
    fonts.setMainFont("Times New Roman");
    expect(styles.get("--app-font")).toBe('"Times New Roman", \'Geist Variable\', sans-serif');
    expect(storage.get(fonts.MAIN_FONT_KEY)).toBe('"Times New Roman"');

    vi.resetModules();
    styles.clear();
    fonts = await import("./fonts");
    fonts.applyStoredFont();
    await fonts.refreshFonts();
    expect(styles.get("--app-font")).toContain('"Times New Roman"');
    fonts.setMainFont(null);
    expect(styles.has("--app-font")).toBe(false);
    expect(storage.get(fonts.MAIN_FONT_KEY)).toBe("null");
  });

  it("uses Geist when a font is removed and restores it if reinstalled", async () => {
    storage.set("ade.mainFont", '"Arial"');
    const fonts = await import("./fonts");
    invoke.mockResolvedValue([]);
    await fonts.refreshFonts();
    expect(styles.has("--app-font")).toBe(false);
    expect(storage.get(fonts.MAIN_FONT_KEY)).toBe('"Arial"');
    invoke.mockResolvedValue(["Arial"]);
    await fonts.refreshFonts();
    expect(styles.get("--app-font")).toContain('"Arial"');
  });

  it("falls back on a failed catalog read and recovers on retry", async () => {
    storage.set("ade.mainFont", '"Arial"');
    const fonts = await import("./fonts");
    fonts.applyStoredFont();
    invoke.mockRejectedValue(new Error("unavailable"));
    await fonts.refreshFonts();
    expect(styles.has("--app-font")).toBe(false);
    invoke.mockResolvedValue(["Arial"]);
    await fonts.refreshFonts();
    expect(styles.get("--app-font")).toContain('"Arial"');
  });

  it("does not apply a selection absent from the current catalog", async () => {
    const fonts = await import("./fonts");
    invoke.mockResolvedValue(["Arial"]);
    await fonts.refreshFonts();
    fonts.setMainFont("Missing font");
    expect(styles.has("--app-font")).toBe(false);
    expect(storage.has(fonts.MAIN_FONT_KEY)).toBe(false);
  });

  it("deduplicates reads without overwriting a choice made while one was pending", async () => {
    const fonts = await import("./fonts");
    invoke.mockResolvedValue(["Arial"]);
    await fonts.refreshFonts();
    let resolve!: (fonts: string[]) => void;
    invoke.mockImplementation(() => new Promise<string[]>((done) => { resolve = done; }));
    const first = fonts.refreshFonts();
    const second = fonts.refreshFonts();
    fonts.setMainFont("Arial");
    resolve(["Arial"]);
    await Promise.all([first, second]);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(styles.get("--app-font")).toContain('"Arial"');
  });

  it("rejects malformed preferences and quotes family names as one CSS string", async () => {
    const { coerceFont, fontStack } = await import("./fonts");
    for (const value of [null, 7, {}, [], "", "  ", "Bad\nfont", "Bad\u0000font"]) {
      expect(coerceFont(value)).toBe(null);
    }
    expect(fontStack('A "font", serif')).toBe('"A \\"font\\", serif", \'Geist Variable\', sans-serif');
    storage.set("ade.mainFont", "{");
    const fonts = await import("./fonts");
    fonts.applyStoredFont();
    expect(styles.has("--app-font")).toBe(false);
  });
});

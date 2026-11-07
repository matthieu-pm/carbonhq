import { describe, expect, it } from "vitest";

import { coerceFontSizes, DEFAULT_FONT_SIZES, diffMetrics, FONT_MAX, FONT_MIN } from "./fontSize";

describe("coerceFontSizes", () => {
  it("reads nothing as the defaults", () => {
    expect(coerceFontSizes(null)).toEqual(DEFAULT_FONT_SIZES);
    expect(coerceFontSizes("junk")).toEqual(DEFAULT_FONT_SIZES);
  });

  it("clamps, rounds, and drops the slots from before #295", () => {
    const out = coerceFontSizes({ ui: 1, code: 15.6, chat: 20, prompt: 18 });
    expect(out).toEqual({ ui: FONT_MIN, code: 16 });
    expect(coerceFontSizes({ ui: 99, code: "14" })).toEqual({ ui: FONT_MAX, code: DEFAULT_FONT_SIZES.code });
  });
});

describe("diffMetrics", () => {
  // The library's own 13px/20px, which its virtualizer assumes when not told.
  it("lands on the library's defaults at the default code size", () => {
    expect(diffMetrics(DEFAULT_FONT_SIZES.code)).toEqual({ fontSize: 13, lineHeight: 20 });
  });
});

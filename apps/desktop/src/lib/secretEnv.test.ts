import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import cases from "../../src-tauri/fixtures/secret_env.json";

describe("secret dotenv delivery", () => {
  it.each(cases.filter((c) => c.encoded !== null))("preserves $value in an actual env-file parser", ({ value, encoded }) => {
    expect(parseEnv(encoded!).TOKEN).toBe(value);
  });
});

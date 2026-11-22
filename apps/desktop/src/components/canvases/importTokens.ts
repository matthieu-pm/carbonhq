import { parse } from "yaml";
import { parseTokens } from "./tokenModel.js";
export { normalizeToken, tokenProperty } from "./tokenModel.js";

export function importTokens(markdown: string) {
  return parseTokens(markdown, source => parse(source, { maxAliasCount: 0 }));
}

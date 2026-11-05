/// Where the composer's `$` MCP picker opens, what a pick writes, and which
/// `$words` in a prompt are mentions.
///
/// The fifth sibling of [mention.ts], and shaped like it: a mention is a word
/// inside a sentence, so the caret finds its own token. What differs is that
/// `$HOME` and `$PATH` are ordinary prose in a prompt, so **a `$word` is a
/// mention only where it names a server the agent loads** — the composer asks
/// its loaded list, the transcript the names the prompt event recorded. Rust's
/// `mcp_mentions::tokens` reads the text the same way, so a chip drawn while
/// typing is a mention once sent.
///
/// [mention.ts]: ./mention.ts
import type { Segment } from "@/lib/highlight";
import type { McpMention } from "@/types/events";

type McpSpan = {
  start: number;
  end: number;
  /// Everything after the `$`, to the end of the token.
  query: string;
};

const SPACE = /\s/;

/// Sentence punctuation after a name, not in it. Rust trims the same set.
const TAIL = /[.,;:!?)]+$/;

/// The `$` token the caret is in, or `null`.
export function mcpSpan(text: string, caret: number): McpSpan | null {
  if (caret < 1 || caret > text.length) return null;

  let start = caret;
  while (start > 0 && !SPACE.test(text[start - 1])) start -= 1;

  // Reaching a `$` proves it opens a word, so `cost$5` stays prose.
  if (text[start] !== "$") return null;

  let end = caret;
  while (end < text.length && !SPACE.test(text[end])) end += 1;

  return { start, end, query: text.slice(start + 1, end) };
}

/// The text with the token at `span` replaced by `$name`, one space after it.
export function applyMcp(
  text: string,
  span: McpSpan,
  name: string,
): { text: string; caret: number } {
  const head = `${text.slice(0, span.start)}$${name}`;
  const tail = text.slice(span.end);

  return {
    text: head + (tail.startsWith(" ") ? tail : ` ${tail}`),
    caret: head.length + 1,
  };
}

/// Servers whose name holds the query, those starting with it first.
export function filterMcp(servers: McpMention[], query: string): McpMention[] {
  const needle = query.toLowerCase();
  if (!needle) return servers;

  const hits = servers.filter((s) => s.name.toLowerCase().includes(needle));
  return [
    ...hits.filter((s) => s.name.toLowerCase().startsWith(needle)),
    ...hits.filter((s) => !s.name.toLowerCase().startsWith(needle)),
  ];
}

/// What a chip shows: the last part of a plugin's namespaced name
/// (`plugin:figma:figma` → `figma`), which is the part that says which server.
export function mcpFace(name: string): string {
  return name.slice(name.lastIndexOf(":") + 1) || name;
}

/// The same runs with every `$name` naming one of `names` pulled out as an
/// `mcp` run. Text runs only, so a `$name` inside a code span stays code.
///
/// A pass over finished segments for `withPaths`' reason: the scanner has no
/// list to check a name against. `inner` is the name without its `$`.
export function withMcpServers(segments: Segment[], names: readonly string[]): Segment[] {
  if (names.length === 0) return segments;
  const known = new Set(names);
  const out: Segment[] = [];
  let previous = "";

  for (const segment of segments) {
    if (segment.kind !== "text") {
      out.push(segment);
      previous = segment.text;
      continue;
    }

    const text = segment.text;
    let at = 0;
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] !== "$") continue;
      // A word opens after whitespace, or at the very start of the prompt.
      const before = i > 0 ? text[i - 1] : previous.slice(-1);
      if (before !== "" && !SPACE.test(before)) continue;

      let end = i + 1;
      while (end < text.length && !SPACE.test(text[end])) end += 1;
      const name = text.slice(i + 1, end).replace(TAIL, "");
      if (!known.has(name)) continue;

      const stop = i + 1 + name.length;
      if (i > at) out.push({ kind: "text", text: text.slice(at, i) });
      out.push({ kind: "mcp", text: text.slice(i, stop), inner: name });
      at = stop;
      i = stop - 1;
    }
    if (at < text.length) out.push({ kind: "text", text: text.slice(at) });
    previous = text;
  }

  return out;
}

import type { MarkdownParseHelpers, MarkdownToken } from "@tiptap/core";

const RICH_PAGE_LIMIT = 32 * 1024;

export const PAGE_TABLE_CELL_CONTENT = "paragraph";

/// The rich editor must not rewrite constructs its Markdown schema cannot preserve.
export function richMarkdownReason(markdown: string): string | null {
  if (new TextEncoder().encode(markdown).length > RICH_PAGE_LIMIT) return "Large Pages open in source mode to keep editing responsive.";
  if (/^\uFEFF?(?:---|\+\+\+)\s*\r?\n/.test(markdown)) return "This Page contains frontmatter. Edit its source to preserve it.";

  let fence: string | null = null;
  const prose: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && !line.slice(line.indexOf(marker) + marker.length).trim()) fence = null;
      continue;
    }
    if (marker) { fence = marker; continue; }
    prose.push(line.replace(/(`+)[\s\S]*?\1/g, ""));
  }
  const text = prose.join("\n");
  if (/<\/?[A-Za-z][\w:-]*(?:\s[^>]*|\/?)>/.test(text) || /<!--/.test(text)) return "This Page contains HTML. Edit its source to preserve it.";
  if (/\[\^[^\]]+\]/.test(text)) return "This Page contains footnotes. Edit its source to preserve them.";
  if (/\[[^\]\n]+\]:\s*\S/.test(text) || /!?\[[^\]\n]+\]\[[^\]\n]*\]/.test(text)) return "This Page contains reference links. Edit its source to preserve them.";
  if (/\[![A-Za-z]+\]/.test(text)) return "This Page contains callouts. Edit its source to preserve them.";
  if (/^\s*:{3,}[A-Za-z]/m.test(text)) return "This Page contains Markdown directives. Edit its source to preserve them.";
  return null;
}

/// GFM cells contain one inline passage; block pastes cannot be flattened without loss.
export function pageTablePasteReason(text: string, html = ""): string | null {
  if (/\r?\n/.test(text) || /^\s*(?:#{1,6}\s|[-*+]\s|\d+\.\s|>|`{3,}|~{3,}|\$\$)/.test(text) || /<(?:h[1-6]|ul|ol|li|table|blockquote|pre|hr|img)\b/i.test(html) || (html.match(/<(?:p|div)\b/gi)?.length ?? 0) > 1) return "Table cells contain one paragraph. Paste this content outside the table or into separate cells.";
  return null;
}

/// Inline images must stay inside a paragraph, including when they are its only child.
export function parsePageParagraph(token: MarkdownToken, helpers: MarkdownParseHelpers) {
  const tokens = token.tokens ?? [];
  const empty = tokens.length === 1 && tokens[0].type === "text" && ["&nbsp;", "\u00a0"].includes(tokens[0].raw ?? tokens[0].text ?? "");
  return helpers.createNode("paragraph", undefined, empty ? [] : helpers.parseInline(tokens));
}

import { describe, expect, it } from "vitest";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import Paragraph from "@tiptap/extension-paragraph";
import { TableKit, TableCell, TableHeader } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import { Mathematics } from "@tiptap/extension-mathematics";
import { getSchema } from "@tiptap/core";
import { PAGE_TABLE_CELL_CONTENT, pageTablePasteReason, parsePageParagraph, richMarkdownReason } from "./pageMarkdown";

const extensions = [StarterKit.configure({ paragraph: false, underline: false }), Paragraph.extend({ parseMarkdown: parsePageParagraph }), TableKit.configure({ tableCell: false, tableHeader: false }), TableCell.extend({ content: PAGE_TABLE_CELL_CONTENT }), TableHeader.extend({ content: PAGE_TABLE_CELL_CONTENT }), TaskList, TaskItem.configure({ nested: true }), Image.configure({ inline: true }), Mathematics];
const manager = new MarkdownManager({
  extensions,
  markedOptions: { gfm: true },
});

describe("rich Page Markdown", () => {
  it("preserves nested tasks, formulas, diagram source and Page links", () => {
    const markdown = "# Plan\n\n- [ ] First\n  - [x] Nested\n\nInline $x+y$\n\n$$\nx^2+y^2=z^2\n$$\n\n```mermaid\nflowchart LR\n A --> B\n```\n\n[Other Page](carbon-page://local/019a1234-abcd-7000-8000-123456789abc)\n\n![Image](carbon-asset://local/a.png)";
    const parsed = manager.parse(markdown);
    expect(() => getSchema(extensions).nodeFromJSON(parsed).check()).not.toThrow();
    const roundtrip = manager.serialize(parsed);
    expect(richMarkdownReason(markdown)).toBeNull();
    expect(manager.parse(roundtrip)).toEqual(parsed);
    expect(roundtrip).toContain("```mermaid\nflowchart LR\n A --> B\n```");
    expect(roundtrip).toContain("$x+y$");
    expect(roundtrip).toContain("carbon-page://local/");
    expect(roundtrip).toContain("- [x] Nested");
  });

  it("preserves escaped table pipes as cell content", () => {
    const markdown = "| Name | Value |\n| --- | --- |\n| Foo | A \\| B |";
    const parsed = manager.parse(markdown);
    expect(manager.parse(manager.serialize(parsed))).toEqual(parsed);
    expect(manager.serialize(parsed)).toContain("A \\| B");
  });

  it("keeps inline formatting, math and images valid inside a GFM cell", () => {
    const markdown = "| Content |\n| --- |\n| **Bold** and $x$ and ![Image](https://example.com/a.png) |";
    const parsed = manager.parse(markdown);
    expect(() => getSchema(extensions).nodeFromJSON(parsed).check()).not.toThrow();
    expect(manager.parse(manager.serialize(parsed))).toEqual(parsed);
  });

  it.each([
    "---\ntitle: Plan\n---\n\nBody", "Text[^note]\n\n[^note]: Footnote", "[Label][ref]\n\n[ref]: https://example.com", "<details><summary>More</summary>Hidden</details>", "Hello <custom-widget>world</custom-widget>", "> [!NOTE]\n> Keep this", ":::warning\nKeep this\n:::",
  ])("keeps unsupported source out of the rich serializer: %s", (markdown) => {
    expect(richMarkdownReason(markdown)).not.toBeNull();
  });

  it.each([
    "- Outer\n\n    <details><summary>More</summary>Hidden</details>",
    "- Outer\n\n    > [!NOTE]\n    > Keep this",
    "- Outer\n\n    [ref]: https://example.com",
    "Text <!-- unfinished comment",
    "> > [!WARNING]\n> > Nested callout",
    "> [ref]: https://example.com",
    "    <custom>Indented code conservatively opens in source</custom>",
  ])("preserves nested and incomplete constructs by keeping source mode: %s", (markdown) => {
    expect(richMarkdownReason(markdown)).not.toBeNull();
  });

  it("only permits a single inline paragraph in table cells and headers", () => {
    const schema = getSchema(extensions);
    const paragraph = schema.nodes.paragraph.create(null, schema.text("Cell"));
    const heading = schema.nodes.heading.create({ level: 2 }, schema.text("Heading"));
    for (const name of ["tableCell", "tableHeader"]) {
      expect(schema.nodes[name].validContent(paragraph.content)).toBe(false);
      expect(schema.nodes[name].validContent(schema.nodes.doc.create(null, [paragraph]).content)).toBe(true);
      expect(schema.nodes[name].validContent(schema.nodes.doc.create(null, [paragraph, paragraph]).content)).toBe(false);
      expect(schema.nodes[name].validContent(schema.nodes.doc.create(null, [heading]).content)).toBe(false);
      for (const type of ["bulletList", "orderedList", "taskList", "codeBlock", "blockquote", "blockMath", "table"]) {
        const node = schema.nodes[type].createAndFill();
        if (node) expect(schema.nodes[name].validContent(schema.nodes.doc.create(null, [node]).content)).toBe(false);
      }
    }
  });

  it("refuses rich block and multi-paragraph pastes into a GFM cell", () => {
    for (const text of ["One\nTwo", "One\n\nTwo", "# Heading", "- list", "1. list", "> quote", "```js\nx()\n```", "$$formula$$"]) expect(pageTablePasteReason(text)).not.toBeNull();
    expect(pageTablePasteReason("OneTwo", "<p>One</p><p>Two</p>")).not.toBeNull();
    expect(pageTablePasteReason("Heading", "<h2>Heading</h2>")).not.toBeNull();
    expect(pageTablePasteReason("**Bold** and $x$", "<p><strong>Bold</strong> and $x$</p>")).toBeNull();
  });

  it("allows literal syntax inside code fences, including longer outer fences", () => {
    const markdown = "````md\n---\ntitle: Example\n---\n```html\n<details>Example</details>\n```\n[^note]: Footnote\n> [!NOTE]\n````\n\nOrdinary text with `<span>` and `[^note]`.";
    expect(richMarkdownReason(markdown)).toBeNull();
  });

  it("allows ordinary links, autolinks and mathematical comparisons", () => {
    expect(richMarkdownReason("[Link](https://example.com)\n\n<https://example.com>\n\n$x < y$ and $z > y$")).toBeNull();
  });

  it("caps UTF-8 bytes before parsing large documents", () => {
    expect(richMarkdownReason("a".repeat(32 * 1024))).toBeNull();
    expect(richMarkdownReason("a".repeat(32 * 1024 + 1))).not.toBeNull();
    expect(richMarkdownReason("é".repeat(17 * 1024))).not.toBeNull();
  });
});

# Pages editor research

Pages remain Markdown documents. Spaces is their workspace; Profiles is the renamed project/session visibility feature. The user tried Milkdown and rejected it as too slow. Do not use Milkdown for this feature. Tiptap 3.33.0 with a focused extension set is the next candidate, subject to real browser and desktop latency checks. Keep a source editor and rendered preview using Carbon's existing Markdown pipeline. This choice is a design decision, not a claim that Notion or Linear uses Tiptap.

## Interaction patterns

Linear's connected product documentation describes Markdown typing and paste, a selected-text formatting toolbar, slash commands, checklists, tables, Mermaid fenced diagrams, collapsible sections, attachments and document mentions. These are a useful target for Pages. Keep the document visible while editing, put insertion choices beside the caret, and use stable Page links for mentions and backlinks.

Source: [Linear editor](https://linear.app/docs/editor), read through the Linear plugin on 8 November 2026. [Linear documents](https://linear.app/docs/documents) documents title-based document mentions.

Notion's connected Markdown specification exposes CommonMark and GFM plus custom XML for colored text, toggles, callouts, media, page links and columns. Its rich document model therefore exceeds ordinary Markdown. Use its convenient editing patterns while preserving Carbon's simpler Markdown contract. Prefer GFM, dollar-delimited math, fenced Mermaid, blockquotes/callouts and ordinary attachment links; do not copy proprietary Notion tags into Carbon storage.

Source: Notion plugin `fetch` of `notion://docs/notion-flavored-markdown-spec`; [Notion writing and editing](https://www.notion.com/help/writing-and-editing-basics).

## Editor comparison

| Editor | Fit for Pages | Tradeoff |
| --- | --- | --- |
| Milkdown Crepe | Rejected by the user after trying it | Do not return to this choice |
| MDXEditor | Accepts and emits Markdown strings; React/Lexical integration; source/diff mode, tables, images, code blocks, directives and admonitions | Math and diagram editing need more custom integration; JSX support is unnecessary for Markdown-only Pages |
| Tiptap | Broad extension ecosystem including tables, tasks, mathematics, details and drag handles | Official Markdown extension is beta and documents limitations for comments and table-cell content; each rich extension needs Markdown parsing/serialization support |
| BlockNote | Ready-made Notion-like block interaction | Its documented Markdown import/export is lossy; JSON is its recommended lossless storage format |

Sources: [Milkdown Crepe guide](https://milkdown.dev/docs/guide/using-crepe), [Crepe feature source](https://github.com/Milkdown/milkdown/blob/main/packages/crepe/src/feature/index.ts), [MDXEditor architecture](https://mdxeditor.dev/editor/docs/overview), [Tiptap Markdown](https://tiptap.dev/docs/editor/markdown), [BlockNote formats](https://www.blocknotejs.org/docs/foundations/supported-formats).

## Implementation checks

Keep Markdown as the only canonical body. The rich editor's internal tree is transient. Loading a Page must not autosave the editor's normalized output: save only after a real user change. A source-mode edit preserves its exact Markdown. Switching modes must not silently drop unknown syntax. Preserve unsupported constructs in source mode or show an explicit source-only explanation before allowing a lossy rich edit.

Exercise semantic round trips with nested lists/tasks, escaped table pipes, code fences containing backticks, inline/block math, Mermaid, images and attachment links, Page links, callouts, reference links, footnotes, frontmatter and raw HTML. Classify each as supported, preserved or source-only. Normalized whitespace alone differs from lost meaning; preserve the original bytes when there is no edit.

For Mermaid, retain a `mermaid` code fence and provide a preview; do not execute document JavaScript. Prevent external revision refreshes from replacing a dirty draft or rebuilding the editor on every keystroke.

## Tiptap implementation candidate

Registry checks on 8 November 2026 resolve the checked Tiptap packages to 3.33.0. Keep their versions aligned: `@tiptap/core`, `@tiptap/pm`, `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/markdown`, `@tiptap/extension-table`, `@tiptap/extension-task-list`, `@tiptap/extension-task-item`, `@tiptap/extension-image` and `@tiptap/extension-mathematics`. Mathematics also needs `katex` and its CSS. No product dependencies were installed for this research; the probe lives under `/tmp/carbon-cbn27-editor-probe`.

Use `StarterKit.configure({ link: { openOnClick: false, protocols: ['carbon-page', 'carbon-asset'] }, underline: false })`, named `TableKit` from `@tiptap/extension-table`, `TaskList`, `TaskItem.configure({ nested: true })`, `Image`, named `Mathematics` and `Markdown.configure({ markedOptions: { gfm: true } })`. StarterKit v3 already contains Link and Underline; do not register Link twice. Configure allowed document-link protocols and intercept navigation in Carbon.

Initialize with `contentType: 'markdown'`. Read with `editor.getMarkdown()`. A clean external revision can use `editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false })`. Math has built-in Markdown tokenizers and serializers for `$inline$` and dollar-fenced display blocks. Mermaid is preserved by the ordinary code-block language attribute.

Lazy-load the editor only for an open document. Keep it in an isolated React module. Set `shouldRerenderOnTransaction: false`, use `useEditorState` for toolbar state, and avoid React node views for ordinary paragraphs and code. On document changes, mark the draft dirty and debounce Markdown serialization; do not walk the whole document with `getMarkdown()` on every key. Flush pending edits before switching Page or mode. Lazy-load expensive diagram/highlight previews separately.

The official React integration guide discusses these specific controls: [Tiptap performance](https://tiptap.dev/docs/guides/performance). [Markdown operations](https://tiptap.dev/docs/editor/markdown/getting-started/basic-usage) documents parse/serialize and `contentType`. [Mathematics](https://tiptap.dev/docs/editor/extensions/nodes/mathematics) documents KaTeX integration.

A local Node 24.22.2 probe with the published 3.33.0 packages and happy-dom exercised Markdown parse/serialize and editor construction. Standard formatting, nested tasks, escaped table pipes, math, Mermaid, image URLs and Page links survived the tested round trips. Plain blockquote callouts were escaped as prose; footnotes were escaped; frontmatter was converted to a rule and heading; details wrappers and custom HTML tags were lost. Those constructs need preserving custom extensions or an explicit source-only mode. Do not infer support from visually similar rendered output.

The synthetic 10KB fixture took about 12ms to parse, 4.5ms to serialize and 69ms for happy-dom editor construction. At roughly 100KB it took about 628ms, 17ms and 1121ms respectively. These are single-run diagnostics, not browser latency, a comparison with Milkdown, or a speed guarantee. Large documents require a measured strategy; mounting every Page or serializing every keystroke is unacceptable. Measure warm/cold open, typing-to-paint, paste, mode switch, toolbar responsiveness and memory with actual Carbon themes and the reference layout.

MDXEditor uses Lexical with explicit Markdown/MDAST visitors and can be a fallback candidate. There is no comparable local MDXEditor measurement, so neither engine can honestly be called faster from this research. Tiptap currently wins on the smaller controllable extension surface and verified math/diagram serialization, subject to those real measurements.

## Shipped artifact evidence

REA inspected the installed applications without executing or changing them:

- Linear directory inventory: parent `ev_0d593a58bba734e992b74cca6ede2f0425d8f9924133c0287b5cf4ead25ec7dc`. The examined bundle has `Contents/Resources/app.asar`; this is an Electron candidate, not execution evidence.
- Notion directory inventory: parent `ev_0f742c0442b67718ff860fdf07fa3f7ad092caace691f1b5dbb154fc08dffa13`. Same bounded Electron candidate finding.
- Linear ASAR selected-source analysis: parent `ev_3f7e1588942adbc5201dcbadb795418e9aa822114c5e429253cb02fc1a60d374`, summary `ev_47bae332040fc3041717ccf98537964ce3cfe627dcc8f945836ce542be8c6fbc`. Selected `package.json` and `out/main/chunks/Constants-DFIMYa3N.js`; 12 inventoried relevant files are outside that analysis. The observed constants select `https://linear.app/auth/desktop` as the production entry URL. The manifest identifies desktop version 1.32.8. This does not establish the remotely loaded editor's implementation.
- REA recorded three native-addon integrity contradictions in Linear's unpacked signed companion files. Analysis used `record-and-continue`; those bytes remain observed-untrusted and were not executed. The selected constants and manifest do not establish trust in those addons.
- Read-only ASAR manifest inspection identifies installed Notion desktop version 7.42.3. The inspected desktop package does not establish its web editor technology.

The editor engine used by either service remains unknown. Their documented user interactions are sufficient to guide Carbon's design without claiming to reconstruct private editor code. No private workspace document was read or changed.

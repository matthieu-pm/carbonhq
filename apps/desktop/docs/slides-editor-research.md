# Slide authoring in Carbon Spaces

## Recommendation

Prototype the Slides section with OpenPresentation. Its MIT-licensed toolkit gives agents a JSON deck format and gives people a React slide editor that reads and writes the same document. A Carbon agent can draft a deck from a Page, a user can edit the result on the canvas, and the agent can revise an individual slide later. The authoring tools run locally with the agent the user already chose. [Repository and license](https://github.com/OpenPresentation/opf) · [Agent guide](https://www.openpresentation.org/agents) · [Editor](https://www.openpresentation.org/docs/live-editor)

## Where it fits in Carbon

Spaces already has a Slides section. Its current implementation shows an empty state. Pages establish a pattern for storage on the owning Carbon server, revision-checked saves, immutable history and durable attachments. Their document body, however, is specifically Markdown, with a 256 KiB limit. [Slides section](../src/components/spaces/sections.tsx) · [Spaces storage and editing](pages.md) · [Page model](../src-tauri/src/pages.rs)

- **Authoring.** Offer a blank deck in Spaces and expose deck creation, reading and revision-checked updates through the Carbon CLI. Both the editor and the agent should save to the same deck ID. Store OPF JSON as the editable source and resolve image references through the owning server's asset store.
- **Editing.** Load the React editor when a deck opens. Its change and save events let Carbon plug in its draft and persistence workflow. If an agent revises a deck while a user has unsaved edits, preserve the draft and surface the revision conflict. [Editor integration](https://www.openpresentation.org/docs/get-started)
- **Export.** Generate PowerPoint on demand. Package the required fonts deliberately and check wrapping in representative decks. OPF documents its supported PowerPoint features and font fidelity limits. [Editor and fidelity notes](https://www.openpresentation.org/docs/live-editor)

## What ran locally

On 19 November 2026, using Node 24 and the published OPF 0.34.1 packages in a temporary directory, I created a two-slide JSON deck, changed its second title through an editor-session patch, saved it and reopened it. The revised title survived. CLI validation returned zero errors and zero warnings, plus an informational message about the omitted language tag. After installing the PPTX package and its font dependencies, the CLI exported the deck. The second slide contained the revised title and bullet as native PowerPoint text.

That covers the document and export path. The first Carbon prototype should exercise the remaining integration end to end in the desktop webview. Have an agent create a deck with a managed image, change a title on the canvas, close and reopen the tab, then ask the agent to revise the same slide. Repeat with an unsaved user edit to check conflict handling. Pin the tested toolkit version and keep a saved deck as an upgrade fixture because upstream allows schema changes in 0.x minor releases. [Upstream version policy and editor limits](https://www.openpresentation.org/docs/live-editor)

## When Markdown is enough

Marp Core is the simpler choice if the intended interaction is writing Markdown and presenting it. An agent can generate the source, Carbon can reuse more of its Page storage, and Marp renders HTML and CSS for a preview. Carbon would still need to build direct manipulation of slide elements if users expect to work on the canvas. [Marp Core](https://github.com/marp-team/marp-core) · [Browser integration example](https://github.com/orgs/marp-team/discussions/480)

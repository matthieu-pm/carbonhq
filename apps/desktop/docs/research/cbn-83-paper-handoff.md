# Paper handoff reference for CBN-83

Checked 17 November 2026 through Paper's live MCP and its [official MCP documentation](https://paper.design/docs/mcp). No design was edited. Gui's source comparison is in [the companion note](cbn-83-gui-handoff.md).

## Observed contract

The open Carbon website file exposed its file and page identities, artboard dimensions, fonts and tokens through `get_basic_info`. `get_selection` returned an empty selection. `get_children` returned stable layer addresses; `get_computed_styles` returned exact CSS; `get_jsx` returned a small layer as Tailwind JSX with `includeNodeIds: false`. `get_tokens` returned the file's empty token set.

Each response identified the file and included a token content hash. The live guide says to re-read tokens when that hash changes. This is a token invalidation signal, not an immutable design revision. The inspected selection, JSX, style and screenshot tool signatures have no historical revision argument. This does not establish how Paper stores history internally or whether another interface supports pinned references.

The live `get_guide("paper-mcp-instructions")` directs implementation agents to read structure, styles and image assets for exact values, translate exports into the codebase's conventions, and use screenshots to check results. Portable JSX omits canvas root positioning by default. Moving existing nodes preserves their identities.

## Carbon decision

Pair the picture with node identity, dimensions and exact structured reads. Keep Canvas addresses out of generated project markup. Inspect existing project components and tokens instead of presenting exported design markup as original application source.

Paper's live reads support this workflow. They do not prove durable chat chips, retained screenshots, changed/deleted-reference warnings or automatic project verification. Carbon keeps its explicit captured revision and refresh contract rather than inferring those guarantees from Paper.

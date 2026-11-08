# Spaces and Markdown Pages

Spaces is the document workspace on Cmd+P. Pages are Markdown documents. Profiles is the previous Spaces feature; its serialized project field and local storage keys keep their old spellings so no migration can lose grouping settings.

## Feature flag

Pages and Spaces are unfinished and disabled by default. The owning server reads `pagesEnabled` from `settings.json`; an absent or false value disables Page commands, assets and Linear sync. The local flag also hides Spaces, the Page picker and Cmd+P. Profiles stays available. To test, set `{"pagesEnabled": true}` in an isolated server’s settings file and reconnect the frontend. Keep the real installation off.

## One document and one owner

`pages.rs` owns identity, metadata, exact Markdown, revisions, project links, search, favorites and Trash. Documents live under the owning server's `CARBON_HOME/pages`, outside repositories and session directories. Project links do not copy content. Frontend project paths carry their server; core paths remain owner-local.

A managed `.md` file has Carbon metadata in frontmatter and the exact body after it. Managed writers share a lock and compare the expected revision before committing. Immutable snapshots precede the current-file atomic rename. A future snapshot left by a crash is not a committed version. History lists the latest 100 committed snapshots; direct reads address older ones.

Restore copies historical title and body into a new revision. Current identity, creation time, project links, favorite and Trash state remain current. Editing files outside the managed interface does not participate in revision coordination.

## Editor and drafts

`usePageDocument` owns one queue per Page independently of React mounts. Local drafts retain the original base revision and survive navigation. An accepted write normalizes only fields unchanged since submission. An external revision replaces a clean draft and flags a dirty one. Events arriving during a write trigger a deferred read.

Tiptap loads only for an open rich document. Its internal tree is transient. Untouched Markdown never saves a normalized copy. Actual edits mark the draft pending immediately, serialize after a 300ms pause, and autosave after a further pause. Navigation flushes pending rich text before changing documents.

Pages over 32 KiB and unsupported constructs use source mode. The source guard is conservative around HTML, frontmatter, footnotes, reference links, directives and callouts. Table cells accept one paragraph because GFM cannot represent arbitrary block children. Block actions and unsafe paste are refused inside cells. Rich images retain canonical source attributes while a DOM-only view resolves authenticated display URLs.

The user's Milkdown performance rejection and the Notion/Linear investigation are recorded in [editor research](pages-editor-research.md). That research distinguishes shipped-artifact observations from editor design choices.

## Links and chat

`carbon-page://local/<page-id>` follows the containing Page’s owner; `this-mac` explicitly names the app’s local server. Other hosts name configured servers. `carbon-page://<server>/<page-id>` opens the current document. A `revision` query cites an immutable snapshot. Sent messages retain the full reference; Spaces renders a cited revision without mounting a writable editor on the old base.

Same-owner task references tell agents to read the immutable revision through the CLI. Foreign-owner references include the exact saved Markdown snapshot because agents need not share the UI’s server aliases. Backlinks aggregate connected owning stores with explicit source and target identities.

The Markdown pipeline carries validated Page URLs through sanitization as safe fragments. The app opens them through its Page router. Arbitrary protocols do not gain access through this exception. Backlinks parse Markdown link events, so examples in code fences are not backlinks. Profile filtering applies to document lists and backlink titles as well as the open document.

## Attachments

Page assets live under `attachments/pages`, not session attachments. Uploads use bounded chunks through browser WebSockets and the CLI's one-line protocol. A finalized manifest is the visibility point; incomplete uploads stay hidden. Canonical Markdown uses `carbon-asset://<page-id>/<asset-id>`; display URLs resolve for the owning server.

Preview uses strict Mermaid, untrusted KaTeX, sanitized Markdown and sandboxed PDF frames. HTML attachments are text, never executable app content. Linear upload URLs use the existing credentialed asset fetch on the owning server.

## Linear sync

`pages_linear.rs` owns the provider adapter. `pages_sync.rs` retains provider identity, remote version, baseline and uncertain write state outside the Page body. Imports reserve a stable Page UUID before creation so retries cannot duplicate documents. Only explicitly linked Pages sync; unlinking retains a tombstone against in-flight work.

Local revision checks and displayed remote versions guard conflict choices. Linear has no atomic compare-and-swap document update; the final remote re-read is best effort. Preserve uncertain attempts across failures and restarts. Verification uses isolated fixtures rather than changing real Linear documents. Carbon Page and attachment URLs remain Carbon references when synced; attachments are not rehosted in Linear.

## Verification checkpoints

- Stage 1: independent standards and spec reviews, fixes and re-reviews; full frontend and Rust tests; real isolated CLI/restart smoke; browser editing, save, preview, search, favorites, Trash and restore.
- Stage 2: independent reviews caught unseen-revision overwrite, dropped events during saves and nested Markdown fidelity gaps. Regression tests and re-reviews passed. Browser exercised rich startup, typing/autosave focus, slash/table insertion, source switching, historical restore and a real CLI write against an unsaved browser draft.
- Stage 3: independent reviews and re-reviews passed after fixes to owner routing, stale picker reads, snapshot editing, media MIME types and source-aware backlinks. Runtime checks caught implicit historical reads and missing CORS headers for text previews; regression tests and authenticated response fixes cover both. Isolated CLI tests exercised chunked uploads, exact authenticated bytes, invalid offsets, retry idempotency, backlinks, restart survival and all default-off command/asset gates. Sync adapter/engine fixtures passed without real Linear writes. Final browser checks covered saved Page references, Page linking/backlinks, image uploads, loaded audio controls, math/Mermaid, inert HTML text and exact downloads. With the flag off, Spaces, picker actions and the shortcut row disappeared while Profiles remained available.
- The stage 2 browser measured initialization at 17–31ms for small fixtures and 65ms for a roughly 14 KiB fixture. A roughly 100 KiB document mounted source mode with zero rich editor instances. These are local observations, not a guarantee across machines or documents.

Run frontend tests and build from `apps/desktop`; full Rust tests and the headless check from `apps/desktop/src-tauri`; CLI and protocol tests from their own crates. Full Rust tests must follow filtered runs because ts-rs regenerates the shared frontend types.

Final verification: 1,014 frontend tests; 1,099 Rust tests (32 ignored); 29 CLI tests plus installer; 8 protocol tests; 34 isolated Linear adapter/engine fixtures. Desktop and docs builds, headless check and diff checks passed. The native webview and real Linear writes were not manually exercised. The feature flag remains off.

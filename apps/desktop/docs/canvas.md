# Canvas storage

CBN-80 supplies the file format and server API. CBN-81 adds the Canvas rail page and isolated frame renderer. CBN-82 adds agent commands, HTML import, rendered evidence and turn undo. Stored designs are data; Canvas never modifies the project's source automatically.

## Canvas page

Open Canvas from the rail or with Cmd-Option-C (Ctrl-Alt-C outside macOS). Choose a project and a canvas file tab. New canvas creates a named file; New frame adds a blank Desktop (1440 × 900), Mobile (390 × 844), or custom frame. Custom dimensions are whole pixels from 1 to 10,000. File renaming is supported; frame and layer editing remain separate work.

Scroll to pan. Pinch or Cmd/Ctrl-scroll to zoom around the pointer. The Hand tool or Space-drag pans; the Select tool drags a selection marquee. Shift-click adds or removes frames and layers. Click a frame once to select it and again to pick a layer. Arrow keys navigate the board and layers tree; Enter enters a frame and Escape leaves a layer selection. Fit all is Shift-1, fit selection Shift-2, and actual size Shift-0. All three shortcuts are in the shortcuts registry. Camera position and the last open file are remembered locally per canvas/project.

The layers tree, board outlines and read-only Properties share stable frame/layer IDs. Properties reports the renderer's measured bounds and computed styles. Chat uses Carbon's real transcript and composer, with a session picker and New session action. It keeps the current session when it belongs to the project, otherwise restores that project's remembered session or most recent available session. Design chips and agent handoff belong to CBN-83.

Preview separates the focused canvas frame from the running project. Only the focused frame has a live sandboxed iframe; its viewport stays at the frame's CSS dimensions, with scrolling for large frames. The running project uses the selected session's existing browser and preview controls. Hiding the page or frame Preview removes its live iframe.

The overview uses raster images, retained layer geometry and one capture at a time. Captures prioritize the focused and visible frames. Thumbnail resolution falls as more frames become visible; image, key and geometry estimates share a 24 MiB cache budget. Offscreen previews are released. Used styles are frozen before rasterizing, so thumbnail resolution and board zoom do not change viewport units or media queries. A pending replacement retains the previous valid preview. File/project switches reject stale reads and captures. Reopening and reconnecting read durable state and rearm watches.

Both live and capture documents have an opaque sandbox origin. Stored scripts, event handlers, embedded pages and navigation attributes are omitted. CSP blocks network requests, forms and app-origin resources; file-owned images resolve through the owning server into data URLs. The renderer currently limits a frame to 2,000 elements, 16 MiB of embedded image data and 16 MiB of serialized capture markup. These limits report an error without changing the saved design. Unsupported external images/fonts and executable page behavior are not imported by this renderer.

## Ownership and identity

Files live under `store::config_dir()/canvases/<file-id>`. Every dev worktree uses the shared config directory, while an explicit `CARBON_HOME` still isolates a server. The project path is metadata, not the storage directory. The recorded `projectPath` stays the reader's attached folder. A separate `projectKey` combines the canonical Git common directory and the subproject's relative path, so linked worktrees share designs even with separate Git metadata. `apps/web` and `apps/desktop` retain distinct identities. Folders without Git use their canonical path as the key. A folder gaining Git metadata keeps its existing canvases through an in-memory membership alias; historical snapshots stay untouched, and a later edit persists the current shared key. File names can change without changing identity.

Frames and layers have canonical UUIDs. Layer IDs are separate from an element's HTML `id` attribute. Save and reopen preserve IDs. Duplicating a file or frame creates fresh frame/layer IDs, retains HTML attributes, CSS and tokens, and preserves file-local asset references. A frame duplicate is placed beyond the rightmost frame. A file duplicate copies its image bytes, so deleting the original cannot break it.

## Format

```text
canvases/<file-id>/
  canvas.json                 current commit pointer and format compatibility
  recovery.json               latest confirmed recovery checkpoint
  revision.json               highest reserved revision number
  history/<commit-id>.json     immutable revision metadata, layout and content references
  content/<sha256>.json        immutable editable frame content
  assets/<sha256>              immutable image bytes, owned by this file
  edits/<revision>/<frame-id>.json
  uploads/<asset-id>           incomplete images, not visible assets
```

New files and duplicates are staged under `canvases/pending/<id>` and enter the visible UUID namespace only after the whole file is complete. Failed publications are removed; startup clears abandoned staging directories under the same write lock.

The manifest states `formatVersion`, `minReaderVersion`, file `id`, `revision` and `commit`. Reader 1 accepts an additive newer format only when `minReaderVersion <= 1`. Known records preserve additional JSON fields on normal writes. An unsupported reader requirement refuses reads, edits, duplication, deletion and recovery. No recovery or migration runs implicitly over a future format.

A frame has an ID, name, geometry (`x`, `y`, `width`, `height`) and content. Content has a node tree, a CSS stylesheet and `assetIds`. Nodes are either elements (`id`, `name`, `tag`, string-valued `attributes`, string-valued CSS `styles`, `children`) or text (`id`, `name`, `text`). CSS variables are stored as strings; shared tokens live separately on the canvas. Camera state is separate from frame content.

Canonical image references use `carbon-canvas-asset://<asset-id>`. URLs in attributes, styles and CSS must name an image in that frame's `assetIds`; every declared asset must exist in the canvas. The owning canvas resolves the URL. A future renderer must isolate untrusted HTML/CSS; storage validation is not a browser sanitizer.

Limits: 8 MiB of Canvas JSON, 1,000 frames, 100,000 layers, 48 levels of layer nesting, 4,096 images, 20 MiB per image and 256 KiB per decoded upload chunk. Uploads accept PNG, JPEG, GIF, WebP and AVIF signatures. Inline SVG can be represented as element nodes.

## Commits and history

All mutations take the process mutex and `lock_across_processes("canvas")`. Failing to acquire either lock refuses the write. Writers re-read the manifest and compare the expected revision while holding both locks. Immutable frame content and a complete snapshot land before the atomic manifest replacement. For an existing file, the manifest is the commit point; an orphan snapshot left by a failed save is never listed as history.

Each committed change records its ID, before/after revisions and optional session, turn and label. Content, layout, tokens and image references are all in the snapshot. This is independent of Git. History lists the latest 100 committed revisions; older ones remain addressable. Restore publishes a new revision with historical design content/layout/assets and the current camera. Turn undo is separate from this full-version restore.

Images stay available to historical revisions until the file is permanently deleted. Upload chunks have no visible revision; finalization publishes the image metadata with a guarded revision. Chunk offsets support exact retries and reject conflicting bytes. Finalized image IDs cannot be overwritten.

Deletion is permanent, including content, images and history. It first records a tombstone with the next revision and hides the file, then removes its directory. Startup finishes cleanup after an interrupted deletion. A duplicate owns its own assets and remains readable.

## Recovery

Reads never replace a bad manifest with an empty canvas. Listing validates manifests and frame content and returns unreadable files as `problems`. Image bytes are checksum-verified when read, copied or recovered. Explicit recovery first preserves the original bytes as `canvas.json.broken-<uuid>`. If that backup or checkpoint validation fails, recovery leaves the original manifest untouched.

Recovery uses the last confirmed checkpoint, validates its content/assets, and publishes a new revision above the reserved revision counter and all readable snapshot numbers. The counter advances before a manifest is published, so damaging a recent snapshot cannot make its revision number reusable. An unreadable counter refuses recovery. Revision numbers can skip after recovery; follow the before/after links. It does not adopt orphan snapshot content. This prevents an old expected revision from becoming current again. The original bytes and immutable snapshots remain available for inspection. If a process died between publishing the manifest and refreshing its checkpoint, recovery may use the previous checkpoint; it reports the restored revision in `change.restoredFrom`.

## Content-file reconciliation

`prepare_canvas_frame_edit` takes file ID, current revision and frame ID and returns a JSON inbox path. Its envelope contains `revision`, `frameId`, `content` and optional author fields. The agent changes `content` and can supply `author.sessionId` / `author.turnId` for a turn history boundary. It should replace the file atomically. The path is revision-scoped: preparing a later edit never overwrites an earlier agent's file.

`reconcile_canvas` validates the whole file and expected revision under the same locks as normal saves. A valid edit publishes one revision; its exact-byte receipt is saved with that revision, making reconciliation idempotent across restarts. Invalid or partially written JSON and stale revisions return useful problems with the last saved canvas. They never alter canonical content. After another write advances the revision, prepare a fresh inbox and rebase the intended edit onto it.

Raw writes to `canvas.json`, `history/`, `content/` or `assets/` are unsupported. Direct content editing is confined to the prepared inbox. HTML import and targeted node commands use this same guarded storage contract.

## Agent commands and turn context

`carbon canvas` requires the calling session (`CARBON_SESSION_ID`, or `--session` from an external terminal). An agent shell cannot override its calling session with `--session`. Ownership comes from the session's attached project, never the shell's cwd or whatever project the user opens later. Files in linked worktrees share the existing project key; subprojects remain distinct. All agent reads, writes and image requests check membership. Unreadable manifests whose ownership cannot be established remain visible through the app's storage listing, not the agent's project-scoped list.

`ls` lists canvas files; `new <name>` creates one. `context` returns the turn ID, captured canvas/content revision, frame geometry, selected frame/layer IDs and measured bounds (null until measured), initial preview target and returned screenshot evidence. `tree [node]` reads a compact hierarchy. `get <node>` returns HTML, frame CSS and tokens; `--styles` adds measured bounds and CSS from the isolated renderer. Frame lists include stable IDs, dimensions and immutable content hashes.

The composer copies its visible Canvas context synchronously when Send is pressed, before uploading attachments. The optional `canvasContext` argument of `send_msg` carries that copy. The request's task-local scope follows the send's awaits; `QueuedMessage.canvasContext` retains it across a queued delivery. The first delivered prompt fixes the canvas and selection for the turn. Steering cannot replace them. An explicit `--canvas <id>` addresses another file in the same project. No captured canvas means choose a file explicitly or create one; commands do not guess from the latest selected tab. Existing iOS callers omit this optional send argument and ignore the additive queued-message field.

`write <parent>` appends static HTML from stdin as editable nodes. Each call accepts at most 512 KiB. Scripts, embedded pages, custom elements, executable/navigation attributes and external resource references are refused. Frame-local `<style>` rules and inline styles are retained; file-owned images use `carbon-canvas-asset://` references. `set-style <node> '<JSON>'` uses kebab-case CSS property names; null removes one. `set-text <node> <text>` preserves a text layer's ID and refuses to discard nested element layers. `mv <node> <parent> [--index N]`, `dup <node>` and `rm <node>` retain or replace identities deliberately. Cross-frame moves of layers depending on a frame stylesheet are refused rather than changing unrelated destination styles.

`frame ls`, `frame new`, `frame arrange`, `frame resize`, `frame rename`, `frame dup`, `frame rm`, `frame open` and `frame shot` expose explicit frame operations. New and duplicated frames go beyond existing frames with an 80px gap. Copies receive fresh layer IDs and keep file-local assets/tokens; the original remains unchanged. All writes require `--revision` and publish through the shared storage locks. A conflict requires a fresh read and an intentional rebase; there is no force flag.

`open <frame-or-layer>` opens the owning frame in the session's ordinary browser and reveals it in the selected session's Canvas right panel. Existing browser commands inspect that preview. A document capability serves only the current sanitized frame, has no general server token and expires after two hours. Preview requests recheck project ownership, and changes reload only a browser still showing that preview. Navigation to another page is respected.

Preview layout uses the frame's dimensions, including media queries, viewport units and live hover/focus styles. Resizing the frame updates that viewport. Screenshots and recordings restore the preview's dimensions afterward. Other pages in the same tab keep their normal viewport, and returning to the preview restores its design size. HTML fragments use their destination element's parsing context, so appending table rows preserves their structure.

`shot <frame-or-layer>` runs the same `canvasRenderer.js` sanitizer and viewport/style bridge used by the board, in a private headless tab. It never borrows the session's browsing target. PNG bytes land under the owning session's attachments. A JSON record beside the PNG identifies the exact canvas revision, frame/layer, content hash and timestamp. The turn's context also lists these returned captures. The system prompts and embedded Carbon skill require reading each changed frame's screenshot. Returned evidence proves a capture was returned, not that an agent reviewed it.

Touched frames show an Agent editing label until the main turn completes or is interrupted. `canvas_editors` reconstructs live indicators on reconnect; a server restart clears abandoned indicators. Turn context/evidence metadata lives under the owning server's `canvas-turns`, while designs and their history remain in shared config storage.

## Turn undo

Canvas Undo/Redo buttons, Cmd/Ctrl-Z, Cmd/Ctrl-Shift-Z and `carbon canvas undo` / `redo` use the same guarded storage operation. The native editing keys stay with text inputs and the composer while those have focus. An agent turn groups all its design mutations into one step; manual edits form separate steps. `undo --turn <turn-id>` addresses a particular turn.

The last 100 steps store immutable revision references in the committed snapshot. Undo compares identity-keyed properties against each mutation's saved result, restores only matching values, preserves later changes and keeps the current camera. Style properties, text, frame geometry and layer parentage can be restored independently. A new/removed subtree is restored only when that is safe. Conflicts are reported as property paths; a result that would orphan layers is rejected without publishing. Redo reapplies only the changes undo actually restored. New design edits clear redo. File duplication starts a separate undo history.

Undoing a version restore also recovers the image metadata needed by its restored references and preserves later uploads. Restoring identical design content retains the current undo and redo history.

## Server API and events

All commands are registered in `serve.rs` and run on the owning server:

- `list_canvases`, `read_canvas`, `create_canvas`, `update_canvas`
- `duplicate_canvas`, `duplicate_canvas_frame`, `delete_canvas`
- `canvas_history`, `read_canvas_version`, `restore_canvas_version`, `recover_canvas`
- `prepare_canvas_frame_edit`, `reconcile_canvas`
- `write_canvas_asset`, `read_canvas_asset`
- `watch_canvases`

`update_canvas` accepts a patch for name, frames, tokens and camera, plus `clearCamera`. Image reads return exact base64 bytes and MIME metadata, optionally at a historical version; arbitrary paths are not exposed.

`watch_canvases(scope, ids)` replaces that scope's visible set; an empty set releases it. Watches poll manifest/edit metadata every 750 ms and parse only changed files, including atomic renames from another worktree server. `canvas_changed` carries a summary, `canvas_deleted` a tombstone summary (also on other servers watching the shared store) and `canvas_problem` an actionable file error. A client reads and reconciles on open/reconnect, then watches its visible files and re-reads after notifications. Durable state and edit errors are reconstructed from disk; events are invalidations, not the sole copy of a design. The watcher does not keep a React-visible frame tree in memory.

## Verification

Run full Rust tests after filtered runs so ts-rs regenerates the complete `events.ts`. Also run the headless check, frontend tests/build, and the isolated server smoke script:

```sh
cd apps/desktop/src-tauri
cargo test
cargo check --no-default-features --features serve --bin carbon-serve --tests
cargo build --no-default-features --features serve --bin carbon-serve
cd ..
node scripts/verify-canvas.mjs /absolute/path/to/carbon-serve
pnpm test
pnpm build
```

The smoke script uses a temporary `CARBON_HOME` and temporary projects. It does not touch the user's designs or running Carbon server.

With this session's Vite preview open through `carbon browser`, run `node scripts/verify-canvas-renderer.mjs` from `apps/desktop`. It checks ten sequential opaque-iframe captures, including mobile, desktop and custom viewports, media queries, viewport units and frozen used styles. It also holds an image decode open while another frame changes, then checks that the pending capture still completes. It also verifies layer hits across stacking, wrapped text, hidden elements and clipped content, plus cancellation. Layer hits use one short-lived sandbox at the retained preview's original CSS viewport; historical images are resolved for that request and released afterwards. Cached markup retains asset references rather than duplicated base64 data. The probe removes its own iframes and reports capture timing. It needs no project or provider call.

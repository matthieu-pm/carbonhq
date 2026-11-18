# Canvas storage

CBN-80 supplies the file format and server API. CBN-81 adds the Canvas rail page and isolated frame renderer. CBN-82 adds agent commands, HTML import, rendered evidence and turn undo. Stored designs are data; Canvas never modifies the project's source automatically.

## Canvas page

Open Canvas from the rail or with Cmd-Option-C (Ctrl-Alt-C outside macOS). Choose a project and a canvas file tab. New canvas creates a named file; New frame adds a blank Desktop (1440 × 900), Mobile (390 × 844), or custom frame. Custom dimensions are whole pixels from 1 to 10,000. File renaming is supported; frame and layer editing remain separate work.

Scroll to pan. Pinch or Cmd/Ctrl-scroll to zoom around the pointer. The Hand tool or Space-drag pans; the Select tool drags a selection marquee. Shift-click adds or removes frames and layers. Click a frame once to select it and again to pick a layer. Arrow keys navigate the board and layers tree; Enter enters a frame and Escape leaves a layer selection. Fit all is Shift-1, fit selection Shift-2, and actual size Shift-0. All three shortcuts are in the shortcuts registry. Camera position and the last open file are remembered locally per canvas/project.

The layers tree, board outlines and read-only Properties share stable frame/layer IDs. Properties reports the renderer's measured bounds and computed styles. Chat uses Carbon's real transcript and composer, with a session picker and New session action. It keeps the current session when it belongs to the project, otherwise restores that project's remembered session or most recent available session.

## Project tokens

Open **Tokens** to see CSS custom property declarations from the selected Canvas chat session's checkout. With no session selected, Canvas reads the attached project folder. Each row shows the declared value, its source file and line, and the selector or at-rule scope. This includes Tailwind v4 `@theme` declarations, aliases, and theme overrides. Values are shown as declared, so a scoped alias can still read `var(--base)`. **Refresh** reads the current `.css` files, including local edits. Ignored files and dependencies are skipped. An incomplete scan is labelled.

Browser capture keeps its rendered values and records token names where a CSS declaration establishes the link. Styles that can only be measured, such as styles behind an unreadable stylesheet or an ambiguous cascade, keep their computed values. Select a captured layer to see both in **Properties**. Refresh checks token names against the captured checkout when it is active and flags missing names. Refresh leaves the frame, its captured values and its revision intact.

`carbon canvas tokens` reads the calling session's checkout without selecting a canvas. `get` returns a saved node's token links and capture context at the requested revision. A design attachment carries the names it had when added to chat. Use the target project's tokens when applying the design. See the [Paper and Gui comparison](research/cbn-85-paper-gui-tokens.md).

## Capture

In the browser pane, choose **Capture** and click an element. Use ⌘-click or ⌘Enter to capture the full page at the browser's current CSS viewport width. The capture opens beside the project's existing frames with the new frame selected. If a destination has not been selected, choose or create a canvas. Undo removes the frame as one edit.

The frame keeps a static copy of text, layout, styles, and available image and font bytes. Properties shows the page path, viewport, available source hints, capture notes, and the original screenshot. Unsupported regions appear as labeled image references. If the screen exceeds the editable layer limit, the whole frame is labeled **Image reference**. Full-page captures report cropping at the viewport width or at the 10,000 px capture limit. Scrolled regions preserve their visible state as images. Capture masks form values and hides embedded pages whose fields it cannot inspect. It discards the capture if the page changes while taking the screenshot.

`carbon browser capture [selector] --to <file>` writes the same capture as a versioned JSON file with its original screenshot and assets. Omitting the selector captures the full page. The command uses the session's current browser layout and writes a new file under its checkout. It leaves the Canvas board alone.

## Design handoff

Select frames or layers, then use **Add to chat** or Cmd-L (Ctrl-L outside macOS). Each selection becomes a composer chip with its canvas, name, captured revision and rendered preview. The action opens Chat and focuses the composer without sending. Chips can be removed or inspected before sending. Repeating the action adds another batch; an already attached node at the same revision is not duplicated. Up to 32 selections can be captured at once. The browser's Inspect selection keeps Cmd-L while Inspect is active in the visible project preview.

References are captured on the owning server. Each carries stable canvas/frame/layer IDs, frame dimensions, measured bounds, a content fingerprint and capture time. The attachment envelope retains the PNG and metadata. The chip loads a bounded preview from the owning server. A hidden or clipped layer shows its enclosing frame and keeps the exact layer ID. Queued messages retain that envelope, and canceling one restores the same chips. Sent messages archive metadata and previews with the session; replay and forks retain them independently of the original upload or Canvas source. The iOS transcript also decodes the references and shows their names and revisions beside its existing image previews.

Inspecting a chip shows the captured preview. A changed frame or its tokens shows **Design changed**, with **Refresh reference** available in the composer. Refresh captures a new explicit revision. A removed layer, missing canvas or unreadable historical version shows **Unavailable** and keeps the preview. Neither a reread nor a notification silently replaces the captured design. The status conservatively checks the whole enclosing frame and its tokens, since an ancestor or sibling can affect a layer's appearance.

The agent receives a structured reference file with selected IDs, dimensions, current availability, and the archived picture path. Image-capable transports can also send the picture directly. Explicit attachments take precedence over the live selection, including for queued sends. For visible selections its instructions require exact `carbon canvas --canvas <id> --revision <captured> get <node> --styles` and `shot <node>` reads. Historical reads retain their revision even after edits or layer removal; a missing canvas/history fails rather than falling back to the newest design. Markup and tokens come from that revision. Project source components are not inferred from pixels; the agent must inspect the actual project.

Attaching alone supplies context. Applying a design to project code requires a user request. The handoff asks the agent to reuse the project's components, tokens and file layout, name any new components, and preserve originals when exploring alternatives. It asks for the correct worktree's managed preview, target-size browser checks, screenshot evidence and any remaining differences. These are instructions and available tools, not proof that an agent followed them. The handoff itself does not publish or commit code.

The comparison with [Paper](research/cbn-83-paper-handoff.md) and [Gui](research/cbn-83-gui-handoff.md) records which behavior was observed and which guarantees Carbon adds.

Preview separates the focused canvas frame from the running project. Only the focused frame has a live sandboxed iframe; its viewport stays at the frame's CSS dimensions, with scrolling for large frames. The running project uses the selected session's existing browser and preview controls. Hiding the page or frame Preview removes its live iframe.

The overview uses raster images, retained layer geometry and one capture at a time. Captures prioritize the focused and visible frames. Thumbnail resolution falls as more frames become visible; image, key and geometry estimates share a 24 MiB cache budget. Offscreen previews are released. Used styles are frozen before rasterizing, so thumbnail resolution and board zoom do not change viewport units or media queries. A pending replacement retains the previous valid preview. File/project switches reject stale reads and captures. Reopening and reconnecting read durable state and rearm watches.

Both live and capture documents have an opaque sandbox origin. Stored scripts, event handlers, embedded pages and navigation attributes are omitted. CSP blocks network requests, forms and app-origin resources. File-owned images and captured fonts resolve through the owning server into data URLs. The renderer currently limits a frame to 2,000 elements, 16 MiB of embedded asset data and 16 MiB of serialized capture markup. These limits report an error without changing the saved design.

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
  assets/<sha256>              immutable image and captured font bytes
  edits/<revision>/<frame-id>.json
  uploads/<asset-id>           incomplete images, not visible assets
```

New files and duplicates are staged under `canvases/pending/<id>` and enter the visible UUID namespace only after the whole file is complete. Failed publications are removed; startup clears abandoned staging directories under the same write lock.

The manifest states `formatVersion`, `minReaderVersion`, file `id`, `revision` and `commit`. Reader 1 accepts an additive newer format only when `minReaderVersion <= 1`. Known records preserve additional JSON fields on normal writes. An unsupported reader requirement refuses reads, edits, duplication, deletion and recovery. No recovery or migration runs implicitly over a future format.

A frame has an ID, name, geometry (`x`, `y`, `width`, `height`) and content. Content has a node tree, a CSS stylesheet and `assetIds`. Nodes are either elements (`id`, `name`, `tag`, string-valued `attributes`, string-valued CSS `styles`, `children`) or text (`id`, `name`, `text`). CSS variables are stored as strings; shared tokens live separately on the canvas. Camera state is separate from frame content.

Canonical asset references use `carbon-canvas-asset://<asset-id>`. URLs in attributes, styles and CSS must name an asset in that frame's `assetIds`. Every declared asset must exist in the canvas. The owning canvas resolves the URL. Storage validates references and the renderer isolates untrusted HTML/CSS.

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
- `capture_canvas_selection`, `canvas_reference_status`
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

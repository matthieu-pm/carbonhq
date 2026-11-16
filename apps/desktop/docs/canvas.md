# Canvas storage

CBN-80 supplies the file format and server API. The Canvas rail page, HTML import/export, renderer and agent CLI belong to CBN-81/82. Stored designs are data; this module does not render HTML, execute scripts or modify the project's source.

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

Each committed change records its ID, before/after revisions and optional session, turn and label. Content, layout, tokens and image references are all in the snapshot. This is independent of Git. History lists the latest 100 committed revisions; older ones remain addressable. Restore publishes a new revision with historical design content/layout/assets and the current camera. Property-wise turn undo that preserves later manual edits belongs to CBN-82/86, not this full-version restore.

Images stay available to historical revisions until the file is permanently deleted. Upload chunks have no visible revision; finalization publishes the image metadata with a guarded revision. Chunk offsets support exact retries and reject conflicting bytes. Finalized image IDs cannot be overwritten.

Deletion is permanent, including content, images and history. It first records a tombstone with the next revision and hides the file, then removes its directory. Startup finishes cleanup after an interrupted deletion. A duplicate owns its own assets and remains readable.

## Recovery

Reads never replace a bad manifest with an empty canvas. Listing validates manifests and frame content and returns unreadable files as `problems`. Image bytes are checksum-verified when read, copied or recovered. Explicit recovery first preserves the original bytes as `canvas.json.broken-<uuid>`. If that backup or checkpoint validation fails, recovery leaves the original manifest untouched.

Recovery uses the last confirmed checkpoint, validates its content/assets, and publishes a new revision above the reserved revision counter and all readable snapshot numbers. The counter advances before a manifest is published, so damaging a recent snapshot cannot make its revision number reusable. An unreadable counter refuses recovery. Revision numbers can skip after recovery; follow the before/after links. It does not adopt orphan snapshot content. This prevents an old expected revision from becoming current again. The original bytes and immutable snapshots remain available for inspection. If a process died between publishing the manifest and refreshing its checkpoint, recovery may use the previous checkpoint; it reports the restored revision in `change.restoredFrom`.

## Content-file reconciliation

`prepare_canvas_frame_edit` takes file ID, current revision and frame ID and returns a JSON inbox path. Its envelope contains `revision`, `frameId`, `content` and optional author fields. The agent changes `content` and can supply `author.sessionId` / `author.turnId` for a turn history boundary. It should replace the file atomically. The path is revision-scoped: preparing a later edit never overwrites an earlier agent's file.

`reconcile_canvas` validates the whole file and expected revision under the same locks as normal saves. A valid edit publishes one revision; its exact-byte receipt is saved with that revision, making reconciliation idempotent across restarts. Invalid or partially written JSON and stale revisions return useful problems with the last saved canvas. They never alter canonical content. After another write advances the revision, prepare a fresh inbox and rebase the intended edit onto it.

Raw writes to `canvas.json`, `history/`, `content/` or `assets/` are unsupported. Direct content editing is confined to the prepared inbox. HTML parsing and targeted node commands will sit above this storage contract in CBN-82.

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

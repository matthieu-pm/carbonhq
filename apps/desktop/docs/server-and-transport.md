# Server and transport

The Mac app is a client of its background server. The server owns sessions,
agent processes, logs, the orchestration socket and Remote access. Closing
the window or choosing Quit leaves those running. Quit completely
stops the server too.

## Process and data ownership

[`main.rs`](../src-tauri/src/main.rs) handles `--serve` before initializing
Tauri. [`launchd.rs`](../src-tauri/src/launchd.rs) installs the release job
`com.yogesh.carbon.server` using that executable. A dev app starts its server
as a child instead, so macOS attributes permissions to the app rather than
to each unsigned server rebuild.

[`store.rs`](../src-tauri/src/store.rs) chooses the data home:

| Build | Default home |
| --- | --- |
| Release app or standalone `carbon-serve` | `~/.carbon` |
| Main-checkout `pnpm tauri dev` | `~/.carbon-dev` |
| Worktree `pnpm tauri dev` | `~/.carbon-worktrees/<name>` |
| Any build with a nonempty `CARBON_HOME` | The supplied directory |

The worktree name comes from the compile-time `CARGO_MANIFEST_DIR`, not the
shell's current directory. A debug bundle is not the same as `tauri dev`;
use an explicit scratch home when testing a bundle beside the installed app.

Default dev homes share projects, settings and credentials in `~/.carbon-dev`
through `config_dir()`. Writers of those files take `lock_across_processes`.
Sessions, drafts and the server list stay per home. An explicit custom home
also isolates configuration. Keep new durable configuration on the correct
side of this split.

`serve.lock` permits one server per home. Never start another core against
the same session files. [`serve.rs`](../src-tauri/src/serve.rs) writes its
address, executable stamp and pid to `serve-port`, and its token to
`serve-token`. The app reads them on reconnect. A stale binary is asked to
`restart_when_idle`; the server exits with code 75 so its supervisor restarts
it. Rebuilds and updates use the same path.

## Add or change a command

Use [`transport.ts`](../src/lib/transport.ts)'s `invoke`, `listen` and
`fileSrc` in the frontend. Importing Tauri directly bypasses remote ownership.

| Command owner | Registration |
| --- | --- |
| Core: sessions, files, git, Pages, trackers | Add the command to `serve.rs`'s dispatch table; accept `Sink` for events |
| Mac app: native browser, dictation controls, dialogs, updater | Register in `lib.rs`'s `generate_handler!` and `transport.ts`'s `APP_COMMANDS` |

[`transport.test.ts`](../src/lib/transport.test.ts) holds the two app lists
together. A missing `APP_COMMANDS` entry sends a native call to the server,
where it fails as `unknown command`. A core command registered only with
Tauri fails for every server client.

`invoke` chooses an explicit server first, then one named by a qualified
argument, then the session's owner, then `local`. Qualified paths look like
`carbon://<server>/absolute/path` in the frontend; core code receives the
owner's raw path. App-local browser and notification actions stay on this Mac.
`local` is the background connection, not an in-process session manager.

[`servers.rs`](../src-tauri/src/servers.rs) forwards server events with their
owner. A local call waits up to 20 seconds for connection recovery. The local
client may offer a host callback channel for screen-owned work; `host_call`
is accepted only on the local listener. Browser automation can use CEF while
the app is open and headless Chromium otherwise.

## Reconnect state and protocol changes

There are two versioned protocols. The WebSocket serve handshake is
`serve.rs::PROTOCOL`, mirrored by `transport.ts` and the
[iOS connection](../../ios/Carbon/Connection.swift). The CLI envelope uses
[`carbon-proto`](../../../crates/carbon-proto/src/lib.rs)'s
`PROTOCOL_VERSION` and per-request minimums. Do not bump one as a substitute
for reviewing the other.

Commands use camelCase arguments and reply with `id` plus `ok` or `err`.
Events carry `event` and `payload`. Clients opting into `deflate` must also
accept binary raw-deflate JSON frames; clients not opting in receive text.

Reconnect recovery has two parts:

- Persisted events come from the log tail and merge by event `id`, never
  `seq`, because subagents have their own counters.
- Unpersisted state comes from `live_state`: pending asks, background tasks,
  queued prompts and secret request metadata. Extend `Live` or its snapshot
  source when adding state that must survive a connection drop.

[`resync.ts`](../src/lib/resync.ts) and
[`useSessions.ts`](../src/hooks/useSessions.ts) consume that state. A server
restart loses unpersisted requests; reconnect to the same running server
must retain answerable cards. Check both cases when changing this path.

Wire/event changes also need the hand-written Swift types in
[`apps/ios`](../../ios/README.md). They decode leniently, so a renamed field
can disappear from the phone without producing a decode error.

## Isolated server checks

From `apps/desktop/src-tauri`, build and run the headless target with a new
scratch directory:

```bash
CARBON_HOME="$(mktemp -d)" cargo run --no-default-features --features serve --bin carbon-serve -- --port 0
```

This stays in the foreground and prints connection details. Keep them local;
the token authorizes the server. For CLI smoke tests, point `CARBON_ENDPOINT`
at `<scratch-home>/carbon.sock`. A dev app's agents already receive the right
endpoint; do not replace it with a hardcoded `carbon-dev.sock` path.

For a browser preview, start Vite from `apps/desktop` and open its page with
`?token=<scratch-token>&server=ws://127.0.0.1:<scratch-port>`. The query enables
the browser transport; bare Vite does not start a core. Native-only commands
still require the desktop app. Remote files use the authenticated `/file`
route, which serves approved attachment and recording paths, not arbitrary
project files.

Run the frontend tests/build, bare Rust tests and the headless check listed in
the [engineering index](README.md#validate-changes). For runtime evidence,
exercise send, reconnect and the affected command against this scratch server.

# Managed previews

CBN-77 gives each session a dev server owned by its Carbon background server. The chat header starts or stops it; the details button opens its status, log and saved setup. Closing the window does not stop it. Settling or deleting the session, removing its worktree, or stopping the server does.

## Setup and ownership

The first start asks for an app folder relative to the session's checkout and a dev command. Setup reads that folder's `package.json`, keeps its package manager, and suggests a known server's port flag. Commands can use `{port}`; the same port is passed in `PORT`. Unknown or chained scripts rely on `PORT` unless the user adds a placeholder. A command that ignores both fails readiness rather than attaching to an unrelated server.

The folder and command are saved per project in `previews.json` under `store::config_dir`, with an atomic write and the shared process lock. Sessions in different worktrees reuse the setup but resolve the folder against their own `cwd`. Setup never changes the session's working directory or the agent process.

The process manager is [preview.rs](../src-tauri/src/preview.rs). It runs the command through a login shell, assigns a free port, drains stdout and stderr into a bounded 64KiB log, and emits `preview_changed` transitions. A run has a generation, so a stopped or replaced run cannot change a newer run's state. State transitions and their events are ordered together. It tracks descendant process groups too: pnpm's launcher can move its dev server into another group. Linux reads process ownership from `/proc`; macOS uses bounded `ps` and `lsof` probes.

Readiness checks the listener's ownership before making an HTTP request. Its URL names the owned IPv4 or IPv6 loopback explicitly. A listener on the other family cannot make Carbon show another checkout. Only the focused session's requested start opens the browser; an existing preview recovered on reconnect does not take over the user's view.

The limit is three starting or running previews per owning server. Starting a fourth stops the oldest and retains its explanation and log. The app's connection to that server is not the preview's lifetime.

## Commands and reconnect

These are core RPC commands, registered in `serve.rs`:

| Command | Result |
| --- | --- |
| `preview_setup(sessionId, directory?)` | Saved config and suggested command |
| `preview_start(sessionId, config?)` | Starting state; later transitions arrive as events |
| `preview_status(sessionId)` | Current state, including stopped or failed |
| `preview_stop(sessionId)` | Stopped state after cleanup |
| `preview_logs(sessionId)` | The latest run's bounded output |

`live_state.previews` carries the latest state for reconnects. The frontend store rejects command replies older than a lifecycle event and reconciles each server separately. No fields were added to the session index or normalized agent event model. Older clients can ignore the new live-state field.

CBN-78 adds `carbon preview start`, `stop`, `url` and `logs` over the orchestration socket. Start uses saved setup or a package.json suggestion, saves explicit command and folder overrides, reuses matching live runs and waits up to 150 seconds for readiness. It returns the URL without opening the browser. The CLI stamps only preview requests as protocol v17, so older apps refuse them with an update instruction. Logs and browser output carry an untrusted-context label on stderr.

## Remote browser connection

The app's `preview_forward` command opens a private loopback listener. Each browser connection is carried as raw TCP over an authenticated WebSocket to the owning server's `/preview-tunnel` route. This also carries the dev server's WebSocket upgrades, including HMR. It works for servers added by address as well as SSH.

The server chooses the target from the session's running managed preview; the client cannot name an arbitrary port. The initial admission sends the token inside the private connection, never in the browser URL. Browser-origin requests are refused. The connection rechecks the preview while relaying and ends when it stops or changes address. Disconnecting the owning server drops its local listeners and active connections. This does not create a public share link.

## Verification

`preview.rs` tests use real subprocesses and sockets for separate checkouts, startup crashes, foreign listeners, IPv4/IPv6 separation, descendant cleanup, replacement races and eviction. `preview_tunnel.rs` tests admission, HTTP bodies, half-closes, WebSocket upgrades and connection cleanup. `src/lib/preview.test.ts` covers late RPC replies and per-server reconnect state.

`demo/preview.html` mounts the shipping control against a throwaway `carbon-serve`; pass its `server` and `token` query parameters as in the existing servers demo. The demo uses an iframe to show the actual app response. It checks the control and real core lifecycle; the desktop app uses its existing native browser pane.

Local validation on 16 November 2026 passed 1,244 Rust tests (32 ignored), 1,120 frontend tests, the desktop production build and the headless build check. The Rust suite was run serially after an unrelated launchd-lock test flaked under concurrent process-spawning tests. A frontend avatar test timed out during concurrent compilation and passed in the final full run without that contention.

Nine live RPC checks against a separate `carbon-serve` passed: two pnpm previews serving distinct session folders, saved monorepo setup, authenticated HTTP tunnelling and refusals, oldest-preview eviction, isolated stop, settle cleanup, reconnect survival, early-exit logs and folder confinement. The real control was exercised in light and dark mode, including Enter-to-start, shared setup, logs, stop, and cancellation during a delayed suggestion. An Opus crew reviewed the integrated implementation; its confirmed findings were fixed. The native desktop browser pane and an actual remote Linux host were not exercised in this run.

The PR review caught two further cases: an IPv6-only wildcard listener needs readiness to try IPv6 after IPv4 refuses, and deletion must close a preview started during its disk cleanup. The IPv6 regression failed before the fix and passed afterwards. A live deletion test started a second server while the first ignored SIGTERM, then confirmed deletion removed the second server's state and listener. Both fixes passed a separate review.

## Agent CLI verification (CBN-78)

The CLI and protocol suites passed 43 and 8 tests. The full core suite passed 1,262 tests (34 ignored), including concurrent start reuse, timeout cleanup and a replacement that reuses the same port. CLI waiters hold an immutable run ID and that run's log, so a replaced request cannot stop or report output from its replacement. The frontend's 1,120 tests, desktop build, headless build/check and isolated docs build passed.

Nine checks against two isolated local servers exercised automatic setup, repeated and concurrent reuse, URL/log output, app lifecycle events without browser opening, stop, saved monorepo overrides, early-exit logs, folder confinement and remote session/machine routing. A separate check explicitly opened the returned URL with `carbon browser`, set 1280×800, read the expected page content and captured a screenshot. This used Carbon's existing server browser with its installed Chromium binary; it did not exercise the native pane or a physical remote Linux host. Standards and Spec reviews passed after fixing the run-identity finding.

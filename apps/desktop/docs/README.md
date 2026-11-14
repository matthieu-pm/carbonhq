# Engineering docs

These notes describe the current implementation and the invariants behind it.
Read the repository's [CLAUDE.md](../../../CLAUDE.md) before editing. For UI
work, also read [DESIGN.md](../DESIGN.md). Public instructions live in
[`apps/docs/content`](../../docs/content); its [README](../../docs/README.md)
explains how to build that site.

## Find the owning subsystem

| Area | Notes |
| --- | --- |
| Processes, data homes, command routing, reconnect | [Server and transport](server-and-transport.md) |
| CLI, protocol, cross-machine requests | [Orchestration](orchestration.md) |
| Harness wire formats and model controls | [Harnesses](harnesses.md), [models](git-and-models.md), [fast mode](fast-mode.md) |
| Session copies and cleanup | [Forking](forking.md), [worktrees](worktrees.md) |
| Input, attachments and handoff buttons | [Composer](composer.md), [handoff](handoff.md) |
| One-use secret handoffs | [Secrets](secrets.md) |
| Transcript code and file links | [Rendering code](rendering-code.md), [file opening](file-opening.md) |
| Diff, repository and file views | [Repo and Files views](repo-and-files-views.md) |
| Session lists, crew and notices | [Sidebar and crew](sidebar-and-crew.md), [notifications](notifications.md) |
| PRs and issue trackers | [Pull requests](pull-requests.md), [issues](issues.md) |
| Project grouping | [Profiles](spaces.md) |
| Document workspace | [Spaces and Pages](pages.md) |
| Embedded browser and recordings | [Browser](browser.md) |
| Dictation | [Transcription](transcription.md) |
| Preferences, account limits and telemetry | [Settings](settings.md), [subscription usage](subscription-usage.md), [analytics](analytics.md) |
| Release and updater work | [Releases](releases.md) |

Plans outside this directory describe design work and may include unfinished
steps. `release-checks-*` files and the verification sections in subsystem
notes record a particular run; their counts and limitations are historical.
Check source and release artifacts before treating them as current evidence.

## Validate changes

Install dependencies at the workspace root with `pnpm install --frozen-lockfile`.
Run app commands in the package named below. Run each command independently
from that directory.

| Change | Directory | Checks |
| --- | --- | --- |
| Frontend logic or UI | `apps/desktop` | `pnpm test`, `pnpm build`; exercise the affected flow in the running app |
| Rust core or normalized events | `apps/desktop/src-tauri` | `cargo test`, `cargo check --no-default-features --features serve --bin carbon-serve --tests` |
| CLI grammar or orchestration wire | `apps/cli`, then `crates/carbon-proto` | `cargo test` in each; exercise the CLI against an isolated server |
| Public docs | `apps/docs` | `pnpm build`; inspect affected routes through `carbon browser` |
| iOS wire or shared native views | `apps/ios` | Follow the [native checks](../../ios/README.md#validation) |

Rust tests regenerate `src/types/events.ts` through ts-rs. After any filtered
Rust test, run bare `cargo test` before checking the frontend. Do not repair the
generated file by hand. Ignored tests often require real signed-in CLIs,
servers or provider fixtures; inspect their setup before opting in.

Use [kept demo pages](../demo) for isolated UI checks, then verify the real
flow where it depends on native APIs or server state. Plain Vite has neither
unless connected to a server. Start `pnpm tauri dev` in the background when
needed; do not block waiting for a cold native build.

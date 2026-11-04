# Editing sent messages

CBN-3 / [GitHub #21](https://github.com/matthieu-pm/carbonhq/issues/21).

The latest sent prompt has an Edit message action. Its bubble becomes an inline
editor with the original text, Cancel, and Send. Cancel changes nothing.
The revised prompt replaces the turn in the same chat. A running turn is
interrupted first. The new prompt is marked “Edited · replayed.”

## Full undo requirement

Editing is available only for text-only Codex turns whose native history Carbon
can verify. Claude Code and the other harnesses show an unsupported explanation.
Attachments, queued or relayed prompts, tools, background work, compaction,
unknown protocol events, and file changes block replay. Even read-only tools are
blocked: Carbon does not assume their effects are reversible.

Carbon compares the checkout with the prompt's starting snapshot. It never
restores files over preexisting or later user edits. A missing snapshot or a
changed checkout blocks replay. This feature does not offer general tool or
external-action rollback.

## Replay sequence

The session lock serializes replay with sends. Carbon checks eligibility, stops
the running turn, then checks the event log and checkout again. It requests the
latest full native turn with `thread/turns/list` and accepts only one user prompt
and text/reasoning items. The native turn id must match Carbon's turn.

Codex's experimental `thread/revert` removes that turn from the agent's context.
Carbon then sends the revised prompt through the regular send path. After a
successful send, a persisted `turn_replayed` event names the old and replacement
prompt ids. Transcript readers exclude the old range, while the raw log retains
it for provenance. The context meter uses the same active history. iOS reads the
additive event and excludes the same range.

The editor retains revised text when verification, interruption, rewind, or send
fails. Errors distinguish a rewind failure from a send failure after rewind. A
marker-write failure says the prompt was sent and warns against submitting it
again. Carbon does not automatically retry an ambiguous send.

## Verification

Pure tests cover eligibility, unsafe events, checkout protection, native-history
validation, superseded ranges, and repeated replacements. The demo at
`/demo/sent-message-edit.html` exercises the actual editor with completed, running,
blocked, unsupported, and failed-replay fixtures.

The ignored Rust test `live_replays_completed_and_running_turns` uses a signed-in
Codex account in an isolated temporary home and git repository. It verifies that
both completed-turn replacement and running-turn interruption produce real agent
responses to the revised prompt. Run it alone with `--ignored --test-threads=1`;
it sets `CARBON_HOME` and must not share a process with other tests.

## Provider capability audit — 2026-11-04

The current Codex-only gate describes Carbon's integration coverage. It does not
mean the other CLIs lack conversation replacement features.

| Provider | Native capability | Carbon status and verification |
| --- | --- | --- |
| Codex | `turn/interrupt`, then `thread/revert` before a native turn, then `turn/start`. Revert supports persistent paginated history and leaves local files alone. | Implemented for verified text-only turns. Installed 0.166.0; completed and running replay passed against the real agent. Legacy history remains unsupported. |
| Claude Code | A truncating print-mode resume supports `--resume-session-at` paired with `--resume-drops-turn`. The guard refuses to discard another prompt's queued messages or task notifications. | Installed 2.1.318. Isolated native CLI tests passed for completed and interrupted running turns; a mismatched discard UUID was rejected. Carbon still needs native prompt/anchor UUID tracking and an interrupt/respawn path. The first prompt needs special handling because there is no earlier conversation anchor. |
| Grok | `_x.ai/rewind/points` and `_x.ai/rewind/execute` support a target prompt index and conversation-only rewind. Published source separates preview (`force: false`) from execution (`force: true`). | Installed 1.0.70. Direct protocol probes confirmed both routes and accepted `conversation_only`. No real conversation was modified in these probes. Carbon still needs checkpoint correlation, full native-history validation, and replay integration. |
| pi | RPC `fork` activates a new native session with history before a selected user entry; `abort`, `clear_queue`, and history inspection are available. | Not installed locally. Official 1.5.0 source supports a possible same-Carbon-chat implementation with a native fork underneath. Carbon must persist the resulting session file path to resume it after restart. Not runtime-verified. |
| fx | Current ACP methods include cancellation and resume, with no rewind/truncate/fork method. The documented `/fork` is a TUI action that creates a separate native conversation after the response finishes. | Not installed locally. No verified turn-replacement route through Carbon's current ACP adapter. This is a bounded finding about that adapter, not every private or SDK surface. |

Native history replacement does not establish full rollback of tool, shell,
background, hook, or external effects. The full-undo gate remains necessary for
every provider. A native file checkpoint alone cannot satisfy that requirement.

Primary sources:

- [Codex app-server: revert thread history](https://developers.openai.com/codex/app-server#revert-thread-history).
- [Claude SDK options: resumeSessionAt and resumeDropsTurn](https://code.claude.com/docs/en/agent-sdk/typescript#options).
- [Grok rewind extension handlers](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/extensions/rewind.rs) and [conversation/file implementation](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/session/acp_session_impl/rewind.rs). The installed build's private commit was not available in the public mirror, so source behavior beyond the probed routes is not a runtime claim.
- [pi RPC command union](https://github.com/earendil-works/pi/blob/9ca159208a329b10271fc1c392189b1005e09c83/packages/coding-agent/src/modes/rpc/rpc-types.ts) and [fork contract](https://github.com/earendil-works/pi/blob/9ca159208a329b10271fc1c392189b1005e09c83/packages/coding-agent/docs/rpc-commands.md#fork).
- [fx ACP dispatcher](https://github.com/vercel-labs/fx/blob/fd8f6a1a5fbd2c6f271f9e4e5a01c2fadde4eb29/src/acp/server.zig#L98-L107) and [session fork documentation](https://fx.sh/docs/using-fx/sessions#fork-a-conversation).

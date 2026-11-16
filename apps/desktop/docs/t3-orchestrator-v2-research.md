# T3 Code Orchestrator v2: opportunities for Carbon

Investigated 2026-11-16. Carbon source: `02989124c70770410df1f799827320bee0590420`. T3 Code source: [`dfeaf7b13786712cc350fa35abea17715fdef987`](https://github.com/pingdotgg/t3code/commit/dfeaf7b13786712cc350fa35abea17715fdef987), current upstream main when checked. The adjacent reference checkout was at `a21d7887` from November 4; this comparison uses a separate temporary upstream snapshot and leaves that reference untouched.

## Recommendation

Keep Carbon's session, worktree, harness and transport foundations. Add a durable task and delivery layer above them. The strongest product improvement is reliable completion reporting without agent polling. Retry-safe commands and durable message acceptance are the foundation that makes it trustworthy.

| Order | Opportunity | User benefit | Relative scope |
| --- | --- | --- | --- |
| 1 | Stable request IDs and command receipts | Retrying a lost response does not create another worker or repeat a message | Medium |
| 2 | Durable agent message inbox | An accepted handoff survives a server restart | Medium |
| 3 | Explicit delegated tasks and completion delivery | A parent gets a stable result without reminding the child or polling sessions | Larger |
| 4 | Visible recovery outcomes | Interrupted work has a reason and a clear next action | Medium; shares persistence above |
| 5 | Agent-facing capability discovery | Agents choose installed harnesses, models and supported options correctly | Small to medium |
| 6 | Replay and stream budgets | Large crews and slow clients have bounded memory and reconnect cost | Medium; measure first |

Scope estimates are architectural judgments, not implementation estimates. These are source-backed opportunities; this investigation did not reproduce production failures or run either app's test suite.

## What v2 actually adds

T3 separates the visible conversation (`AppThread`), counted work (`Run` and attempts), nested execution (`ExecutionNode`), provider handles, context transfers and requests. This lets task outcomes survive changes to the process or provider conversation that executed them. Its graph is described in the [data model](https://github.com/pingdotgg/t3code/blob/dfeaf7b13786712cc350fa35abea17715fdef987/docs/orchestration-v2/core-graph-and-data-model.md#L5-L40).

The architecture docs explicitly describe a target, so they are insufficient proof of shipped behavior. In current source, command commit reserves a receipt, appends events, updates projections, enqueues effects, and finalizes the receipt through a transaction before publication. A duplicate command replays its stored result. This infrastructure is present even though the README still presents a durable outbox as a follow-up. See [transaction and publication](https://github.com/pingdotgg/t3code/blob/dfeaf7b13786712cc350fa35abea17715fdef987/apps/server/src/orchestration-v2/EventSink.ts#L315-L340), [command commit](https://github.com/pingdotgg/t3code/blob/dfeaf7b13786712cc350fa35abea17715fdef987/apps/server/src/orchestration-v2/EventSink.ts#L763-L865), and [receipt replay](https://github.com/pingdotgg/t3code/blob/dfeaf7b13786712cc350fa35abea17715fdef987/apps/server/src/orchestration-v2/Orchestrator.ts#L15348-L15425).

## 1. Make create and send safe to retry

**Carbon today.** The protocol envelope holds a version and request. Create/send have no caller request ID. Every create mints a new session UUID, and the socket executes the request before writing its response. A response lost after success therefore leaves a caller without a safe retry key. This is a verified failure window, not a reproduced duplicate. See [protocol](../../../crates/carbon-proto/src/lib.rs), lines 80–84, 654–727 and 795–802; [socket and creation](../src-tauri/src/orchestration.rs), lines 239–264 and 1206–1255.

**T3 pattern.** Delegation derives a stable command ID from a supplied `clientRequestId` and scope, then checks the receipt before preparing another workspace. Omitting the key generates a fresh one, so retry safety still requires caller discipline. See [delegation implementation](https://github.com/pingdotgg/t3code/blob/dfeaf7b13786712cc350fa35abea17715fdef987/apps/server/src/mcp/OrchestratorMcpService.ts#L2678-L2753).

**Carbon proposal.** Add an optional CLI request ID to create/send and preserve it across retries and machine forwarding. Persist the request-to-session or request-to-message binding before side effects. Reserve, reconcile and finish that operation durably; a receipt written only after spawning leaves the crash gap open. Refuse reuse with a different payload. Return the same identity and recorded result on retry. The existing protocol version rules must refuse a server that would silently ignore the retry key.

This provides retry-safe acceptance. It cannot promise exactly-once execution of arbitrary commands inside an agent.

## 2. Persist accepted messages between agents

**Carbon today.** A relayed message enters the normal `send_msg` path. Held prompts are intentionally memory-only and cancelable until flush. `send_message` returns `queued: bool`. On a handled child exit, Carbon surfaces stranded messages for retry, which is valuable; a server process crash cannot run that cleanup. See [relay](../src-tauri/src/orchestration.rs), lines 1618–1698; [queue and exit handling](../src-tauri/src/session.rs), lines 64–106, 2586–2608 and 4288–4356.

**T3 pattern.** Durable effects have claim ownership and settlement. Startup distinguishes effects that can be replayed from effects bound to the dead process. Its notification mailbox explicitly acknowledges an at-least-once boundary between provider acceptance and app receipts. See [process-loss reconciliation](https://github.com/pingdotgg/t3code/blob/dfeaf7b13786712cc350fa35abea17715fdef987/apps/server/src/orchestration-v2/EffectOutbox.ts#L523-L550), [worker settlement](https://github.com/pingdotgg/t3code/blob/dfeaf7b13786712cc350fa35abea17715fdef987/apps/server/src/orchestration-v2/EffectWorker.ts#L755-L1000), and [mailbox limitation](https://github.com/pingdotgg/t3code/blob/dfeaf7b13786712cc350fa35abea17715fdef987/apps/server/src/orchestration-v2/NotificationMailbox.ts#L22-L37).

**Carbon proposal.** Give accepted agent messages a durable inbox with message ID, sender, recipient, payload and delivery state. Keep the existing composer queue behavior unless deliberately changed. Distinguish persisted acceptance, submission to the harness, and a result observed by the parent. Reconcile uncertain submissions using harness evidence where available; otherwise surface uncertainty instead of blindly replaying a prompt that may already have run. Machine forwarding must retain the same delivery identity.

## 3. Separate a delegated task from its child session

**Carbon today.** `parentSessionId` gives ancestry, and the child remains an ordinary session. The shipped skill says nothing reports back automatically; reviews must be told to send findings, and an orchestrator polls `session ls` for completion. Session `completed` also means unread, and turns can reopen for background output. Neither is a stable task-result contract. See [shipped skill](../../cli/skill/SKILL.md), lines 214–216 and 332–351; [status tracking](../src-tauri/src/session.rs); [Crew projection](../src/lib/crew.ts).

**T3 pattern.** `delegate_task` creates durable task state linked to a parent run and child run. Async mode enables a completion wake. Wait mode can return on timeout or a blocking question without cancelling the child. Task reads distinguish current work from the published result; later child follow-ups do not replace that result. Delivery tracks claims, accepted generations and successors so later result waves can still wake the parent. See [delegation implementation](https://github.com/pingdotgg/t3code/blob/dfeaf7b13786712cc350fa35abea17715fdef987/apps/server/src/mcp/OrchestratorMcpService.ts#L2640-L2798), [delivery acknowledgment](https://github.com/pingdotgg/t3code/blob/dfeaf7b13786712cc350fa35abea17715fdef987/apps/server/src/orchestration-v2/Orchestrator.ts#L2082-L2185), and [task contract](https://github.com/pingdotgg/t3code/blob/dfeaf7b13786712cc350fa35abea17715fdef987/docs/orchestration-v2/orchestrator-mcp-server.md#L228-L340).

**Carbon proposal.** Introduce an opt-in task record with an app-owned task ID, parent and child session IDs, originating operation, outcome and immutable result. Expose status, result and cancellation through the CLI. Deliver completion durably to the parent, with deduplication and acknowledgment. Carry source session, branch and relevant commit/artifact references in the result so it is reviewable. Later work in the same session gets its own task/result identity.

Do not automatically treat every child turn end as task completion. Define completion over the requested work, including work it explicitly awaits. A dev server should not keep a task open forever. Do not automatically wake parents for every ordinary crew session: the existing skill deliberately limits reporting, so automatic delivery should be explicit.

Cancellation needs a task policy distinct from Carbon's ordinary Stop. Specify whether it stops descendants, how it treats queued follow-ups, and whether it suppresses completion wakes. T3 has such a distinction in its [task cancellation contract](https://github.com/pingdotgg/t3code/blob/dfeaf7b13786712cc350fa35abea17715fdef987/docs/orchestration-v2/orchestrator-mcp-server.md#L323-L340); copying it wholesale would change Carbon's current Stop behavior.

## 4. Preserve why work stopped across restart

**Carbon today.** Startup resets persisted `in_progress` sessions to `idle`, because their children no longer exist. It removes the false running state but does not record a task-level interrupted outcome. See [startup reset](../src-tauri/src/store.rs), lines 1532–1548; [server startup](../src-tauri/src/serve.rs), lines 407–418.

**T3 pattern.** Recovery reconciles runtime state and process-bound effects, repairs delegated tasks, and then starts effect workers. Runtime requests that belonged to a dead process expire rather than pretending their old callbacks still exist. See [startup ordering](https://github.com/pingdotgg/t3code/blob/dfeaf7b13786712cc350fa35abea17715fdef987/apps/server/src/serverRuntimeStartup.ts#L429-L449) and [request expiration](https://github.com/pingdotgg/t3code/blob/dfeaf7b13786712cc350fa35abea17715fdef987/apps/server/src/orchestration-v2/ProviderRuntimeRecoveryService.ts#L670-L700).

**Carbon proposal.** Record an interrupted operation/task outcome and reason while preserving existing session browsing statuses. On startup reconcile inbox entries, reserved creates and tasks before claiming them ready. Offer resume, retry or inspection according to the known outcome. Reissue approvals only through a fresh live harness request; do not replay dead callbacks. Begin with explicit recovery rather than automatic resumption of all work.

## 5. Expose Carbon's existing capabilities to agents

**Carbon today.** `Harness::caps` already provides an exhaustive capability table. Server commands already expose availability, model lists, options, modes and the ACP catalog. The orchestration CLI and protocol do not expose corresponding discovery verbs. Live control restrictions are measured and intentionally differ by harness. See [capabilities](../src-tauri/src/harness/harness.rs), lines 691–744 onward; [server commands](../src-tauri/src/serve.rs), lines 1367–1382; [CLI commands](../../cli/src/main.rs), lines 60–137; [live controls](../src/lib/liveControls.ts).

**T3 pattern.** Its MCP capability query reads provider state, and delegation resolves target options through that same system. Turn capabilities distinguish active steering, steering that interrupts tools, queueing and interrupt/restart fallback. See [capability service](https://github.com/pingdotgg/t3code/blob/dfeaf7b13786712cc350fa35abea17715fdef987/apps/server/src/mcp/OrchestratorMcpService.ts#L2554-L2640) and [turn capabilities](https://github.com/pingdotgg/t3code/blob/dfeaf7b13786712cc350fa35abea17715fdef987/packages/contracts/src/orchestrationV2.ts#L293-L309).

**Carbon proposal.** Add a bounded machine-readable CLI view of the existing registry: installed/available harnesses, models, valid effort and mode values, and relevant live-control behavior. Include the effective inherited picks in creation receipts. Avoid another registry or a second set of provider-name checks. This is useful independently of the task layer.

An MCP interface may later expose these same commands. This comparison supplies no reason to replace the working CLI transport just to obtain structured tasks.

## 6. Bound recovery traffic by bytes as well as event count

**Carbon today.** The server already has a 4,096-event broadcast backlog, disconnects lagged subscribers, snapshots live state under the subscription lock, and pages transcript tails. Reconnect reads missed events by event ID, which correctly avoids relying on resettable subagent sequence numbers. However, `get_session_since` has no explicit event/byte ceiling on the missed stretch, and the per-client reply channel is unbounded. See [server hub and websocket](../src-tauri/src/serve.rs), lines 110, 455–466 and 1042–1082; [transcript paging and resync](../src-tauri/src/store.rs), lines 1840–1865 and 2004–2028.

**T3 pattern.** Replay falls back to a bounded snapshot above 128 events or 1 MiB of encoded data, with a separate raw-payload guard. Live stream budgets account for both retained item count and serialized bytes. These are T3's thresholds, not recommended Carbon defaults. See [reconnect policy](https://github.com/pingdotgg/t3code/blob/dfeaf7b13786712cc350fa35abea17715fdef987/apps/server/src/orchestration-v2/ThreadStream.ts#L18-L25) and [resume decision](https://github.com/pingdotgg/t3code/blob/dfeaf7b13786712cc350fa35abea17715fdef987/apps/server/src/orchestration-v2/ThreadStream.ts#L99-L118); [live budget](https://github.com/pingdotgg/t3code/blob/dfeaf7b13786712cc350fa35abea17715fdef987/apps/server/src/orchestration-v2/LiveStreamBudget.ts#L18-L100).

**Carbon proposal.** Measure large-crew reconnects, add byte/event limits with a paged-tail/live-state fallback, and bound per-client retained replies. Preserve pending questions, tasks and inbox state when falling back. Keep the existing event-ID cursor until there is a demonstrated reason to change it. Do not confuse a byte-budget opportunity with missing reconnect support.

One smaller distributed-work improvement is already called out in Carbon source: `session ls --machine all` silently skips failed machines. Return partial-result warnings so an orchestrator can distinguish no sessions from an unreachable machine. See [cross-machine listing](../src-tauri/src/orchestration.rs), lines 600–623.

## Foundations to keep

- Mandatory worktrees and base-ref validation before writes: [creation](../src-tauri/src/orchestration.rs), lines 1198–1230. Current T3 also supports isolated delegation, but defaults local delegation to a shared checkout: [workspace selection](https://github.com/pingdotgg/t3code/blob/dfeaf7b13786712cc350fa35abea17715fdef987/apps/server/src/mcp/OrchestratorMcpService.ts#L2701-L2730). Keep Carbon's isolation default.
- Per-session slot serialization, child-identity guards and the Stop watchdog: [session lifecycle](../src-tauri/src/session.rs), lines 479–610. A durable layer should use these boundaries.
- Normalized events, app-owned session IDs and UUID event IDs: [event model](../src-tauri/src/events/events.rs), lines 29–47 and 913–933. Carbon already has these. The narrower identity opportunity is a durable task/operation ID; provider turn IDs are optional, and Claude's mapper has none: [Claude mapping](../src-tauri/src/harness/claude_code/mapper.rs), lines 363–365.
- Relay sender metadata, the target's recorded configuration, Crew and remote-machine routing: [orchestration](../src-tauri/src/orchestration.rs) and [Crew](../src/lib/crew.ts). Add task state without creating a second kind of session.

## Validation for an implementation

T3's useful testing lesson is to replay real provider frames through production normalization, persistence and projection, replacing the process/network boundary. It also tests restarts by recreating the outer services against persisted state. See [test strategy](https://github.com/pingdotgg/t3code/blob/dfeaf7b13786712cc350fa35abea17715fdef987/docs/orchestration-v2/testing-strategy.md#L5-L61) and [restart replay tests](https://github.com/pingdotgg/t3code/blob/dfeaf7b13786712cc350fa35abea17715fdef987/apps/server/src/orchestration-v2/testkit/OrchestratorReplayRecovery.integration.test.ts).

Start with these failure-oriented cases:

1. Lose a successful create response, then retry the same request ID: one session and one worktree. A changed payload under that ID is refused.
2. Restart after accepting a relay but before dispatch: the message remains visible and recoverable. Restart at an ambiguous provider-acceptance boundary: no silent claim of exactly-once delivery.
3. Complete multiple waves of child tasks while the parent alternates between busy and idle: every result remains readable, each delivery is deduplicated, and later waves still wake it.
4. End a child turn while explicitly awaited work remains: no premature task result. Leave a dev server running: no permanent task wait.
5. Stop/cancel while a completion wake or follow-up is queued: the chosen cancellation policy holds after reconnect and restart.
6. Disconnect during heavy crew output: replay or snapshot stays within budgets and preserves live questions and task/delivery state.

T3 has specific source coverage for [completion delivery](https://github.com/pingdotgg/t3code/blob/dfeaf7b13786712cc350fa35abea17715fdef987/apps/server/src/orchestration-v2/DelegatedCompletionDelivery.test.ts), [receipt races](https://github.com/pingdotgg/t3code/blob/dfeaf7b13786712cc350fa35abea17715fdef987/apps/server/src/orchestration-v2/Orchestrator.receipt-race.test.ts), [worker settlement](https://github.com/pingdotgg/t3code/blob/dfeaf7b13786712cc350fa35abea17715fdef987/apps/server/src/orchestration-v2/EffectWorker.test.ts), and [stream budgets](https://github.com/pingdotgg/t3code/blob/dfeaf7b13786712cc350fa35abea17715fdef987/apps/server/src/orchestration-v2/LiveStreamBudget.test.ts). Test source was inspected; its passing state was not established here.

Implementation should be split into reviewable increments: request identity and receipts; durable relay acceptance and recovery; opt-in tasks and completion delivery. Capability discovery can ship independently. Stream budgets should follow measurements. A wholesale migration to T3's graph, TypeScript/Effect services or SQLite event store is not justified by this comparison.

# Generic ACP agents

`Harness::Acp(id)` is serialized as `acp:<id>`. Keep `Harness::ALL` and
`carbon_proto::AGENTS` as the five native integrations and installers. The
registry is dynamic, local to each owning server, and disabled by default.
Older builds preserve unknown harness strings through `Harness::Other`.

The initial port comes from monorepo-labs/dray#538 at
`97b1b972822338c9dc0c9ea9e1d6f53f68ff2781`. Keep the existing native transports.

`harness/agents/catalog.rs` reads a daily cached ACP registry with a bundled
fallback and stores enabled IDs, custom commands, and executable overrides in
`acp-agents.json`, written privately at mode `0600` because custom environments
may contain credentials. Package-runner availability differs from installation:
`npx` and `uvx` may download the pinned package on first launch. The UI must say
so. Unsupported platform entries stay visible.

`agents.rs` validates ACP major version 1 before opening a session. Advertise
only implemented client capabilities. Resume/load follow agent capabilities;
load replay is suppressed until the session is ready. Every inbound request
gets a reply, and string permission IDs retain their original shape.

Raw configuration IDs and values belong to the agent. `agent_options` returns
the selected session's options; last-seen options are only a new-session hint.
`set_agent_option` applies before persisting, refuses mid-turn changes, and
holds provisional-session choices until startup succeeds. A rejected explicit
selection must prevent `session/prompt`. Published empty options replace the
previous set. Agent-originated changes must update recorded settings too.
Saved settings are restored where the agent still accepts them. Withdrawn
remembered values fall back with a notice; explicit pending picks stay strict.
Stopped sessions expose acknowledged values separately from `pendingValue` and
`rejection`. `reset_agent_options` accepts an optional `configId` to discard one
unapplied pick without clearing the others.
New-composer explicit picks become remembered preferences after a successful
send or a client reload.

Tool inputs can arrive across several updates. `ToolCallUpdated` replaces the
normalized input on its existing row without adding another call. Keep this
projection in the desktop and iOS transcripts. The committed result remains
a separate event.

The fake stdio peer in `fixtures/fake_agent.py` tests authentication, permissions,
cancellation, EOF, and protocol negotiation. Its `workflow` scenario is for
isolated full-server acceptance. It stores test state and trace in its cwd;
use a temporary project, never a real checkout.

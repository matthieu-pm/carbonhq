# Native MCP relay investigation

CBN-58, investigated on 2026-11-16. The question is whether an installed agent can own an upstream MCP connection and OAuth grant while Carbon relays calls from any agent. The probes sent protocol requests directly. They sent no model prompt, copied no tokens, changed no user configuration, and did not claim another client's identity.

## Finding

**A native Codex tool relay works, including a real authenticated Figma call.** It is the stronger candidate for a limited fallback where a provider rejects Carbon's OAuth registration. Neither inspected client exposes a complete, transparent MCP relay, so this cannot silently replace Carbon's general proxy under CBN-58's current requirements.

| Requirement | Codex 0.169.0 | Claude Code 2.1.325 |
|---|---|---|
| Native browser sign-in started without a model turn | Passed local OAuth fixture | Passed local OAuth fixture |
| Call an external MCP tool without a model turn | Passed fixture and real Figma `whoami` | Passed local fixture |
| Return complete tool input schemas | Passed catalog fixture | Missing from inspected status interface |
| Preserve upstream instructions | Not exposed in inspected catalog/API | Not exposed in inspected status/API |
| Ordinary resource reads | Passed fixture | Rejected outside `ui://` |
| MCP prompts | No inspected relay method | No inspected relay method |
| Separate state per Carbon chat | Passed two Codex threads | Not tested across two native processes |
| Permission handling | Direct calls did not enforce a configured prompt policy | Explicit permission checking and host replies passed |

These are measured compatibility results, not evidence that a provider approves every product embedding or relay use. Carbon still needs its own provider approval for direct authentication.

## Claude Code

Tested `/Users/matthieu/.local/bin/claude`, version **2.1.325**. Its real subprocess can authenticate and call external MCP tools without a model turn. It does not expose enough metadata or protocol operations to replace Carbon's general MCP transport transparently.

### Public interface and installed behavior

The [public Query interface](https://code.claude.com/docs/en/agent-sdk/typescript#query-object) documents MCP status, reconnect, toggle, server replacement, and MCP Apps resource reads. It does not expose a typed tool-call method. An [open request in Anthropic's SDK repository](https://github.com/anthropics/claude-agent-sdk-typescript/issues/380) describes that gap. The shipped 2.1.325 binary contains and handles `mcp_call`, `mcp_authenticate`, `mcp_oauth_callback_url`, and `mcp_message` control requests. The last is delivery for SDK-hosted in-process servers, not a raw request API for external servers.

The installed `initialize` response advertises `mcp_call_result_not_for_model_v1` and `mcp_call_check_permissions_v1`. A Carbon adapter would have to detect both. Older versions can ignore the corresponding flags, changing result handling or skipping the expected permission checks.

[Claude Code's MCP-server documentation](https://code.claude.com/docs/en/mcp#use-claude-code-as-an-mcp-server) says `claude mcp serve` exposes Claude Code's tools and leaves user confirmation to the connecting client. In the local probe, it exposed 24 built-in tools, including Bash, Read, Edit, and ToolSearch. It neither listed nor connected the supplied external fixture. Calling ToolSearch for the fixture still produced no upstream connection. This command is not the external-server relay needed here.

### Measured control-channel probe

A temporary localhost HTTP MCP fixture offered `echo`, `fail`, `denied`, `ask`, and `slow`, plus instructions, a prompt, a normal resource, and a `ui://` resource. Its tools had descriptions and complete JSON input schemas. Claude was launched from a temporary directory with:

```text
claude --mcp-config <localhost fixture JSON> --strict-mcp-config \
  --setting-sources '' --settings <fixture-only permission rules> \
  -p --input-format stream-json --output-format stream-json --verbose \
  --no-session-persistence --tools '' --permission-prompt-tool stdio \
  --permission-mode manual
```

`disableAllHooks` was enabled for the probe and `ENABLE_CLAUDEAI_MCP_SERVERS=false` kept hosted connectors out. The harness wrote only `control_request` and `control_response` frames, never a `user` message. Local reproduction commands and sanitized results are `/tmp/carbon-cbn58-claude-relay-probe.py` and `/tmp/carbon-cbn58-claude-relay-result.log`.

| Probe | Observed result |
|---|---|
| `initialize`, then `mcp_status` | Fixture connected; native discovery sent initialize, tools/list, prompts/list and resources/list. |
| Status tool metadata | Names and read-only annotations returned. Input schemas, tool descriptions, upstream instructions, prompts, resources and upstream capabilities were absent from the returned row. |
| `mcp_call` with `result_not_for_model=true`, `check_permissions=true` | Echo returned the original text blocks and structuredContent. Non-reserved top-level `_meta` survived; `com.anthropic/*` metadata was removed. |
| Tool returned `isError=true` | Native reply became a control error containing text, losing the original structured error result. |
| Denied tool rule | Call failed with “The tool did not run”; no upstream tools/call was sent. |
| Tool requiring a decision | A `can_use_tool` control request reached the host. Returning allow ran the harmless fixture call. |
| Slow call, then `control_cancel_request` | Upstream received `notifications/cancelled`. A subsequent echo succeeded in the same native process. This does not prove that an upstream server stops work after cancellation. |
| `mcp_read_resource` for `ui://fixture` | Resource read succeeded. |
| `mcp_read_resource` for `fixture://alpha` | Rejected: “uri must use the ui:// scheme”. |

The successful call frame was:

```json
{"type":"control_request","request_id":"echo","request":{"subtype":"mcp_call","tool":"mcp__relay_fixture__echo","arguments":{"value":"RELAY-OK"},"result_not_for_model":true,"check_permissions":true}}
```

The MCP-error conversion matters: a relay could synthesize a new MCP error result, but it could not recover the original structured content or reliably reproduce every upstream result shape from the control error alone.

### Native authentication probe

A second local fixture implemented protected-resource metadata, authorization-server metadata and dynamic registration. This probe used a temporary `CLAUDE_CONFIG_DIR`; it deleted that directory afterwards. It did not read or replace the user's MCP tokens. Reproduction command: `python3 /tmp/carbon-cbn58-claude-auth-probe.py`.

Sending `mcp_authenticate` for `auth_fixture` made the real CLI register itself as **`Claude Code (auth_fixture)`**. It returned an authorization URL with `requiresUserAction=true`, `callbackExpected=true`, and `redirectScheme=localhost`. No browser opened automatically. No authorization code or token exchange was attempted.

This gives Carbon a plausible native sign-in UI path: ask the actual subprocess to begin authorization, open its returned URL, and let the subprocess receive the callback and retain its grant. The [documented native login command](https://code.claude.com/docs/en/mcp#authenticate-from-the-command-line) confirms Claude Code owns MCP authentication. The control methods themselves are outside the documented Query methods, so their signatures need version checks and regressions. This local auth probe does not establish that every provider permits a relay built around the native client.

### Claude conclusion

Claude Code is technically usable as an out-of-band tool executor and native auth owner, with permission and cancellation bridging. It is a poor generic MCP relay today: Carbon cannot reconstruct full tool schemas or preserve instructions, prompts, ordinary resources, and structured tool errors from the measured interfaces. `claude mcp serve` does not close those gaps. No production adapter was added during this investigation.

## Codex

Tested `/Users/matthieu/.bun/bin/codex`, version **0.169.0**. Its actual app-server exposes external MCP inventory, tool calls, resource reads, and OAuth login. The methods appear in the installed CLI's ordinary generated schema, without `--experimental`. The fixture also passed with an empty `initialize.capabilities` object.

The [upstream protocol types](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/mcp.rs) expose the corresponding request and result types. [App-server documentation](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md#mcp-server-capabilities) describes scoped discovery that reuses a thread's MCP connection, and its [native OAuth section](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md#enterprise-sign-in) describes returning an authorization URL and reporting completion. The upstream default branch can differ from the installed version; the local generated schema and probes are the evidence for this Mac.

### Measured protocol path

The safe harness is `/tmp/carbon-cbn58-native-relay-probe.py`. Its temporary directories are deleted after each run. Reproduce with:

```text
codex app-server generate-json-schema --out /tmp/carbon-cbn58-codex-stable-schema
python3 /tmp/carbon-cbn58-native-relay-probe.py fixture
python3 /tmp/carbon-cbn58-native-relay-probe.py oauth
python3 /tmp/carbon-cbn58-native-relay-probe.py policy
python3 /tmp/carbon-cbn58-native-relay-probe.py figma
```

The first three harness modes use a temporary `CODEX_HOME`, a localhost fixture, no API keys, and no Codex account. `account/read` returned no account. The Figma mode uses the user's already configured native server and grant. It prints only connection status, counts and success flags, never the returned account information. It creates an ephemeral thread and never sends `turn/start`.

The relevant request sequence is:

```text
initialize / initialized
thread/start {cwd, ephemeral:true, config:<MCP definitions>}
mcpServerStatus/list {threadId, serverName, detail:"full"}
mcpServer/tool/call {threadId, server, tool, arguments}
mcpServer/resource/read {threadId, server, uri}
```

`mcpServer/oauth/login {threadId,name}` begins native authorization and returns an `authorizationUrl`. Carbon can open that URL and wait for the native completion notification. The local mock observed the actual Codex process registering itself as **`Codex`**. The probe stopped before browser consent, callback and token exchange; a fresh real-provider login through a Carbon-hosted relay has not been verified.

| Probe | Observed result |
|---|---|
| Tool inventory | Names, descriptions and input schemas returned, together with server information, capabilities, resources and resource templates. |
| Local echo | Exact `relay-ok` result returned through `mcpServer/tool/call`. |
| State reuse | Repeated calls in one thread kept the same upstream session and value. |
| State isolation | A second thread got a different upstream session and an empty value. |
| Resource read | `fixture://read` returned `resource-ok`. |
| Instructions | The fixture's exact initialize instructions were absent from inventory. The inspected schema has no separate method to retrieve them. |
| Prompts | The fixture advertised prompts, but discovery did not request prompts/list and the inspected schema has no prompt relay method. |
| Prompt policy | Effective config reported `default_tools_approval_mode="prompt"`. A direct echo call still reached the upstream with no host approval request. |
| Real Figma | Native status was `oAuth` and `connected`; 48 tools were discovered. A direct `whoami` call returned one content block successfully. Its contents were not logged. |

Sanitized output files are `/tmp/carbon-cbn58-relay-fixture-result.jsonl`, `/tmp/carbon-cbn58-relay-oauth-result.jsonl`, `/tmp/carbon-cbn58-relay-policy-result.jsonl`, and `/tmp/carbon-cbn58-relay-figma-result.jsonl`. No probe started a model turn. The initial Figma probe tried to disable every name from `codex mcp list`, including registrations not defined in the user's file; that failed config validation. Limiting disable overrides to file-defined names resolved it. No native config file was edited.

### Codex limits

The direct API is a useful tool executor, not a byte-preserving MCP transport. Carbon would translate discovery and calls, synthesize its initialize response, and forward each named server through its existing endpoints. Tool schemas are available, but upstream instructions and prompts are not. Arbitrary protocol extensions, notifications, elicitation, cancellation, structured errors, and logout interactions still need targeted relay tests. Do not infer that they work from the successful read call.

The direct-call result includes content, structuredContent, isError and `_meta` in the inspected schema. That is more complete than Claude's measured error conversion, but arbitrary result fidelity has not been tested. The direct-call permission result also means Carbon cannot assume that the worker's Codex prompt settings guard requests. The calling agent or Carbon must check permission before forwarding. If preserving the worker's existing Codex rules is required, that needs an explicit implementation and regression.

## Recommendation

Implementation update: the user approved a Figma-only tools/resource fallback with shared Codex login and sign-out. The production adapter now lives in `mcp/native_codex.rs`; current behavior and verification are documented in [mcp-proxy.md](mcp-proxy.md). The investigation below records the basis and limits of that decision.

Keep Carbon's direct proxy as the normal transport. A selective **native Codex fallback** is technically viable for Figma tools: all calling agents could reach a named Carbon endpoint while the actual installed Codex process owns OAuth and upstream calls. One worker thread per Carbon chat matches the measured state isolation. Use explicit worker settings to keep native connection sharing off and unrelated apps/plugins out; the probe used defaults for connection sharing and disabled apps/plugins.

The approved first version accepts the instructions and prompts gap, retains calling-agent permissions, and uses the existing native credential store with shared sign-out. Installed-client tests now complete browser-style OAuth against a local provider, reuse the grant from a second process, and verify both terminal logout detection and Carbon-triggered native logout. Relay regressions cover cancellation and elicitation. This still requires an installed compatible Codex binary, but does not start a model turn or require a Codex account.

Claude's private control channel is a possible later adapter for specific UI tools. Its missing schemas and result changes make it a worse default fallback. The investigation itself added only this note; the later approved Figma adapter is documented separately.

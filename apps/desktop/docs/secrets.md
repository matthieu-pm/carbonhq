# One-use secret handoffs

[`secrets.rs`](../src-tauri/src/secrets.rs) owns a request outside the
transcript. The agent creates, inspects or cancels metadata through the CLI;
the user supplies values in a card. Values do not become prompt text,
tool-call arguments or persisted agent events.

## Boundaries

The CLI's `SecretRequest` in
[`carbon-proto`](../../../crates/carbon-proto/src/lib.rs) has no submit
variant. `answer_secret_request`, `deny_secret_request` and
`list_secret_requests` are serve commands. The desktop's
[`SecretRequest`](../src/components/chat/SecretRequest.tsx) and the phone's
[`SecretCard`](../../ios/Carbon/SecretCard.swift) call those on the owning
server. The server stores request metadata in memory and publishes
`secret_requests_changed`. `live_state.secrets` restores it after reconnect.

The request pins the session's canonical cwd. Execution rechecks it and
refuses a relocated or archived session. Creation accepts 1–16 fields and
at most four pending/running requests per session. A pending request expires
after ten minutes. Claiming it under one lock changes `pending` to `running`,
so a duplicate submission cannot execute it twice. Outcomes are `used`,
`failed`, `denied`, `cancelled` or `expired`.

## Destinations

| Target | Execution and cleanup |
| --- | --- |
| Command | Spawn the approved executable and argument array in the pinned cwd. Values enter its environment, not argv. |
| File with command | Write a private dotenv file; pass its path through `CARBON_SECRET_FILE` and `{secret_file}` placeholders. Delete it after the command unless the user explicitly chooses to keep it. |
| File without command | Require the user to choose Keep. Create the approved file without replacing an existing one. |
| Browser | Prepare and recheck the approved origin, fields and submit control, then fill and submit through the browser backend. |

Temporary files live under `<home>/secret-handoffs/<request-id>/`. Directories
are private and files are created at `0600` without replacement. Kept files
must pass path, existing-file and git checks again at execution. Startup
removes stale temporary handoffs because no live request survives a server
restart. Keep these checks when adding another destination.

Command execution has a five-minute deadline, bounded stdout/stderr capture
and a process-group guard. Returned output replaces exact values and their
JSON-escaped spellings before reaching metadata or events. Values and the
temporary dotenv body use zeroizing Rust storage. This does not prevent the
approved process or website from exposing a value, nor cover every encoding
or transformation a command could print. Do not describe it as a secret vault
or a general output scrubber.

Browser handoffs use a local host call for app-owned CEF or the headless
backend. A confirmation timeout may follow a successful external submission;
the error asks the user to inspect the page. Clients reconcile status after
an uncertain answer and must not retry a submit blindly.

## Verify a change

Use [`secret-request.html`](../demo/secret-request.html) for card states and
[`secret_form.js`](../src-tauri/src/browser/secret_form.js) for browser
validation rules. Frontend tests cover form, dotenv and reconciliation logic;
Rust tests cover claims, real environment delivery, redaction, files and
cleanup. Run bare `cargo test` after a filtered Rust run, then the headless
check and frontend build in the [engineering index](README.md).

For runtime checks, use an isolated server and invented values. Cover a
duplicate submit, expired/denied request, cwd change, command failure and
reconnect. Verify both browser backends when changing shared form behavior.

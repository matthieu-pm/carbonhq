//! The slash commands a directory has available, read out of the CLI itself.
//!
//! `system/init` carries a `slash_commands` list, but it only arrives once a
//! turn is underway — so it cannot answer "what may I type" for a composer with
//! no session behind it yet, which is the case the picker exists for. The
//! `initialize` control request answers the same question before any prompt and
//! without a model call, and carries a description and an argument hint per
//! command where `init` carries bare names.
//!
//! Reading `~/.claude/commands` and the plugin cache off disk would be the other
//! route and is deliberately not taken: the CLI merges user, project, plugin and
//! skill scopes and namespaces the results (`railway:deploy`), so a local walk
//! reproduces internals that are free to change and answers differently from the
//! CLI the moment they do.

use super::control::{ControlLine, ControlRequest};
use crate::harness::ProbeCache;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{process::Stdio, sync::LazyLock, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
    time::timeout,
};
use ts_rs::TS;

/// One command the user may type. `name` carries no leading slash — the picker
/// adds it — and may be namespaced by its plugin (`railway:deploy`).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct SlashCommand {
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// What the command does with the rest of the line — `<model>`, `[name]`.
    /// Empty for most; the CLI sends `""` rather than omitting it.
    #[serde(default)]
    pub argument_hint: String,
    /// Other names that reach the same command. Absent on most.
    #[serde(default)]
    pub aliases: Vec<String>,
}

/// The first sentence of a skill's description.
///
/// Skill descriptions are written for the *model* — several hundred words of
/// trigger phrases — where the picker draws one line. Cut at the first full stop
/// rather than at a character count, so the row ends on a sentence.
///
/// Lives beside [`SlashCommand`] rather than in the harness that needed it
/// first: Codex reads its descriptions off `skills/list` and fx off the
/// `SKILL.md` on disk, and two copies of this would be two answers to "how long
/// is a row" in one menu.
pub fn first_sentence(description: &str) -> String {
    match description.find(". ") {
        Some(at) => description[..=at].to_string(),
        None => description.to_string(),
    }
}

/// The `initialize` reply, which carries far more than this — agents, models,
/// output styles, the account. Only `commands` is read here; `models` is read
/// by [`super::models`] off the same request, and a field modeled but unused is
/// one more shape to keep in step with the CLI.
#[derive(Debug, Deserialize)]
struct InitializeResponse {
    #[serde(default)]
    commands: Vec<SlashCommand>,
}

/// Commands the picker doesn't offer, because this app already owns what they
/// do.
///
/// `model` and `fast` are the composer's own controls. The CLI's copies work,
/// but they change the running child without telling the app, so the picker and
/// the session's real state would drift apart with nothing to reconcile them.
///
/// `clear` and `rename` reach past the CLI into state this app keeps itself —
/// session identity and the title on the index — and neither change comes back
/// on the wire, so the app would carry on describing a session that no longer
/// matches the one running.
///
/// Matched on the exact name, so a plugin's own `foo:model` is untouched.
/// Hidden rather than refused: typing one by hand still reaches the CLI. This is
/// the picker declining to suggest a footgun, not a sandbox.
const HIDDEN: [&str; 4] = ["clear", "fast", "model", "rename"];

fn supported(commands: Vec<SlashCommand>) -> Vec<SlashCommand> {
    commands
        .into_iter()
        .filter(|command| !HIDDEN.contains(&command.name.as_str()))
        .collect()
}

/// Probes are ~1.5s each, so the answer is kept for the life of the process.
///
/// Never invalidated: a plugin installed while the app is open needs a restart
/// to show up, which is the same bargain `binpath` makes and cheaper than
/// re-probing on every keystroke.
static CACHE: LazyLock<ProbeCache<Vec<SlashCommand>>> =
    LazyLock::new(|| ProbeCache::new(Duration::MAX));

/// A probe that hangs must not hold the picker open forever. Generous against
/// the ~1.5s measured: a cold CLI on a large repo is slower, and the cost of
/// waiting too long is one late menu where the cost of giving up too early is a
/// permanently empty one.
const PROBE_TIMEOUT: Duration = Duration::from_secs(15);

/// The slash commands available in `cwd`, cached after the first read.
pub async fn list_commands(cwd: &str) -> Result<Vec<SlashCommand>> {
    CACHE
        .get_or_probe(cwd, || async {
            let response: InitializeResponse = serde_json::from_value(initialize(cwd).await?)
                .context("the CLI's initialize reply had an unfamiliar shape")?;
            // Filtered before the cache, so the hidden set is applied once
            // rather than at every read.
            Ok(supported(response.commands))
        })
        .await
}

/// The `initialize` reply's payload, from a throwaway child started in `cwd`.
pub(super) async fn initialize(cwd: &str) -> Result<Value> {
    timeout(PROBE_TIMEOUT, probe(cwd, ControlRequest::Initialize))
        .await
        .context("timed out asking the CLI to initialize")?
}

/// One server out of the `mcp_status` reply. Only the name and where it came
/// from are read: the reply also carries each server's `config`, headers and
/// tokens included, and none of that may leave this file.
#[derive(Debug, Deserialize)]
struct McpStatusEntry {
    name: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    scope: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpStatusResponse {
    #[serde(default)]
    mcp_servers: Vec<McpStatusEntry>,
}

/// The MCP servers the CLI loads in `cwd`, as `(name, scope)` pairs, the ones
/// switched off left out.
///
/// Asked of the CLI rather than read off its config files because plugins add
/// servers no file of the reader's names (`plugin:figma:figma`), and the CLI
/// already merges user, local, project and plugin scopes the way a session
/// will. Most statuses are `pending` this early, the child having only just
/// started connecting, so `disabled` is the only one filtered on.
pub async fn list_mcp_servers(cwd: &str) -> Result<Vec<(String, String)>> {
    let reply = timeout(PROBE_TIMEOUT, probe(cwd, ControlRequest::McpStatus))
        .await
        .context("timed out asking the CLI for its MCP servers")??;
    mcp_servers_in(reply)
}

fn mcp_servers_in(reply: Value) -> Result<Vec<(String, String)>> {
    let response: McpStatusResponse = serde_json::from_value(reply)
        .context("the CLI's mcp_status reply had an unfamiliar shape")?;
    Ok(response
        .mcp_servers
        .into_iter()
        .filter(|server| server.status != "disabled")
        .map(|server| {
            let scope = match server.source.as_deref() {
                Some("plugin") => "plugin".to_string(),
                _ => server.scope.unwrap_or_default(),
            };
            (server.name, scope)
        })
        .collect())
}

/// Spawns a throwaway child purely to ask it what it can do, then kills it.
///
/// The child is spawned exactly like a session's minus everything that decides
/// how a turn runs — no model, no permission mode, no session id — because none
/// of it changes the answer and every flag is one more way the probe can fail
/// where a session would not.
async fn probe(cwd: &str, ask: ControlRequest<'_>) -> Result<Value> {
    let mut command = Command::new(crate::binpath::claude().await);
    command
        .args([
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
        ])
        .current_dir(cwd);
    probe_command(command, ask).await
}

/// Owns the whole probe tree, including MCP servers that ignore closed pipes.
async fn probe_command(mut command: Command, ask: ControlRequest<'_>) -> Result<Value> {
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        // The read below can end early — a timeout, an unreadable reply — and
        // the child waits on a stdin that never closes, so dropping it has to be
        // enough to reap it.
        .kill_on_drop(true)
        .process_group(0)
        .spawn()
        .context("couldn't start claude to initialize")?;
    let _group = crate::mcp_servers::ProbeGroup(
        child.id().context("the probe has already exited")?,
    );

    let mut stdin = child.stdin.take().context("failed to take stdin")?;
    let stdout = child.stdout.take().context("failed to take stdout")?;

    let request = ControlLine::new(ask);
    stdin
        .write_all(format!("{}\n", serde_json::to_string(&request)?).as_bytes())
        .await?;
    stdin.flush().await?;

    let mut lines = BufReader::new(stdout).lines();
    while let Some(line) = lines.next_line().await? {
        if let Some(response) = matching_response(&line, &request.request_id) {
            return Ok(response);
        }
    }

    // Stdout closed with no reply. The child is holding a stdin we never
    // closed, so this is the CLI declining rather than finishing.
    bail!("the CLI closed without answering the initialize request")
}

/// Picks our own reply out of the stream, returning its inner payload.
///
/// Parsed loosely rather than through [`parser::ClaudeCodeEvent`]: the probe
/// reads one reply and everything else on this stream is noise it must skip, so
/// a line it cannot classify is not a failure the way it would be in a session's
/// read loop.
///
/// [`parser::ClaudeCodeEvent`]: super::parser::ClaudeCodeEvent
fn matching_response(line: &str, request_id: &str) -> Option<Value> {
    let value: Value = serde_json::from_str(line).ok()?;

    if value.get("type")? != "control_response" {
        return None;
    }

    let response = value.get("response")?;
    if response.get("request_id")? != request_id {
        return None;
    }

    // An error subtype carries no `response` object, so this returns `None` and
    // the loop reads on until the stream ends — which reports the failure as the
    // timeout or the closed-stream bail rather than as a wrong answer.
    if response.get("subtype")? != "success" {
        return None;
    }

    response.get("response").cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn probes_reap_mcp_children_on_reply_and_timeout() {
        let root =
            std::env::temp_dir().join(format!("carbon-mention-probe-{}", uuid::Uuid::now_v7()));
        tokio::fs::create_dir_all(&root).await.unwrap();
        for mode in ["reply", "timeout"] {
            let pid_file = root.join(mode);
            let mut command = Command::new("/bin/sh");
            command.args(["-c", r#"
sleep 30 &
echo $! > "$1"
read -r request
if [ "$2" = reply ]; then
    id=$(printf '%s' "$request" | sed -n 's/.*"request_id":"\([^"]*\)".*/\1/p')
    printf '{"type":"control_response","response":{"subtype":"success","request_id":"%s","response":{}}}\n' "$id"
fi
wait
"#, "probe"]).arg(&pid_file).arg(mode);
            let result = timeout(
                Duration::from_secs(1),
                probe_command(command, ControlRequest::McpStatus),
            )
            .await;
            if mode == "reply" {
                assert_eq!(result.unwrap().unwrap(), serde_json::json!({}));
            } else {
                assert!(result.is_err());
            }
            let pid = tokio::fs::read_to_string(&pid_file).await.unwrap();
            let mut alive = true;
            for _ in 0..40 {
                let state = std::process::Command::new("ps")
                    .args(["-o", "stat=", "-p", pid.trim()])
                    .output()
                    .unwrap();
                alive = state.status.success()
                    && !String::from_utf8_lossy(&state.stdout)
                        .trim()
                        .starts_with('Z');
                if !alive {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            if alive {
                unsafe {
                    libc::kill(pid.trim().parse().unwrap(), libc::SIGKILL);
                }
            }
            assert!(!alive, "the {mode} probe left its MCP child running");
        }
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    /// Shape captured from v2.1 with configs trimmed: a plugin reports its
    /// source and a dynamic scope, a user server its scope alone.
    #[test]
    fn reads_mcp_servers_and_drops_disabled_ones() {
        let line = r#"{"type":"control_response","response":{"subtype":"success","request_id":"req_2","response":{"mcpServers":[{"name":"plugin:figma:figma","status":"needs-auth","config":{"type":"http"},"transport":"http","scope":"dynamic","source":"plugin"},{"name":"linear","status":"pending","config":{"type":"http","headers":{"Authorization":"Bearer x"}},"scope":"user","source":"user"},{"name":"off","status":"disabled","scope":"project","source":"project"}]}}}"#;

        let payload = matching_response(line, "req_2").expect("our own reply");
        let servers = mcp_servers_in(payload).unwrap();

        assert_eq!(
            servers,
            vec![
                ("plugin:figma:figma".to_string(), "plugin".to_string()),
                ("linear".to_string(), "user".to_string()),
            ]
        );
    }

    /// The reply double-wraps, like a permission decision does in the other
    /// direction: the outer `response` is the control-protocol envelope, the
    /// inner one the payload. Reading the wrong level yields no commands.
    #[test]
    fn reads_commands_out_of_the_doubly_wrapped_reply() {
        let line = r#"{"type":"control_response","response":{"subtype":"success","request_id":"req_1","response":{"commands":[{"name":"compact","description":"Free up context","argumentHint":"<instructions>"},{"name":"clear","description":"Start over","argumentHint":"[name]","aliases":["reset","new"]}],"agents":[]}}}"#;

        let payload = matching_response(line, "req_1").expect("our own reply");
        let response: InitializeResponse = serde_json::from_value(payload).unwrap();

        assert_eq!(response.commands.len(), 2);
        assert_eq!(response.commands[0].name, "compact");
        assert_eq!(response.commands[0].argument_hint, "<instructions>");
        assert!(response.commands[0].aliases.is_empty());
        assert_eq!(response.commands[1].aliases, vec!["reset", "new"]);
    }

    /// Every other line on the stream has to be skipped rather than failing the
    /// read — a hook event or a stray init would otherwise end the probe.
    #[test]
    fn skips_everything_that_is_not_our_reply() {
        for line in [
            r#"{"type":"system","subtype":"init","session_id":"s"}"#,
            r#"{"type":"control_response","response":{"subtype":"success","request_id":"someone_else","response":{"commands":[]}}}"#,
            r#"{"type":"control_response","response":{"subtype":"error","request_id":"req_1","error":"nope"}}"#,
            "not json at all",
            "",
        ] {
            assert!(matching_response(line, "req_1").is_none(), "{line}");
        }
    }

    /// The hidden set is exact-match, so a plugin that happens to name a
    /// command `model` keeps it — the conflict is with the CLI's own, not with
    /// the word.
    #[test]
    fn hides_only_the_commands_the_app_supersedes() {
        let commands = supported(vec![
            SlashCommand {
                name: "model".into(),
                description: "Set the AI model".into(),
                argument_hint: String::new(),
                aliases: vec![],
            },
            SlashCommand {
                name: "vendor:model".into(),
                description: "A plugin's own".into(),
                argument_hint: String::new(),
                aliases: vec![],
            },
            SlashCommand {
                name: "compact".into(),
                description: "Free up context".into(),
                argument_hint: String::new(),
                aliases: vec![],
            },
        ]);

        let names: Vec<&str> = commands.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["vendor:model", "compact"]);
    }

    /// A command with no arguments and no aliases is the common case, and the
    /// CLI omits `aliases` entirely for it.
    #[test]
    fn defaults_cover_the_fields_the_cli_omits() {
        let command: SlashCommand =
            serde_json::from_str(r#"{"name":"usage","description":"Show usage"}"#).unwrap();

        assert_eq!(command.argument_hint, "");
        assert!(command.aliases.is_empty());
    }
}

/// Hits the real CLI, so it's `#[ignore]`d: `cargo test -- --ignored
/// asks_the_real_cli` when changing the spawn or the reply shape above.
#[cfg(test)]
mod cli_tests {
    use super::*;

    /// The whole point of the probe is that it answers *before* a prompt, so
    /// this asserts a populated list without ever running a turn. `compact` is
    /// the check that built-ins are in there alongside the user's own skills —
    /// it is also the one command this app already knows the CLI honours over
    /// stdin.
    #[tokio::test]
    #[ignore]
    async fn asks_the_real_cli_for_its_commands() {
        let commands = list_commands(env!("CARGO_MANIFEST_DIR")).await.unwrap();

        assert!(commands.len() > 10, "got {} commands", commands.len());
        assert!(commands.iter().any(|c| c.name == "compact"));
        assert!(
            commands.iter().all(|c| !c.name.starts_with('/')),
            "names carry no leading slash; the picker adds it"
        );
    }
}

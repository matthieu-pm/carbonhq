//! `$server` mentions: the MCP servers a prompt names, and the note the agent
//! is given about them.
//!
//! **The note rides the wire and never the log.** The reader typed `$linear`
//! and the transcript draws `$linear`; only the text written to the child
//! carries the sentence telling the agent to use that server's tools. A
//! mention is a request about *how* to do the work, not part of what the
//! reader said, and drawing the note back would put words in their mouth.
//!
//! **Only a server the agent loads counts.** `$HOME` and `$PATH` are ordinary
//! things to type into a prompt, so a `$word` becomes a mention only where the
//! session's agent has a server of that exact name in the session's directory.
//! The names that matched ride the prompt event, which is how the transcript
//! knows what to draw as a chip without asking again.

use std::collections::BTreeSet;
use std::path::Path;
use std::sync::LazyLock;
use std::time::Duration;

use serde::Serialize;
use ts_rs::TS;

use crate::harness::{Harness, ProbeCache};
use crate::mcp_servers::{McpFile, McpServerEntry};
use crate::Fail;

/// One row of the `$` picker.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct McpMention {
    pub name: String,
    /// Where it is configured — `user`, `project`, `local`, `plugin` — drawn
    /// dimmed beside the name. Empty where the agent does not say.
    pub scope: String,
}

/// Claude Code's list costs a ~1.5s child, so it is kept a while. Short enough
/// that a server added in Settings → MCP shows up without a restart.
static CACHE: LazyLock<ProbeCache<Vec<McpMention>>> =
    LazyLock::new(|| ProbeCache::new(Duration::from_secs(60)));

/// The MCP servers `harness` loads in `cwd`, for the composer's `$` picker.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn list_mcp_mentions(harness: Harness, cwd: String) -> Result<Vec<McpMention>, Fail> {
    Ok(servers(harness, &cwd).await?)
}

async fn servers(harness: Harness, cwd: &str) -> anyhow::Result<Vec<McpMention>> {
    let key = format!("{}\0{cwd}", harness.wire_name());
    CACHE
        .get_or_probe(&key, || async {
            if harness == Harness::ClaudeCode {
                let listed = crate::harness::claude_code::commands::list_mcp_servers(cwd).await?;
                return Ok(listed
                    .into_iter()
                    .map(|(name, scope)| McpMention { name, scope })
                    .collect());
            }
            Ok(from_files(harness, Path::new(cwd)).await)
        })
        .await
}

/// Every enabled server in the files `harness` reads, first name wins.
///
/// Per-project files are read from `cwd` itself rather than the project root:
/// a worktree carries its own checked-in copy, and that copy is what the agent
/// running there loads.
async fn from_files(harness: Harness, cwd: &Path) -> Vec<McpMention> {
    let Some(home) = std::env::home_dir() else {
        return Vec::new();
    };
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for file in McpFile::ALL {
        if !file.readers().contains(&harness) {
            continue;
        }
        let project = file.per_project().then_some(cwd);
        let Some(path) = file.path(&home, project) else {
            continue;
        };
        let Ok(Some(entries)) = crate::mcp_servers::read_servers(file, &path, project).await
        else {
            continue;
        };
        let scope = if file.per_project() { "project" } else { "user" };
        for McpServerEntry { name, enabled, .. } in entries {
            if enabled && seen.insert(name.clone()) {
                out.push(McpMention {
                    name,
                    scope: scope.to_string(),
                });
            }
        }
    }
    out
}

/// The servers `prompt` mentions, in the order first mentioned, out of those
/// `harness` loads in `cwd`.
///
/// Answers nothing — rather than failing the send — where the list cannot be
/// read: a mention is a hint, and a prompt without one is still the prompt.
/// Never probes for a prompt holding no `$` at all, which is nearly every one.
pub async fn mentioned(harness: Harness, cwd: &str, prompt: &str) -> Vec<String> {
    let tokens = tokens(prompt);
    if tokens.is_empty() {
        return Vec::new();
    }
    let Ok(known) = servers(harness, cwd).await else {
        return Vec::new();
    };
    let mut out: Vec<String> = Vec::new();
    for token in tokens {
        if known.iter().any(|server| server.name == token) && !out.iter().any(|n| n == token) {
            out.push(token.to_string());
        }
    }
    out
}

/// Every `$word` opening a word, without sentence punctuation after it — the
/// same reading `mcpMention.ts` takes, so a chip drawn while typing is a
/// mention once sent.
fn tokens(prompt: &str) -> Vec<&str> {
    prompt
        .split_whitespace()
        .filter_map(|word| word.strip_prefix('$'))
        .map(|name| name.trim_end_matches(|c: char| ".,;:!?)".contains(c)))
        .filter(|name| !name.is_empty())
        .collect()
}

/// `text` with the note about `servers` after it, as the child receives it.
///
/// Worded for any agent: tool names are spelled differently per harness
/// (`mcp__linear__…` in Claude Code), so the note names the server and leaves
/// finding its tools to the agent, which knows its own spelling.
pub fn with_hint(text: &str, servers: &[String]) -> String {
    if servers.is_empty() {
        return text.to_string();
    }
    let names = servers
        .iter()
        .map(|name| format!("`{name}`"))
        .collect::<Vec<_>>()
        .join(", ");
    let (noun, pronoun) = if servers.len() == 1 {
        ("server", "its")
    } else {
        ("servers", "their")
    };
    format!(
        "{text}\n\n(Carbon: the user mentioned the MCP {noun} {names} with `$`. Use {pronoun} tools for this request.)"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_tokens_that_open_a_word() {
        assert_eq!(
            tokens("ask $linear, then $plugin:figma:figma. cost$5 $"),
            vec!["linear", "plugin:figma:figma"]
        );
    }

    /// Asks the installed Claude Code. Run by hand with `--ignored`; it needs
    /// a `linear` server configured, as the author's machine has.
    #[tokio::test]
    #[ignore]
    async fn live_claude_code_resolves_a_configured_server() {
        let cwd = env!("CARGO_MANIFEST_DIR");
        let listed = servers(Harness::ClaudeCode, cwd).await.unwrap();
        eprintln!("{listed:?}");
        let found = mentioned(Harness::ClaudeCode, cwd, "file it in $linear, echo $HOME").await;
        assert_eq!(found, vec!["linear".to_string()]);
    }

    #[test]
    fn a_prompt_with_no_mention_is_untouched() {
        assert_eq!(with_hint("hello", &[]), "hello");
    }

    #[test]
    fn the_hint_names_every_server() {
        let hinted = with_hint("do it", &["linear".into(), "figma".into()]);
        assert!(hinted.starts_with("do it\n\n"));
        assert!(hinted.contains("`linear`, `figma`"));
        assert!(hinted.contains("servers"));
    }
}

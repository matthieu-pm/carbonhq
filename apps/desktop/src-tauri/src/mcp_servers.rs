//! Normalized definitions discovered in the agents' existing MCP files.
//! Carbon owns new definitions and sign-ins; discovery leaves these files intact
//! so terminal agents retain their own setup.

use std::path::{Path, PathBuf};
use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use ts_rs::TS;
use crate::harness::Harness;
use crate::Fail;

/// Reaps a probe's descendants even when they ignore closed pipes.
pub(crate) struct ProbeGroup(pub u32);

impl Drop for ProbeGroup {
    fn drop(&mut self) {
        unsafe { libc::kill(-(self.0 as i32), libc::SIGKILL); }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "snake_case")]
pub enum McpTransport {
    Stdio,
    Http,
    Sse,
}

/// Where a server is written, which is also what decides who reads it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "snake_case")]
pub enum McpFile {
    Carbon,
    /// `~/.claude.json`'s top-level `mcpServers` — `claude mcp -s user`.
    ClaudeUser,
    /// `~/.claude.json`'s `projects[<path>].mcpServers` — `-s local`, private
    /// to the reader and to one project.
    ClaudeLocal,
    /// `<project>/.mcp.json` — `-s project`, checked in and shared.
    ClaudeProject,
    /// `~/.codex/config.toml`.
    Codex,
    /// `<project>/.codex/config.toml`, loaded for trusted projects.
    CodexProject,
    GrokUser,
    /// `<project>/.grok/config.toml`.
    GrokProject,
    /// `~/.fx/mcp.json`, the only list Carbon hands fx over ACP.
    Fx,
    PiUser,
    PiProject,
}

impl McpFile {
    pub(crate) const ALL: [McpFile; 10] = [
        McpFile::ClaudeUser,
        McpFile::ClaudeLocal,
        McpFile::ClaudeProject,
        McpFile::Codex,
        McpFile::CodexProject,
        McpFile::GrokUser,
        McpFile::GrokProject,
        McpFile::Fx,
        McpFile::PiUser,
        McpFile::PiProject,
    ];

    fn owner(self) -> Harness {
        match self {
            McpFile::Carbon => Harness::ClaudeCode,
            McpFile::ClaudeUser | McpFile::ClaudeLocal | McpFile::ClaudeProject => {
                Harness::ClaudeCode
            }
            McpFile::Codex | McpFile::CodexProject => Harness::Codex,
            McpFile::GrokUser | McpFile::GrokProject => Harness::Grok,
            McpFile::Fx => Harness::Fx,
            McpFile::PiUser | McpFile::PiProject => Harness::Pi,
        }
    }

    /// Every agent that loads this file. grok's compatibility scan of Claude's
    /// config and `.mcp.json` is on by default (`[compat.claude] mcps`), and a
    /// reader who turned it off sees one logo too many, never one too few.
    pub(crate) fn readers(self) -> Vec<Harness> {
        match self {
            McpFile::Carbon => Harness::ALL.to_vec(),
            McpFile::ClaudeUser | McpFile::ClaudeProject => {
                vec![Harness::ClaudeCode, Harness::Grok]
            }
            other => vec![other.owner()],
        }
    }

    pub(crate) fn per_project(self) -> bool {
        matches!(
            self,
            McpFile::ClaudeLocal
                | McpFile::ClaudeProject
                | McpFile::CodexProject
                | McpFile::GrokProject
                | McpFile::PiProject
        )
    }

    /// Codex speaks streamable HTTP only, and grok picks SSE or HTTP off the
    /// endpoint itself, so neither has an SSE spelling to write.
    fn transports(self) -> Vec<McpTransport> {
        match self {
            McpFile::Codex
            | McpFile::CodexProject
            | McpFile::GrokUser
            | McpFile::GrokProject
            | McpFile::PiUser
            | McpFile::PiProject => {
                vec![McpTransport::Stdio, McpTransport::Http]
            }
            _ => vec![McpTransport::Stdio, McpTransport::Http, McpTransport::Sse],
        }
    }

    fn claude_scope(self) -> Option<&'static str> {
        match self {
            McpFile::ClaudeUser => Some("user"),
            McpFile::ClaudeLocal => Some("local"),
            McpFile::ClaudeProject => Some("project"),
            _ => None,
        }
    }

    pub(crate) fn path(self, home: &Path, project: Option<&Path>) -> Option<PathBuf> {
        Some(match self {
            McpFile::Carbon => return None,
            McpFile::ClaudeUser | McpFile::ClaudeLocal => home.join(".claude.json"),
            McpFile::ClaudeProject => project?.join(".mcp.json"),
            McpFile::Codex => home.join(".codex/config.toml"),
            McpFile::CodexProject => project?.join(".codex/config.toml"),
            McpFile::GrokUser => home.join(".grok/config.toml"),
            McpFile::GrokProject => project?.join(".grok/config.toml"),
            McpFile::Fx => home.join(".fx/mcp.json"),
            McpFile::PiUser => home.join(".pi/agent/mcp.json"),
            McpFile::PiProject => project?.join(".pi/mcp.json"),
        })
    }
}

/// A name and a value, for env vars and headers. A list rather than a map so
/// the form keeps the order the reader typed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
pub struct KeyValue {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct McpServerEntry {
    pub name: String,
    pub transport: McpTransport,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: Vec<KeyValue>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub headers: Vec<KeyValue>,
    /// Off where the file says `enabled = false`. Carbon never flips it: each
    /// CLI has its own `enable`/`disable`, and a reader who turned one off did
    /// it there.
    #[serde(default = "yes")]
    pub enabled: bool,
    /// A Pi project override changes state while its definition stays in the user file.
    #[serde(default)]
    pub inherited: bool,
}

fn yes() -> bool {
    true
}

/// One file's servers, or the reason it could not be read.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct McpSource {
    /// Stable across reads, so the frontend can key rows and remember which
    /// one is open: the file kind and the project, or the extra's label.
    pub id: String,
    /// `None` for servers an agent reports that no file here holds — Claude
    /// Code's plugins and claude.ai connectors, Codex's plugins. Those are
    /// read-only, since the plugin owns them.
    pub file: Option<McpFile>,
    pub owner: Harness,
    pub readers: Vec<Harness>,
    pub project: Option<String>,
    /// The file, for the header line. Empty for an extra.
    pub path: String,
    /// What to call an extra's group, since it has no file to name.
    pub label: Option<String>,
    pub servers: Vec<McpServerEntry>,
    pub error: Option<String>,
    pub transports: Vec<McpTransport>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "snake_case")]
pub enum McpStatus {
    Connected,
    NeedsAuth,
    Failed,
    Disabled,
}

/// What an agent said about one server. Keyed the way a row is: the file's
/// owner, the project it was asked in, the name.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct McpStatusRow {
    pub owner: Harness,
    pub project: Option<String>,
    pub name: String,
    pub status: McpStatus,
}

#[derive(Debug, Clone, Default, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct McpStatusReport {
    pub statuses: Vec<McpStatusRow>,
    /// Servers an agent loads that no file here holds. They only show up in
    /// the agents' own `list`, which is why they ride the slow read.
    pub extras: Vec<McpSource>,
    /// Agents whose status read failed, with why, so a row with no dot reads
    /// as "not asked" rather than "fine".
    pub errors: Vec<McpStatusError>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
pub struct McpStatusError {
    pub harness: Harness,
    pub error: String,
}

/// Where a write lands: a file, and the project for one that has one.
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct McpTarget {
    pub file: McpFile,
    #[serde(default)]
    pub project: Option<String>,
}

/// Every server managed by Carbon, including automatic imports.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn list_mcp_servers() -> Result<Vec<McpSource>, Fail> {
    Ok(crate::mcp::config::sources().await?)
}

/// Writes only Carbon's catalog, including calls from an older settings client.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn save_mcp_server(mut target: McpTarget, original: Option<String>, server: McpServerEntry) -> Result<(), Fail> {
    target.file = McpFile::Carbon;
    Ok(crate::mcp::config::save(target, original, server).await?)
}

/// Removes the Carbon definition and keeps its automatic-import tombstone.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn remove_mcp_server(mut target: McpTarget, name: String) -> Result<(), Fail> {
    target.file = McpFile::Carbon;
    Ok(crate::mcp::config::remove(target, name).await?)
}

/// Reads upstream health independently of the settings list.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn mcp_server_status() -> McpStatusReport {
    crate::mcp::proxy::status().await
}

fn home() -> Result<PathBuf> {
    std::env::home_dir().ok_or_else(|| anyhow!("couldn't find your home directory"))
}

/// `Ok(None)` for a file that does not exist, which is the ordinary state of
/// most of these and never an error.
pub(crate) async fn read_servers(
    file: McpFile,
    path: &Path,
    project: Option<&Path>,
) -> Result<Option<Vec<McpServerEntry>>> {
    let text = match tokio::fs::read_to_string(path).await {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(err).with_context(|| format!("couldn't read {}", path.display())),
    };
    if text.trim().is_empty() {
        return Ok(None);
    }
    let servers = match file {
        McpFile::Carbon => bail!("Carbon MCP settings use the proxy catalog"),
        McpFile::ClaudeUser
        | McpFile::ClaudeLocal
        | McpFile::ClaudeProject
        | McpFile::Fx
        | McpFile::PiUser
        | McpFile::PiProject => {
            let root: Value = serde_json::from_str(&text)
                .with_context(|| format!("couldn't parse {}", path.display()))?;
            if !root.is_object() {
                bail!("{} isn't a JSON object", path.display());
            }
            let raw = match file {
                McpFile::ClaudeLocal => root
                    .get("projects")
                    .and_then(|p| project.and_then(|path| p.get(path.to_string_lossy().as_ref())))
                    .and_then(|p| p.get("mcpServers")),
                McpFile::Fx => root.get("mcpServers").or_else(|| root.get("mcp")),
                _ => root.get("mcpServers"),
            };
            if raw.is_some_and(|v| {
                !v.is_object()
                    || v.as_object()
                        .is_some_and(|t| t.values().any(|v| !v.is_object()))
            }) {
                bail!("{} has an invalid MCP server table", path.display());
            }
            let mut servers = json_servers(file, &root, project);
            if file == McpFile::PiProject && servers.iter().any(|s| s.inherited) {
                let global_path = home()?.join(".pi/agent/mcp.json");
                let global = match tokio::fs::read_to_string(&global_path).await {
                    Ok(text) => {
                        serde_json::from_str(&text).context("couldn't parse pi's user config")?
                    }
                    Err(err) if err.kind() == std::io::ErrorKind::NotFound => json!({}),
                    Err(err) => return Err(err).context("couldn't read pi's user config"),
                };
                pi_override_transports(&mut servers, &global);
            }
            servers
        }
        McpFile::Codex | McpFile::CodexProject | McpFile::GrokUser | McpFile::GrokProject => {
            let doc: toml_edit::DocumentMut = text
                .parse()
                .with_context(|| format!("couldn't parse {}", path.display()))?;
            if let Some(item) = doc.get("mcp_servers") {
                let table = item
                    .as_table_like()
                    .ok_or_else(|| anyhow!("mcp_servers isn't a table"))?;
                if table
                    .iter()
                    .any(|(_, entry)| entry.as_table_like().is_none())
                {
                    bail!("{} has an invalid MCP server entry", path.display());
                }
            }
            toml_servers(file, &doc)
        }
    };
    Ok(Some(servers))
}

/// The JSON object holding servers by name, wherever this file keeps it.
fn json_table<'a>(
    file: McpFile,
    root: &'a Value,
    project: Option<&Path>,
) -> Option<&'a Map<String, Value>> {
    match file {
        McpFile::ClaudeUser | McpFile::ClaudeProject | McpFile::PiUser | McpFile::PiProject => {
            root.get("mcpServers")?.as_object()
        }
        McpFile::ClaudeLocal => root
            .get("projects")?
            .get(project?.to_string_lossy().as_ref())?
            .get("mcpServers")?
            .as_object(),
        McpFile::Fx => root.get("mcpServers").or_else(|| root.get("mcp"))?.as_object(),
        _ => None,
    }
}

fn json_servers(file: McpFile, root: &Value, project: Option<&Path>) -> Vec<McpServerEntry> {
    let Some(table) = json_table(file, root, project) else {
        return Vec::new();
    };
    let mut servers: Vec<McpServerEntry> = table
        .iter()
        .filter_map(|(name, entry)| {
            let mut server = json_entry(name, entry)?;
            server.inherited = file == McpFile::PiProject
                && ["command", "url", "type"]
                    .iter()
                    .all(|key| entry.get(key).is_none());
            Some(server)
        })
        .collect();
    servers.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    servers
}

/// Inherit only transport metadata; returning user credentials here could copy them into a shared project file.
fn pi_override_transports(servers: &mut [McpServerEntry], global: &Value) {
    for server in servers.iter_mut().filter(|s| s.inherited) {
        if let Some(definition) = global
            .get("mcpServers")
            .and_then(|t| t.get(&server.name))
            .and_then(|entry| json_entry(&server.name, entry))
        {
            server.transport = definition.transport;
        }
    }
}

/// One entry, read leniently: a field the agent added that this build does not
/// know costs nothing, and a missing one reads as empty.
fn json_entry(name: &str, entry: &Value) -> Option<McpServerEntry> {
    let entry = entry.as_object()?;
    let url = entry.get("url").and_then(Value::as_str).map(str::to_string);
    let transport = match entry.get("type").and_then(Value::as_str) {
        Some("sse") => McpTransport::Sse,
        Some("http") | Some("streamable-http") | Some("ws") => McpTransport::Http,
        Some("stdio") => McpTransport::Stdio,
        _ if url.is_some() => McpTransport::Http,
        _ => McpTransport::Stdio,
    };
    Some(McpServerEntry {
        name: name.to_string(),
        transport,
        command: entry
            .get("command")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| entry.get("command").and_then(Value::as_array).and_then(|a| a.first()).and_then(Value::as_str).map(str::to_string)),
        args: entry.get("command").and_then(Value::as_array).map(|a| a.iter().skip(1).filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_else(|| string_list(entry.get("args"))),
        env: string_map(entry.get("environment").or_else(|| entry.get("env"))),
        url,
        headers: string_map(entry.get("headers")),
        inherited: false,
        enabled: entry
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(true),
    })
}

fn string_list(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn string_map(value: Option<&Value>) -> Vec<KeyValue> {
    value
        .and_then(Value::as_object)
        .map(|map| {
            map.iter()
                .map(|(k, v)| KeyValue {
                    name: k.clone(),
                    value: v
                        .as_str()
                        .map(str::to_string)
                        .unwrap_or_else(|| v.to_string()),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Codex calls its headers `http_headers`; grok calls them `headers`.
fn headers_key(file: McpFile) -> &'static str {
    if matches!(file, McpFile::Codex | McpFile::CodexProject) {
        "http_headers"
    } else {
        "headers"
    }
}

fn toml_servers(file: McpFile, doc: &toml_edit::DocumentMut) -> Vec<McpServerEntry> {
    let Some(table) = doc.get("mcp_servers").and_then(|t| t.as_table_like()) else {
        return Vec::new();
    };
    let mut servers: Vec<McpServerEntry> = table
        .iter()
        .filter_map(|(name, item)| {
            let entry = item.as_table_like()?;
            let str_of = |key: &str| entry.get(key).and_then(|v| v.as_str()).map(str::to_string);
            let url = str_of("url");
            let args = entry
                .get("args")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            Some(McpServerEntry {
                name: name.to_string(),
                transport: if url.is_some() {
                    McpTransport::Http
                } else {
                    McpTransport::Stdio
                },
                command: str_of("command"),
                args,
                env: toml_map(entry.get("env")),
                url,
                headers: toml_map(entry.get(headers_key(file))),
                inherited: false,
                enabled: entry
                    .get("enabled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true),
            })
        })
        .collect();
    servers.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    servers
}

fn toml_map(item: Option<&toml_edit::Item>) -> Vec<KeyValue> {
    item.and_then(|i| i.as_table_like())
        .map(|t| {
            t.iter()
                .map(|(k, v)| KeyValue {
                    name: k.to_string(),
                    value: v
                        .as_str()
                        .map(str::to_string)
                        .unwrap_or_else(|| v.to_string().trim().to_string()),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// What the form sent, checked before anything is written. Names follow
/// Codex's rule, the strictest of the four, so a server added for one agent
/// can be copied to another unchanged; an existing name kept as it was is let
/// through whatever it holds.
pub(crate) fn validate(target: &McpTarget, original: Option<&str>, server: &McpServerEntry) -> Result<()> {
    if server.inherited {
        bail!("edit the global definition instead of this project override");
    }
    let name = server.name.trim();
    if name.is_empty() {
        bail!("a server needs a name");
    }
    let renamed = original != Some(name);
    if renamed
        && !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        bail!("use letters, numbers, dashes and underscores in the name");
    }
    if !target.file.transports().contains(&server.transport) {
        bail!("{} can't use that transport", target.file.owner().label());
    }
    if target.file == McpFile::Fx
        && server
            .headers
            .iter()
            .any(|h| h.name.eq_ignore_ascii_case("authorization"))
    {
        bail!("fx requires bearer_token_env for authorization; set it with fx mcp in a terminal");
    }
    match server.transport {
        McpTransport::Stdio => {
            if server
                .command
                .as_deref()
                .is_none_or(|c| c.trim().is_empty())
            {
                bail!("a local server needs a command");
            }
        }
        McpTransport::Http | McpTransport::Sse => {
            let url = server.url.as_deref().unwrap_or("").trim();
            if !(url.starts_with("http://") || url.starts_with("https://")) {
                bail!("the URL has to start with http:// or https://");
            }
        }
    }
    if target.file.per_project() && target.project.is_none() {
        bail!("pick a project for this server");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fx_current_and_legacy_shapes_keep_commands_and_environment() {
        for key in ["mcpServers", "mcp"] {
            let root = json!({key:{"local":{"command":["python3","server.py"], "environment":{"TOKEN":"${MCP_TOKEN}"}}}});
            let entries = json_servers(McpFile::Fx, &root, None);
            assert_eq!(entries[0].command.as_deref(), Some("python3"));
            assert_eq!(entries[0].args, vec!["server.py"]);
            assert_eq!(entries[0].env[0].value, "${MCP_TOKEN}");
        }
    }

    #[test]
    fn codex_headers_and_disabled_overrides_survive_discovery() {
        let doc: toml_edit::DocumentMut = "[mcp_servers.docs]\nurl='https://example.com/mcp'\nenabled=false\n[mcp_servers.docs.http_headers]\nX-Token='${TOKEN}'\n".parse().unwrap();
        let entries = toml_servers(McpFile::Codex, &doc);
        assert!(!entries[0].enabled);
        assert_eq!(entries[0].headers[0].value, "${TOKEN}");
    }

    #[tokio::test]
    async fn a_malformed_source_is_reported_without_replacing_it() {
        let path = std::env::temp_dir().join(format!("carbon-mcp-malformed-{}", uuid::Uuid::new_v4()));
        tokio::fs::write(&path, "invalid TOML = [").await.unwrap();
        assert!(read_servers(McpFile::Codex, &path, None).await.is_err());
        assert_eq!(tokio::fs::read_to_string(&path).await.unwrap(), "invalid TOML = [");
        tokio::fs::remove_file(path).await.unwrap();
    }
}

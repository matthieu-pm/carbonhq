//! The MCP servers each agent loads, read off the agents' own config files and
//! written back to them. Settings → MCP draws this.
//!
//! **Nothing is copied into Carbon.** Every read goes to the file the agent
//! itself reads at spawn, so a change made here is what the next session
//! starts with, and a change made in a terminal is what the tab shows next.
//!
//! **A list is grouped by file, not by agent**, because files are shared: grok
//! loads Claude Code's `~/.claude.json` and a project's `.mcp.json` as well as
//! its own `config.toml`. Each [`McpSource`] names every agent that reads it.
//!
//! **Claude Code's files are written by `claude mcp`, never by hand.** The CLI
//! rewrites `~/.claude.json` on every start, so a read-modify-write here would
//! race it and lose whichever write lands second. The TOML files and fx's JSON
//! are written here, under a process lock and a rename; their CLIs write them
//! rarely, and `toml_edit` keeps the reader's comments and order.
//!
//! pi has no MCP support at all, by design, so it has no file here.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tokio::process::Command;
use ts_rs::TS;

use crate::harness::{agent_path, Harness};
use crate::Fail;

/// One status read can spawn every stdio server the reader has configured, and
/// `npx` servers download on a cold start, so this is far longer than a probe.
const STATUS_TIMEOUT: Duration = Duration::from_secs(60);
/// `claude mcp add-json` and friends answer at once; a hang here is a CLI that
/// decided to prompt, which must not hold the page busy for ever.
const WRITE_TIMEOUT: Duration = Duration::from_secs(30);

/// Serialises this process's own writes. It cannot lock against the agents'
/// CLIs, which take no lock of ours; the rename keeps a reader from ever seeing
/// a torn file, and the window for losing their write is one read to one rename.
static WRITE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

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
}

impl McpFile {
    const ALL: [McpFile; 8] = [
        McpFile::ClaudeUser,
        McpFile::ClaudeLocal,
        McpFile::ClaudeProject,
        McpFile::Codex,
        McpFile::CodexProject,
        McpFile::GrokUser,
        McpFile::GrokProject,
        McpFile::Fx,
    ];

    fn owner(self) -> Harness {
        match self {
            McpFile::ClaudeUser | McpFile::ClaudeLocal | McpFile::ClaudeProject => {
                Harness::ClaudeCode
            }
            McpFile::Codex | McpFile::CodexProject => Harness::Codex,
            McpFile::GrokUser | McpFile::GrokProject => Harness::Grok,
            McpFile::Fx => Harness::Fx,
        }
    }

    /// Every agent that loads this file. grok's compatibility scan of Claude's
    /// config and `.mcp.json` is on by default (`[compat.claude] mcps`), and a
    /// reader who turned it off sees one logo too many, never one too few.
    fn readers(self) -> Vec<Harness> {
        match self {
            McpFile::ClaudeUser | McpFile::ClaudeProject => {
                vec![Harness::ClaudeCode, Harness::Grok]
            }
            other => vec![other.owner()],
        }
    }

    fn per_project(self) -> bool {
        matches!(
            self,
            McpFile::ClaudeLocal
                | McpFile::ClaudeProject
                | McpFile::CodexProject
                | McpFile::GrokProject
        )
    }

    /// Codex speaks streamable HTTP only, and grok picks SSE or HTTP off the
    /// endpoint itself, so neither has an SSE spelling to write.
    fn transports(self) -> Vec<McpTransport> {
        match self {
            McpFile::Codex | McpFile::CodexProject | McpFile::GrokUser | McpFile::GrokProject => {
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

    fn path(self, home: &Path, project: Option<&Path>) -> Option<PathBuf> {
        Some(match self {
            McpFile::ClaudeUser | McpFile::ClaudeLocal => home.join(".claude.json"),
            McpFile::ClaudeProject => project?.join(".mcp.json"),
            McpFile::Codex => home.join(".codex/config.toml"),
            McpFile::CodexProject => project?.join(".codex/config.toml"),
            McpFile::GrokUser => home.join(".grok/config.toml"),
            McpFile::GrokProject => project?.join(".grok/config.toml"),
            McpFile::Fx => home.join(".fx/mcp.json"),
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

fn home() -> Result<PathBuf> {
    std::env::home_dir().ok_or_else(|| anyhow!("couldn't find your home directory"))
}

async fn project_paths() -> Vec<PathBuf> {
    crate::projects::list_projects()
        .await
        .map(|projects| {
            projects
                .into_iter()
                .map(|p| PathBuf::from(p.path))
                .collect()
        })
        .unwrap_or_default()
}

/// Every file an agent here loads MCP servers from, for every attached project.
///
/// A global file is listed for an agent that is installed even when it holds
/// nothing, so the reader has somewhere to add to; a project's file only where
/// it exists, or every project would draw three empty groups.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn list_mcp_servers() -> Result<Vec<McpSource>, Fail> {
    let home = home()?;
    let projects = project_paths().await;
    let mut installed = BTreeMap::new();
    for harness in Harness::ALL {
        installed.insert(
            harness.wire_name(),
            crate::binpath::agent_installed(harness).await,
        );
    }

    let mut sources = Vec::new();
    for file in McpFile::ALL {
        let scopes: Vec<Option<&Path>> = if file.per_project() {
            projects.iter().map(|p| Some(p.as_path())).collect()
        } else {
            vec![None]
        };
        for project in scopes {
            let Some(path) = file.path(&home, project) else {
                continue;
            };
            let (servers, error) = match read_servers(file, &path, project).await {
                Ok(Some(servers)) => (servers, None),
                Ok(None) => (Vec::new(), None),
                Err(err) => (Vec::new(), Some(format!("{err:#}"))),
            };
            let exists = !servers.is_empty() || error.is_some();
            let wanted = if file.per_project() {
                exists
            } else {
                exists
                    || installed
                        .get(&file.owner().wire_name())
                        .copied()
                        .unwrap_or(false)
            };
            if !wanted {
                continue;
            }
            sources.push(McpSource {
                id: source_id(file, project),
                file: Some(file),
                owner: file.owner(),
                readers: file.readers(),
                project: project.map(|p| p.to_string_lossy().into_owned()),
                path: path.to_string_lossy().into_owned(),
                label: None,
                servers,
                error,
                transports: file.transports(),
            });
        }
    }
    Ok(sources)
}

fn source_id(file: McpFile, project: Option<&Path>) -> String {
    let kind = serde_json::to_value(file)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default();
    match project {
        Some(p) => format!("{kind}:{}", p.display()),
        None => kind,
    }
}

/// `Ok(None)` for a file that does not exist, which is the ordinary state of
/// most of these and never an error.
async fn read_servers(
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
        McpFile::ClaudeUser | McpFile::ClaudeLocal | McpFile::ClaudeProject | McpFile::Fx => {
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
                McpFile::Fx => root.get("mcp"),
                _ => root.get("mcpServers"),
            };
            if raw.is_some_and(|v| {
                !v.is_object()
                    || v.as_object()
                        .is_some_and(|t| t.values().any(|v| !v.is_object()))
            }) {
                bail!("{} has an invalid MCP server table", path.display());
            }
            json_servers(file, &root, project)
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
        McpFile::ClaudeUser | McpFile::ClaudeProject => root.get("mcpServers")?.as_object(),
        McpFile::ClaudeLocal => root
            .get("projects")?
            .get(project?.to_string_lossy().as_ref())?
            .get("mcpServers")?
            .as_object(),
        McpFile::Fx => root.get("mcp")?.as_object(),
        _ => None,
    }
}

fn json_servers(file: McpFile, root: &Value, project: Option<&Path>) -> Vec<McpServerEntry> {
    let Some(table) = json_table(file, root, project) else {
        return Vec::new();
    };
    let mut servers: Vec<McpServerEntry> = table
        .iter()
        .filter_map(|(name, entry)| json_entry(name, entry))
        .collect();
    servers.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    servers
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
            .map(str::to_string),
        args: string_list(entry.get("args")),
        env: string_map(entry.get("env")),
        url,
        headers: string_map(entry.get("headers")),
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
fn validate(target: &McpTarget, original: Option<&str>, server: &McpServerEntry) -> Result<()> {
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

/// Where a project-scoped write may land: an attached project and nothing
/// else, so a command cannot be pointed at an arbitrary directory.
async fn checked_project(target: &McpTarget) -> Result<Option<PathBuf>> {
    let Some(project) = target.project.as_deref() else {
        return Ok(None);
    };
    if !target.file.per_project() {
        return Ok(None);
    }
    let path = PathBuf::from(project);
    if !project_paths().await.contains(&path) {
        bail!("{project} isn't an attached project");
    }
    Ok(Some(path))
}

/// Adds a server, or replaces `original` with it. A rename is a remove and an
/// add, so the reader can retitle a server without retyping it.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn save_mcp_server(
    target: McpTarget,
    original: Option<String>,
    server: McpServerEntry,
) -> Result<(), Fail> {
    validate(&target, original.as_deref(), &server)?;
    let project = checked_project(&target).await?;
    let home = home()?;
    let mut server = server;
    server.name = server.name.trim().to_string();
    let _guard = WRITE_LOCK.lock().await;
    let _across = crate::store::lock_across_processes("agent-mcp").await;

    if target.file.claude_scope().is_some() {
        claude_save(
            &target,
            project.as_deref(),
            &home,
            original.as_deref(),
            &server,
        )
        .await?;
        return Ok(());
    }

    let path = target
        .file
        .path(&home, project.as_deref())
        .ok_or_else(|| anyhow!("no file to write"))?;
    match target.file {
        McpFile::Fx => edit_json(&path, |root| fx_save(root, original.as_deref(), &server)).await?,
        _ => {
            edit_toml(&path, |doc| {
                toml_save(target.file, doc, original.as_deref(), &server)
            })
            .await?
        }
    }
    Ok(())
}

/// Removes only the server in the selected file and scope.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn remove_mcp_server(target: McpTarget, name: String) -> Result<(), Fail> {
    if target.file.per_project() && target.project.is_none() {
        return Err(anyhow!("pick a project for this server").into());
    }
    let project = checked_project(&target).await?;
    let home = home()?;
    let _guard = WRITE_LOCK.lock().await;
    let _across = crate::store::lock_across_processes("agent-mcp").await;

    if let Some(scope) = target.file.claude_scope() {
        claude(
            &["mcp", "remove", "--scope", scope, &name],
            project.as_deref().unwrap_or(&home),
        )
        .await?;
        return Ok(());
    }
    let path = target
        .file
        .path(&home, project.as_deref())
        .ok_or_else(|| anyhow!("no file to write"))?;
    match target.file {
        McpFile::Fx => {
            edit_json(&path, |root| {
                let removed = root
                    .get_mut("mcp")
                    .and_then(Value::as_object_mut)
                    .and_then(|t| t.remove(&name));
                removed
                    .map(|_| ())
                    .ok_or_else(|| anyhow!("{name} isn't in {}", path.display()))
            })
            .await?
        }
        _ => {
            edit_toml(&path, |doc| {
                let removed = doc
                    .get_mut("mcp_servers")
                    .and_then(|t| t.as_table_like_mut())
                    .and_then(|t| t.remove(&name));
                removed
                    .map(|_| ())
                    .ok_or_else(|| anyhow!("{name} isn't in {}", path.display()))
            })
            .await?
        }
    }
    Ok(())
}

/// Claude Code's JSON for a server, laid over whatever the existing entry
/// held, so a field this form does not draw (`oauth`, `timeout`) survives an
/// edit. Fields the other transport uses are dropped, or a server switched
/// from local to HTTP would keep a `command` Claude then refuses.
fn merged_json(existing: Option<&Value>, server: &McpServerEntry, with_type: bool) -> Value {
    let mut entry = existing
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    for key in ["command", "args", "env", "url", "headers"] {
        entry.remove(key);
    }
    let pairs = |list: &[KeyValue]| {
        Value::Object(
            list.iter()
                .map(|kv| (kv.name.clone(), Value::String(kv.value.clone())))
                .collect(),
        )
    };
    match server.transport {
        McpTransport::Stdio => {
            if with_type {
                entry.insert("type".into(), json!("stdio"));
            }
            entry.insert(
                "command".into(),
                json!(server.command.as_deref().unwrap_or("").trim()),
            );
            entry.insert("args".into(), json!(server.args));
            if !server.env.is_empty() {
                entry.insert("env".into(), pairs(&server.env));
            }
        }
        McpTransport::Http | McpTransport::Sse => {
            let kind = if server.transport == McpTransport::Sse {
                "sse"
            } else {
                "http"
            };
            entry.insert("type".into(), json!(kind));
            entry.insert(
                "url".into(),
                json!(server.url.as_deref().unwrap_or("").trim()),
            );
            if !server.headers.is_empty() {
                entry.insert("headers".into(), pairs(&server.headers));
            }
        }
    }
    if !with_type && server.transport == McpTransport::Stdio {
        entry.remove("type");
    }
    Value::Object(entry)
}

async fn claude_save(
    target: &McpTarget,
    project: Option<&Path>,
    home: &Path,
    original: Option<&str>,
    server: &McpServerEntry,
) -> Result<()> {
    let scope = target.file.claude_scope().unwrap_or("user");
    let cwd = project.unwrap_or(home);
    let file_path = target
        .file
        .path(home, project)
        .ok_or_else(|| anyhow!("no file to read"))?;

    let root: Value = match tokio::fs::read_to_string(&file_path).await {
        Ok(text) => serde_json::from_str(&text).context("couldn't parse the MCP config")?,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => json!({}),
        Err(err) => return Err(err).context("couldn't read the MCP config"),
    };
    let table = json_table(target.file, &root, project);
    if original != Some(server.name.as_str()) && table.is_some_and(|t| t.contains_key(&server.name))
    {
        bail!("there's already a server called {}", server.name);
    }
    let existing = original
        .and_then(|name| table.and_then(|t| t.get(name)))
        .cloned();
    if original.is_some() && existing.is_none() {
        bail!("this server is no longer in the config; refresh and try again");
    }
    let json = merged_json(existing.as_ref(), server, true).to_string();

    if let Some(name) = original {
        claude(&["mcp", "remove", "--scope", scope, name], cwd).await?;
    }
    if let Err(err) = claude(
        &["mcp", "add-json", "--scope", scope, &server.name, &json],
        cwd,
    )
    .await
    {
        // Put the old one back, so a refused edit costs the edit and not the server.
        if let (Some(name), Some(old)) = (original, existing) {
            if let Err(restore) = claude(
                &["mcp", "add-json", "--scope", scope, name, &old.to_string()],
                cwd,
            )
            .await
            {
                bail!("{err:#}; couldn't restore {name}: {restore:#}");
            }
        }
        return Err(err);
    }
    Ok(())
}

fn fx_save(root: &mut Value, original: Option<&str>, server: &McpServerEntry) -> Result<()> {
    if !root.is_object() {
        bail!("fx's config isn't a JSON object");
    }
    let object = root.as_object_mut().expect("just made an object");
    let table = object.entry("mcp").or_insert_with(|| json!({}));
    let table = table
        .as_object_mut()
        .ok_or_else(|| anyhow!("`mcp` in fx's config isn't an object"))?;
    if original != Some(server.name.as_str()) && table.contains_key(&server.name) {
        bail!("there's already a server called {}", server.name);
    }
    if original.is_some_and(|name| !table.contains_key(name)) {
        bail!("this server is no longer in the config; refresh and try again");
    }
    let existing = original.and_then(|name| table.remove(name));
    table.insert(
        server.name.clone(),
        merged_json(existing.as_ref(), server, false),
    );
    Ok(())
}

fn toml_save(
    file: McpFile,
    doc: &mut toml_edit::DocumentMut,
    original: Option<&str>,
    server: &McpServerEntry,
) -> Result<()> {
    use toml_edit::{value, Array, InlineTable, Item, Table};

    if doc.get("mcp_servers").is_none() {
        let mut table = Table::new();
        // No bare `[mcp_servers]` header over the entries below it.
        table.set_implicit(true);
        doc.insert("mcp_servers", Item::Table(table));
    }
    let servers = doc
        .get_mut("mcp_servers")
        .and_then(|t| t.as_table_mut())
        .ok_or_else(|| anyhow!("`mcp_servers` isn't a table"))?;
    if original != Some(server.name.as_str()) && servers.contains_key(&server.name) {
        bail!("there's already a server called {}", server.name);
    }

    if original.is_some_and(|name| !servers.contains_key(name)) {
        bail!("this server is no longer in the config; refresh and try again");
    }
    let mut entry = match original.and_then(|name| servers.remove(name)) {
        Some(Item::Table(table)) => table,
        Some(Item::Value(toml_edit::Value::InlineTable(inline))) => inline.into_table(),
        _ => Table::new(),
    };
    let headers = headers_key(file);
    for key in ["command", "args", "env", "url", headers] {
        entry.remove(key);
    }
    let pairs = |list: &[KeyValue]| {
        let mut inline = InlineTable::new();
        for kv in list {
            inline.insert(&kv.name, kv.value.clone().into());
        }
        value(inline)
    };
    match server.transport {
        McpTransport::Stdio => {
            entry.insert(
                "command",
                value(server.command.as_deref().unwrap_or("").trim()),
            );
            entry.insert(
                "args",
                value(server.args.iter().cloned().collect::<Array>()),
            );
            if !server.env.is_empty() {
                entry.insert("env", pairs(&server.env));
            }
        }
        McpTransport::Http | McpTransport::Sse => {
            entry.insert("url", value(server.url.as_deref().unwrap_or("").trim()));
            if !server.headers.is_empty() {
                entry.insert(headers, pairs(&server.headers));
            }
        }
    }
    servers.insert(&server.name, Item::Table(entry));
    Ok(())
}

/// The file to write through: a dotfiles manager often links these into a
/// repo, and a rename over the link would replace it with a plain file.
async fn write_target(path: &Path) -> PathBuf {
    tokio::fs::canonicalize(path)
        .await
        .unwrap_or_else(|_| path.to_path_buf())
}

async fn edit_json(path: &Path, edit: impl FnOnce(&mut Value) -> Result<()>) -> Result<()> {
    let path = write_target(path).await;
    let text = match tokio::fs::read_to_string(&path).await {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(err) => return Err(err).with_context(|| format!("couldn't read {}", path.display())),
    };
    // Unparseable is an error, never a fresh start: rewriting it whole would
    // drop every server the reader has.
    let mut root: Value = if text.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(&text).with_context(|| format!("couldn't parse {}", path.display()))?
    };
    edit(&mut root)?;
    let mut out = serde_json::to_string_pretty(&root)?;
    out.push('\n');
    replace(&path, out.as_bytes()).await
}

async fn edit_toml(
    path: &Path,
    edit: impl FnOnce(&mut toml_edit::DocumentMut) -> Result<()>,
) -> Result<()> {
    let path = write_target(path).await;
    let text = match tokio::fs::read_to_string(&path).await {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(err) => return Err(err).with_context(|| format!("couldn't read {}", path.display())),
    };
    let mut doc: toml_edit::DocumentMut = text
        .parse()
        .with_context(|| format!("couldn't parse {}", path.display()))?;
    edit(&mut doc)?;
    replace(&path, doc.to_string().as_bytes()).await
}

/// Write-temp and rename, keeping the old file's mode: these hold tokens, and
/// a config left `0600` by its CLI must not come back world-readable.
async fn replace(path: &Path, contents: &[u8]) -> Result<()> {
    if let Some(dir) = path.parent() {
        tokio::fs::create_dir_all(dir)
            .await
            .with_context(|| format!("couldn't create {}", dir.display()))?;
    }
    let mode = tokio::fs::metadata(path)
        .await
        .ok()
        .map(|m| m.permissions());
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(format!(".carbon-{}", uuid::Uuid::now_v7()));
    let tmp = path.with_file_name(name);
    use tokio::io::AsyncWriteExt;
    let mut options = tokio::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(&tmp)
        .await
        .with_context(|| format!("couldn't write {}", tmp.display()))?;
    if let Err(err) = file.write_all(contents).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(err.into());
    }
    if let Some(mode) = mode {
        let _ = tokio::fs::set_permissions(&tmp, mode).await;
    }
    if let Err(err) = tokio::fs::rename(&tmp, path).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(err).with_context(|| format!("couldn't replace {}", path.display()));
    }
    Ok(())
}

async fn run_cli(
    harness: Harness,
    args: &[&str],
    cwd: &Path,
    timeout: Duration,
) -> Result<(bool, String, String)> {
    let bin = crate::binpath::agent_binary(harness).await;
    if !bin.is_absolute() {
        bail!("{} isn't installed", harness.label());
    }
    let mut command = Command::new(&bin);
    command
        .args(args)
        .env("PATH", agent_path(&bin))
        .stdin(Stdio::null())
        .kill_on_drop(true);
    if cwd.is_dir() {
        command.current_dir(cwd);
    }
    let output = tokio::time::timeout(timeout, command.output())
        .await
        .map_err(|_| anyhow!("{} took too long to answer", harness.label()))?
        .with_context(|| format!("couldn't run {}", harness.label()))?;
    Ok((
        output.status.success(),
        String::from_utf8_lossy(&output.stdout).into_owned(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    ))
}

/// `claude <args>`, failing with the CLI's own sentence.
async fn claude(args: &[&str], cwd: &Path) -> Result<()> {
    let (ok, out, err) = run_cli(Harness::ClaudeCode, args, cwd, WRITE_TIMEOUT).await?;
    if ok {
        return Ok(());
    }
    let said = if err.trim().is_empty() { out } else { err };
    bail!("{}", said.trim())
}

/// What each agent says about its servers' health. Slow — Claude Code
/// connects to every one — so it is a separate call the tab makes after the
/// list is already on screen.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn mcp_server_status() -> McpStatusReport {
    let Ok(home) = home() else {
        return McpStatusReport::default();
    };
    let sources = list_mcp_servers().await.unwrap_or_default();
    let claude_projects: Vec<PathBuf> = sources
        .iter()
        .filter(|s| s.owner == Harness::ClaudeCode && !s.servers.is_empty())
        .filter_map(|s| s.project.as_ref().map(PathBuf::from))
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();

    let codex_projects: Vec<PathBuf> = sources
        .iter()
        .filter(|s| s.file == Some(McpFile::CodexProject))
        .filter_map(|s| s.project.as_ref().map(PathBuf::from))
        .collect();
    let mut report = McpStatusReport::default();
    let claude_home = claude_status(&home, None, &sources);
    let claude_projects = futures_util::future::join_all(
        claude_projects
            .iter()
            .map(|p| claude_status(p, Some(p.as_path()), &sources)),
    );
    let codex_reads = futures_util::future::join_all(
        std::iter::once((home.as_path(), None))
            .chain(
                codex_projects
                    .iter()
                    .map(|p| (p.as_path(), Some(p.as_path()))),
            )
            .map(|(cwd, project)| codex_status(cwd, project, &sources)),
    );
    let (claude_home, claude_projects, codex, grok, fx) = tokio::join!(
        claude_home,
        claude_projects,
        codex_reads,
        grok_status(&home),
        fx_status(&sources),
    );
    for part in std::iter::once(claude_home)
        .chain(claude_projects)
        .chain(codex)
        .chain([grok, fx])
    {
        match part {
            Ok(part) => {
                report.statuses.extend(part.statuses);
                report.extras.extend(part.extras);
            }
            Err((harness, err)) => {
                if !report.errors.iter().any(|e| e.harness == harness) {
                    report.errors.push(McpStatusError {
                        harness,
                        error: err,
                    });
                }
            }
        }
    }
    report
}

type Part = std::result::Result<McpStatusReport, (Harness, String)>;

fn names_in(sources: &[McpSource], owner: Harness, project: Option<&Path>) -> Vec<String> {
    sources
        .iter()
        .filter(|s| s.owner == owner)
        .filter(|s| {
            project.is_none()
                || s.project.is_none()
                || s.project.as_deref().map(Path::new) == project
        })
        .flat_map(|s| s.servers.iter().map(|e| e.name.clone()))
        .collect()
}

/// `claude mcp list`, which has no `--json`: one line per server, `name:
/// target - <mark> <words>`. Split from the right for the status and from the
/// left on `": "` for the name, since a plugin's name carries bare colons
/// (`plugin:figma:figma`) and a URL carries `://`.
async fn claude_status(cwd: &Path, project: Option<&Path>, sources: &[McpSource]) -> Part {
    if !crate::binpath::agent_installed(Harness::ClaudeCode).await {
        return Ok(McpStatusReport::default());
    }
    let (ok, out, err) = run_cli(Harness::ClaudeCode, &["mcp", "list"], cwd, STATUS_TIMEOUT)
        .await
        .map_err(|e| (Harness::ClaudeCode, format!("{e:#}")))?;
    if !ok {
        return Err((
            Harness::ClaudeCode,
            if err.trim().is_empty() { out } else { err },
        ));
    }
    let known = names_in(sources, Harness::ClaudeCode, project);
    let mut report = McpStatusReport::default();
    let mut extras = Vec::new();
    for (name, target, status) in parse_claude_list(&out) {
        if known.contains(&name) {
            if let Some(status) = status {
                // A user-scope server reads the same in every project, so only
                // the home read speaks for it.
                let project_entry = project.is_some()
                    && sources.iter().any(|s| {
                        s.owner == Harness::ClaudeCode
                            && s.project.as_deref().map(Path::new) == project
                            && s.servers.iter().any(|e| e.name == name)
                    });
                if project.is_none() || project_entry {
                    report.statuses.push(McpStatusRow {
                        owner: Harness::ClaudeCode,
                        project: if project_entry {
                            project.map(|p| p.to_string_lossy().into_owned())
                        } else {
                            None
                        },
                        name,
                        status,
                    });
                }
            }
        } else if project.is_none() {
            extras.push((name, target, status));
        }
    }
    if !extras.is_empty() {
        let (plugins, connectors): (Vec<_>, Vec<_>) = extras
            .into_iter()
            .partition(|(name, _, _)| name.starts_with("plugin:"));
        for (label, group) in [
            ("From plugins", plugins),
            ("claude.ai connectors", connectors),
        ] {
            if group.is_empty() {
                continue;
            }
            report
                .statuses
                .extend(group.iter().filter_map(|(name, _, status)| {
                    Some(McpStatusRow {
                        owner: Harness::ClaudeCode,
                        project: None,
                        name: name.clone(),
                        status: (*status)?,
                    })
                }));
            report.extras.push(extra_source(
                Harness::ClaudeCode,
                label,
                group
                    .into_iter()
                    .map(|(name, target, _)| claude_extra(name, &target))
                    .collect(),
            ));
        }
    }
    Ok(report)
}

fn claude_extra(name: String, target: &str) -> McpServerEntry {
    let (target, transport) = if let Some(url) = target.strip_suffix(" (HTTP)") {
        (url, McpTransport::Http)
    } else if let Some(url) = target.strip_suffix(" (SSE)") {
        (url, McpTransport::Sse)
    } else if target.starts_with("http") {
        (target, McpTransport::Http)
    } else {
        (target, McpTransport::Stdio)
    };
    McpServerEntry {
        name,
        transport,
        command: (transport == McpTransport::Stdio).then(|| target.to_string()),
        args: Vec::new(),
        env: Vec::new(),
        url: (transport != McpTransport::Stdio).then(|| target.to_string()),
        headers: Vec::new(),
        enabled: true,
    }
}

fn extra_source(owner: Harness, label: &str, servers: Vec<McpServerEntry>) -> McpSource {
    McpSource {
        id: format!("{}:{label}", owner.wire_name()),
        file: None,
        owner,
        readers: vec![owner],
        project: None,
        path: String::new(),
        label: Some(label.to_string()),
        servers,
        error: None,
        transports: Vec::new(),
    }
}

fn parse_claude_list(out: &str) -> Vec<(String, String, Option<McpStatus>)> {
    out.lines()
        .filter_map(|line| {
            let (head, tail) = line.rsplit_once(" - ")?;
            let (name, target) = head.split_once(": ")?;
            let tail = tail.to_lowercase();
            let status = if tail.contains("connected") && !tail.contains("not connected") {
                Some(McpStatus::Connected)
            } else if tail.contains("auth") {
                Some(McpStatus::NeedsAuth)
            } else if tail.contains("disabled") {
                Some(McpStatus::Disabled)
            } else if tail.contains("fail") || tail.contains("error") {
                Some(McpStatus::Failed)
            } else {
                None
            };
            Some((name.trim().to_string(), target.trim().to_string(), status))
        })
        .collect()
}

#[derive(Deserialize)]
struct CodexListed {
    name: String,
    #[serde(default = "yes")]
    enabled: bool,
    #[serde(default)]
    auth_status: Option<String>,
    #[serde(default)]
    transport: Value,
}

/// `codex mcp list --json`. Codex does not connect to answer it, so what it
/// can say is auth and on/off, and the plugin servers no file here holds.
async fn codex_status(cwd: &Path, project: Option<&Path>, sources: &[McpSource]) -> Part {
    if !crate::binpath::agent_installed(Harness::Codex).await {
        return Ok(McpStatusReport::default());
    }
    let fail = |e: String| (Harness::Codex, e);
    let (ok, out, err) = run_cli(
        Harness::Codex,
        &["mcp", "list", "--json"],
        cwd,
        STATUS_TIMEOUT,
    )
    .await
    .map_err(|e| fail(format!("{e:#}")))?;
    if !ok {
        return Err((
            Harness::Codex,
            if err.trim().is_empty() { out } else { err },
        ));
    }
    let listed: Vec<CodexListed> =
        serde_json::from_str(&out).map_err(|e| fail(format!("couldn't read codex's list: {e}")))?;
    let known = names_in(sources, Harness::Codex, project);
    let mut report = McpStatusReport::default();
    let mut extras = Vec::new();
    for server in listed {
        let status = if !server.enabled {
            Some(McpStatus::Disabled)
        } else if server.auth_status.as_deref() == Some("not_logged_in") {
            Some(McpStatus::NeedsAuth)
        } else {
            None
        };
        let project_entry = sources.iter().any(|s| {
            s.owner == Harness::Codex
                && s.project.as_deref().map(Path::new) == project
                && s.servers.iter().any(|entry| entry.name == server.name)
        });
        if let Some(status) = status.filter(|_| project.is_none() || project_entry) {
            report.statuses.push(McpStatusRow {
                owner: Harness::Codex,
                project: project.map(|p| p.to_string_lossy().into_owned()),
                name: server.name.clone(),
                status,
            });
        }
        if project.is_none() && !known.contains(&server.name) {
            let t = &server.transport;
            let url = t.get("url").and_then(Value::as_str).map(str::to_string);
            extras.push(McpServerEntry {
                name: server.name,
                transport: if url.is_some() {
                    McpTransport::Http
                } else {
                    McpTransport::Stdio
                },
                command: t.get("command").and_then(Value::as_str).map(str::to_string),
                args: string_list(t.get("args")),
                env: Vec::new(),
                url,
                headers: Vec::new(),
                enabled: server.enabled,
            });
        }
    }
    if !extras.is_empty() {
        report
            .extras
            .push(extra_source(Harness::Codex, "From plugins", extras));
    }
    Ok(report)
}

/// grok's own list says on or off and no more; its `doctor` connects, but
/// reports in prose meant for a terminal.
async fn grok_status(home: &Path) -> Part {
    if !crate::binpath::agent_installed(Harness::Grok).await {
        return Ok(McpStatusReport::default());
    }
    let (ok, out, err) = run_cli(
        Harness::Grok,
        &["mcp", "list", "--json"],
        home,
        STATUS_TIMEOUT,
    )
    .await
    .map_err(|e| (Harness::Grok, format!("{e:#}")))?;
    if !ok {
        return Err((Harness::Grok, if err.trim().is_empty() { out } else { err }));
    }
    let listed: Vec<Value> = serde_json::from_str(&out)
        .map_err(|e| (Harness::Grok, format!("couldn't read grok's list: {e}")))?;
    let statuses = listed
        .iter()
        .filter(|s| s.get("enabled").and_then(Value::as_bool) == Some(false))
        .filter_map(|s| s.get("name").and_then(Value::as_str))
        .map(|name| McpStatusRow {
            owner: Harness::Grok,
            project: None,
            name: name.to_string(),
            status: McpStatus::Disabled,
        })
        .collect();
    Ok(McpStatusReport {
        statuses,
        ..Default::default()
    })
}

/// `fx mcp list`'s `auth=` field, the one fx answers without the network.
async fn fx_status(sources: &[McpSource]) -> Part {
    if !sources
        .iter()
        .any(|s| s.owner == Harness::Fx && !s.servers.is_empty())
    {
        return Ok(McpStatusReport::default());
    }
    let states = tokio::time::timeout(STATUS_TIMEOUT, crate::harness::fx::mcp::auth_states())
        .await
        .map_err(|_| (Harness::Fx, "fx took too long to answer".to_string()))?;
    let statuses = states
        .into_iter()
        .filter(|(_, auth)| auth == "required")
        .map(|(name, _)| McpStatusRow {
            owner: Harness::Fx,
            project: None,
            name,
            status: McpStatus::NeedsAuth,
        })
        .collect();
    Ok(McpStatusReport {
        statuses,
        ..Default::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stdio(name: &str) -> McpServerEntry {
        McpServerEntry {
            name: name.into(),
            transport: McpTransport::Stdio,
            command: Some("npx".into()),
            args: vec!["-y".into(), "pkg".into()],
            env: vec![KeyValue {
                name: "TOKEN".into(),
                value: "s3cret".into(),
            }],
            url: None,
            headers: Vec::new(),
            enabled: true,
        }
    }

    /// The three shapes `claude mcp list` was measured printing (2.1.318).
    #[test]
    fn reads_claude_list_lines() {
        let rows = parse_claude_list(
            "Checking MCP server health…\n\n\
             claude.ai Claude Docs: https://api.anthropic.com/v1/pages/mcp - ✔ Connected\n\
             plugin:figma:figma: https://mcp.figma.com/mcp (HTTP) - ! Needs authentication\n\
             rea: /opt/node /x/rea.mjs mcp - ✗ Failed to connect\n",
        );
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].0, "claude.ai Claude Docs");
        assert_eq!(rows[0].2, Some(McpStatus::Connected));
        assert_eq!(rows[1].0, "plugin:figma:figma");
        assert_eq!(rows[1].1, "https://mcp.figma.com/mcp (HTTP)");
        assert_eq!(rows[1].2, Some(McpStatus::NeedsAuth));
        assert_eq!(rows[2].2, Some(McpStatus::Failed));
        assert_eq!(claude_extra(rows[1].0.clone(), &rows[1].1).name, rows[1].0);
    }

    /// An edit keeps the reader's comments, their other servers and the keys
    /// this form does not draw.
    #[test]
    fn a_toml_edit_keeps_everything_it_does_not_own() {
        let mut doc: toml_edit::DocumentMut = "# mine\nmodel = \"x\"\n\n[mcp_servers.old]\ncommand = \"a\"\nstartup_timeout_sec = 30\n\n[mcp_servers.other]\nurl = \"https://o\"\n"
            .parse()
            .unwrap();
        toml_save(McpFile::Codex, &mut doc, Some("old"), &stdio("new")).unwrap();
        let text = doc.to_string();
        assert!(text.starts_with("# mine\nmodel = \"x\""));
        assert!(!text.contains("[mcp_servers.old]"));
        assert!(text.contains("[mcp_servers.new]"));
        assert!(text.contains("startup_timeout_sec = 30"));
        assert!(text.contains("[mcp_servers.other]"));
        let servers = toml_servers(McpFile::Codex, &text.parse().unwrap());
        let new = servers.iter().find(|s| s.name == "new").unwrap();
        assert_eq!(new.args, vec!["-y", "pkg"]);
        assert_eq!(
            new.env,
            vec![KeyValue {
                name: "TOKEN".into(),
                value: "s3cret".into()
            }]
        );
    }

    #[test]
    fn a_new_toml_server_lands_without_a_bare_header() {
        let mut doc: toml_edit::DocumentMut = "".parse().unwrap();
        let mut server = stdio("x");
        server.transport = McpTransport::Http;
        server.url = Some("https://x".into());
        server.headers = vec![KeyValue {
            name: "X-Key".into(),
            value: "v".into(),
        }];
        toml_save(McpFile::Codex, &mut doc, None, &server).unwrap();
        let text = doc.to_string();
        assert!(!text.contains("[mcp_servers]\n"));
        assert!(text.contains("http_headers"));
        assert!(!text.contains("command"));
    }

    #[test]
    fn switching_transport_drops_the_other_transports_fields() {
        let existing = json!({"type": "stdio", "command": "a", "args": [], "timeout": 5});
        let mut server = stdio("x");
        server.transport = McpTransport::Sse;
        server.url = Some("https://x".into());
        let merged = merged_json(Some(&existing), &server, true);
        assert_eq!(merged["type"], "sse");
        assert_eq!(merged["timeout"], 5);
        assert!(merged.get("command").is_none());
    }

    #[test]
    fn a_name_is_refused_only_when_it_changes() {
        let target = McpTarget {
            file: McpFile::ClaudeUser,
            project: None,
        };
        assert!(validate(&target, None, &stdio("bad name")).is_err());
        assert!(validate(&target, Some("bad name"), &stdio("bad name")).is_ok());
        let mut sse = stdio("ok");
        sse.transport = McpTransport::Sse;
        sse.url = Some("https://x".into());
        assert!(validate(
            &McpTarget {
                file: McpFile::Codex,
                project: None
            },
            None,
            &sse
        )
        .is_err());
    }

    #[test]
    fn reads_claude_local_scope_under_its_project() {
        let root = json!({"projects": {"/p": {"mcpServers": {"a": {"type": "http", "url": "https://a", "headers": {"Authorization": "Bearer t"}}}}}});
        let servers = json_servers(McpFile::ClaudeLocal, &root, Some(Path::new("/p")));
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].transport, McpTransport::Http);
        assert_eq!(servers[0].headers[0].value, "Bearer t");
    }

    #[test]
    fn codex_project_entries_use_the_same_headers_as_global_entries() {
        let project = Path::new("/project");
        assert_eq!(
            McpFile::CodexProject
                .path(Path::new("/home"), Some(project))
                .unwrap(),
            project.join(".codex/config.toml")
        );
        assert!(McpFile::CodexProject.per_project());
        let mut doc = "".parse().unwrap();
        let mut server = stdio("remote");
        server.transport = McpTransport::Http;
        server.url = Some("https://example.com/mcp".into());
        server.headers = vec![KeyValue {
            name: "Authorization".into(),
            value: "Bearer test".into(),
        }];
        toml_save(McpFile::CodexProject, &mut doc, None, &server).unwrap();
        assert_eq!(
            toml_servers(McpFile::CodexProject, &doc)[0].headers,
            server.headers
        );
        assert!(doc.to_string().contains("http_headers"));
    }

    #[test]
    fn duplicate_and_stale_edits_cannot_replace_a_different_server() {
        let text =
            "[mcp_servers.first]\ncommand = \"first\"\n[mcp_servers.taken]\ncommand = \"taken\"\n";
        let mut doc = text.parse().unwrap();
        assert!(toml_save(McpFile::Codex, &mut doc, Some("first"), &stdio("taken")).is_err());
        assert_eq!(doc.to_string(), text);
        assert!(toml_save(McpFile::Codex, &mut doc, Some("gone"), &stdio("new")).is_err());
        assert_eq!(doc.to_string(), text);
    }

    #[tokio::test]
    async fn malformed_config_is_reported_and_never_replaced() {
        let root = std::env::temp_dir().join(format!("carbon-mcp-{}", uuid::Uuid::now_v7()));
        tokio::fs::create_dir(&root).await.unwrap();
        let path = root.join("mcp.json");
        for text in [
            "broken json",
            "[]",
            "{\"mcp\": []}",
            "{\"mcp\": {\"invalid\": false}}",
        ] {
            tokio::fs::write(&path, text).await.unwrap();
            assert!(read_servers(McpFile::Fx, &path, None).await.is_err());
            if text == "broken json" {
                assert!(edit_json(&path, |root| fx_save(root, None, &stdio("new")))
                    .await
                    .is_err());
                assert_eq!(tokio::fs::read_to_string(&path).await.unwrap(), text);
            }
        }
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn edits_preserve_config_links_and_keep_new_secrets_private() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("carbon-mcp-{}", uuid::Uuid::now_v7()));
        tokio::fs::create_dir(&root).await.unwrap();
        let real = root.join("real.json");
        let link = root.join("linked.json");
        replace(&real, b"{}").await.unwrap();
        assert_eq!(
            tokio::fs::metadata(&real)
                .await
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        std::os::unix::fs::symlink(&real, &link).unwrap();
        edit_json(&link, |root| fx_save(root, None, &stdio("new")))
            .await
            .unwrap();
        assert!(tokio::fs::symlink_metadata(&link)
            .await
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(
            read_servers(McpFile::Fx, &link, None)
                .await
                .unwrap()
                .unwrap()[0]
                .env[0]
                .value,
            "s3cret"
        );
        assert_eq!(
            tokio::fs::metadata(&real)
                .await
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[test]
    fn fx_refuses_literal_authorization_and_invalid_config_roots() {
        let target = McpTarget {
            file: McpFile::Fx,
            project: None,
        };
        let mut server = stdio("remote");
        server.transport = McpTransport::Http;
        server.url = Some("https://example.com/mcp".into());
        server.headers = vec![KeyValue {
            name: "Authorization".into(),
            value: "Bearer test".into(),
        }];
        assert!(validate(&target, None, &server).is_err());
        let mut invalid = json!([]);
        assert!(fx_save(&mut invalid, None, &stdio("new")).is_err());
        assert_eq!(invalid, json!([]));
    }
}

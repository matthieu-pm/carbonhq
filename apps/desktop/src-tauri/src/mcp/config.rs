use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::Mutex;

use crate::harness::Harness;
use crate::mcp_servers::{KeyValue, McpFile, McpServerEntry, McpSource, McpTarget, McpTransport};

static LOCK: Mutex<()> = Mutex::const_new(());

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Definition {
    pub server: McpServerEntry,
    pub project: Option<String>,
    #[serde(default)]
    pub header_env: BTreeMap<String, String>,
    #[serde(default)]
    pub bearer_token_env: Option<String>,
    #[serde(default)]
    pub oauth: Option<Value>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub bearer_token_file: Option<String>,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Catalog {
    #[serde(default)]
    servers: Vec<Definition>,
    // Removed imports stay recorded so discovery cannot resurrect them.
    #[serde(default)]
    imported: BTreeSet<String>,
    #[serde(default)]
    signed_out: BTreeSet<String>,
    #[serde(skip)]
    errors: Vec<(String, String)>,
}

async fn path() -> Result<PathBuf> {
    Ok(crate::store::config_dir().await?.join("mcp.json"))
}

async fn read(path: &Path) -> Result<Catalog> {
    crate::store::read_json(path)
        .await
        .context("couldn't read Carbon's MCP settings")
}

fn write(path: &Path, catalog: &Catalog) -> Result<()> {
    crate::store::write_private_atomic(path, &serde_json::to_vec_pretty(catalog)?)?;
    Ok(())
}

/// Imports user definitions without changing any agent's own files.
async fn discover(catalog: &mut Catalog, home: &Path) -> Result<bool> {
    let projects: Vec<_> = crate::projects::list_projects()
        .await?
        .into_iter()
        .filter(|p| !p.path.starts_with("carbon://"))
        .map(|p| PathBuf::from(p.path))
        .collect();
    discover_at(catalog, home, &projects).await
}

async fn discover_at(catalog: &mut Catalog, home: &Path, projects: &[PathBuf]) -> Result<bool> {
    let mut changed = false;
    for file in McpFile::ALL {
        let scopes: Vec<_> = if file.per_project() {
            projects.iter().map(|p| Some(p.as_path())).collect()
        } else {
            vec![None]
        };
        for project in scopes {
            if project.is_some() && !trusted(file, home, project.unwrap()).await {
                continue;
            }
            let Some(path) = file.path(home, project) else {
                continue;
            };
            let loaded = async {
                let entries = crate::mcp_servers::read_servers(file, &path, project)
                    .await?
                    .unwrap_or_default();
                let raw = raw_table(file, &path, project).await?;
                Ok::<_, anyhow::Error>((entries, raw))
            }
            .await;
            let (entries, raw) = match loaded {
                Ok(loaded) => loaded,
                Err(error) => {
                    catalog
                        .errors
                        .push((path.to_string_lossy().into_owned(), format!("{error:#}")));
                    continue;
                }
            };
            let project = project.map(|p| p.to_string_lossy().into_owned());
            for server in entries {
                let inherited = server
                    .inherited
                    .then(|| {
                        catalog
                            .servers
                            .iter()
                            .find(|d| d.project.is_none() && d.server.name == server.name)
                            .cloned()
                    })
                    .flatten();
                if server.inherited && inherited.is_none() {
                    continue;
                }
                let source = format!(
                    "{}\n{}\n{}",
                    path.display(),
                    project.as_deref().unwrap_or(""),
                    server.name
                );
                if !catalog.imported.insert(source) {
                    if let Some(existing) = catalog.servers.iter_mut().find(|definition| {
                        definition.project == project
                            && definition.server.name == server.name
                            && definition.server.command == server.command
                    }) {
                        changed |= resolve_codex_helper(file, home, existing).await;
                    }
                    continue;
                }
                changed = true;
                if catalog
                    .servers
                    .iter()
                    .any(|d| d.project == project && d.server.name == server.name)
                {
                    continue;
                }
                if let Some(mut inherited) = inherited {
                    inherited.project = project.clone();
                    inherited.server.enabled = server.enabled;
                    catalog.servers.push(inherited);
                    continue;
                }
                let entry = raw.get(&server.name).cloned().unwrap_or_default();
                let mut definition = Definition {
                    header_env: string_map(
                        entry
                            .get("header_env")
                            .or_else(|| entry.get("env_http_headers")),
                    ),
                    bearer_token_env: entry
                        .get("bearer_token_env")
                        .or_else(|| entry.get("bearer_token_env_var"))
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    bearer_token_file: entry
                        .get("bearer_token_file")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    cwd: entry.get("cwd").and_then(Value::as_str).map(str::to_string),
                    oauth: entry.get("oauth").cloned(),
                    server,
                    project: project.clone(),
                };
                resolve_codex_helper(file, home, &mut definition).await;
                catalog.servers.push(definition);
            }
        }
    }
    Ok(changed)
}

/// Codex launches its bundled helper from the installation, not the chat's directory.
async fn resolve_codex_helper(file: McpFile, home: &Path, definition: &mut Definition) -> bool {
    const COMMAND: &str = "./Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient";
    if file != McpFile::Codex
        || definition.project.is_some()
        || definition.server.command.as_deref() != Some(COMMAND)
        || !matches!(definition.cwd.as_deref(), None | Some("."))
    {
        return false;
    }
    let installed = home.join(".codex/computer-use");
    if !installed.join(COMMAND).is_file() {
        return false;
    }
    definition.cwd = Some(installed.to_string_lossy().into_owned());
    true
}

async fn raw_table(
    file: McpFile,
    path: &Path,
    project: Option<&Path>,
) -> Result<BTreeMap<String, Value>> {
    let text = match tokio::fs::read_to_string(path).await {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(BTreeMap::new()),
        Err(e) => return Err(e.into()),
    };
    if text.trim().is_empty() {
        return Ok(BTreeMap::new());
    }
    let root: Value = if matches!(
        file,
        McpFile::Codex | McpFile::CodexProject | McpFile::GrokUser | McpFile::GrokProject
    ) {
        let doc: toml_edit::DocumentMut = text.parse()?;
        let Some(table) = doc.get("mcp_servers").and_then(|v| v.as_table_like()) else {
            return Ok(BTreeMap::new());
        };
        return Ok(table
            .iter()
            .map(|(name, item)| {
                let mut fields = serde_json::Map::new();
                if let Some(entry) = item.as_table_like() {
                    for key in [
                        "bearer_token_env",
                        "bearer_token_env_var",
                        "bearer_token_file",
                        "cwd",
                        "header_env",
                        "env_http_headers",
                    ] {
                        if let Some(value) = entry.get(key) {
                            if let Some(s) = value.as_str() {
                                fields.insert(key.into(), Value::String(s.into()));
                            }
                            if let Some(t) = value.as_table_like() {
                                fields.insert(
                                    key.into(),
                                    Value::Object(
                                        t.iter()
                                            .filter_map(|(k, v)| {
                                                v.as_str()
                                                    .map(|s| (k.into(), Value::String(s.into())))
                                            })
                                            .collect(),
                                    ),
                                );
                            }
                        }
                    }
                }
                (name.into(), Value::Object(fields))
            })
            .collect());
    } else {
        serde_json::from_str(&text)?
    };
    if file == McpFile::ClaudeLocal {
        return Ok(root
            .get("projects")
            .and_then(|projects| project.and_then(|p| projects.get(p.to_string_lossy().as_ref())))
            .and_then(|p| p.get("mcpServers"))
            .and_then(Value::as_object)
            .map(|t| t.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
            .unwrap_or_default());
    }
    let table = root
        .get("mcpServers")
        .or_else(|| (file == McpFile::Fx).then(|| root.get("mcp")).flatten());
    Ok(table
        .and_then(Value::as_object)
        .map(|t| t.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default())
}

fn string_map(value: Option<&Value>) -> BTreeMap<String, String> {
    value
        .and_then(Value::as_object)
        .map(|t| {
            t.iter()
                .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.into())))
                .collect()
        })
        .unwrap_or_default()
}

/// A repository cannot gain permission to execute commands merely by being discovered.
async fn trusted(file: McpFile, home: &Path, project: &Path) -> bool {
    match file {
        McpFile::GrokProject => {
            if !project.join(".grok/config.toml").is_file() {
                return false;
            }
            let bin = crate::binpath::grok().await;
            let output = tokio::time::timeout(
                std::time::Duration::from_secs(10),
                tokio::process::Command::new(&bin)
                    .args(["inspect", "--json"])
                    .env("GROK_DISABLE_AUTOUPDATER", "1")
                    .env("PATH", crate::harness::agent_path(&bin))
                    .current_dir(project)
                    .stdin(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .kill_on_drop(true)
                    .output(),
            )
            .await;
            match output {
                Ok(Ok(output)) if output.status.success() => {
                    serde_json::from_slice::<Value>(&output.stdout)
                        .ok()
                        .and_then(|v| v.get("projectTrusted").and_then(Value::as_bool))
                        == Some(true)
                }
                _ => false,
            }
        }
        McpFile::ClaudeLocal => true,
        McpFile::ClaudeProject => {
            let root: Value = match tokio::fs::read(home.join(".claude.json"))
                .await
                .ok()
                .and_then(|b| serde_json::from_slice(&b).ok())
            {
                Some(root) => root,
                None => return false,
            };
            root.get("projects")
                .and_then(|p| p.get(project.to_string_lossy().as_ref()))
                .and_then(|p| p.get("hasTrustDialogAccepted"))
                .and_then(Value::as_bool)
                == Some(true)
        }
        McpFile::CodexProject => {
            let text = tokio::fs::read_to_string(home.join(".codex/config.toml"))
                .await
                .unwrap_or_default();
            let Ok(doc) = text.parse::<toml_edit::DocumentMut>() else {
                return false;
            };
            doc.get("projects")
                .and_then(|p| p.get(project.to_string_lossy().as_ref()))
                .and_then(|p| p.get("trust_level"))
                .and_then(|v| v.as_str())
                == Some("trusted")
        }
        McpFile::PiProject => {
            let root: Value = match tokio::fs::read(home.join(".pi/agent/trust.json"))
                .await
                .ok()
                .and_then(|b| serde_json::from_slice(&b).ok())
            {
                Some(root) => root,
                None => return false,
            };
            project
                .ancestors()
                .find_map(|p| {
                    root.get(p.to_string_lossy().as_ref())
                        .and_then(Value::as_bool)
                })
                .unwrap_or(false)
        }
        _ => false,
    }
}

async fn catalog() -> Result<Catalog> {
    let _guard = LOCK.lock().await;
    let _across = crate::store::lock_across_processes("mcp.json").await;
    let path = path().await?;
    let mut catalog = read(&path).await?;
    let home = std::env::home_dir().context("couldn't find your home directory")?;
    if discover(&mut catalog, &home).await? {
        write(&path, &catalog)?;
    }
    Ok(catalog)
}

/// One definition per name, with this project's overrides applied for every agent.
pub async fn effective(cwd: &str) -> Result<Vec<Definition>> {
    let catalog = catalog().await?;
    let projects = crate::projects::list_projects().await?;
    let scope = projects
        .iter()
        .map(|p| p.path.as_str())
        .filter(|root| cwd.starts_with(&format!("{root}/.claude/worktrees/")))
        .max_by_key(|root| root.len())
        .unwrap_or(cwd);
    Ok(select(catalog.servers, scope)
        .into_iter()
        .filter(|d| {
            d.server.enabled
                && !d
                    .server
                    .url
                    .as_ref()
                    .is_some_and(|url| catalog.signed_out.contains(url))
        })
        .collect())
}

/// Native names must be overridden too, or an agent can revive a removed import.
pub async fn native(harness: Harness, cwd: &str) -> Result<BTreeMap<String, McpServerEntry>> {
    let home = std::env::home_dir().context("couldn't find your home directory")?;
    let mut servers = BTreeMap::new();
    for per_project in [false, true] {
        for file in McpFile::ALL.into_iter().filter(|f| {
            f.per_project() == per_project
                && (f.readers().contains(&harness)
                    || harness == Harness::Fx && *f == McpFile::ClaudeProject)
        }) {
            let project = per_project.then(|| Path::new(cwd));
            let Some(path) = file.path(&home, project) else {
                continue;
            };
            for server in crate::mcp_servers::read_servers(file, &path, project)
                .await?
                .unwrap_or_default()
            {
                servers.insert(server.name.clone(), server);
            }
        }
    }
    Ok(servers)
}

fn select(definitions: Vec<Definition>, cwd: &str) -> Vec<Definition> {
    let mut selected = BTreeMap::new();
    for definition in definitions.iter().filter(|d| d.project.is_none()) {
        selected.insert(definition.server.name.clone(), definition.clone());
    }
    for definition in definitions
        .into_iter()
        .filter(|d| d.project.as_deref() == Some(cwd))
    {
        selected.insert(definition.server.name.clone(), definition);
    }
    selected.into_values().collect()
}

/// Settings and every composer's picker read the same Carbon-owned catalog.
pub async fn sources() -> Result<Vec<McpSource>> {
    let catalog = catalog().await?;
    let path = path().await?;
    let mut groups: BTreeMap<Option<String>, Vec<McpServerEntry>> = BTreeMap::new();
    groups.insert(None, Vec::new());
    for definition in catalog.servers {
        groups
            .entry(definition.project)
            .or_default()
            .push(definition.server);
    }
    let mut sources: Vec<_> = groups
        .into_iter()
        .map(|(project, mut servers)| {
            servers.sort_by(|a, b| a.name.cmp(&b.name));
            McpSource {
                id: format!("carbon:{}", project.as_deref().unwrap_or("")),
                file: Some(McpFile::Carbon),
                owner: Harness::ClaudeCode,
                readers: Harness::ALL.to_vec(),
                project,
                path: path.to_string_lossy().into_owned(),
                label: Some("Carbon".into()),
                servers,
                error: None,
                transports: vec![McpTransport::Stdio, McpTransport::Http, McpTransport::Sse],
            }
        })
        .collect();
    for (path, error) in catalog.errors {
        sources.push(McpSource {
            id: format!("error:{path}"),
            path,
            file: None,
            owner: Harness::ClaudeCode,
            readers: Vec::new(),
            project: None,
            label: Some("Couldn't read MCP settings".into()),
            servers: Vec::new(),
            error: Some(error),
            transports: Vec::new(),
        });
    }
    Ok(sources)
}

/// Edits the proxy's definition while preserving imported environment references.
pub async fn save(
    target: McpTarget,
    original: Option<String>,
    mut server: McpServerEntry,
) -> Result<()> {
    crate::mcp_servers::validate(&target, original.as_deref(), &server)?;
    if let Some(project) = &target.project {
        if !crate::projects::list_projects()
            .await?
            .iter()
            .any(|p| &p.path == project)
        {
            bail!("choose an attached local project");
        }
    }
    let _guard = LOCK.lock().await;
    let _across = crate::store::lock_across_processes("mcp.json").await;
    let path = path().await?;
    let mut catalog = read(&path).await?;
    server.name = server.name.trim().into();
    if catalog.servers.iter().any(|d| {
        d.project == target.project
            && d.server.name == server.name
            && original.as_deref() != Some(&server.name)
    }) {
        bail!("a server named {} already exists", server.name);
    }
    let old = original.as_ref().and_then(|name| {
        catalog
            .servers
            .iter()
            .position(|d| d.project == target.project && &d.server.name == name)
    });
    if let Some(index) = old {
        if catalog.servers[index].server.url != server.url {
            catalog.servers[index].header_env.clear();
            catalog.servers[index].bearer_token_env = None;
            catalog.servers[index].bearer_token_file = None;
            catalog.servers[index].oauth = None;
        }
        catalog.servers[index].server = server;
    } else {
        catalog.servers.push(Definition {
            server,
            project: target.project,
            header_env: BTreeMap::new(),
            bearer_token_env: None,
            oauth: None,
            cwd: None,
            bearer_token_file: None,
        });
    }
    write(&path, &catalog)
}

/// Keeps the discovery tombstone when a user removes an imported server.
pub async fn remove(target: McpTarget, name: String) -> Result<()> {
    let _guard = LOCK.lock().await;
    let _across = crate::store::lock_across_processes("mcp.json").await;
    let path = path().await?;
    let mut catalog = read(&path).await?;
    let removed_url = catalog
        .servers
        .iter()
        .find(|d| d.project == target.project && d.server.name == name)
        .and_then(|d| d.server.url.clone());
    catalog
        .servers
        .retain(|d| d.project != target.project || d.server.name != name);
    write(&path, &catalog)?;
    drop(_across);
    drop(_guard);
    if let Some(url) = removed_url.filter(|url| {
        !catalog
            .servers
            .iter()
            .any(|d| d.server.url.as_ref() == Some(url))
    }) {
        super::auth::clear(&url).await?;
    }
    Ok(())
}

/// Finds a settings row without treating a signed-out server as absent.
pub async fn find(target: &McpTarget, name: &str) -> Result<Definition> {
    catalog()
        .await?
        .servers
        .into_iter()
        .find(|d| d.project == target.project && d.server.name == name)
        .ok_or_else(|| anyhow!("{name} is no longer configured"))
}

/// Status includes signed-out and disabled entries so Settings can reconnect them.
pub async fn definitions() -> Result<Vec<(Definition, bool)>> {
    let catalog = catalog().await?;
    Ok(catalog
        .servers
        .into_iter()
        .map(|d| {
            let signed_out = d
                .server
                .url
                .as_ref()
                .is_some_and(|url| catalog.signed_out.contains(url));
            (d, signed_out)
        })
        .collect())
}

/// Sign-out also withholds static credentials from new agent sessions.
pub async fn signed_out(url: &str, value: bool) -> Result<()> {
    let _guard = LOCK.lock().await;
    let _across = crate::store::lock_across_processes("mcp.json").await;
    let path = path().await?;
    let mut catalog = read(&path).await?;
    if value {
        catalog.signed_out.insert(url.into());
    } else {
        catalog.signed_out.remove(url);
    }
    write(&path, &catalog)
}

/// Resolves only variable names, including Dock launches that lack shell exports.
pub async fn env(name: &str) -> Result<String> {
    if name.is_empty()
        || name.starts_with(|c: char| c.is_ascii_digit())
        || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
    {
        bail!("invalid environment variable name");
    }
    if let Ok(value) = std::env::var(name) {
        return Ok(value);
    }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        tokio::process::Command::new(shell)
            .args(["-l", "-c", &format!("printenv {name}")])
            .kill_on_drop(true)
            .output(),
    )
    .await??;
    if !output.status.success() {
        bail!("environment variable {name} is not set");
    }
    String::from_utf8(output.stdout)?
        .lines()
        .last()
        .map(str::to_string)
        .ok_or_else(|| anyhow!("environment variable {name} is empty"))
}

/// Expands the config syntax without handing user values to a shell.
pub async fn expand(value: &str) -> Result<String> {
    let mut out = String::new();
    let mut rest = value;
    while let Some(start) = rest.find("${") {
        out.push_str(&rest[..start]);
        let end = rest[start + 2..]
            .find('}')
            .context("unclosed environment variable")?
            + start
            + 2;
        let expression = &rest[start + 2..end];
        let (name, default) = expression
            .split_once(":-")
            .map_or((expression, None), |(n, d)| (n, Some(d)));
        let name = name.strip_prefix("env:").unwrap_or(name);
        match env(name).await {
            Ok(value) => out.push_str(&value),
            Err(_) if default.is_some() => out.push_str(default.unwrap()),
            Err(error) => return Err(error),
        }
        rest = &rest[end + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

/// Headers come from MCP config and its own OAuth grant, never Carbon's tracker keys.
pub async fn headers(definition: &Definition) -> Result<reqwest::header::HeaderMap> {
    let mut headers = reqwest::header::HeaderMap::new();
    let oauth = match &definition.server.url {
        Some(url) => super::auth::access_token(url).await?,
        None => None,
    };
    for KeyValue { name, value } in &definition.server.headers {
        if name.eq_ignore_ascii_case("authorization") && oauth.is_some() {
            continue;
        }
        headers.insert(
            reqwest::header::HeaderName::from_bytes(name.as_bytes())?,
            expand(value).await?.parse()?,
        );
    }
    for (name, variable) in &definition.header_env {
        if name.eq_ignore_ascii_case("authorization") && oauth.is_some() {
            continue;
        }
        headers.insert(
            reqwest::header::HeaderName::from_bytes(name.as_bytes())?,
            env(variable).await?.parse()?,
        );
    }
    if let Some(token) = oauth {
        headers.insert(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {token}").parse()?,
        );
    } else if let Some(variable) = &definition.bearer_token_env {
        headers.insert(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {}", env(variable).await?).parse()?,
        );
    } else if let Some(path) = &definition.bearer_token_file {
        let path = expand(path).await?;
        let path = path
            .strip_prefix("~/")
            .and_then(|rest| std::env::home_dir().map(|home| home.join(rest)))
            .unwrap_or_else(|| PathBuf::from(&path));
        let token = tokio::fs::read_to_string(path).await?;
        headers.insert(
            reqwest::header::AUTHORIZATION,
            format!("Bearer {}", token.trim()).parse()?,
        );
    }
    Ok(headers)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn root() -> PathBuf {
        let root = std::env::temp_dir().join(format!("carbon-mcp-import-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&root).await.unwrap();
        root
    }

    #[tokio::test]
    async fn discovery_is_automatic_deterministic_and_does_not_revive_removed_servers() {
        let root = root().await;
        tokio::fs::create_dir_all(root.join(".codex"))
            .await
            .unwrap();
        tokio::fs::create_dir_all(root.join(".grok")).await.unwrap();
        let original = r#"{"mcpServers":{"docs":{"url":"https://first.example/mcp"}}}"#;
        tokio::fs::write(root.join(".claude.json"), original)
            .await
            .unwrap();
        tokio::fs::write(root.join(".codex/config.toml"), "[mcp_servers.docs]\nurl='https://second.example/mcp'\n[mcp_servers.other]\nurl='https://other.example/mcp'\nbearer_token_env_var='MCP_TOKEN'\n").await.unwrap();
        tokio::fs::write(root.join(".grok/config.toml"), "invalid TOML = [")
            .await
            .unwrap();
        let mut catalog = Catalog::default();
        assert!(discover_at(&mut catalog, &root, &[]).await.unwrap());
        assert_eq!(catalog.servers.len(), 2);
        assert_eq!(
            catalog.servers[0].server.url.as_deref(),
            Some("https://first.example/mcp")
        );
        assert_eq!(
            catalog.servers[1].bearer_token_env.as_deref(),
            Some("MCP_TOKEN")
        );
        assert_eq!(catalog.errors.len(), 1);
        catalog.servers.retain(|d| d.server.name != "docs");
        assert!(!discover_at(&mut catalog, &root, &[]).await.unwrap());
        assert_eq!(catalog.servers.len(), 1);
        assert_eq!(
            tokio::fs::read_to_string(root.join(".claude.json"))
                .await
                .unwrap(),
            original
        );
        let path = root.join("carbon-mcp.json");
        write(&path, &catalog).unwrap();
        let mut restored = read(&path).await.unwrap();
        assert!(!discover_at(&mut restored, &root, &[]).await.unwrap());
        assert_eq!(restored.servers.len(), 1);
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn codex_computer_use_keeps_its_installed_working_directory() {
        let root = root().await;
        let installed = root.join(".codex/computer-use");
        let command = "./Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient";
        let executable = installed.join(command);
        tokio::fs::create_dir_all(executable.parent().unwrap())
            .await
            .unwrap();
        tokio::fs::write(&executable, "fixture").await.unwrap();
        let path = root.join(".codex/config.toml");
        tokio::fs::write(
            &path,
            format!("[mcp_servers.computer-use]\ncommand={command:?}\ncwd='.'\nenabled=false\n"),
        )
        .await
        .unwrap();
        let mut catalog = Catalog::default();
        assert!(discover_at(&mut catalog, &root, &[]).await.unwrap());
        assert_eq!(catalog.servers[0].cwd.as_deref(), installed.to_str());
        assert!(!catalog.servers[0].server.enabled);

        catalog.servers[0].cwd = Some(".".into());
        catalog.servers[0].server.enabled = true;
        assert!(discover_at(&mut catalog, &root, &[]).await.unwrap());
        assert_eq!(catalog.servers[0].cwd.as_deref(), installed.to_str());
        assert!(catalog.servers[0].server.enabled);

        catalog.servers[0].cwd = Some("/custom-helper".into());
        assert!(!discover_at(&mut catalog, &root, &[]).await.unwrap());
        assert_eq!(catalog.servers[0].cwd.as_deref(), Some("/custom-helper"));
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn repository_commands_are_imported_only_after_existing_trust() {
        let root = root().await;
        let project = root.join("project");
        tokio::fs::create_dir_all(&project).await.unwrap();
        tokio::fs::write(
            project.join(".mcp.json"),
            r#"{"mcpServers":{"local":{"command":"run-project-code"}}}"#,
        )
        .await
        .unwrap();
        let mut catalog = Catalog::default();
        discover_at(&mut catalog, &root, &[project.clone()])
            .await
            .unwrap();
        assert!(catalog.servers.is_empty());
        tokio::fs::write(root.join(".claude.json"), serde_json::to_vec(&serde_json::json!({"projects":{project.to_string_lossy().as_ref():{"hasTrustDialogAccepted":true}}})).unwrap()).await.unwrap();
        discover_at(&mut catalog, &root, &[project.clone()])
            .await
            .unwrap();
        assert_eq!(catalog.servers.len(), 1);
        assert_eq!(
            catalog.servers[0].project.as_deref(),
            Some(project.to_str().unwrap())
        );
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[test]
    fn a_disabled_project_definition_withholds_the_global_server() {
        let mut global = crate::mcp::tests::stdio();
        global.server.name = "browser".into();
        let mut project = global.clone();
        project.project = Some("/project".into());
        project.server.enabled = false;
        let selected = select(vec![global.clone(), project], "/project");
        assert_eq!(selected.len(), 1);
        assert!(!selected[0].server.enabled);
        assert!(select(vec![global], "/elsewhere")[0].server.enabled);
    }
}

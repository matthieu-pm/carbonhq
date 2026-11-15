//! Which ACP agents Carbon can run, which the reader switched on, and how to start
//! each.
//!
//! The list is the ACP registry's (`REGISTRY_URL`), read once a day and kept on
//! disk, with a snapshot compiled in for a first launch offline. Beside it are
//! the reader's own custom agents — any command that speaks ACP over stdio.
//!
//! Registry packages run through `npx` or `uvx` and may download on first use.
//! Binary entries use an installed executable; an override can name its real
//! location when the registry names a path inside a vendor archive.

use crate::harness::{intern, Harness};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::{Arc, LazyLock, RwLock};
use std::time::{Duration, Instant, SystemTime};
use ts_rs::TS;

const REGISTRY_URL: &str = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const SNAPSHOT: &str = include_str!("registry.json");
/// How old the cached registry may get before a read refreshes it.
const STALE_AFTER: Duration = Duration::from_secs(24 * 60 * 60);
const FETCH_TIMEOUT: Duration = Duration::from_secs(10);

/// Registry entries that are Carbon's native harnesses through an adapter. The
/// native ones carry worktrees, fork and fast mode; two rows called Claude
/// would only say the same thing worse.
const HIDDEN: [&str; 4] = ["claude-acp", "codex-acp", "pi-acp", "grok-build"];

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Registry {
    #[serde(default)]
    agents: Vec<RegistryAgent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RegistryAgent {
    id: String,
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    website: Option<String>,
    #[serde(default)]
    icon: Option<String>,
    #[serde(default)]
    distribution: Distribution,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Distribution {
    /// By `<os>-<arch>`, `darwin-aarch64` and friends.
    #[serde(default)]
    binary: Option<HashMap<String, BinaryTarget>>,
    #[serde(default)]
    npx: Option<Package>,
    #[serde(default)]
    uvx: Option<Package>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BinaryTarget {
    /// A path inside the archive, `./bin/devin`. Its file name is what is
    /// looked up on this machine.
    cmd: String,
    #[serde(default)]
    args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Package {
    /// Pinned, `@google/gemini-cli@0.64.0`, so the agent `npx` runs is the one
    /// the registry vouched for.
    package: String,
    #[serde(default)]
    args: Vec<String>,
}

/// An agent the reader added by hand: any command speaking ACP over stdio.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct CustomAgent {
    /// Lowercase letters, digits and dashes. Also its harness name, `acp:<id>`.
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

/// `acp-agents.json`. Its own file rather than a field on `settings.json`,
/// which every build rewrites whole through its own struct — an older build
/// would drop this list on its next unrelated toggle.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Prefs {
    #[serde(default)]
    enabled: Vec<String>,
    #[serde(default)]
    custom: Vec<CustomAgent>,
    #[serde(default)]
    executables: BTreeMap<String, String>,
}

/// One row of Settings → Agents.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct AcpAgent {
    pub harness: Harness,
    pub id: String,
    pub name: String,
    pub description: String,
    pub website: Option<String>,
    pub icon: Option<String>,
    pub enabled: bool,
    pub custom: bool,
    pub installed: bool,
    pub ready: bool,
    pub supported: bool,
    pub executable: String,
    pub args: Vec<String>,
    pub package: Option<String>,
    pub runner: Option<String>,
    pub overridden: bool,
    /// The command as a reader would type it, for the row's own line.
    pub command: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
pub struct AcpAgentCatalog {
    pub agents: Vec<AcpAgent>,
    pub error: Option<String>,
}

/// How to start one agent.
#[derive(Debug, Clone)]
pub struct Launch {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
}

static REGISTRY: LazyLock<RwLock<Option<Arc<Registry>>>> = LazyLock::new(Default::default);
/// Display names by id, readable from sync code — [`Harness::label`] is.
static NAMES: LazyLock<RwLock<HashMap<String, &'static str>>> = LazyLock::new(Default::default);
static REGISTRY_ERROR: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);
static PREFS_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// The agent's display name, or its id where nothing has been read yet.
pub fn name_of(id: &str) -> &'static str {
    if let Some(name) = NAMES.read().unwrap().get(id) {
        return name;
    }
    intern(id)
}

fn remember_names<'a>(pairs: impl Iterator<Item = (&'a str, &'a str)>) {
    let mut names = NAMES.write().unwrap();
    for (id, name) in pairs {
        names.insert(id.to_string(), intern(name));
    }
}

/// The registry this process works from: the cached copy, else the snapshot.
/// A stale or absent cache starts a refresh behind the answer rather than in
/// front of it, so a launch offline never waits on the network.
async fn registry() -> Arc<Registry> {
    if let Some(hit) = REGISTRY.read().unwrap().clone() {
        // A server runs for days, so freshness is asked again here too, and a
        // failed fetch is retried a day later rather than never.
        if LAST_TRY
            .lock()
            .unwrap()
            .is_some_and(|at| at.elapsed() >= STALE_AFTER)
        {
            refresh_behind();
        }
        return hit;
    }

    let path = cache_path().await.ok();
    let cached = match &path {
        Some(path) => crate::store::read_json::<Registry>(path).await.ok(),
        None => None,
    }
    .filter(|r| !r.agents.is_empty());
    let fresh = match &path {
        Some(path) => tokio::fs::metadata(path)
            .await
            .and_then(|m| m.modified())
            .ok()
            .and_then(|at| SystemTime::now().duration_since(at).ok())
            .is_some_and(|age| age < STALE_AFTER),
        None => false,
    };

    let registry = Arc::new(cached.unwrap_or_else(|| {
        serde_json::from_str(SNAPSHOT).expect("the bundled registry snapshot parses")
    }));
    install(registry.clone());

    if fresh {
        *LAST_TRY.lock().unwrap() = Some(Instant::now());
    } else {
        refresh_behind();
    }
    registry
}

/// When the registry was last fetched or found fresh.
static LAST_TRY: std::sync::Mutex<Option<Instant>> = std::sync::Mutex::new(None);

fn refresh_behind() {
    *LAST_TRY.lock().unwrap() = Some(Instant::now());
    tokio::spawn(async {
        if let Err(err) = refresh().await {
            *REGISTRY_ERROR.lock().unwrap() = Some(format!(
                "Could not refresh the agent catalog. Showing the saved list. {err:#}"
            ));
        }
    });
}

fn install(registry: Arc<Registry>) {
    remember_names(
        registry
            .agents
            .iter()
            .map(|a| (a.id.as_str(), a.name.as_str())),
    );
    *REGISTRY.write().unwrap() = Some(registry);
}

/// Fetches the registry and keeps it. A failed fetch leaves what was there.
async fn refresh() -> Result<()> {
    let body = reqwest::Client::new()
        .get(REGISTRY_URL)
        .timeout(FETCH_TIMEOUT)
        .send()
        .await
        .context("asking the ACP registry for its agents")?
        .error_for_status()
        .context("the ACP registry refused the request")?
        .text()
        .await?;
    let registry: Registry = serde_json::from_str(&body).context("reading the ACP registry")?;
    if registry.agents.is_empty() {
        bail!("the ACP registry listed no agents");
    }
    crate::store::write_atomic(&cache_path().await?, serde_json::to_vec(&registry)?).await?;
    install(Arc::new(registry));
    *REGISTRY_ERROR.lock().unwrap() = None;
    Ok(())
}

async fn cache_path() -> Result<PathBuf> {
    Ok(crate::store::config_dir().await?.join("acp-registry.json"))
}

async fn prefs_path() -> Result<PathBuf> {
    Ok(crate::store::config_dir().await?.join("acp-agents.json"))
}

async fn read_prefs() -> Result<Prefs> {
    let path = prefs_path().await?;
    let prefs: Prefs = match tokio::fs::read(&path).await {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).context("reading the saved agent configuration")?
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Prefs::default(),
        Err(error) => return Err(error).context("reading the saved agent configuration"),
    };
    remember_names(
        prefs
            .custom
            .iter()
            .map(|c| (c.id.as_str(), c.name.as_str())),
    );
    Ok(prefs)
}

/// Read, edit, write under both locks — the app and its background server both
/// write this file.
async fn update_prefs(edit: impl FnOnce(&mut Prefs) -> Result<()>) -> Result<()> {
    let _held = PREFS_LOCK.lock().await;
    let _across = crate::store::lock_across_processes("acp-agents").await;
    let mut prefs = read_prefs().await?;
    edit(&mut prefs)?;
    crate::store::write_atomic(&prefs_path().await?, serde_json::to_vec_pretty(&prefs)?).await
}

/// This machine's key into a registry entry's `binary` map.
fn platform() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Some("darwin-aarch64"),
        ("macos", "x86_64") => Some("darwin-x86_64"),
        ("linux", "aarch64") => Some("linux-aarch64"),
        ("linux", "x86_64") => Some("linux-x86_64"),
        _ => None,
    }
}

/// The program and args an entry starts with, before resolving the program.
/// A binary is preferred where it ships for this platform: it is what the
/// vendor's own installer puts on `PATH`, where `npx` would fetch a second copy.
fn recipe(agent: &RegistryAgent) -> Option<(String, Vec<String>)> {
    if let Some(target) = platform().and_then(|p| agent.distribution.binary.as_ref()?.get(p)) {
        let name = std::path::Path::new(&target.cmd)
            .file_name()?
            .to_str()?
            .to_string();
        return Some((name, target.args.clone()));
    }
    for (runner, package) in [
        ("npx", &agent.distribution.npx),
        ("uvx", &agent.distribution.uvx),
    ] {
        if let Some(package) = package {
            // `-y` so `npx` never stops to ask whether it may install — there is
            // no terminal behind this pipe to answer it.
            let mut args = match runner {
                "npx" => vec!["-y".to_string(), package.package.clone()],
                _ => vec![package.package.clone()],
            };
            args.extend(package.args.iter().cloned());
            return Some((runner.to_string(), args));
        }
    }
    None
}

fn command_line(program: &str, args: &[String]) -> String {
    std::iter::once(program)
        .chain(args.iter().map(String::as_str))
        .map(|part| {
            if part.chars().any(char::is_whitespace) {
                format!("{part:?}")
            } else {
                part.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn command_found(program: &str) -> bool {
    let path = std::path::Path::new(program);
    if path.is_absolute() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            return std::fs::metadata(path).is_ok_and(|metadata| {
                metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
            });
        }
        #[cfg(not(unix))]
        return path.is_file();
    }
    crate::binpath::acp_agent_found(program)
}

fn registry_recipe(
    agent: &RegistryAgent,
    override_command: Option<&String>,
) -> Option<(String, Vec<String>, Option<String>, Option<String>)> {
    let (program, args) =
        recipe(agent).or_else(|| override_command.map(|command| (command.clone(), Vec::new())))?;
    let package = match program.as_str() {
        "npx" => agent.distribution.npx.as_ref(),
        "uvx" => agent.distribution.uvx.as_ref(),
        _ => None,
    };
    if let Some(command) = override_command {
        let args = package.map(|p| p.args.clone()).unwrap_or(args);
        return Some((command.clone(), args, None, None));
    }
    let package_name = package.map(|p| p.package.clone());
    let runner = package.map(|_| program.clone());
    Some((program, args, package_name, runner))
}

fn rows(registry: &Registry, prefs: &Prefs) -> Vec<AcpAgent> {
    let enabled = |id: &str| prefs.enabled.iter().any(|e| e == id);
    let custom = prefs.custom.iter().map(|c| {
        let ready = command_found(&c.command);
        AcpAgent {
            harness: Harness::Acp(intern(&c.id)),
            id: c.id.clone(),
            name: c.name.clone(),
            description: String::new(),
            website: None,
            icon: None,
            enabled: enabled(&c.id),
            custom: true,
            installed: ready,
            ready,
            supported: true,
            executable: c.command.clone(),
            args: c.args.clone(),
            package: None,
            runner: None,
            overridden: false,
            command: command_line(&c.command, &c.args),
        }
    });
    let listed = registry
        .agents
        .iter()
        .filter(|a| !HIDDEN.contains(&a.id.as_str()))
        .filter(|a| !prefs.custom.iter().any(|c| c.id == a.id))
        .map(|a| {
            let recipe = registry_recipe(a, prefs.executables.get(&a.id));
            let supported = recipe.is_some();
            let (program, args, package, runner) = recipe.unwrap_or_default();
            let ready = command_found(&program);
            AcpAgent {
                harness: Harness::Acp(intern(&a.id)),
                id: a.id.clone(),
                name: a.name.clone(),
                description: a.description.clone(),
                website: a.website.clone(),
                icon: a.icon.clone(),
                enabled: enabled(&a.id),
                custom: false,
                installed: ready && package.is_none(),
                ready,
                supported,
                command: command_line(&program, &args),
                executable: program,
                args,
                package,
                runner,
                overridden: prefs.executables.contains_key(&a.id),
            }
        });
    custom.chain(listed).collect()
}

/// Reads each agent's executable without launching or downloading it.
pub async fn list() -> Vec<AcpAgent> {
    let registry = registry().await;
    let prefs = read_prefs().await.unwrap_or_default();
    rows(&registry, &prefs)
}

/// The harnesses the composer offers beside the native five.
pub async fn enabled() -> Vec<Harness> {
    list()
        .await
        .into_iter()
        .filter(|a| a.enabled && a.supported)
        .map(|a| a.harness)
        .collect()
}

/// Resolves a launch without executing its package runner.
pub async fn launch(id: &str) -> Result<Launch> {
    let prefs = read_prefs().await?;
    if let Some(custom) = prefs.custom.iter().find(|c| c.id == id) {
        let program = match std::path::Path::new(&custom.command) {
            path if path.is_absolute() => path.to_path_buf(),
            _ => crate::binpath::acp_agent(&custom.command).await,
        };
        return Ok(Launch {
            program,
            args: custom.args.clone(),
            env: custom.env.clone(),
        });
    }

    let registry = registry().await;
    let agent = registry
        .agents
        .iter()
        .find(|a| a.id == id)
        .with_context(|| format!("no ACP agent named {id}"))?;
    let (program, args, _, _) = registry_recipe(agent, prefs.executables.get(id))
        .with_context(|| format!("{} ships nothing that runs on this machine", agent.name))?;
    Ok(Launch {
        program: if std::path::Path::new(&program).is_absolute() {
            PathBuf::from(program)
        } else {
            crate::binpath::acp_agent(&program).await
        },
        args,
        env: BTreeMap::new(),
    })
}

/// Where to send a reader whose agent is missing.
pub async fn website(id: &str) -> Option<String> {
    registry()
        .await
        .agents
        .iter()
        .find(|a| a.id == id)?
        .website
        .clone()
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !id.starts_with('-')
}

/// Keeps the saved catalog visible when an explicit refresh fails.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn list_acp_agents(recheck: Option<bool>) -> AcpAgentCatalog {
    let registry = registry().await;
    if recheck.unwrap_or(false) {
        crate::binpath::forget_acp_agents();
        if let Err(error) = refresh().await {
            *REGISTRY_ERROR.lock().unwrap() = Some(format!(
                "Could not refresh the agent catalog. Showing the saved list. {error:#}"
            ));
        }
    }
    let registry = REGISTRY.read().unwrap().clone().unwrap_or(registry);
    match read_prefs().await {
        Ok(prefs) => AcpAgentCatalog {
            agents: rows(&registry, &prefs),
            error: REGISTRY_ERROR.lock().unwrap().clone(),
        },
        Err(error) => AcpAgentCatalog {
            agents: Vec::new(),
            error: Some(format!(
                "Could not read the saved agent configuration. {error:#}"
            )),
        },
    }
}

/// Uses an installed executable while preserving the registry's ACP arguments.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn set_acp_agent_executable(id: String, command: Option<String>) -> Result<(), String> {
    let registry = registry().await;
    if !registry.agents.iter().any(|a| a.id == id) || HIDDEN.contains(&id.as_str()) {
        return Err("Choose an agent from the catalog.".into());
    }
    let command = command
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    crate::binpath::forget_acp_agents();
    update_prefs(|prefs| {
        match command {
            Some(command) => {
                prefs.executables.insert(id, command);
            }
            None => {
                prefs.executables.remove(&id);
            }
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("{error:#}"))
}

/// Changes picker visibility without starting the agent.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn set_acp_agent_enabled(id: String, enabled: bool) -> Result<(), String> {
    update_prefs(|prefs| {
        prefs.enabled.retain(|e| *e != id);
        if enabled {
            prefs.enabled.push(id.clone());
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("{e:#}"))
}

fn validate_custom(agent: &CustomAgent, registry: &Registry, prefs: &Prefs) -> Result<()> {
    if registry.agents.iter().any(|known| known.id == agent.id)
        || Harness::ALL
            .iter()
            .any(|known| known.wire_name() == agent.id)
    {
        bail!("That id belongs to a catalog agent. Choose another name.");
    }
    if prefs.custom.iter().any(|known| known.id == agent.id) {
        bail!("That id belongs to another custom agent. Choose another name.");
    }
    Ok(())
}

/// Saves a custom command without replacing a registry identity.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn save_custom_acp_agent(agent: CustomAgent) -> Result<(), String> {
    if !valid_id(&agent.id) {
        return Err("An agent's id is lowercase letters, digits and dashes.".into());
    }
    if agent.name.trim().is_empty() || agent.command.trim().is_empty() {
        return Err("A custom agent needs a name and a command.".into());
    }
    let registry = registry().await;
    update_prefs(|prefs| {
        validate_custom(&agent, &registry, prefs)?;
        prefs.custom.retain(|c| c.id != agent.id);
        prefs.enabled.retain(|e| *e != agent.id);
        prefs.enabled.push(agent.id.clone());
        prefs.custom.push(agent);
        Ok(())
    })
    .await
    .map_err(|e| format!("{e:#}"))
}

/// Leaves existing sessions intact when their custom command is removed.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn remove_custom_acp_agent(id: String) -> Result<(), String> {
    update_prefs(|prefs| {
        prefs.custom.retain(|c| c.id != id);
        prefs.enabled.retain(|e| *e != id);
        Ok(())
    })
    .await
    .map_err(|e| format!("{e:#}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot() -> Registry {
        serde_json::from_str(SNAPSHOT).expect("snapshot parses")
    }

    /// Devin is the agent this was built against, and its entry is a binary
    /// whose name is what gets looked up — never the archive path.
    #[test]
    fn devin_starts_as_its_own_binary_with_acp() {
        let registry = snapshot();
        let devin = registry
            .agents
            .iter()
            .find(|a| a.id == "devin")
            .expect("devin is listed");
        if platform().is_some() {
            assert_eq!(
                recipe(devin),
                Some(("devin".to_string(), vec!["acp".to_string()]))
            );
        }
    }

    /// A package entry runs through `npx -y`, or `npx` stops to ask whether it
    /// may install into a pipe nobody reads.
    #[test]
    fn a_package_runs_through_npx_without_asking() {
        let registry = snapshot();
        let gemini = registry
            .agents
            .iter()
            .find(|a| a.id == "gemini")
            .expect("gemini is listed");
        let (program, args) = recipe(gemini).expect("gemini has a recipe");
        assert_eq!(program, "npx");
        assert_eq!(args[0], "-y");
        assert!(args[1].starts_with("@google/gemini-cli@"));
        assert_eq!(args.last().map(String::as_str), Some("--acp"));
    }

    /// The native harnesses' adapters stay out of the list.
    #[test]
    fn native_harnesses_are_not_listed_twice() {
        let registry = snapshot();
        for id in HIDDEN {
            assert!(
                registry.agents.iter().any(|a| a.id == id),
                "{id} moved out of the registry"
            );
        }
    }

    #[test]
    fn a_custom_id_is_a_safe_harness_name() {
        assert!(valid_id("my-agent2"));
        for bad in ["", "-x", "My", "a b", "a:b", "../x"] {
            assert!(!valid_id(bad), "{bad:?} accepted");
        }
    }

    #[test]
    fn an_executable_override_preserves_spaces_and_discards_the_package_wrapper() {
        let registry = snapshot();
        let agent = registry.agents.iter().find(|a| a.id == "gemini").unwrap();
        let executable = "/Applications/My Agent.app/Contents/MacOS/gemini".to_string();
        let (program, args, package, runner) = registry_recipe(agent, Some(&executable)).unwrap();
        assert_eq!(program, executable);
        assert_eq!(args, agent.distribution.npx.as_ref().unwrap().args);
        assert!(!args
            .iter()
            .any(|arg| arg == "-y" || arg.starts_with("@google/")));
        assert!(package.is_none());
        assert!(runner.is_none());
    }

    #[test]
    fn registry_packages_remain_distinct_from_installed_executables() {
        let registry = snapshot();
        let agent = registry.agents.iter().find(|a| a.id == "gemini").unwrap();
        let (_, _, package, runner) = registry_recipe(agent, None).unwrap();
        assert_eq!(
            package.as_deref(),
            Some(agent.distribution.npx.as_ref().unwrap().package.as_str())
        );
        assert_eq!(runner.as_deref(), Some("npx"));
    }

    #[test]
    fn custom_agents_cannot_replace_catalog_or_other_custom_identities() {
        let registry = snapshot();
        let mut agent = CustomAgent {
            id: "devin".into(),
            name: "Mine".into(),
            command: "/bin/sh".into(),
            args: vec![],
            env: BTreeMap::new(),
        };
        assert!(validate_custom(&agent, &registry, &Prefs::default()).is_err());
        agent.id = "codex".into();
        assert!(validate_custom(&agent, &registry, &Prefs::default()).is_err());
        agent.id = "my-agent".into();
        assert!(validate_custom(&agent, &registry, &Prefs::default()).is_ok());
        let mut prefs = Prefs::default();
        prefs.custom.push(agent.clone());
        assert!(validate_custom(&agent, &registry, &prefs).is_err());
        agent.name = "A different agent".into();
        assert!(validate_custom(&agent, &registry, &prefs).is_err());
    }

    #[test]
    fn a_missing_override_is_never_marked_ready() {
        let registry = snapshot();
        let mut prefs = Prefs::default();
        prefs.executables.insert(
            "devin".into(),
            "/carbon-test-missing/Agent With Spaces".into(),
        );
        let agent = rows(&registry, &prefs)
            .into_iter()
            .find(|agent| agent.id == "devin")
            .unwrap();
        assert!(agent.overridden);
        assert!(!agent.ready);
        assert!(!agent.installed);
        assert_eq!(agent.executable, "/carbon-test-missing/Agent With Spaces");
        assert_eq!(agent.args, ["acp"]);
    }

    #[test]
    fn an_unsupported_registry_entry_stays_visible_without_a_launch_recipe() {
        let registry = Registry {
            agents: vec![RegistryAgent {
                id: "future-agent".into(),
                name: "Future agent".into(),
                description: String::new(),
                website: None,
                icon: None,
                distribution: Distribution::default(),
            }],
        };
        let agents = rows(&registry, &Prefs::default());
        assert_eq!(agents.len(), 1);
        assert!(!agents[0].supported);
        assert!(!agents[0].ready);
        assert!(agents[0].executable.is_empty());
    }
}

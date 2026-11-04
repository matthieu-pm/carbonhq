//! The skills each agent loads, read off the folders the agents themselves
//! scan and written back to them. Settings → Skills draws this.
//!
//! **A skill is a folder holding a `SKILL.md`**, the one format every agent
//! here shares, so a list is grouped by folder: `~/.agents/skills` is read by
//! Codex, pi, grok and fx at once, and each [`SkillRoot`] names every agent
//! that loads it. Which folders each agent reads was taken from its own docs
//! and, for Codex, from `skills/list` run live; fx's are its `commands.rs`
//! roots.
//!
//! **Some skills are not the reader's to edit.** `carbon` is rewritten by
//! `carbon skill install` on every launch, Codex's `.system` skills ship with
//! it, and a plugin's skills belong to the plugin. Those are listed and marked,
//! never written.

use std::path::{Component, Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use ts_rs::TS;

use crate::harness::Harness;
use crate::Fail;

use Harness::{ClaudeCode as Claude, Codex, Fx, Grok, Pi};

/// Folders under the home directory, the agents reading each, and whether a
/// new skill may be created there. The second group is folders only one
/// rarer agent reads, listed where they exist and never offered for creation.
const GLOBAL_ROOTS: &[(&str, &[Harness], bool)] = &[
    (".claude/skills", &[Claude, Grok, Fx], true),
    (".agents/skills", &[Codex, Pi, Grok, Fx], true),
    (".codex/skills", &[Codex, Fx], true),
    (".grok/skills", &[Grok], true),
    (".pi/agent/skills", &[Pi], true),
    (".fx/skills", &[Fx], true),
    (".cursor/skills", &[Grok], false),
    (".config/opencode/skills", &[Fx], false),
    (".claw/skills", &[Fx], false),
];

/// The same, relative to a project. Codex reads a repo's `.agents/skills` and
/// not its `.codex/skills` (measured with `skills/list`), which fx does read.
const PROJECT_ROOTS: &[(&str, &[Harness], bool)] = &[
    (".claude/skills", &[Claude, Grok, Fx], true),
    (".agents/skills", &[Codex, Pi, Grok, Fx], true),
    (".grok/skills", &[Grok], true),
    (".pi/skills", &[Pi], true),
    (".codex/skills", &[Fx], false),
    (".fx/skills", &[Fx], false),
    ("skills", &[Fx], false),
    (".cursor/skills", &[Grok], false),
    (".opencode/skills", &[Fx], false),
    (".claw/skills", &[Fx], false),
];

/// The folders `carbon skill install` writes, where `carbon` is Carbon's.
const CARBON_HOMES: &[&str] = &[".claude/skills", ".codex/skills", ".agents/skills"];

/// A description is drawn on one line; the whole frontmatter is read for edit.
const FRONTMATTER_BYTES: u64 = 8192;

static WRITE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct SkillEntry {
    /// The declared name, falling back to the folder where metadata omits it.
    pub name: String,
    pub description: String,
    /// The skill folder, or a directly configured Markdown file.
    pub path: String,
    /// Why this one cannot be edited, where it cannot.
    pub locked: Option<String>,
    /// A link to a folder elsewhere. Editing writes through to it; removing
    /// takes the link alone.
    pub linked: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct SkillRoot {
    pub id: String,
    pub path: String,
    pub project: Option<String>,
    pub readers: Vec<Harness>,
    /// What to call a plugin's or a built-in group, which has no folder of the
    /// reader's to name.
    pub label: Option<String>,
    pub skills: Vec<SkillEntry>,
    pub error: Option<String>,
    /// Whether new skills can be made or imported here.
    pub writable: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct SkillsListing {
    pub roots: Vec<SkillRoot>,
    /// Every folder a new skill can go in, existing or not, so the form can
    /// offer `~/.claude/skills` to a reader who has never made one.
    pub targets: Vec<SkillRoot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct SkillDocument {
    pub name: String,
    pub description: String,
    pub body: String,
}

#[derive(Clone)]
struct Known {
    path: PathBuf,
    project: Option<PathBuf>,
    readers: Vec<Harness>,
    creatable: bool,
}

static PI_ROOTS: std::sync::Mutex<Vec<Known>> = std::sync::Mutex::new(Vec::new());

fn home() -> Result<PathBuf> {
    std::env::home_dir().ok_or_else(|| anyhow!("couldn't find your home directory"))
}

async fn known_roots() -> Result<Vec<Known>> {
    let home = home()?;
    let projects: Vec<PathBuf> = crate::projects::list_projects()
        .await
        .map(|projects| {
            projects
                .into_iter()
                .map(|p| PathBuf::from(p.path))
                .collect()
        })
        .unwrap_or_default();
    let mut known: Vec<Known> = GLOBAL_ROOTS
        .iter()
        .map(|(rel, readers, creatable)| Known {
            path: home.join(rel),
            project: None,
            readers: readers.to_vec(),
            creatable: *creatable,
        })
        .collect();
    for project in &projects {
        for (rel, readers, creatable) in PROJECT_ROOTS {
            known.push(Known {
                path: project.join(rel),
                project: Some(project.clone()),
                readers: readers.to_vec(),
                creatable: *creatable,
            });
        }
    }
    known.extend(
        PI_ROOTS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .filter(|root| root.project.as_ref().is_none_or(|p| projects.contains(p)))
            .cloned(),
    );
    Ok(known)
}

fn root_of(known: &Known, skills: Vec<SkillEntry>, error: Option<String>) -> SkillRoot {
    SkillRoot {
        id: known.path.to_string_lossy().into_owned(),
        path: known.path.to_string_lossy().into_owned(),
        project: known
            .project
            .as_ref()
            .map(|p| p.to_string_lossy().into_owned()),
        readers: known.readers.clone(),
        label: None,
        skills,
        error,
        writable: true,
    }
}

/// Every skill folder on this machine an agent here loads, plus the plugin and
/// built-in skills that ride along with Claude Code and Codex.
///
/// Read fresh on every call: a skill added in a terminal must show the next
/// time the tab opens, and this is a few dozen `read_dir`s.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn list_skills() -> Result<SkillsListing, Fail> {
    let home = home()?;
    let mut known = known_roots().await?;
    let projects: Vec<PathBuf> = known
        .iter()
        .filter_map(|k| k.project.clone())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();
    let pi_installed = crate::binpath::agent_installed(Pi).await;
    if pi_installed {
        known.retain(|root| root.readers != [Pi] || root.creatable);
        for root in &mut known {
            root.readers.retain(|h| *h != Pi);
        }
    }
    let codex_extra = codex_plugin_skills(&home);

    let walked = tokio::task::spawn_blocking({
        let home = home.clone();
        let projects = projects.clone();
        move || {
            let mut roots = Vec::new();
            let mut targets = Vec::new();
            for k in &known {
                if k.creatable {
                    targets.push(root_of(k, Vec::new(), None));
                }
                if k.readers.is_empty() {
                    continue;
                }
                let carbon_home =
                    k.project.is_none() && CARBON_HOMES.iter().any(|rel| home.join(rel) == k.path);
                match walk(&k.path, carbon_home) {
                    Ok(skills) if skills.is_empty() && !k.creatable => {}
                    Ok(skills) => roots.push(root_of(k, skills, None)),
                    Err(err)
                        if !k.path.exists()
                            && err
                                .downcast_ref::<std::io::Error>()
                                .is_some_and(|e| e.kind() == std::io::ErrorKind::NotFound) => {}
                    Err(err) => roots.push(root_of(k, Vec::new(), Some(format!("{err:#}")))),
                }
            }
            let system = home.join(".codex/skills/.system");
            if let Ok(skills) = walk(&system, false) {
                if !skills.is_empty() {
                    roots.push(locked_root(
                        &system,
                        "Built into Codex",
                        vec![Codex],
                        skills,
                        "Ships with Codex",
                    ));
                }
            }
            roots.extend(claude_plugin_skills(&home, &projects));
            (roots, targets)
        }
    })
    .await
    .map_err(|e| anyhow!("couldn't read the skill folders: {e}"))?;

    let (mut roots, mut targets) = walked;
    let mut pi_roots = Vec::new();
    if pi_installed {
        for cwd in std::iter::once(&home).chain(projects.iter()) {
            match crate::harness::pi::commands::skill_sources(&cwd.to_string_lossy()).await {
                Ok(answer) => merge_pi_roots(
                    &mut pi_roots,
                    pi_roots_from_commands(&answer, (cwd != &home).then_some(cwd.as_path())),
                ),
                Err(err) => pi_roots.push(discovery_error("pi", cwd, vec![Pi], format!("{err:#}"))),
            }
        }
        let writable: Vec<Known> = pi_roots
            .iter()
            .filter(|r| r.writable)
            .map(|r| Known {
                path: PathBuf::from(&r.path),
                project: r.project.as_ref().map(PathBuf::from),
                readers: vec![Pi],
                creatable: false,
            })
            .collect();
        *PI_ROOTS.lock().unwrap_or_else(|e| e.into_inner()) = writable;
        for target in &mut targets {
            if GLOBAL_ROOTS
                .iter()
                .chain(PROJECT_ROOTS)
                .any(|(rel, readers, _)| {
                    readers.contains(&Pi) && Path::new(&target.path).ends_with(rel)
                })
            {
                target.readers.push(Pi);
            }
        }
        for root in pi_roots {
            merge_pi_roots(&mut roots, vec![root]);
        }
    }
    let walked_paths: Vec<String> = roots.iter().map(|r| r.path.clone()).collect();
    for root in codex_extra.await {
        if !walked_paths.contains(&root.path) {
            roots.push(root);
        }
    }
    Ok(SkillsListing { roots, targets })
}

fn discovery_error(label: &str, path: &Path, readers: Vec<Harness>, error: String) -> SkillRoot {
    SkillRoot {
        id: format!("{label}:{}", path.display()),
        path: path.to_string_lossy().into_owned(),
        project: None,
        readers,
        label: Some(label.to_string()),
        skills: Vec::new(),
        error: Some(error),
        writable: false,
    }
}

/// Agent-reported paths cover nested, configured and package skills without guessing their layout.
fn pi_roots_from_commands(answer: &Value, project: Option<&Path>) -> Vec<SkillRoot> {
    let mut roots: Vec<SkillRoot> = Vec::new();
    for row in answer
        .get("commands")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if row.get("source").and_then(Value::as_str) != Some("skill") {
            continue;
        }
        let Some(info) = row.get("sourceInfo") else {
            continue;
        };
        let Some(file) = info.get("path").and_then(Value::as_str).map(Path::new) else {
            continue;
        };
        let Some(folder) = file.parent() else {
            continue;
        };
        let path = if file.file_name().is_some_and(|n| n == "SKILL.md") {
            folder
        } else {
            file
        };
        let root = path.parent().unwrap_or(folder);
        let scoped = info.get("scope").and_then(Value::as_str) == Some("project");
        if scoped && project.is_none() {
            continue;
        }
        let package = info.get("origin").and_then(Value::as_str) == Some("package");
        let project = scoped
            .then(|| project.map(|p| p.to_string_lossy().into_owned()))
            .flatten();
        let id = format!("pi:{}:{}", root.display(), project.as_deref().unwrap_or(""));
        let entry = SkillEntry {
            name: row
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .strip_prefix("skill:")
                .unwrap_or("")
                .to_string(),
            description: row
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            path: path.to_string_lossy().into_owned(),
            locked: package
                .then(|| "From a pi package".to_string())
                .or_else(|| {
                    home()
                        .ok()
                        .filter(|home| managed_skill(home, path))
                        .map(|_| "Managed by Carbon or an agent".to_string())
                }),
            linked: std::fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()),
        };
        if let Some(group) = roots.iter_mut().find(|r| r.id == id) {
            group.skills.push(entry);
        } else {
            roots.push(SkillRoot {
                id,
                path: root.to_string_lossy().into_owned(),
                project,
                readers: vec![Pi],
                label: package.then(|| "pi package".to_string()),
                skills: vec![entry],
                error: None,
                writable: !package,
            });
        }
    }
    roots
}

fn merge_pi_roots(roots: &mut Vec<SkillRoot>, incoming: Vec<SkillRoot>) {
    for mut root in incoming {
        if let Some(existing) = roots.iter_mut().find(|r| {
            r.path == root.path
                && r.project == root.project
                && r.writable == root.writable
                && r.skills.len() == root.skills.len()
                && r.skills
                    .iter()
                    .all(|s| root.skills.iter().any(|n| n.path == s.path))
        }) {
            for reader in root.readers {
                if !existing.readers.contains(&reader) {
                    existing.readers.push(reader);
                }
            }
        } else {
            root.skills.sort_by(|a, b| a.name.cmp(&b.name));
            roots.push(root);
        }
    }
}

fn locked_root(
    path: &Path,
    label: &str,
    readers: Vec<Harness>,
    skills: Vec<SkillEntry>,
    why: &str,
) -> SkillRoot {
    SkillRoot {
        id: path.to_string_lossy().into_owned(),
        path: path.to_string_lossy().into_owned(),
        project: None,
        readers,
        label: Some(label.to_string()),
        skills: skills
            .into_iter()
            .map(|s| SkillEntry {
                locked: Some(why.to_string()),
                ..s
            })
            .collect(),
        error: None,
        writable: false,
    }
}

/// The skills directly under one folder. Hidden folders are skipped: Codex
/// keeps its own built-ins in `.system`, listed apart.
fn walk(root: &Path, carbon_home: bool) -> Result<Vec<SkillEntry>> {
    let entries =
        std::fs::read_dir(root).with_context(|| format!("couldn't read {}", root.display()))?;
    let mut skills: Vec<SkillEntry> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            if name.starts_with('.') {
                return None;
            }
            let path = entry.path();
            let skill_md = path.join("SKILL.md");
            if !skill_md.is_file() {
                return None;
            }
            let head = match read_head(&skill_md) {
                Ok(head) => head,
                Err(err) => {
                    return Some(SkillEntry {
                        name,
                        description: format!("Couldn't read SKILL.md: {err:#}"),
                        path: path.to_string_lossy().into_owned(),
                        locked: Some("SKILL.md couldn't be read".to_string()),
                        linked: entry.file_type().map(|t| t.is_symlink()).unwrap_or(false),
                    })
                }
            };
            let (frontmatter, _) = split_frontmatter(&head);
            let parsed = metadata(frontmatter);
            let error = parsed
                .as_ref()
                .err()
                .map(|err| format!("Couldn't read SKILL.md: {err:#}"));
            let description = error.clone().unwrap_or_else(|| {
                frontmatter
                    .and_then(|f| field(f, "description"))
                    .unwrap_or_default()
            });
            let name = frontmatter.and_then(|f| field(f, "name")).unwrap_or(name);
            let linked = entry.file_type().map(|t| t.is_symlink()).unwrap_or(false);
            let locked = error
                .or_else(|| {
                    (carbon_home && path.file_name().is_some_and(|n| n == "carbon"))
                        .then(|| "Managed by Carbon. Every launch rewrites it.".to_string())
                })
                .or_else(|| {
                    std::env::home_dir()
                        .filter(|home| managed_skill(home, &path))
                        .map(|_| "Managed by Carbon or an agent".to_string())
                });
            Some(SkillEntry {
                name,
                description,
                path: path.to_string_lossy().into_owned(),
                locked,
                linked,
            })
        })
        .collect();
    skills.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(skills)
}

fn read_head(path: &Path) -> Result<String> {
    use std::io::Read;
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(FRONTMATTER_BYTES)
        .read_to_end(&mut bytes)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn plugin_skills(path: &Path) -> Result<Vec<SkillEntry>> {
    if !path.join("SKILL.md").is_file() {
        return walk(path, false);
    }
    let text = std::fs::read_to_string(path.join("SKILL.md"))?;
    let (frontmatter, _) = split_frontmatter(&text);
    metadata(frontmatter)?;
    Ok(vec![SkillEntry {
        name: frontmatter
            .and_then(|f| field(f, "name"))
            .unwrap_or_else(|| {
                path.file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned()
            }),
        description: frontmatter
            .and_then(|f| field(f, "description"))
            .unwrap_or_default(),
        path: path.to_string_lossy().into_owned(),
        locked: None,
        linked: std::fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()),
    }])
}

/// Plugin enablement follows the same user, project, local and managed precedence as Claude.
fn plugin_settings(home: &Path, project: Option<&Path>) -> Result<serde_json::Map<String, Value>> {
    let mut paths = vec![home.join(".claude/settings.json")];
    if let Some(project) = project {
        paths.extend([
            project.join(".claude/settings.json"),
            project.join(".claude/settings.local.json"),
        ]);
    }
    paths.push(if cfg!(target_os = "macos") {
        PathBuf::from("/Library/Application Support/ClaudeCode/managed-settings.json")
    } else {
        PathBuf::from("/etc/claude-code/managed-settings.json")
    });
    let mut enabled = serde_json::Map::new();
    for path in paths {
        let text = match std::fs::read_to_string(&path) {
            Ok(text) => text,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => continue,
            Err(err) => {
                return Err(err).with_context(|| format!("couldn't read {}", path.display()))
            }
        };
        let settings: Value = serde_json::from_str(&text)
            .with_context(|| format!("couldn't parse {}", path.display()))?;
        if let Some(value) = settings.get("enabledPlugins") {
            enabled.extend(
                value
                    .as_object()
                    .ok_or_else(|| anyhow!("enabledPlugins in {} isn't an object", path.display()))?
                    .clone(),
            );
        }
    }
    Ok(enabled)
}

fn claude_plugin_skills(home: &Path, projects: &[PathBuf]) -> Vec<SkillRoot> {
    let registry = home.join(".claude/plugins/installed_plugins.json");
    let read = || -> Result<Vec<SkillRoot>> {
        let text = match std::fs::read_to_string(&registry) {
            Ok(text) => text,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(err) => return Err(err).context("couldn't read Claude Code's plugin registry"),
        };
        let installed: Value =
            serde_json::from_str(&text).context("couldn't parse Claude Code's plugin registry")?;
        let plugins = installed
            .get("plugins")
            .and_then(Value::as_object)
            .ok_or_else(|| anyhow!("Claude Code's plugin registry has no plugins object"))?;
        let global = plugin_settings(home, None)?;
        let mut roots = Vec::new();
        for (id, installs) in plugins {
            let name = id.split('@').next().unwrap_or(id);
            for install in installs.as_array().into_iter().flatten() {
                let Some(path) = install
                    .get("installPath")
                    .and_then(Value::as_str)
                    .map(Path::new)
                else {
                    continue;
                };
                let installed_project = install
                    .get("projectPath")
                    .and_then(Value::as_str)
                    .map(Path::new);
                let scopes: Vec<Option<&Path>> = match installed_project {
                    Some(project) if projects.iter().any(|p| p == project) => vec![Some(project)],
                    Some(_) => continue,
                    None => std::iter::once(None)
                        .chain(projects.iter().map(|p| Some(p.as_path())))
                        .collect(),
                };
                let mut default_enabled = true;
                let mut directories = vec![path.join("skills")];
                let manifest = path.join(".claude-plugin/plugin.json");
                match std::fs::read_to_string(&manifest) {
                    Ok(text) => {
                        let value: Value = serde_json::from_str(&text)
                            .with_context(|| format!("couldn't parse {}", manifest.display()))?;
                        default_enabled = value
                            .get("defaultEnabled")
                            .and_then(Value::as_bool)
                            .unwrap_or(true);
                        if let Some(skills) = value.get("skills") {
                            for extra in skills.as_str().into_iter().chain(
                                skills
                                    .as_array()
                                    .into_iter()
                                    .flatten()
                                    .filter_map(Value::as_str),
                            ) {
                                let dir = path.join(extra);
                                if !directories.contains(&dir) {
                                    directories.push(dir);
                                }
                            }
                        }
                    }
                    Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                    Err(err) => {
                        return Err(err)
                            .with_context(|| format!("couldn't read {}", manifest.display()))
                    }
                }
                for project in scopes {
                    let enabled = match plugin_settings(home, project) {
                        Ok(enabled) => enabled,
                        Err(err) => {
                            roots.push(discovery_error(
                                "Claude Code plugins",
                                project.unwrap_or(home),
                                vec![Claude],
                                format!("{err:#}"),
                            ));
                            continue;
                        }
                    };
                    if !enabled
                        .get(id)
                        .and_then(Value::as_bool)
                        .unwrap_or(default_enabled)
                    {
                        continue;
                    }
                    if installed_project.is_none()
                        && project.is_some()
                        && global
                            .get(id)
                            .and_then(Value::as_bool)
                            .unwrap_or(default_enabled)
                    {
                        continue;
                    }
                    for dir in &directories {
                        match plugin_skills(dir) {
                            Ok(skills) if !skills.is_empty() => {
                                let mut root = locked_root(
                                    &dir,
                                    &format!("Plugin: {name}"),
                                    vec![Claude],
                                    skills,
                                    &format!("From the {name} plugin"),
                                );
                                root.project = project.map(|p| p.to_string_lossy().into_owned());
                                root.id = format!(
                                    "{}:{}",
                                    root.id,
                                    root.project.as_deref().unwrap_or("")
                                );
                                roots.push(root);
                            }
                            Ok(_) => {}
                            Err(err)
                                if err
                                    .downcast_ref::<std::io::Error>()
                                    .is_some_and(|e| e.kind() == std::io::ErrorKind::NotFound) => {}
                            Err(err) => roots.push(discovery_error(
                                &format!("Plugin: {name}"),
                                &dir,
                                vec![Claude],
                                format!("{err:#}"),
                            )),
                        }
                    }
                }
            }
        }
        Ok(roots)
    };
    let mut roots = read().unwrap_or_else(|err| {
        vec![discovery_error(
            "Claude Code plugins",
            &registry,
            vec![Claude],
            format!("{err:#}"),
        )]
    });
    let mut ids = std::collections::HashSet::new();
    roots.retain(|root| ids.insert(root.id.clone()));
    roots
}

/// Codex's plugin skills, which only Codex can say are on — its cache holds
/// every version of every plugin it ever fetched. Asked of a throwaway
/// app-server, and given up on quietly: these are read-only extras.
async fn codex_plugin_skills(home: &Path) -> Vec<SkillRoot> {
    if !crate::binpath::agent_installed(Codex).await {
        return Vec::new();
    }
    let home_str = home.to_string_lossy().into_owned();
    let asked = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        crate::harness::codex::probe::ask(Some(&home_str), "skills/list", json!({})),
    )
    .await;
    let Ok(Ok(answer)) = asked else {
        return Vec::new();
    };
    let cache = home.join(".codex/plugins/cache");
    let mut by_plugin: std::collections::BTreeMap<String, (PathBuf, Vec<SkillEntry>)> =
        Default::default();
    for scope in answer
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        for skill in scope
            .get("skills")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some(path) = skill.get("path").and_then(Value::as_str).map(Path::new) else {
                continue;
            };
            let Ok(rest) = path.strip_prefix(&cache) else {
                continue;
            };
            // `<market>/<plugin>/<version>/skills/<skill>/SKILL.md`
            let parts: Vec<_> = rest.components().collect();
            if parts.len() < 6 {
                continue;
            }
            let plugin = parts[1].as_os_str().to_string_lossy().into_owned();
            let Some(skill_dir) = path.parent() else {
                continue;
            };
            let Some(root) = skill_dir.parent() else {
                continue;
            };
            let entry = SkillEntry {
                name: skill
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| {
                        skill_dir
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                            .into_owned()
                    }),
                description: skill
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                path: skill_dir.to_string_lossy().into_owned(),
                locked: Some(format!("From the {plugin} plugin")),
                linked: false,
            };
            by_plugin
                .entry(plugin)
                .or_insert_with(|| (root.to_path_buf(), Vec::new()))
                .1
                .push(entry);
        }
    }
    by_plugin
        .into_iter()
        .map(|(plugin, (root, skills))| {
            let why = format!("From the {plugin} plugin");
            locked_root(
                &root,
                &format!("Plugin: {plugin}"),
                vec![Codex],
                skills,
                &why,
            )
        })
        .collect()
}

/// `(frontmatter, body)`. A file with no leading `---` block is all body.
fn split_frontmatter(text: &str) -> (Option<&str>, &str) {
    let rest = match text
        .strip_prefix("---\n")
        .or_else(|| text.strip_prefix("---\r\n"))
    {
        Some(rest) => rest,
        None => return (None, text),
    };
    let mut offset = 0;
    for line in rest.split_inclusive('\n') {
        if line.trim_end() == "---" {
            let body = &rest[offset + line.len()..];
            return (
                Some(&rest[..offset]),
                body.strip_prefix('\n').unwrap_or(body),
            );
        }
        offset += line.len();
    }
    (None, text)
}

/// Parse metadata before editing so unsupported or malformed YAML never becomes guessed text.
fn metadata(frontmatter: Option<&str>) -> Result<serde_yaml_ng::Mapping> {
    let fields: serde_yaml_ng::Mapping = match frontmatter {
        Some(text) => {
            serde_yaml_ng::from_str(text).context("couldn't parse the skill's YAML frontmatter")?
        }
        None => Default::default(),
    };
    for key in ["name", "description"] {
        if fields.get(key).is_some_and(|value| !value.is_string()) {
            bail!("the skill's {key} must be text");
        }
    }
    Ok(fields)
}

fn field(frontmatter: &str, key: &str) -> Option<String> {
    metadata(Some(frontmatter))
        .ok()?
        .get(key)?
        .as_str()
        .map(|value| value.trim_end_matches('\n').to_string())
}

/// JSON-quoted strings are valid YAML without ambiguous numeric or tag spellings.
fn yaml_scalar(value: &str) -> String {
    serde_json::to_string(value).expect("a string always serializes")
}

/// The frontmatter with `name` and `description` set and every other key —
/// `allowed-tools`, `metadata`, whatever an agent added — preserved as values.
fn with_fields(frontmatter: Option<&str>, name: &str, description: &str) -> Result<String> {
    let mut fields = metadata(frontmatter)?;
    if frontmatter.is_some()
        && fields.get("name").and_then(|v| v.as_str()) == Some(name)
        && fields
            .get("description")
            .and_then(|v| v.as_str())
            .map(str::trim)
            == Some(description)
    {
        return Ok(format!("---\n{}---\n", frontmatter.unwrap()));
    }
    fields.shift_remove("name");
    fields.shift_remove("description");
    let kept = if fields.is_empty() {
        String::new()
    } else {
        serde_yaml_ng::to_string(&fields)?
    };
    Ok(format!(
        "---\nname: {}\ndescription: {}\n{}---\n",
        yaml_scalar(name),
        yaml_scalar(description),
        kept
    ))
}

fn compose(frontmatter: Option<&str>, doc: &SkillDocument) -> Result<String> {
    let mut out = with_fields(frontmatter, doc.name.trim(), doc.description.trim())?;
    let body = doc.body.trim_start_matches('\n');
    if !body.is_empty() {
        out.push('\n');
        out.push_str(body);
        if !body.ends_with('\n') {
            out.push('\n');
        }
    }
    Ok(out)
}

/// Claude Code's rule for a skill's name, the strictest here: lowercase
/// letters, numbers and hyphens, up to 64.
fn check_name(name: &str) -> Result<()> {
    if name.is_empty() || name.len() > 64 {
        bail!("a skill's name is 1 to 64 characters");
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        bail!("use lowercase letters, numbers and hyphens in the name");
    }
    Ok(())
}

fn has_parent_refs(path: &Path) -> bool {
    path.components()
        .any(|c| matches!(c, Component::ParentDir | Component::CurDir))
}

/// The writable folder `root` names, refusing anything that is not one: every
/// write goes through here, so no command can be pointed at an arbitrary path.
async fn writable_root(root: &str) -> Result<PathBuf> {
    let root = PathBuf::from(root);
    if has_parent_refs(&root) || !known_roots().await?.iter().any(|k| k.path == root) {
        bail!("{} isn't a skills folder Carbon knows", root.display());
    }
    Ok(root)
}

fn skill_file(path: &Path) -> PathBuf {
    if path.is_file() {
        path.to_path_buf()
    } else {
        path.join("SKILL.md")
    }
}

/// The skill folder `path` names, refusing one Carbon or a plugin owns.
async fn editable_skill(path: &str) -> Result<PathBuf> {
    let path = PathBuf::from(path);
    let parent = path
        .parent()
        .ok_or_else(|| anyhow!("{} isn't a skill", path.display()))?;
    writable_root(&parent.to_string_lossy()).await?;
    let home = home()?;
    if has_parent_refs(&path) || managed_skill(&home, &path) {
        bail!("this skill is managed by Carbon or an agent and can't be edited here");
    }
    if !skill_file(&path).is_file() {
        bail!("{} has no SKILL.md", path.display());
    }
    Ok(path)
}

/// Resolve aliases too, so a linked copy cannot edit a managed skill.
fn managed_skill(home: &Path, path: &Path) -> bool {
    let real = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    CARBON_HOMES.iter().any(|rel| {
        let managed = home.join(rel).join("carbon");
        path == managed || real == std::fs::canonicalize(&managed).unwrap_or(managed)
    }) || [
        ".codex/skills/.system",
        ".codex/plugins/cache",
        ".claude/plugins/cache",
    ]
    .iter()
    .any(|rel| real.starts_with(home.join(rel)))
}

/// The whole of one skill, for the edit form.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn read_skill(path: String) -> Result<SkillDocument, Fail> {
    let dir = PathBuf::from(&path);
    if has_parent_refs(&dir) {
        return Err(anyhow!("{path} isn't a skill").into());
    }
    let text = tokio::fs::read_to_string(skill_file(&dir))
        .await
        .with_context(|| format!("couldn't read {}/SKILL.md", dir.display()))?;
    let (frontmatter, body) = split_frontmatter(&text);
    metadata(frontmatter)?;
    let folder = (if dir.is_file() {
        dir.file_stem()
    } else {
        dir.file_name()
    })
    .unwrap_or_default()
    .to_string_lossy()
    .into_owned();
    Ok(SkillDocument {
        name: frontmatter.and_then(|f| field(f, "name")).unwrap_or(folder),
        description: frontmatter
            .and_then(|f| field(f, "description"))
            .unwrap_or_default(),
        body: body.to_string(),
    })
}

/// A new skill in `root`, as `<root>/<name>/SKILL.md`.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn create_skill(root: String, skill: SkillDocument) -> Result<String, Fail> {
    let _guard = WRITE_LOCK.lock().await;
    let _across = crate::store::lock_across_processes("agent-skills").await;
    let root = writable_root(&root).await?;
    let name = skill.name.trim().to_string();
    check_name(&name)?;
    let contents = compose(None, &skill)?;
    let dir = root.join(&name);
    if managed_skill(&home()?, &dir) {
        return Err(anyhow!("this name is managed by Carbon").into());
    }
    if tokio::fs::symlink_metadata(&dir).await.is_ok() {
        return Err(anyhow!("there's already a skill called {name} there").into());
    }
    tokio::fs::create_dir_all(&root)
        .await
        .context("couldn't create the skills folder")?;
    tokio::fs::create_dir(&dir)
        .await
        .with_context(|| format!("couldn't create {}", dir.display()))?;
    if let Err(err) = tokio::fs::write(dir.join("SKILL.md"), contents).await {
        let _ = tokio::fs::remove_dir(&dir).await;
        return Err(anyhow::Error::from(err)
            .context("couldn't write SKILL.md")
            .into());
    }
    Ok(dir.to_string_lossy().into_owned())
}

/// Rename the folder only when the declared name changes; agents may accept different names.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn save_skill(path: String, skill: SkillDocument) -> Result<String, Fail> {
    let _guard = WRITE_LOCK.lock().await;
    let _across = crate::store::lock_across_processes("agent-skills").await;
    let dir = editable_skill(&path).await?;
    save_at(&dir, &skill).await.map_err(Into::into)
}

/// Check the destination before writing, and restore the folder on a failed edit.
async fn save_at(dir: &Path, skill: &SkillDocument) -> Result<String> {
    let text = tokio::fs::read_to_string(skill_file(&dir)).await?;
    let (frontmatter, _) = split_frontmatter(&text);
    let fields = metadata(frontmatter)?;
    let folder_name = dir.file_name().unwrap_or_default().to_string_lossy();
    let original_name = fields
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or(&folder_name);
    let name = skill.name.trim();
    let renamed = !dir.is_file() && name != original_name && name != folder_name;
    let to = if renamed {
        dir.with_file_name(name)
    } else {
        dir.to_path_buf()
    };
    if renamed {
        check_name(name)?;
        if managed_skill(&home()?, &to) {
            bail!("this name is managed by Carbon");
        }
        if tokio::fs::symlink_metadata(&to).await.is_ok() {
            bail!("there's already a skill called {name} there");
        }
    }
    let contents = compose(frontmatter, skill)?;
    if renamed {
        tokio::fs::rename(dir, &to)
            .await
            .context("couldn't rename the skill")?;
    }
    let written: Result<()> = async {
        let file = tokio::fs::canonicalize(skill_file(&to)).await?;
        tokio::task::spawn_blocking(move || {
            crate::store::write_private_atomic(&file, contents.as_bytes())
        })
        .await??;
        Ok(())
    }
    .await;
    if let Err(err) = written {
        if renamed {
            tokio::fs::rename(&to, dir)
                .await
                .context("couldn't restore the skill's folder after the write failed")?;
        }
        return Err(err).context("couldn't save SKILL.md");
    }
    Ok(to.to_string_lossy().into_owned())
}

/// Moves a skill to the Trash, or takes the link alone where it is one. The
/// Trash rather than a delete on macOS because a skill is often hand-written
/// and nowhere else. A failed move leaves the original in place.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn remove_skill(path: String) -> Result<(), Fail> {
    let _guard = WRITE_LOCK.lock().await;
    let _across = crate::store::lock_across_processes("agent-skills").await;
    let dir = editable_skill(&path).await?;
    let meta = tokio::fs::symlink_metadata(&dir)
        .await
        .with_context(|| format!("couldn't read {}", dir.display()))?;
    if meta.file_type().is_symlink() {
        tokio::fs::remove_file(&dir)
            .await
            .with_context(|| format!("couldn't remove {}", dir.display()))?;
        return Ok(());
    }
    let trash = home()?.join(".Trash");
    if cfg!(target_os = "macos") && trash.is_dir() {
        let name = dir
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let mut to = trash.join(&name);
        if tokio::fs::symlink_metadata(&to).await.is_ok() {
            to = trash.join(format!("{name} {}", uuid::Uuid::now_v7()));
        }
        tokio::fs::rename(&dir, &to)
            .await
            .context("couldn't move the skill to Trash")?;
        return Ok(());
    }
    if cfg!(target_os = "macos") {
        return Err(anyhow!("couldn't find the Trash folder; the skill was kept").into());
    }
    if dir.is_file() {
        tokio::fs::remove_file(&dir)
            .await
            .context("couldn't remove the skill file")?;
        return Ok(());
    }
    tokio::fs::remove_dir_all(&dir)
        .await
        .with_context(|| format!("couldn't remove {}", dir.display()))?;
    Ok(())
}

/// Copies a folder holding a `SKILL.md` into `root`, under its own name.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn import_skill(root: String, source: String) -> Result<String, Fail> {
    let _guard = WRITE_LOCK.lock().await;
    let _across = crate::store::lock_across_processes("agent-skills").await;
    let root = writable_root(&root).await?;
    let source = tokio::fs::canonicalize(&source)
        .await
        .context("couldn't open the skill folder")?;
    if !source.join("SKILL.md").is_file() {
        return Err(anyhow!("{} has no SKILL.md in it", source.display()).into());
    }
    let name = source
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| anyhow!("{} isn't a folder", source.display()))?;
    let displayed = root.join(&name);
    tokio::fs::create_dir_all(&root)
        .await
        .context("couldn't create the skills folder")?;
    let root = tokio::fs::canonicalize(root)
        .await
        .context("couldn't resolve the skills folder")?;
    let to = root.join(&name);
    if managed_skill(&home()?, &to) {
        return Err(anyhow!("this name is managed by Carbon").into());
    }
    if tokio::fs::symlink_metadata(&to).await.is_ok() {
        return Err(anyhow!("there's already a skill called {name} there").into());
    }
    if to.starts_with(&source) {
        return Err(anyhow!("can't import a folder into itself").into());
    }
    let (from, dest) = (source.clone(), to.clone());
    tokio::task::spawn_blocking(move || copy_dir(&from, &dest))
        .await
        .map_err(|e| anyhow!("couldn't copy the skill: {e}"))??;
    Ok(displayed.to_string_lossy().into_owned())
}

/// A plain recursive copy. `.git` is left behind, since a skill cloned from a
/// repo would otherwise carry its whole history into the agent's folder.
fn copy_dir(from: &Path, to: &Path) -> Result<()> {
    std::fs::create_dir(to).with_context(|| format!("couldn't create {}", to.display()))?;
    let copied = copy_contents(from, to, &mut Vec::new());
    if copied.is_err() {
        let _ = std::fs::remove_dir_all(to);
    }
    copied
}

/// Following links needs an ancestor check: a skill may link to its own parent.
fn copy_contents(from: &Path, to: &Path, ancestors: &mut Vec<PathBuf>) -> Result<()> {
    let real = std::fs::canonicalize(from)?;
    if ancestors.contains(&real) || to.starts_with(&real) {
        bail!("{} contains a circular folder link", from.display());
    }
    ancestors.push(real);
    for entry in
        std::fs::read_dir(from).with_context(|| format!("couldn't read {}", from.display()))?
    {
        let entry = entry?;
        if entry.file_name() == ".git" {
            continue;
        }
        let (src, dst) = (entry.path(), to.join(entry.file_name()));
        if src.is_dir() {
            std::fs::create_dir(&dst)?;
            copy_contents(&src, &dst, ancestors)?;
        } else {
            std::fs::copy(&src, &dst)
                .with_context(|| format!("couldn't copy {}", src.display()))?;
        }
    }
    ancestors.pop();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_every_description_shape() {
        let fm = "name: a\ndescription: >\n  folded over\n  two lines\nother: x\n";
        assert_eq!(field(fm, "description").unwrap(), "folded over two lines");
        let fm = "name: a\ndescription: \"quoted: with colon\"\n";
        assert_eq!(field(fm, "description").unwrap(), "quoted: with colon");
        let fm = "description: plain that\n  continues\nname: a\n";
        assert_eq!(field(fm, "description").unwrap(), "plain that continues");
        let fm = "description: 'it''s'\n";
        assert_eq!(field(fm, "description").unwrap(), "it's");
    }

    #[test]
    fn splits_frontmatter_from_body() {
        let (fm, body) = split_frontmatter("---\nname: a\n---\n\n# Body\n");
        assert_eq!(fm, Some("name: a\n"));
        assert_eq!(body, "# Body\n");
        assert_eq!(split_frontmatter("# no fm").0, None);
    }

    /// An edit keeps every key the form does not draw, and a description with
    /// a colon in it still parses back.
    #[test]
    fn an_edit_keeps_other_keys() {
        let old =
            "name: a\ndescription: >\n  old\n  text\nallowed-tools: Bash\nmetadata:\n  k: v\n";
        let doc = SkillDocument {
            name: "b".into(),
            description: "Use when: x".into(),
            body: "Hi".into(),
        };
        let out = compose(Some(old), &doc).unwrap();
        let (fm, body) = split_frontmatter(&out);
        let fm = fm.unwrap();
        assert_eq!(field(fm, "name").unwrap(), "b");
        assert_eq!(field(fm, "description").unwrap(), "Use when: x");
        assert!(fm.contains("allowed-tools: Bash\nmetadata:\n  k: v\n"));
        assert!(!fm.contains("old"));
        assert_eq!(body, "Hi\n");
    }

    #[test]
    fn names_follow_claudes_rule() {
        assert!(check_name("my-skill-2").is_ok());
        assert!(check_name("My Skill").is_err());
        assert!(check_name("").is_err());
    }

    fn test_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("carbon-skills-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[tokio::test]
    async fn a_refused_rename_keeps_both_skills_unchanged() {
        let root = test_dir();
        let from = root.join("old");
        let to = root.join("taken");
        std::fs::create_dir(&from).unwrap();
        std::fs::create_dir(&to).unwrap();
        std::fs::write(from.join("SKILL.md"), "original").unwrap();
        std::fs::write(to.join("SKILL.md"), "destination").unwrap();
        let doc = SkillDocument {
            name: "taken".into(),
            description: "new".into(),
            body: "changed".into(),
        };
        assert!(save_at(&from, &doc).await.is_err());
        assert_eq!(
            std::fs::read_to_string(from.join("SKILL.md")).unwrap(),
            "original"
        );
        assert_eq!(
            std::fs::read_to_string(to.join("SKILL.md")).unwrap(),
            "destination"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn renaming_keeps_support_files_and_unknown_frontmatter() {
        let root = test_dir();
        let from = root.join("old");
        std::fs::create_dir(&from).unwrap();
        std::fs::write(
            from.join("SKILL.md"),
            "---\nname: old\nallowed-tools: Read\n---\nold body",
        )
        .unwrap();
        std::fs::write(from.join("script.sh"), "support").unwrap();
        let doc = SkillDocument {
            name: "new".into(),
            description: "description".into(),
            body: "new body".into(),
        };
        let to = PathBuf::from(save_at(&from, &doc).await.unwrap());
        assert!(!from.exists());
        assert_eq!(
            std::fs::read_to_string(to.join("script.sh")).unwrap(),
            "support"
        );
        let saved = std::fs::read_to_string(to.join("SKILL.md")).unwrap();
        assert!(saved.contains("allowed-tools: Read"));
        assert!(saved.contains("new body"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_circular_import_is_refused_without_leaving_a_partial_skill() {
        let root = test_dir();
        let from = root.join("source");
        let to = root.join("copy");
        std::fs::create_dir(&from).unwrap();
        std::fs::write(from.join("SKILL.md"), "body").unwrap();
        std::os::unix::fs::symlink(&from, from.join("loop")).unwrap();
        assert!(copy_dir(&from, &to).is_err());
        assert!(!to.exists());
        assert!(from.join("SKILL.md").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn import_keeps_support_files_and_leaves_git_history_behind() {
        let root = test_dir();
        let from = root.join("source");
        let to = root.join("copy");
        std::fs::create_dir_all(from.join(".git")).unwrap();
        std::fs::create_dir(from.join("scripts")).unwrap();
        std::fs::write(from.join("SKILL.md"), "body").unwrap();
        std::fs::write(from.join("scripts/run.sh"), "support").unwrap();
        copy_dir(&from, &to).unwrap();
        assert_eq!(
            std::fs::read_to_string(to.join("scripts/run.sh")).unwrap(),
            "support"
        );
        assert!(!to.join(".git").exists());
        assert!(copy_dir(&from, &to).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_link_to_a_managed_skill_is_also_read_only() {
        let home = test_dir();
        let managed = home.join(".claude/skills/carbon");
        std::fs::create_dir_all(&managed).unwrap();
        let alias = home.join("alias");
        std::os::unix::fs::symlink(&managed, &alias).unwrap();
        assert!(managed_skill(&home, &alias));
        assert!(managed_skill(&home, &managed));
        assert!(!managed_skill(&home, &home.join("other")));
        std::fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn scalar_values_stay_strings_in_yaml() {
        assert_eq!(yaml_scalar("123"), "\"123\"");
        assert_eq!(yaml_scalar("true"), "\"true\"");
        assert_eq!(yaml_scalar("ordinary words"), "\"ordinary words\"");
    }

    #[cfg(unix)]
    #[test]
    fn an_import_cannot_follow_a_link_into_its_destination() {
        let root = test_dir();
        let from = root.join("source");
        let target_root = root.join("target");
        let to = target_root.join("copy");
        std::fs::create_dir(&from).unwrap();
        std::fs::create_dir(&target_root).unwrap();
        std::os::unix::fs::symlink(&target_root, from.join("link")).unwrap();
        assert!(copy_dir(&from, &to).is_err());
        assert!(!to.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn review_quoted_yaml_comments_do_not_become_description_text() {
        assert_eq!(
            field(
                "description: \"Review changes\" # explanation\n",
                "description"
            )
            .unwrap(),
            "Review changes"
        );
        assert_eq!(
            field(
                "description: 'Review changes' # explanation\n",
                "description"
            )
            .unwrap(),
            "Review changes"
        );
    }

    #[tokio::test]
    async fn review_body_only_edit_keeps_a_different_folder_name() {
        let root = test_dir();
        let folder = root.join("folder-name");
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(
            folder.join("SKILL.md"),
            "---\nname: declared-name\ndescription: Review changes\n---\nbody",
        )
        .unwrap();
        let doc = SkillDocument {
            name: "declared-name".into(),
            description: "Review changes".into(),
            body: "updated".into(),
        };
        let saved = save_at(&folder, &doc).await.unwrap();
        let kept = folder.exists();
        std::fs::remove_dir_all(root).unwrap();
        assert!(kept, "body-only edit moved the folder to {saved}");
    }

    #[test]
    fn review_pi_discovery_keeps_nested_custom_and_package_provenance() {
        let answer = json!({"commands": [
            {"source":"extension", "name":"ignore"},
            {"source":"skill", "name":"skill:nested", "description":"Nested", "sourceInfo":{"path":"/project/.pi/skills/group/nested/SKILL.md","scope":"project","origin":"top-level"}},
            {"source":"skill", "name":"skill:custom", "description":"Custom", "sourceInfo":{"path":"/custom/path/custom.md","scope":"user","origin":"top-level"}},
            {"source":"skill", "name":"skill:package", "description":"Package", "sourceInfo":{"path":"/packages/example/skills/tool/SKILL.md","scope":"user","origin":"package"}}
        ]});
        let roots = pi_roots_from_commands(&answer, Some(Path::new("/project")));
        assert_eq!(roots.len(), 3);
        assert_eq!(roots[0].project.as_deref(), Some("/project"));
        assert_eq!(roots[0].skills[0].path, "/project/.pi/skills/group/nested");
        assert_eq!(roots[1].skills[0].path, "/custom/path/custom.md");
        assert!(!roots[2].writable);
        assert!(roots[2].skills[0].locked.is_some());
        let mut merged = roots.clone();
        merge_pi_roots(&mut merged, roots);
        assert_eq!(merged.len(), 3);
    }

    #[tokio::test]
    async fn review_body_only_edits_preserve_yaml_comments_and_direct_files() {
        let root = test_dir();
        let file = root.join("custom.md");
        let frontmatter = "name: declared-name\ndescription: \"Review changes\" # explanation\nmetadata:\n  flag: true\n";
        std::fs::write(&file, format!("---\n{frontmatter}---\nold")).unwrap();
        let doc = SkillDocument {
            name: "declared-name".into(),
            description: "Review changes".into(),
            body: "updated".into(),
        };
        save_at(&file, &doc).await.unwrap();
        let saved = std::fs::read_to_string(&file).unwrap();
        assert_eq!(split_frontmatter(&saved).0, Some(frontmatter));
        assert!(saved.ends_with("updated\n"));
        std::fs::write(&file, "---\ndescription: [broken\n---\nkeep").unwrap();
        assert!(save_at(&file, &doc).await.is_err());
        assert!(std::fs::read_to_string(&file).unwrap().ends_with("keep"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn review_claude_plugins_honor_enabled_scope_extra_paths_and_errors() {
        let home = test_dir();
        let project = home.join("project");
        let plugin = home.join("plugin");
        std::fs::create_dir_all(home.join(".claude/plugins")).unwrap();
        std::fs::create_dir_all(project.join(".claude")).unwrap();
        std::fs::create_dir_all(plugin.join(".claude-plugin")).unwrap();
        std::fs::create_dir_all(plugin.join("extra-skills/example")).unwrap();
        std::fs::write(
            plugin.join("extra-skills/example/SKILL.md"),
            "---\nname: example\ndescription: Extra\n---\nbody",
        )
        .unwrap();
        std::fs::write(
            plugin.join(".claude-plugin/plugin.json"),
            r#"{"skills":["./extra-skills"]}"#,
        )
        .unwrap();
        std::fs::write(
            home.join(".claude/plugins/installed_plugins.json"),
            json!({"plugins":{"example@market":[{"installPath":plugin,"scope":"user"}]}})
                .to_string(),
        )
        .unwrap();
        std::fs::write(
            home.join(".claude/settings.json"),
            r#"{"enabledPlugins":{"example@market":false}}"#,
        )
        .unwrap();
        assert!(claude_plugin_skills(&home, &[project.clone()]).is_empty());
        std::fs::write(
            project.join(".claude/settings.json"),
            r#"{"enabledPlugins":{"example@market":true}}"#,
        )
        .unwrap();
        let roots = claude_plugin_skills(&home, &[project.clone()]);
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].project.as_deref(), project.to_str());
        assert_eq!(roots[0].skills[0].name, "example");
        assert!(roots[0].skills[0].locked.is_some());
        std::fs::write(
            home.join(".claude/plugins/installed_plugins.json"),
            "invalid",
        )
        .unwrap();
        assert!(claude_plugin_skills(&home, &[project])[0].error.is_some());
        std::fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn review_numeric_looking_metadata_round_trips_as_text() {
        for value in ["0xff", "0o777", ".inf", "1_000", "true", "ordinary words"] {
            let doc = SkillDocument {
                name: "0xff".into(),
                description: value.into(),
                body: String::new(),
            };
            let text = compose(None, &doc).unwrap();
            let fields = metadata(split_frontmatter(&text).0).unwrap();
            assert_eq!(fields.get("name").and_then(|v| v.as_str()), Some("0xff"));
            assert_eq!(
                fields.get("description").and_then(|v| v.as_str()),
                Some(value)
            );
        }
    }

    #[test]
    fn review_pi_managed_skills_stay_read_only_in_separate_groups() {
        let path = home().unwrap().join(".agents/skills/carbon/SKILL.md");
        let answer = json!({"commands":[{"source":"skill","name":"skill:carbon","sourceInfo":{"path":path,"scope":"user","origin":"top-level"}}]});
        let roots = pi_roots_from_commands(&answer, None);
        assert!(roots[0].skills[0].locked.is_some());
    }

    #[test]
    fn review_direct_plugin_skills_and_default_enablement_are_respected() {
        let home = test_dir();
        let plugin = home.join("plugin");
        std::fs::create_dir_all(home.join(".claude/plugins")).unwrap();
        std::fs::create_dir_all(plugin.join(".claude-plugin")).unwrap();
        std::fs::write(
            plugin.join("SKILL.md"),
            "---\nname: example\ndescription: Direct skill\n---\nbody",
        )
        .unwrap();
        std::fs::write(
            plugin.join(".claude-plugin/plugin.json"),
            r#"{"skills":".","defaultEnabled":false}"#,
        )
        .unwrap();
        std::fs::write(
            home.join(".claude/plugins/installed_plugins.json"),
            json!({"plugins":{"example@market":[{"installPath":plugin,"scope":"user"}]}})
                .to_string(),
        )
        .unwrap();
        assert!(claude_plugin_skills(&home, &[]).is_empty());
        std::fs::write(
            home.join(".claude/settings.json"),
            r#"{"enabledPlugins":{"example@market":true}}"#,
        )
        .unwrap();
        let roots = claude_plugin_skills(&home, &[]);
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].skills[0].name, "example");
        assert!(!roots[0].writable);
        std::fs::remove_dir_all(home).unwrap();
    }
}

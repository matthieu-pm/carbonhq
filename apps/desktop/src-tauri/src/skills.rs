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
    /// The folder's name, which is what the agents invoke it by.
    pub name: String,
    pub description: String,
    /// The folder, which is what every write takes.
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

struct Known {
    path: PathBuf,
    project: Option<PathBuf>,
    readers: Vec<Harness>,
    creatable: bool,
}

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
    for project in projects {
        for (rel, readers, creatable) in PROJECT_ROOTS {
            known.push(Known {
                path: project.join(rel),
                project: Some(project.clone()),
                readers: readers.to_vec(),
                creatable: *creatable,
            });
        }
    }
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
    let known = known_roots().await?;
    let codex_extra = codex_plugin_skills(&home);

    let walked = tokio::task::spawn_blocking({
        let home = home.clone();
        move || {
            let mut roots = Vec::new();
            let mut targets = Vec::new();
            for k in &known {
                if k.creatable {
                    targets.push(root_of(k, Vec::new(), None));
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
            roots.extend(claude_plugin_skills(&home));
            (roots, targets)
        }
    })
    .await
    .map_err(|e| anyhow!("couldn't read the skill folders: {e}"))?;

    let (mut roots, targets) = walked;
    let walked_paths: Vec<String> = roots.iter().map(|r| r.path.clone()).collect();
    for root in codex_extra.await {
        if !walked_paths.contains(&root.path) {
            roots.push(root);
        }
    }
    Ok(SkillsListing { roots, targets })
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
            let description = frontmatter
                .and_then(|f| field(f, "description"))
                .unwrap_or_default();
            let linked = entry.file_type().map(|t| t.is_symlink()).unwrap_or(false);
            let locked = (carbon_home && name == "carbon")
                .then(|| "Managed by Carbon. Every launch rewrites it.".to_string())
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

/// Claude Code's plugins, from the file it keeps their install paths in.
fn claude_plugin_skills(home: &Path) -> Vec<SkillRoot> {
    let Ok(text) = std::fs::read_to_string(home.join(".claude/plugins/installed_plugins.json"))
    else {
        return Vec::new();
    };
    let Ok(installed) = serde_json::from_str::<Value>(&text) else {
        return Vec::new();
    };
    let Some(plugins) = installed.get("plugins").and_then(Value::as_object) else {
        return Vec::new();
    };
    let mut roots = Vec::new();
    for (id, installs) in plugins {
        let name = id.split('@').next().unwrap_or(id);
        for install in installs.as_array().into_iter().flatten() {
            let Some(path) = install.get("installPath").and_then(Value::as_str) else {
                continue;
            };
            let dir = Path::new(path).join("skills");
            if let Ok(skills) = walk(&dir, false) {
                if !skills.is_empty() {
                    let why = format!("From the {name} plugin");
                    roots.push(locked_root(
                        &dir,
                        &format!("Plugin: {name}"),
                        vec![Claude],
                        skills,
                        &why,
                    ));
                }
            }
        }
    }
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

/// One top-level scalar out of YAML frontmatter, the handful of shapes skills
/// are written in: plain, quoted, folded (`>`) and literal (`|`), and a plain
/// value continued on indented lines. Not a YAML parser; a shape it misreads
/// costs a description line, and the file is never rewritten from it alone.
fn field(frontmatter: &str, key: &str) -> Option<String> {
    let lines: Vec<&str> = frontmatter.lines().collect();
    let start = lines.iter().position(|l| {
        l.strip_prefix(key)
            .is_some_and(|rest| rest.starts_with(':'))
    })?;
    let first = lines[start][key.len() + 1..].trim();
    let continued: Vec<&str> = lines[start + 1..]
        .iter()
        .take_while(|l| l.is_empty() || l.starts_with(' ') || l.starts_with('\t'))
        .map(|l| l.trim())
        .collect();
    let value = match first.chars().next() {
        Some('|') => continued.join("\n").trim_end().to_string(),
        Some('>') => continued.join(" ").trim().to_string(),
        Some('"') => {
            let joined = std::iter::once(first)
                .chain(continued.iter().copied())
                .collect::<Vec<_>>()
                .join(" ");
            serde_json::from_str::<String>(joined.trim())
                .unwrap_or_else(|_| joined.trim_matches('"').to_string())
        }
        Some('\'') => {
            let joined = std::iter::once(first)
                .chain(continued.iter().copied())
                .collect::<Vec<_>>()
                .join(" ");
            let inner = joined.trim();
            inner
                .strip_prefix('\'')
                .and_then(|s| s.strip_suffix('\''))
                .unwrap_or(inner)
                .replace("''", "'")
        }
        _ => std::iter::once(first)
            .chain(continued.iter().copied())
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(" "),
    };
    Some(value)
}

/// A YAML scalar for `value`, quoted only where plain would misparse. JSON's
/// string syntax is valid YAML double-quoted.
fn yaml_scalar(value: &str) -> String {
    let plain = !value.is_empty()
        && !matches!(
            value.to_ascii_lowercase().as_str(),
            "true" | "false" | "null" | "~" | "yes" | "no" | "on" | "off"
        )
        && value.parse::<f64>().is_err()
        && value.trim() == value
        && !value.contains(": ")
        && !value.contains(" #")
        && !value.contains('\n')
        && !value.ends_with(':')
        && !value.starts_with(|c: char| "-?:,[]{}#&*!|>'\"%@`".contains(c));
    if plain {
        value.to_string()
    } else {
        serde_json::to_string(value).unwrap_or_default()
    }
}

/// The frontmatter with `name` and `description` set and every other key —
/// `allowed-tools`, `metadata`, whatever an agent added — kept as written.
fn with_fields(frontmatter: Option<&str>, name: &str, description: &str) -> String {
    let mut kept = Vec::new();
    let mut skipping = false;
    for line in frontmatter.unwrap_or("").lines() {
        let top_level = !line.starts_with(' ') && !line.starts_with('\t') && !line.is_empty();
        if top_level {
            skipping = line.starts_with("name:") || line.starts_with("description:");
        }
        if !skipping {
            kept.push(line);
        }
    }
    let mut out = format!(
        "---\nname: {}\ndescription: {}\n",
        yaml_scalar(name),
        yaml_scalar(description)
    );
    for line in kept {
        out.push_str(line);
        out.push('\n');
    }
    out.push_str("---\n");
    out
}

fn compose(frontmatter: Option<&str>, doc: &SkillDocument) -> String {
    let mut out = with_fields(frontmatter, doc.name.trim(), doc.description.trim());
    let body = doc.body.trim_start_matches('\n');
    if !body.is_empty() {
        out.push('\n');
        out.push_str(body);
        if !body.ends_with('\n') {
            out.push('\n');
        }
    }
    out
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
    if !path.join("SKILL.md").is_file() {
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
    let text = tokio::fs::read_to_string(dir.join("SKILL.md"))
        .await
        .with_context(|| format!("couldn't read {}/SKILL.md", dir.display()))?;
    let (frontmatter, body) = split_frontmatter(&text);
    let folder = dir
        .file_name()
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
    if let Err(err) = tokio::fs::write(dir.join("SKILL.md"), compose(None, &skill)).await {
        let _ = tokio::fs::remove_dir(&dir).await;
        return Err(anyhow::Error::from(err)
            .context("couldn't write SKILL.md")
            .into());
    }
    Ok(dir.to_string_lossy().into_owned())
}

/// Rewrites a skill's frontmatter and body, renaming its folder when the name
/// moved — the folder's name is what the agents invoke it by.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn save_skill(path: String, skill: SkillDocument) -> Result<String, Fail> {
    let _guard = WRITE_LOCK.lock().await;
    let _across = crate::store::lock_across_processes("agent-skills").await;
    let dir = editable_skill(&path).await?;
    save_at(&dir, &skill).await.map_err(Into::into)
}

/// Check the destination before writing, and restore the folder on a failed edit.
async fn save_at(dir: &Path, skill: &SkillDocument) -> Result<String> {
    let name = skill.name.trim();
    let renamed = dir.file_name().is_some_and(|n| n.to_string_lossy() != name);
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
    let text = tokio::fs::read_to_string(dir.join("SKILL.md")).await?;
    let (frontmatter, _) = split_frontmatter(&text);
    let contents = compose(frontmatter, skill);
    if renamed {
        tokio::fs::rename(dir, &to)
            .await
            .context("couldn't rename the skill")?;
    }
    let written: Result<()> = async {
        let file = tokio::fs::canonicalize(to.join("SKILL.md")).await?;
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
        let out = compose(Some(old), &doc);
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
        assert_eq!(yaml_scalar("ordinary words"), "ordinary words");
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
}

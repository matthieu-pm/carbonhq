//! Images with a known source in Spaces or a Carbon session.

use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{self, BufRead, Seek, SeekFrom},
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
    time::SystemTime,
};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;

use super::PagesStore;
use crate::{
    events::{AgentEvent, AgentEventPayload},
    harness::Harness,
    store::SessionIndexItem,
};

pub(super) const UPLOADS: &str = "gallery";

#[derive(Serialize, ts_rs::TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct SpaceImage {
    name: String,
    path: PathBuf,
    modified: u64,
    project_paths: Vec<String>,
    source_title: String,
    page_id: Option<String>,
    session_id: Option<String>,
}

fn modified(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64)
}

const GENERATOR_TOOLS: [&str; 4] = [
    "imagegen",
    "generate_image",
    "generate_images",
    "image_generation",
];

/// Matches the generator itself, including Claude Code’s MCP-qualified spelling.
pub(crate) fn generation_tool(name: &str) -> bool {
    name.rsplit("__")
        .next()
        .is_some_and(|tool| GENERATOR_TOOLS.contains(&tool))
}

#[derive(Clone)]
struct ToolImage {
    event_id: String,
    index: usize,
    path: PathBuf,
}

struct CachedOutputs {
    inode: (u64, u64),
    offset: u64,
    modified: SystemTime,
    pending: HashSet<String>,
    images: Vec<ToolImage>,
}

static OUTPUTS: LazyLock<Mutex<HashMap<PathBuf, CachedOutputs>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Old MCP results kept the bytes inline. Only recover blocks from a matched, successful generator call.
fn archived_result(
    event_id: &str,
    result: crate::events::ToolResult,
    dir: &Path,
) -> io::Result<Vec<ToolImage>> {
    if result.is_error
        || result
            .structured
            .as_ref()
            .is_some_and(|s| s["isError"] == true)
    {
        return Ok(Vec::new());
    }
    let mut paths: Vec<PathBuf> = result
        .images
        .into_iter()
        .filter_map(|image| image.path.map(PathBuf::from))
        .filter(|path| path.parent() == Some(dir))
        .collect();
    if paths.is_empty() {
        if let (Ok(id), Some(blocks)) = (
            uuid::Uuid::parse_str(event_id),
            result
                .structured
                .as_ref()
                .and_then(|r| r["content"].as_array()),
        ) {
            for (index, block) in blocks.iter().enumerate() {
                if block["type"] != "image" {
                    continue;
                }
                let ext = match block["mimeType"].as_str() {
                    Some("image/png") => "png",
                    Some("image/jpeg") => "jpg",
                    Some("image/webp") => "webp",
                    Some("image/gif") => "gif",
                    _ => continue,
                };
                let Some(encoded) = block["data"].as_str() else {
                    continue;
                };
                let path = dir.join(format!("{id}-{index}.{ext}"));
                if !path.is_file() {
                    let Ok(bytes) = STANDARD.decode(encoded) else {
                        continue;
                    };
                    fs::create_dir_all(dir)?;
                    crate::store::write_private_atomic(&path, &bytes)?;
                }
                paths.push(path);
            }
        }
    }
    Ok(paths
        .into_iter()
        .enumerate()
        .map(|(index, path)| ToolImage {
            event_id: event_id.into(),
            index,
            path,
        })
        .collect())
}

/// Sessions append to their log. Keep unfinished calls and resume at the last complete line.
fn tool_outputs(log: &Path, attachments: &Path) -> io::Result<Vec<ToolImage>> {
    let file = match fs::File::open(log) {
        Ok(file) => file,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e),
    };
    let meta = file.metadata()?;
    let stamp = meta.modified()?;
    let inode = (meta.dev(), meta.ino());
    let empty = || CachedOutputs {
        inode,
        modified: stamp,
        offset: 0,
        pending: HashSet::new(),
        images: Vec::new(),
    };
    let mut cache = OUTPUTS.lock().unwrap();
    let state = cache.entry(log.to_owned()).or_insert_with(empty);
    if state.inode != inode
        || meta.len() < state.offset
        || (meta.len() == state.offset && stamp != state.modified)
    {
        *state = empty();
    }
    if state.offset < meta.len() {
        let mut reader = io::BufReader::new(file);
        reader.seek(SeekFrom::Start(state.offset))?;
        let mut line = String::new();
        while reader.read_line(&mut line)? > 0 && line.ends_with('\n') {
            if (line.contains("\"tool_call_started\"")
                && GENERATOR_TOOLS.iter().any(|name| line.contains(name)))
                || (!state.pending.is_empty() && line.contains("\"tool_call_completed\""))
            {
                if let Ok(event) = serde_json::from_str::<AgentEvent>(&line) {
                    match event.payload {
                        AgentEventPayload::ToolCallStarted { call_id, name, .. }
                            if generation_tool(&name) =>
                        {
                            state.pending.insert(call_id);
                        }
                        AgentEventPayload::ToolCallCompleted { call_id, result }
                            if state.pending.contains(&call_id) =>
                        {
                            state
                                .images
                                .extend(archived_result(&event.id, result, attachments)?);
                            state.pending.remove(&call_id);
                        }
                        _ => {}
                    }
                }
            }
            state.offset += line.len() as u64;
            line.clear();
        }
    }
    state.modified = stamp;
    Ok(state.images.clone())
}

fn files(dir: &Path) -> io::Result<Vec<fs::DirEntry>> {
    match fs::read_dir(dir) {
        Ok(entries) => entries.collect(),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e),
    }
}

/// Copy only native generator output from the indexed thread. Keep a finished copy if Codex cleans up.
fn codex_outputs(source: Option<&Path>, archived: &Path) -> io::Result<Vec<PathBuf>> {
    if let Some(source) = source.filter(|path| fs::symlink_metadata(path).is_ok_and(|m| m.is_dir()))
    {
        for entry in files(source)? {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if !entry.file_type()?.is_file() || !name.ends_with(".png") {
                continue;
            }
            let target = archived.join(name.as_ref());
            if !target.exists() {
                fs::create_dir_all(archived)?;
                let tmp = archived.join(format!("{}.part", uuid::Uuid::new_v4()));
                let copy = fs::copy(entry.path(), &tmp).and_then(|_| {
                    let modified = entry.metadata()?.modified()?;
                    fs::File::open(&tmp)?.set_modified(modified)?;
                    fs::rename(&tmp, &target)
                });
                if let Err(error) = copy {
                    let _ = fs::remove_file(tmp);
                    return Err(error);
                }
            }
        }
    }
    Ok(files(archived)?
        .into_iter()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|s| s == "png"))
        .collect())
}

/// Both Codex protocols report native image generation as an effectful item.
pub(crate) fn is_native_generation(item: &serde_json::Value) -> bool {
    item["type"] == "imageGeneration"
        || (item["type"] == "extension" && item["kind"] == "image_gen.generation")
}

/// A generator can return bytes before the agent moves the file into its project.
pub(crate) async fn capture_codex_output(
    session_id: &str,
    item: &serde_json::Value,
) -> Result<bool, String> {
    if !is_native_generation(item) {
        return Ok(false);
    }
    if item["status"] != "completed" {
        return Ok(false);
    }
    let Some(encoded) = item["result"].as_str().filter(|data| !data.is_empty()) else {
        return Ok(false);
    };
    let name = item["savedPath"]
        .as_str()
        .and_then(|s| Path::new(s).file_name())
        .and_then(|s| s.to_str())
        .filter(|name| name.ends_with(".png"))
        .map(str::to_owned)
        .or_else(|| {
            item["id"]
                .as_str()
                .filter(|id| {
                    !id.is_empty()
                        && id
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
                })
                .map(|id| format!("{id}.png"))
        })
        .ok_or("Missing generated image name.")?;
    let dir = crate::store::get_home_app_dir()
        .await
        .map_err(|e| e.to_string())?
        .join("attachments")
        .join(session_id)
        .join("generated");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| e.to_string())?;
    let target = dir.join(name);
    if !tokio::fs::try_exists(&target)
        .await
        .map_err(|e| e.to_string())?
    {
        let bytes = STANDARD.decode(encoded).map_err(|e| e.to_string())?;
        super::atomic(target, bytes).await?;
    }
    Ok(true)
}

fn session_images(
    home: &Path,
    generated: Option<&Path>,
    mut sessions: Vec<SessionIndexItem>,
) -> ImageListing {
    let mut listing = ImageListing::default();
    let mut seen = HashSet::new();
    // Forks retain the original event IDs. Prefer the earliest surviving session that owns the output.
    sessions.sort_by(|a, b| a.created.cmp(&b.created));
    for session in sessions {
        if uuid::Uuid::parse_str(&session.session_id).is_err() {
            continue;
        }
        let attachments = home.join("attachments").join(&session.session_id);
        let mut paths = Vec::new();
        if session.harness == Harness::Codex {
            let source = session
                .thread_id
                .as_deref()
                .filter(|_| session.fork_from.is_none())
                .and_then(|s| uuid::Uuid::parse_str(s).ok())
                .and_then(|thread| generated.map(|root| root.join(thread.to_string())));
            if let Some(outputs) = listing.available(codex_outputs(
                source.as_deref(),
                &attachments.join("generated"),
            )) {
                paths.extend(outputs);
            }
        }
        let log = home
            .join("sessions")
            .join(format!("{}.jsonl", session.session_id));
        if let Some(outputs) = listing.available(tool_outputs(&log, &attachments)) {
            for image in outputs {
                if image.path.is_file() && seen.insert((image.event_id, image.index)) {
                    paths.push(image.path);
                }
            }
        }
        paths.sort();
        paths.dedup();
        for path in paths {
            listing.images.push(SpaceImage {
                name: path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
                modified: modified(&path),
                path,
                project_paths: vec![session.project_path.clone()],
                source_title: session.title.clone(),
                session_id: Some(session.session_id.clone()),
                page_id: None,
            });
        }
    }
    listing
}

/// Standalone uploads use the same chunk and retry contract as Page attachments.
pub async fn write_space_image(
    sink: crate::sink::Sink,
    name: String,
    asset_id: String,
    offset: u64,
    data: String,
    complete: bool,
) -> Result<super::PageAssetWrite, String> {
    let progress = PagesStore::open()
        .await?
        .write_asset(UPLOADS, name, &asset_id, offset, data, complete)
        .await?;
    if progress.asset.is_some() {
        let _ = sink.emit("space_images_changed", ());
    }
    Ok(progress)
}

#[derive(Default, Serialize, ts_rs::TS)]
#[ts(export, export_to = "events.ts")]
pub struct ImageListing {
    images: Vec<SpaceImage>,
    unavailable: usize,
}

impl ImageListing {
    fn available<T, E: std::fmt::Display>(&mut self, result: Result<T, E>) -> Option<T> {
        result
            .map_err(|error| {
                self.unavailable += 1;
                eprintln!("Could not read a gallery source: {error}");
            })
            .ok()
    }

    async fn add_uploads(&mut self, store: &PagesStore) {
        let Some(entries) = self.available(files(&store.assets)) else {
            return;
        };
        for entry in entries {
            if !entry.file_type().is_ok_and(|t| t.is_dir()) {
                continue;
            }
            let owner = entry.file_name().to_string_lossy().into_owned();
            let page = if owner == UPLOADS {
                None
            } else {
                if uuid::Uuid::parse_str(&owner).is_err() {
                    continue;
                }
                let Some(page) = self.available(store.read(&owner).await) else {
                    continue;
                };
                if page.trashed {
                    continue;
                }
                Some(page)
            };
            let Some(ids) = self.available(store.asset_ids(&owner).await) else {
                continue;
            };
            for id in ids {
                let Some(asset) = self.available(store.read_asset(&owner, &id).await) else {
                    continue;
                };
                if asset.mime_type.starts_with("image/") {
                    self.images.push(SpaceImage {
                        name: asset.name,
                        modified: modified(Path::new(&asset.path)),
                        path: asset.path.into(),
                        project_paths: page
                            .as_ref()
                            .map(|p| p.project_paths.clone())
                            .unwrap_or_default(),
                        source_title: page.as_ref().map(|p| p.title.clone()).unwrap_or_default(),
                        page_id: page.as_ref().map(|p| p.id.clone()),
                        session_id: None,
                    });
                }
            }
        }
    }
}

/// Resolves each row on its owning server so previews use the existing attachment route.
pub async fn list_space_images() -> Result<ImageListing, String> {
    let store = PagesStore::open().await?;
    let home = crate::store::get_home_app_dir()
        .await
        .map_err(|e| e.to_string())?;
    let generated = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::home_dir().map(|home| home.join(".codex")))
        .map(|home| home.join("generated_images"));
    let mut listing = ImageListing::default();
    if let Some(sessions) = listing.available(crate::store::read_index().await) {
        listing = tokio::task::spawn_blocking(move || {
            session_images(&home, generated.as_deref(), sessions)
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    listing.add_uploads(&store).await;
    Ok(listing)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn generation_results_exclude_reference_photos_reads_and_failed_calls() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&dir).unwrap();
        let log = dir.join("events.jsonl");
        let reference = dir.join("photo.png");
        let poster = dir.join("poster.png");
        fs::write(&reference, b"reference").unwrap();
        fs::write(&poster, b"poster").unwrap();
        let start = |id, name| json!({"type":"tool_call_started","callId":id,"name":name,"toolType":"mcp","input":{}});
        let end = |id, path: &Path, error| {
            json!({"type":"tool_call_completed","callId":id,"result":{
                "text":"","isError":error,"images":[{"path":path}]
            }})
        };
        let events = [
            json!({"type":"user_message","text":"Make a poster","images":[{"path":reference}]}),
            start("read", "view_image"),
            start("failed", "generate_image"),
            start("create", "mcp__image_gen__imagegen"),
            end("read", &reference, false),
            end("failed", &reference, true),
            end("create", &poster, false),
        ];
        let lines: Vec<_> = events.into_iter().enumerate().map(|(seq, payload)| json!({
            "id":seq.to_string(),"sessionId":"s","harness":"codex","seq":seq,"ts":"","payload":payload
        }).to_string()).collect();
        fs::write(&log, format!("{}\n", lines.join("\n"))).unwrap();
        assert_eq!(
            tool_outputs(&log, &dir)
                .unwrap()
                .into_iter()
                .map(|i| i.path)
                .collect::<Vec<_>>(),
            vec![poster]
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn restores_inline_generation_history_once_across_forks() {
        use crate::{events::ApprovalPolicy, models::ModelId};
        let home = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let logs = home.join("sessions");
        fs::create_dir_all(&logs).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let mut parent = SessionIndexItem::new(
            &id,
            Harness::Codex,
            "/p",
            "/p",
            None,
            None,
            "Poster",
            ModelId::new("codex"),
            None,
            ApprovalPolicy::Auto,
            false,
            None,
        );
        parent.created = "2026-01-01".into();
        let thread = uuid::Uuid::new_v4().to_string();
        parent.thread_id = Some(thread.clone());
        let mut fork = parent.fork(&uuid::Uuid::new_v4().to_string(), None);
        fork.thread_id = parent.thread_id.clone();
        let native = home.join("codex").join(thread);
        fs::create_dir_all(&native).unwrap();
        fs::write(native.join("native.png"), b"native").unwrap();
        let index = vec![fork.clone(), parent.clone()];
        let payloads = [
            json!({"type":"tool_call_started","callId":"g","name":"generate_image","toolType":"mcp","input":{}}),
            json!({"type":"tool_call_completed","callId":"g","result":{"text":"","structured":{"content":[
                {"type":"image","mimeType":"image/png","data":STANDARD.encode(b"poster")}]}}}),
        ];
        let events: Vec<_> = payloads
            .iter()
            .enumerate()
            .map(|(seq, payload)| {
                json!({"id": uuid::Uuid::new_v4().to_string(),
            "sessionId":id,"seq":seq,"harness":"codex","ts":"","payload":payload})
                .to_string()
            })
            .collect();
        let log = logs.join(format!("{id}.jsonl"));
        fs::write(&log, format!("{}\n", events[0])).unwrap();
        let list = || session_images(&home, Some(&home.join("codex")), index.clone());
        assert_eq!(list().images.len(), 1);
        use std::io::Write;
        writeln!(
            fs::OpenOptions::new().append(true).open(&log).unwrap(),
            "{}",
            events[1]
        )
        .unwrap();
        fs::write(
            logs.join(format!("{}.jsonl", fork.session_id)),
            format!("{}\n", events.join("\n").replace(&id, &fork.session_id)),
        )
        .unwrap();
        let listing = list();
        assert_eq!(listing.unavailable, 0);
        assert_eq!(listing.images.len(), 2);
        assert!(listing
            .images
            .iter()
            .all(|row| row.session_id.as_deref() == Some(id.as_str())));
        assert!(listing
            .images
            .iter()
            .any(|row| fs::read(&row.path).unwrap() == b"poster"));
        assert_eq!(list().images.len(), 2);
        fs::remove_dir_all(home).unwrap();
    }

    #[tokio::test]
    async fn missing_page_asset_preserves_other_images() {
        let home = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let store = PagesStore {
            root: home.join("pages"),
            assets: home.join("attachments/pages"),
        };
        let page = store
            .create("Brief".into(), String::new(), vec![])
            .await
            .unwrap();
        for (owner, name) in [
            (page.id.as_str(), "reference.pdf"),
            (page.id.as_str(), "cover.png"),
            (UPLOADS, "upload.png"),
        ] {
            let asset = store
                .write_asset(
                    owner,
                    name.into(),
                    &uuid::Uuid::new_v4().to_string(),
                    0,
                    STANDARD.encode(b"\x89PNG\r\n\x1a\n"),
                    true,
                )
                .await
                .unwrap()
                .asset
                .unwrap();
            if name.ends_with(".pdf") {
                fs::remove_file(asset.path).unwrap();
            }
        }
        let invalid = store
            .write_asset(
                UPLOADS,
                "empty.png".into(),
                &uuid::Uuid::new_v4().to_string(),
                0,
                String::new(),
                true,
            )
            .await;
        assert!(invalid.is_err());
        let mut listing = ImageListing::default();
        listing.add_uploads(&store).await;
        assert_eq!(listing.unavailable, 1);
        assert_eq!(listing.images.len(), 2);
        assert!(listing
            .images
            .iter()
            .any(|row| row.page_id.as_deref() == Some(page.id.as_str())));
        assert!(listing
            .images
            .iter()
            .any(|row| row.name == "upload.png" && row.page_id.is_none()));
        assert!(store.list_assets(&page.id).await.is_err());
        fs::remove_dir_all(home).unwrap();
    }

    #[tokio::test]
    async fn codex_completion_keeps_the_poster_when_the_generator_moves_it() {
        let session = uuid::Uuid::new_v4().to_string();
        let item = json!({"type":"extension","kind":"image_gen.generation","status":"completed",
            "id":"exec-poster","savedPath":"/generator/exec-poster.png","result":STANDARD.encode(b"poster"),
            "inputImages":[{"result":STANDARD.encode(b"photo")}]});
        assert!(capture_codex_output(&session, &item).await.unwrap());
        assert!(capture_codex_output(&session, &item).await.unwrap());
        let dir = crate::store::get_home_app_dir()
            .await
            .unwrap()
            .join("attachments")
            .join(session);
        let paths = codex_outputs(None, &dir.join("generated")).unwrap();
        assert_eq!(paths.len(), 1);
        assert_eq!(fs::read(&paths[0]).unwrap(), b"poster");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn backfilled_generations_survive_cleanup_without_copying_references() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let source = root.join("codex/generated_images/thread");
        let archive = root.join("carbon/attachments/session/generated");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("call_poster.png"), b"poster").unwrap();
        fs::write(root.join("photo.png"), b"reference").unwrap();
        std::os::unix::fs::symlink(root.join("photo.png"), source.join("linked.png")).unwrap();
        assert_eq!(
            codex_outputs(Some(&source), &archive).unwrap(),
            vec![archive.join("call_poster.png")]
        );
        fs::remove_dir_all(&source).unwrap();
        assert_eq!(
            codex_outputs(Some(&source), &archive).unwrap(),
            vec![archive.join("call_poster.png")]
        );
        fs::remove_dir_all(root).unwrap();
    }
}

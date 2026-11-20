//! Images with a known source in Spaces or a Carbon session.

use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{self, BufRead},
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

#[derive(Serialize)]
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

/// Matches the generator itself, including Claude Code’s MCP-qualified spelling.
pub(crate) fn generation_tool(name: &str) -> bool {
    matches!(
        name.rsplit("__").next(),
        Some("imagegen" | "generate_image" | "generate_images" | "image_generation")
    )
}

struct CachedOutputs {
    length: u64,
    modified: SystemTime,
    paths: Vec<PathBuf>,
}

static OUTPUTS: LazyLock<Mutex<HashMap<PathBuf, CachedOutputs>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Earlier logs also contain image reads and chat inputs. Only a successful generation call owns an output.
fn tool_outputs(log: &Path, attachments: &Path) -> io::Result<Vec<PathBuf>> {
    let file = fs::File::open(log)?;
    let meta = file.metadata()?;
    let stamp = meta.modified()?;
    if let Some(cached) = OUTPUTS.lock().unwrap().get(log) {
        if cached.length == meta.len() && cached.modified == stamp {
            return Ok(cached.paths.clone());
        }
    }
    let mut pending = HashSet::new();
    let mut paths = Vec::new();
    let mut reader = io::BufReader::new(file);
    let mut line = String::new();
    while reader.read_line(&mut line)? > 0 {
        let started = line.contains("\"tool_call_started\"")
            && (line.contains("imagegen")
                || line.contains("generate_image")
                || line.contains("image_generation"));
        if started || (!pending.is_empty() && line.contains("\"tool_call_completed\"")) {
            if let Ok(event) = serde_json::from_str::<AgentEvent>(&line) {
                match event.payload {
                    AgentEventPayload::ToolCallStarted { call_id, name, .. }
                        if generation_tool(&name) =>
                    {
                        pending.insert(call_id);
                    }
                    AgentEventPayload::ToolCallCompleted { call_id, result }
                        if pending.remove(&call_id) && !result.is_error =>
                    {
                        paths.extend(
                            result
                                .images
                                .into_iter()
                                .filter_map(|image| image.path.map(PathBuf::from))
                                .filter(|path| {
                                    path.parent() == Some(attachments) && path.is_file()
                                }),
                        );
                    }
                    _ => {}
                }
            }
        }
        line.clear();
    }
    OUTPUTS.lock().unwrap().insert(
        log.to_owned(),
        CachedOutputs {
            length: meta.len(),
            modified: stamp,
            paths: paths.clone(),
        },
    );
    Ok(paths)
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

/// A generator can return bytes before the agent moves the file into its project.
pub(crate) async fn capture_codex_output(
    session_id: &str,
    item: &serde_json::Value,
) -> Result<bool, String> {
    if item["type"] != "imageGeneration"
        && !(item["type"] == "extension" && item["kind"] == "image_gen.generation")
    {
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
    sessions: Vec<SessionIndexItem>,
) -> io::Result<Vec<SpaceImage>> {
    let mut rows = Vec::new();
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
                .and_then(|s| uuid::Uuid::parse_str(s).ok())
                .and_then(|thread| generated.map(|root| root.join(thread.to_string())));
            paths.extend(codex_outputs(
                source.as_deref(),
                &attachments.join("generated"),
            )?);
        }
        if files(&attachments)?
            .iter()
            .any(|e| e.file_type().is_ok_and(|t| t.is_file()))
        {
            let log = home
                .join("sessions")
                .join(format!("{}.jsonl", session.session_id));
            if log.is_file() {
                paths.extend(tool_outputs(&log, &attachments)?);
            }
        }
        paths.sort();
        paths.dedup();
        for path in paths {
            rows.push(SpaceImage {
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
    Ok(rows)
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

/// Resolves each row on its owning server so previews use the existing attachment route.
pub async fn list_space_images() -> Result<Vec<SpaceImage>, String> {
    let store = PagesStore::open().await?;
    let home = crate::store::get_home_app_dir()
        .await
        .map_err(|e| e.to_string())?;
    let sessions = crate::store::read_index()
        .await
        .map_err(|e| e.to_string())?;
    let generated = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::home_dir().map(|home| home.join(".codex")))
        .map(|home| home.join("generated_images"));
    let mut rows =
        tokio::task::spawn_blocking(move || session_images(&home, generated.as_deref(), sessions))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
    let mut owners = vec![(UPLOADS.to_string(), None)];
    for page in store.list(None, None, false).await? {
        owners.push((page.id.clone(), Some(page)));
    }
    for (owner, page) in owners {
        for asset in store.stored_assets(&owner).await? {
            if asset.mime_type.starts_with("image/") {
                rows.push(SpaceImage {
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
    Ok(rows)
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
        fs::write(&log, lines.join("\n")).unwrap();
        assert_eq!(tool_outputs(&log, &dir).unwrap(), vec![poster]);
        fs::remove_dir_all(dir).unwrap();
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

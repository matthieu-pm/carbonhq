use carbon_proto::{CanvasAction as Action, CanvasRequest};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    future::Future,
    sync::LazyLock,
};
use tokio::sync::Mutex;
use ts_rs::TS;

use super::{
    commands::announce,
    model::*,
    nodes, render,
    storage::{atomic, hash, Store},
};
use crate::sink::Sink;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CanvasPick {
    pub frame_id: String,
    pub node_id: Option<String>,
    #[serde(default)]
    pub bounds: Option<CanvasGeometry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CanvasFocus {
    pub id: String,
    pub project_path: String,
    pub revision: u64,
    pub picks: Vec<CanvasPick>,
    pub preview_frame_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Turn {
    id: String,
    session_id: String,
    project_path: String,
    focus: Option<CanvasFocus>,
    running: bool,
    editing: BTreeMap<String, BTreeSet<String>>,
    evidence: Vec<Value>,
}

tokio::task_local! { static FOCUS: Option<CanvasFocus>; }
static TURNS: LazyLock<Mutex<HashMap<String, Turn>>> = LazyLock::new(Default::default);

/// Task-local focus follows this send's awaits; a queued message stores its own copy.
pub async fn with_focus<T>(focus: Option<CanvasFocus>, future: impl Future<Output = T>) -> T {
    FOCUS.scope(focus, future).await
}

pub fn request_focus() -> Option<CanvasFocus> {
    FOCUS.try_with(Clone::clone).ok().flatten()
}

async fn persist(turn: &Turn) -> Result<(), String> {
    uuid(&turn.session_id)?;
    let path = crate::store::get_home_app_dir()
        .await
        .map_err(|e| e.to_string())?
        .join("canvas-turns")
        .join(format!("{}.json", turn.session_id));
    tokio::fs::create_dir_all(path.parent().ok_or("Invalid Canvas turn path.")?)
        .await
        .map_err(|e| e.to_string())?;
    atomic(path, serde_json::to_vec(turn).map_err(|e| e.to_string())?).await
}

async fn turn(session: &str) -> Result<Option<Turn>, String> {
    uuid(session)?;
    if let Some(turn) = TURNS.lock().await.get(session).cloned() {
        return Ok(Some(turn));
    }
    let path = crate::store::get_home_app_dir()
        .await
        .map_err(|e| e.to_string())?
        .join("canvas-turns")
        .join(format!("{session}.json"));
    match super::storage::read_bytes(&path, 2 * 1024 * 1024).await {
        Ok(bytes) => {
            let mut turn: Turn = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
            turn.running = false;
            turn.editing.clear();
            TURNS.lock().await.insert(session.into(), turn.clone());
            Ok(Some(turn))
        }
        Err(_) if !path.exists() => Ok(None),
        Err(error) => Err(error),
    }
}

async fn owned(store: &Store, session: &str, id: &str) -> Result<Canvas, String> {
    let item = crate::store::get_session_index_item(session)
        .await
        .map_err(|e| e.to_string())?
        .ok_or("No such Carbon session.")?;
    let identity = super::storage::project(&item.project_path).await?;
    if !store
        .list(Some(&identity.key))
        .await?
        .files
        .iter()
        .any(|f| f.id == id)
    {
        return Err("That canvas does not belong to this session's project.".into());
    }
    store.read(id).await
}

/// Resolve the view once when a prompt is delivered; steering cannot retarget a running turn.
pub async fn prepare_prompt(session: &str, has_references: bool) -> Result<CanvasPrompt, String> {
    let focus = if has_references { None } else { request_focus() };
    let previous = match turn(session).await {
        Ok(previous) => previous,
        Err(error) if focus.is_none() => {
            eprintln!("[canvas context] {error}");
            None
        }
        Err(error) => return Err(error),
    };
    if let Some(current) = previous.as_ref().filter(|t| t.running) {
        return Ok(CanvasPrompt {
            text: if has_references { String::new() } else { context_text(current).await? },
            turn: None,
        });
    }
    if focus.is_none() && previous.is_none() && !has_references {
        return Ok(CanvasPrompt {
            text: String::new(),
            turn: None,
        });
    }
    let item = crate::store::get_session_index_item(session)
        .await
        .map_err(|e| e.to_string())?
        .ok_or("No such Carbon session.")?;
    if let Some(focus) = &focus {
        let store = Store::open().await?;
        owned(&store, session, &focus.id).await?;
        if super::storage::project(&focus.project_path).await?.key
            != super::storage::project(&item.project_path).await?.key
        {
            return Err("Canvas selection belongs to another project.".into());
        }
        let captured = store
            .history(&focus.id, Some(focus.revision))
            .await?
            .remove(0);
        for pick in &focus.picks {
            let frame = captured
                .frames
                .iter()
                .find(|f| f.id == pick.frame_id)
                .ok_or("Selected frame is missing from the captured revision.")?;
            if pick
                .node_id
                .as_ref()
                .is_some_and(|id| nodes::find(&frame.content.nodes, id).is_none())
            {
                return Err("Selected layer is missing from the captured revision.".into());
            }
        }
    }
    let current = Turn {
        id: uuid::Uuid::now_v7().to_string(),
        session_id: session.into(),
        project_path: item.project_path,
        focus,
        running: true,
        editing: Default::default(),
        evidence: vec![],
    };
    let text = context_text(&current).await?;
    Ok(CanvasPrompt {
        text,
        turn: Some(current),
    })
}

pub struct CanvasPrompt {
    pub text: String,
    turn: Option<Turn>,
}

/// Publish the captured target only after prompt preparation has succeeded.
pub async fn commit_prompt(prompt: &CanvasPrompt, sink: &Sink) -> Result<(), String> {
    if let Some(turn) = &prompt.turn {
        persist(turn).await?;
        TURNS
            .lock()
            .await
            .insert(turn.session_id.clone(), turn.clone());
        publish(sink).await;
    }
    Ok(())
}

/// A failed send cannot pin the next message to a target the agent never received.
pub async fn abort_prompt(prompt: &CanvasPrompt, sink: &Sink) {
    if let Some(prepared) = &prompt.turn {
        let mut turns = TURNS.lock().await;
        if let Some(turn) = turns
            .get_mut(&prepared.session_id)
            .filter(|turn| turn.id == prepared.id)
        {
            turn.running = false;
            turn.editing.clear();
            if let Err(error) = persist(turn).await {
                eprintln!("[canvas send failed] {error}");
            }
        }
        drop(turns);
        publish(sink).await;
    }
}

async fn context_text(turn: &Turn) -> Result<String, String> {
    if turn.focus.is_none() {
        return Ok(String::new());
    }
    Ok(format!("\n\n<carbon_canvas_context>\n{}\nCanvas and selection are fixed for this turn. Use carbon canvas commands with explicit node IDs and expected revisions. A different canvas must belong to this session's project. Run carbon canvas tokens before choosing styles. Prefer a matching project token. In Canvas CSS, use var(--name, verified CSS fallback) so the design can render without project stylesheets. Screenshot each changed frame before finishing.\n</carbon_canvas_context>", context(turn).await.unwrap_or_else(|error| json!({"turnId":turn.id,"canvasId":turn.focus.as_ref().map(|f|&f.id),"unavailable":error}))))
}

async fn context(turn: &Turn) -> Result<Value, String> {
    let canvas = if let Some(focus) = &turn.focus {
        let store = Store::open().await?;
        owned(&store, &turn.session_id, &focus.id).await?;
        Some(
            store
                .history(&focus.id, Some(focus.revision))
                .await?
                .remove(0),
        )
    } else {
        None
    };
    Ok(
        json!({"turnId":turn.id,"sessionId":turn.session_id,"projectPath":turn.project_path,"running":turn.running,"canvas":canvas.as_ref().map(|c|json!({"id":c.id,"name":c.name,"revision":c.revision,"frames":frames(c)})),"selection":turn.focus.as_ref().map(|f| &f.picks),"previewFrameId":turn.focus.as_ref().and_then(|f|f.preview_frame_id.as_ref()),"evidence":turn.evidence}),
    )
}

/// Editor indicators are derived from live turns and explicitly cleared on completion or interruption.
pub async fn finish_turn(session: &str, sink: &Sink) {
    let mut turns = TURNS.lock().await;
    if let Some(turn) = turns.get_mut(session) {
        turn.running = false;
        turn.editing.clear();
        if let Err(error) = persist(turn).await {
            eprintln!("[canvas turn] {error}");
        }
    }
    drop(turns);
    publish(sink).await;
}

async fn publish(sink: &Sink) {
    let _ = sink.emit("canvas_editors", editors().await);
}

/// Reconnect reads this same projection rather than resurrecting stale persisted indicators.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn canvas_editors() -> Value {
    editors().await
}

async fn editors() -> Value {
    let turns = TURNS.lock().await;
    json!(turns.values().filter(|t| t.running).flat_map(|t| t.editing.iter().flat_map(move |(canvas, frames)| frames.iter().map(move |frame| json!({"canvasId":canvas,"frameId":frame,"sessionId":t.session_id,"turnId":t.id})))).collect::<Vec<_>>())
}

fn frames(canvas: &Canvas) -> Vec<Value> {
    canvas.frames.iter().map(|f| json!({"id":f.id,"name":f.name,"geometry":f.geometry,"contentRef":format!("sha256:{}",hash(&serde_json::to_vec(&f.content).unwrap_or_default())),"assetIds":f.content.asset_ids})).collect()
}

fn tree(nodes: &[CanvasNode]) -> Vec<Value> {
    nodes
        .iter()
        .map(|n| match n {
            CanvasNode::Element {
                id,
                name,
                tag,
                children,
                ..
            } => json!({"id":id,"name":name,"tag":tag,"children":tree(children)}),
            CanvasNode::Text { id, name, text, .. } => {
                json!({"id":id,"name":name,"text":text.chars().take(160).collect::<String>()})
            }
        })
        .collect()
}

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
fn markup(nodes: &[CanvasNode]) -> String {
    nodes
        .iter()
        .map(|n| match n {
            CanvasNode::Text { text, .. } => escape(text),
            CanvasNode::Element {
                id,
                tag,
                attributes,
                styles,
                children,
                extra,
                ..
            } => {
                let attributes = attributes
                    .iter()
                    .map(|(k, v)| format!(" {}=\"{}\"", k, escape(v)))
                    .collect::<String>();
                let styles = nodes::ordered_styles(styles, extra)
                    .into_iter()
                    .map(|(k, v)| format!("{k}:{v}"))
                    .collect::<Vec<_>>()
                    .join(";");
                format!(
                    "<{tag} data-canvas-id=\"{id}\"{attributes} style=\"{}\">{}</{tag}>",
                    escape(&styles),
                    markup(children)
                )
            }
        })
        .collect()
}

/// Agent requests derive ownership from the session; neither cwd nor a canvas ID can widen it.
pub async fn request(request: CanvasRequest, sink: &Sink) -> Result<Value, String> {
    let item = crate::store::get_session_index_item(&request.session_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or("No such Carbon session.")?;
    if matches!(request.action, Action::Tokens) {
        if request.canvas.is_some() || request.revision.is_some() {
            return Err("Project tokens are read from the session's checkout. Use get for a saved Canvas revision.".into());
        }
        let catalog = super::tokens::catalog(super::tokens::CanvasTokenSource::session(&item)).await?;
        return serde_json::to_value(catalog).map_err(|e| e.to_string());
    }
    let store = Store::open().await?;
    let mut current = turn(&request.session_id).await?;
    if current.is_none() {
        let snapshot = crate::store::get_session_by_id(&request.session_id, Some(1))
            .await
            .map_err(|e| format!("{e:?}"))?
            .ok_or("No such Carbon session.")?;
        let last_end = snapshot
            .events
            .iter()
            .rposition(|e| {
                e.subagent.is_none()
                    && matches!(
                        e.payload,
                        crate::events::AgentEventPayload::TurnCompleted { .. }
                    )
            })
            .map_or(0, |i| i + 1);
        let opening = snapshot.events[last_end..].iter().find(|e| {
            e.subagent.is_none()
                && matches!(
                    e.payload,
                    crate::events::AgentEventPayload::UserMessage { .. }
                )
        });
        let fresh = Turn {
            id: opening
                .map(|e| e.id.clone())
                .unwrap_or_else(|| uuid::Uuid::now_v7().to_string()),
            session_id: request.session_id.clone(),
            project_path: item.project_path.clone(),
            focus: None,
            running: opening.is_some(),
            editing: Default::default(),
            evidence: vec![],
        };
        persist(&fresh).await?;
        TURNS
            .lock()
            .await
            .insert(request.session_id.clone(), fresh.clone());
        current = Some(fresh);
    }
    match &request.action {
        Action::List => {
            let files = store
                .list(Some(
                    &super::storage::project(&item.project_path).await?.key,
                ))
                .await?
                .files;
            // Unreadable manifests cannot prove project ownership; only the app lists those problems.
            return Ok(json!({"files":files,"problems":[]}));
        }
        Action::Context => {
            return match &current {
                Some(current) => context(current).await,
                None => Ok(json!({"projectPath":item.project_path,"canvas":null})),
            }
        }
        Action::New { name } => {
            let canvas =
                super::create_canvas(sink.clone(), item.project_path.clone(), name.clone()).await?;
            if let Some(turn) = &mut current {
                if turn.focus.is_none() {
                    turn.focus = Some(CanvasFocus {
                        id: canvas.id.clone(),
                        project_path: item.project_path,
                        revision: canvas.revision,
                        picks: vec![],
                        preview_frame_id: None,
                    });
                    let mut turns = TURNS.lock().await;
                    if let Some(live) = turns
                        .get_mut(&request.session_id)
                        .filter(|t| t.id == turn.id)
                    {
                        live.focus = turn.focus.clone();
                        persist(live).await?;
                    }
                }
            }
            return Ok(json!({"id":canvas.id,"revision":canvas.revision,"name":canvas.name}));
        }
        _ => {}
    }
    let chosen = request.canvas.clone().or_else(||current.as_ref().and_then(|t|t.focus.as_ref().map(|f|f.id.clone()))).ok_or("No canvas was captured for this turn. Use canvas ls, then --canvas <id>, or canvas new.")?;
    let id = chosen.as_str();
    let live_canvas = owned(&store, &request.session_id, id).await?;
    let canvas = if matches!(request.action, Action::Get { .. } | Action::Shot { .. } | Action::Tree { .. } | Action::Frames) {
        match request.revision {
            Some(revision) => store.history(id, Some(revision)).await?.remove(0),
            None => live_canvas,
        }
    } else { live_canvas };
    let envelope = |data: Value| json!({"id":canvas.id,"name":canvas.name,"revision":canvas.revision,"data":data});
    match &request.action {
        Action::Frames => return Ok(envelope(json!(frames(&canvas)))),
        Action::Tree { node } => {
            let value = if let Some(node) = node {
                let frame = nodes::frame_for(&canvas, node)?;
                if frame.id == *node {
                    json!(tree(&frame.content.nodes))
                } else {
                    json!(tree(std::slice::from_ref(
                        nodes::find(&frame.content.nodes, node).unwrap()
                    )))
                }
            } else {
                json!(canvas.frames.iter().map(|f|json!({"id":f.id,"name":f.name,"geometry":f.geometry,"children":tree(&f.content.nodes)})).collect::<Vec<_>>())
            };
            return Ok(envelope(value));
        }
        Action::Get { node, styles } => {
            let frame = nodes::frame_for(&canvas, node)?;
            let nodes = if frame.id == *node {
                frame.content.nodes.as_slice()
            } else {
                std::slice::from_ref(nodes::find(&frame.content.nodes, node).unwrap())
            };
            let measured = if *styles {
                Some(render::inspect(&canvas, frame, node, false).await?)
            } else {
                None
            };
            return Ok(envelope(
                json!({"nodeId":node,"frameId":frame.id,"markup":markup(nodes),"css":frame.content.css,"tokens":canvas.tokens,"tokenReferences":super::tokens::links(nodes),"tokenSource":super::tokens::source(&frame.content),"computed":measured}),
            ));
        }
        Action::Shot { node } => {
            let frame = nodes::frame_for(&canvas, node)?;
            let mut result = render::inspect(&canvas, frame, node, true).await?;
            let evidence = json!({"id":uuid::Uuid::now_v7().to_string(),"canvasId":canvas.id,"revision":canvas.revision,"frameId":frame.id,"nodeId":node,"contentRef":hash(&serde_json::to_vec(&frame.content).map_err(|e|e.to_string())?),"timestamp":crate::events::now_rfc3339(),"kind":"screenshot_returned"});
            let bytes = result["data"].as_str().ok_or("Missing screenshot bytes.")?;
            use base64::Engine;
            let path = crate::store::get_home_app_dir()
                .await
                .map_err(|e| e.to_string())?
                .join("attachments")
                .join(&request.session_id)
                .join(format!("canvas-{}.png", evidence["id"].as_str().unwrap()));
            tokio::fs::create_dir_all(path.parent().ok_or("Invalid Canvas screenshot path.")?)
                .await
                .map_err(|e| e.to_string())?;
            atomic(
                path.clone(),
                base64::engine::general_purpose::STANDARD
                    .decode(bytes)
                    .map_err(|e| e.to_string())?,
            )
            .await?;
            atomic(
                path.with_extension("json"),
                serde_json::to_vec(&evidence).map_err(|e| e.to_string())?,
            )
            .await?;
            result.as_object_mut().unwrap().remove("data");
            result["path"] = json!(path);
            result["mimeType"] = json!("image/png");
            result["evidence"] = evidence.clone();
            let mut turns = TURNS.lock().await;
            if let Some(live) = turns
                .get_mut(&request.session_id)
                .filter(|t| current.as_ref().is_some_and(|c| c.id == t.id))
            {
                live.evidence.push(evidence);
                if live.evidence.len() > 100 {
                    live.evidence.remove(0);
                }
                persist(live).await?;
            }
            return Ok(envelope(result));
        }
        Action::Open { node } => {
            let frame = nodes::frame_for(&canvas, node)?;
            let url = open_preview(&canvas, frame, &request.session_id, sink).await?;
            let payload = json!({"canvasId":canvas.id,"projectPath":item.project_path,"frameId":frame.id,"sessionId":request.session_id,"url":url});
            let _ = sink.emit("canvas_open", &payload);
            return Ok(envelope(payload));
        }
        _ => {}
    }
    let revision = request
        .revision
        .ok_or("Edits require --revision <revision returned by a read>.")?;
    check_revision(&canvas, revision)?;
    let (updated, result) = match &request.action {
        Action::Undo { turn } => {
            let (c, conflicts) = store.undo(id, revision, turn.as_deref(), false).await?;
            (c, json!({"conflicts":conflicts}))
        }
        Action::Redo => {
            let (c, conflicts) = store.undo(id, revision, None, true).await?;
            (c, json!({"conflicts":conflicts}))
        }
        action => {
            let imported = if let Action::Write { html, parent } = action {
                let frame = nodes::frame_for(&canvas, parent)?;
                let tag = match nodes::find(&frame.content.nodes, parent) {
                    Some(CanvasNode::Element { tag, .. }) => Some(tag.as_str()),
                    _ => None,
                };
                Some(render::parse(html, tag).await?)
            } else {
                None
            };
            let mut updated = canvas.clone();
            let result = nodes::mutate(&mut updated, action, imported)?;
            if let Action::SetStyle { node, styles } = action {
                let original = nodes::frame_for(&canvas, node)?;
                if let Some(CanvasNode::Element {
                    styles: existing,
                    extra,
                    ..
                }) = nodes::find(&original.content.nodes, node)
                {
                    let normalized = render::styles(existing, extra, styles).await?;
                    let frame = updated
                        .frames
                        .iter_mut()
                        .find(|f| f.id == original.id)
                        .unwrap();
                    if let Some(CanvasNode::Element { styles: saved, extra, .. }) =
                        nodes::find_mut(&mut frame.content.nodes, node)
                    {
                        super::tokens::retain_references(existing, extra, &normalized.retained);
                        *saved = normalized.styles;
                        extra.insert(
                            "carbonStyleOrder".into(),
                            json!(normalized.carbon_style_order),
                        );
                    }
                }
            }
            let author = CanvasAuthor {
                session_id: Some(request.session_id.clone()),
                turn_id: Some(
                    current
                        .as_ref()
                        .filter(|t| t.running)
                        .map(|t| t.id.clone())
                        .unwrap_or_else(|| uuid::Uuid::now_v7().to_string()),
                ),
                label: Some("Agent turn".into()),
            };
            let updated = store
                .edit(
                    id,
                    revision,
                    CanvasEdit {
                        frames: Some(updated.frames),
                        ..Default::default()
                    },
                    author,
                )
                .await?;
            (updated, result)
        }
    };
    announce(sink, &updated);
    {
        let mut turns = TURNS.lock().await;
        if let Some(turn) = turns
            .get_mut(&request.session_id)
            .filter(|t| t.running && current.as_ref().is_some_and(|c| c.id == t.id))
        {
            let frames = turn.editing.entry(id.into()).or_default();
            for frame in &updated.frames {
                if canvas.frames.iter().find(|f| f.id == frame.id) != Some(frame) {
                    frames.insert(frame.id.clone());
                }
            }
            persist(turn).await?;
        }
    }
    publish(sink).await;
    Ok(json!({"id":updated.id,"name":updated.name,"revision":updated.revision,"data":result}))
}

/// The same guarded history powers buttons, keyboard shortcuts and the CLI.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn canvas_undo(
    sink: Sink,
    id: String,
    revision: u64,
    redo: bool,
) -> Result<Value, String> {
    let (canvas, conflicts) = Store::open().await?.undo(&id, revision, None, redo).await?;
    announce(&sink, &canvas);
    Ok(json!({"canvas":canvas,"conflicts":conflicts}))
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn canvas_undo_state(id: String) -> Result<super::CanvasUndoState, String> {
    super::undo::state(&Store::open().await?.read(&id).await?)
}

#[derive(Clone)]
struct Preview {
    canvas: String,
    frame: String,
    session: String,
    created: std::time::Instant,
}
static PREVIEWS: LazyLock<Mutex<HashMap<String, Preview>>> = LazyLock::new(Default::default);

async fn open_preview(
    canvas: &Canvas,
    frame: &CanvasFrame,
    session: &str,
    _sink: &Sink,
) -> Result<String, String> {
    Box::pin(render::document(canvas, frame)).await?;
    let key = {
        let mut previews = PREVIEWS.lock().await;
        previews.retain(|_, p| p.created.elapsed() < std::time::Duration::from_secs(7200));
        if let Some((key, _)) = previews
            .iter()
            .find(|(_, p)| p.canvas == canvas.id && p.frame == frame.id && p.session == session)
        {
            key.clone()
        } else {
            if previews.len() >= 128 {
                if let Some(oldest) = previews
                    .iter()
                    .min_by_key(|(_, p)| p.created)
                    .map(|(k, _)| k.clone())
                {
                    previews.remove(&oldest);
                }
            }
            let key = uuid::Uuid::new_v4().simple().to_string();
            previews.insert(
                key.clone(),
                Preview {
                    canvas: canvas.id.clone(),
                    frame: frame.id.clone(),
                    session: session.into(),
                    created: std::time::Instant::now(),
                },
            );
            key
        }
    };
    let home = crate::store::get_home_app_dir()
        .await
        .map_err(|e| e.to_string())?;
    let saved = tokio::fs::read_to_string(home.join("serve-port"))
        .await
        .map_err(|e| e.to_string())?;
    let port: u16 = saved
        .lines()
        .next()
        .ok_or("Canvas preview server is not ready.")?
        .parse()
        .map_err(|_| "Invalid Canvas preview port.")?;
    let url = format!("http://127.0.0.1:{port}/canvas-preview/{key}");
    let tabs =
        crate::orchestration::drive_canvas_browser(session, carbon_proto::BrowserAction::Tabs)
            .await
            .map_err(|e| e.to_string())?;
    let existing = match tabs {
        carbon_proto::Response::Browser { data, .. } => data
            .as_array()
            .and_then(|tabs| tabs.iter().find(|t| t["url"] == url))
            .and_then(|t| t["id"].as_i64()),
        _ => None,
    };
    let action = existing
        .map(|id| carbon_proto::BrowserAction::TabSwitch { id: id as i32 })
        .unwrap_or_else(|| carbon_proto::BrowserAction::TabNew {
            url: Some(url.clone()),
        });
    let answer = crate::orchestration::drive_canvas_browser(session, action)
        .await
        .map_err(|e| e.to_string())?;
    if let carbon_proto::Response::Error { message } = answer {
        return Err(message);
    }
    size_preview(session, frame).await?;
    Ok(url)
}

/// A preview keeps live CSS and the frame's viewport rather than inheriting the browser pane's width.
async fn size_preview(session: &str, frame: &CanvasFrame) -> Result<(), String> {
    let response = crate::orchestration::drive_canvas_browser(session, carbon_proto::BrowserAction::CanvasViewport {
        width: frame.geometry.width.ceil() as u32,
        height: frame.geometry.height.ceil() as u32,
    }).await.map_err(|e| e.to_string())?;
    if let carbon_proto::Response::Error { message } = response { return Err(message); }
    Ok(())
}

/// A capability exposes one current sanitized frame, never the server credential or arbitrary paths.
pub async fn preview_document(key: &str) -> Option<String> {
    let preview = PREVIEWS
        .lock()
        .await
        .get(key)
        .filter(|p| p.created.elapsed() < std::time::Duration::from_secs(7200))
        .cloned()?;
    let store = Store::open().await.ok()?;
    let canvas = owned(&store, &preview.session, &preview.canvas)
        .await
        .ok()?;
    let frame = canvas.frames.iter().find(|f| f.id == preview.frame)?;
    render::document(&canvas, frame).await.ok()
}

/// Reload only an active canvas preview; later navigation to the running project stays put.
pub(super) async fn refresh_previews(id: &str) {
    let previews: Vec<_> = PREVIEWS
        .lock()
        .await
        .iter()
        .filter(|(_, p)| p.canvas == id)
        .map(|(k, p)| (k.clone(), p.clone()))
        .collect();
    for (key, preview) in previews {
        let answer = crate::orchestration::drive_canvas_browser(
            &preview.session,
            carbon_proto::BrowserAction::Get {
                what: carbon_proto::Get::Url,
                at: None,
            },
        )
        .await;
        if let Ok(carbon_proto::Response::Browser { data, .. }) = answer {
            if data["value"]
                .as_str()
                .is_some_and(|url| url.ends_with(&format!("/canvas-preview/{key}")))
            {
                if let Ok(store) = Store::open().await {
                    if let Ok(canvas) = owned(&store, &preview.session, id).await {
                        if let Some(frame) = canvas.frames.iter().find(|f| f.id == preview.frame) {
                            let _ = size_preview(&preview.session, frame).await;
                        }
                    }
                }
                let _ = crate::orchestration::drive_canvas_browser(
                    &preview.session,
                    carbon_proto::BrowserAction::Reload,
                )
                .await;
            }
        }
    }
}

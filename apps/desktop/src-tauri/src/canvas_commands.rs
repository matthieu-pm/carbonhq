use anyhow::{anyhow, ensure, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use carbon_proto::canvas::{
    CanvasCommand as Cmd, CanvasRequest, CommentAction, EffectAction, TokenAction,
};
use rquickjs::{CatchResultExt, Function, Module};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, VecDeque},
    path::PathBuf,
    sync::LazyLock,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

use crate::{
    canvas_library::{self as library, Action},
    sink::Sink,
};

type CanvasKey = (String, String, String);

struct Edit {
    key: CanvasKey,
    before: String,
    after: String,
    undone: bool,
}

static HISTORY: Mutex<VecDeque<Edit>> = Mutex::const_new(VecDeque::new());

fn revision(raw: &str) -> String {
    Sha256::digest(raw.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[derive(Deserialize)]
struct Outcome {
    data: Value,
    content: Option<String>,
}

/// Run the same document validator, layer defaults and token resolver as the editor.
fn evaluate(raw: &str, command: &Cmd, input: &str) -> Result<Outcome> {
    let runtime = rquickjs::Runtime::new()?;
    runtime.set_memory_limit(256 << 20);
    let deadline = Instant::now() + Duration::from_secs(10);
    runtime.set_interrupt_handler(Some(Box::new(move || Instant::now() > deadline)));
    let context = rquickjs::Context::full(&runtime)?;
    let command = serde_json::to_string(command)?;
    let output = context.with(|ctx| {
        let run = || -> rquickjs::Result<String> {
            let crypto = rquickjs::Object::new(ctx.clone())?;
            crypto.set(
                "randomUUID",
                Function::new(ctx.clone(), || uuid::Uuid::new_v4().to_string())?,
            )?;
            ctx.globals().set("crypto", crypto)?;
            ctx.globals().set(
                "parseCanvasYaml",
                Function::new(ctx.clone(), |source: String| {
                    serde_yaml_ng::from_str::<Value>(&source)
                        .map(|v| v.to_string())
                        .map_err(|e| {
                            rquickjs::Error::new_from_js_message("YAML", "tokens", e.to_string())
                        })
                })?,
            )?;
            Module::declare(
                ctx.clone(),
                "model.js",
                include_bytes!("../../src/components/canvases/model.js").as_slice(),
            )?;
            Module::declare(
                ctx.clone(),
                "tokenModel.js",
                include_bytes!("../../src/components/canvases/tokenModel.js").as_slice(),
            )?;
            let (module, ready) = Module::declare(
                ctx.clone(),
                "documentCommands.js",
                include_bytes!("../../src/components/canvases/documentCommands.js").as_slice(),
            )?
            .eval()?;
            ready.finish::<()>()?;
            module
                .get::<_, Function>("execute")?
                .call((raw, command.as_str(), input))
        };
        run().catch(&ctx).map_err(|e| anyhow!("{e}"))
    })?;
    Ok(serde_json::from_str(&output)?)
}

async fn asset(project: String, path: &str) -> Result<PathBuf> {
    let root = library::attached(project).await?;
    let resolved = tokio::fs::canonicalize(root.join(path)).await?;
    ensure!(
        resolved.starts_with(&root) && resolved.is_file(),
        "Choose a file in the attached project"
    );
    Ok(resolved)
}

async fn source(req: &CanvasRequest) -> Result<String> {
    match &req.command {
        Cmd::Token(TokenAction::Import {
            path,
            source_project,
        }) => {
            let path = asset(
                source_project.as_ref().unwrap_or(&req.project).clone(),
                path,
            )
            .await?;
            ensure!(
                path.metadata()?.len() <= 4 << 20,
                "Token file exceeds 4 MiB"
            );
            Ok(tokio::fs::read_to_string(path).await?)
        }
        Cmd::Effect(EffectAction::Image { path, .. }) => {
            let path = asset(req.project.clone(), path).await?;
            let mime = crate::attachments::image_mime(&path)
                .context("Choose a PNG, JPEG, GIF or WebP image")?;
            ensure!(
                path.metadata()?.len() <= crate::attachments::MAX_IMAGE_BYTES,
                "Image exceeds 5 MiB"
            );
            Ok(format!(
                "data:{mime};base64,{}",
                STANDARD.encode(tokio::fs::read(path).await?)
            ))
        }
        _ => Ok(String::new()),
    }
}

fn name(req: &CanvasRequest) -> Result<String> {
    req.canvas
        .clone()
        .context("Specify the canvas with --canvas NAME")
}

fn changed(sink: &Sink, req: &CanvasRequest) -> Result<()> {
    sink.emit("canvas_changed", req)
}

async fn commit(
    history: &mut VecDeque<Edit>,
    key: &CanvasKey,
    raw: String,
    content: String,
) -> Result<()> {
    library::save(
        key.0.clone(),
        key.1.clone(),
        key.2.clone(),
        raw.clone(),
        content.clone(),
        false,
    )
    .await?;
    history.retain(|e| &e.key != key || !e.undone);
    history.push_back(Edit {
        key: key.clone(),
        before: raw,
        after: content,
        undone: false,
    });
    let mut bytes = history
        .iter()
        .map(|e| e.before.len() + e.after.len())
        .sum::<usize>();
    while history.len() > 80 || bytes > 64 << 20 {
        if let Some(e) = history.pop_front() {
            bytes -= e.before.len() + e.after.len();
        }
    }
    Ok(())
}

/// Preserve compare-and-save semantics across CLI, desktop and other servers.
async fn document(req: CanvasRequest, sink: &Sink) -> Result<Value> {
    let key = (req.project.clone(), req.folder.clone(), name(&req)?);
    let input = source(&req).await?;
    let mut history = HISTORY.lock().await;
    let raw = library::read(key.0.clone(), key.1.clone(), key.2.clone(), false).await?;
    let current = revision(&raw);
    ensure!(
        req.revision.as_ref().is_none_or(|r| r == &current),
        "Canvas revision changed. Read it again."
    );
    let redo = matches!(req.command, Cmd::Redo);
    if redo || matches!(req.command, Cmd::Undo) {
        let entry = if redo {
            history.iter_mut().find(|e| e.key == key && e.undone)
        } else {
            history.iter_mut().rev().find(|e| e.key == key && !e.undone)
        }
        .context("No matching CLI edit in this server's undo history")?;
        let (expected, content) = if redo {
            (&entry.before, &entry.after)
        } else {
            (&entry.after, &entry.before)
        };
        ensure!(expected == &raw, "Canvas has changed since this edit");
        let revision = revision(content);
        library::save(key.0, key.1, key.2, raw, content.clone(), false).await?;
        entry.undone = !redo;
        changed(sink, &req)?;
        return Ok(json!({"revision": revision}));
    }

    let (raw, result) = tokio::task::spawn_blocking(move || {
        let result = evaluate(&raw, &req.command, &input);
        (raw, result)
    })
    .await?;
    let result = result?;
    let mut next = current;
    if let Some(content) = result.content.filter(|content| content != &raw) {
        next = revision(&content);
        commit(&mut history, &key, raw, content).await?;
        sink.emit(
            "canvas_changed",
            json!({"project": key.0, "folder": key.1, "canvas": key.2}),
        )?;
    }
    Ok(json!({"revision": next, "data": result.data}))
}

struct Draft {
    sink: Sink,
    owner: String,
    base: String,
    content: String,
}

static DRAFTS: LazyLock<Mutex<HashMap<CanvasKey, Draft>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn preview_changed(key: &CanvasKey, sink: &Sink) -> Result<()> {
    sink.emit(
        "canvas_preview_changed",
        json!({"project": key.0, "folder": key.1, "canvas": key.2}),
    )
}

/// Return a matching saved revision and preview together, including on reconnect.
pub(crate) async fn editor_document(
    project: String,
    folder: String,
    name: String,
    archived: bool,
    include_preview: bool,
) -> Result<Value, crate::Fail> {
    let key = (project, folder, name);
    let raw = library::read(key.0.clone(), key.1.clone(), key.2.clone(), archived).await?;
    if include_preview && !archived {
        let drafts = DRAFTS.lock().await;
        if let Some(draft) = drafts.get(&key).filter(|draft| draft.base == raw) {
            return Ok(json!({"content": raw, "preview": draft.content}));
        }
    }
    Ok(Value::String(raw))
}

/// A stopped or finished turn can no longer save its outstanding preview.
pub(crate) async fn retire_previews(owner: &str) {
    DRAFTS.lock().await.retain(|key, draft| {
        if draft.owner != owner {
            return true;
        }
        let _ = preview_changed(key, &draft.sink);
        false
    });
}

async fn preview(
    mut req: CanvasRequest,
    owner: &str,
    action: carbon_proto::canvas::PreviewAction,
    sink: &Sink,
) -> Result<Value> {
    use carbon_proto::canvas::PreviewAction::*;
    let key = (req.project.clone(), req.folder.clone(), name(&req)?);
    let mut drafts = DRAFTS.lock().await;
    let draft = drafts.get(&key);
    ensure!(
        draft.is_none_or(|d| d.owner == owner),
        "Another agent is previewing this canvas"
    );
    if matches!(action, Cancel) {
        if drafts.remove(&key).is_some() {
            preview_changed(&key, sink)?;
        }
        return Ok(json!({"cancelled": true}));
    }

    let saved = library::read(key.0.clone(), key.1.clone(), key.2.clone(), false).await?;
    ensure!(
        draft.is_none_or(|d| d.base == saved),
        "Canvas changed during preview. Cancel the preview and read it again."
    );
    let raw = draft.map_or(&saved, |d| &d.content);
    let current = revision(raw);
    ensure!(
        req.revision.as_ref().is_none_or(|r| r == &current),
        "Canvas revision changed. Read it again."
    );
    req.command = match action {
        Save => {
            let draft = draft.context("No pending preview to save")?;
            let mut history = HISTORY.lock().await;
            commit(&mut history, &key, saved, draft.content.clone()).await?;
            drafts.remove(&key);
            sink.emit(
                "canvas_changed",
                json!({"project": key.0, "folder": key.1, "canvas": key.2}),
            )?;
            return Ok(json!({"revision": current}));
        }
        Read => Cmd::Read,
        Layer(action) => Cmd::Layer(action),
        Effect(action) => Cmd::Effect(action),
        Cancel => unreachable!(),
    };
    let input = source(&req).await?;
    let raw = raw.clone();
    let result =
        tokio::task::spawn_blocking(move || evaluate(&raw, &req.command, &input)).await??;
    let mut next = current;
    if let Some(content) = result.content {
        next = revision(&content);
        drafts.insert(
            key.clone(),
            Draft {
                sink: sink.clone(),
                owner: owner.to_owned(),
                base: saved,
                content,
            },
        );
        preview_changed(&key, sink)?;
    }
    Ok(json!({"revision": next, "data": result.data}))
}

/// Retire a draft when its backing file moves, even if a new canvas later reuses that name.
pub(crate) async fn change_library(project: String, action: Action) -> Result<String, crate::Fail> {
    let key = match &action {
        Action::Move {
            folder,
            name,
            destination,
        } if folder != destination => Some((project.clone(), folder.clone(), name.clone())),
        Action::Archive { folder, name } | Action::Restore { folder, name } => {
            Some((project.clone(), folder.clone(), name.clone()))
        }
        _ => None,
    };
    let Some(key) = key else {
        return library::change(project, action).await;
    };
    let mut drafts = DRAFTS.lock().await;
    let mut history = HISTORY.lock().await;
    let result = library::change(project, action).await?;
    history.retain(|edit| edit.key != key);
    if let Some(draft) = drafts.remove(&key) {
        preview_changed(&key, &draft.sink)?;
    }
    Ok(result)
}

/// Dispatch library and document work on the machine that owns the attached checkout.
pub(crate) async fn request(req: CanvasRequest, sink: &Sink) -> Result<Value> {
    use Cmd::*;
    if let Preview { session, action } = &req.command {
        let owner = session
            .clone()
            .context("Run preview from a Carbon session or pass preview --session ID")?;
        ensure!(!owner.is_empty(), "A preview needs a session");
        let action = action.clone();
        return preview(req, &owner, action, sink).await;
    }
    if req.revision.is_some() {
        ensure!(
            matches!(
                &req.command,
                Read | Page(_)
                    | Layer(_)
                    | Effect(_)
                    | Token(_)
                    | Stroke(_)
                    | Undo
                    | Redo
                    | Comment(
                        CommentAction::List { .. }
                            | CommentAction::Add { .. }
                            | CommentAction::Edit { .. }
                            | CommentAction::Remove { .. }
                    )
            ),
            "--revision applies to document commands"
        );
    }
    match &req.command {
        Projects => {
            return Ok(serde_json::to_value(
                crate::projects::list_projects().await?,
            )?)
        }
        Attach => {
            let result = crate::projects::add_project(&req.project).await?;
            sink.emit("projects_changed", ())?;
            return Ok(serde_json::to_value(result)?);
        }
        View(_) | Chat(_) | Comment(CommentAction::Send { .. }) => {
            #[cfg(any(feature = "desktop", feature = "serve"))]
            return crate::serve::host_call("canvas_view", serde_json::to_value(req)?)
                .await
                .context("Open the Carbon desktop window on the target machine for this action")?
                .map_err(|err| {
                    anyhow!("{}", err.as_str().unwrap_or("Canvas window request failed"))
                });
            #[cfg(not(any(feature = "desktop", feature = "serve")))]
            anyhow::bail!("Open the Carbon desktop window for this action");
        }
        List { archived } | Search { archived, .. } => {
            let query = match &req.command {
                Search { query, .. } => query.as_str(),
                _ => "",
            };
            let library = library::list(req.project.clone()).await?;
            return Ok(serde_json::to_value(library.matching(
                *archived,
                &req.folder,
                query,
            ))?);
        }
        _ => {}
    }
    let folder = req.folder.clone();
    let action = match &req.command {
        Create => Action::Create { folder },
        Folder { name } => Action::Folder {
            folder,
            name: name.clone(),
        },
        Move { destination } => Action::Move {
            folder,
            name: name(&req)?,
            destination: destination.clone(),
        },
        Archive => Action::Archive {
            folder,
            name: name(&req)?,
        },
        Restore => Action::Restore {
            folder,
            name: name(&req)?,
        },
        _ => return document(req, sink).await,
    };
    let name = change_library(req.project.clone(), action).await?;
    changed(sink, &req)?;
    Ok(json!({"name": name}))
}

/// Acknowledge view commands after the main webview has handled them.
#[cfg(feature = "desktop")]
pub(crate) async fn window_request(request: Value) -> Result<Value, String> {
    use tauri::{Emitter, Listener};
    let app = crate::transcription::app().ok_or("The Carbon window is unavailable")?;
    let reply = format!("canvas-reply-{}", uuid::Uuid::new_v4());
    // The local server can connect before React has mounted the command listener.
    // Probe readiness without replaying a mutation or sending a chat message twice.
    let ready = format!("{reply}-ready");
    let (tx, mut rx) = tokio::sync::oneshot::channel();
    let probe = app.once(ready.clone(), move |_| {
        let _ = tx.send(());
    });
    let waiting = async {
        loop {
            app.emit_to("main", "canvas-command", json!({ "ready": ready }))
                .map_err(|e| e.to_string())?;
            match tokio::time::timeout(Duration::from_millis(150), &mut rx).await {
                Ok(answer) => return answer.map_err(|_| "Canvas window closed".to_owned()),
                Err(_) => continue,
            }
        }
    };
    let connected = tokio::time::timeout(Duration::from_secs(8), waiting).await;
    app.unlisten(probe);
    connected.map_err(|_| "Canvas window is not ready for commands")??;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let listener = app.once(reply.clone(), move |event| {
        let _ = tx.send(serde_json::from_str::<Value>(event.payload()));
    });
    let answer = async {
        app.emit_to(
            "main",
            "canvas-command",
            json!({"reply": reply, "request": request}),
        )
        .map_err(|e| e.to_string())?;
        let result = tokio::time::timeout(Duration::from_secs(60), rx)
            .await
            .map_err(|_| {
                "Canvas did not acknowledge the command. Inspect its state before retrying."
            })?
            .map_err(|_| "Canvas closed before replying")?
            .map_err(|e| e.to_string())?;
        match result.get("error").and_then(Value::as_str) {
            Some(error) => Err(error.to_string()),
            None => Ok(result["data"].clone()),
        }
    }
    .await;
    app.unlisten(listener);
    answer
}

#[cfg(test)]
mod preview_tests {
    use super::*;
    use std::sync::{Arc, Mutex as StdMutex};

    #[tokio::test]
    async fn ending_a_turn_discards_only_its_owners_previews() {
        let events = Arc::new(StdMutex::new(Vec::new()));
        let seen = events.clone();
        let sink = Sink::new(move |event, payload| {
            assert_eq!(event, "canvas_preview_changed");
            seen.lock().unwrap().push(payload);
        });
        let key = |name: &str| ("preview-test".to_owned(), String::new(), name.to_owned());
        for (name, owner) in [("Checkout", "owner-a"), ("Receipt", "owner-b")] {
            DRAFTS.lock().await.insert(
                key(name),
                Draft {
                    sink: sink.clone(),
                    owner: owner.into(),
                    base: String::new(),
                    content: String::new(),
                },
            );
        }
        retire_previews("owner-a").await;
        assert!(!DRAFTS.lock().await.contains_key(&key("Checkout")));
        assert!(DRAFTS.lock().await.contains_key(&key("Receipt")));
        assert_eq!(events.lock().unwrap()[0]["canvas"], "Checkout");
        retire_previews("owner-b").await;
    }
}

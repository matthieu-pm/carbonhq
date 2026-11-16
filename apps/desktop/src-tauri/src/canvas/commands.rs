use super::{
    assets::*,
    model::*,
    storage::{project, Store},
};
use crate::sink::Sink;

pub const CANVAS_CHANGED: &str = "canvas_changed";
pub const CANVAS_PROBLEM: &str = "canvas_problem";
pub const CANVAS_DELETED: &str = "canvas_deleted";

pub(super) fn announce(sink: &Sink, canvas: &Canvas) {
    let _ = sink.emit(CANVAS_CHANGED, CanvasSummary::from(canvas));
}

/// Lists project-owned files and surfaces unreadable files rather than silently omitting them.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn list_canvases(project_path: Option<String>) -> Result<CanvasList, String> {
    let project = match project_path {
        Some(path) => Some(project(&path).await?.key),
        None => None,
    };
    Store::open().await?.list(project.as_deref()).await
}

/// Reads the last committed node tree; partial content edits cannot replace it.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn read_canvas(id: String) -> Result<Canvas, String> {
    Store::open().await?.read(&id).await
}

/// A project path is shared by sessions and worktrees and never depends on a session's lifetime.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn create_canvas(
    sink: Sink,
    project_path: String,
    name: String,
) -> Result<Canvas, String> {
    let canvas = Store::open().await?.create(project_path, name).await?;
    announce(&sink, &canvas);
    Ok(canvas)
}

/// Every mutation compares the caller's revision under the same cross-process lock as history.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn update_canvas(
    sink: Sink,
    id: String,
    revision: u64,
    edit: CanvasEdit,
    author: Option<CanvasAuthor>,
) -> Result<Canvas, String> {
    let canvas = Store::open()
        .await?
        .edit(&id, revision, edit, author.unwrap_or_default())
        .await?;
    announce(&sink, &canvas);
    Ok(canvas)
}

/// New file and layer identities leave the source unchanged; copied assets belong to the copy.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn duplicate_canvas(
    sink: Sink,
    id: String,
    revision: u64,
    name: String,
) -> Result<Canvas, String> {
    let canvas = Store::open().await?.duplicate(&id, revision, name).await?;
    announce(&sink, &canvas);
    Ok(canvas)
}

/// Frame copies get new layer identities and keep file-local image and token references.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn duplicate_canvas_frame(
    sink: Sink,
    id: String,
    revision: u64,
    frame_id: String,
    author: Option<CanvasAuthor>,
) -> Result<Canvas, String> {
    let canvas = Store::open()
        .await?
        .duplicate_frame(&id, revision, &frame_id, author.unwrap_or_default())
        .await?;
    announce(&sink, &canvas);
    Ok(canvas)
}

/// Permanent deletion removes the file's content, assets and history after recording a tombstone.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn delete_canvas(sink: Sink, id: String, revision: u64) -> Result<(), String> {
    let deleted = Store::open().await?.delete(&id, revision).await?;
    let _ = sink.emit(CANVAS_DELETED, deleted);
    Ok(())
}

/// Only revisions reachable from the manifest are committed history, including without Git.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn canvas_history(id: String) -> Result<Vec<CanvasSummary>, String> {
    Store::open().await?.summaries(&id).await
}

/// Reads an immutable version without moving the current canvas or camera.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn read_canvas_version(id: String, version: u64) -> Result<Canvas, String> {
    Ok(Store::open()
        .await?
        .history(&id, Some(version))
        .await?
        .remove(0))
}

/// Restoring adds a guarded revision; it does not rewrite history or move the user's camera.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn restore_canvas_version(
    sink: Sink,
    id: String,
    revision: u64,
    version: u64,
    author: Option<CanvasAuthor>,
) -> Result<Canvas, String> {
    let canvas = Store::open()
        .await?
        .restore(&id, revision, version, author.unwrap_or_default())
        .await?;
    announce(&sink, &canvas);
    Ok(canvas)
}

/// Recovery preserves the unreadable manifest before checking the last confirmed checkpoint.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn recover_canvas(sink: Sink, id: String) -> Result<Canvas, String> {
    let canvas = Store::open().await?.recover(&id).await?;
    announce(&sink, &canvas);
    Ok(canvas)
}

/// Produces a revision-scoped JSON inbox that an agent can atomically replace with edited nodes.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn prepare_canvas_frame_edit(
    id: String,
    revision: u64,
    frame_id: String,
) -> Result<CanvasEditFile, String> {
    Store::open()
        .await?
        .prepare_edit(&id, revision, &frame_id)
        .await
}

/// Invalid or stale content files report problems while the last valid design remains readable.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn reconcile_canvas(sink: Sink, id: String) -> Result<CanvasReconciliation, String> {
    let (canvas, problems) = Store::open().await?.reconcile(&id).await?;
    announce(&sink, &canvas);
    for problem in &problems {
        let _ = sink.emit(CANVAS_PROBLEM, problem);
    }
    Ok(CanvasReconciliation { canvas, problems })
}

/// Partial image chunks stay outside the file's visible assets and revision history.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn write_canvas_asset(
    sink: Sink,
    id: String,
    revision: u64,
    upload: CanvasAssetUpload,
    author: Option<CanvasAuthor>,
) -> Result<CanvasAssetProgress, String> {
    let progress = Store::open()
        .await?
        .upload(&id, revision, upload, author.unwrap_or_default())
        .await?;
    if let Some(canvas) = &progress.canvas {
        announce(&sink, canvas);
    }
    Ok(progress)
}

/// Reads exact image bytes only through a visible asset reference in the chosen revision.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn read_canvas_asset(
    id: String,
    asset_id: String,
    version: Option<u64>,
) -> Result<CanvasAssetData, String> {
    Store::open()
        .await?
        .read_asset(&id, &asset_id, version)
        .await
}

/// Replacing the visible set releases watchers for canvases no client currently has open.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn watch_canvases(scope: String, ids: Vec<String>) -> Result<(), String> {
    super::watch::watch(scope, ids).await
}

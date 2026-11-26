//! Ask: annotating a page. The page half is `browser/annotate.js`, which
//! talks back through the console (`on_console_message`); this half holds
//! what each tab has saved, takes the crops, and hands the lot to the
//! composer on Send as a `browser_annotate` event.
//!
//! The saved list lives here rather than in the page so a reload or a link
//! keeps it: the script is injected again on the next document with the
//! list, and draws only the markers made on that URL.

use super::{automation, browser_of, session_of, APP};
use crate::events::{AnnotationInput, AnnotationRect, AnnotationTarget};
use base64::{engine::general_purpose::STANDARD, Engine};
use cef::*;
use image::{imageops::FilterType, DynamicImage, ImageFormat};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Emitter;

pub(super) const PREFIX: &str = "__carbon_annotate__";
const JS: &str = include_str!("../browser/annotate.js");

static ANNOTATING: Mutex<Option<HashMap<i32, State>>> = Mutex::new(None);

#[derive(Clone, Copy, Default, PartialEq, Eq)]
enum Mode {
    #[default]
    Paused,
    Active,
    Pausing { reopen: bool },
}

#[derive(Default)]
struct State {
    mode: Mode,
    items: Vec<Item>,
    /// Crops taken, by the page's id for the annotation. Only Carbon names
    /// these paths; the page never does.
    crops: HashMap<u32, tauri::async_runtime::JoinHandle<Option<Crop>>>,
    bar: Option<Point>,
}

#[derive(Clone, Copy, Serialize, Deserialize)]
struct Point {
    x: f64,
    y: f64,
}

/// One saved annotation as the page holds it. Typed and clipped, so a page
/// cannot hand the composer an arbitrary object.
#[derive(Clone, Serialize, Deserialize)]
struct Item {
    id: u32,
    note: String,
    url: String,
    #[serde(default)]
    title: String,
    target: AnnotationTarget,
    rect: AnnotationRect,
    /// The selection and its marker in page coordinates, for drawing it
    /// again after a reload.
    area: AnnotationRect,
    marker: Point,
}

impl Item {
    fn clip(&mut self) {
        clip(&mut self.note, 4000);
        clip(&mut self.url, 2000);
        clip(&mut self.title, 300);
        if let AnnotationTarget::Element { selector, tag, text } = &mut self.target {
            clip(selector, 500);
            clip(tag, 40);
            clip(text, 200);
        }
    }
}

fn clip(s: &mut String, chars: usize) {
    if let Some((at, _)) = s.char_indices().nth(chars) {
        s.truncate(at);
    }
}

#[derive(Clone, Copy, Deserialize)]
struct Viewport {
    width: u32,
    height: u32,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Line {
    Shot { id: u32, rect: AnnotationRect, viewport: Viewport },
    Save { item: Item },
    Remove { id: u32 },
    Clear,
    Bar { at: Point },
    Send,
    Close,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnnotateEvent {
    session_id: String,
    /// `None` is the mode ending without a send.
    annotations: Option<Vec<AnnotationInput>>,
}

/// Whether a tab is annotating, so the discard sweep leaves it alone.
pub(super) fn active(id: i32) -> bool {
    ANNOTATING.lock().unwrap().as_ref().and_then(|m| m.get(&id)).is_some_and(|s| s.mode != Mode::Paused)
}

/// Reopening Ask restores this tab's collection, not another tab's.
pub(super) fn start(id: i32) {
    let mut guard = ANNOTATING.lock().unwrap();
    let state = guard.get_or_insert_with(HashMap::new).entry(id).or_default();
    match state.mode {
        Mode::Active => return,
        Mode::Pausing { .. } => {
            state.mode = Mode::Pausing { reopen: true };
            return;
        }
        Mode::Paused => state.mode = Mode::Active,
    }
    drop(guard);
    resume(id);
}

/// Let the page save the current note and request its crop before we close the console gate.
pub(super) fn stop(id: i32) {
    let mut guard = ANNOTATING.lock().unwrap();
    let Some(state) = guard.as_mut().and_then(|m| m.get_mut(&id)) else { return };
    let request = match state.mode {
        Mode::Paused => return,
        Mode::Active => true,
        Mode::Pausing { .. } => false,
    };
    state.mode = Mode::Pausing { reopen: false };
    drop(guard);
    if request {
        request_pause(id);
    }
}

fn request_pause(id: i32) {
    let close = r#"{"type":"close"}"#;
    if let Some(frame) = browser_of(id).and_then(|b| b.main_frame()) {
        let code = format!(r#"if (window.__carbonAnnotate) window.__carbonAnnotate.close(); else console.log('{PREFIX}{close}');"#);
        frame.execute_java_script(Some(&CefString::from(code.as_str())), None, 0);
    } else {
        receive(id, close);
    }
}

/// Restore the overlay on a new document only if Ask is still on.
pub(super) fn resume(id: i32) {
    let guard = ANNOTATING.lock().unwrap();
    let Some(state) = guard.as_ref().and_then(|m| m.get(&id)) else { return };
    match state.mode {
        Mode::Paused => (),
        Mode::Active => {
            let (items, bar) = (state.items.clone(), state.bar);
            drop(guard);
            inject(id, &items, bar);
        }
        Mode::Pausing { .. } => {
            drop(guard);
            request_pause(id);
        }
    }
}

/// A closing tab ends its annotating, and tells the pane so its button lets go.
pub(super) fn forget(id: i32, session: &str) {
    let removed = ANNOTATING.lock().unwrap().as_mut().and_then(|m| m.remove(&id));
    if removed.is_some_and(|s| matches!(s.mode, Mode::Active | Mode::Pausing { reopen: true })) {
        emit(session.to_owned(), None);
    }
}

fn inject(id: i32, items: &[Item], bar: Option<Point>) {
    let Some(frame) = browser_of(id).and_then(|b| b.main_frame()) else { return };
    let init = json!({ "items": items, "bar": bar });
    let code = format!("window.__carbonAnnotateInit = {init};\n{JS}");
    frame.execute_java_script(Some(&CefString::from(code.as_str())), None, 0);
}

/// One line from the page, already stripped of [`PREFIX`].
pub(super) fn receive(tab: i32, rest: &str) {
    let Ok(line) = serde_json::from_str::<Line>(rest) else { return };
    let mut guard = ANNOTATING.lock().unwrap();
    let Some(state) = guard.as_mut().and_then(|m| m.get_mut(&tab)).filter(|s| s.mode != Mode::Paused) else { return };
    match line {
        Line::Shot { id, rect, viewport } => {
            state.crops.insert(id, tauri::async_runtime::spawn(shoot(tab, id, rect, viewport)));
        }
        Line::Save { mut item } => {
            item.clip();
            match state.items.iter_mut().find(|i| i.id == item.id) {
                Some(held) => *held = item,
                None => state.items.push(item),
            }
        }
        Line::Remove { id } => {
            state.items.retain(|i| i.id != id);
            state.crops.remove(&id);
        }
        Line::Clear => {
            state.items.clear();
            state.crops.clear();
        }
        Line::Bar { at } => state.bar = Some(at),
        Line::Send => {
            let Some(mut state) = guard.as_mut().and_then(|m| m.remove(&tab)) else { return };
            drop(guard);
            let Some(session) = session_of(tab) else { return };
            tauri::async_runtime::spawn(async move {
                let mut annotations = Vec::with_capacity(state.items.len());
                for i in state.items {
                    let image_path = match state.crops.remove(&i.id) {
                        Some(task) => task.await.ok().flatten().map(Crop::keep),
                        None => None,
                    };
                    annotations.push(AnnotationInput {
                        image_path, note: i.note, url: i.url, title: i.title, target: i.target, rect: i.rect,
                    });
                }
                emit(session, Some(annotations));
            });
        }
        Line::Close => {
            let mode = std::mem::replace(&mut state.mode, Mode::Paused);
            state.crops.retain(|id, _| state.items.iter().any(|i| i.id == *id));
            drop(guard);
            match mode {
                Mode::Pausing { reopen: true } => start(tab),
                Mode::Active => {
                    if let Some(session) = session_of(tab) { emit(session, None); }
                }
                _ => (),
            }
        }
    }
}

fn emit(session: String, annotations: Option<Vec<AnnotationInput>>) {
    let Some(app) = APP.get() else { return };
    let _ = app.emit("browser_annotate", AnnotateEvent { session_id: session, annotations });
}

/// Release the overlay as soon as Chromium owns the pixels; only Send waits for the PNG.
async fn shoot(tab: i32, id: u32, rect: AnnotationRect, viewport: Viewport) -> Option<Crop> {
    let session = session_of(tab)?;
    let reply = capture(tab).await;
    let _ = super::on_main(move || {
        if let Some(frame) = browser_of(tab).and_then(|b| b.main_frame()) {
            let js = format!("window.__carbonAnnotate?.shot({id})");
            frame.execute_java_script(Some(&CefString::from(js.as_str())), None, 0);
        }
    });
    let crop = match reply {
        Ok(reply) => crop(session, reply, rect, viewport).await,
        Err(e) => Err(e),
    };
    crop.inspect_err(|e| eprintln!("[annotate crop err] {e}")).ok()
}

async fn capture(tab: i32) -> Result<serde_json::Value, String> {
    // Not under an agent's sized screenshot, which would hand back the page
    // laid out at another width.
    let _held = tokio::time::timeout(Duration::from_secs(2), automation::CAPTURING.lock())
        .await
        .map_err(|_| "a screenshot is in progress")?;
    // A CDP clip can resize the live surface and back. Read it at its current size instead.
    automation::cdp(tab, "Page.captureScreenshot", json!({ "format": "png", "captureBeyondViewport": false, "optimizeForSpeed": true })).await
}

async fn crop(session: String, reply: serde_json::Value, rect: AnnotationRect, viewport: Viewport) -> Result<Crop, String> {
    tokio::task::spawn_blocking(move || -> anyhow::Result<Crop> {
        let data = reply["data"].as_str().ok_or_else(|| anyhow::anyhow!("no image came back"))?;
        let frame = image::load_from_memory_with_format(&STANDARD.decode(data)?, ImageFormat::Png)?;
        let crop = visible_crop(&frame, viewport, rect)?;
        let dir = automation::annotations_dir(&session);
        std::fs::create_dir_all(&dir)?;
        let path = dir.join(format!("{}.png", uuid::Uuid::now_v7()));
        let file = Crop(path);
        crop.save_with_format(&file.0, ImageFormat::Png)?;
        Ok(file)
    }).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())
}

/// Map viewport CSS pixels onto the captured frame, clipping elements that extend off screen.
fn visible_crop(frame: &DynamicImage, viewport: Viewport, rect: AnnotationRect) -> anyhow::Result<DynamicImage> {
    anyhow::ensure!(viewport.width > 0 && viewport.height > 0, "empty viewport");
    let sx = f64::from(frame.width()) / f64::from(viewport.width);
    let sy = f64::from(frame.height()) / f64::from(viewport.height);
    let x = (rect.x * sx).floor() as u32;
    let y = (rect.y * sy).floor() as u32;
    let right = (((rect.x + rect.width) * sx).ceil() as u32).min(frame.width());
    let bottom = (((rect.y + rect.height) * sy).ceil() as u32).min(frame.height());
    anyhow::ensure!(x < right && y < bottom, "selection outside viewport");
    let crop = frame.crop_imm(x, y, right - x, bottom - y);
    Ok(if crop.width().max(crop.height()) > 1600 {
        crop.resize(1600, 1600, FilterType::Triangle)
    } else {
        crop
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{GenericImageView, Rgb, RgbImage};

    #[test]
    fn pause_retains_saved_items_and_their_crops_and_gates_page_commands() {
        const TAB: i32 = -1;
        start(TAB);
        let rect = json!({"x": 0, "y": 0, "width": 24, "height": 24});
        receive(TAB, &json!({
            "type": "save", "item": { "id": 1, "note": "Keep this", "url": "https://example.com",
                "target": {"kind": "region"}, "rect": rect, "area": rect, "marker": {"x": 0, "y": 0} }
        }).to_string());
        {
            let mut guard = ANNOTATING.lock().unwrap();
            let state = guard.as_mut().unwrap().get_mut(&TAB).unwrap();
            for id in [1, 2] {
                state.crops.insert(id, tauri::async_runtime::spawn(async { None }));
            }
        }

        receive(TAB, r#"{"type":"close"}"#);
        assert!(!active(TAB));
        receive(TAB, r#"{"type":"clear"}"#);
        start(TAB);
        assert!(active(TAB));
        {
            let guard = ANNOTATING.lock().unwrap();
            let state = &guard.as_ref().unwrap()[&TAB];
            assert_eq!(state.items.len(), 1);
            assert_eq!(state.items[0].note, "Keep this");
            assert_eq!(state.crops.keys().copied().collect::<Vec<_>>(), [1]);
        }
        forget(TAB, "test");
    }

    #[test]
    fn crop_uses_viewport_pixels_at_device_scale_and_clips_partial_elements() {
        let frame = DynamicImage::ImageRgb8(RgbImage::from_fn(100, 80, |x, y| Rgb([x as u8, y as u8, 0])));
        let rect = AnnotationRect { x: -5.0, y: 30.5, width: 20.25, height: 15.0 };
        let crop = visible_crop(&frame, Viewport { width: 50, height: 40 }, rect).unwrap();
        assert_eq!(crop.dimensions(), (31, 19));
        assert_eq!(crop.get_pixel(0, 0), frame.get_pixel(0, 61));
        assert_eq!(crop.get_pixel(30, 18), frame.get_pixel(30, 79));
    }
}

/// A discarded selection may finish writing after its tab is gone.
struct Crop(PathBuf);

impl Crop {
    fn keep(mut self) -> String {
        std::mem::take(&mut self.0).to_string_lossy().into_owned()
    }
}

impl Drop for Crop {
    fn drop(&mut self) {
        if !self.0.as_os_str().is_empty() { let _ = std::fs::remove_file(&self.0); }
    }
}

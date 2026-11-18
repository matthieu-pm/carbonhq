use std::collections::BTreeMap;

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use ts_rs::TS;
use uuid::Uuid;

#[cfg(any(all(feature = "cef", target_os = "macos"), test))]
use super::storage::{advance, project, Store};
use super::{assets::image_type, model::*, storage::hash};
use crate::inspection::{InspectBounds, InspectSource, InspectViewport};
#[cfg(all(feature = "cef", target_os = "macos"))]
use crate::sink::Sink;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CapturedPage {
    pub viewport: InspectViewport,
    pub bounds: InspectBounds,
    pub clip: InspectBounds,
    pub page_path: String,
    pub captured_at: String,
    pub selector: Option<String>,
    pub source: Option<InspectSource>,
    pub nodes: Vec<CanvasNode>,
    pub css: String,
    assets: Vec<Resource>,
    pub warnings: Vec<String>,
    pub image_only: bool,
    #[serde(default)]
    pub token_theme: Vec<String>,
}

#[derive(Deserialize)]
struct Resource {
    id: String,
    kind: String,
    data: String,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub(super) struct BrowserCaptureDetails {
    page_path: String,
    selector: Option<String>,
    source: Option<InspectSource>,
    viewport: InspectViewport,
    bounds: InspectBounds,
    screenshot_bounds: InspectBounds,
    captured_at: String,
    original_asset_id: String,
    image_only: bool,
    warnings: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptureAsset {
    asset: CanvasAsset,
    data: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserCapture {
    format_version: u32,
    frame: CanvasFrame,
    assets: Vec<CaptureAsset>,
}

impl BrowserCapture {
    /// Both the board and export use the same frame, original image and file-owned references.
    pub(crate) fn assemble(mut page: CapturedPage, screenshot: String, checkout: Option<super::tokens::CanvasTokenSource>) -> Result<Self, String> {
        if !(0.0..=10_000.0).contains(&page.clip.width)
            || !(0.0..=10_000.0).contains(&page.clip.height)
            || page.clip.width == 0.0
            || page.clip.height == 0.0
        {
            return Err("The browser returned invalid capture bounds.".into());
        }
        let original = CaptureAsset::new(Uuid::new_v4().to_string(), "screenshot", screenshot)?
            .ok_or("The browser did not return a usable screenshot.")?;
        let original_id = original.asset.id.clone();
        let original_ref = format!("carbon-canvas-asset://{original_id}");
        let mut assets = vec![original];
        for resource in page.assets {
            if let Some(asset) =
                CaptureAsset::new(resource.id.clone(), &resource.kind, resource.data)?
            {
                assets.push(asset);
            } else {
                let target = format!("carbon-canvas-asset://{}", resource.id);
                page.css = page.css.replace(&target, "data:,");
                remove_asset(&mut page.nodes, &target);
                page.warnings
                    .push(format!("A captured {} could not be opened.", resource.kind));
            }
        }

        let size = serde_json::to_vec(&page.nodes)
            .map_err(|error| error.to_string())?
            .len()
            + page.css.len();
        if size > 6 * 1024 * 1024 {
            page.image_only = true;
            page.warnings
                .push("This screen exceeds the editable layer size limit.".into());
        }
        if page.image_only || page.nodes.is_empty() {
            page.image_only = true;
            assets.truncate(1);
            page.css.clear();
            page.nodes = vec![image_node(
                Uuid::new_v4().to_string(),
                "Image reference",
                original_ref.clone(),
                page.clip.width,
                page.clip.height,
            )];
        } else {
            resolve_regions(&mut page.nodes, &page.clip, &original_ref);
        }
        page.warnings.sort();
        page.warnings.dedup();
        let details = BrowserCaptureDetails {
            page_path: page
                .page_path
                .split(['?', '#'])
                .next()
                .unwrap_or("/")
                .into(),
            selector: page.selector,
            source: page.source,
            viewport: page.viewport,
            bounds: page.bounds,
            screenshot_bounds: page.clip.clone(),
            captured_at: page.captured_at,
            original_asset_id: original_id,
            image_only: page.image_only,
            warnings: page.warnings,
        };
        let name = if details.image_only {
            "Image reference".to_string()
        } else if details.page_path == "/" {
            "Home".to_string()
        } else {
            details.page_path.chars().take(140).collect()
        };
        let mut content_extra = BTreeMap::new();
        if !page.image_only {
            content_extra.insert("tokenSource".into(), json!({"checkout":checkout,"theme":page.token_theme}));
        }
        let frame = CanvasFrame {
            id: Uuid::new_v4().to_string(),
            name,
            geometry: CanvasGeometry {
                x: 0.0,
                y: 0.0,
                width: page.clip.width,
                height: page.clip.height,
                extra: Default::default(),
            },
            content: CanvasContent {
                nodes: page.nodes,
                css: page.css,
                asset_ids: assets
                    .iter()
                    .map(|resource| resource.asset.id.clone())
                    .collect(),
                extra: content_extra,
            },
            extra: BTreeMap::from([("capture".into(), json!(details))]),
        };
        Ok(Self {
            format_version: 1,
            frame,
            assets,
        })
    }

    /// Publish one append revision after all capture bytes are durable.
    #[cfg(all(feature = "cef", target_os = "macos"))]
    pub(crate) async fn add_to_canvas(
        self,
        sink: &Sink,
        project_path: &str,
        canvas_id: &str,
    ) -> Result<String, String> {
        let (canvas, id) = self
            .append(&Store::open().await?, project_path, canvas_id)
            .await?;
        super::commands::announce(sink, &canvas);
        Ok(id)
    }

    #[cfg(any(all(feature = "cef", target_os = "macos"), test))]
    async fn append(
        mut self,
        store: &Store,
        project_path: &str,
        canvas_id: &str,
    ) -> Result<(Canvas, String), String> {
        let project = project(project_path).await?;
        let _guard = store.lock().await?;
        let head = store.head(canvas_id).await?;
        let before = store.read(canvas_id).await?;
        if before.project_key != project.key {
            return Err("Choose a canvas in the browser session’s project.".into());
        }
        let mut canvas = before.clone();
        if let Some(right) = canvas
            .frames
            .iter()
            .map(|f| f.geometry.x + f.geometry.width)
            .reduce(f64::max)
        {
            self.frame.geometry.x = right + 80.0;
        }
        let id = self.frame.id.clone();
        canvas.frames.push(self.frame);
        canvas
            .assets
            .extend(self.assets.iter().map(|resource| resource.asset.clone()));
        advance(
            &mut canvas,
            CanvasAuthor {
                label: Some("Capture from browser".into()),
                ..Default::default()
            },
            None,
        )?;
        validate(&canvas)?;
        super::undo::record(&before, &mut canvas)?;
        for resource in self.assets {
            let bytes = STANDARD.decode(resource.data).map_err(|e| e.to_string())?;
            store
                .put_asset(canvas_id, &resource.asset.hash, &bytes)
                .await?;
        }
        store.commit(&canvas, Some(head), None).await?;
        Ok((canvas, id))
    }

    /// Gives the CLI capture limits and dimensions without sending asset bytes over the socket.
    pub(crate) fn summary(&self) -> Value {
        let details = &self.frame.extra["capture"];
        json!({
            "imageOnly": details["imageOnly"],
            "warnings": details["warnings"],
            "width": self.frame.geometry.width,
            "height": self.frame.geometry.height,
        })
    }
}

impl CaptureAsset {
    fn new(id: String, kind: &str, data: String) -> Result<Option<Self>, String> {
        uuid(&id)?;
        if data.len() > MAX_ASSET.div_ceil(3) * 4 {
            return Ok(None);
        }
        let bytes = STANDARD
            .decode(&data)
            .map_err(|_| "Invalid browser capture asset.")?;
        if bytes.len() > MAX_ASSET {
            return Ok(None);
        }
        let mime = if kind == "font" {
            match bytes.get(..4) {
                Some(b"wOF2") => Some("font/woff2"),
                Some(b"wOFF") => Some("font/woff"),
                Some(b"OTTO") => Some("font/otf"),
                Some(b"\x00\x01\x00\x00") => Some("font/ttf"),
                _ => None,
            }
        } else {
            image_type(&bytes)
        };
        Ok(mime.map(|mime| Self {
            asset: CanvasAsset {
                id,
                name: format!("Captured {kind}"),
                mime_type: mime.into(),
                size: bytes.len() as u64,
                hash: hash(&bytes),
                extra: Default::default(),
            },
            data,
        }))
    }
}

fn image_node(id: String, name: &str, src: String, width: f64, height: f64) -> CanvasNode {
    CanvasNode::Element {
        id,
        name: name.into(),
        tag: "img".into(),
        attributes: BTreeMap::from([("src".into(), src), ("alt".into(), name.into())]),
        styles: BTreeMap::from([
            ("display".into(), "block".into()),
            ("width".into(), format!("{width}px")),
            ("height".into(), format!("{height}px")),
        ]),
        children: vec![],
        extra: Default::default(),
    }
}

fn resolve_regions(nodes: &mut [CanvasNode], clip: &InspectBounds, screenshot: &str) {
    for node in nodes {
        let CanvasNode::Element {
            styles,
            children,
            extra,
            ..
        } = node
        else {
            continue;
        };
        if let Some(region) = extra
            .remove("rasterRegion")
            .and_then(|v| serde_json::from_value::<InspectBounds>(v).ok())
        {
            styles.insert("background-image".into(), format!("url({screenshot})"));
            styles.insert(
                "background-size".into(),
                format!("{}px {}px", clip.width, clip.height),
            );
            styles.insert(
                "background-position".into(),
                format!("{}px {}px", clip.x - region.x, clip.y - region.y),
            );
            styles.insert("background-origin".into(), "border-box".into());
            styles.insert("background-repeat".into(), "no-repeat".into());
        }
        resolve_regions(children, clip, screenshot);
    }
}

fn remove_asset(nodes: &mut [CanvasNode], target: &str) {
    for node in nodes {
        let CanvasNode::Element {
            attributes,
            styles,
            children,
            ..
        } = node
        else {
            continue;
        };
        for value in attributes.values_mut().chain(styles.values_mut()) {
            if value.contains(target) {
                *value = value.replace(target, "data:,");
            }
        }
        remove_asset(children, target);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn capture_commit_undo_and_redo_keep_the_original_in_the_same_revision() {
        let root = std::env::temp_dir().join(format!("carbon-browser-capture-{}", Uuid::new_v4()));
        let project_path = root.to_str().unwrap().to_owned();
        tokio::fs::create_dir_all(&root).await.unwrap();
        let store = Store::at(root.join("canvases"));
        let canvas = store
            .create(project_path.clone(), "Explorations".into())
            .await
            .unwrap();
        let existing: CanvasFrame = serde_json::from_value(json!({
            "id": Uuid::new_v4().to_string(), "name": "Earlier design",
            "geometry": { "x": 40, "y": 20, "width": 390, "height": 600 },
            "content": { "nodes": [] },
        }))
        .unwrap();
        let canvas = store
            .edit(
                &canvas.id,
                canvas.revision,
                CanvasEdit {
                    frames: Some(vec![existing.clone()]),
                    ..Default::default()
                },
                CanvasAuthor::default(),
            )
            .await
            .unwrap();
        let page = serde_json::from_value(json!({
            "viewport": { "width": 390, "height": 600, "scale": 2 },
            "bounds": { "x": 0, "y": 0, "width": 390, "height": 900 },
            "clip": { "x": 0, "y": 0, "width": 390, "height": 900 },
            "pagePath": "/checkout?token=omitted",
            "capturedAt": "2026-11-18T16:00:00Z",
            "nodes": [], "css": "", "assets": [], "warnings": ["Image fallback."], "imageOnly": true,
        })).unwrap();
        let original = STANDARD.encode(b"\xff\xd8\xff");
        let capture = BrowserCapture::assemble(page, original.clone(), None).unwrap();
        let (saved, id) = capture
            .append(&store, &project_path, &canvas.id)
            .await
            .unwrap();
        assert_eq!(saved.revision, canvas.revision + 1);
        assert_eq!(saved.frames[0], existing);
        let added = &saved.frames[1];
        assert_eq!(added.id, id);
        assert_eq!(added.name, "Image reference");
        assert_eq!(added.geometry.x, 510.0);
        assert_eq!(added.extra["capture"]["pagePath"], "/checkout");
        let asset = added.extra["capture"]["originalAssetId"].as_str().unwrap();
        assert_eq!(
            store.read_asset(&saved.id, asset, None).await.unwrap().data,
            original
        );
        let (undone, conflicts) = store
            .undo(&saved.id, saved.revision, None, false)
            .await
            .unwrap();
        assert!(conflicts.is_empty());
        assert_eq!(undone.frames, vec![existing]);
        assert!(undone.assets.is_empty());
        let (redone, conflicts) = store
            .undo(&saved.id, undone.revision, None, true)
            .await
            .unwrap();
        assert!(conflicts.is_empty());
        assert_eq!(redone.frames, saved.frames);
        assert_eq!(
            store
                .read_asset(&redone.id, asset, None)
                .await
                .unwrap()
                .data,
            original
        );
        tokio::fs::remove_dir_all(root).await.unwrap();
    }
}

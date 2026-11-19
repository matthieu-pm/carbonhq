use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

pub(super) const READER: u32 = 1;
pub(super) const MAX_JSON: u64 = 8 * 1024 * 1024;
pub(super) const MAX_ASSET: usize = 20 * 1024 * 1024;
// Leave room for arrays, attributes and command envelopes within serde_json's nesting limit.
pub(super) const MAX_LAYER_DEPTH: usize = 48;
pub(super) type Extensions = BTreeMap<String, Value>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub enum CanvasNode {
    Element {
        id: String,
        name: String,
        tag: String,
        #[serde(default)]
        attributes: BTreeMap<String, String>,
        #[serde(default)]
        styles: BTreeMap<String, String>,
        #[serde(default)]
        children: Vec<CanvasNode>,
        #[serde(flatten)]
        #[ts(skip)]
        extra: Extensions,
    },
    Text {
        id: String,
        name: String,
        text: String,
        #[serde(flatten)]
        #[ts(skip)]
        extra: Extensions,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CanvasContent {
    pub nodes: Vec<CanvasNode>,
    #[serde(default)]
    pub css: String,
    #[serde(default)]
    pub asset_ids: Vec<String>,
    #[serde(flatten)]
    #[ts(skip)]
    pub extra: Extensions,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CanvasGeometry {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(flatten)]
    #[ts(skip)]
    pub extra: Extensions,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CanvasCamera {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
    #[serde(flatten)]
    #[ts(skip)]
    pub extra: Extensions,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CanvasFrame {
    pub id: String,
    pub name: String,
    pub geometry: CanvasGeometry,
    pub content: CanvasContent,
    #[serde(flatten)]
    #[ts(skip)]
    pub extra: Extensions,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CanvasAsset {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub size: u64,
    pub hash: String,
    #[serde(flatten)]
    #[ts(skip)]
    pub extra: Extensions,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CanvasAuthor {
    pub session_id: Option<String>,
    pub turn_id: Option<String>,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CanvasChange {
    pub id: String,
    pub before_revision: u64,
    pub after_revision: u64,
    pub author: CanvasAuthor,
    pub restored_from: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct Canvas {
    pub id: String,
    pub project_path: String,
    #[serde(default)]
    pub project_key: String,
    pub name: String,
    pub revision: u64,
    pub created: String,
    pub modified: String,
    pub frames: Vec<CanvasFrame>,
    pub camera: Option<CanvasCamera>,
    pub tokens: BTreeMap<String, String>,
    pub assets: Vec<CanvasAsset>,
    pub change: CanvasChange,
    #[serde(flatten)]
    #[ts(skip)]
    pub extra: Extensions,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CanvasSummary {
    pub id: String,
    pub project_path: String,
    #[serde(default)]
    pub project_key: String,
    pub name: String,
    pub revision: u64,
    pub modified: String,
    pub frame_count: usize,
    pub change: CanvasChange,
}

impl From<&Canvas> for CanvasSummary {
    fn from(canvas: &Canvas) -> Self {
        Self {
            id: canvas.id.clone(),
            project_path: canvas.project_path.clone(),
            project_key: canvas.project_key.clone(),
            name: canvas.name.clone(),
            revision: canvas.revision,
            modified: canvas.modified.clone(),
            frame_count: canvas.frames.len(),
            change: canvas.change.clone(),
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "events.ts")]
pub struct CanvasEdit {
    pub name: Option<String>,
    pub frames: Option<Vec<CanvasFrame>>,
    pub camera: Option<CanvasCamera>,
    #[serde(default)]
    pub clear_camera: bool,
    pub tokens: Option<BTreeMap<String, String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasLayerSource {
    pub id: String,
    pub revision: u64,
    pub layers: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasLayerPaste {
    pub canvas: Canvas,
    pub frame_id: String,
    pub node_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CanvasFrameEdit {
    pub revision: u64,
    pub frame_id: String,
    pub content: CanvasContent,
    #[serde(default)]
    pub author: CanvasAuthor,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CanvasEditFile {
    pub path: String,
    pub edit: CanvasFrameEdit,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CanvasProblem {
    pub id: String,
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CanvasList {
    pub files: Vec<CanvasSummary>,
    pub problems: Vec<CanvasProblem>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CanvasReconciliation {
    pub canvas: Canvas,
    pub problems: Vec<CanvasProblem>,
}

pub(super) fn uuid(id: &str) -> Result<(), String> {
    if uuid::Uuid::parse_str(id).is_ok_and(|u| u.to_string() == id) {
        Ok(())
    } else {
        Err("Invalid Canvas ID.".into())
    }
}

pub(super) fn name(value: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.chars().count() > 240 || value.chars().any(char::is_control)
    {
        Err("Use a name of 1–240 characters without control characters.".into())
    } else {
        Ok(())
    }
}

pub(super) fn check_revision(canvas: &Canvas, expected: u64) -> Result<(), String> {
    if canvas.revision == expected {
        Ok(())
    } else {
        Err(format!("Canvas conflict: expected revision {expected}, current revision {}. Read the canvas again before editing.", canvas.revision))
    }
}

/// Reject invalid identities, references and limits before a revision can become visible.
pub(super) fn validate(canvas: &Canvas) -> Result<(), String> {
    uuid(&canvas.id)?;
    name(&canvas.name)?;
    let mut ids = BTreeSet::new();
    let assets: BTreeSet<_> = canvas.assets.iter().map(|a| a.id.as_str()).collect();
    if assets.len() != canvas.assets.len() {
        return Err("Repeated Canvas asset ID.".into());
    }
    if canvas.assets.len() > 4096 {
        return Err("A canvas holds at most 4,096 images.".into());
    }
    for asset in &canvas.assets {
        uuid(&asset.id)?;
        name(&asset.name)?;
        if !digest(&asset.hash) || asset.size > MAX_ASSET as u64 {
            return Err("Invalid Canvas asset metadata.".into());
        }
    }
    if canvas.frames.len() > 1000 {
        return Err("A canvas holds at most 1,000 frames.".into());
    }
    let mut count = 0;
    for frame in &canvas.frames {
        unique(&frame.id, &mut ids)?;
        name(&frame.name)?;
        let g = &frame.geometry;
        if ![g.x, g.y, g.width, g.height].iter().all(|x| x.is_finite())
            || g.width <= 0.0
            || g.height <= 0.0
        {
            return Err("Frame dimensions must be positive and geometry finite.".into());
        }
        for asset in &frame.content.asset_ids {
            if !assets.contains(asset.as_str()) {
                return Err(format!("Frame references missing asset {asset}."));
            }
        }
        for node in &frame.content.nodes {
            validate_node(node, &mut ids, &mut count, 0)?;
        }
        validate_asset_urls(&frame.content)?;
    }
    if let Some(camera) = &canvas.camera {
        if ![camera.x, camera.y, camera.zoom]
            .iter()
            .all(|x| x.is_finite())
            || camera.zoom <= 0.0
        {
            return Err("Camera position must be finite and zoom positive.".into());
        }
    }
    let size = serde_json::to_vec(canvas).map_err(|e| e.to_string())?.len();
    if size as u64 > MAX_JSON {
        return Err("Canvas content must be 8 MiB or smaller.".into());
    }
    Ok(())
}

/// Canonical image URLs must agree with the explicit file-owned asset references.
fn validate_asset_urls(content: &CanvasContent) -> Result<(), String> {
    fn check(value: &str, assets: &[String]) -> Result<(), String> {
        for id in asset_urls(value) {
            if !assets.iter().any(|a| a == id) {
                return Err(
                    "Image URLs must reference an image declared in the frame's assetIds.".into(),
                );
            }
        }
        Ok(())
    }
    fn nodes(items: &[CanvasNode], assets: &[String]) -> Result<(), String> {
        for node in items {
            if let CanvasNode::Element {
                attributes,
                styles,
                children,
                ..
            } = node
            {
                for value in attributes.values().chain(styles.values()) {
                    check(value, assets)?;
                }
                nodes(children, assets)?;
            }
        }
        Ok(())
    }
    check(&content.css, &content.asset_ids)?;
    if let Some(styles) = content.extra.get("bodyStyles").and_then(Value::as_object) {
        for value in styles.values().filter_map(Value::as_str) {
            check(value, &content.asset_ids)?;
        }
    }
    nodes(&content.nodes, &content.asset_ids)
}

pub(super) fn asset_urls(value: &str) -> impl Iterator<Item = &str> {
    value.split("carbon-canvas-asset://").skip(1).map(|suffix| {
        suffix
            .split(|c: char| c.is_whitespace() || matches!(c, '\'' | '"' | ')' | ';' | '<' | '>'))
            .next()
            .unwrap_or_default()
    })
}

pub(super) fn layer_asset_ids(node: &CanvasNode, ids: &mut BTreeSet<String>) {
    if let CanvasNode::Element {
        attributes,
        styles,
        children,
        ..
    } = node
    {
        ids.extend(
            attributes
                .values()
                .chain(styles.values())
                .flat_map(|value| asset_urls(value))
                .map(str::to_owned),
        );
        for child in children {
            layer_asset_ids(child, ids);
        }
    }
}

fn unique(id: &str, ids: &mut BTreeSet<String>) -> Result<(), String> {
    uuid(id)?;
    if ids.insert(id.to_string()) {
        Ok(())
    } else {
        Err("Repeated Canvas frame or layer ID.".into())
    }
}

/// Enforce one identity namespace and one depth budget across every frame in the file.
fn validate_node(
    node: &CanvasNode,
    ids: &mut BTreeSet<String>,
    count: &mut usize,
    depth: usize,
) -> Result<(), String> {
    *count += 1;
    if depth >= MAX_LAYER_DEPTH || *count > 100_000 {
        return Err("Canvas layer tree is too large or deeply nested.".into());
    }
    match node {
        CanvasNode::Text {
            id, name: label, ..
        } => {
            unique(id, ids)?;
            name(label)?;
        }
        CanvasNode::Element {
            id,
            name: label,
            tag,
            children,
            ..
        } => {
            unique(id, ids)?;
            name(label)?;
            if tag.is_empty()
                || tag.len() > 128
                || !tag
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b':' | b'_'))
            {
                return Err("Invalid Canvas element tag.".into());
            }
            for child in children {
                validate_node(child, ids, count, depth + 1)?;
            }
        }
    }
    Ok(())
}

pub(super) fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Only layer identities change; HTML attributes and file-local resource links stay intact.
pub(super) fn remap_frames(frames: &mut [CanvasFrame]) {
    for frame in frames {
        frame.id = uuid::Uuid::now_v7().to_string();
        for node in &mut frame.content.nodes {
            remap_node(node);
        }
    }
}

fn remap_node(node: &mut CanvasNode) {
    match node {
        CanvasNode::Text { id, .. } => *id = uuid::Uuid::now_v7().to_string(),
        CanvasNode::Element { id, children, .. } => {
            *id = uuid::Uuid::now_v7().to_string();
            for child in children {
                remap_node(child);
            }
        }
    }
}

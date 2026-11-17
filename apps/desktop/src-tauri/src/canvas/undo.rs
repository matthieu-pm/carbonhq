use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use ts_rs::TS;

use super::{
    model::*,
    storage::{advance, Store},
};

const KEY: &str = "carbonUndo";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct History {
    steps: Vec<Step>,
    redo: Vec<String>,
    #[serde(flatten)]
    extra: Extensions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Step {
    id: String,
    label: String,
    session_id: Option<String>,
    turn_id: Option<String>,
    revisions: Vec<u64>,
    undone: bool,
    undo_revision: Option<u64>,
    #[serde(flatten)]
    extra: Extensions,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CanvasUndoState {
    pub can_undo: bool,
    pub can_redo: bool,
    pub undo_label: Option<String>,
    pub redo_label: Option<String>,
}

fn history(canvas: &Canvas) -> Result<History, String> {
    canvas
        .extra
        .get(KEY)
        .cloned()
        .map(serde_json::from_value)
        .transpose()
        .map(|h| h.unwrap_or_default())
        .map_err(|e| format!("Canvas undo history is unreadable: {e}"))
}

fn save(canvas: &mut Canvas, history: &History) -> Result<(), String> {
    canvas.extra.insert(
        KEY.into(),
        serde_json::to_value(history).map_err(|e| e.to_string())?,
    );
    Ok(())
}

/// Snapshot references keep undo bounded without copying whole designs into every revision.
pub(super) fn record(before: &Canvas, after: &mut Canvas) -> Result<(), String> {
    if design(before)? == design(after)? {
        return Ok(());
    }
    let mut history = history(before)?;
    history.redo.clear();
    let author = &after.change.author;
    if let Some(step) = history.steps.iter_mut().rev().find(|s| {
        !s.undone
            && author.turn_id.is_some()
            && s.turn_id == author.turn_id
            && s.session_id == author.session_id
    }) {
        step.revisions.push(after.revision);
    } else {
        history.steps.push(Step {
            id: after.change.id.clone(),
            label: author.label.clone().unwrap_or_else(|| {
                if author.session_id.is_some() {
                    "Agent turn".into()
                } else {
                    "Canvas edit".into()
                }
            }),
            session_id: author.session_id.clone(),
            turn_id: author.turn_id.clone(),
            revisions: vec![after.revision],
            undone: false,
            undo_revision: None,
            extra: Default::default(),
        });
    }
    if history.steps.len() > 100 {
        history.steps.drain(..history.steps.len() - 100);
    }
    save(after, &history)
}

/// Identity-keyed records let a style change undo independently of a later move or sibling insertion.
fn design(canvas: &Canvas) -> Result<Value, String> {
    let mut frames = Map::new();
    for frame in &canvas.frames {
        let mut layers = Map::new();
        let mut order = Map::new();
        fn walk(
            nodes: &[CanvasNode],
            parent: &str,
            layers: &mut Map<String, Value>,
            order: &mut Map<String, Value>,
        ) -> Result<(), String> {
            let mut ids = Vec::new();
            for node in nodes {
                let id = super::nodes::node_id(node);
                let mut value = serde_json::to_value(node).map_err(|e| e.to_string())?;
                if matches!(node, CanvasNode::Element { .. }) {
                    value.as_object_mut().unwrap().remove("children");
                }
                layers.insert(id.into(), json!({"node":value,"parent":parent}));
                ids.push(id);
                if let CanvasNode::Element { children, .. } = node {
                    walk(children, id, layers, order)?;
                }
            }
            order.insert(parent.into(), json!(ids));
            Ok(())
        }
        walk(&frame.content.nodes, &frame.id, &mut layers, &mut order)?;
        let mut value = serde_json::to_value(frame).map_err(|e| e.to_string())?;
        value["content"].as_object_mut().unwrap().remove("nodes");
        frames.insert(
            frame.id.clone(),
            json!({"frame":value,"layers":layers,"order":order}),
        );
    }
    Ok(
        json!({"name":canvas.name,"tokens":canvas.tokens,"frames":frames,"frameOrder":canvas.frames.iter().map(|f| &f.id).collect::<Vec<_>>()}),
    )
}

fn restore(canvas: &mut Canvas, value: Value) -> Result<(), String> {
    canvas.name = serde_json::from_value(value["name"].clone()).map_err(|e| e.to_string())?;
    canvas.tokens = serde_json::from_value(value["tokens"].clone()).map_err(|e| e.to_string())?;
    let frames = value["frames"].as_object().ok_or("Invalid undo frames.")?;
    let mut ids: Vec<String> =
        serde_json::from_value(value["frameOrder"].clone()).map_err(|e| e.to_string())?;
    ids.retain(|id| frames.contains_key(id));
    for id in frames.keys() {
        if !ids.contains(id) {
            ids.push(id.clone());
        }
    }
    let mut rebuilt = Vec::new();
    for id in ids {
        let record = &frames[&id];
        let mut frame = record["frame"].clone();
        let layers = record["layers"].as_object().ok_or("Invalid undo layers.")?;
        let order = record["order"].as_object().ok_or("Invalid undo order.")?;
        let mut seen = std::collections::BTreeSet::new();
        fn walk(
            parent: &str,
            layers: &Map<String, Value>,
            order: &Map<String, Value>,
            seen: &mut std::collections::BTreeSet<String>,
            depth: usize,
        ) -> Result<Vec<Value>, String> {
            if depth > MAX_LAYER_DEPTH {
                return Err("Undo would exceed the layer nesting limit.".into());
            }
            let mut ids: Vec<String> = order
                .get(parent)
                .cloned()
                .map(serde_json::from_value)
                .transpose()
                .map_err(|e| e.to_string())?
                .unwrap_or_default();
            ids.retain(|id| layers.get(id).is_some_and(|v| v["parent"] == parent));
            for (id, node) in layers {
                if node["parent"] == parent && !ids.contains(id) {
                    ids.push(id.clone());
                }
            }
            let mut nodes = Vec::new();
            for id in ids {
                if !seen.insert(id.clone()) {
                    return Err("Undo would create a layer cycle.".into());
                }
                let mut node = layers[&id]["node"].clone();
                if node["kind"] == "element" {
                    node["children"] = json!(walk(&id, layers, order, seen, depth + 1)?);
                }
                nodes.push(node);
            }
            Ok(nodes)
        }
        let nodes = walk(&id, layers, order, &mut seen, 0)?;
        if seen.len() != layers.len() {
            return Err(
                "Undo would orphan layers changed later. The current canvas was kept.".into(),
            );
        }
        frame["content"]["nodes"] = json!(nodes);
        rebuilt.push(serde_json::from_value(frame).map_err(|e| e.to_string())?);
    }
    canvas.frames = rebuilt;
    validate(canvas)
}

/// A conflicting property stays current; omitted and null values remain distinct.
fn merge(
    current: &mut Value,
    before: &Value,
    after: &Value,
    path: &str,
    conflicts: &mut Vec<String>,
) {
    if before == after {
        return;
    }
    if let (Some(before), Some(after), Some(current)) = (
        before.as_object(),
        after.as_object(),
        current.as_object_mut(),
    ) {
        let keys: std::collections::BTreeSet<_> = before.keys().chain(after.keys()).collect();
        for key in keys {
            let path = format!("{path}/{key}");
            match (before.get(key), after.get(key)) {
                (Some(b), Some(a)) if current.contains_key(key) => {
                    merge(current.get_mut(key).unwrap(), b, a, &path, conflicts)
                }
                (Some(b), None) if !current.contains_key(key) => {
                    current.insert(key.clone(), b.clone());
                }
                (None, Some(a)) if current.get(key) == Some(a) => {
                    current.remove(key);
                }
                (b, a) if b != a => {
                    conflicts.push(path);
                }
                _ => {}
            }
        }
    } else if current == after {
        *current = before.clone();
    } else {
        conflicts.push(path.into());
    }
}

pub(super) fn state(canvas: &Canvas) -> Result<CanvasUndoState, String> {
    let history = history(canvas)?;
    let undo = history.steps.iter().rev().find(|s| !s.undone);
    let redo = history
        .redo
        .last()
        .and_then(|id| history.steps.iter().find(|s| s.id == *id));
    Ok(CanvasUndoState {
        can_undo: undo.is_some(),
        can_redo: redo.is_some(),
        undo_label: undo.map(|s| s.label.clone()),
        redo_label: redo.map(|s| s.label.clone()),
    })
}

impl Store {
    /// Undo is a new guarded commit; immutable snapshots and the current camera stay intact.
    pub(super) async fn undo(
        &self,
        id: &str,
        revision: u64,
        turn: Option<&str>,
        redo: bool,
    ) -> Result<(Canvas, Vec<String>), String> {
        let _guard = self.lock().await?;
        let previous = self.head(id).await?;
        let mut canvas = self.read(id).await?;
        check_revision(&canvas, revision)?;
        let mut history = history(&canvas)?;
        let index = if redo {
            history
                .redo
                .last()
                .and_then(|id| history.steps.iter().position(|s| s.id == *id && s.undone))
        } else {
            history.steps.iter().rposition(|s| {
                !s.undone && turn.is_none_or(|id| s.turn_id.as_deref() == Some(id) || s.id == id)
            })
        }
        .ok_or(if redo {
            "Nothing to redo."
        } else {
            "Nothing to undo."
        })?;
        let step = &history.steps[index];
        let mut design = design(&canvas)?;
        let mut conflicts = Vec::new();
        let versions = if redo {
            vec![step.undo_revision.ok_or("Redo snapshot is missing.")?]
        } else {
            step.revisions.clone()
        };
        for version in versions.into_iter().rev() {
            let after = self.history(id, Some(version)).await?.remove(0);
            let before = self
                .history(id, Some(after.change.before_revision))
                .await?
                .remove(0);
            merge(
                &mut design,
                &self::design(&before)?,
                &self::design(&after)?,
                "",
                &mut conflicts,
            );
        }
        restore(&mut canvas, design)?;
        let author = CanvasAuthor {
            label: Some(format!(
                "{} {}",
                if redo { "Redo" } else { "Undo" },
                step.label
            )),
            ..Default::default()
        };
        advance(&mut canvas, author, None)?;
        history.steps[index].undone = !redo;
        if redo {
            history.redo.pop();
        } else {
            history.steps[index].undo_revision = Some(canvas.revision);
            history.redo.push(history.steps[index].id.clone());
        }
        save(&mut canvas, &history)?;
        self.commit(&canvas, Some(previous), None).await?;
        Ok((canvas, conflicts))
    }
}

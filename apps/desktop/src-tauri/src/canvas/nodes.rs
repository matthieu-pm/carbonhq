use std::collections::BTreeMap;

use carbon_proto::CanvasAction;
use serde_json::{json, Value};

use super::model::*;

/// CSS declarations retain cascade order even though durable property maps are sorted.
pub(super) fn ordered_styles<'a>(
    styles: &'a BTreeMap<String, String>,
    extra: &Extensions,
) -> Vec<(&'a str, &'a str)> {
    let mut entries = Vec::new();
    if let Some(order) = extra.get("carbonStyleOrder").and_then(Value::as_array) {
        for key in order.iter().filter_map(Value::as_str) {
            if let Some((key, value)) = styles.get_key_value(key) {
                if !entries.iter().any(|(k, _)| *k == key.as_str()) {
                    entries.push((key.as_str(), value.as_str()));
                }
            }
        }
    }
    for (key, value) in styles {
        if !entries.iter().any(|(k, _)| *k == key.as_str()) {
            entries.push((key.as_str(), value.as_str()));
        }
    }
    entries
}

pub(super) fn node_id(node: &CanvasNode) -> &str {
    match node {
        CanvasNode::Element { id, .. } | CanvasNode::Text { id, .. } => id,
    }
}

pub(super) fn find<'a>(nodes: &'a [CanvasNode], id: &str) -> Option<&'a CanvasNode> {
    for node in nodes {
        if node_id(node) == id {
            return Some(node);
        }
        if let CanvasNode::Element { children, .. } = node {
            if let Some(found) = find(children, id) {
                return Some(found);
            }
        }
    }
    None
}

pub(super) fn find_mut<'a>(nodes: &'a mut [CanvasNode], id: &str) -> Option<&'a mut CanvasNode> {
    for node in nodes {
        if node_id(node) == id {
            return Some(node);
        }
        if let CanvasNode::Element { children, .. } = node {
            if let Some(found) = find_mut(children, id) {
                return Some(found);
            }
        }
    }
    None
}

pub(super) fn frame_for<'a>(canvas: &'a Canvas, id: &str) -> Result<&'a CanvasFrame, String> {
    canvas
        .frames
        .iter()
        .find(|f| f.id == id || find(&f.content.nodes, id).is_some())
        .ok_or_else(|| format!("No frame or layer {id} in this canvas."))
}

pub(super) fn children<'a>(canvas: &'a mut Canvas, id: &str) -> Result<&'a mut Vec<CanvasNode>, String> {
    for frame in &mut canvas.frames {
        if frame.id == id {
            return Ok(&mut frame.content.nodes);
        }
        if let Some(node) = find_mut(&mut frame.content.nodes, id) {
            return match node {
                CanvasNode::Element { tag, children, .. }
                    if ![
                        "img", "input", "br", "hr", "source", "wbr", "area", "col", "track",
                    ]
                    .contains(&tag.as_str()) =>
                {
                    Ok(children)
                }
                _ => Err(
                    "The destination must be a frame or an element that accepts children.".into(),
                ),
            };
        }
    }
    Err(format!("No parent {id} in this canvas."))
}

fn take(nodes: &mut Vec<CanvasNode>, id: &str) -> Option<CanvasNode> {
    if let Some(index) = nodes.iter().position(|n| node_id(n) == id) {
        return Some(nodes.remove(index));
    }
    for node in nodes {
        if let CanvasNode::Element { children, .. } = node {
            if let Some(node) = take(children, id) {
                return Some(node);
            }
        }
    }
    None
}

/// New identities must reach text descendants as well as visible element layers.
pub(super) fn reidentify(node: &mut CanvasNode, mapping: &mut BTreeMap<String, String>) {
    let fresh = uuid::Uuid::now_v7().to_string();
    match node {
        CanvasNode::Element { id, children, .. } => {
            mapping.insert(id.clone(), fresh.clone());
            *id = fresh;
            for child in children {
                reidentify(child, mapping);
            }
        }
        CanvasNode::Text { id, .. } => {
            mapping.insert(id.clone(), fresh.clone());
            *id = fresh;
        }
    }
}

pub(super) fn dimensions(width: u32, height: u32) -> Result<(), String> {
    if (1..=10_000).contains(&width) && (1..=10_000).contains(&height) {
        Ok(())
    } else {
        Err("Use whole-pixel frame dimensions from 1 to 10,000.".into())
    }
}

/// Mutations operate on a private snapshot; a rejected operation never publishes a partial tree.
pub(super) fn mutate(
    canvas: &mut Canvas,
    action: &CanvasAction,
    imported: Option<CanvasContent>,
) -> Result<Value, String> {
    use CanvasAction::*;
    let mut mapping = BTreeMap::new();
    let result = match action {
        CreateFrame {
            name,
            width,
            height,
        } => {
            dimensions(*width, *height)?;
            let x = canvas
                .frames
                .iter()
                .map(|f| f.geometry.x + f.geometry.width + 80.0)
                .reduce(f64::max)
                .unwrap_or(0.0);
            let frame = CanvasFrame {
                id: uuid::Uuid::now_v7().to_string(),
                name: name.clone(),
                geometry: CanvasGeometry {
                    x,
                    y: 0.0,
                    width: *width as f64,
                    height: *height as f64,
                    extra: Default::default(),
                },
                content: CanvasContent {
                    nodes: vec![],
                    css: String::new(),
                    asset_ids: vec![],
                    extra: Default::default(),
                },
                extra: Default::default(),
            };
            let id = frame.id.clone();
            canvas.frames.push(frame);
            json!({"frameId":id})
        }
        ArrangeFrame {
            node,
            x,
            y,
            width,
            height,
            name,
        } => {
            if x.is_none() && y.is_none() && width.is_none() && height.is_none() && name.is_none() {
                return Err("Give at least one frame property to change.".into());
            }
            let frame = canvas
                .frames
                .iter_mut()
                .find(|f| f.id == *node)
                .ok_or("No such frame.")?;
            if let Some(x) = x {
                frame.geometry.x = *x;
            }
            if let Some(y) = y {
                frame.geometry.y = *y;
            }
            if let Some(width) = width {
                dimensions(*width, 1)?;
                frame.geometry.width = *width as f64;
            }
            if let Some(height) = height {
                dimensions(1, *height)?;
                frame.geometry.height = *height as f64;
            }
            if let Some(name) = name {
                frame.name = name.clone();
            }
            json!({"frameId":node})
        }
        Write { parent, .. } => {
            let content = imported.ok_or("HTML was not parsed.")?;
            let frame_id = frame_for(canvas, parent)?.id.clone();
            let ids: Vec<_> = content
                .nodes
                .iter()
                .map(|n| node_id(n).to_string())
                .collect();
            children(canvas, parent)?.extend(content.nodes);
            let frame = canvas.frames.iter_mut().find(|f| f.id == frame_id).unwrap();
            if !content.css.is_empty() {
                frame.content.css.push('\n');
                frame.content.css.push_str(&content.css);
            }
            for asset in content.asset_ids {
                if !frame.content.asset_ids.contains(&asset) {
                    frame.content.asset_ids.push(asset);
                }
            }
            json!({"nodeIds":ids, "frameId":frame_id})
        }
        SetStyle { node, styles } => {
            for frame in &mut canvas.frames {
                if let Some(found) = find_mut(&mut frame.content.nodes, node) {
                    let CanvasNode::Element {
                        styles: current, ..
                    } = found
                    else {
                        return Err("Set styles on the text's containing element.".into());
                    };
                    for (key, value) in styles {
                        let custom = key.strip_prefix("--").is_some_and(|name| {
                            !name.is_empty()
                                && name
                                    .bytes()
                                    .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
                        });
                        let property = key.strip_prefix('-').unwrap_or(key);
                        let standard = property
                            .bytes()
                            .next()
                            .is_some_and(|c| c.is_ascii_alphabetic())
                            && property
                                .bytes()
                                .all(|c| c.is_ascii_alphabetic() || c == b'-');
                        if !custom && !standard {
                            return Err("Use CSS property names in kebab-case.".into());
                        }
                        if let Some(value) = value {
                            current.insert(key.clone(), value.clone());
                        } else {
                            current.remove(key);
                        }
                    }
                    return Ok(json!({"nodeId":node,"frameId":frame.id}));
                }
            }
            return Err("No such element layer.".into());
        }
        SetText { node, text } => {
            for frame in &mut canvas.frames {
                if let Some(found) = find_mut(&mut frame.content.nodes, node) {
                    match found {
                        CanvasNode::Text { text: current, .. } => *current = text.clone(),
                        CanvasNode::Element { tag, children, .. } => {
                            if [
                                "img", "input", "br", "hr", "source", "wbr", "area", "col", "track",
                            ]
                            .contains(&tag.as_str())
                            {
                                return Err("This element cannot contain text.".into());
                            }
                            if children
                                .iter()
                                .any(|n| matches!(n, CanvasNode::Element { .. }))
                            {
                                return Err("This element contains other layers. Target a text layer to preserve them.".into());
                            }
                            if let Some(CanvasNode::Text { text: current, .. }) =
                                children.first_mut()
                            {
                                *current = text.clone();
                                children.truncate(1);
                            } else {
                                children.push(CanvasNode::Text {
                                    id: uuid::Uuid::now_v7().to_string(),
                                    name: "Text".into(),
                                    text: text.clone(),
                                    extra: Default::default(),
                                });
                            }
                        }
                    }
                    return Ok(json!({"nodeId":node,"frameId":frame.id}));
                }
            }
            return Err("No such text layer.".into());
        }
        Move {
            node,
            parent,
            index,
        } => {
            let source = frame_for(canvas, node)?.clone();
            let moving = find(&source.content.nodes, node)
                .ok_or("Use frame arrange to position a frame.")?;
            if node == parent || find(std::slice::from_ref(moving), parent).is_some() {
                return Err("A layer cannot move into itself or its descendants.".into());
            }
            let destination = frame_for(canvas, parent)?.id.clone();
            let moved = take(
                &mut canvas
                    .frames
                    .iter_mut()
                    .find(|f| f.id == source.id)
                    .unwrap()
                    .content
                    .nodes,
                node,
            )
            .unwrap();
            let target = children(canvas, parent)?;
            let index = index.unwrap_or(target.len());
            if index > target.len() {
                return Err("The insertion index exceeds the destination's child count.".into());
            }
            target.insert(index, moved);
            if source.id != destination {
                let frame = canvas
                    .frames
                    .iter_mut()
                    .find(|f| f.id == destination)
                    .unwrap();
                if !source.content.css.trim().is_empty() {
                    return Err("Moving layers across frames with frame CSS needs an explicit HTML write into the destination.".into());
                }
                for asset in source.content.asset_ids {
                    if !frame.content.asset_ids.contains(&asset) {
                        frame.content.asset_ids.push(asset);
                    }
                }
            }
            json!({"nodeId":node,"frameId":destination})
        }
        Duplicate { node } => {
            if let Some(mut frame) = canvas.frames.iter().find(|f| f.id == *node).cloned() {
                let id = uuid::Uuid::now_v7().to_string();
                mapping.insert(frame.id, id.clone());
                frame.id = id.clone();
                frame.name = format!("{} copy", frame.name.chars().take(235).collect::<String>());
                frame.geometry.x = canvas
                    .frames
                    .iter()
                    .map(|f| f.geometry.x + f.geometry.width + 80.0)
                    .reduce(f64::max)
                    .unwrap_or(0.0);
                for child in &mut frame.content.nodes {
                    reidentify(child, &mut mapping);
                }
                canvas.frames.push(frame);
                json!({"frameId":id,"idMap":mapping})
            } else {
                fn duplicate(
                    nodes: &mut Vec<CanvasNode>,
                    id: &str,
                    map: &mut BTreeMap<String, String>,
                ) -> bool {
                    if let Some(index) = nodes.iter().position(|n| node_id(n) == id) {
                        let mut copy = nodes[index].clone();
                        reidentify(&mut copy, map);
                        nodes.insert(index + 1, copy);
                        return true;
                    }
                    nodes.iter_mut().any(|n| match n {
                        CanvasNode::Element { children, .. } => duplicate(children, id, map),
                        _ => false,
                    })
                }
                let frame = canvas
                    .frames
                    .iter_mut()
                    .find(|f| find(&f.content.nodes, node).is_some())
                    .ok_or("No such layer.")?;
                duplicate(&mut frame.content.nodes, node, &mut mapping);
                json!({"frameId":frame.id,"nodeId":mapping.get(node),"idMap":mapping})
            }
        }
        Remove { node } => {
            let frame = frame_for(canvas, node)?.id.clone();
            if frame == *node {
                canvas.frames.retain(|f| f.id != frame);
            } else {
                take(
                    &mut canvas
                        .frames
                        .iter_mut()
                        .find(|f| f.id == frame)
                        .unwrap()
                        .content
                        .nodes,
                    node,
                );
            }
            json!({"removed":node,"frameId":frame})
        }
        _ => return Err("This command is not a node mutation.".into()),
    };
    Ok(result)
}

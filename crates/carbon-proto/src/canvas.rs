use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanvasRequest {
    pub session_id: String,
    pub canvas: Option<String>,
    pub revision: Option<u64>,
    pub action: CanvasAction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum CanvasAction {
    List,
    Context,
    New {
        name: String,
    },
    Tree {
        node: Option<String>,
    },
    Get {
        node: String,
        styles: bool,
    },
    Shot {
        node: String,
    },
    Open {
        node: String,
    },
    Write {
        parent: String,
        html: String,
    },
    SetStyle {
        node: String,
        styles: BTreeMap<String, Option<String>>,
    },
    SetText {
        node: String,
        text: String,
    },
    Move {
        node: String,
        parent: String,
        index: Option<usize>,
    },
    Duplicate {
        node: String,
    },
    Remove {
        node: String,
    },
    Frames,
    CreateFrame {
        name: String,
        width: u32,
        height: u32,
    },
    ArrangeFrame {
        node: String,
        x: Option<f64>,
        y: Option<f64>,
        width: Option<u32>,
        height: Option<u32>,
        name: Option<String>,
    },
    Undo {
        turn: Option<String>,
    },
    Redo,
}

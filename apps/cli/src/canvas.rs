use carbon_proto::{CanvasAction as Action, CanvasRequest, Request, Response};
use clap::{Args, Subcommand};
use std::{collections::BTreeMap, io::Read};

#[derive(Args)]
pub struct CanvasArgs {
    /// Defaults to the calling agent's Carbon session.
    #[arg(long, global = true)]
    session: Option<String>,
    /// Choose another canvas in this session's project.
    #[arg(long, global = true)]
    canvas: Option<String>,
    /// Required for edits; use the revision returned by a read.
    #[arg(long, global = true)]
    revision: Option<u64>,
    #[command(subcommand)]
    command: CanvasCommand,
}

#[derive(Subcommand)]
enum CanvasCommand {
    /// List this project's canvas files.
    Ls,
    /// Read the turn's fixed canvas, selection and open preview.
    Context,
    /// Create a canvas in this session's project.
    New { name: String },
    /// Read a compact hierarchy, optionally beneath one frame or layer.
    Tree { node: Option<String> },
    /// Read editable HTML and stable IDs; optionally include measured CSS.
    Get {
        node: String,
        #[arg(long)]
        styles: bool,
    },
    /// Capture a frame or layer and return PNG evidence with its revision.
    Shot { node: String },
    /// Show a frame in Canvas's right-panel preview.
    Open { node: String },
    /// Append editable HTML from stdin beneath a frame or element.
    Write { parent: String },
    /// Set CSS properties using a JSON object; null removes a property.
    SetStyle { node: String, styles: String },
    /// Replace a text layer's content or an element's text children.
    SetText { node: String, text: String },
    /// Reparent a layer while preserving its ID.
    Mv {
        node: String,
        parent: String,
        #[arg(long)]
        index: Option<usize>,
    },
    /// Duplicate a frame or layer with fresh IDs.
    Dup { node: String },
    /// Remove a frame or layer and its descendants.
    Rm { node: String },
    /// List, create, arrange, resize, rename, duplicate and preview frames.
    #[command(subcommand)]
    Frame(FrameCommand),
    /// Undo a whole turn, preserving later changes. Defaults to the latest step.
    Undo {
        #[arg(long)]
        turn: Option<String>,
    },
    /// Redo the last undone step, preserving later changes.
    Redo,
}

#[derive(Subcommand)]
enum FrameCommand {
    #[command(alias = "list")]
    Ls,
    #[command(alias = "create")]
    New {
        name: String,
        #[arg(long, default_value_t = 1440)]
        width: u32,
        #[arg(long, default_value_t = 900)]
        height: u32,
    },
    Arrange {
        node: String,
        #[arg(long, allow_negative_numbers = true)]
        x: Option<f64>,
        #[arg(long, allow_negative_numbers = true)]
        y: Option<f64>,
    },
    Resize {
        node: String,
        #[arg(long)]
        width: u32,
        #[arg(long)]
        height: u32,
    },
    Rename {
        node: String,
        name: String,
    },
    #[command(alias = "duplicate")]
    Dup {
        node: String,
    },
    Rm {
        node: String,
    },
    Open {
        node: String,
    },
    #[command(alias = "screenshot")]
    Shot {
        node: String,
    },
}

/// Each reply carries the file and revision used, including rendered screenshot evidence.
pub fn run(args: CanvasArgs) -> Result<(), String> {
    let calling = std::env::var("CARBON_SESSION_ID")
        .ok()
        .filter(|id| !id.is_empty());
    if matches!((&calling, &args.session), (Some(calling), Some(chosen)) if calling != chosen) {
        return Err("Canvas commands stay in the calling Carbon session. Use --canvas to choose another file in its project.".into());
    }
    let session = calling
        .or(args.session)
        .ok_or("Run inside a Carbon session, or pass --session from a terminal.")?;
    let action = match args.command {
        CanvasCommand::Ls => Action::List,
        CanvasCommand::Context => Action::Context,
        CanvasCommand::New { name } => Action::New { name },
        CanvasCommand::Tree { node } => Action::Tree { node },
        CanvasCommand::Get { node, styles } => Action::Get { node, styles },
        CanvasCommand::Shot { node } => Action::Shot { node },
        CanvasCommand::Open { node } => Action::Open { node },
        CanvasCommand::Write { parent } => {
            let mut html = String::new();
            std::io::stdin()
                .take(512 * 1024 + 1)
                .read_to_string(&mut html)
                .map_err(|e| e.to_string())?;
            if html.len() > 512 * 1024 {
                return Err("HTML input exceeds 512 KiB. Write smaller groups.".into());
            }
            Action::Write { parent, html }
        }
        CanvasCommand::SetStyle { node, styles } => Action::SetStyle {
            node,
            styles: serde_json::from_str::<BTreeMap<String, Option<String>>>(&styles)
                .map_err(|e| format!("Expected a CSS JSON object: {e}"))?,
        },
        CanvasCommand::SetText { node, text } => Action::SetText { node, text },
        CanvasCommand::Mv {
            node,
            parent,
            index,
        } => Action::Move {
            node,
            parent,
            index,
        },
        CanvasCommand::Dup { node } => Action::Duplicate { node },
        CanvasCommand::Rm { node } => Action::Remove { node },
        CanvasCommand::Undo { turn } => Action::Undo { turn },
        CanvasCommand::Redo => Action::Redo,
        CanvasCommand::Frame(command) => match command {
            FrameCommand::Ls => Action::Frames,
            FrameCommand::New {
                name,
                width,
                height,
            } => Action::CreateFrame {
                name,
                width,
                height,
            },
            FrameCommand::Arrange { node, x, y } => Action::ArrangeFrame {
                node,
                x,
                y,
                width: None,
                height: None,
                name: None,
            },
            FrameCommand::Resize {
                node,
                width,
                height,
            } => Action::ArrangeFrame {
                node,
                x: None,
                y: None,
                width: Some(width),
                height: Some(height),
                name: None,
            },
            FrameCommand::Rename { node, name } => Action::ArrangeFrame {
                node,
                x: None,
                y: None,
                width: None,
                height: None,
                name: Some(name),
            },
            FrameCommand::Dup { node } => Action::Duplicate { node },
            FrameCommand::Rm { node } => Action::Remove { node },
            FrameCommand::Open { node } => Action::Open { node },
            FrameCommand::Shot { node } => Action::Shot { node },
        },
    };
    match super::send(Request::Canvas(CanvasRequest {
        session_id: session,
        canvas: args.canvas,
        revision: args.revision,
        action,
    }))? {
        Response::Canvas { data } => {
            println!(
                "{}",
                serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?
            );
            Ok(())
        }
        Response::Error { message } => Err(message),
        other => Err(super::unexpected(other)),
    }
}

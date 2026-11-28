use crate::events::{AgentEvent, AgentEventPayload as Event, FileChange, ToolType};
use crate::sink::Sink;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashMap, path::Path};
use ts_rs::TS;

#[derive(Clone, Debug, PartialEq, Eq, Hash, Deserialize, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
pub struct CanvasLink {
    pub project: String,
    pub folder: String,
    pub name: String,
    #[serde(default)]
    pub archived: bool,
}

impl CanvasLink {
    pub(crate) fn same_path(&self, other: &Self) -> bool {
        self.project == other.project && self.folder == other.folder && self.name == other.name
    }
}

pub(crate) async fn record(
    id: &str,
    file: CanvasLink,
    sink: &Sink,
) -> Option<crate::store::SessionIndexItem> {
    match crate::store::link_canvas(id, file).await {
        Ok(Some(item)) => {
            let _ = sink.emit(crate::orchestration::SESSION_CHANGED, &item);
            Some(item)
        }
        Ok(None) => None,
        Err(err) => {
            eprintln!("[session canvas link] {err}");
            None
        }
    }
}

const EXT: &str = ".canvas.json";

/// Older CLI requests left their explicit target only in the shell command.
fn historical_canvas_target(args: &[String]) -> Option<String> {
    let mut flags = args.iter();
    let action = loop {
        match flags.next().map(String::as_str) {
            Some("--project" | "--folder" | "--canvas" | "--revision") => {
                flags.next();
            }
            action => break action,
        }
    };
    if !matches!(
        action,
        Some(
            "read"
                | "restore"
                | "undo"
                | "redo"
                | "preview"
                | "page"
                | "layer"
                | "effect"
                | "token"
                | "stroke"
                | "comment"
                | "view"
        )
    ) {
        return None;
    }
    if action == Some("view") && flags.next().map(String::as_str) != Some("open") {
        return None;
    }
    let option = |flag: &str| {
        args.windows(2)
            .find(|pair| pair[0] == flag)
            .map(|pair| pair[1].as_str())
    };
    let name = option("--canvas")?;
    Some(
        Path::new(option("--project").unwrap_or(""))
            .join("canvases")
            .join(option("--folder").unwrap_or(""))
            .join(format!("{name}{EXT}"))
            .to_string_lossy()
            .into_owned(),
    )
}

/// Only file operands count. Printing a canvas name or searching a transcript does not open it.
fn shell_files(command: &str) -> Vec<String> {
    if !command.contains(EXT) && !command.contains("canvas") {
        return vec![];
    }
    let Ok(words) = shell_words::split(command) else {
        return vec![];
    };
    if let [program, flags, nested] = words.as_slice() {
        if matches!(program.rsplit('/').next(), Some("sh" | "zsh" | "bash"))
            && flags.starts_with('-')
            && flags.ends_with('c')
        {
            return shell_files(nested);
        }
    }
    // A successful AND-list ran every operand. Other shell control flow leaves execution ambiguous.
    if command.contains(['|', ';', '\n', '#', '$', '`', '(', ')']) {
        return vec![];
    }
    let mut cwd = std::path::PathBuf::new();
    let mut paths = Vec::new();
    for segment in command.split("&&") {
        if segment.contains('&') {
            return vec![];
        }
        let Ok(words) = shell_words::split(segment) else {
            return vec![];
        };
        let Some((program, args)) = words.split_first() else {
            return vec![];
        };
        let bin = program.rsplit('/').next().unwrap_or(program);
        if bin == "cd" {
            match args {
                [dir] | [_, dir] if args.len() == 1 || args[0] == "--" => cwd.push(dir),
                _ => return vec![],
            }
            continue;
        }
        let mut operands = Vec::new();
        if bin == "carbon" && args.first().is_some_and(|v| v == "canvas") {
            operands.extend(historical_canvas_target(&args[1..]));
        } else {
            let positional: Vec<_> = args.iter().filter(|arg| !arg.starts_with('-')).collect();
            let files = match bin {
                "cat" | "head" | "tail" | "less" | "more" | "tee" | "wc" => positional.as_slice(),
                "grep" | "rg" | "sed" | "jq"
                    if args.iter().all(|a| {
                        !a.starts_with('-')
                            || matches!(a.as_str(), "-n" | "-i" | "-r" | "-c" | "--")
                    }) =>
                {
                    positional.get(1..).unwrap_or_default()
                }
                _ => &[],
            };
            operands.extend(
                files
                    .iter()
                    .filter(|p| p.ends_with(EXT))
                    .map(|p| p.to_string()),
            );
        }
        for pair in args.windows(2) {
            if matches!(pair[0].as_str(), ">" | ">>" | "<")
                && pair[1].ends_with(EXT)
                && segment.contains(&format!(" {} ", pair[0]))
            {
                operands.push(pair[1].clone());
            }
        }
        paths.extend(
            operands
                .into_iter()
                .map(|file| cwd.join(file).to_string_lossy().into_owned()),
        );
    }
    paths
}

fn paths(input: &Value, kind: ToolType) -> Vec<String> {
    let input = input.get("tool_input").unwrap_or(input);
    if kind == ToolType::Shell {
        let mut files = input["command"]
            .as_str()
            .map(shell_files)
            .unwrap_or_default();
        if let Some(cwd) = input["cwd"].as_str() {
            for path in &mut files {
                *path = Path::new(cwd).join(&*path).to_string_lossy().into_owned();
            }
        }
        return files;
    }
    ["file_path", "target_file", "path"]
        .into_iter()
        .filter_map(|k| input[k].as_str())
        .chain(
            input["paths"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str),
        )
        .filter(|p| p.ends_with(EXT))
        .map(str::to_owned)
        .collect()
}

#[derive(Debug, Default)]
pub(crate) struct FileUses {
    calls: HashMap<(Option<String>, String), (ToolType, Vec<String>)>,
}

impl FileUses {
    /// Credit reads and writes only after the harness reports success, including late ACP arguments.
    pub(crate) fn observe(&mut self, event: &AgentEvent) -> Vec<String> {
        let key = |id: &String| (event.subagent.as_ref().map(|s| s.id.clone()), id.clone());
        match &event.payload {
            Event::ToolCallStarted {
                call_id,
                tool_type: kind @ (ToolType::FileRead | ToolType::FileEdit | ToolType::Shell),
                input,
                ..
            } => {
                self.calls
                    .insert(key(call_id), (*kind, paths(input, *kind)));
            }
            Event::ToolCallUpdated { call_id, input } => {
                if let Some((kind, files)) = self.calls.get_mut(&key(call_id)) {
                    files.extend(paths(input, *kind));
                }
            }
            Event::FileEdits { call_id, edits } => {
                let files = edits
                    .iter()
                    .filter(|e| e.change != FileChange::Delete && e.path.ends_with(EXT))
                    .map(|e| e.path.clone());
                if let Some(call) = call_id.as_ref().and_then(|id| self.calls.get_mut(&key(id))) {
                    call.1.extend(files);
                } else {
                    return files.collect();
                }
            }
            Event::ToolCallCompleted { call_id, result } => {
                if let Some((_, files)) = self.calls.remove(&key(call_id)) {
                    if !result.is_error && result.exit_code.unwrap_or(0) == 0 {
                        return files;
                    }
                }
            }
            Event::TurnCompleted { .. } => {
                self.calls.retain(|(subagent, _), _| {
                    subagent.as_deref() != event.subagent.as_ref().map(|s| s.id.as_str())
                });
            }
            _ => {}
        }
        vec![]
    }
}

/// The Files tab already has an absolute path on the session's server.
pub(crate) async fn link_open_file(id: String, path: String, sink: &Sink) -> Result<(), String> {
    if !Path::new(&path).is_absolute() || !path.ends_with(EXT) {
        return Ok(());
    }
    record_paths(&id, "", vec![path], sink).await;
    Ok(())
}

pub(crate) async fn record_paths(id: &str, cwd: &str, paths: Vec<String>, sink: &Sink) {
    for file in resolve_paths(cwd, paths).await {
        record(id, file, sink).await;
    }
}

async fn resolve_paths(cwd: &str, paths: Vec<String>) -> Vec<CanvasLink> {
    let mut links = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for path in paths {
        if !seen.insert(path.clone()) {
            continue;
        }
        let Ok(path) = tokio::fs::canonicalize(Path::new(cwd).join(path)).await else {
            continue;
        };
        if !tokio::fs::metadata(&path).await.is_ok_and(|m| m.is_file()) {
            continue;
        }
        let Some(name) = path
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(|n| n.strip_suffix(EXT))
        else {
            continue;
        };
        let Some(parent) = path.parent() else {
            continue;
        };
        for library in parent
            .ancestors()
            .filter(|p| p.file_name().is_some_and(|n| n == "canvases"))
        {
            let Some(project) = library.parent().and_then(Path::to_str) else {
                continue;
            };
            let folder = parent.strip_prefix(library).unwrap().to_string_lossy();
            if folder.split('/').any(|part| part.starts_with('.')) {
                continue;
            }
            if crate::canvas_library::document_root(project.to_owned())
                .await
                .is_ok()
            {
                links.push(CanvasLink {
                    project: project.into(),
                    folder: folder.into_owned(),
                    name: name.into(),
                    archived: false,
                });
                break;
            }
        }
    }
    links
}

/// Recover file operations from the page being replayed without reading older turns.
pub(crate) async fn historical(cwd: &str, events: &[AgentEvent]) -> Vec<CanvasLink> {
    let mut uses = FileUses::default();
    let mut paths: Vec<_> = events.iter().flat_map(|e| uses.observe(e)).collect();
    paths.reverse();
    resolve_paths(cwd, paths).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn event(payload: Value, agent: Option<&str>) -> AgentEvent {
        serde_json::from_value(json!({
            "id":"e", "sessionId":"s", "harness":"codex", "seq":1, "ts":"",
            "subagent":agent.map(|id| json!({"id":id})), "payload": payload
        }))
        .unwrap()
    }

    #[test]
    fn attributes_late_file_arguments_to_the_successful_call() {
        let mut uses = FileUses::default();
        let start = json!({"type":"tool_call_started","callId":"one","name":"Read","toolType":"file_read","input":{}});
        let update = json!({"type":"tool_call_updated","callId":"one","input":{"file_path":"canvases/order.canvas.json"}});
        let end = |failed| json!({"type":"tool_call_completed","callId":"one","result":{"text":"","isError":failed}});
        for agent in [None, Some("child")] {
            assert!(uses.observe(&event(start.clone(), agent)).is_empty());
            assert!(uses.observe(&event(update.clone(), agent)).is_empty());
        }
        assert!(uses.observe(&event(end(true), Some("child"))).is_empty());
        assert_eq!(
            uses.observe(&event(end(false), None)),
            ["canvases/order.canvas.json"]
        );
    }

    #[test]
    fn recognizes_file_operands_and_explicit_canvas_targets() {
        assert_eq!(
            shell_files(r#"/bin/zsh -lc 'cat "canvases/Order flow.canvas.json"'"#),
            ["canvases/Order flow.canvas.json"]
        );
        assert_eq!(
            shell_files("carbon canvas --project /repo --folder mobile --canvas cart read"),
            ["/repo/canvases/mobile/cart.canvas.json"]
        );
        assert_eq!(
            shell_files("cd canvases && cat cart.canvas.json"),
            ["canvases/cart.canvas.json"]
        );
        assert!(shell_files("true || cat canvases/cart.canvas.json").is_empty());
        assert!(shell_files("rg 'cart.canvas.json' README").is_empty());
        assert!(shell_files("rg --files -g cart.canvas.json").is_empty());
        assert!(shell_files("carbon canvas --canvas cart view state").is_empty());
        assert!(shell_files("echo canvases/cart.canvas.json").is_empty());
        assert!(shell_files("carbon canvas list --canvas cart").is_empty());
    }
}

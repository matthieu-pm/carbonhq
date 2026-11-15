//! Standard ACP onto Carbon's vocabulary.
//!
//! grok's mapper with every grok-ism taken out. A turn opens on its first
//! update and closes on the prompt's answer; chunks carry no id, so one block
//! runs until a chunk of the other kind arrives.

use crate::events::{
    usage::ContextWindow, AgentEvent, AgentEventPayload, BlockType, DeltaEvent, FileChange,
    FileEdit, SessionInfo, ToolResult, TurnStatus, Usage,
};
use crate::harness::acp::{self, block_ref, OpenBlock};
use crate::harness::{mentions_any, Harness};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
use std::sync::Arc;

use super::parser::{AcpEvent, PromptResponse, SessionUpdate, ToolContent, ToolKind, ToolStatus};

/// Written to under-match, for [`mentions_any`]'s reason.
const LOGIN_NEEDLES: &[&str] = &[
    "authentication required",
    "not authenticated",
    "not logged in",
    "log in",
];

/// What a call opened with, so a permission card can name its subject — a
/// request often carries the call id and nothing else.
#[derive(Debug, Clone)]
pub struct KnownCall {
    pub title: Option<String>,
    pub input: Value,
}

pub struct Mapper {
    session_id: String,
    harness: Harness,
    seq: Arc<AtomicU64>,
    pub(super) turn_open: bool,
    open: Option<OpenBlock>,
    blocks: u64,
    occupancy: Option<ContextWindow>,
    /// The newest non-empty text a running call streamed, by call id.
    outputs: HashMap<String, String>,
    diffs: HashMap<String, Value>,
    file_edits: HashMap<String, Vec<FileEdit>>,
    /// An exit code by call id. Devin reports it on an in-progress update and
    /// closes the call with an empty one, so it has to outlive the update.
    exits: HashMap<String, i32>,
    /// Calls opened with no arguments yet, held until an update brings some.
    undrawn: HashMap<String, ToolKind>,
    calls: HashMap<String, KnownCall>,
}

impl Mapper {
    pub fn new(session_id: String, harness: Harness, seq: Arc<AtomicU64>) -> Self {
        Self {
            session_id,
            harness,
            seq,
            turn_open: false,
            open: None,
            blocks: 0,
            occupancy: None,
            outputs: HashMap::new(),
            diffs: HashMap::new(),
            file_edits: HashMap::new(),
            exits: HashMap::new(),
            undrawn: HashMap::new(),
            calls: HashMap::new(),
        }
    }

    pub fn call(&self, id: &str) -> Option<&KnownCall> {
        self.calls.get(id)
    }

    /// Keeps partial tool updates on the same transcript row.
    pub fn map(&mut self, event: AcpEvent) -> Vec<AgentEvent> {
        match event {
            AcpEvent::Update(update) => self.update(update),
            AcpEvent::PromptDone(response) => self.prompt_done(response),
            AcpEvent::PromptFailed { message } => self.prompt_failed(message),
        }
    }

    fn update(&mut self, update: SessionUpdate) -> Vec<AgentEvent> {
        match update {
            SessionUpdate::AgentMessageChunk { content } => match content.text() {
                Some(text) => self.chunk(BlockType::Text, text),
                None => Vec::new(),
            },
            SessionUpdate::AgentThoughtChunk { content } => match content.text() {
                Some(text) => self.chunk(BlockType::Thinking, text),
                None => Vec::new(),
            },

            SessionUpdate::ToolCall {
                tool_call_id,
                title,
                kind,
                status,
                content,
                raw_input,
            } => {
                let finished = status.filter(|s| s.is_final());
                let edits = self.remember_output(&tool_call_id, &content);
                let input = self.tool_input(&tool_call_id, raw_input, &content);
                // An edit announced before its arguments is drawn by the update
                // that brings them, or its row keeps an empty input for good.
                if finished.is_none() && is_empty(&input) {
                    self.calls
                        .insert(tool_call_id.clone(), KnownCall { title, input });
                    self.undrawn.insert(tool_call_id, kind);
                    return Vec::new();
                }
                let mut out = self.open_call(tool_call_id.clone(), title, kind, input);
                if let Some(edits) = edits {
                    out.push(self.event(AgentEventPayload::FileEdits {
                        call_id: Some(tool_call_id.clone()),
                        edits,
                    }));
                }
                // A quick call can arrive finished on its opening line. Not a
                // replay: the read loop drops those before the session opens.
                if finished.is_some() {
                    out.extend(self.update(SessionUpdate::ToolCallUpdate {
                        tool_call_id,
                        title: None,
                        status: finished,
                        content,
                        raw_input: None,
                        meta: None,
                    }));
                }
                out
            }

            SessionUpdate::ToolCallUpdate {
                tool_call_id,
                title,
                status,
                content,
                raw_input,
                meta,
            } => {
                let mut out = Vec::new();
                let undrawn = self.undrawn.remove(&tool_call_id);
                let known = self.calls.get(&tool_call_id).cloned();
                let raw_input = raw_input.or_else(|| known.as_ref().map(|call| call.input.clone()));
                let edits = self.remember_output(&tool_call_id, &content);
                let input = self.tool_input(&tool_call_id, raw_input, &content);
                let title = title.or_else(|| known.as_ref().and_then(|call| call.title.clone()));
                if undrawn.is_some() || known.is_none() {
                    out.extend(self.open_call(
                        tool_call_id.clone(),
                        title,
                        undrawn.unwrap_or_default(),
                        input,
                    ));
                } else {
                    if known.as_ref().is_some_and(|call| call.input != input) {
                        out.push(self.event(AgentEventPayload::ToolCallUpdated {
                            call_id: tool_call_id.clone(),
                            input: input.clone(),
                        }));
                    }
                    self.calls
                        .insert(tool_call_id.clone(), KnownCall { title, input });
                }

                if let Some(edits) = edits {
                    out.push(self.event(AgentEventPayload::FileEdits {
                        call_id: Some(tool_call_id.clone()),
                        edits,
                    }));
                }
                if let Some(code) = exit_code(meta.as_ref()) {
                    self.exits.insert(tool_call_id.clone(), code);
                }
                let Some(status) = status.filter(|s| s.is_final()) else {
                    return out;
                };

                let text = self.outputs.remove(&tool_call_id).unwrap_or_default();
                let exit_code = self.exits.remove(&tool_call_id);
                self.diffs.remove(&tool_call_id);
                out.push(self.event(AgentEventPayload::ToolCallCompleted {
                    call_id: tool_call_id,
                    result: ToolResult {
                        text,
                        is_error: status == ToolStatus::Failed,
                        structured: None,
                        exit_code,
                        duration_ms: None,
                        images: Vec::new(),
                    },
                }));
                out.push(self.event(AgentEventPayload::ModelRequestStarted));
                out
            }

            SessionUpdate::UsageUpdate { used, size } => {
                if let (Some(used), Some(size)) = (used, size) {
                    self.occupancy = Some(ContextWindow {
                        used_tokens: used,
                        max_tokens: size,
                    });
                }
                Vec::new()
            }

            // Read by the read loop, not drawn.
            SessionUpdate::SessionInfoUpdate { .. }
            | SessionUpdate::AvailableCommandsUpdate { .. }
            | SessionUpdate::CurrentModeUpdate { .. }
            | SessionUpdate::ConfigOptionUpdate { .. }
            | SessionUpdate::UserMessageChunk
            | SessionUpdate::Plan
            | SessionUpdate::Unknown => Vec::new(),
        }
    }

    fn tool_input(&self, id: &str, raw: Option<Value>, content: &[ToolContent]) -> Value {
        let mut input = tool_input(raw, content);
        if let (Some(map), Some(Value::Object(diff))) = (input.as_object_mut(), self.diffs.get(id))
        {
            if diff.contains_key("content") {
                map.remove("old_string");
                map.remove("new_string");
            } else {
                map.remove("content");
            }
            map.extend(diff.clone());
        }
        input
    }

    fn remember_output(&mut self, id: &str, content: &[ToolContent]) -> Option<Vec<FileEdit>> {
        let text: String = content
            .iter()
            .filter_map(|part| match part {
                ToolContent::Content { content } => content.text(),
                _ => None,
            })
            .collect();
        if !text.is_empty() {
            self.outputs.insert(id.to_string(), text);
        }
        if content
            .iter()
            .any(|part| matches!(part, ToolContent::Diff { .. }))
        {
            self.diffs.insert(id.to_string(), tool_input(None, content));
        }
        let edits = self.file_edits.entry(id.to_string()).or_default();
        let mut changed = false;
        for part in content {
            let ToolContent::Diff {
                path,
                old_text,
                new_text,
            } = part
            else {
                continue;
            };
            let existing = edits.iter().position(|edit| edit.path == *path);
            if old_text.as_deref() == Some(new_text.as_str()) {
                if let Some(index) = existing {
                    edits.remove(index);
                    changed = true;
                }
                continue;
            }
            let diff = git2::Patch::from_buffers(
                old_text.as_deref().unwrap_or("").as_bytes(),
                Some(std::path::Path::new(path)),
                new_text.as_bytes(),
                Some(std::path::Path::new(path)),
                None,
            )
            .and_then(|mut patch| patch.to_buf())
            .ok()
            .map(|buffer| String::from_utf8_lossy(&buffer).into_owned());
            let edit = FileEdit {
                path: path.clone(),
                change: if old_text.is_none() {
                    FileChange::Add
                } else {
                    FileChange::Update
                },
                unified_diff: diff,
            };
            match existing {
                Some(index)
                    if edits[index].change == edit.change
                        && edits[index].unified_diff == edit.unified_diff => {}
                Some(index) => {
                    edits[index] = edit;
                    changed = true;
                }
                None => {
                    edits.push(edit);
                    changed = true;
                }
            }
        }
        changed.then(|| edits.clone())
    }

    fn chunk(&mut self, kind: BlockType, text: &str) -> Vec<AgentEvent> {
        let mut out = self.ensure_turn();
        out.extend(self.stream(kind, text));
        out
    }

    fn open_call(
        &mut self,
        id: String,
        title: Option<String>,
        kind: ToolKind,
        input: Value,
    ) -> Vec<AgentEvent> {
        self.calls.insert(
            id.clone(),
            KnownCall {
                title: title.clone(),
                input: input.clone(),
            },
        );
        let mut out = self.ensure_turn();
        out.extend(self.close_open());
        out.push(self.event(AgentEventPayload::ToolCallStarted {
            call_id: id,
            tool_type: kind.tool_type(),
            name: kind.name().to_string(),
            input,
            raw_input: None,
            // Standard ACP's title is a sentence about the call ("Wrote
            // ./hello.txt"), which is what the row should say.
            title,
        }));
        out
    }

    /// Draws every call still held for its arguments, so a turn cut short
    /// leaves them on screen for the transcript to mark unfinished.
    fn flush_undrawn(&mut self) -> Vec<AgentEvent> {
        let mut held: Vec<(String, ToolKind)> = self.undrawn.drain().collect();
        held.sort_by(|a, b| a.0.cmp(&b.0));
        let mut out = Vec::new();
        for (id, kind) in held {
            let known = self.calls.remove(&id);
            let (title, input) = known.map_or((None, json!({})), |k| (k.title, k.input));
            out.extend(self.open_call(id, title, kind, input));
        }
        out
    }

    fn prompt_done(&mut self, response: PromptResponse) -> Vec<AgentEvent> {
        let mut out = self.flush_undrawn();
        out.extend(self.close_open());
        let (status, final_text) = match response.stop_reason.as_str() {
            "refusal" | "refused" => (
                TurnStatus::Error,
                Some("The agent refused this prompt.".to_string()),
            ),
            "max_tokens" => (
                TurnStatus::Error,
                Some("The agent stopped: the model hit its output token limit.".to_string()),
            ),
            "max_turn_requests" => (
                TurnStatus::Error,
                Some("The agent stopped: the turn hit its request limit.".to_string()),
            ),
            // `end_turn`, and `cancelled` — the reader's own Stop. A call left
            // open by a cancel is closed by the transcript's abandoned rule.
            _ => (TurnStatus::Success, None),
        };
        let usage = response.usage.map(|u| Usage {
            input_tokens: u.input_tokens,
            output_tokens: u.output_tokens,
            cached_input_tokens: u.cached_read_tokens,
            reasoning_tokens: u.thought_tokens,
            context_window: self.occupancy,
            ..Default::default()
        });
        out.push(self.turn_completed(status, Some(response.stop_reason), final_text, false, usage));
        out
    }

    fn prompt_failed(&mut self, message: String) -> Vec<AgentEvent> {
        let mut out = self.flush_undrawn();
        out.extend(self.close_open());
        let auth_failed = mentions_any(&message, LOGIN_NEEDLES);
        out.push(self.turn_completed(TurnStatus::Error, None, Some(message), auth_failed, None));
        out
    }

    fn turn_completed(
        &mut self,
        status: TurnStatus,
        stop_reason: Option<String>,
        final_text: Option<String>,
        auth_failed: bool,
        usage: Option<Usage>,
    ) -> AgentEvent {
        let event = self.event(AgentEventPayload::TurnCompleted {
            status,
            stop_reason,
            auth_failed,
            final_text,
            usage: usage.or_else(|| {
                self.occupancy.map(|window| Usage {
                    context_window: Some(window),
                    ..Default::default()
                })
            }),
            duration_ms: None,
            head: None,
        });
        self.turn_open = false;
        self.outputs.clear();
        self.diffs.clear();
        self.file_edits.clear();
        self.exits.clear();
        self.undrawn.clear();
        self.calls.clear();
        event
    }

    fn ensure_turn(&mut self) -> Vec<AgentEvent> {
        if self.turn_open {
            return Vec::new();
        }
        self.turn_open = true;
        vec![
            self.event(AgentEventPayload::TurnStarted(SessionInfo::default())),
            self.event(AgentEventPayload::ModelRequestStarted),
        ]
    }

    fn stream(&mut self, kind: BlockType, text: &str) -> Vec<AgentEvent> {
        let mut out = Vec::new();
        let id = match &self.open {
            Some(block) if block.kind == kind => block.id.clone(),
            _ => {
                out.extend(self.close_open());
                self.blocks += 1;
                let id = format!("block-{}", self.blocks);
                out.push(self.event(AgentEventPayload::Delta(DeltaEvent::BlockStart {
                    block: block_ref(&id),
                    block_type: kind.clone(),
                })));
                self.open = Some(OpenBlock {
                    id: id.clone(),
                    kind,
                    text: String::new(),
                });
                id
            }
        };
        if let Some(block) = &mut self.open {
            block.text.push_str(text);
        }
        out.push(self.event(AgentEventPayload::Delta(DeltaEvent::TextDelta {
            block: block_ref(&id),
            text: text.to_string(),
        })));
        out
    }

    fn close_open(&mut self) -> Vec<AgentEvent> {
        match self.open.take() {
            Some(block) => acp::commit(block, |payload| self.event(payload)),
            None => Vec::new(),
        }
    }

    /// For events raised from a JSON-RPC request rather than an update.
    pub fn synthesize(&self, payload: AgentEventPayload) -> AgentEvent {
        self.event(payload)
    }

    fn event(&self, payload: AgentEventPayload) -> AgentEvent {
        AgentEvent::mint(
            self.session_id.clone(),
            self.harness,
            self.seq.fetch_add(1, Relaxed),
            None,
            None,
            payload,
        )
    }
}

/// The call's arguments as the row draws them, always an object.
///
/// An edit's sides come from the `diff` content where `rawInput` lacks them,
/// under the names Carbon's diff rows read (`file_path`, `old_string`,
/// `new_string`, `content`) — so an edit draws as a diff on any agent that
/// follows the protocol, whatever it calls its own fields.
fn tool_input(raw: Option<Value>, content: &[ToolContent]) -> Value {
    let mut input = match raw {
        Some(Value::Object(map)) => Value::Object(map),
        Some(Value::Null) | None => json!({}),
        Some(other) => json!({ "_unparsed": other.to_string() }),
    };
    let Some(map) = input.as_object_mut() else {
        return input;
    };
    if let Some(ToolContent::Diff {
        path,
        old_text,
        new_text,
    }) = content
        .iter()
        .find(|c| matches!(c, ToolContent::Diff { .. }))
    {
        if !path.is_empty() {
            map.insert("file_path".into(), json!(path));
        }
        match old_text {
            Some(old) => {
                map.remove("content");
                map.insert("old_string".into(), json!(old));
                map.insert("new_string".into(), json!(new_text));
            }
            None => {
                map.remove("old_string");
                map.remove("new_string");
                map.insert("content".into(), json!(new_text));
            }
        }
    }
    input
}

fn is_empty(input: &Value) -> bool {
    input.as_object().is_some_and(|map| map.is_empty())
}

/// A shell's exit code, where the agent says. Not ACP — Devin's
/// `_meta.terminal_exit` — but un-namespaced and cheap to read.
fn exit_code(meta: Option<&Value>) -> Option<i32> {
    meta?
        .pointer("/terminal_exit/exit_code")?
        .as_i64()
        .map(|c| c as i32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::AgentEventPayload as P;
    use crate::harness::agents::parser::{parse_notification, AcpEvent};

    /// Replays a capture the way the read loop does: updates after the
    /// session opened, then the prompt's answer.
    fn replay(fixture: &str) -> Vec<AgentEvent> {
        let mut mapper = Mapper::new(
            "s".into(),
            Harness::Acp("devin"),
            Arc::new(AtomicU64::new(0)),
        );
        let mut out = Vec::new();
        let mut opened = false;
        let mut prompt_id = None;

        for line in fixture.lines() {
            if let Some(sent) = line.strip_prefix(">> ") {
                let value: Value = serde_json::from_str(sent).unwrap();
                if value["method"] == "session/prompt" {
                    prompt_id = value["id"].as_i64();
                }
                continue;
            }
            let Some(line) = line.strip_prefix("<< ") else {
                continue;
            };
            let value: Value = serde_json::from_str(line).unwrap();
            if !opened {
                opened = value.pointer("/result/configOptions").is_some();
                continue;
            }
            if let Some(method) = value["method"].as_str() {
                if value.get("id").is_some() {
                    continue;
                }
                if let Ok(note) = parse_notification(method, value["params"].clone()) {
                    out.extend(mapper.map(AcpEvent::Update(note.update)));
                }
            } else if value["id"].as_i64() == prompt_id && prompt_id.is_some() {
                let response = serde_json::from_value(value["result"].clone()).unwrap();
                out.extend(mapper.map(AcpEvent::PromptDone(response)));
            }
        }
        out
    }

    /// The write draws as a diff from the `diff` content, the shell's result is
    /// the listing it streamed, and its exit code survives.
    #[test]
    fn a_devin_turn_draws_its_edit_and_its_shell() {
        let events = replay(include_str!("fixtures/devin_turn.jsonl"));

        let write = events
            .iter()
            .find_map(|e| match &e.payload {
                P::ToolCallStarted { input, title, .. } if input.get("content").is_some() => {
                    Some((input, title))
                }
                _ => None,
            })
            .expect("the write opened");
        assert!(write.0["file_path"]
            .as_str()
            .unwrap()
            .ends_with("hello.txt"));
        assert_eq!(write.0["content"], "hi");
        assert_eq!(write.1.as_deref(), Some("Wrote ./hello.txt"));

        let results: Vec<&ToolResult> = events
            .iter()
            .filter_map(|e| match &e.payload {
                P::ToolCallCompleted { result, .. } => Some(result),
                _ => None,
            })
            .collect();
        assert_eq!(results.len(), 2);
        let shell = results
            .iter()
            .find(|r| r.text.contains("hello.txt"))
            .expect("ls output kept");
        assert_eq!(shell.exit_code, Some(0));

        let last = events.last().expect("events");
        assert!(
            matches!(&last.payload, P::TurnCompleted { status: TurnStatus::Success, usage: Some(u), .. }
            if u.context_window.is_some())
        );
    }

    /// A cancelled turn is the reader's own Stop, not a failure.
    #[test]
    fn a_cancelled_turn_closes_quietly() {
        let events = replay(include_str!("fixtures/devin_cancel.jsonl"));
        assert!(matches!(
            &events.last().expect("events").payload,
            P::TurnCompleted { status: TurnStatus::Success, stop_reason: Some(r), .. } if r == "cancelled"
        ));
    }

    fn updates(lines: &[Value]) -> Vec<AgentEvent> {
        let mut mapper = Mapper::new(
            "s".into(),
            Harness::Acp("test"),
            Arc::new(AtomicU64::new(0)),
        );
        lines
            .iter()
            .flat_map(|update| {
                let params = json!({ "sessionId": "x", "update": update });
                let Ok(note) = parse_notification("session/update", params) else {
                    panic!("unparsed")
                };
                mapper.map(AcpEvent::Update(note.update))
            })
            .collect()
    }

    /// An edit announced bare is drawn by the update carrying its diff.
    #[test]
    fn a_call_opened_with_no_arguments_waits_for_them() {
        let events = updates(&[
            json!({"sessionUpdate":"tool_call","toolCallId":"c","title":"Edit","kind":"edit","status":"pending"}),
            json!({"sessionUpdate":"tool_call_update","toolCallId":"c","status":"in_progress",
                "content":[{"type":"diff","path":"/a.txt","oldText":"x","newText":"y"}]}),
            json!({"sessionUpdate":"tool_call_update","toolCallId":"c","status":"completed"}),
        ]);
        let starts: Vec<&Value> = events
            .iter()
            .filter_map(|e| match &e.payload {
                P::ToolCallStarted { input, .. } => Some(input),
                _ => None,
            })
            .collect();
        assert_eq!(starts.len(), 1);
        assert_eq!(starts[0]["new_string"], "y");
        assert!(events
            .iter()
            .any(|e| matches!(e.payload, P::ToolCallCompleted { .. })));
    }

    /// A call that arrives finished is drawn whole, not dropped as a replay.
    #[test]
    fn a_call_opened_finished_is_drawn() {
        let events = updates(&[
            json!({"sessionUpdate":"tool_call","toolCallId":"c","title":"Read",
            "kind":"read","status":"failed","rawInput":{"path":"/a"},
            "content":[{"type":"content","content":{"type":"text","text":"no such file"}}]}),
        ]);
        assert!(events
            .iter()
            .any(|e| matches!(e.payload, P::ToolCallStarted { .. })));
        assert!(events.iter().any(|e| matches!(&e.payload,
            P::ToolCallCompleted { result, .. } if result.is_error && result.text == "no such file")));
    }

    /// A call still waiting on its arguments when the turn is cut short is
    /// drawn, so the transcript can mark it unfinished instead of losing it.
    #[test]
    fn a_held_call_is_drawn_when_the_turn_ends() {
        let mut mapper = Mapper::new(
            "s".into(),
            Harness::Acp("test"),
            Arc::new(AtomicU64::new(0)),
        );
        let params = json!({"sessionId": "x", "update":
            {"sessionUpdate":"tool_call","toolCallId":"c","title":"Run","kind":"execute","status":"pending"}});
        let Ok(note) = parse_notification("session/update", params) else {
            panic!("unparsed")
        };
        assert!(mapper.map(AcpEvent::Update(note.update)).is_empty());

        let done = serde_json::from_value(json!({"stopReason": "cancelled"})).unwrap();
        let events = mapper.map(AcpEvent::PromptDone(done));
        assert!(events.iter().any(
            |e| matches!(&e.payload, P::ToolCallStarted { title: Some(t), .. } if t == "Run")
        ));
        assert!(matches!(
            events.last().unwrap().payload,
            P::TurnCompleted { .. }
        ));
    }
    #[test]
    fn a_diff_arriving_after_partial_arguments_updates_the_existing_call() {
        let events = updates(&[
            json!({"sessionUpdate":"tool_call","toolCallId":"c","kind":"edit","status":"pending",
                "rawInput":{"path":"/a.txt"}}),
            json!({"sessionUpdate":"tool_call_update","toolCallId":"c","status":"completed",
                "content":[{"type":"diff","path":"/a.txt","oldText":"x","newText":"y"}]}),
        ]);
        assert_eq!(
            events
                .iter()
                .filter(|event| matches!(event.payload, P::ToolCallStarted { .. }))
                .count(),
            1
        );
        let changed = events
            .iter()
            .find_map(|event| match &event.payload {
                P::ToolCallUpdated { call_id, input } if call_id == "c" => Some(input),
                _ => None,
            })
            .expect("late diff reaches the existing row");
        assert_eq!(changed["file_path"], "/a.txt");
        assert_eq!(changed["old_string"], "x");
        assert_eq!(changed["new_string"], "y");
        assert!(events.iter().any(|event| matches!(&event.payload,
            P::ToolCallCompleted { result, .. } if result.text.is_empty())));
    }

    #[test]
    fn late_arguments_replace_the_normalized_input_only_when_changed() {
        let events = updates(&[
            json!({"sessionUpdate":"tool_call","toolCallId":"c","kind":"execute",
                "rawInput":{"command":"echo"}}),
            json!({"sessionUpdate":"tool_call_update","toolCallId":"c",
                "rawInput":{"command":"echo done"}}),
            json!({"sessionUpdate":"tool_call_update","toolCallId":"c","status":"completed",
                "rawInput":{"command":"echo done"}}),
        ]);
        let changed: Vec<&Value> = events
            .iter()
            .filter_map(|event| match &event.payload {
                P::ToolCallUpdated { input, .. } => Some(input),
                _ => None,
            })
            .collect();
        assert_eq!(changed.len(), 1);
        assert_eq!(changed[0]["command"], "echo done");
    }

    #[test]
    fn output_on_the_opening_call_survives_an_empty_completion() {
        let events = updates(&[
            json!({"sessionUpdate":"tool_call","toolCallId":"c","kind":"execute","status":"in_progress",
                "rawInput":{"command":"pwd"},
                "content":[{"type":"content","content":{"type":"text","text":"/project"}}]}),
            json!({"sessionUpdate":"tool_call_update","toolCallId":"c","status":"completed"}),
        ]);
        assert!(events.iter().any(|event| matches!(&event.payload,
            P::ToolCallCompleted { result, .. } if result.text == "/project")));
    }

    #[test]
    fn a_failed_edit_keeps_its_error_text_after_publishing_a_diff() {
        let events = updates(&[
            json!({"sessionUpdate":"tool_call","toolCallId":"c","kind":"edit","status":"in_progress",
                "content":[{"type":"diff","path":"/a.txt","oldText":"x","newText":"y"}]}),
            json!({"sessionUpdate":"tool_call_update","toolCallId":"c","status":"failed",
                "content":[{"type":"content","content":{"type":"text","text":"Could not save /a.txt: permission denied"}}]}),
        ]);
        assert!(events.iter().any(|event| matches!(&event.payload,
            P::FileEdits { call_id: Some(id), edits } if id == "c" && edits.iter().any(|edit| edit.path == "/a.txt"))));
        assert!(events.iter().any(|event| matches!(&event.payload,
            P::ToolCallCompleted { call_id, result } if call_id == "c" && result.is_error && result.text == "Could not save /a.txt: permission denied")));
    }

    #[test]
    fn updated_diffs_replace_earlier_diff_sides_and_survive_an_empty_completion() {
        let events = updates(&[
            json!({"sessionUpdate":"tool_call","toolCallId":"c","kind":"edit","status":"in_progress",
                "content":[{"type":"diff","path":"/a","oldText":"x","newText":"y"}]}),
            json!({"sessionUpdate":"tool_call_update","toolCallId":"c","status":"in_progress",
                "content":[{"type":"diff","path":"/a","oldText":"x","newText":"z"}]}),
            json!({"sessionUpdate":"tool_call_update","toolCallId":"c","status":"completed", "rawInput":{"path":"/a"}}),
        ]);
        let last_input = events
            .iter()
            .filter_map(|event| match &event.payload {
                P::ToolCallUpdated { input, .. } => Some(input),
                _ => None,
            })
            .last()
            .expect("the latest diff is published");
        assert_eq!(last_input["new_string"], "z");
        assert!(events.iter().any(|event| matches!(&event.payload,
            P::ToolCallCompleted { result, .. } if result.text.is_empty())));
    }
    #[test]
    fn multiple_file_diffs_keep_each_paths_latest_change() {
        let events = updates(&[
            json!({"sessionUpdate":"tool_call","toolCallId":"c","kind":"edit","status":"in_progress",
            "content":[
                {"type":"diff","path":"/a.txt","oldText":"before-a\n","newText":"after-a\n"},
                {"type":"diff","path":"/b.txt","oldText":null,"newText":"first-b\n"}
            ]}),
            json!({"sessionUpdate":"tool_call_update","toolCallId":"c","status":"in_progress",
                "content":[{"type":"diff","path":"/b.txt","oldText":null,"newText":"latest-b\n"}]}),
            json!({"sessionUpdate":"tool_call_update","toolCallId":"c","status":"completed",
                "content":[{"type":"diff","path":"/b.txt","oldText":null,"newText":"latest-b\n"}]}),
        ]);
        let publications: Vec<&Vec<FileEdit>> = events
            .iter()
            .filter_map(|event| match &event.payload {
                P::FileEdits {
                    call_id: Some(call_id),
                    edits,
                } if call_id == "c" => Some(edits),
                _ => None,
            })
            .collect();
        assert_eq!(publications.len(), 2, "unchanged diffs are not republished");
        let latest = publications.last().unwrap();
        assert_eq!(latest.len(), 2);
        let first = latest.iter().find(|edit| edit.path == "/a.txt").unwrap();
        assert_eq!(first.change, FileChange::Update);
        assert!(first
            .unified_diff
            .as_ref()
            .unwrap()
            .contains("-before-a\n+after-a\n"));
        let second = latest.iter().find(|edit| edit.path == "/b.txt").unwrap();
        assert_eq!(second.change, FileChange::Add);
        assert!(second
            .unified_diff
            .as_ref()
            .unwrap()
            .contains("+latest-b\n"));
        assert!(!second.unified_diff.as_ref().unwrap().contains("first-b"));
        assert_eq!(
            events
                .iter()
                .filter(|event| matches!(event.payload, P::ToolCallStarted { .. }))
                .count(),
            1
        );
    }

    #[test]
    fn a_noop_diff_removes_only_that_paths_previous_change() {
        let events = updates(&[
            json!({"sessionUpdate":"tool_call","toolCallId":"c","kind":"edit",
            "content":[
                {"type":"diff","path":"/a","oldText":"x","newText":"y"},
                {"type":"diff","path":"/b","oldText":"a","newText":"b"}
            ]}),
            json!({"sessionUpdate":"tool_call_update","toolCallId":"c","status":"completed",
                "content":[{"type":"diff","path":"/a","oldText":"x","newText":"x"}]}),
        ]);
        let latest = events
            .iter()
            .filter_map(|event| match &event.payload {
                P::FileEdits { edits, .. } => Some(edits),
                _ => None,
            })
            .last()
            .unwrap();
        assert_eq!(latest.len(), 1);
        assert_eq!(latest[0].path, "/b");
    }
}

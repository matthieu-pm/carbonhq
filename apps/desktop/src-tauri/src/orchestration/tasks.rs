use super::{inbox, receipts};
use crate::{
    events::{AgentEvent, AgentEventPayload, TurnStatus},
    session::manager,
    sink::Sink,
    store,
};
use anyhow::{bail, Context, Result};
use carbon_proto::{
    OperationReceipt, Request, Response, SendMessage, TaskOptions, TaskRequest, TaskResult,
    TaskState, TaskSummary,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncSeekExt};

#[derive(Clone, Serialize, Deserialize)]
struct Record {
    summary: TaskSummary,
    create: bool,
    opening_event: Option<String>,
    started: bool,
    offset: u64,
    text: String,
    #[serde(default)]
    message_id: Option<String>,
    #[serde(default)]
    text_blocks: BTreeMap<u32, String>,
    #[serde(default)]
    prior_deliveries: HashSet<String>,
    candidate: Option<TaskResult>,
    received: HashSet<String>,
    completion_event: Option<String>,
    wake_operation: String,
    source_branch: Option<String>,
    source_cwd: Option<String>,
    source_commit: Option<String>,
    ack_offset: u64,
    wake_seen: bool,
    suppress_delivery: bool,
    stop_pending: bool,
    clear_pending: bool,
}

#[derive(Default, Serialize, Deserialize)]
struct Registry {
    version: u32,
    tasks: BTreeMap<String, Record>,
    #[serde(skip)]
    opaque: BTreeMap<String, serde_json::Value>,
}

struct Locked {
    path: PathBuf,
    lock: Arc<std::fs::File>,
    registry: Registry,
}

impl Locked {
    /// Serialize dependency edits and publication through the same durable registry lock.
    async fn load() -> Result<Self> {
        let root = store::get_home_app_dir().await?.join("delegated-tasks");
        let (path, lock) = receipts::locked_path(&root, "registry").await?;
        let registry = match tokio::fs::read(&path).await {
            Ok(bytes) => {
                let raw: serde_json::Value = serde_json::from_slice(&bytes)?;
                if raw["version"] != 1 { bail!("unsupported task registry version; update Carbon"); }
                let entries = raw["tasks"].as_object().context("task registry has no task map")?;
                let mut registry = Registry { version: 1, ..Default::default() };
                for (id, value) in entries {
                    match serde_json::from_value(value.clone()) {
                        Ok(record) => { registry.tasks.insert(id.clone(), record); }
                        Err(error) => {
                            eprintln!("[task record {id}] {error:#}");
                            registry.opaque.insert(id.clone(), value.clone());
                        }
                    }
                }
                registry
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Registry {
                version: 1,
                ..Default::default()
            },
            Err(error) => return Err(error.into()),
        };
        Ok(Self {
            path,
            lock,
            registry,
        })
    }

    /// The fsync retains ownership even when its awaiting task is canceled.
    async fn save(&self) -> Result<()> {
        let mut value = serde_json::to_value(&self.registry)?;
        let tasks = value["tasks"].as_object_mut().context("task registry has no task map")?;
        for (id, raw) in &self.registry.opaque { tasks.insert(id.clone(), raw.clone()); }
        let (path, lock, bytes) = (
            self.path.clone(),
            self.lock.clone(),
            serde_json::to_vec(&value)?,
        );
        tokio::task::spawn_blocking(move || -> Result<()> {
            let _lock = lock;
            store::write_private_atomic(&path, &bytes)?;
            std::fs::File::open(path.parent().context("task registry has no directory")?)?
                .sync_all()?;
            Ok(())
        })
        .await?
    }
}

type Questions = HashMap<String, BTreeMap<String, serde_json::Value>>;
static QUESTIONS: OnceLock<Mutex<Questions>> = OnceLock::new();

/// Questions stay answerable in the existing UI; only their descriptive snapshot reaches tasks.
pub(crate) fn live_event(event: &str, value: &serde_json::Value) {
    if event != "agent_event" {
        return;
    }
    let Some(session) = value["sessionId"].as_str() else {
        return;
    };
    let payload = &value["payload"];
    let kind = payload["type"].as_str().unwrap_or_default();
    if !matches!(
        kind,
        "questions_asked" | "permission_requested" | "permission_decided" | "turn_completed"
    ) {
        return;
    }
    if kind == "turn_completed" && !value["subagent"].is_null() {
        return;
    }
    let mut questions = QUESTIONS.get_or_init(Default::default).lock().unwrap();
    let pending = questions.entry(session.into()).or_default();
    match kind {
        "questions_asked" | "permission_requested" => {
            if let Some(id) = payload["requestId"].as_str() {
                pending.insert(id.into(), payload.clone());
            }
        }
        "permission_decided" => {
            if let Some(id) = payload["requestId"].as_str() {
                pending.remove(id);
            }
        }
        _ => pending.clear(),
    }
    if pending.is_empty() {
        questions.remove(session);
    }
}

fn live_questions(session: &str) -> Vec<serde_json::Value> {
    QUESTIONS
        .get_or_init(Default::default)
        .lock()
        .unwrap()
        .get(session)
        .map(|q| q.values().cloned().collect())
        .unwrap_or_default()
}

/// Reserve before any child can produce output, under the same durable operation identity.
pub(super) async fn register(
    receipt: &OperationReceipt,
    parent: &str,
    options: &TaskOptions,
    create: bool,
) -> Result<TaskSummary> {
    let mut locked = Locked::load().await?;
    if let Some(record) = locked
        .registry
        .tasks
        .values()
        .find(|r| r.summary.operation_id == receipt.operation_id)
    {
        return Ok(record.summary.clone());
    }
    if parent == receipt.session_id {
        bail!("a task cannot delegate to its own session");
    }
    if locked.registry.tasks.values().any(|r| {
        r.summary.child_session_id == receipt.session_id
            && (r.summary.result.is_none() || r.stop_pending || r.clear_pending)
    }) {
        bail!("this session already has an active task; send ordinary context or wait for its result before starting another");
    }
    let active_parent = locked
        .registry
        .tasks
        .values()
        .find(|r| r.summary.child_session_id == parent && r.summary.result.is_none())
        .map(|r| r.summary.task_id.clone());
    if options.awaited && active_parent.is_none() {
        bail!("--await requires an active task in the calling session on this server");
    }
    if locked
        .registry
        .tasks
        .values()
        .any(|r| r.summary.child_session_id == parent && r.stop_pending)
    {
        bail!("the calling task is being canceled");
    }
    // A result must never depend on work executing inside that same task's ancestry.
    let mut ancestor = active_parent.clone();
    while let Some(id) = ancestor {
        let record = &locked.registry.tasks[&id];
        if record.summary.child_session_id == receipt.session_id {
            bail!("awaited task cycle");
        }
        ancestor = record.summary.parent_task_id.clone();
    }
    let task_id = uuid::Uuid::now_v7().to_string();
    let summary = TaskSummary {
        configuration: None,
        task_id: task_id.clone(),
        operation_id: receipt.operation_id.clone(),
        parent_session_id: parent.into(),
        child_session_id: receipt.session_id.clone(),
        parent_task_id: options.awaited.then_some(active_parent.clone()).flatten(),
        awaited_task_ids: vec![],
        state: TaskState::Queued,
        result: None,
        questions: vec![],
        completion_delivery: None,
        delivery_error: None,
        completion_acknowledged: false,
    };
    if options.awaited {
        let parent = locked
            .registry
            .tasks
            .get_mut(active_parent.as_ref().unwrap())
            .unwrap();
        parent.summary.awaited_task_ids.push(task_id.clone());
    }
    let source = store::get_session_index_item(&receipt.session_id).await?;
    let source_branch = source.as_ref().and_then(|s| s.branch.clone());
    let source_cwd = source.as_ref().map(|s| s.cwd.clone());
    let source_commit = match source {
        Some(s) => git_head(&s.cwd).await,
        None => None,
    };
    let ack_offset = complete_offset(parent).await?;
    let offset = complete_offset(&receipt.session_id).await?;
    let prior_deliveries = inbox::pending_deliveries()
        .await?
        .into_iter()
        .filter(|d| d.session_id == receipt.session_id)
        .map(|d| d.message_id)
        .collect();
    locked.registry.tasks.insert(
        task_id.clone(),
        Record {
            summary: summary.clone(),
            create,
            opening_event: None,
            started: false,
            offset,
            text: String::new(),
            message_id: None,
            text_blocks: BTreeMap::new(),
            prior_deliveries,
            candidate: None,
            received: HashSet::new(),
            completion_event: None,
            source_branch,
            source_cwd,
            source_commit,
            ack_offset,
            wake_seen: false,
            wake_operation: format!("task-result-{task_id}"),
            suppress_delivery: false,
            stop_pending: false,
            clear_pending: false,
        },
    );
    locked.save().await?;
    Ok(summary)
}

/// Recover a missing creation reply from its durable task and the acknowledged session index.
pub(super) async fn by_operation(operation: &str) -> Result<Option<TaskSummary>> {
    let found = {
        let locked = Locked::load().await?;
        locked.registry.tasks.values().find(|r| r.summary.operation_id == operation)
            .map(|r| (r.summary.clone(), r.create))
    };
    let Some((mut summary, create)) = found else { return Ok(None); };
    if create && summary.configuration.is_none() {
        if let Ok(Some(item)) = store::get_session_index_item(&summary.child_session_id).await {
            summary.configuration = Some(super::discovery::configuration(&item).await);
        }
    }
    Ok(Some(summary))
}

/// Recovery reads immutable results without opening another task state machine.
pub(crate) async fn recovery_summaries() -> Result<Vec<TaskSummary>> {
    Ok(Locked::load().await?.registry.tasks.values().map(|record| record.summary.clone()).collect())
}

pub(crate) struct SubmissionGuard {
    _locked: Locked,
}

/// All task follow-ups share the cleanup fence, while old canceled operations stay fenced forever.
fn canceled(registry: &Registry, session: &str, operation: Option<&str>) -> bool {
    registry.tasks.values().any(|r| {
        (r.summary.child_session_id == session && (r.stop_pending || r.clear_pending))
            || operation.is_some_and(|id| {
                r.summary.operation_id == id && r.summary.state == TaskState::Canceled
            })
            || operation.is_some_and(|id| r.suppress_delivery && r.wake_operation == id)
            || (operation.is_none()
                && r.create
                && !r.started
                && r.summary.child_session_id == session
                && r.summary.state == TaskState::Canceled)
    })
}

/// Hold cancellation behind durable inbox acceptance, so cleanup cannot miss an accepted follow-up.
pub(crate) async fn acceptance(session: &str, operation: &str) -> Result<SubmissionGuard> {
    let locked = Locked::load().await?;
    if canceled(&locked.registry, session, Some(operation)) {
        bail!("the delegated task was canceled");
    }
    Ok(SubmissionGuard { _locked: locked })
}

/// Bind replay identity and retain the cancellation fence until submission intent is synced.
pub(crate) async fn prompt(
    session: &str,
    operation: &str,
    event_id: &str,
) -> Result<Option<SubmissionGuard>> {
    let mut locked = Locked::load().await?;
    if canceled(&locked.registry, session, Some(operation)) {
        return Ok(None);
    }
    let mut changed = false;
    for record in locked.registry.tasks.values_mut() {
        if record.summary.operation_id == operation && record.summary.result.is_none() {
            record.opening_event = Some(event_id.into());
            changed = true;
        }
        if record.wake_operation == operation {
            record.completion_event = Some(event_id.into());
            changed = true;
        }
    }
    if changed {
        locked.save().await?;
    }
    Ok(Some(SubmissionGuard { _locked: locked }))
}

/// Only tracked creation needs a slot before its process has been inserted.
pub(crate) async fn tracked_create(session: &str) -> Result<bool> {
    Ok(Locked::load()
        .await?
        .registry
        .tasks
        .values()
        .any(|r| r.create && r.summary.child_session_id == session))
}

/// Follow-up sends may resume after cleanup; only new creates keep their permanent reservation fence.
pub(crate) async fn cleanup_pending(session: &str) -> Result<bool> {
    Ok(Locked::load()
        .await?
        .registry
        .tasks
        .values()
        .any(|r| r.summary.child_session_id == session && (r.stop_pending || r.clear_pending)))
}

/// A cheap fence check also protects a create canceled before it acquired its session slot.
pub(crate) async fn dispatch_canceled(session: &str, operation: Option<&str>) -> Result<bool> {
    Ok(canceled(
        &Locked::load().await?.registry,
        session,
        operation,
    ))
}

/// Terminal publication is single-assignment even when cancellation and completion race.
fn finish(record: &mut Record, outcome: TaskState, text: &str) {
    if record.summary.result.is_some() {
        return;
    }
    record.summary.state = outcome;
    record.summary.questions.clear();
    record.summary.result = Some(TaskResult {
        outcome,
        text: text.into(),
        source_session_id: record.summary.child_session_id.clone(),
        cwd: record.source_cwd.clone(),
        branch: record.source_branch.clone(),
        commit: record.source_commit.clone(),
        tree: None,
        references: vec![],
        event_id: None,
        completed_at: chrono::Utc::now().to_rfc3339(),
    });
}

/// Definite pre-send failures still produce a result instead of leaving a reservation running forever.
pub(super) async fn failed(operation: &str, error: &str) -> Result<()> {
    let mut locked = Locked::load().await?;
    if let Some(record) = locked
        .registry
        .tasks
        .values_mut()
        .find(|r| r.summary.operation_id == operation)
    {
        finish(record, TaskState::Failed, error);
        locked.save().await?;
    }
    Ok(())
}

/// Only the owning main thread can open or close this task; subagent frames are separate work.
fn apply(record: &mut Record, event: &AgentEvent, completion_events: &HashMap<String, String>) {
    if event.subagent.is_some() {
        return;
    }
    if !record.started {
        if !matches!(event.payload, AgentEventPayload::UserMessage { .. })
            || (!record.create && record.opening_event.as_deref() != Some(&event.id))
        {
            return;
        }
        record.started = true;
        record.summary.state = TaskState::Running;
    }
    match &event.payload {
        AgentEventPayload::UserMessage { .. } | AgentEventPayload::TurnStarted(_) => {
            if matches!(event.payload, AgentEventPayload::UserMessage { .. }) {
                record.text.clear();
                record.message_id = None;
                record.text_blocks.clear();
                for (task, id) in completion_events {
                    if id == &event.id {
                        record.received.insert(task.clone());
                    }
                }
            }
            record.candidate = None;
            record.summary.state = TaskState::Running;
        }
        AgentEventPayload::AssistantText {
            block: Some(block),
            text,
        } => {
            if record.message_id.as_deref() != Some(&block.message_id) {
                record.message_id = Some(block.message_id.clone());
                record.text_blocks.clear();
            }
            record.text_blocks.insert(block.index, text.clone());
            record.text = record
                .text_blocks
                .values()
                .cloned()
                .collect::<Vec<_>>()
                .join("");
        }
        AgentEventPayload::AssistantText { block: None, text } => {
            record.message_id = None;
            record.text_blocks.clear();
            record.text = text.clone();
        }
        AgentEventPayload::TurnCompleted {
            status,
            final_text,
            stop_reason,
            head,
            ..
        } => {
            let text = final_text
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or(record.text.trim())
                .to_owned();
            let outcome = if stop_reason.as_deref().is_some_and(interrupted) {
                TaskState::Interrupted
            } else if *status == TurnStatus::Success {
                TaskState::Succeeded
            } else {
                TaskState::Failed
            };
            record.candidate = Some(TaskResult {
                outcome,
                references: references(&text),
                text,
                source_session_id: record.summary.child_session_id.clone(),
                cwd: None,
                branch: None,
                commit: None,
                tree: head.clone(),
                event_id: Some(event.id.clone()),
                completed_at: event.ts.clone(),
            });
        }
        _ => {}
    }
}

fn interrupted(reason: &str) -> bool {
    matches!(reason, "interrupted" | "cancelled" | "canceled" | "aborted" | "process_exited")
        || reason.starts_with("aborted_")
}

/// Registration may race an append; a byte count alone can point into the middle of JSON.
async fn complete_offset(session: &str) -> Result<u64> {
    complete_offset_at(&store::get_session_path(session).await?).await
}

async fn complete_offset_at(path: &Path) -> Result<u64> {
    match tokio::fs::File::open(path).await {
        Ok(mut file) => {
            let mut end = file.metadata().await?.len();
            let mut buffer = vec![0; 8192];
            while end > 0 {
                let start = end.saturating_sub(buffer.len() as u64);
                let size = (end - start) as usize;
                file.seek(std::io::SeekFrom::Start(start)).await?;
                file.read_exact(&mut buffer[..size]).await?;
                if let Some(index) = buffer[..size].iter().rposition(|b| *b == b'\n') {
                    return Ok(start + index as u64 + 1);
                }
                end = start;
            }
            Ok(0)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(0),
        Err(error) => Err(error.into()),
    }
}

fn references(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    for suffix in text.split("](").skip(1) {
        if let Some((target, _)) = suffix.split_once(')') {
            if !target.is_empty() && !found.iter().any(|item| item == target) {
                found.push(target.into());
            }
        }
    }
    found
}

/// Advance only over whole records so a partial append can be retried after restart.
async fn read_events(
    record: &mut Record,
    completion_events: &HashMap<String, String>,
) -> Result<bool> {
    let path = store::get_session_path(&record.summary.child_session_id).await?;
    let file = match tokio::fs::File::open(path).await {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    let mut reader = tokio::io::BufReader::new(file);
    reader.seek(std::io::SeekFrom::Start(record.offset)).await?;
    let mut changed = false;
    let mut line = String::new();
    loop {
        line.clear();
        let bytes = reader.read_line(&mut line).await?;
        if bytes == 0 || !line.ends_with('\n') {
            break;
        }
        let event: AgentEvent =
            serde_json::from_str(&line).context("could not replay delegated task events")?;
        apply(record, &event, completion_events);
        record.offset += bytes as u64;
        changed = true;
    }
    Ok(changed)
}

/// Parent consumption needs log evidence beyond the inbox provider-submission acknowledgment.
async fn acknowledge(record: &mut Record) -> Result<()> {
    if record.summary.completion_acknowledged || record.completion_event.is_none() {
        return Ok(());
    }
    if !inbox::find(&record.wake_operation)
        .await?
        .is_some_and(|d| d.state == carbon_proto::DeliveryState::Submitted)
    {
        return Ok(());
    }
    let path = store::get_session_path(&record.summary.parent_session_id).await?;
    let file = match tokio::fs::File::open(path).await {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    let mut reader = tokio::io::BufReader::new(file);
    reader
        .seek(std::io::SeekFrom::Start(record.ack_offset))
        .await?;
    let mut line = String::new();
    loop {
        line.clear();
        let size = reader.read_line(&mut line).await?;
        if size == 0 || !line.ends_with('\n') {
            break;
        }
        let event: AgentEvent = serde_json::from_str(&line)?;
        record.ack_offset += size as u64;
        if record.completion_event.as_deref() == Some(&event.id) {
            record.wake_seen = true;
        }
        if record.wake_seen
            && event.subagent.is_none()
            && matches!(event.payload, AgentEventPayload::TurnCompleted { .. })
        {
            record.summary.completion_acknowledged = true;
            break;
        }
    }
    Ok(())
}

/// Reads and waits never consume a result; each caller can inspect it again after restart.
pub(super) async fn request(request: TaskRequest) -> Result<Response> {
    if matches!(request, TaskRequest::Cancel { .. }) {
        cancel(request.id()).await?;
    }
    let timeout = match &request {
        TaskRequest::Wait { timeout_secs, .. } => (*timeout_secs).min(120),
        _ => 0,
    };
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(timeout);
    loop {
        let mut summary = Locked::load()
            .await?
            .registry
            .tasks
            .get(request.id())
            .context(
                "no task with that ID on this server; use --machine for a task owned elsewhere",
            )?
            .summary
            .clone();
        if let Some(delivery) = summary.completion_delivery.as_mut() {
            if let Some(current) = inbox::find(&delivery.message_id).await? {
                *delivery = current;
            }
        }
        if summary.result.is_some()
            || summary.state == TaskState::Blocked
            || tokio::time::Instant::now() >= deadline
        {
            return Ok(Response::Task { task: summary });
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}

/// Persist the complete awaited subtree before any destructive cleanup can begin.
async fn cancel(id: &str) -> Result<()> {
    let mut locked = Locked::load().await?;
    let root = locked
        .registry
        .tasks
        .get(id)
        .context("no task with that ID")?;
    if root.summary.result.is_some() {
        return Ok(());
    }
    let mut selected = HashSet::from([id.to_owned()]);
    loop {
        let before = selected.len();
        for record in locked.registry.tasks.values() {
            if record
                .summary
                .parent_task_id
                .as_ref()
                .is_some_and(|p| selected.contains(p))
            {
                selected.insert(record.summary.task_id.clone());
            }
        }
        if selected.len() == before {
            break;
        }
    }
    for task in selected {
        let record = locked.registry.tasks.get_mut(&task).unwrap();
        record.suppress_delivery = task != id;
        if record.summary.result.is_none() {
            if let Some(item) =
                store::get_session_index_item(&record.summary.child_session_id).await?
            {
                record.source_cwd = Some(item.cwd.clone());
                record.source_branch = item.branch;
                record.source_commit = git_head(&item.cwd).await;
            }
            record.stop_pending = record.started || record.create || record.opening_event.is_some();
            record.clear_pending = true;
            finish(
                record,
                TaskState::Canceled,
                "The delegated task was canceled.",
            );
        }
    }
    locked.save().await
}

/// Recovery replays complete boundaries first; work lost with a process becomes explicitly interrupted.
pub(super) async fn start(app: Sink) -> Result<()> {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(250));
        loop {
            interval.tick().await;
            if let Err(error) = tick(&app, false).await {
                eprintln!("[delegated task err] {error:#}");
            }
        }
    });
    Ok(())
}

/// Replay and publish recovered outcomes before any accepted message can dispatch.
pub(super) async fn recover_startup(app: &Sink) -> Result<()> {
    tick(app, true).await
}

/// The session slot precedes the registry lock, fencing finalization against queued follow-ups.
async fn tick(app: &Sink, recovering: bool) -> Result<()> {
    {
        let mut locked = Locked::load().await?;
        let before = serde_json::to_vec(&locked.registry)?;
        for record in locked
            .registry
            .tasks
            .values_mut()
            .filter(|r| r.summary.result.is_none())
        {
            record.summary.questions = if recovering {
                vec![]
            } else {
                live_questions(&record.summary.child_session_id)
            };
            if !record.summary.questions.is_empty() {
                record.summary.state = TaskState::Blocked;
            } else if record.summary.state == TaskState::Blocked {
                record.summary.state = if record.started {
                    TaskState::Running
                } else {
                    TaskState::Queued
                };
            }
        }
        if before != serde_json::to_vec(&locked.registry)? {
            locked.save().await?;
        }
    }
    let records = Locked::load()
        .await?
        .registry
        .tasks
        .values()
        .cloned()
        .collect::<Vec<_>>();
    for snapshot in records.iter().filter(|r| r.summary.result.is_none()) {
        let Some(activity) = manager()
            .task_activity(&snapshot.summary.child_session_id)
            .await
        else {
            continue;
        };
        let mut locked = Locked::load().await?;
        let completion_events = locked
            .registry
            .tasks
            .iter()
            .filter_map(|(id, r)| r.completion_event.clone().map(|e| (id.clone(), e)))
            .collect();
        let done: HashSet<_> = locked
            .registry
            .tasks
            .iter()
            .filter(|(_, r)| r.summary.result.is_some())
            .map(|(id, _)| id.clone())
            .collect();
        let record = locked
            .registry
            .tasks
            .get_mut(&snapshot.summary.task_id)
            .unwrap();
        if record.summary.result.is_some() {
            continue;
        }
        let before = serde_json::to_vec(record)?;
        if let Err(error) = read_events(record, &completion_events).await {
            finish(
                record,
                TaskState::Interrupted,
                &format!("Task replay could not read its transcript: {error:#}"),
            );
            locked.save().await?;
            continue;
        }
        record.summary.questions = if recovering {
            vec![]
        } else {
            QUESTIONS
                .get_or_init(Default::default)
                .lock()
                .unwrap()
                .get(&record.summary.child_session_id)
                .map(|q| q.values().cloned().collect())
                .unwrap_or_default()
        };
        let pending = inbox::pending_deliveries().await?;
        let dependencies_done = record
            .summary
            .awaited_task_ids
            .iter()
            .all(|id| done.contains(id) && record.received.contains(id));
        let in_flight = activity.busy
            || pending.iter().any(|d| {
                d.session_id == record.summary.child_session_id
                    && !record.prior_deliveries.contains(&d.message_id)
            });
        let recoverable = pending.iter().any(|d| d.session_id == record.summary.child_session_id
            && d.state == carbon_proto::DeliveryState::Accepted
            && !record.prior_deliveries.contains(&d.message_id));
        if !record.summary.questions.is_empty() {
            record.summary.state = TaskState::Blocked;
        } else if let Some(result) = record
            .candidate
            .clone()
            .filter(|_| dependencies_done && !in_flight)
        {
            record.summary.state = result.outcome;
            record.summary.result = Some(result);
        } else if record.candidate.is_some() {
            record.summary.state = TaskState::Waiting;
        } else if record.started {
            record.summary.state = if !activity.alive && recoverable { TaskState::Queued } else { TaskState::Running };
        }
        if !record.started && !record.create {
            match inbox::find(&record.summary.operation_id).await?.map(|d| d.state) {
                Some(carbon_proto::DeliveryState::Failed) => finish(record, TaskState::Failed, "The task's opening message failed before submission."),
                Some(carbon_proto::DeliveryState::Canceled) => finish(record, TaskState::Canceled, "The task's opening message was canceled before submission."),
                Some(carbon_proto::DeliveryState::Uncertain) => finish(record, TaskState::Interrupted, "The task's opening message has uncertain delivery. Inspect the session before starting new work."),
                None if recovering => finish(record, TaskState::Interrupted, "The server stopped before accepting the task's opening message. No work was retried."),
                _ => {}
            }
        }
        if record.summary.result.is_none()
            && ((recovering && !recoverable) || (record.started && !activity.alive && !in_flight))
            && (record.started || record.create)
            && record.candidate.is_none()
        {
            finish(record, TaskState::Interrupted, if recovering {
                "The server restarted before the delegated task published a result. Previous permission and question callbacks have expired. Inspect the session before starting a new task."
            } else {
                "The child process ended before the delegated task published a result. Inspect the session before starting a new task."
            });
        }
        if let Some(result) = record.summary.result.as_mut() {
            if let Some(item) =
                store::get_session_index_item(&record.summary.child_session_id).await?
            {
                result.cwd = Some(item.cwd.clone());
                result.branch = item.branch;
                result.commit = git_head(&item.cwd).await;
            }
        }
        if before != serde_json::to_vec(record)? {
            locked.save().await?;
        }
    }
    {
        let mut locked = Locked::load().await?;
        let before = serde_json::to_vec(&locked.registry)?;
        for record in locked.registry.tasks.values_mut() {
            if let Err(error) = acknowledge(record).await {
                record.summary.delivery_error = Some(format!(
                    "Could not acknowledge the parent transcript: {error:#}"
                ));
            }
        }
        if before != serde_json::to_vec(&locked.registry)? {
            locked.save().await?;
        }
    }
    schedule_cancellations(records, app);
    deliver_results(app).await
}

/// A stalled child must not prevent other tasks from publishing or recovering.
fn schedule_cancellations(records: Vec<Record>, app: &Sink) {
    static WORKERS: std::sync::LazyLock<Mutex<HashMap<String, tokio::task::JoinHandle<()>>>> =
        std::sync::LazyLock::new(Default::default);
    let mut workers = WORKERS.lock().unwrap();
    workers.retain(|_, worker| !worker.is_finished());
    for record in records.into_iter().filter(|r| r.clear_pending) {
        if workers.contains_key(&record.summary.task_id) {
            continue;
        }
        let app = app.clone();
        workers.insert(
            record.summary.task_id.clone(),
            tokio::spawn(async move {
                if let Err(error) = cancel_one(record, app).await {
                    eprintln!("[task cancellation err] {error:#}");
                }
            }),
        );
    }
}

/// Keep cleanup retryable until all pending mail and the owning child have been handled.
async fn cancel_one(record: Record, app: Sink) -> Result<()> {
    inbox::cancel_pending(
        &record.summary.child_session_id,
        record.stop_pending,
        &record.summary.operation_id,
    )
    .await?;
    if let Some(delivery) = &record.summary.completion_delivery {
        let _ = inbox::status(
            carbon_proto::DeliveryRef {
                session_id: delivery.session_id.clone(),
                message_id: delivery.message_id.clone(),
            },
            true,
        )
        .await;
    }
    if record.stop_pending {
        manager()
            .cancel_task_work(&record.summary.child_session_id, &app)
            .await?;
    }
    let mut locked = Locked::load().await?;
    let task = locked
        .registry
        .tasks
        .get_mut(&record.summary.task_id)
        .unwrap();
    task.stop_pending = false;
    task.clear_pending = false;
    locked.save().await?;
    Ok(())
}

async fn git_head(cwd: &str) -> Option<String> {
    let output = tokio::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(cwd)
        .output()
        .await
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

/// Completion acceptance for a slow parent runs independently of task replay.
async fn deliver_results(app: &Sink) -> Result<()> {
    static WORKERS: std::sync::LazyLock<Mutex<HashMap<String, tokio::task::JoinHandle<()>>>> =
        std::sync::LazyLock::new(Default::default);
    let locked = Locked::load().await?;
    let records = locked
        .registry
        .tasks
        .values()
        .filter(|r| {
            r.summary.result.is_some()
                && !r.suppress_delivery
                && !r.clear_pending
                && r.summary.completion_delivery.is_none()
                && !pending_descendants(&locked.registry, &r.summary.task_id)
        })
        .cloned()
        .collect::<Vec<_>>();
    drop(locked);
    let mut workers = WORKERS.lock().unwrap();
    workers.retain(|_, worker| !worker.is_finished());
    for record in records {
        if workers.contains_key(&record.summary.task_id) {
            continue;
        }
        let app = app.clone();
        workers.insert(
            record.summary.task_id.clone(),
            tokio::spawn(async move {
                if let Err(error) = deliver_one(record, app).await {
                    eprintln!("[task completion err] {error:#}");
                }
            }),
        );
    }
    Ok(())
}

/// A cancellation wake must follow cleanup of the whole awaited subtree.
fn pending_descendants(registry: &Registry, id: &str) -> bool {
    let mut selected = HashSet::from([id.to_owned()]);
    loop {
        let before = selected.len();
        for record in registry.tasks.values() {
            if record
                .summary
                .parent_task_id
                .as_ref()
                .is_some_and(|p| selected.contains(p))
            {
                if record.stop_pending || record.clear_pending {
                    return true;
                }
                selected.insert(record.summary.task_id.clone());
            }
        }
        if selected.len() == before {
            return false;
        }
    }
}

/// Reuse the reserved inbox identity even if a crash lost the acceptance metadata.
async fn deliver_one(record: Record, app: Sink) -> Result<()> {
    let prompt = format!("Delegated task {} completed. This is an immutable result; later child work has a separate identity.\n{}", record.summary.task_id, serde_json::to_string_pretty(&record.summary.result)?);
    let result = async {
            if let Some(existing) = inbox::find(&record.wake_operation).await? { return Ok(existing); }
            if store::get_session_index_item(&record.summary.parent_session_id).await?.is_some() {
                let sender = crate::events::MessageSender { session_id: record.summary.child_session_id.clone(), title: format!("Task {}", record.summary.task_id), machine: None };
                let receipt = OperationReceipt { request_id: record.wake_operation.clone(), operation_id: record.wake_operation.clone(), session_id: record.summary.parent_session_id.clone(), worktree_name: None };
                return manager().accept_inbox(&receipt, &super::attribute(&prompt, Some(&sender)), Some(sender)).await;
            }
            let request = Request::SendMessage(SendMessage {
                task: None, durable: true, request_id: Some(record.wake_operation.clone()),
                session_id: record.summary.parent_session_id.clone(), from_session_id: Some(record.summary.child_session_id.clone()), prompt,
            });
            delivery_from(Box::pin(super::route(request, &app)).await?).context("completion delivery was not accepted; the parent server must be reachable from this server")
        }.await;
    let mut locked = Locked::load().await?;
    let task = locked
        .registry
        .tasks
        .get_mut(&record.summary.task_id)
        .unwrap();
    match result {
        Ok(delivery) => {
            task.summary.completion_delivery = Some(delivery);
            task.summary.delivery_error = None;
        }
        Err(error) => {
            task.summary.delivery_error = Some(format!("{error:#}"));
        }
    }
    locked.save().await?;
    Ok(())
}

fn delivery_from(response: Response) -> Option<carbon_proto::DeliverySummary> {
    match response {
        Response::Recorded { response, .. } => delivery_from(*response),
        Response::Delivery { delivery } => Some(delivery),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::BlockRef;
    use crate::harness::{pi, Harness};
    use std::sync::atomic::AtomicU64;

    fn record() -> Record {
        Record {
            summary: TaskSummary {
                configuration: None,
                task_id: "task".into(),
                operation_id: "operation".into(),
                parent_session_id: "parent".into(),
                child_session_id: "child".into(),
                parent_task_id: None,
                awaited_task_ids: vec![],
                state: TaskState::Running,
                result: None,
                questions: vec![],
                completion_delivery: None,
                delivery_error: None,
                completion_acknowledged: false,
            },
            create: false,
            opening_event: None,
            started: true,
            offset: 0,
            text: String::new(),
            message_id: None,
            text_blocks: BTreeMap::new(),
            prior_deliveries: HashSet::new(),
            candidate: None,
            received: HashSet::new(),
            completion_event: None,
            wake_operation: "wake".into(),
            source_branch: None,
            source_cwd: None,
            source_commit: None,
            ack_offset: 0,
            wake_seen: false,
            suppress_delivery: false,
            stop_pending: false,
            clear_pending: false,
        }
    }

    fn event(payload: AgentEventPayload) -> AgentEvent {
        AgentEvent::mint("child".into(), Harness::Pi, 0, None, None, payload)
    }

    #[test]
    fn normalized_interruptions_cannot_publish_success() {
        for reason in [
            "process_exited",
            "interrupted",
            "cancelled",
            "aborted_streaming",
            "aborted_tool",
        ] {
            for status in [TurnStatus::Success, TurnStatus::Error] {
                let mut record = record();
                apply(
                    &mut record,
                    &event(AgentEventPayload::TurnCompleted {
                        status,
                        stop_reason: Some(reason.into()),
                        final_text: None,
                        usage: None,
                        duration_ms: None,
                        head: None,
                        auth_failed: false,
                    }),
                    &HashMap::new(),
                );
                assert_eq!(
                    record.candidate.unwrap().outcome,
                    TaskState::Interrupted,
                    "{reason}"
                );
            }
        }
    }

    #[test]
    fn pi_final_message_keeps_all_committed_text_blocks() {
        let mut mapper = pi::mapper::Mapper::new(
            "child".into(),
            Arc::new(AtomicU64::new(0)),
            Arc::new(AtomicU64::new(0)),
        );
        let mut record = record();
        for line in [
            r#"{"type":"agent_start"}"#,
            r#"{"type":"message_start","message":{"role":"assistant"}}"#,
            r#"{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"old commentary"}],"stopReason":"toolUse"}}"#,
            r#"{"type":"message_start","message":{"role":"assistant"}}"#,
            r#"{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"First paragraph.\n\n"},{"type":"text","text":"Second paragraph."}],"stopReason":"stop"}}"#,
            r#"{"type":"agent_settled"}"#,
        ] {
            for event in mapper.map(pi::parser::parse_line(line).unwrap()) {
                apply(&mut record, &event, &HashMap::new());
            }
        }
        assert_eq!(
            record.candidate.unwrap().text,
            "First paragraph.\n\nSecond paragraph."
        );
    }

    #[test]
    fn replayed_text_block_replaces_instead_of_duplicating_its_content() {
        let mut record = record();
        for text in ["first", "replacement"] {
            apply(
                &mut record,
                &event(AgentEventPayload::AssistantText {
                    block: Some(BlockRef {
                        message_id: "message".into(),
                        index: 0,
                    }),
                    text: text.into(),
                }),
                &HashMap::new(),
            );
        }
        assert_eq!(record.text, "replacement");
    }

    #[test]
    fn a_subagent_completion_does_not_retire_the_main_question() {
        let session = uuid::Uuid::now_v7().to_string();
        live_event(
            "agent_event",
            &serde_json::json!({"sessionId":session, "payload":{"type":"questions_asked", "requestId":"ask"}}),
        );
        live_event(
            "agent_event",
            &serde_json::json!({"sessionId":session, "subagent":{"id":"child"}, "payload":{"type":"turn_completed"}}),
        );
        assert_eq!(live_questions(&session).len(), 1);
        live_event(
            "agent_event",
            &serde_json::json!({"sessionId":session, "payload":{"type":"turn_completed"}}),
        );
        assert!(live_questions(&session).is_empty());
    }

    #[tokio::test]
    async fn cursor_stays_before_an_incomplete_append() {
        let path =
            std::env::temp_dir().join(format!("carbon-task-cursor-{}", uuid::Uuid::now_v7()));
        tokio::fs::write(&path, b"one\ntwo\npartial").await.unwrap();
        assert_eq!(complete_offset_at(&path).await.unwrap(), 8);
        tokio::fs::write(&path, b"partial").await.unwrap();
        assert_eq!(complete_offset_at(&path).await.unwrap(), 0);
        tokio::fs::write(&path, b"whole\n").await.unwrap();
        assert_eq!(complete_offset_at(&path).await.unwrap(), 6);
        tokio::fs::remove_file(path).await.unwrap();
    }
}

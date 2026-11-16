use super::receipts;
use crate::{events::MessageSender, session::manager, sink::Sink, store};
use anyhow::{bail, Context, Result};
use carbon_proto::{DeliveryRef, DeliveryState, DeliverySummary, OperationReceipt, Response};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

#[derive(Clone, Serialize, Deserialize)]
struct Record {
    version: u32,
    summary: DeliverySummary,
    prompt: String,
    sender: Option<MessageSender>,
    #[serde(default)]
    evidence: Vec<PathBuf>,
}

pub(crate) struct Dispatch {
    path: PathBuf,
    lock: Arc<std::fs::File>,
    record: Record,
}

async fn root() -> Result<PathBuf> {
    Ok(store::get_home_app_dir().await?.join("agent-inbox"))
}

/// Retain the lock through fsync even if the awaiting task is canceled.
async fn persist(path: &Path, bytes: Vec<u8>, lock: Arc<std::fs::File>) -> Result<()> {
    let path = path.to_owned();
    tokio::task::spawn_blocking(move || -> Result<()> {
        let _lock = lock;
        store::write_private_atomic(&path, &bytes)?;
        std::fs::File::open(path.parent().context("inbox record has no directory")?)?.sync_all()?;
        Ok(())
    })
    .await?
}

impl Dispatch {
    pub(crate) fn message_id(&self) -> &str {
        &self.record.summary.message_id
    }
    pub(crate) fn session_id(&self) -> &str {
        &self.record.summary.session_id
    }
    pub(crate) fn prompt(&self) -> &str {
        &self.record.prompt
    }
    pub(crate) fn sender(&self) -> Option<&MessageSender> {
        self.record.sender.as_ref()
    }

    async fn save(&self) -> Result<()> {
        persist(
            &self.path,
            serde_json::to_vec(&self.record)?,
            self.lock.clone(),
        )
        .await
    }

    async fn transition(&mut self, state: DeliveryState, detail: Option<String>) -> Result<()> {
        let previous = self.record.summary.clone();
        self.record.summary.state = state;
        self.record.summary.detail = detail;
        if let Err(error) = self.save().await {
            self.record.summary = previous;
            return Err(error);
        }
        Ok(())
    }

    /// This fence is checked while the recipient's session lock is held.
    pub(crate) async fn target_deleted(&self) -> Result<bool> {
        Ok(tokio::fs::try_exists(deleted_path(
            self.path.parent().unwrap(),
            self.session_id(),
        )?)
        .await?)
    }

    /// Pending deliveries can be retracted; submissions cannot be safely recalled.
    pub(crate) async fn cancel(&mut self, reason: &str) -> Result<()> {
        if self.record.summary.state != DeliveryState::Accepted {
            bail!("this delivery has already entered submission and cannot be canceled");
        }
        self.transition(DeliveryState::Canceled, Some(reason.into()))
            .await
    }

    /// Persist intent immediately before the transport call, after local prompt preparation.
    pub(crate) async fn begin(&mut self) -> Result<()> {
        let target = store::get_session_index_item(self.session_id())
            .await?
            .context("the recipient no longer exists")?;
        self.record.evidence = evidence_paths(&target).await?;
        self.transition(DeliveryState::Submitting, None).await
    }

    /// Submission is distinct from observing a result or the recipient completing its turn.
    pub(crate) async fn finish(&mut self, result: &Result<bool>) -> Result<()> {
        match result {
            Ok(_) => self.transition(DeliveryState::Submitted, None).await,
            Err(error) => {
                self.transition(
                    DeliveryState::Uncertain,
                    Some(format!("Submission did not return success: {error:#}")),
                )
                .await
            }
        }
    }
}

/// The operation ID is allocated by the retry receipt and survives every forwarding hop.
pub(crate) async fn accept(
    receipt: &OperationReceipt,
    prompt: &str,
    sender: Option<MessageSender>,
) -> Result<DeliverySummary> {
    accept_at(&root().await?, receipt, prompt, sender).await
}

async fn accept_at(
    root: &Path,
    receipt: &OperationReceipt,
    prompt: &str,
    sender: Option<MessageSender>,
) -> Result<DeliverySummary> {
    let (path, lock) = receipts::locked_path(root, &receipt.operation_id).await?;
    if tokio::fs::try_exists(deleted_path(root, &receipt.session_id)?).await? {
        bail!("the recipient was deleted");
    }
    if let Some(existing) = read(&path, lock.clone()).await? {
        if existing.record.prompt != prompt
            || existing.record.summary.request_id != receipt.request_id
            || existing.session_id() != receipt.session_id
        {
            bail!("delivery identity was already used for another message");
        }
        return Ok(existing.record.summary);
    }
    let dispatch = Dispatch {
        path,
        lock,
        record: Record {
            version: 1,
            summary: DeliverySummary {
                message_id: receipt.operation_id.clone(),
                request_id: receipt.request_id.clone(),
                session_id: receipt.session_id.clone(),
                from_session_id: sender.as_ref().map(|sender| sender.session_id.clone()),
                state: DeliveryState::Accepted,
                accepted_at: chrono::Utc::now().to_rfc3339(),
                detail: None,
            },
            prompt: prompt.to_owned(),
            sender,
            evidence: Vec::new(),
        },
    };
    dispatch.save().await?;
    Ok(dispatch.record.summary)
}

async fn read(path: &Path, lock: Arc<std::fs::File>) -> Result<Option<Dispatch>> {
    let bytes = match tokio::fs::read(path).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let record: Record =
        serde_json::from_slice(&bytes).context("could not read durable agent message")?;
    if record.version != 1 {
        bail!("unsupported inbox version; update Carbon");
    }
    Ok(Some(Dispatch {
        path: path.to_owned(),
        lock,
        record,
    }))
}

async fn load(root: &Path, id: &str) -> Result<Option<Dispatch>> {
    let (path, lock) = receipts::locked_path(root, id).await?;
    let dispatch = read(&path, lock).await?;
    if dispatch
        .as_ref()
        .is_some_and(|dispatch| dispatch.message_id() != id)
    {
        bail!("inbox identity does not match its record");
    }
    Ok(dispatch)
}

/// Receipts are immutable; the inbox is the current delivery state behind their message ID.
pub(super) async fn find(id: &str) -> Result<Option<DeliverySummary>> {
    let root = root().await?;
    let path = root.join(format!("{}.json", receipts::hash(id.as_bytes())));
    let bytes = match tokio::fs::read(path).await {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let record: Record = serde_json::from_slice(&bytes)?;
    if record.version != 1 || record.summary.message_id != id {
        bail!("invalid inbox record");
    }
    let mut summary = record.summary;
    if summary.state == DeliveryState::Accepted
        && tokio::fs::try_exists(deleted_path(&root, &summary.session_id)?).await?
    {
        summary.state = DeliveryState::Canceled;
        summary.detail = Some("The recipient was deleted.".into());
    }
    Ok(Some(summary))
}

/// Read-only status stays available while a harness call is blocked.
pub(super) async fn status(reference: DeliveryRef, cancel: bool) -> Result<Response> {
    if !cancel {
        let delivery = find(&reference.message_id)
            .await?
            .context("no such delivery")?;
        if delivery.session_id != reference.session_id {
            bail!("this delivery belongs to another session");
        }
        return Ok(Response::Delivery { delivery });
    }
    let mut dispatch = load(&root().await?, &reference.message_id)
        .await?
        .context("no such delivery")?;
    if dispatch.session_id() != reference.session_id {
        bail!("this delivery belongs to another session");
    }
    if dispatch.record.summary.state == DeliveryState::Accepted && dispatch.target_deleted().await?
    {
        dispatch.cancel("The recipient was deleted.").await?;
    }
    if cancel && dispatch.record.summary.state != DeliveryState::Canceled {
        dispatch
            .cancel("Canceled explicitly by the caller.")
            .await?;
    }
    Ok(Response::Delivery {
        delivery: dispatch.record.summary,
    })
}

fn deleted_path(root: &Path, session_id: &str) -> Result<PathBuf> {
    Ok(root.join(format!("deleted-{}", receipts::fingerprint(&session_id)?)))
}

/// Deletion fences future acceptance too, before the session's index entry disappears.
pub(crate) async fn delete_target(session_id: &str) -> Result<()> {
    let root = root().await?;
    let (_, lock) = receipts::locked_path(&root, &format!("delete:{session_id}")).await?;
    persist(&deleted_path(&root, session_id)?, b"deleted".to_vec(), lock).await
}

async fn records(root: &Path) -> Result<Vec<DeliverySummary>> {
    scan(root, &mut std::collections::HashSet::new()).await
}

/// A submitted record can never become pending again, so do not reread its payload every tick.
async fn scan(
    root: &Path,
    finished: &mut std::collections::HashSet<PathBuf>,
) -> Result<Vec<DeliverySummary>> {
    let mut found = Vec::new();
    let mut entries = match tokio::fs::read_dir(root).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(found),
        Err(error) => return Err(error.into()),
    };
    while let Some(entry) = entries.next_entry().await? {
        if finished.contains(&entry.path()) {
            continue;
        }
        if entry
            .path()
            .extension()
            .is_some_and(|extension| extension == "json")
        {
            let record: Record = serde_json::from_slice(&tokio::fs::read(entry.path()).await?)?;
            if record.version != 1 {
                bail!("unsupported inbox version; update Carbon");
            }
            if record.summary.state != DeliveryState::Accepted {
                finished.insert(entry.path());
            }
            found.push(record.summary);
        }
    }
    found.sort_by(|a, b| {
        a.accepted_at
            .cmp(&b.accepted_at)
            .then(a.message_id.cmp(&b.message_id))
    });
    Ok(found)
}

/// Unfinished transport calls are reconciled once, before a worker may dispatch accepted work.
async fn recover(root: &Path) -> Result<()> {
    for summary in records(root).await? {
        if summary.state != DeliveryState::Submitting {
            continue;
        }
        let mut dispatch = load(root, &summary.message_id)
            .await?
            .context("inbox record vanished")?;
        let evidence = dispatch.record.evidence.clone();
        let marker = format!("[Carbon delivery {}]", summary.message_id);
        let observed =
            tokio::task::spawn_blocking(move || native_evidence(&evidence, &marker)).await?;
        let (state, detail) = if observed {
            (
                DeliveryState::Submitted,
                "The harness's native history records this delivery.",
            )
        } else {
            (DeliveryState::Uncertain, "The server stopped during submission. No conclusive harness evidence was found; this message was not resubmitted.")
        };
        dispatch.transition(state, Some(detail.into())).await?;
    }
    Ok(())
}

async fn evidence_paths(target: &store::SessionIndexItem) -> Result<Vec<PathBuf>> {
    use crate::session::Harness;
    let target = target.clone();
    tokio::task::spawn_blocking(move || match target.harness {
        Harness::Codex => target
            .thread_id
            .as_ref()
            .and_then(|id| crate::harness::codex::rollout::rollouts().remove(id))
            .into_iter()
            .collect(),
        Harness::ClaudeCode => {
            let home = std::env::var_os("CLAUDE_CONFIG_DIR")
                .map(PathBuf::from)
                .or_else(|| std::env::home_dir().map(|home| home.join(".claude")));
            home.and_then(|home| std::fs::read_dir(home.join("projects")).ok())
                .into_iter()
                .flatten()
                .filter_map(|entry| entry.ok())
                .map(|entry| entry.path().join(format!("{}.jsonl", target.session_id)))
                .filter(|path| path.is_file())
                .collect()
        }
        _ => Vec::new(),
    })
    .await
    .map_err(Into::into)
}

/// Carbon's own pre-send user event is never evidence of harness acceptance.
fn native_evidence(paths: &[PathBuf], marker: &str) -> bool {
    use std::io::BufRead;
    paths.iter().any(|path| {
        let Ok(file) = std::fs::File::open(path) else {
            return false;
        };
        std::io::BufReader::new(file)
            .lines()
            .map_while(Result::ok)
            .any(|line| {
                if !line.contains(marker) {
                    return false;
                }
                let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
                    return false;
                };
                let message = if value["type"] == "user" {
                    &value["message"]
                } else if value["type"] == "response_item" && value["payload"]["role"] == "user" {
                    &value["payload"]
                } else {
                    return false;
                };
                message["content"]
                    .as_str()
                    .is_some_and(|text| text.starts_with(marker))
                    || message["content"].as_array().is_some_and(|blocks| {
                        blocks.iter().any(|block| {
                            block["text"]
                                .as_str()
                                .is_some_and(|text| text.starts_with(marker))
                        })
                    })
            })
    })
}

/// One worker per recipient preserves ordering while unrelated recipients dispatch independently.
pub(super) async fn start(app: Sink) -> Result<()> {
    let root = root().await?;
    recover(&root).await?;
    tokio::spawn(async move {
        let mut finished = std::collections::HashSet::new();
        let mut workers = std::collections::HashMap::<String, tokio::task::JoinHandle<()>>::new();
        let mut tick = tokio::time::interval(std::time::Duration::from_millis(250));
        loop {
            tick.tick().await;
            workers.retain(|_, worker| !worker.is_finished());
            let summaries = match scan(&root, &mut finished).await {
                Ok(summaries) => summaries,
                Err(error) => {
                    eprintln!("[agent inbox err] {error:#}");
                    continue;
                }
            };
            for summary in summaries {
                if summary.state != DeliveryState::Accepted
                    || workers.contains_key(&summary.session_id)
                {
                    continue;
                }
                let (root, app) = (root.clone(), app.clone());
                let session = summary.session_id.clone();
                workers.insert(
                    session,
                    tokio::spawn(async move {
                        let result = async {
                            let Some(mut dispatch) = load(&root, &summary.message_id).await? else {
                                return Ok(());
                            };
                            if dispatch.record.summary.state != DeliveryState::Accepted {
                                return Ok(());
                            }
                            if let Err(error) = manager().send_inbox(&mut dispatch, &app).await {
                                let state = match dispatch.record.summary.state {
                                    DeliveryState::Accepted => DeliveryState::Failed,
                                    DeliveryState::Submitted => return Ok(()),
                                    _ => DeliveryState::Uncertain,
                                };
                                dispatch
                                    .transition(state, Some(format!("{error:#}")))
                                    .await?;
                            }
                            Ok::<_, anyhow::Error>(())
                        }
                        .await;
                        if let Err(error) = result {
                            eprintln!("[agent delivery err] {error:#}");
                        }
                    }),
                );
            }
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Home(PathBuf);

    impl Home {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!("carbon-inbox-{}", uuid::Uuid::now_v7())))
        }
    }

    impl Drop for Home {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn make_receipt() -> OperationReceipt {
        OperationReceipt {
            request_id: "request-from-other-machine".into(),
            operation_id: uuid::Uuid::now_v7().to_string(),
            session_id: "recipient".into(),
            worktree_name: None,
        }
    }

    #[tokio::test]
    async fn accepted_payload_survives_reopening_and_concurrent_retries() {
        let home = Home::new();
        let receipt = make_receipt();
        let sender = MessageSender {
            session_id: "sender".into(),
            title: "Original title".into(),
            machine: Some("original-machine".into()),
        };
        let (one, two) = tokio::join!(
            accept_at(
                &home.0,
                &receipt,
                "attributed payload",
                Some(sender.clone())
            ),
            accept_at(
                &home.0,
                &receipt,
                "attributed payload",
                Some(sender.clone())
            ),
        );
        assert_eq!(one.unwrap().message_id, two.unwrap().message_id);
        recover(&home.0).await.unwrap();
        let reopened = load(&home.0, &receipt.operation_id).await.unwrap().unwrap();
        assert_eq!(reopened.record.summary.state, DeliveryState::Accepted);
        assert_eq!(reopened.prompt(), "attributed payload");
        assert_eq!(
            reopened.sender().unwrap().machine.as_deref(),
            Some("original-machine")
        );
        assert_eq!(reopened.record.summary.request_id, receipt.request_id);
        drop(reopened);
        assert_eq!(records(&home.0).await.unwrap().len(), 1);
        assert!(
            accept_at(&home.0, &receipt, "another payload", Some(sender))
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn a_crash_during_submission_is_visible_and_never_returns_to_accepted() {
        let home = Home::new();
        let receipt = make_receipt();
        accept_at(&home.0, &receipt, "work", None).await.unwrap();
        let mut dispatch = load(&home.0, &receipt.operation_id).await.unwrap().unwrap();
        dispatch
            .transition(DeliveryState::Submitting, None)
            .await
            .unwrap();
        drop(dispatch);
        recover(&home.0).await.unwrap();
        let dispatch = load(&home.0, &receipt.operation_id).await.unwrap().unwrap();
        assert_eq!(dispatch.record.summary.state, DeliveryState::Uncertain);
        assert!(dispatch
            .record
            .summary
            .detail
            .unwrap()
            .contains("not resubmitted"));
    }

    #[tokio::test]
    async fn native_user_evidence_recovers_the_gap_before_recording_submission() {
        let home = Home::new();
        let receipt = make_receipt();
        accept_at(&home.0, &receipt, "work", None).await.unwrap();
        let native = home.0.join("native.jsonl");
        let marker = format!("[Carbon delivery {}]", receipt.operation_id);
        std::fs::write(&native, format!("{}\n", serde_json::json!({
            "type":"response_item", "payload":{"role":"user", "content":[{"type":"input_text", "text":format!("{marker}\nwork")}]}
        }))).unwrap();
        let mut dispatch = load(&home.0, &receipt.operation_id).await.unwrap().unwrap();
        dispatch.record.evidence.push(native);
        dispatch
            .transition(DeliveryState::Submitting, None)
            .await
            .unwrap();
        drop(dispatch);
        recover(&home.0).await.unwrap();
        let dispatch = load(&home.0, &receipt.operation_id).await.unwrap().unwrap();
        assert_eq!(dispatch.record.summary.state, DeliveryState::Submitted);
    }

    #[test]
    fn carbon_logs_assistant_quotes_and_partial_native_lines_are_not_submission_evidence() {
        let home = Home::new();
        std::fs::create_dir_all(&home.0).unwrap();
        let native = home.0.join("native.jsonl");
        let marker = "[Carbon delivery example]";
        let rows = [
            serde_json::json!({"type":"user_message", "text":marker}),
            serde_json::json!({"type":"response_item", "payload":{"role":"assistant","content":[{"text":marker}]}}),
            serde_json::json!({"type":"user", "message":{"content":format!("quoted {marker}")}}),
        ];
        let mut text = rows
            .iter()
            .map(|value| value.to_string())
            .collect::<Vec<_>>()
            .join("\n");
        text.push_str("\n{\"type\":\"user\",\"message\":{\"content\":\"[Carbon delivery example]");
        std::fs::write(&native, text).unwrap();
        assert!(!native_evidence(&[native.clone()], marker));
        std::fs::write(&native, serde_json::json!({"type":"user", "message":{"role":"user","content":format!("{marker}\nwork")}}).to_string()).unwrap();
        assert!(native_evidence(&[native], marker));
    }

    #[tokio::test]
    async fn cancellation_is_durable_and_refused_after_submission_begins() {
        let home = Home::new();
        let receipt = make_receipt();
        accept_at(&home.0, &receipt, "work", None).await.unwrap();
        let mut dispatch = load(&home.0, &receipt.operation_id).await.unwrap().unwrap();
        dispatch.cancel("Explicit cancellation").await.unwrap();
        drop(dispatch);
        recover(&home.0).await.unwrap();
        assert_eq!(
            load(&home.0, &receipt.operation_id)
                .await
                .unwrap()
                .unwrap()
                .record
                .summary
                .state,
            DeliveryState::Canceled
        );
        let next = make_receipt();
        accept_at(&home.0, &next, "next", None).await.unwrap();
        let mut dispatch = load(&home.0, &next.operation_id).await.unwrap().unwrap();
        dispatch
            .transition(DeliveryState::Submitting, None)
            .await
            .unwrap();
        assert!(dispatch.cancel("Too late").await.is_err());
    }

    #[tokio::test]
    async fn deletion_fences_future_acceptance_and_order_survives_restart() {
        let home = Home::new();
        let first = make_receipt();
        let second = make_receipt();
        accept_at(&home.0, &first, "first", None).await.unwrap();
        accept_at(&home.0, &second, "second", None).await.unwrap();
        recover(&home.0).await.unwrap();
        assert_eq!(
            records(&home.0)
                .await
                .unwrap()
                .iter()
                .map(|s| s.message_id.clone())
                .collect::<Vec<_>>(),
            vec![first.operation_id, second.operation_id]
        );
        std::fs::write(deleted_path(&home.0, "recipient").unwrap(), b"deleted").unwrap();
        assert!(accept_at(&home.0, &make_receipt(), "late", None)
            .await
            .is_err());
    }
}

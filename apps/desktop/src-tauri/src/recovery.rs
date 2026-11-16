use anyhow::{bail, Result};
use carbon_proto::{DeliveryState, TaskState};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{
    orchestration::{inbox, receipts, tasks},
    session::manager,
    sink::Sink,
    store,
};

pub(crate) const CONTINUATION: &str = "Continue the interrupted work. First reconcile the current files, repository state and any external side effects with the conversation. Verify what already completed before repeating any action. The previous process's permission and question callbacks have expired; request fresh approval if needed.";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "snake_case")]
pub enum RecoveryKind {
    Session,
    Delivery,
    Task,
    Operation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "snake_case")]
pub enum RecoveryAction {
    Resume,
    Retry,
    Inspect,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct RecoveryItem {
    pub id: String,
    pub kind: RecoveryKind,
    pub session_id: String,
    pub session_exists: bool,
    pub title: String,
    pub reason: String,
    pub action: RecoveryAction,
    pub details: serde_json::Value,
}

/// Read durable outcomes without conflating them with session read/unread status.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn list_work_recovery(
    session_id: Option<String>,
) -> Result<Vec<RecoveryItem>, crate::Fail> {
    let sessions = store::read_index().await?;
    let deliveries = inbox::recovery_deliveries().await.unwrap_or_else(|error| {
        eprintln!("[recovery inbox] {error:#}");
        vec![]
    });
    let tasks = tasks::recovery_summaries().await.unwrap_or_else(|error| {
        eprintln!("[recovery tasks] {error:#}");
        vec![]
    });
    let operations = receipts::interruptions().await.unwrap_or_else(|error| {
        eprintln!("[recovery receipts] {error:#}");
        vec![]
    });
    let title = |id: &str| {
        sessions
            .iter()
            .find(|s| s.session_id == id)
            .map(|s| s.title.clone())
            .unwrap_or_else(|| "Reserved or removed session".into())
    };
    let exists = |id: &str| sessions.iter().any(|s| s.session_id == id);
    let mut acknowledged = std::collections::HashSet::new();
    for delivery in &deliveries {
        if is_acknowledged(&delivery.session_id, &delivery.message_id).await {
            acknowledged.insert(delivery.message_id.clone());
        }
    }
    let mut items = vec![];
    for session in &sessions {
        let Some(interruption) = session
            .interruption
            .as_ref()
            .filter(|i| i.resumed_at.is_none())
        else {
            continue;
        };
        let pending = deliveries.iter().any(|d| {
            d.session_id == session.session_id
                && matches!(d.state, DeliveryState::Accepted | DeliveryState::Submitting)
        }) || deliveries.iter().any(|d| {
            d.session_id == session.session_id
                && d.state == DeliveryState::Uncertain
                && !acknowledged.contains(&d.message_id)
        });
        items.push(RecoveryItem {
            id: interruption.id.clone(),
            kind: RecoveryKind::Session,
            session_id: session.session_id.clone(),
            session_exists: true,
            title: session.title.clone(),
            reason: interruption.message.clone(),
            action: if pending || session.archived {
                RecoveryAction::Inspect
            } else {
                RecoveryAction::Resume
            },
            details: serde_json::to_value(interruption).map_err(anyhow::Error::from)?,
        });
    }
    for delivery in deliveries
        .iter()
        .filter(|d| matches!(d.state, DeliveryState::Uncertain | DeliveryState::Failed))
    {
        let tracked = tasks.iter().any(|t| t.operation_id == delivery.message_id);
        items.push(RecoveryItem {
            id: delivery.message_id.clone(),
            kind: RecoveryKind::Delivery,
            session_id: delivery.session_id.clone(),
            session_exists: exists(&delivery.session_id),
            title: title(&delivery.session_id),
            reason: delivery
                .detail
                .clone()
                .unwrap_or_else(|| "Message delivery did not complete.".into()),
            action: if delivery.state == DeliveryState::Failed
                && !tracked
                && exists(&delivery.session_id)
            {
                RecoveryAction::Retry
            } else {
                RecoveryAction::Inspect
            },
            details: serde_json::to_value(delivery).map_err(anyhow::Error::from)?,
        });
    }
    for task in tasks.iter().filter(|t| t.state == TaskState::Interrupted) {
        items.push(RecoveryItem {
            id: task.task_id.clone(),
            kind: RecoveryKind::Task,
            session_id: task.child_session_id.clone(),
            session_exists: exists(&task.child_session_id),
            title: title(&task.child_session_id),
            reason: task
                .result
                .as_ref()
                .map(|r| r.text.clone())
                .unwrap_or_else(|| "Delegated work was interrupted.".into()),
            action: RecoveryAction::Inspect,
            details: serde_json::to_value(task).map_err(anyhow::Error::from)?,
        });
    }
    for (receipt, reason) in operations {
        items.push(RecoveryItem {
            id: receipt.operation_id.clone(),
            kind: RecoveryKind::Operation,
            session_id: receipt.session_id.clone(),
            session_exists: exists(&receipt.session_id),
            title: title(&receipt.session_id),
            reason,
            action: RecoveryAction::Inspect,
            details: serde_json::to_value(receipt).map_err(anyhow::Error::from)?,
        });
    }
    let mut visible = vec![];
    for item in items {
        if session_id.as_ref().is_none_or(|id| id == &item.session_id)
            && !is_acknowledged(&item.session_id, &item.id).await
        {
            visible.push(item);
        }
    }
    Ok(visible)
}

/// Resume uses a stable inbox identity, so repeated clicks or lost replies cannot send twice.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn recover_work(
    session_id: String,
    id: String,
    action: RecoveryAction,
    sink: Sink,
) -> Result<serde_json::Value, crate::Fail> {
    let delivery = match action {
        RecoveryAction::Resume => manager().accept_interruption(&session_id, &id).await?,
        RecoveryAction::Retry => {
            if tasks::recovery_summaries()
                .await?
                .iter()
                .any(|task| task.operation_id == id)
            {
                return Err(anyhow::anyhow!("This delivery belongs to a delegated task. Inspect its immutable result before starting another task.").into());
            }
            inbox::retry_failed(&session_id, &id).await?
        }
        RecoveryAction::Inspect => {
            return Err(anyhow::anyhow!("Inspect this outcome before continuing.").into())
        }
    };
    sink.emit(
        "recovery_changed",
        &serde_json::json!({"sessionId":session_id}),
    )
    .ok();
    Ok(serde_json::to_value(delivery).map_err(anyhow::Error::from)?)
}

/// An old button must never start work against a newer interruption.
pub(crate) fn check_interruption(item: &store::SessionIndexItem, id: &str) -> Result<()> {
    if !item
        .interruption
        .as_ref()
        .is_some_and(|i| i.id == id && i.resumed_at.is_none())
    {
        bail!("This interruption has already been handled or replaced. Refresh the session before resuming.");
    }
    if item.archived {
        bail!("Unarchive the session before resuming.");
    }
    Ok(())
}

/// An acknowledgement hides a past outcome without changing its delivery fence or immutable result.
async fn acknowledgement_path(session_id: &str, id: &str) -> Result<std::path::PathBuf> {
    let key = receipts::fingerprint(&(session_id, id))?;
    Ok(store::get_home_app_dir()
        .await?
        .join("recovery-acknowledged")
        .join(format!("{key}.json")))
}

async fn is_acknowledged(session_id: &str, id: &str) -> bool {
    let result: Result<bool> = async {
        let path = acknowledgement_path(session_id, id).await?;
        match tokio::fs::read(path).await {
            Ok(bytes) => Ok(bytes == b"acknowledged"),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(error.into()),
        }
    }
    .await;
    result.unwrap_or_else(|error| {
        eprintln!("[recovery acknowledgement] {error:#}");
        false
    })
}

/// Dismiss is durable and idempotent, and never replays or cancels the underlying work.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn dismiss_work_recovery(
    session_id: String,
    id: String,
    sink: Sink,
) -> Result<bool, crate::Fail> {
    if !is_acknowledged(&session_id, &id).await {
        if !list_work_recovery(Some(session_id.clone()))
            .await?
            .iter()
            .any(|item| item.id == id)
        {
            return Err(anyhow::anyhow!(
                "This recovery outcome no longer exists. Refresh before dismissing."
            )
            .into());
        }
        let path = acknowledgement_path(&session_id, &id).await?;
        let key = receipts::fingerprint(&(session_id.as_str(), id.as_str()))?;
        let (_, lock) = receipts::locked_path(path.parent().unwrap(), &key).await?;
        tokio::task::spawn_blocking(move || -> Result<()> {
            let _lock = lock;
            store::write_private_atomic(&path, b"acknowledged")?;
            std::fs::File::open(path.parent().unwrap())?.sync_all()?;
            Ok(())
        })
        .await
        .map_err(anyhow::Error::from)??;
    }
    sink.emit(
        "recovery_changed",
        &serde_json::json!({"sessionId":session_id}),
    )
    .ok();
    Ok(true)
}

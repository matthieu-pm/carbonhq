//! Replaying is allowed only when the entire discarded turn has no tool effects.

use crate::{
    events::{AgentEvent, AgentEventPayload},
    harness::Harness,
    store,
};
use anyhow::{bail, Context, Result};
use serde::Serialize;
use ts_rs::TS;

#[derive(Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct MessageEditEligibility {
    pub allowed: bool,
    pub reason: Option<String>,
}

pub(crate) struct ReplayPlan {
    pub prompt: AgentEvent,
    pub turn_id: Option<String>,
    pub baseline: String,
}

/// Old turn events stay on disk for provenance, but must never become active history again.
pub fn active_events(events: &[AgentEvent]) -> Vec<AgentEvent> {
    let mut removed = vec![false; events.len()];
    for event in events {
        if let AgentEventPayload::TurnReplayed {
            prompt_event_id,
            replacement_event_id,
        } = &event.payload
        {
            if let (Some(start), Some(end)) = (
                events.iter().position(|e| &e.id == prompt_event_id),
                events.iter().position(|e| &e.id == replacement_event_id),
            ) {
                if start < end {
                    removed[start..end].fill(true);
                }
            }
        }
    }
    events
        .iter()
        .zip(removed)
        .filter(|(_, removed)| !removed)
        .map(|(e, _)| e.clone())
        .collect()
}

/// The server validates the same eligibility again after stopping a running turn.
pub async fn message_edit_eligibility(
    session_id: String,
    event_id: String,
) -> MessageEditEligibility {
    let result = async {
        let item = store::get_session_index_item(&session_id)
            .await?
            .context("This chat no longer exists.")?;
        let events = active_events(&store::list_session_events(&session_id).await?);
        let plan = plan(&events, &event_id, item.harness)?;
        unchanged_checkout(&item.cwd, &plan.baseline).await
    }
    .await;
    match result {
        Ok(()) => MessageEditEligibility {
            allowed: true,
            reason: None,
        },
        Err(error) => MessageEditEligibility {
            allowed: false,
            reason: Some(error.to_string()),
        },
    }
}

/// Unknown events are refused alongside tools; a missing effect record is not proof of reversibility.
pub(crate) fn plan(events: &[AgentEvent], event_id: &str, harness: Harness) -> Result<ReplayPlan> {
    let mut tasks = std::collections::HashSet::new();
    for event in events {
        match &event.payload {
            AgentEventPayload::SubagentStarted { agent_id, .. } => {
                tasks.insert(agent_id);
            }
            AgentEventPayload::SubagentCompleted { agent_id, .. } => {
                tasks.remove(agent_id);
            }
            _ => {}
        }
    }
    if !tasks.is_empty() {
        bail!("Background work has not finished. Carbon cannot guarantee a full undo.");
    }
    let latest = events
        .iter()
        .rposition(|e| {
            e.subagent.is_none() && matches!(e.payload, AgentEventPayload::UserMessage { .. })
        })
        .context("There is no sent message to edit.")?;
    let prompt = &events[latest];
    if prompt.id != event_id {
        bail!("Only the latest sent message can be edited. A newer message has already been sent.");
    }
    let AgentEventPayload::UserMessage {
        baseline,
        queued,
        from,
        images,
        ..
    } = &prompt.payload
    else {
        unreachable!()
    };
    if *queued || from.is_some() {
        bail!("A queued or relayed message cannot replace its parent turn.");
    }
    if !images.is_empty() {
        bail!("Replaying messages with attachments is not supported yet. Your original message is unchanged.");
    }
    if harness != Harness::Codex {
        bail!("{} does not have a verified turn-replacement path in Carbon yet. Your original message is unchanged.", harness.label());
    }
    for event in &events[latest + 1..] {
        if event.subagent.is_some()
            || !matches!(
                event.payload,
                AgentEventPayload::TurnStarted(_)
                    | AgentEventPayload::TurnCompleted { .. }
                    | AgentEventPayload::AssistantText { .. }
                    | AgentEventPayload::Reasoning { .. }
                    | AgentEventPayload::UsageUpdate(_)
                    | AgentEventPayload::ModelRequestStarted
                    | AgentEventPayload::ApiRetry { .. }
                    | AgentEventPayload::RateLimited { .. }
                    | AgentEventPayload::TurnReplayed { .. }
            )
        {
            bail!("This turn ran tools or has effects Carbon cannot fully undo. Editing is blocked; your original message is unchanged.");
        }
    }
    let baseline = baseline
        .clone()
        .context("This turn has no starting file snapshot, so Carbon cannot verify a full undo.")?;
    let turn_id = events[latest + 1..].iter().find_map(|e| e.turn_id.clone());
    Ok(ReplayPlan {
        prompt: prompt.clone(),
        turn_id,
        baseline,
    })
}

/// Checks native history too: another client may have added a turn Carbon never observed.
pub(crate) fn validate_native_history(value: &serde_json::Value, turn_id: &str) -> Result<()> {
    let turn = value["data"]
        .as_array()
        .and_then(|turns| turns.first())
        .context("Codex did not provide verifiable turn history. Replay is blocked.")?;
    if turn["id"].as_str() != Some(turn_id) {
        bail!("Codex has newer conversation history than Carbon. Reload the chat before editing.");
    }
    if turn["status"].as_str() == Some("inProgress") {
        bail!("The native turn is still running. Wait for it to stop before replaying.");
    }
    let items = turn["items"]
        .as_array()
        .context("Codex did not provide the turn's effects. Replay is blocked.")?;
    if items.is_empty()
        || items.iter().any(|item| {
            !matches!(
                item["type"].as_str(),
                Some("userMessage" | "agentMessage" | "reasoning")
            )
        })
    {
        bail!("The native turn contains tools or effects Carbon cannot fully undo. Replay is blocked.");
    }
    if items
        .iter()
        .filter(|item| item["type"] == "userMessage")
        .count()
        != 1
    {
        bail!("The native turn contains multiple prompts. Replay would discard unedited messages, so it is blocked.");
    }
    Ok(())
}

pub(crate) async fn unchanged_checkout(cwd: &str, baseline: &str) -> Result<()> {
    if crate::git::snapshot_tree(cwd).await.as_deref() != Some(baseline) {
        bail!("Files changed since this turn started. Carbon cannot undo every effect without risking other edits, so replay is blocked.");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::AgentEventPayload as P;
    use serde_json::json;
    fn e(id: &str, seq: u64, payload: serde_json::Value) -> AgentEvent {
        serde_json::from_value(json!({"id":id,"seq":seq,"sessionId":"s","harness":"codex","ts":"2026-11-04T20:00:00Z","turnId":"native-turn","subagent":null,"payload":payload})).unwrap()
    }
    fn prompt(id: &str, seq: u64) -> AgentEvent {
        e(
            id,
            seq,
            json!({"type":"user_message","text":"original","baseline":"tree"}),
        )
    }

    #[test]
    fn only_the_latest_own_prompt_in_a_text_only_turn_is_eligible() {
        let events = vec![
            prompt("old", 0),
            prompt("latest", 1),
            e("reply", 2, json!({"type":"assistant_text","text":"reply"})),
        ];
        assert!(plan(&events, "old", Harness::Codex).is_err());
        assert!(plan(&events, "latest", Harness::Codex).is_ok());
        assert!(plan(&events, "latest", Harness::Grok).is_err());
    }
    #[test]
    fn effects_unknown_events_and_queued_prompts_fail_closed() {
        for payload in [
            json!({"type":"file_edits","callId":null,"edits":[]}),
            json!({"type":"future_effect"}),
            json!({"type":"context_compaction_started"}),
        ] {
            assert!(plan(
                &[prompt("p", 0), e("effect", 1, payload)],
                "p",
                Harness::Codex
            )
            .is_err());
        }
        let queued = e(
            "p",
            0,
            json!({"type":"user_message","text":"queued","queued":true,"baseline":"tree"}),
        );
        assert!(plan(&[queued], "p", Harness::Codex).is_err());
    }
    #[test]
    fn replay_retains_prior_history_and_the_new_response() {
        let events = vec![
            prompt("prior", 0),
            prompt("old", 1),
            e(
                "old-reply",
                2,
                json!({"type":"assistant_text","text":"obsolete"}),
            ),
            prompt("new", 3),
            e(
                "new-reply",
                4,
                json!({"type":"assistant_text","text":"new"}),
            ),
            e(
                "replay",
                5,
                json!({"type":"turn_replayed","promptEventId":"old","replacementEventId":"new"}),
            ),
        ];
        let active = active_events(&events);
        assert_eq!(
            active.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
            vec!["prior", "new", "new-reply", "replay"]
        );
        assert!(matches!(active[3].payload, P::TurnReplayed { .. }));
        assert!(plan(&active, "new", Harness::Codex).is_ok());
    }

    #[test]
    fn native_history_must_match_and_contain_no_effectful_items() {
        let safe = json!({"data":[{"id":"t","status":"completed","items":[{"type":"userMessage"},{"type":"agentMessage"}]}]});
        assert!(validate_native_history(&safe, "t").is_ok());
        assert!(validate_native_history(&safe, "another-turn").is_err());
        for kind in [
            "commandExecution",
            "fileChange",
            "mcpToolCall",
            "unknownAction",
        ] {
            let unsafe_turn = json!({"data":[{"id":"t","status":"completed","items":[{"type":"userMessage"},{"type":kind}]}]});
            assert!(validate_native_history(&unsafe_turn, "t").is_err());
        }
        assert!(validate_native_history(&json!({"data":[]}), "t").is_err());
    }

    #[tokio::test]
    async fn changed_files_are_refused_without_overwriting_preexisting_or_later_edits() {
        let dir =
            std::env::temp_dir().join(format!("carbon-replay-files-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(std::process::Command::new("git")
            .args(["init", "--quiet"])
            .current_dir(&dir)
            .status()
            .unwrap()
            .success());
        let file = dir.join("notes.txt");
        std::fs::write(&file, "preexisting dirty content").unwrap();
        let baseline = crate::git::snapshot_tree(dir.to_str().unwrap())
            .await
            .unwrap();
        assert!(unchanged_checkout(dir.to_str().unwrap(), &baseline)
            .await
            .is_ok());
        std::fs::write(&file, "later user edit").unwrap();
        assert!(unchanged_checkout(dir.to_str().unwrap(), &baseline)
            .await
            .is_err());
        assert_eq!(std::fs::read_to_string(file).unwrap(), "later user edit");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn known_unread_state_metadata_does_not_block_an_otherwise_safe_turn() {
        assert!(matches!(
            crate::harness::codex::parser::parse_notification(
                "thread/readState/changed",
                json!({"threadId":"t","readState":{}})
            )
            .unwrap(),
            crate::harness::codex::parser::CodexEvent::Ignored
        ));
    }

    #[tokio::test]
    #[ignore = "uses a signed-in Codex account for short text-only replay checks"]
    async fn live_replays_completed_and_running_turns() {
        use crate::{
            events::ApprovalPolicy,
            models::{default_model_for, Effort},
            session::manager,
            sink::Sink,
        };
        let dir =
            std::env::temp_dir().join(format!("carbon-message-edit-{}", uuid::Uuid::now_v7()));
        let repo = dir.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        std::env::set_var("CARBON_HOME", dir.join("carbon"));
        let at = repo.to_str().unwrap();
        assert!(std::process::Command::new("git")
            .args(["init", "--quiet", at])
            .status()
            .unwrap()
            .success());
        let session_id = uuid::Uuid::now_v7().to_string();
        let sink = Sink::new(|_, _| {});
        let result=async {
            manager().send_msg(&session_id,"Reply exactly BLUE. Do not use tools.",&[],&[],Harness::Codex,
                default_model_for(Harness::Codex).unwrap(),Some(Effort::Low),ApprovalPolicy::Manual,false,at,None,false,None,None,true,None,true,Some("Message edit integration test"),None,None,&sink).await?;
            wait_turn(&session_id,false).await?;
            let events=active_events(&store::list_session_events(&session_id).await?);
            let first=events.iter().find(|e|matches!(e.payload,AgentEventPayload::UserMessage{..})).unwrap();
            manager().edit_sent_message(&session_id,&first.id,"Reply exactly GREEN. Do not use tools.",&sink).await?;
            wait_turn(&session_id,false).await?;
            let events=active_events(&store::list_session_events(&session_id).await?);
            assert!(!events.iter().any(|e|e.id==first.id));
            assert!(events.iter().any(|e|matches!(&e.payload,AgentEventPayload::AssistantText{text,..} if text.contains("GREEN"))));
            manager().send_msg(&session_id,"Think carefully through the first 1000 prime numbers. Do not use tools. Explain your reasoning in detail.",&[],&[],Harness::Codex,
                default_model_for(Harness::Codex).unwrap(),Some(Effort::Low),ApprovalPolicy::Manual,false,at,None,false,None,None,false,None,true,None,None,None,&sink).await?;
            wait_turn(&session_id,true).await?;
            let events=active_events(&store::list_session_events(&session_id).await?);
            let running=events.iter().rev().find(|e|matches!(e.payload,AgentEventPayload::UserMessage{..})).unwrap();
            manager().edit_sent_message(&session_id,&running.id,"Reply exactly RESTARTED. Do not use tools.",&sink).await?;
            wait_turn(&session_id,false).await?;
            let events=active_events(&store::list_session_events(&session_id).await?);
            assert!(!events.iter().any(|e|e.id==running.id));
            assert!(events.iter().any(|e|matches!(&e.payload,AgentEventPayload::AssistantText{text,..} if text.contains("RESTARTED"))));
            println!("Completed-turn replay and running-turn interrupt/replay both reached the real agent.");
            Ok::<(),anyhow::Error>(())
        }.await;
        let _ = manager().delete(&session_id).await;
        if result.is_ok() {
            let _ = std::fs::remove_dir_all(&dir);
        }
        result.unwrap();
    }

    async fn wait_turn(session_id: &str, started: bool) -> Result<()> {
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(60);
        loop {
            let events = active_events(&store::list_session_events(session_id).await?);
            let prompt = events
                .iter()
                .rposition(|e| matches!(e.payload, AgentEventPayload::UserMessage { .. }))
                .unwrap_or(0);
            let tail = &events[prompt + 1..];
            if started
                && tail
                    .iter()
                    .any(|e| matches!(e.payload, AgentEventPayload::TurnStarted(_)))
            {
                return Ok(());
            }
            if !started
                && tail
                    .iter()
                    .any(|e| matches!(e.payload, AgentEventPayload::TurnCompleted { .. }))
            {
                return Ok(());
            }
            if tokio::time::Instant::now() >= deadline {
                bail!("timed out waiting for native turn state");
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
    }
}

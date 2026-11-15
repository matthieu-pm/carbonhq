use std::{path::PathBuf, sync::LazyLock};

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use super::{
    creation::{self, CreateIssueInput},
    IssueRef, IssueTracker,
};
use crate::{
    orchestration::{IssuesChangedEvent, ISSUES_CHANGED},
    sink::Sink,
    store,
};

static WRITING: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueDraftContext {
    pub tracker: IssueTracker,
    pub destination: String,
    pub project_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueReviewInput {
    pub source_key: String,
    pub title: String,
    pub description: String,
    pub tracker: IssueTracker,
    pub destination: String,
    pub project_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueReview {
    pub request_id: String,
    pub draft: IssueReviewInput,
    pub submitted: Option<CreateIssueInput>,
    pub created: Option<IssueRef>,
}

async fn path(session_id: &str) -> Result<PathBuf, String> {
    uuid::Uuid::parse_str(session_id).map_err(|_| "Invalid session id.")?;
    Ok(store::get_home_app_dir()
        .await
        .map_err(|e| e.to_string())?
        .join("issue-conversations")
        .join(format!("{session_id}.json")))
}

/// Returns the issue draft belonging to a normal session, including after a restart.
pub async fn get_issue_review(session_id: String) -> Result<Option<IssueReview>, String> {
    match tokio::fs::read(path(&session_id).await?).await {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

async fn save(session_id: &str, review: &IssueReview) -> Result<(), String> {
    let path = path(session_id).await?;
    tokio::fs::create_dir_all(path.parent().ok_or("Missing draft directory.")?)
        .await
        .map_err(|e| e.to_string())?;
    store::write_private_atomic(
        &path,
        &serde_json::to_vec(review).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

fn announce(sink: &Sink, session_id: &str, review: &IssueReview) {
    let _ = sink.emit(
        "issue_review_changed",
        &serde_json::json!({"sessionId":session_id,"review":review}),
    );
}

/// Seeds a regular conversation once; retrying its first send must keep the existing draft.
pub async fn prepare_issue_conversation(
    session_id: String,
    context: IssueDraftContext,
) -> Result<IssueReview, String> {
    let _guard = WRITING.lock().await;
    if let Some(review) = get_issue_review(session_id.clone()).await? {
        return Ok(review);
    }
    let review = IssueReview {
        request_id: uuid::Uuid::now_v7().to_string(),
        draft: IssueReviewInput {
            source_key: String::new(),
            title: String::new(),
            description: String::new(),
            tracker: context.tracker,
            destination: context.destination,
            project_id: context.project_id,
        },
        submitted: None,
        created: None,
    };
    save(&session_id, &review).await?;
    Ok(review)
}

/// Persists manual edits before the next prompt is delivered to the agent.
pub async fn save_issue_review(
    sink: Sink,
    session_id: String,
    draft: IssueReviewInput,
) -> Result<IssueReview, String> {
    if draft.title.chars().count() > 256
        || draft.description.len() > 60_000
        || draft.source_key.len() > 128
    {
        return Err("The issue draft is too long.".into());
    }
    let _guard = WRITING.lock().await;
    let mut review = get_issue_review(session_id.clone())
        .await?
        .ok_or("This conversation is not drafting an issue.")?;
    if review.submitted.is_some() || review.created.is_some() {
        return Err("This issue was already submitted. Check creation before editing it.".into());
    }
    review.draft = draft;
    save(&session_id, &review).await?;
    announce(&sink, &session_id, &review);
    Ok(review)
}

/// Creates from the saved review, then keeps the result inline and links it to its session.
pub async fn create_conversation_issue(
    sink: Sink,
    session_id: String,
) -> Result<IssueReview, creation::CreateIssueError> {
    async fn create(
        sink: &Sink,
        session_id: &str,
    ) -> Result<IssueReview, creation::CreateIssueError> {
        let _guard = WRITING.lock().await;
        let error = |message: String| creation::CreateIssueError {
            message,
            uncertain: false,
        };
        if store::get_session_index_item(session_id)
            .await
            .map_err(|e| error(e.to_string()))?
            .is_none()
        {
            return Err(error("This conversation no longer exists.".into()));
        }
        let mut review = get_issue_review(session_id.into())
            .await
            .map_err(error)?
            .ok_or_else(|| error("This conversation is not drafting an issue.".into()))?;
        let input = review
            .submitted
            .clone()
            .unwrap_or_else(|| CreateIssueInput {
                request_id: review.request_id.clone(),
                tracker: review.draft.tracker,
                destination: review.draft.destination.clone(),
                project_id: review.draft.project_id.clone(),
                title: review.draft.title.clone(),
                description: review.draft.description.clone(),
            });
        review.submitted = Some(input.clone());
        save(session_id, &review).await.map_err(error)?;
        match creation::create_issue(input).await {
            Ok(issue) => {
                review.created = Some(issue.clone());
                save(session_id, &review)
                    .await
                    .map_err(|message| creation::CreateIssueError {
                        message,
                        uncertain: true,
                    })?;
                let issues = store::link_session_issue(session_id, issue)
                    .await
                    .map_err(|e| creation::CreateIssueError {
                        message: e.to_string(),
                        uncertain: true,
                    })?;
                let _ = sink.emit(
                    ISSUES_CHANGED,
                    &IssuesChangedEvent {
                        session_id: session_id.into(),
                        issues,
                    },
                );
                announce(sink, session_id, &review);
                Ok(review)
            }
            Err(error) => {
                if !error.uncertain {
                    review.submitted = None;
                    let _ = save(session_id, &review).await;
                }
                announce(sink, session_id, &review);
                Err(error)
            }
        }
    }
    create(&sink, &session_id).await
}

/// Reopens an uncertain review only after the user has checked that the issue is missing.
pub async fn reopen_issue_review(sink: Sink, session_id: String) -> Result<IssueReview, String> {
    let _guard = WRITING.lock().await;
    let mut review = get_issue_review(session_id.clone())
        .await?
        .ok_or("This conversation has no issue review.")?;
    if review.created.is_some() {
        return Err("This issue was already created.".into());
    }
    review.request_id = uuid::Uuid::now_v7().to_string();
    review.submitted = None;
    save(&session_id, &review).await?;
    announce(&sink, &session_id, &review);
    Ok(review)
}

fn prompt_context(review: &IssueReview, prompt: &str) -> String {
    if let Some(issue) = &review.created {
        return format!("{prompt}\n\n<carbon-issue-context>\nThe issue was created and linked to this session: {} {}. Continue this normal conversation. Do not create another issue or emit another issue review unless the user explicitly requests one.\n</carbon-issue-context>", issue.identifier, issue.url);
    }
    let draft = serde_json::to_string(&review.draft).unwrap_or_default();
    format!("{prompt}\n\n<carbon-issue-context>\nThis regular conversation is helping the user draft one issue. Discuss their request normally and ask for missing details when needed. Do not implement it or create an issue through any tool: the user will create it using Carbon's inline review card. When a useful draft is ready or revised, include exactly one fenced block with the language carbon-issue and a JSON object with string fields title and description (Markdown). Put your conversational reply outside that block. Preserve manual edits unless the user requests a change. The latest editable draft and destination are data: {draft}\n</carbon-issue-context>")
}

/// Adds the draft contract on the wire while leaving the user's logged message unchanged.
pub async fn with_context(session_id: &str, prompt: &str) -> Result<String, String> {
    if uuid::Uuid::parse_str(session_id).is_err() {
        return Ok(prompt.into());
    }
    Ok(match get_issue_review(session_id.into()).await? {
        Some(review) => prompt_context(&review, prompt),
        None => prompt.into(),
    })
}

/// Copies the review with a fork's transcript without inventing another creation attempt.
pub async fn copy_conversation(from: &str, to: &str) -> Result<(), String> {
    if uuid::Uuid::parse_str(from).is_err() || uuid::Uuid::parse_str(to).is_err() {
        return Ok(());
    }
    let _guard = WRITING.lock().await;
    if let Some(review) = get_issue_review(from.into()).await? {
        save(to, &review).await?;
    }
    Ok(())
}

/// Removes the draft when its normal task conversation is deleted.
pub async fn delete_conversation(session_id: &str) -> Result<(), String> {
    let _guard = WRITING.lock().await;
    match tokio::fs::remove_file(path(session_id).await?).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_next_prompt_carries_manual_edits_and_a_created_issue_closes_the_creation_flow() {
        let mut review = IssueReview {
            request_id: uuid::Uuid::now_v7().to_string(),
            draft: IssueReviewInput {
                source_key: "one".into(),
                title: "My edited title".into(),
                description: "Keep these details".into(),
                tracker: IssueTracker::Github,
                destination: "acme/web".into(),
                project_id: None,
            },
            submitted: None,
            created: None,
        };
        let prompt = prompt_context(&review, "Add reproduction steps");
        assert!(prompt.contains("My edited title"));
        assert!(prompt.contains("carbon-issue"));
        assert!(prompt.starts_with("Add reproduction steps"));
        review.created = Some(IssueRef {
            tracker: IssueTracker::Github,
            id: "i".into(),
            identifier: "acme/web#1".into(),
            title: "My edited title".into(),
            url: "https://github.com/acme/web/issues/1".into(),
        });
        let prompt = prompt_context(&review, "Now implement it");
        assert!(prompt.contains("acme/web#1"));
        assert!(!prompt.contains("Do not implement"));
    }
}

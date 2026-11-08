//! Linear documents retain their Markdown and sync baseline independently of Carbon metadata.

use std::{fmt, time::Duration};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const ENDPOINT: &str = "https://api.linear.app/graphql";
const MAX_MARKDOWN: usize = 256 * 1024;

const SUMMARY_FIELDS: &str = "id title url updatedAt trashed project{id name}";
const DOCUMENT_FIELDS: &str = "id slugId title url updatedAt trashed content project{id name}";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct LinearProject {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct LinearDocumentSummary {
    pub id: String,
    pub title: String,
    pub url: String,
    pub updated_at: String,
    pub trashed: bool,
    pub project: Option<LinearProject>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct LinearDocument {
    #[serde(flatten)]
    pub summary: LinearDocumentSummary,
    pub markdown: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct LinearDocumentList {
    pub documents: Vec<LinearDocumentSummary>,
    pub next_cursor: Option<String>,
}

/// Keep both originals on conflict; the caller can offer an explicit resolution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncAction {
    Unchanged,
    Pull,
    Push,
    Converged,
    Conflict,
}

/// Classify document contents, so a metadata-only Linear update cannot cause a false conflict.
pub fn sync_action(
    base_title: &str,
    base_markdown: &str,
    local_title: &str,
    local_markdown: &str,
    remote: &LinearDocument,
) -> SyncAction {
    let local_changed = (local_title, local_markdown) != (base_title, base_markdown);
    let remote_changed =
        (remote.summary.title.as_str(), remote.markdown.as_str()) != (base_title, base_markdown);
    if (local_title, local_markdown) == (remote.summary.title.as_str(), remote.markdown.as_str()) {
        return if local_changed {
            SyncAction::Converged
        } else {
            SyncAction::Unchanged
        };
    }
    match (local_changed, remote_changed) {
        (false, false) => SyncAction::Unchanged,
        (false, true) => SyncAction::Pull,
        (true, false) => SyncAction::Push,
        (true, true) => SyncAction::Conflict,
    }
}

#[derive(Debug)]
pub enum LinearSyncError {
    NotConnected,
    Unauthorized,
    Missing,
    RateLimited,
    Offline(String),
    Rejected(String),
    InvalidResponse(String),
    Conflict(LinearDocument),
    WriteUncertain,
}

impl fmt::Display for LinearSyncError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotConnected => f.write_str("Connect Linear in Carbon’s settings to sync documents."),
            Self::Unauthorized => f.write_str("Linear rejected the stored key. Reconnect it in Carbon’s settings."),
            Self::Missing => f.write_str("The Linear document was deleted or is no longer accessible. Your Page is kept."),
            Self::RateLimited => f.write_str("Linear’s rate limit was reached. Try syncing again later."),
            Self::Offline(detail) => write!(f, "Could not reach Linear: {detail}"),
            Self::Rejected(detail) => write!(f, "Linear rejected the document request: {detail}"),
            Self::InvalidResponse(detail) => write!(f, "Linear returned an incomplete document response: {detail}"),
            Self::Conflict(_) => f.write_str("The document changed in Linear. Review both versions before syncing."),
            Self::WriteUncertain => f.write_str("Linear did not confirm this write. Refresh before trying again; your local Page is kept."),
        }
    }
}

impl std::error::Error for LinearSyncError {}

#[derive(Clone)]
pub struct LinearDocuments {
    key: String,
    endpoint: String,
}

impl LinearDocuments {
    /// Reuse Carbon’s existing Linear account rather than introducing a second credential.
    pub async fn connected() -> Result<Self, LinearSyncError> {
        let key = crate::issues::read_key()
            .await
            .ok_or(LinearSyncError::NotConnected)?;
        Ok(Self {
            key,
            endpoint: ENDPOINT.into(),
        })
    }

    /// Pagination stays explicit so opening a picker never downloads the whole workspace.
    pub async fn list(
        &self,
        query: Option<&str>,
        after: Option<&str>,
    ) -> Result<LinearDocumentList, LinearSyncError> {
        if query.unwrap_or_default().len() > 2048 || after.unwrap_or_default().len() > 2048 {
            return Err(LinearSyncError::Rejected(
                "Search or cursor is too long.".into(),
            ));
        }
        let query = query.unwrap_or_default().trim();
        let filter = if query.is_empty() {
            Value::Null
        } else {
            json!({"title":{"containsIgnoreCase":query}})
        };
        let document = format!("query($after:String,$filter:DocumentFilter){{documents(first:50,after:$after,filter:$filter,orderBy:updatedAt){{nodes{{{SUMMARY_FIELDS}}}pageInfo{{hasNextPage endCursor}}}}}}");
        let data = self
            .query(&document, json!({"after":after,"filter":filter}), false)
            .await?;
        let connection = data.get("documents").ok_or_else(|| invalid("documents"))?;
        let nodes = connection
            .get("nodes")
            .and_then(Value::as_array)
            .ok_or_else(|| invalid("document list"))?;
        let documents = nodes
            .iter()
            .map(parse_summary)
            .collect::<Result<Vec<_>, _>>()?;
        let info = connection
            .get("pageInfo")
            .ok_or_else(|| invalid("pagination"))?;
        let has_next = info
            .get("hasNextPage")
            .and_then(Value::as_bool)
            .ok_or_else(|| invalid("hasNextPage"))?;
        let next_cursor = if has_next {
            Some(required_string(info, "endCursor")?)
        } else {
            None
        };
        Ok(LinearDocumentList {
            documents,
            next_cursor,
        })
    }

    /// A missing or trashed remote never deletes the local Page.
    pub async fn read(&self, id: &str) -> Result<LinearDocument, LinearSyncError> {
        validate_id(id)?;
        let document = format!("query($id:String!){{document(id:$id){{{DOCUMENT_FIELDS}}}}}");
        let data = self.query(&document, json!({"id":id}), false).await?;
        let remote = data
            .get("document")
            .filter(|value| !value.is_null())
            .ok_or(LinearSyncError::Missing)?;
        if remote.get("id").and_then(Value::as_str) != Some(id)
            && remote.get("slugId").and_then(Value::as_str) != Some(id)
        {
            return Err(invalid("document identity"));
        }
        let remote = parse_document(remote)?;
        if remote.summary.trashed {
            return Err(LinearSyncError::Missing);
        }
        Ok(remote)
    }

    /// Linear exposes no conditional update; re-read just before writing and never retry an uncertain mutation.
    pub async fn push(
        &self,
        expected: &LinearDocument,
        title: &str,
        markdown: &str,
    ) -> Result<LinearDocument, LinearSyncError> {
        if title.len() > 4096 || markdown.len() > MAX_MARKDOWN {
            return Err(LinearSyncError::Rejected(
                "The document is too large to sync.".into(),
            ));
        }
        let current = self.read(&expected.summary.id).await?;
        if current.summary.title == title && current.markdown == markdown {
            return Ok(current);
        }
        if current.summary.updated_at != expected.summary.updated_at
            || current.summary.title != expected.summary.title
            || current.markdown != expected.markdown
        {
            return Err(LinearSyncError::Conflict(current));
        }
        let document = format!("mutation($id:String!,$input:DocumentUpdateInput!){{documentUpdate(id:$id,input:$input){{success document{{{DOCUMENT_FIELDS}}}}}}}");
        let data = self
            .query(
                &document,
                json!({"id":expected.summary.id,"input":{"title":title,"content":markdown}}),
                true,
            )
            .await?;
        let result = data
            .get("documentUpdate")
            .ok_or(LinearSyncError::WriteUncertain)?;
        if result.get("success").and_then(Value::as_bool) != Some(true) {
            return Err(LinearSyncError::Rejected(
                "The document update was refused.".into(),
            ));
        }
        let remote = result
            .get("document")
            .ok_or(LinearSyncError::WriteUncertain)?;
        let saved = parse_document(remote).map_err(|_| LinearSyncError::WriteUncertain)?;
        if saved.summary.id != expected.summary.id {
            return Err(LinearSyncError::WriteUncertain);
        }
        Ok(saved)
    }

    async fn query(
        &self,
        document: &str,
        variables: Value,
        writing: bool,
    ) -> Result<Value, LinearSyncError> {
        let response = crate::http()
            .post(&self.endpoint)
            .timeout(Duration::from_secs(20))
            .header("Authorization", &self.key)
            .json(&json!({"query":document,"variables":variables}))
            .send()
            .await
            .map_err(|error| {
                if writing {
                    LinearSyncError::WriteUncertain
                } else {
                    LinearSyncError::Offline(error.to_string())
                }
            })?;
        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err(LinearSyncError::Unauthorized);
        }
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(LinearSyncError::RateLimited);
        }
        let body: Value = response.json().await.map_err(|_| {
            if writing {
                LinearSyncError::WriteUncertain
            } else {
                invalid("JSON")
            }
        })?;
        if let Some(errors) = body
            .get("errors")
            .and_then(Value::as_array)
            .filter(|errors| !errors.is_empty())
        {
            let error = &errors[0];
            let code = error
                .pointer("/extensions/code")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let message = error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Document request failed");
            return Err(match code {
                "AUTHENTICATION_ERROR" | "FORBIDDEN" | "UNAUTHENTICATED" => {
                    LinearSyncError::Unauthorized
                }
                "ENTITY_NOT_FOUND" | "NOT_FOUND" => LinearSyncError::Missing,
                "RATELIMITED" | "RATE_LIMITED" => LinearSyncError::RateLimited,
                _ if writing => LinearSyncError::WriteUncertain,
                _ => LinearSyncError::Rejected(message.to_string()),
            });
        }
        if !status.is_success() {
            return Err(if writing {
                LinearSyncError::WriteUncertain
            } else {
                LinearSyncError::Offline(format!("HTTP {status}"))
            });
        }
        body.get("data")
            .filter(|data| !data.is_null())
            .cloned()
            .ok_or_else(|| {
                if writing {
                    LinearSyncError::WriteUncertain
                } else {
                    invalid("data")
                }
            })
    }
}

fn invalid(field: &str) -> LinearSyncError {
    LinearSyncError::InvalidResponse(field.into())
}

fn required_string(value: &Value, field: &str) -> Result<String, LinearSyncError> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| invalid(field))
}

fn validate_id(id: &str) -> Result<(), LinearSyncError> {
    if id.is_empty() || id.len() > 256 || id.chars().any(char::is_control) {
        return Err(LinearSyncError::Rejected(
            "Invalid Linear document ID.".into(),
        ));
    }
    Ok(())
}

fn parse_summary(value: &Value) -> Result<LinearDocumentSummary, LinearSyncError> {
    let project = match value.get("project").filter(|value| !value.is_null()) {
        Some(project) => Some(LinearProject {
            id: required_string(project, "id")?,
            name: required_string(project, "name")?,
        }),
        None => None,
    };
    Ok(LinearDocumentSummary {
        id: required_string(value, "id")?,
        title: required_string(value, "title")?,
        url: required_string(value, "url")?,
        updated_at: required_string(value, "updatedAt")?,
        trashed: value
            .get("trashed")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        project,
    })
}

fn parse_document(value: &Value) -> Result<LinearDocument, LinearSyncError> {
    let markdown = match value.get("content") {
        Some(Value::Null) => String::new(),
        Some(Value::String(content)) => content.clone(),
        _ => return Err(invalid("content")),
    };
    if markdown.len() > MAX_MARKDOWN {
        return Err(LinearSyncError::Rejected(
            "The Linear document exceeds the Page size limit.".into(),
        ));
    }
    Ok(LinearDocument {
        summary: parse_summary(value)?,
        markdown,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    fn document(title: &str, markdown: &str, updated: &str) -> Value {
        json!({"id":"doc-a","title":title,"content":markdown,"updatedAt":updated,"url":"https://linear.app/test/document/doc-a","trashed":false,"project":null})
    }

    async fn fixture(
        replies: Vec<(u16, Value)>,
    ) -> (LinearDocuments, tokio::task::JoinHandle<Vec<Value>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            let mut requests = Vec::new();
            for (status, reply) in replies {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut received = Vec::new();
                let split;
                loop {
                    let mut buffer = [0u8; 4096];
                    let count = stream.read(&mut buffer).await.unwrap();
                    assert!(count > 0);
                    received.extend_from_slice(&buffer[..count]);
                    if let Some(at) = received.windows(4).position(|part| part == b"\r\n\r\n") {
                        split = at;
                        break;
                    }
                }
                let headers = String::from_utf8(received[..split].to_vec()).unwrap();
                assert!(headers.to_lowercase().contains("authorization: test-key"));
                let length: usize = headers
                    .lines()
                    .find_map(|line| {
                        line.to_lowercase()
                            .strip_prefix("content-length:")
                            .map(|v| v.trim().parse().unwrap())
                    })
                    .unwrap();
                while received.len() < split + 4 + length {
                    let mut buffer = [0u8; 4096];
                    let count = stream.read(&mut buffer).await.unwrap();
                    assert!(count > 0);
                    received.extend_from_slice(&buffer[..count]);
                }
                requests.push(
                    serde_json::from_slice(&received[split + 4..split + 4 + length]).unwrap(),
                );
                let body = reply.to_string();
                let response = format!("HTTP/1.1 {status} Test\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",body.len());
                stream.write_all(response.as_bytes()).await.unwrap();
            }
            requests
        });
        (
            LinearDocuments {
                key: "test-key".into(),
                endpoint: format!("http://{address}"),
            },
            task,
        )
    }

    #[test]
    fn three_way_changes_never_guess_which_divergent_version_wins() {
        let original = parse_document(&document("Title", "body", "t1")).unwrap();
        let changed = parse_document(&document("Title", "remote", "t2")).unwrap();
        assert_eq!(
            sync_action("Title", "body", "Title", "body", &original),
            SyncAction::Unchanged
        );
        assert_eq!(
            sync_action("Title", "body", "Title", "body", &changed),
            SyncAction::Pull
        );
        assert_eq!(
            sync_action("Title", "body", "New title", "body", &original),
            SyncAction::Push
        );
        assert_eq!(
            sync_action("Title", "body", "Title", "local", &changed),
            SyncAction::Conflict
        );
        assert_eq!(
            sync_action("Title", "body", "Title", "remote", &changed),
            SyncAction::Converged
        );
    }

    #[tokio::test]
    async fn push_checks_fresh_content_and_updates_only_title_and_markdown() {
        let expected = parse_document(&document("Title", "original", "t1")).unwrap();
        let saved = document("New title", "# Rich\n\n- [x] exact\n", "t2");
        let (client, task) = fixture(vec![
            (
                200,
                json!({"data":{"document":document("Title","original","t1")}}),
            ),
            (
                200,
                json!({"data":{"documentUpdate":{"success":true,"document":saved}}}),
            ),
        ])
        .await;
        let result = client
            .push(&expected, "New title", "# Rich\n\n- [x] exact\n")
            .await
            .unwrap();
        assert_eq!(result.markdown, "# Rich\n\n- [x] exact\n");
        let requests = task.await.unwrap();
        assert!(requests[0]["query"].as_str().unwrap().starts_with("query"));
        assert!(requests[1]["query"]
            .as_str()
            .unwrap()
            .starts_with("mutation"));
        assert_eq!(
            requests[1]["variables"]["input"],
            json!({"title":"New title","content":"# Rich\n\n- [x] exact\n"})
        );
    }

    #[tokio::test]
    async fn external_edit_refuses_the_mutation_and_returns_the_remote_copy() {
        let expected = parse_document(&document("Title", "original", "t1")).unwrap();
        let (client, task) = fixture(vec![(
            200,
            json!({"data":{"document":document("Title","external edit","t2")}}),
        )])
        .await;
        let error = client
            .push(&expected, "Title", "local edit")
            .await
            .unwrap_err();
        assert!(
            matches!(error,LinearSyncError::Conflict(remote) if remote.markdown=="external edit")
        );
        assert_eq!(task.await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn same_content_after_an_uncertain_write_is_idempotent() {
        let expected = parse_document(&document("Title", "original", "t1")).unwrap();
        let (client, task) = fixture(vec![(
            200,
            json!({"data":{"document":document("Title","local edit","t2")}}),
        )])
        .await;
        assert_eq!(
            client
                .push(&expected, "Title", "local edit")
                .await
                .unwrap()
                .summary
                .updated_at,
            "t2"
        );
        assert_eq!(task.await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn graphql_error_at_http_success_is_not_a_successful_read() {
        let (client,task)=fixture(vec![(200,json!({"data":null,"errors":[{"message":"No such document","extensions":{"code":"ENTITY_NOT_FOUND"}}]}))]).await;
        assert!(matches!(
            client.read("doc-a").await,
            Err(LinearSyncError::Missing)
        ));
        task.await.unwrap();
    }

    #[tokio::test]
    async fn reads_reject_a_different_document_identity_but_accept_the_exact_slug_alias() {
        let mut aliased = document("Title", "body", "t1");
        aliased["slugId"] = Value::String("known-slug".into());
        let (client, task) = fixture(vec![
            (
                200,
                json!({"data":{"document":document("Title","body","t1")}}),
            ),
            (200, json!({"data":{"document":aliased}})),
        ])
        .await;
        assert!(matches!(
            client.read("another-document").await,
            Err(LinearSyncError::InvalidResponse(_))
        ));
        assert_eq!(client.read("known-slug").await.unwrap().summary.id, "doc-a");
        task.await.unwrap();
    }

    #[tokio::test]
    async fn failed_mutation_is_uncertain_and_never_retried() {
        let expected = parse_document(&document("Title", "original", "t1")).unwrap();
        let (client, task) = fixture(vec![
            (
                200,
                json!({"data":{"document":document("Title","original","t1")}}),
            ),
            (500, json!({"error":"failed after write"})),
        ])
        .await;
        assert!(matches!(
            client.push(&expected, "Title", "local edit").await,
            Err(LinearSyncError::WriteUncertain)
        ));
        assert_eq!(task.await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn list_preserves_pagination_and_does_not_fetch_document_bodies() {
        let (client,task)=fixture(vec![(200,json!({"data":{"documents":{"nodes":[document("Title","unused","t1")],"pageInfo":{"hasNextPage":true,"endCursor":"next"}}}}))]).await;
        let list = client.list(Some("Title"), Some("previous")).await.unwrap();
        assert_eq!(list.next_cursor.as_deref(), Some("next"));
        let requests = task.await.unwrap();
        assert_eq!(requests[0]["variables"]["after"], "previous");
        assert_eq!(
            requests[0]["variables"]["filter"],
            json!({"title":{"containsIgnoreCase":"Title"}})
        );
        assert!(!requests[0]["query"].as_str().unwrap().contains(" content "));
    }

    #[tokio::test]
    async fn unauthorized_rate_limited_and_trashed_documents_are_distinct_failures() {
        let mut trashed = document("Title", "kept locally", "t1");
        trashed["trashed"] = Value::Bool(true);
        let (client, task) = fixture(vec![
            (401, json!({"errors":[{"message":"Unauthorized"}]})),
            (429, json!({"errors":[{"message":"Rate limited"}]})),
            (200, json!({"data":{"document":trashed}})),
        ])
        .await;
        assert!(matches!(
            client.read("doc-a").await,
            Err(LinearSyncError::Unauthorized)
        ));
        assert!(matches!(
            client.read("doc-a").await,
            Err(LinearSyncError::RateLimited)
        ));
        assert!(matches!(
            client.read("doc-a").await,
            Err(LinearSyncError::Missing)
        ));
        assert_eq!(task.await.unwrap().len(), 3);
    }

    #[test]
    fn missing_content_is_not_silently_converted_into_an_empty_document() {
        let mut incomplete = document("Title", "body", "t1");
        incomplete.as_object_mut().unwrap().remove("content");
        assert!(matches!(
            parse_document(&incomplete),
            Err(LinearSyncError::InvalidResponse(_))
        ));
        incomplete["content"] = Value::Null;
        assert_eq!(parse_document(&incomplete).unwrap().markdown, "");
    }
}

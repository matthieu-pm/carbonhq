//! What fills a session's context window, as the CLI itself counts it.
//!
//! `get_context_usage` is answered by the running child with no model call,
//! mid-turn included. Only that child holds the conversation, so a session
//! with no child has no breakdown and the reader keeps the total alone.

use serde::Serialize;
use serde_json::Value;
use std::{collections::HashMap, sync::Mutex};
use tokio::sync::oneshot;
use ts_rs::TS;

/// One slice of the window. `kind` is the CLI's own word — `used`, `deferred`,
/// `buffer` or `free` — kept a string so one it adds later costs nothing here.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct ContextCategory {
    pub id: String,
    pub name: String,
    pub tokens: u64,
    pub kind: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct ContextBreakdown {
    pub categories: Vec<ContextCategory>,
    /// The `used` categories summed; the buffer and deferred tools are outside it.
    pub used_tokens: u64,
    pub max_tokens: u64,
}

/// Callers waiting on a `control_response`, by the request id each minted.
/// Process-wide because the ids are unique and the read loop that delivers
/// holds no `Session`.
static WAITING: Mutex<Option<HashMap<String, oneshot::Sender<Value>>>> = Mutex::new(None);

/// Registers before the request is written, so a fast reply cannot beat it.
pub fn wait_for(request_id: &str) -> oneshot::Receiver<Value> {
    let (tx, rx) = oneshot::channel();
    let mut waiting = WAITING.lock().expect("context waiters mutex poisoned");
    waiting.get_or_insert_default().insert(request_id.to_string(), tx);
    rx
}

/// Drops a waiter whose reply never came, or the map grows by one per dead child.
pub fn forget(request_id: &str) {
    if let Some(waiting) = WAITING.lock().expect("context waiters mutex poisoned").as_mut() {
        waiting.remove(request_id);
    }
}

/// Hands a `control_response` to whoever asked. Most are acks nobody waits on.
pub fn deliver(response: &Value) {
    let Some(id) = response["request_id"].as_str() else { return };
    let waiter = WAITING
        .lock()
        .expect("context waiters mutex poisoned")
        .as_mut()
        .and_then(|waiting| waiting.remove(id));
    if let Some(tx) = waiter {
        let _ = tx.send(response.clone());
    }
}

/// Reads the reply field by field: an odd category costs that row, never the
/// answer. `None` for an error reply or one with no window size.
pub fn parse(response: &Value) -> Option<ContextBreakdown> {
    if response["subtype"] != "success" {
        return None;
    }
    let body = &response["response"];
    let categories = body["categories"]
        .as_array()?
        .iter()
        .filter_map(|category| {
            let kind = match category["kind"].as_str() {
                Some(kind) => kind,
                None if category["isDeferred"] == true => "deferred",
                None => "used",
            };
            Some(ContextCategory {
                id: category["id"].as_str()?.to_string(),
                name: category["name"].as_str()?.to_string(),
                tokens: category["tokens"].as_u64()?,
                kind: kind.to_string(),
            })
        })
        .collect();

    Some(ContextBreakdown {
        categories,
        used_tokens: body["totalTokens"].as_u64()?,
        max_tokens: body["maxTokens"].as_u64().filter(|max| *max > 0)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const CAPTURE: &str = include_str!("fixtures/context_usage.jsonl");

    fn capture() -> Value {
        serde_json::from_str::<Value>(CAPTURE.trim()).unwrap()["response"].clone()
    }

    #[test]
    fn parses_the_captured_reply() {
        let breakdown = parse(&capture()).unwrap();

        assert_eq!(breakdown.max_tokens, 1_000_000);
        assert_eq!(breakdown.used_tokens, 52_717);
        assert_eq!(breakdown.categories.len(), 9);
        let used: u64 = breakdown.categories.iter().filter(|c| c.kind == "used").map(|c| c.tokens).sum();
        assert_eq!(used, breakdown.used_tokens);
        let deferred = breakdown.categories.iter().find(|c| c.kind == "deferred").unwrap();
        assert_eq!((deferred.id.as_str(), deferred.tokens), ("system_tools_deferred", 20_453));
    }

    #[test]
    fn an_odd_category_costs_one_row() {
        let mut reply = capture();
        reply["response"]["categories"][0]["tokens"] = json!("many");

        assert_eq!(parse(&reply).unwrap().categories.len(), 8);
    }

    #[test]
    fn an_error_reply_is_no_breakdown() {
        assert_eq!(parse(&json!({"subtype": "error", "request_id": "r", "error": "nope"})), None);
    }

    #[tokio::test]
    async fn a_reply_reaches_only_its_asker() {
        let mine = wait_for("ctx-mine");
        let other = wait_for("ctx-other");

        deliver(&json!({"subtype": "success", "request_id": "ctx-mine", "response": {}}));

        assert_eq!(mine.await.unwrap()["request_id"], "ctx-mine");
        forget("ctx-other");
        assert!(other.await.is_err());
    }
}

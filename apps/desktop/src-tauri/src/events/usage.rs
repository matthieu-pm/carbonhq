//! Token and cost accounting.
//!
//! The harnesses report disjoint things — Claude Code gives cost in USD, Codex
//! never does — so nearly every field is optional. Show cost only when [`Usage::cost_usd`] is set and a
//! context gauge only when [`Usage::context_window`] is set; neither is
//! universal.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::harness::Harness;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cached_input_tokens: Option<u64>,
    pub cache_write_tokens: Option<u64>,
    /// Broken out only by harnesses that report it separately; others fold
    /// thinking tokens into `output_tokens`.
    pub reasoning_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
    pub cost_usd: Option<f64>,
    pub context_window: Option<ContextWindow>,
    pub model: Option<String>,
    /// Session-cumulative consumption, split by model. Empty on every harness
    /// and every event that doesn't report one. See [`ModelUsage`].
    #[serde(default)]
    pub per_model: Vec<ModelUsage>,
}

/// What one model has consumed **for the session so far** — cumulative and
/// monotonic across turns, not a per-turn figure. Per child, in practice: the
/// reading starts again from zero after a respawn, which [`spent_tokens`]
/// allows for.
///
/// That is the whole reason it is carried and persisted. [`Usage`]'s own counts
/// are the harness's per-turn sum over every main-thread message, which double
/// counts a context re-read once per tool call and so describes neither the turn
/// nor the context. Here a turn's real consumption is the difference between
/// consecutive readings.
///
/// Every field is optional and the harness's own map is left untyped upstream:
/// this rides `turn_completed`, and a `result` line that fails to parse strands
/// the session on `in_progress`. A shape we don't recognize must cost this
/// struct a field, never the line.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    /// The harness's own key — a dated id (`claude-haiku-4-5-20251001`), not the
    /// alias a session was started with.
    pub model: String,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cached_input_tokens: Option<u64>,
    pub cache_write_tokens: Option<u64>,
    pub web_search_requests: Option<u64>,
    pub cost_usd: Option<f64>,
    /// This model's context window. Also what the composer's gauge measures
    /// against — see `context_window` in the Claude Code mapper.
    pub context_window: Option<u64>,
    pub max_output_tokens: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct ContextWindow {
    pub used_tokens: u64,
    pub max_tokens: u64,
}

/// Tokens a session has spent, read off its log: new input plus output, summed
/// over every `turn_completed` at or after `since`.
///
/// **Input read back from a cache is left out.** An agentic turn re-reads its
/// whole context once per tool call, so counting those reads reports the
/// context multiplied by the steps — the same inflation `result.usage` has as a
/// context reading.
///
/// `since` is the session's own `created`. A fork's log opens with a copy of
/// its parent's turns, and counted they would be spent twice; they are still
/// *read*, since a cumulative reading only means something against the one
/// before it.
///
/// Two shapes of turn. Where `per_model` is filled the reading is cumulative,
/// so a turn is the difference from the last one — and a reading *below* the
/// last is a new child counting from zero, measured after an effort respawn,
/// so it is taken whole. Everywhere else the turn's own counts are its spend.
/// A turn that reports neither adds nothing. Codex's thread total rides the
/// first shape, under one fixed key — see its mapper.
///
/// Lenient like every reader of the log: a line that will not parse is skipped.
pub fn spent_tokens(log: &str, since: &str) -> u64 {
    #[derive(Deserialize)]
    struct Line {
        harness: Harness,
        ts: String,
        payload: Payload,
    }
    #[derive(Deserialize)]
    struct Payload {
        #[serde(rename = "type")]
        kind: String,
        usage: Option<Usage>,
    }

    let since = chrono::DateTime::parse_from_rfc3339(since).ok();
    let mut last: HashMap<String, u64> = HashMap::new();
    let mut total = 0u64;

    // Most of a log is tool output; the substring spares parsing it.
    for line in log.lines().filter(|l| l.contains("\"turn_completed\"")) {
        let Ok(Line { harness, ts, payload }) = serde_json::from_str::<Line>(line) else {
            continue;
        };
        let (true, Some(usage)) = (payload.kind == "turn_completed", payload.usage) else {
            continue;
        };

        let spent = if usage.per_model.is_empty() {
            let input = usage.input_tokens.unwrap_or(0);
            // xAI counts cached input inside input, where the rest report it beside.
            let cached = match harness {
                Harness::Grok => usage.cached_input_tokens.unwrap_or(0),
                _ => 0,
            };
            fresh(Some(input.saturating_sub(cached)), usage.cache_write_tokens, usage.output_tokens)
        } else {
            usage
                .per_model
                .iter()
                .map(|m| {
                    let now = fresh(m.input_tokens, m.cache_write_tokens, m.output_tokens);
                    let before = last.insert(m.model.clone(), now).unwrap_or(0);
                    if now >= before { now - before } else { now }
                })
                .sum()
        };

        let copied = match (since, chrono::DateTime::parse_from_rfc3339(&ts).ok()) {
            (Some(since), Some(at)) => at < since,
            _ => false,
        };
        if !copied {
            total += spent;
        }
    }
    total
}

fn fresh(input: Option<u64>, cache_write: Option<u64>, output: Option<u64>) -> u64 {
    input.unwrap_or(0) + cache_write.unwrap_or(0) + output.unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(harness: &str, ts: &str, usage: serde_json::Value) -> String {
        serde_json::json!({
            "id": "e", "sessionId": "s", "harness": harness, "seq": 1, "ts": ts,
            "turnId": null, "subagent": null,
            "payload": { "type": "turn_completed", "status": "success", "usage": usage },
        })
        .to_string()
    }

    fn model(name: &str, input: u64, write: u64, read: u64, output: u64) -> serde_json::Value {
        serde_json::json!({
            "model": name, "inputTokens": input, "cacheWriteTokens": write,
            "cachedInputTokens": read, "outputTokens": output,
        })
    }

    const START: &str = "2026-11-01T00:00:00Z";

    #[test]
    fn a_cumulative_reading_counts_only_what_it_added() {
        let log = [
            turn("claude_code", "2026-11-01T01:00:00Z", serde_json::json!({ "perModel": [model("opus", 10, 100, 9000, 50)] })),
            turn("claude_code", "2026-11-01T02:00:00Z", serde_json::json!({ "perModel": [model("opus", 15, 300, 50000, 85), model("haiku", 1, 0, 0, 4)] })),
        ]
        .join("\n");
        // 160, then 240 more on opus and 5 on a second model; no cache reads.
        assert_eq!(spent_tokens(&log, START), 405);
    }

    #[test]
    fn a_reading_below_the_last_is_a_new_child_and_counts_whole() {
        let log = [
            turn("claude_code", "2026-11-01T01:00:00Z", serde_json::json!({ "perModel": [model("opus", 0, 0, 0, 900)] })),
            turn("claude_code", "2026-11-01T02:00:00Z", serde_json::json!({ "perModel": [model("opus", 0, 0, 0, 200)] })),
        ]
        .join("\n");
        assert_eq!(spent_tokens(&log, START), 1100);
    }

    #[test]
    fn a_turn_without_per_model_spends_its_own_counts() {
        let log = [
            turn("fx", "2026-11-01T01:00:00Z", serde_json::json!({ "inputTokens": 100, "cacheWriteTokens": 20, "cachedInputTokens": 5000, "outputTokens": 30 })),
            // grok's input already holds its cached share.
            turn("grok", "2026-11-01T02:00:00Z", serde_json::json!({ "inputTokens": 1000, "cachedInputTokens": 900, "outputTokens": 10 })),
            // A turn closed with a context reading and no counts spends nothing.
            turn("codex", "2026-11-01T03:00:00Z", serde_json::json!({ "contextWindow": { "usedTokens": 5, "maxTokens": 10 } })),
        ]
        .join("\n");
        assert_eq!(spent_tokens(&log, START), 150 + 110);
    }

    #[test]
    fn a_forks_copied_turns_are_read_and_not_counted() {
        let log = [
            turn("claude_code", "2026-10-31T23:00:00Z", serde_json::json!({ "perModel": [model("opus", 0, 0, 0, 500)] })),
            turn("claude_code", "2026-11-01T01:00:00Z", serde_json::json!({ "perModel": [model("opus", 0, 0, 0, 800)] })),
        ]
        .join("\n");
        assert_eq!(spent_tokens(&log, START), 300);
    }

    #[test]
    fn a_line_that_will_not_parse_costs_only_itself() {
        let log = format!(
            "{}\n{{\"payload\":{{\"type\":\"turn_completed\"}},\"harness\":7}}\nnot json \"turn_completed\"",
            turn("fx", "2026-11-01T01:00:00Z", serde_json::json!({ "outputTokens": 7 })),
        );
        assert_eq!(spent_tokens(&log, START), 7);
    }
}

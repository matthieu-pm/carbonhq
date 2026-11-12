//! Codex's own session files, read for one figure: what a thread has spent.
//!
//! Carbon's log only carries a Codex thread's running total from the build
//! that started stashing it, so a session last touched before that reads as
//! having spent nothing. Codex wrote the same total to its rollout all along.
//! **This is not a parser for the rollout** — that file is a replay log and no
//! contract — so it reads one field, leniently, and answers `None` for
//! anything it does not recognise.

use std::{
    collections::HashMap,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};

use serde::Deserialize;

/// Every rollout under Codex's home, by thread id. A thread's file is
/// `rollout-<started>-<thread id>.jsonl`, under `sessions/<y>/<m>/<d>/` or,
/// once Codex archives it, `archived_sessions/`.
pub fn rollouts() -> HashMap<String, PathBuf> {
    let Some(home) = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::home_dir().map(|h| h.join(".codex")))
    else {
        return HashMap::new();
    };

    let mut found = HashMap::new();
    for root in ["sessions", "archived_sessions"] {
        collect(&home.join(root), 4, &mut found);
    }
    found
}

fn collect(dir: &Path, depth: u8, found: &mut HashMap<String, PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if depth > 0 {
                collect(&path, depth - 1, found);
            }
        } else if let Some(id) = thread_id_of(&path) {
            found.insert(id, path);
        }
    }
}

/// The thread id a rollout's name ends in: a UUID, so the last 36 characters.
fn thread_id_of(path: &Path) -> Option<String> {
    let stem = path.file_name()?.to_str()?.strip_suffix(".jsonl")?;
    let id = stem.get(stem.len().checked_sub(36)?..)?;
    (stem.starts_with("rollout-") && id.len() == 36).then(|| id.to_string())
}

/// What the thread in this rollout has spent: new input plus output, off its
/// newest `token_count`.
///
/// Read from the end, a chunk at a time. The total is cumulative, so the last
/// reading is the answer, and a rollout runs past 100MB.
pub fn spend(path: &Path) -> Option<u64> {
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();

    let mut take = 256 * 1024;
    loop {
        let start = len.saturating_sub(take);
        file.seek(SeekFrom::Start(start)).ok()?;
        let mut tail = Vec::new();
        file.read_to_end(&mut tail).ok()?;
        // A chunk can open mid-line or mid-character; that first line is not read.
        let tail = String::from_utf8_lossy(&tail);
        let whole = if start == 0 { &tail[..] } else { tail.split_once('\n').map_or("", |(_, rest)| rest) };
        if let Some(spent) = newest_spend(whole) {
            return Some(spent);
        }
        if start == 0 {
            return None;
        }
        take *= 16;
    }
}

/// The newest `token_count` in these lines that carries a total.
fn newest_spend(lines: &str) -> Option<u64> {
    #[derive(Deserialize)]
    struct Line {
        payload: Payload,
    }
    #[derive(Deserialize)]
    struct Payload {
        info: Option<Info>,
    }
    #[derive(Deserialize)]
    struct Info {
        total_token_usage: Option<Total>,
    }
    #[derive(Deserialize)]
    struct Total {
        #[serde(default)]
        input_tokens: u64,
        #[serde(default)]
        cached_input_tokens: u64,
        #[serde(default)]
        output_tokens: u64,
    }

    lines
        .lines()
        .rev()
        .filter(|line| line.contains("\"token_count\""))
        // A `token_count` with no `info` carries rate limits alone.
        .find_map(|line| serde_json::from_str::<Line>(line).ok()?.payload.info?.total_token_usage)
        .map(|t| t.input_tokens.saturating_sub(t.cached_input_tokens) + t.output_tokens)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The line as Codex wrote it, trimmed of `last_token_usage` and the rate
    /// limits beside it.
    const COUNT: &str = r#"{"timestamp":"2026-11-04T10:43:45.632Z","ordinal":142,"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1320117,"cached_input_tokens":1243392,"cache_write_input_tokens":0,"output_tokens":2820,"reasoning_output_tokens":320,"total_tokens":1322937}}}}"#;

    #[test]
    fn the_newest_total_is_new_input_plus_output() {
        let older = COUNT.replace("1320117", "1300000");
        let limits_only = r#"{"type":"event_msg","payload":{"type":"token_count","info":null}}"#;
        let log = format!("{older}\n{COUNT}\n{limits_only}\nnot json \"token_count\"\n");
        assert_eq!(newest_spend(&log), Some(1320117 - 1243392 + 2820));
        assert_eq!(newest_spend("{\"type\":\"event_msg\"}\n"), None);
    }

    #[test]
    fn a_rollout_is_filed_under_the_uuid_its_name_ends_in() {
        let path = Path::new("/x/rollout-2026-11-04T11-41-08-01a1a625-f75b-7e52-87f3-39d2c07e4e5c.jsonl");
        assert_eq!(thread_id_of(path).as_deref(), Some("01a1a625-f75b-7e52-87f3-39d2c07e4e5c"));
        assert_eq!(thread_id_of(Path::new("/x/notes.jsonl")), None);
    }

    #[test]
    fn a_total_far_from_the_end_is_still_found() {
        let dir = std::env::temp_dir().join(format!("carbon-rollout-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("rollout-x.jsonl");
        // Past the first chunk, and opening it mid-line.
        let filler = format!("{{\"pad\":\"{}\"}}\n", "é".repeat(4000)).repeat(60);
        std::fs::write(&path, format!("{COUNT}\n{filler}")).unwrap();
        assert_eq!(spend(&path), Some(79545));
        std::fs::remove_dir_all(dir).ok();
    }
}

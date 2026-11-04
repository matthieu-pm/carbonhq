//! Subscription allowances come from each CLI's account query, never session token totals.

use crate::harness::{codex, grok, Harness};
use anyhow::{bail, Context, Result};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    process::Stdio,
    sync::LazyLock,
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::Mutex,
};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionWindow {
    pub label: String,
    pub remaining_percent: f64,
    pub resets_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionUsage {
    pub harness: Harness,
    pub plan: Option<String>,
    pub windows: Vec<SubscriptionWindow>,
    pub checked_at: String,
    pub unavailable_reason: Option<String>,
}

static CACHE: LazyLock<Mutex<Option<(Instant, Vec<SubscriptionUsage>)>>> =
    LazyLock::new(|| Mutex::new(None));

/// Coalesces account probes across windows and bounds refresh clicks to one batch per five seconds.
pub async fn subscription_usage(refresh: Option<bool>) -> Vec<SubscriptionUsage> {
    let mut cache = CACHE.lock().await;
    let ttl = Duration::from_secs(if refresh.unwrap_or(false) { 5 } else { 60 });
    if let Some((_, rows)) = cache.as_ref().filter(|(at, _)| at.elapsed() < ttl) {
        return rows.clone();
    }
    let (codex, claude, grok) = tokio::join!(
        read(Harness::Codex),
        read(Harness::ClaudeCode),
        read(Harness::Grok),
    );
    let rows = vec![codex, claude, grok];
    *cache = Some((Instant::now(), rows.clone()));
    rows
}

async fn read(harness: Harness) -> SubscriptionUsage {
    let mut row = SubscriptionUsage {
        harness,
        plan: None,
        windows: vec![],
        checked_at: chrono::Utc::now().to_rfc3339(),
        unavailable_reason: None,
    };
    if !crate::binpath::agent_available(harness).await {
        row.unavailable_reason = Some(format!(
            "{} is not installed on this machine.",
            harness.label()
        ));
        return row;
    }
    let answer = match harness {
        Harness::Codex => codex::probe::ask(None, "account/rateLimits/read", Value::Null).await,
        Harness::ClaudeCode | Harness::Grok => query(harness).await,
        _ => unreachable!(),
    };
    row.checked_at = chrono::Utc::now().to_rfc3339();
    match answer {
        Ok(value) => {
            let (plan, windows) = normalize(harness, &value);
            row.plan = plan;
            row.windows = windows;
            if row.windows.is_empty() {
                row.unavailable_reason = Some(
                    "No subscription allowance reported. Check your sign-in method in Accounts."
                        .into(),
                );
            }
        }
        Err(_) => {
            row.unavailable_reason = Some(
                "Couldn't read usage. Check your connection and sign-in in Accounts, then refresh."
                    .into(),
            )
        }
    }
    row
}

/// Only control requests are sent: no session is opened and no prompt reaches a model.
async fn query(harness: Harness) -> Result<Value> {
    let bin = crate::binpath::agent_binary(harness).await;
    let mut command = Command::new(&bin);
    command.current_dir(std::env::home_dir().context("no home directory")?);
    match harness {
        Harness::ClaudeCode => {
            command.args([
                "-p",
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--verbose",
                "--no-session-persistence",
            ]);
            command.env("PATH", crate::harness::agent_path(&bin));
        }
        Harness::Grok => {
            command.args(["agent", "--no-leader", "stdio"]);
            grok::probe::child_env(&mut command, &bin);
        }
        _ => unreachable!(),
    }
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()?;
    let mut stdin = child.stdin.take().context("no stdin")?;
    let mut lines = BufReader::new(child.stdout.take().context("no stdout")?).lines();
    let answer = tokio::time::timeout(Duration::from_secs(20), async {
        let requests = if harness == Harness::ClaudeCode {
            vec![
                json!({"type":"control_request","request_id":"init","request":{"subtype":"initialize"}}),
                json!({"type":"control_request","request_id":"usage","request":{"subtype":"get_usage","skip_behaviors":true}}),
            ]
        } else {
            vec![
                json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":grok::probe::handshake_params()}),
                json!({"jsonrpc":"2.0","id":2,"method":"_x.ai/billing","params":{}}),
            ]
        };
        let mut answer = Value::Null;
        for request in requests {
            stdin.write_all(format!("{request}\n").as_bytes()).await?;
            stdin.flush().await?;
            loop {
                let line = lines.next_line().await?.context("CLI exited before answering")?;
                let Ok(value) = serde_json::from_str::<Value>(&line) else { continue; };
                if harness == Harness::ClaudeCode {
                    let response = &value["response"];
                    if value["type"] != "control_response" || response["request_id"] != request["request_id"] { continue; }
                    if response["subtype"] != "success" { bail!("usage query refused"); }
                    answer = response["response"].clone();
                } else {
                    if value["id"] != request["id"] { continue; }
                    if value.get("error").is_some() { bail!("usage query refused"); }
                    answer = value.get("result").cloned().context("no query result")?;
                }
                break;
            }
        }
        Ok::<_, anyhow::Error>(answer)
    }).await;
    if let Some(root) = child.id() {
        crate::local_servers::kill_descendants(root).await;
    }
    let _ = child.kill().await;
    answer.context("usage query timed out")?
}

fn window(label: String, used: &Value, reset: &Value) -> Option<SubscriptionWindow> {
    let used = used.as_f64().filter(|v| v.is_finite() && *v >= 0.0)?;
    let resets_at = reset
        .as_str()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|t| t.to_utc().to_rfc3339())
        .or_else(|| {
            reset
                .as_i64()
                .and_then(|t| chrono::DateTime::from_timestamp(t, 0))
                .map(|t| t.to_rfc3339())
        });
    Some(SubscriptionWindow {
        label,
        remaining_percent: (100.0 - used).clamp(0.0, 100.0),
        resets_at,
    })
}

/// An absent or unfamiliar percentage is unknown, never a full allowance.
fn normalize(harness: Harness, value: &Value) -> (Option<String>, Vec<SubscriptionWindow>) {
    let mut windows = vec![];
    let plan = match harness {
        Harness::Codex => {
            let limits = &value["rateLimits"];
            for key in ["primary", "secondary"] {
                let item = &limits[key];
                let label = match item["windowDurationMins"].as_u64() {
                    Some(300) => "5 hours".into(),
                    Some(10080) => "Weekly".into(),
                    Some(minutes) if minutes % 60 == 0 => format!("{} hours", minutes / 60),
                    Some(minutes) => format!("{minutes} minutes"),
                    None => if key == "primary" {
                        "Primary"
                    } else {
                        "Secondary"
                    }
                    .into(),
                };
                windows.extend(window(label, &item["usedPercent"], &item["resetsAt"]));
            }
            limits["planType"].as_str()
        }
        Harness::ClaudeCode => {
            if value["rate_limits_available"] == true {
                let limits = &value["rate_limits"];
                for (key, label) in [
                    ("five_hour", "5 hours"),
                    ("seven_day", "Weekly"),
                    ("seven_day_opus", "Weekly · Opus"),
                    ("seven_day_sonnet", "Weekly · Sonnet"),
                    ("seven_day_oauth_apps", "Weekly · OAuth apps"),
                ] {
                    windows.extend(window(
                        label.into(),
                        &limits[key]["utilization"],
                        &limits[key]["resets_at"],
                    ));
                }
            }
            value["subscription_type"].as_str()
        }
        Harness::Grok => {
            let config = &value["config"];
            let label = match config["currentPeriod"]["type"].as_str() {
                Some("USAGE_PERIOD_TYPE_WEEKLY") => "Weekly",
                Some("USAGE_PERIOD_TYPE_MONTHLY") => "Monthly",
                _ => "Current period",
            };
            windows.extend(window(
                label.into(),
                &config["creditUsagePercent"],
                &config["currentPeriod"]["end"],
            ));
            value["subscription_tier"].as_str()
        }
        _ => None,
    };
    (plan.map(str::to_owned), windows)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_weekly_only_and_two_windows_keep_their_real_durations() {
        let (_, rows) = normalize(
            Harness::Codex,
            &json!({"rateLimits":{"primary":{"usedPercent":6,"windowDurationMins":10080,"resetsAt":1794393675},"secondary":null}}),
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].remaining_percent, 94.0);
        assert_eq!(rows[0].label, "Weekly");
        assert!(rows[0].resets_at.is_some());
        let (_, rows) = normalize(
            Harness::Codex,
            &json!({"rateLimits":{"primary":{"usedPercent":95,"windowDurationMins":300},"secondary":{"usedPercent":20,"windowDurationMins":10080}}}),
        );
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].label, "5 hours");
    }

    #[test]
    fn claude_null_buckets_and_paid_extra_usage_are_not_subscription_allowance() {
        let (_, rows) = normalize(
            Harness::ClaudeCode,
            &json!({"rate_limits_available":true,"rate_limits":{"five_hour":{"utilization":32},"seven_day":{"utilization":10},"seven_day_opus":null,"extra_usage":{"utilization":99}}}),
        );
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].remaining_percent, 68.0);
        assert!(
            normalize(Harness::ClaudeCode, &json!({"rate_limits_available":false}))
                .1
                .is_empty()
        );
    }

    #[test]
    fn grok_reads_the_account_allowance_and_period() {
        let (plan, rows) = normalize(
            Harness::Grok,
            &json!({"subscription_tier":"SuperGrok Plus","config":{"creditUsagePercent":42,"currentPeriod":{"type":"USAGE_PERIOD_TYPE_WEEKLY","end":"2026-11-06T17:01:04.918+00:00"}}}),
        );
        assert_eq!(plan.as_deref(), Some("SuperGrok Plus"));
        assert_eq!(rows[0].remaining_percent, 58.0);
        assert_eq!(rows[0].label, "Weekly");
    }

    #[test]
    fn missing_and_invalid_values_never_invent_available_usage() {
        for harness in [Harness::Codex, Harness::ClaudeCode, Harness::Grok] {
            assert!(normalize(harness, &json!({})).1.is_empty());
        }
        assert!(window("x".into(), &json!(-1), &Value::Null).is_none());
        assert!(window("x".into(), &json!("42"), &Value::Null).is_none());
        assert_eq!(
            window("x".into(), &json!(140), &Value::Null)
                .unwrap()
                .remaining_percent,
            0.0
        );
    }

    #[tokio::test]
    #[ignore = "reads the installed CLIs and signed-in accounts"]
    async fn live_subscription_usage() {
        let rows = subscription_usage(Some(true)).await;
        for row in rows {
            println!(
                "{}: {} windows, {}",
                row.harness.label(),
                row.windows.len(),
                row.unavailable_reason.as_deref().unwrap_or("available")
            );
            assert!(
                !row.windows.is_empty(),
                "{} returned no allowance",
                row.harness.label()
            );
        }
    }
}

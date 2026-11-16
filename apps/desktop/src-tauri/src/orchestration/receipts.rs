use anyhow::{bail, Context, Result};
use carbon_proto::{OperationReceipt, Response};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{future::Future, path::Path};

#[derive(Debug)]
pub(super) struct SubmissionStarted;

impl std::fmt::Display for SubmissionStarted {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("submission may have started")
    }
}

#[derive(Serialize, Deserialize)]
struct Record {
    version: u32,
    fingerprint: String,
    receipt: OperationReceipt,
    response: Option<Response>,
    error: Option<String>,
}

/// Hash the caller's original payload before forwarding rewrites paths or refs.
pub(super) fn fingerprint(value: &impl Serialize) -> Result<String> {
    Ok(hash(&serde_json::to_vec(&canonical(
        serde_json::to_value(value)?,
    ))?))
}

/// Null optionals and object field order must not change a key across compatible builds.
fn canonical(value: serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(fields) => {
            let sorted: std::collections::BTreeMap<_, _> = fields
                .into_iter()
                .filter(|(key, value)| !value.is_null() && key != "requestId")
                .map(|(key, value)| (key, canonical(value)))
                .collect();
            serde_json::Value::Object(sorted.into_iter().collect())
        }
        serde_json::Value::Array(items) => {
            serde_json::Value::Array(items.into_iter().map(canonical).collect())
        }
        other => other,
    }
}

/// A stable forwarding origin keeps terminal callers on different servers in separate namespaces.
pub(super) async fn origin(home: &Path) -> Result<String> {
    let home = home.to_owned();
    tokio::task::spawn_blocking(move || -> Result<String> {
        use std::os::unix::fs::OpenOptionsExt;
        let file = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .mode(0o600)
            .open(home.join("orchestration-origin.lock"))?;
        file.lock()?;
        let path = home.join("orchestration-origin");
        match std::fs::read_to_string(&path) {
            Ok(origin) => {
                uuid::Uuid::parse_str(&origin)
                    .context("forwarding identity is corrupt; restore it before retrying")?;
                Ok(origin)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let origin = uuid::Uuid::now_v7().to_string();
                crate::store::write_private_atomic(&path, origin.as_bytes())?;
                std::fs::File::open(home)?.sync_all()?;
                Ok(origin)
            }
            Err(error) => Err(error.into()),
        }
    })
    .await?
}

pub(super) fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn uncertain(receipt: OperationReceipt, message: impl Into<String>) -> Response {
    Response::Uncertain {
        receipt,
        message: message.into(),
    }
}

/// A read-only probe must share the execution lock and never reserve missing work.
pub(super) async fn lookup(
    root: &Path,
    request_id: &str,
    fingerprint: &str,
) -> Result<Option<Response>> {
    let (path, _lock) = locked_path(root, request_id).await?;
    read_record(&path, request_id, fingerprint).await
}

/// Scope each wait to its own request, leaving workers free to persist the owner’s reply.
pub(super) async fn locked_path(
    root: &Path,
    request_id: &str,
) -> Result<(std::path::PathBuf, std::sync::Arc<std::fs::File>)> {
    if request_id.trim().is_empty()
        || request_id.len() > 256
        || request_id.chars().any(char::is_control)
    {
        bail!("request ID must contain 1–256 bytes and no control characters");
    }
    tokio::fs::create_dir_all(root)
        .await
        .context("could not create request receipt directory")?;
    let key = hash(request_id.as_bytes());
    let path = root.join(format!("{key}.json"));
    let lock_path = root.join(format!("{key}.lock"));
    let lock = tokio::task::spawn_blocking(move || -> Result<_> {
        use std::os::unix::fs::OpenOptionsExt;
        let file = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .mode(0o600)
            .open(lock_path)?;
        Ok(std::sync::Arc::new(file))
    })
    .await??;
    // Waiters must leave blocking workers free for the lock owner's receipt writes.
    loop {
        if unsafe {
            libc::flock(
                std::os::fd::AsRawFd::as_raw_fd(lock.as_ref()),
                libc::LOCK_EX | libc::LOCK_NB,
            )
        } == 0
        {
            break;
        }
        let error = std::io::Error::last_os_error();
        if error.kind() != std::io::ErrorKind::WouldBlock {
            return Err(error).context("could not lock request receipt");
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }

    Ok((path, lock))
}

/// A missing record is distinct from unreadable or conflicting state, which must fail closed.
async fn read_record(path: &Path, request_id: &str, fingerprint: &str) -> Result<Option<Response>> {
    match tokio::fs::read(&path).await {
        Ok(bytes) => {
            let record: Record =
                serde_json::from_slice(&bytes).context("could not read request receipt")?;
            if record.version != 1 {
                bail!("request receipt uses an unsupported version; update Carbon");
            }
            if record.fingerprint != fingerprint || record.receipt.request_id != request_id {
                bail!("request ID {request_id:?} was already used with a different payload");
            }
            return Ok(Some(match record.response {
                Some(response) => Response::Recorded {
                    receipt: record.receipt,
                    response: Box::new(response),
                },
                None => uncertain(
                    record.receipt,
                    record.error.unwrap_or_else(|| {
                        "The previous attempt ended before its outcome was recorded.".into()
                    }),
                ),
            }));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error).context("could not read request receipt"),
    }
}

/// The reservation outlives cancellation or process loss, so unfinished work is never submitted twice.
pub(super) async fn execute<F, Fut>(
    root: &Path,
    request_id: &str,
    fingerprint: String,
    target: Option<&str>,
    action: F,
) -> Result<Response>
where
    F: FnOnce(OperationReceipt) -> Fut,
    Fut: Future<Output = Result<Response>>,
{
    let (path, lock) = locked_path(root, request_id).await?;
    if let Some(response) = read_record(&path, request_id, &fingerprint).await? {
        return Ok(response);
    }

    let session_id = target
        .map(str::to_owned)
        .unwrap_or_else(|| uuid::Uuid::now_v7().to_string());
    let receipt = OperationReceipt {
        request_id: request_id.to_string(),
        operation_id: uuid::Uuid::now_v7().to_string(),
        worktree_name: target.is_none().then(|| format!("request-{session_id}")),
        session_id,
    };
    let mut record = Record {
        version: 1,
        fingerprint,
        receipt: receipt.clone(),
        response: None,
        error: None,
    };
    save(&path, &record, lock.clone()).await?;

    match action(receipt.clone()).await {
        Ok(response) => record.response = Some(response),
        Err(error) if error.is::<SubmissionStarted>() => {
            record.error = Some(format!("The attempt did not complete: {error:#}"))
        }
        Err(error) => record.response = Some(Response::error(format!("{error:#}"))),
    }
    if let Err(error) = save(&path, &record, lock.clone()).await {
        return Ok(uncertain(
            receipt,
            format!("Could not record the outcome: {error:#}"),
        ));
    }
    Ok(match record.response {
        Some(response) => Response::Recorded {
            receipt,
            response: Box::new(response),
        },
        None => uncertain(receipt, record.error.unwrap_or_default()),
    })
}

/// Sync the renamed receipt's directory before a provider or worktree may be touched.
async fn save(path: &Path, record: &Record, lock: std::sync::Arc<std::fs::File>) -> Result<()> {
    let path = path.to_owned();
    let bytes = serde_json::to_vec(record)?;
    tokio::task::spawn_blocking(move || -> Result<()> {
        let _lock = lock;
        crate::store::write_private_atomic(&path, &bytes)?;
        std::fs::File::open(path.parent().context("receipt has no parent directory")?)?
            .sync_all()?;
        Ok(())
    })
    .await?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        path::PathBuf,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        },
    };

    struct Home(PathBuf);

    impl Home {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!("carbon-receipts-{}", uuid::Uuid::now_v7())))
        }
    }

    impl Drop for Home {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn wire(response: Response) -> serde_json::Value {
        serde_json::to_value(response).unwrap()
    }

    #[tokio::test]
    async fn a_lookup_miss_does_not_reserve_and_conflicts_fail_closed() {
        let home = Home::new();
        assert!(lookup(&home.0, "key", "payload").await.unwrap().is_none());
        let completed = execute(&home.0, "key", "payload".into(), None, |_| async {
            Ok(Response::Sent { queued: false })
        })
        .await
        .unwrap();
        assert_eq!(
            wire(lookup(&home.0, "key", "payload").await.unwrap().unwrap()),
            wire(completed)
        );
        assert!(lookup(&home.0, "key", "changed")
            .await
            .unwrap_err()
            .to_string()
            .contains("different payload"));
        std::fs::write(home.0.join(format!("{}.json", hash(b"key"))), b"{").unwrap();
        assert!(lookup(&home.0, "key", "payload").await.is_err());
    }

    #[tokio::test]
    async fn a_lookup_waits_for_the_running_operation_to_record_its_reply() {
        let home = Home::new();
        let root = home.0.clone();
        let (started, waiting) = tokio::sync::oneshot::channel();
        let (finish, released) = tokio::sync::oneshot::channel();
        let running = tokio::spawn(async move {
            execute(&root, "key", "payload".into(), None, |_| async move {
                started.send(()).unwrap();
                released.await.unwrap();
                Ok(Response::Sent { queued: true })
            })
            .await
            .unwrap()
        });
        waiting.await.unwrap();
        let query = lookup(&home.0, "key", "payload");
        tokio::pin!(query);
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(30), &mut query)
                .await
                .is_err()
        );
        finish.send(()).unwrap();
        let expected = running.await.unwrap();
        assert_eq!(wire(query.await.unwrap().unwrap()), wire(expected));
    }

    #[tokio::test]
    async fn concurrent_retries_return_one_receipt_and_run_one_action() {
        let home = Home::new();
        let count = Arc::new(AtomicUsize::new(0));
        let mut tasks = Vec::new();
        for _ in 0..12 {
            let root = home.0.clone();
            let count = count.clone();
            tasks.push(tokio::spawn(async move {
                execute(
                    &root,
                    "same",
                    "payload".into(),
                    None,
                    |receipt| async move {
                        count.fetch_add(1, Ordering::SeqCst);
                        tokio::task::yield_now().await;
                        Ok(Response::Sent {
                            queued: !receipt.session_id.is_empty(),
                        })
                    },
                )
                .await
                .unwrap()
            }));
        }
        let first = wire(tasks.remove(0).await.unwrap());
        for task in tasks {
            assert_eq!(wire(task.await.unwrap()), first);
        }
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn a_busy_key_does_not_block_an_unrelated_operation() {
        let home = Home::new();
        let root = home.0.clone();
        let (started, waiting) = tokio::sync::oneshot::channel();
        let held = tokio::spawn(async move {
            execute(&root, "held", "payload".into(), None, |_| async move {
                started.send(()).unwrap();
                std::future::pending::<Result<Response>>().await
            })
            .await
        });
        waiting.await.unwrap();
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            execute(&home.0, "other", "payload".into(), None, |_| async {
                Ok(Response::Sent { queued: false })
            }),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(matches!(result, Response::Recorded { .. }));
        held.abort();
        let _ = held.await;
    }

    #[tokio::test]
    async fn a_lost_reply_replays_from_disk_and_changed_payload_is_refused() {
        let home = Home::new();
        let first = execute(&home.0, "send", "old".into(), Some("target"), |_| async {
            Ok(Response::Sent { queued: true })
        })
        .await
        .unwrap();
        let replay = execute(&home.0, "send", "old".into(), Some("target"), |_| async {
            panic!("a persisted result must not execute again")
        })
        .await
        .unwrap();
        assert_eq!(wire(first), wire(replay));
        let error = execute(
            &home.0,
            "send",
            "changed".into(),
            Some("target"),
            |_| async { panic!("conflicting payload must not execute") },
        )
        .await
        .unwrap_err();
        assert!(error.to_string().contains("different payload"));
    }

    #[tokio::test]
    async fn cancelled_execution_retains_identity_and_never_resubmits() {
        let home = Home::new();
        let root = home.0.clone();
        let (reserved, started) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move {
            execute(
                &root,
                "crash",
                "payload".into(),
                None,
                |receipt| async move {
                    reserved.send(receipt).unwrap();
                    std::future::pending::<Result<Response>>().await
                },
            )
            .await
        });
        let receipt = started.await.unwrap();
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        let recovered = execute(&home.0, "crash", "payload".into(), None, |_| async {
            panic!("an uncertain operation must never be submitted again")
        })
        .await
        .unwrap();
        let Response::Uncertain {
            receipt: recovered, ..
        } = recovered
        else {
            panic!("expected uncertain receipt");
        };
        assert_eq!(recovered.session_id, receipt.session_id);
        assert_eq!(recovered.operation_id, receipt.operation_id);
    }

    #[tokio::test]
    async fn an_action_error_is_uncertain_and_is_not_retried() {
        let home = Home::new();
        let result = execute(
            &home.0,
            "failed",
            "payload".into(),
            Some("target"),
            |_| async {
                Err(anyhow::anyhow!("pipe failed after a partial write").context(SubmissionStarted))
            },
        )
        .await
        .unwrap();
        assert!(
            matches!(&result, Response::Uncertain { receipt, message } if receipt.session_id == "target" && message.contains("partial write"))
        );
        let retry = execute(
            &home.0,
            "failed",
            "payload".into(),
            Some("target"),
            |_| async { panic!("a partial write must not be retried") },
        )
        .await
        .unwrap();
        assert_eq!(wire(result), wire(retry));
    }

    #[tokio::test]
    async fn unreadable_receipts_and_invalid_ids_fail_closed() {
        let home = Home::new();
        std::fs::create_dir_all(&home.0).unwrap();
        std::fs::write(home.0.join(format!("{}.json", hash(b"broken"))), b"{").unwrap();
        for id in ["broken", "", "\n", &"x".repeat(257)] {
            assert!(execute(&home.0, id, "payload".into(), None, |_| async {
                panic!("invalid receipt must not execute")
            })
            .await
            .is_err());
        }
    }

    #[test]
    fn process_loss_child() {
        let Some(root) = std::env::var_os("CARBON_RECEIPT_TEST_PROCESS") else {
            return;
        };
        let root = PathBuf::from(root);
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let submitted = root.join("submitted.json");
            execute(
                &root,
                "process-loss",
                "payload".into(),
                None,
                |receipt| async move {
                    std::fs::write(submitted, serde_json::to_vec(&receipt).unwrap()).unwrap();
                    std::process::exit(73);
                },
            )
            .await
            .unwrap();
        });
    }

    #[tokio::test]
    async fn a_new_process_recovers_an_uncertain_receipt_after_side_effects() {
        let home = Home::new();
        let child = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "orchestration::receipts::tests::process_loss_child",
            ])
            .env("CARBON_RECEIPT_TEST_PROCESS", &home.0)
            .output()
            .unwrap();
        assert_eq!(
            child.status.code(),
            Some(73),
            "{}",
            String::from_utf8_lossy(&child.stderr)
        );
        let submitted: OperationReceipt =
            serde_json::from_slice(&std::fs::read(home.0.join("submitted.json")).unwrap()).unwrap();
        let recovered = execute(&home.0, "process-loss", "payload".into(), None, |_| async {
            panic!("process loss must not replay the side effect")
        })
        .await
        .unwrap();
        assert!(
            matches!(recovered, Response::Uncertain { receipt, .. } if receipt.operation_id == submitted.operation_id && receipt.session_id == submitted.session_id)
        );
    }

    #[tokio::test]
    async fn definite_validation_errors_replay_as_errors() {
        let home = Home::new();
        let first = execute(
            &home.0,
            "invalid",
            "payload".into(),
            Some("missing"),
            |_| async { bail!("no session missing") },
        )
        .await
        .unwrap();
        assert!(
            matches!(&first, Response::Recorded { response, .. } if matches!(response.as_ref(), Response::Error { message } if message == "no session missing"))
        );
        let retry = execute(
            &home.0,
            "invalid",
            "payload".into(),
            Some("missing"),
            |_| async { panic!("definite refusals must also retain their receipt") },
        )
        .await
        .unwrap();
        assert_eq!(wire(first), wire(retry));
    }

    #[test]
    fn fingerprint_ignores_null_optionals_key_order_and_the_retry_key() {
        assert_eq!(fingerprint(&serde_json::json!({"cmd":"create_session","prompt":"brief","requestId":"a"})).unwrap(),
            fingerprint(&serde_json::json!({"requestId":"b","futureOptional":null,"prompt":"brief","cmd":"create_session"})).unwrap());
        assert_ne!(
            fingerprint(&serde_json::json!({"prompt":"brief"})).unwrap(),
            fingerprint(&serde_json::json!({"prompt":"changed"})).unwrap()
        );
    }

    #[tokio::test]
    async fn forwarding_origin_is_stable_across_concurrent_reads_and_restart() {
        let home = Home::new();
        std::fs::create_dir_all(&home.0).unwrap();
        let (first, second) = tokio::join!(origin(&home.0), origin(&home.0));
        assert_eq!(first.as_ref().unwrap(), second.as_ref().unwrap());
        assert_eq!(first.unwrap(), origin(&home.0).await.unwrap());
    }
}

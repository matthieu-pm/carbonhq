#![cfg(all(feature = "serve", unix))]

use ade_lib::{
    events::ApprovalPolicy,
    harness::Harness,
    models::ModelId,
    session::{settle_dead_child, StatusTracker},
    sink::Sink,
    store::{self, SessionIndexItem, SessionStatus},
};
use std::{
    os::unix::fs::MetadataExt,
    sync::{atomic::AtomicU64, Arc},
};
use tokio::sync::Mutex;

#[tokio::test]
async fn each_harness_retains_process_exit_and_stale_resolution_does_not_write() {
    let home = std::env::temp_dir().join(format!(
        "carbon-recovery-lifecycle-{}",
        uuid::Uuid::now_v7()
    ));
    std::env::set_var("CARBON_HOME", &home);
    let sink = Sink::new(|_, _| {});
    for harness in [
        Harness::ClaudeCode,
        Harness::Codex,
        Harness::Fx,
        Harness::Grok,
        Harness::Pi,
        Harness::Acp("fixture"),
    ] {
        let id = uuid::Uuid::now_v7().to_string();
        let item = SessionIndexItem::new(
            &id,
            harness,
            "/fixture",
            "/fixture",
            None,
            None,
            "work",
            ModelId::default(),
            None,
            ApprovalPolicy::Auto,
            false,
            None,
        );
        store::append_session_index_item(item).await.unwrap();
        store::set_session_status(&id, SessionStatus::InProgress)
            .await
            .unwrap();
        let status = Arc::new(Mutex::new(StatusTracker::default()));
        status.lock().await.on_send();
        settle_dead_child(
            &id,
            harness,
            &Arc::new(AtomicU64::new(0)),
            &status,
            &Arc::new(Mutex::new(vec![])),
            "fixture process died",
            &sink,
        )
        .await;
        let item = store::get_session_index_item(&id).await.unwrap().unwrap();
        assert_eq!(item.status, SessionStatus::Completed, "{harness:?}");
        let interruption = item.interruption.unwrap();
        assert_eq!(interruption.reason, "process_exited", "{harness:?}");
        assert_eq!(interruption.message, "fixture process died");
        let index = home.join("sessions/index.json");
        let inode = std::fs::metadata(&index).unwrap().ino();
        assert!(store::resolve_interruption(&id, "older-generation")
            .await
            .unwrap()
            .is_none());
        assert_eq!(std::fs::metadata(&index).unwrap().ino(), inode);
        store::set_session_status(&id, SessionStatus::InProgress)
            .await
            .unwrap();
        store::reset_in_progress_sessions().await.unwrap();
        let recovered = store::get_session_index_item(&id)
            .await
            .unwrap()
            .unwrap()
            .interruption
            .unwrap();
        assert_eq!(recovered.id, interruption.id);
        assert_eq!(recovered.reason, "process_exited");
    }
    let removed = uuid::Uuid::now_v7().to_string();
    let item = SessionIndexItem::new(
        &removed,
        Harness::ClaudeCode,
        "/fixture",
        "/fixture",
        None,
        None,
        "removed",
        ModelId::default(),
        None,
        ApprovalPolicy::Auto,
        false,
        None,
    );
    store::append_session_index_item(item).await.unwrap();
    store::delete_session(&removed).await.unwrap();
    let status = Arc::new(Mutex::new(StatusTracker::default()));
    status.lock().await.on_send();
    let queued = Arc::new(Mutex::new(vec![ade_lib::session::QueuedMessage {
        id: "stranded".into(),
        session_id: removed.clone(),
        text: "Do not recreate deleted work".into(),
        attachment_paths: vec![],
        from: None,
        issues: vec![],
        mcp_servers: vec![],
    }]));
    settle_dead_child(
        &removed,
        Harness::ClaudeCode,
        &Arc::new(AtomicU64::new(0)),
        &status,
        &queued,
        "removed child died",
        &sink,
    )
    .await;
    assert!(!store::get_session_path(&removed).await.unwrap().exists());
    std::fs::remove_dir_all(home).unwrap();
}

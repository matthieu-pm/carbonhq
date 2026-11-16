#![cfg(all(feature = "serve", unix))]

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::UnixStream,
    process::{Child, Command},
    time::timeout,
};

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let root = PathBuf::from("/tmp").join(format!("carbon-retry-{}", uuid::Uuid::now_v7()));
        for dir in ["data", "bin", "project"] {
            std::fs::create_dir_all(root.join(dir)).unwrap();
        }
        let fixture = Self(root);
        let project = fixture.0.join("project");
        for args in [
            vec!["init", "-b", "main"],
            vec![
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.test",
                "commit",
                "--allow-empty",
                "-m",
                "fixture",
            ],
        ] {
            assert!(std::process::Command::new("git")
                .args(args)
                .current_dir(&project)
                .output()
                .unwrap()
                .status
                .success());
        }
        let claude = fixture.0.join("bin/claude");
        std::fs::write(&claude, r#"#!/usr/bin/env python3
import json, os, sys
if '--input-format' not in sys.argv:
    print('2.1.325')
    sys.exit(0)
for line in sys.stdin:
    frame = json.loads(line)
    if frame.get('type') != 'user':
        continue
    with open(os.environ['CARBON_RETRY_PROMPTS'], 'a') as log:
        log.write(json.dumps(frame) + '\n')
    print(json.dumps({'type':'result', 'subtype':'success', 'is_error':False,
        'result':'fixture complete', 'duration_ms':1, 'duration_api_ms':1,
        'num_turns':1, 'session_id':os.environ['CARBON_SESSION_ID'],
        'total_cost_usd':0, 'modelUsage':{}, 'usage':{'input_tokens':0,'output_tokens':0,'cache_creation_input_tokens':0,'cache_read_input_tokens':0}}), flush=True)
"#).unwrap();
        std::fs::set_permissions(claude, std::fs::Permissions::from_mode(0o755)).unwrap();
        fixture
    }

    async fn start(&self) -> Child {
        let data = self.0.join("data");
        let mut child = Command::new(env!("CARGO_BIN_EXE_carbon-serve"))
            .args(["--port", "0"])
            .env("CARBON_HOME", &data)
            .env("CARBON_NO_ANALYTICS", "1")
            .env("CARBON_RETRY_PROMPTS", self.0.join("prompts.jsonl"))
            .env(
                "PATH",
                std::env::join_paths([
                    self.0.join("bin"),
                    PathBuf::from("/opt/homebrew/bin"),
                    PathBuf::from("/usr/local/bin"),
                    PathBuf::from("/usr/bin"),
                    PathBuf::from("/bin"),
                ])
                .unwrap(),
            )
            .stdout(Stdio::null())
            .stderr(Stdio::from(
                std::fs::File::create(self.0.join("server.log")).unwrap(),
            ))
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        timeout(Duration::from_secs(15), async {
            loop {
                if data.join("serve-port").exists()
                    && data.join("serve-token").exists()
                    && UnixStream::connect(data.join("carbon.sock")).await.is_ok()
                {
                    break;
                }
                assert!(
                    child.try_wait().unwrap().is_none(),
                    "server exited before listening"
                );
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap_or_else(|error| {
            panic!(
                "{error}: {}",
                std::fs::read_to_string(self.0.join("server.log")).unwrap_or_default()
            )
        });
        child
    }

    async fn ask(&self, request: &Value) -> Value {
        timeout(
            Duration::from_secs(20),
            request_at(&self.0.join("data/carbon.sock"), request),
        )
        .await
        .unwrap()
    }

    fn create(&self, id: Option<&str>) -> Value {
        let mut request = json!({"v":16,"cmd":"create_session","prompt":"opening fixture prompt",
            "projectPath":self.0.join("project"),"base":"HEAD","title":"retry fixture",
            "model":"opus","harness":"claude_code"});
        if let Some(id) = id {
            request["requestId"] = json!(id);
        }
        request
    }

    async fn forward(&self, request: &Value, source: &str, fingerprint: &str) -> Value {
        self.call("orchestrate", json!({"line":request.to_string(),"requestSource":source,"requestFingerprint":fingerprint})).await
    }

    async fn call(&self, command: &str, args: Value) -> Value {
        let port = std::fs::read_to_string(self.0.join("data/serve-port")).unwrap();
        let token = std::fs::read_to_string(self.0.join("data/serve-token")).unwrap();
        let (mut socket, _) = tokio_tungstenite::connect_async(format!(
            "ws://127.0.0.1:{}",
            port.lines().next().unwrap()
        ))
        .await
        .unwrap();
        socket
            .send(tokio_tungstenite::tungstenite::Message::text(
                json!({"v":1,"token":token.trim()}).to_string(),
            ))
            .await
            .unwrap();
        socket
            .send(tokio_tungstenite::tungstenite::Message::text(
                json!({"id":1,"cmd":command,"args":args}).to_string(),
            ))
            .await
            .unwrap();
        timeout(Duration::from_secs(20), async {
            loop {
                let frame = socket.next().await.unwrap().unwrap();
                if !frame.is_text() {
                    continue;
                }
                let reply: Value = serde_json::from_str(frame.to_text().unwrap()).unwrap();
                if reply["id"] == 1 {
                    assert!(reply.get("err").is_none(), "{reply}");
                    return reply["ok"].clone();
                }
            }
        })
        .await
        .unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

async fn request_at(socket: &Path, request: &Value) -> Value {
    let mut stream = UnixStream::connect(socket).await.unwrap();
    stream
        .write_all(format!("{request}\n").as_bytes())
        .await
        .unwrap();
    let mut response = String::new();
    BufReader::new(stream)
        .read_line(&mut response)
        .await
        .unwrap();
    serde_json::from_str(&response).unwrap()
}

#[tokio::test]
async fn socket_retries_preserve_one_worker_message_and_receipt_across_restart() {
    let fixture = Fixture::new();
    let mut server = fixture.start().await;
    let create = fixture.create(Some("create-once"));
    let socket = fixture.0.join("data/carbon.sock");
    // Drop the original connection before reading its reply, then race retries.
    let mut lost = UnixStream::connect(&socket).await.unwrap();
    lost.write_all(format!("{create}\n").as_bytes())
        .await
        .unwrap();
    drop(lost);
    let (first, second) = tokio::join!(fixture.ask(&create), fixture.ask(&create));
    assert_eq!(first["status"], "recorded", "{first}");
    assert_eq!(first, second);
    assert_eq!(first["response"]["status"], "created", "{first}");
    let session = first["receipt"]["sessionId"].as_str().unwrap();
    assert_eq!(first["response"]["session"]["sessionId"], session);

    let send = json!({"v":16,"cmd":"send_message","requestId":"send-once","sessionId":session,"prompt":"second fixture prompt"});
    let (sent, retried) = tokio::join!(fixture.ask(&send), fixture.ask(&send));
    assert_eq!(sent["status"], "recorded", "{sent}");
    assert_eq!(sent, retried);
    assert_eq!(sent["response"]["status"], "sent");
    let mut conflict = send.clone();
    conflict["prompt"] = json!("changed payload");
    let refused = fixture.ask(&conflict).await;
    assert_eq!(refused["status"], "error");
    assert!(refused["message"]
        .as_str()
        .unwrap()
        .contains("different payload"));

    timeout(Duration::from_secs(5), async {
        loop {
            if std::fs::read_to_string(fixture.0.join("prompts.jsonl"))
                .unwrap_or_default()
                .lines()
                .count()
                == 2
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap_or_else(|error| {
        panic!(
            "{error}: {}",
            std::fs::read_to_string(fixture.0.join("server.log")).unwrap_or_default()
        )
    });
    let index: Value =
        serde_json::from_slice(&std::fs::read(fixture.0.join("data/sessions/index.json")).unwrap())
            .unwrap();
    assert_eq!(index.as_array().unwrap().len(), 1);
    let worktrees = std::process::Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(fixture.0.join("project"))
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8(worktrees.stdout)
            .unwrap()
            .lines()
            .filter(|line| line.starts_with("worktree "))
            .count(),
        2
    );
    server.kill().await.unwrap();
    server.wait().await.unwrap();
    let mut restarted = fixture.start().await;
    assert_eq!(fixture.ask(&create).await, first);
    assert_eq!(fixture.ask(&send).await, sent);
    assert_eq!(
        std::fs::read_to_string(fixture.0.join("prompts.jsonl"))
            .unwrap()
            .lines()
            .count(),
        2
    );
    restarted.kill().await.unwrap();
    restarted.wait().await.unwrap();
}

#[tokio::test]
async fn forwarding_replays_before_localization_and_scopes_terminal_callers() {
    let fixture = Fixture::new();
    let mut server = fixture.start().await;
    let request = fixture.create(Some("same-key"));
    let first = fixture.forward(&request, "origin-a", "original-hash").await;
    assert_eq!(first["status"], "recorded", "{first}");
    let mut changed_local_path = request.clone();
    changed_local_path["projectPath"] = json!("/a/path/that/no/longer/exists");
    assert_eq!(
        fixture
            .forward(&changed_local_path, "origin-a", "original-hash")
            .await,
        first
    );
    let conflict = fixture
        .forward(&request, "origin-a", "changed-original-hash")
        .await;
    assert_eq!(conflict["status"], "error", "{conflict}");
    let second = fixture.forward(&request, "origin-b", "original-hash").await;
    assert_eq!(second["status"], "recorded", "{second}");
    assert_ne!(
        first["receipt"]["sessionId"],
        second["receipt"]["sessionId"]
    );
    server.kill().await.unwrap();
    server.wait().await.unwrap();
}

#[tokio::test]
async fn validation_refusals_are_definite_and_legacy_requests_keep_their_response() {
    let fixture = Fixture::new();
    let mut server = fixture.start().await;
    let missing = json!({"v":16,"cmd":"send_message","sessionId":"missing","prompt":"brief","requestId":"missing-target"});
    let first = fixture.ask(&missing).await;
    assert_eq!(first["status"], "recorded", "{first}");
    assert_eq!(first["response"]["status"], "error", "{first}");
    assert_eq!(fixture.ask(&missing).await, first);
    let mut invalid = fixture.create(Some("blank-prompt"));
    invalid["prompt"] = json!("");
    assert_eq!(fixture.ask(&invalid).await["response"]["status"], "error");
    let legacy = fixture
        .ask(&json!({"v":6,"cmd":"send_message","sessionId":"missing","prompt":"brief"}))
        .await;
    assert_eq!(legacy["status"], "error");
    assert!(legacy.get("receipt").is_none());
    let created = fixture.ask(&fixture.create(None)).await;
    assert_eq!(created["status"], "created", "{created}");
    assert!(created.get("receipt").is_none());
    server.kill().await.unwrap();
    server.wait().await.unwrap();
}

#[tokio::test]
async fn a_source_server_prepares_identity_and_replays_a_remote_create() {
    let source = Fixture::new();
    let destination = Fixture::new();
    let mut source_server = source.start().await;
    let mut destination_server = destination.start().await;
    let port = std::fs::read_to_string(destination.0.join("data/serve-port")).unwrap();
    let token = std::fs::read_to_string(destination.0.join("data/serve-token")).unwrap();
    let added = source
        .ask(&json!({"v":9,"cmd":"add_server","name":"fixture-remote",
        "address":format!("ws://127.0.0.1:{}",port.lines().next().unwrap()),"token":token.trim()}))
        .await;
    assert_eq!(added["status"], "server", "{added}");
    let parent = source.ask(&source.create(None)).await;
    assert_eq!(parent["status"], "created", "{parent}");
    let parent_id = parent["session"]["sessionId"].as_str().unwrap();
    let mut create = destination.create(Some("forwarded-once"));
    create["parentSessionId"] = json!(parent_id);
    create.as_object_mut().unwrap().remove("v");
    let wrapped = json!({"v":16,"cmd":"on_machine","machine":"fixture-remote","request":create});
    let first = source.ask(&wrapped).await;
    assert_eq!(first["status"], "recorded", "{first}");
    assert_eq!(first["response"]["session"]["machine"], "fixture-remote");
    assert_eq!(source.ask(&wrapped).await, first);
    source
        .call("delete_session", json!({"sessionId":parent_id}))
        .await;
    assert_eq!(source.ask(&wrapped).await, first);
    let origin = std::fs::read_to_string(source.0.join("data/orchestration-origin")).unwrap();
    assert!(uuid::Uuid::parse_str(&origin).is_ok());
    let root = destination.0.join("data/orchestration-requests");
    let scopes: Vec<_> = std::fs::read_dir(&root).unwrap().collect();
    assert_eq!(scopes.len(), 1);
    source_server.kill().await.unwrap();
    source_server.wait().await.unwrap();
    let mut restarted = source.start().await;
    assert_eq!(source.ask(&wrapped).await, first);
    assert_eq!(
        std::fs::read_to_string(source.0.join("data/orchestration-origin")).unwrap(),
        origin
    );
    restarted.kill().await.unwrap();
    restarted.wait().await.unwrap();
    destination_server.kill().await.unwrap();
    destination_server.wait().await.unwrap();
}

#[tokio::test]
async fn tracked_creation_receipt_survives_an_unreadable_task_registry() {
    let fixture = Fixture::new();
    let mut server = fixture.start().await;
    let parent = fixture.ask(&fixture.create(None)).await;
    let mut create = fixture.create(Some("tracked-configuration"));
    create["v"] = json!(20);
    create["configuration"] = json!(true);
    create["parentSessionId"] = parent["session"]["sessionId"].clone();
    create["task"] = json!({"awaited":false});
    let original = fixture.ask(&create).await;
    assert_eq!(original["status"], "recorded", "{original}");
    let configuration = &original["response"]["task"]["configuration"];
    assert_eq!(configuration["model"], "opus", "{original}");
    let registry = std::fs::read_dir(fixture.0.join("data/delegated-tasks"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| path.extension().is_some_and(|ext| ext == "json"))
        .unwrap();
    let backup = registry.with_extension("backup");
    std::fs::rename(&registry, &backup).unwrap();
    std::fs::create_dir(&registry).unwrap();
    let retry = fixture.ask(&create).await;
    assert_eq!(retry["status"], "recorded", "{retry}");
    assert_eq!(retry["response"]["task"]["configuration"], *configuration);
    std::fs::remove_dir(&registry).unwrap();
    std::fs::rename(&backup, &registry).unwrap();
    server.kill().await.unwrap();
    server.wait().await.unwrap();
}

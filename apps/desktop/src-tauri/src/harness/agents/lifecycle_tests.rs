use super::*;
use tokio::process::Child;
use tokio::sync::mpsc;

struct FakeAgent {
    child: Child,
    client: RpcClient,
    requests: mpsc::UnboundedReceiver<(RequestId, Value)>,
}

impl FakeAgent {
    async fn start(scenario: &str) -> Self {
        let mut child = Command::new("python3")
            .args(["-u", "-c", include_str!("fixtures/fake_agent.py"), scenario])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .expect("fake ACP agent starts");
        let client = RpcClient::new(child.stdin.take().unwrap());
        let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
        let (tx, requests) = mpsc::unbounded_channel();
        let reader = client.clone();
        tokio::spawn(async move {
            while let Ok(Some(line)) = lines.next_line().await {
                if let Incoming::Request { id, params, .. } = reader.accept(&line).await {
                    let _ = tx.send((id, params));
                }
            }
            reader.disconnect();
        });
        Self {
            child,
            client,
            requests,
        }
    }

    async fn initialize(&self) -> Value {
        self.client
            .request(
                "initialize",
                json!({"protocolVersion": 1, "clientCapabilities": {}}),
            )
            .await
            .expect("fake initialization answers")
    }
}

impl Drop for FakeAgent {
    fn drop(&mut self) {
        self.client.disconnect();
        let _ = self.child.start_kill();
    }
}

#[tokio::test]
async fn startup_options_survive_before_the_session_attaches_without_another_line() {
    let mut child = Command::new("python3")
        .args([
            "-u",
            "-c",
            include_str!("fixtures/fake_agent.py"),
            "startup",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let client = RpcClient::new(child.stdin.take().unwrap());
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    let harness = Harness::Acp("startup-publication-test");
    let handles = ReaderHandles {
        client: client.clone(),
        session_id: uuid::Uuid::now_v7().to_string(),
        session_cwd: "/startup-test".into(),
        harness,
        pending: Default::default(),
        app: Sink::new(|_, _| {}),
    };
    let carbon_session_id = handles.session_id.clone();
    let reader = tokio::spawn(read_stdout(
        child.stdout.take().unwrap(),
        handles,
        ready_rx,
        Arc::new(Mutex::new(StatusTracker::default())),
        Arc::new(Mutex::new(vec![])),
        Arc::new(AtomicU64::new(0)),
    ));
    client
        .request("initialize", json!({"protocolVersion":1}))
        .await
        .unwrap();
    let opened = client.request("session/new", json!({})).await.unwrap();
    tokio::time::timeout(Duration::from_secs(2), async {
        while list_commands(harness, "/startup-test").is_err() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("startup publications were drained before attachment");
    let session = AcpSession {
        client,
        id: opened["sessionId"].as_str().unwrap().into(),
        harness,
        carbon_session_id,
        prompt_id: Default::default(),
        options: Arc::new(std::sync::Mutex::new(SessionOptions::of(&opened))),
    };
    let (attached_tx, attached_rx) = tokio::sync::oneshot::channel();
    ready_tx.send((session.clone(), attached_tx)).unwrap();
    tokio::time::timeout(Duration::from_secs(2), attached_rx)
        .await
        .expect("attachment needs no further stdout line")
        .unwrap();
    let offered = options(&session);
    assert_eq!(offered.len(), 1);
    assert_eq!(offered[0].current_value.as_deref(), Some("adaptive"));
    child.kill().await.unwrap();
    reader.await.unwrap().unwrap();
}

#[tokio::test]
async fn authentication_retries_the_refused_open_only_after_sign_in() {
    let agent = FakeAgent::start("auth").await;
    let init = agent.initialize().await;
    validate_initialize(&init).expect("protocol 1 is supported");
    let opened = with_auth(
        &agent.client,
        &init["authMethods"],
        "session/new",
        json!({"cwd":"/tmp", "mcpServers":[]}),
    )
    .await
    .expect("retry opens authenticated session");
    assert_eq!(opened["sessionId"], "fake-session");
    assert_eq!(opened["authenticated"], true);
}

#[tokio::test]
async fn string_permission_ids_survive_a_real_pipe_round_trip() {
    let mut agent = FakeAgent::start("permission").await;
    agent.initialize().await;
    let prompt = {
        let client = agent.client.clone();
        tokio::spawn(async move {
            client
                .request(
                    "session/prompt",
                    json!({"sessionId":"fake-session", "prompt":[]}),
                )
                .await
        })
    };
    let (id, params) = tokio::time::timeout(Duration::from_secs(2), agent.requests.recv())
        .await
        .expect("permission arrives")
        .expect("request channel stays open");
    assert_eq!(id, RequestId::Str("permission-string".into()));
    assert_eq!(params["toolCall"]["toolCallId"], "call");
    agent
        .client
        .respond(
            id,
            json!({"outcome":{"outcome":"selected", "optionId":"allow"}}),
        )
        .expect("permission reply is written");
    let completed = tokio::time::timeout(Duration::from_secs(2), prompt)
        .await
        .expect("reply unblocks the agent")
        .unwrap()
        .unwrap();
    assert_eq!(completed["stopReason"], "end_turn");
}

#[tokio::test]
async fn cancellation_finishes_the_original_pending_prompt() {
    let agent = FakeAgent::start("cancel").await;
    agent.initialize().await;
    let prompt = agent.client.request(
        "session/prompt",
        json!({"sessionId":"fake-session", "prompt":[]}),
    );
    tokio::pin!(prompt);
    tokio::select! {
        biased;
        result = &mut prompt => panic!("prompt finished before cancellation: {result:?}"),
        _ = tokio::task::yield_now() => {}
    }
    agent
        .client
        .notify("session/cancel", json!({"sessionId":"fake-session"}))
        .unwrap();
    let completed = tokio::time::timeout(Duration::from_secs(2), prompt)
        .await
        .expect("cancel unblocks the prompt")
        .unwrap();
    assert_eq!(completed["stopReason"], "cancelled");
}

#[tokio::test]
async fn an_exit_during_open_fails_without_waiting_for_the_open_timeout() {
    let agent = FakeAgent::start("exit").await;
    agent.initialize().await;
    let opened = tokio::time::timeout(
        Duration::from_secs(2),
        agent.client.request_within(
            "session/new",
            json!({"cwd":"/tmp", "mcpServers":[]}),
            Duration::from_secs(20),
        ),
    )
    .await
    .expect("EOF promptly releases pending RPC calls");
    assert!(opened.is_err());
}

#[tokio::test]
async fn unsupported_protocol_is_rejected_before_session_setup() {
    let agent = FakeAgent::start("version").await;
    let init = agent.initialize().await;
    assert!(validate_initialize(&init).is_err());
}

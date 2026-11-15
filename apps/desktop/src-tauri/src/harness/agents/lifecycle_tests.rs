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

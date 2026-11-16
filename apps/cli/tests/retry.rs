use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    os::unix::net::UnixListener,
    process::{Command, Output},
};

fn run(args: &[&str], response: Option<Value>) -> Output {
    let path = std::path::PathBuf::from(format!(
        "/tmp/carbon-cli-retry-{}.sock",
        uuid::Uuid::new_v4()
    ));
    let listener = UnixListener::bind(&path).unwrap();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut line = String::new();
        BufReader::new(&stream).read_line(&mut line).unwrap();
        let request: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(request["v"], 16);
        assert_eq!(request["requestId"], "stable-key");
        if let Some(response) = response {
            writeln!(stream, "{response}").unwrap();
        }
    });
    let output = Command::new(env!("CARGO_BIN_EXE_carbon"))
        .args(args)
        .env("CARBON_ENDPOINT", &path)
        .env_remove("CARBON_SESSION_ID")
        .output()
        .unwrap();
    server.join().unwrap();
    std::fs::remove_file(path).unwrap();
    output
}

fn receipt() -> Value {
    json!({"requestId":"stable-key","operationId":"operation-1","sessionId":"session-1","worktreeName":"request-session-1"})
}

#[test]
fn a_recorded_create_keeps_stdout_machine_readable() {
    let output = run(
        &["session", "new", "brief", "--request-id", "stable-key"],
        Some(json!({
            "status":"recorded","receipt":receipt(),"response":{"status":"created","baseRef":null,"session":{
                "sessionId":"session-1","title":"Fixture","cwd":"/fixture","projectPath":"/fixture",
                "branch":null,"worktreeName":null,"status":"idle","modified":""
            }}
        })),
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(String::from_utf8(output.stdout).unwrap(), "session-1\n");
    assert!(String::from_utf8(output.stderr)
        .unwrap()
        .contains("operation-1"));
}

#[test]
fn uncertain_delivery_exits_without_resubmitting() {
    let output = run(
        &[
            "session",
            "send",
            "target",
            "brief",
            "--request-id",
            "stable-key",
        ],
        Some(json!({
            "status":"uncertain","receipt":receipt(),"message":"Outcome was not recorded."
        })),
    );
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    let error = String::from_utf8(output.stderr).unwrap();
    assert!(
        error.contains("Delivery uncertain")
            && error.contains("Not resubmitted")
            && error.contains("operation-1")
    );
}

#[test]
fn a_lost_reply_tells_the_caller_to_keep_the_key() {
    let output = run(
        &[
            "session",
            "send",
            "target",
            "brief",
            "--request-id",
            "stable-key",
        ],
        None,
    );
    assert!(!output.status.success());
    let error = String::from_utf8(output.stderr).unwrap();
    assert!(
        error.contains("same --request-id")
            && error.contains("stable-key")
            && error.contains("unchanged arguments")
    );
}

#[test]
fn a_definite_refusal_does_not_claim_a_session_exists() {
    let output = run(
        &["session", "new", "brief", "--request-id", "stable-key"],
        Some(json!({
            "status":"recorded","receipt":receipt(),"response":{"status":"error","message":"unknown harness"}
        })),
    );
    assert!(!output.status.success());
    let error = String::from_utf8(output.stderr).unwrap();
    assert!(error.contains("Nothing was submitted") && error.contains("new --request-id"));
    assert!(!error.contains("session-1") && !error.contains("Retry only"));
}

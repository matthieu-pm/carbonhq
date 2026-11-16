use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    os::unix::net::UnixListener,
    process::Command,
};

fn run(
    args: &[&str],
    inspect: impl FnOnce(Value) + Send + 'static,
    summary: Value,
) -> std::process::Output {
    let path = format!("/tmp/carbon-task-{}.sock", uuid::Uuid::new_v4());
    let listener = UnixListener::bind(&path).unwrap();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut line = String::new();
        BufReader::new(&stream).read_line(&mut line).unwrap();
        inspect(serde_json::from_str(&line).unwrap());
        writeln!(stream, "{}", json!({"status":"task","task":summary})).unwrap();
    });
    let output = Command::new(env!("CARGO_BIN_EXE_carbon"))
        .args(args)
        .env("CARBON_ENDPOINT", &path)
        .env("CARBON_SESSION_ID", "parent")
        .output()
        .unwrap();
    server.join().unwrap();
    std::fs::remove_file(path).unwrap();
    output
}

fn summary() -> Value {
    json!({"taskId":"task-1","operationId":"op-1","parentSessionId":"parent","childSessionId":"child","parentTaskId":null,"awaitedTaskIds":[],"state":"running","result":null,"questions":[],"completionDelivery":null,"deliveryError":null,"completionAcknowledged":false})
}

#[test]
fn tracking_returns_a_task_id_and_sends_retryable_v19_options() {
    for args in [
        vec!["session", "new", "brief", "--task", "--await"],
        vec!["session", "send", "child", "brief", "--task", "--await"],
    ] {
        let output = run(
            &args,
            |request| {
                assert_eq!(request["v"], 19);
                assert_eq!(request["task"]["awaited"], true);
                assert!(!request["requestId"].as_str().unwrap().is_empty());
            },
            summary(),
        );
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(output.stdout, b"task-1\n");
        assert!(String::from_utf8_lossy(&output.stderr).contains("child"));
    }
}

#[test]
fn task_wait_is_bounded_and_can_name_a_remote_owner() {
    let output = run(
        &[
            "--machine",
            "vps",
            "task",
            "wait",
            "task-1",
            "--timeout",
            "4",
        ],
        |request| {
            assert_eq!(request["v"], 19);
            assert_eq!(request["machine"], "vps");
            assert_eq!(request["request"]["cmd"], "task");
            assert_eq!(request["request"]["action"], "wait");
            assert_eq!(request["request"]["timeoutSecs"], 4);
        },
        summary(),
    );
    assert!(output.status.success());
    assert_eq!(
        serde_json::from_slice::<Value>(&output.stdout).unwrap()["state"],
        "running"
    );
}

#[test]
fn awaiting_requires_opt_in_tracking() {
    let output = Command::new(env!("CARGO_BIN_EXE_carbon"))
        .args(["session", "new", "brief", "--await"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("--task"));
}

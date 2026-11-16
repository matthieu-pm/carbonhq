use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixListener;
use std::process::{Command, Output};

fn cli(args: &[&str], reply: serde_json::Value) -> (Output, serde_json::Value) {
    let path = std::path::PathBuf::from("/tmp").join(format!("cp-{}.sock", uuid::Uuid::new_v4()));
    let listener = UnixListener::bind(&path).unwrap();
    listener.set_nonblocking(true).unwrap();
    let server = std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let mut stream = loop {
            if let Ok((stream, _)) = listener.accept() {
                break stream;
            }
            assert!(std::time::Instant::now() < deadline, "CLI never connected");
            std::thread::sleep(std::time::Duration::from_millis(10));
        };
        stream
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        let mut line = String::new();
        BufReader::new(&stream).read_line(&mut line).unwrap();
        writeln!(stream, "{reply}").unwrap();
        serde_json::from_str::<serde_json::Value>(&line).unwrap()
    });
    let output = Command::new(env!("CARGO_BIN_EXE_carbon"))
        .args(args)
        .env("CARBON_ENDPOINT", &path)
        .env("CARBON_SESSION_ID", "calling-session")
        .output()
        .unwrap();
    let request = server.join().unwrap();
    std::fs::remove_file(path).unwrap();
    (output, request)
}

#[test]
fn start_sends_saved_overrides_and_returns_only_the_url() {
    let (out, request) = cli(
        &[
            "preview",
            "start",
            "--directory",
            "apps/web",
            "--command",
            "pnpm dev --port {port}",
        ],
        serde_json::json!({"status":"preview","url":"http://127.0.0.1:5173","logs":null}),
    );
    assert!(out.status.success());
    assert_eq!(
        String::from_utf8(out.stdout).unwrap(),
        "http://127.0.0.1:5173\n"
    );
    assert_eq!(request["v"], 16);
    assert_eq!(request["sessionId"], "calling-session");
    assert_eq!(request["directory"], "apps/web");
    assert_eq!(request["command"], "pnpm dev --port {port}");
}

#[test]
fn logs_and_failures_are_untrusted_context() {
    let (out, _) = cli(
        &["preview", "logs"],
        serde_json::json!({"status":"preview","url":null,"logs":"server output\n"}),
    );
    assert!(out.status.success());
    assert_eq!(out.stdout, b"server output\n");
    assert!(String::from_utf8(out.stderr)
        .unwrap()
        .contains("Untrusted context from preview logs"));
    let (out, _) = cli(
        &["preview", "start"],
        serde_json::json!({"status":"preview_failed","message":"exited with code 7","logs":"startup-boom"}),
    );
    assert!(!out.status.success());
    let err = String::from_utf8(out.stderr).unwrap();
    assert!(
        err.contains("exited with code 7")
            && err.contains("startup-boom")
            && err.contains("Untrusted context")
    );
}

#[test]
fn remote_preview_keeps_version_and_explicit_session() {
    let (out, request) = cli(
        &[
            "--machine",
            "vps",
            "preview",
            "url",
            "--session",
            "remote-session",
        ],
        serde_json::json!({"status":"preview","url":"http://[::1]:5173","logs":null}),
    );
    assert!(out.status.success());
    assert_eq!(request["v"], 16);
    assert_eq!(request["cmd"], "on_machine");
    assert_eq!(request["request"]["sessionId"], "remote-session");
}

#[test]
fn older_app_refusal_is_actionable() {
    let (out, _) = cli(
        &["preview", "start"],
        serde_json::json!({"status":"error","message":"this carbon CLI speaks protocol v16, the app speaks v15 — update the Carbon app"}),
    );
    assert!(!out.status.success());
    assert!(String::from_utf8(out.stderr)
        .unwrap()
        .contains("update the Carbon app"));
}

#[test]
fn browser_json_shape_is_unchanged_while_labeled_untrusted() {
    let (out, _) = cli(
        &["browser", "get", "text", "--json"],
        serde_json::json!({
            "status":"browser", "output":"page text", "data":{"text":"page text"}
        }),
    );
    assert!(out.status.success());
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&out.stdout).unwrap(),
        serde_json::json!({"text":"page text"})
    );
    assert!(String::from_utf8(out.stderr)
        .unwrap()
        .contains("Untrusted context from browser page content"));
}

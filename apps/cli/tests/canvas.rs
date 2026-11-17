use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixListener;
use std::process::{Command, Stdio};

fn call(args: &[&str], input: &str) -> Value {
    let path = std::path::PathBuf::from(format!("/tmp/c82-{}.sock", uuid::Uuid::new_v4()));
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
        writeln!(
            stream,
            "{}",
            json!({"status":"canvas","data":{"id":"canvas","revision":8}})
        )
        .unwrap();
        serde_json::from_str::<Value>(&line).unwrap()
    });
    let mut child = Command::new(env!("CARGO_BIN_EXE_carbon"))
        .args(args)
        .env("CARBON_ENDPOINT", &path)
        .env("CARBON_SESSION_ID", "caller")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        serde_json::from_slice::<Value>(&output.stdout).unwrap()["revision"],
        8
    );
    let request = server.join().unwrap();
    std::fs::remove_file(path).unwrap();
    request
}

#[test]
fn canvas_edits_carry_the_callers_scope_and_expected_revision_on_v22() {
    let request = call(
        &[
            "canvas",
            "--canvas",
            "file",
            "--revision",
            "7",
            "frame",
            "resize",
            "frame",
            "--width",
            "390",
            "--height",
            "844",
        ],
        "",
    );
    assert_eq!(request["v"], 22);
    assert_eq!(request["cmd"], "canvas");
    assert_eq!(request["session_id"], "caller");
    assert_eq!(request["canvas"], "file");
    assert_eq!(request["revision"], 7);
    assert_eq!(request["action"]["op"], "arrange_frame");
    assert_eq!(request["action"]["width"], 390);
}

#[test]
fn canvas_html_stdin_and_remote_forwarding_preserve_the_target() {
    let html = "<div style=\"padding:24px\">\n<h1>Hello &amp; welcome</h1>\n</div>";
    let request = call(
        &[
            "--machine",
            "box",
            "canvas",
            "--session",
            "caller",
            "write",
            "parent",
            "--canvas",
            "file",
            "--revision",
            "7",
        ],
        html,
    );
    assert_eq!(request["v"], 22);
    assert_eq!(request["cmd"], "on_machine");
    assert_eq!(request["machine"], "box");
    assert_eq!(request["request"]["session_id"], "caller");
    assert_eq!(request["request"]["action"]["html"], html);
    assert_eq!(request["request"]["action"]["parent"], "parent");
}

#[test]
fn canvas_styles_keep_explicit_property_removal() {
    let request = call(
        &[
            "canvas",
            "--canvas",
            "file",
            "--revision",
            "7",
            "set-style",
            "node",
            "{\"color\":\"red\",\"padding\":null}",
        ],
        "",
    );
    assert_eq!(
        request["action"]["styles"],
        json!({"color":"red","padding":null})
    );
}

#[test]
fn an_agent_cannot_retarget_canvas_commands_to_another_session() {
    let output = Command::new(env!("CARGO_BIN_EXE_carbon"))
        .args(["canvas", "--session", "other", "ls"])
        .env("CARBON_SESSION_ID", "caller")
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("calling Carbon session"));
}

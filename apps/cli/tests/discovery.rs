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

fn harness() -> serde_json::Value {
    serde_json::json!({"harness":"pi","label":"pi","available":false,"reason":"pi is not installed","installCommand":null,"docsUrl":null,"loginCommand":"pi","loginHint":null})
}

#[test]
fn discovery_json_and_remote_envelopes_preserve_the_target_and_version() {
    let reply = serde_json::json!({"status":"discovery","data":{"kind":"models","harness":harness(),"models":[],"total":0,"nextCursor":null,"catalogReason":"pi is not installed"}});
    let (out, request) = cli(
        &[
            "--machine",
            "vps",
            "model",
            "ls",
            "--harness",
            "pi",
            "--query",
            "vendor",
            "--limit",
            "3",
            "--cursor",
            "opaque",
            "--json",
        ],
        reply,
    );
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let data: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(data["harness"]["available"], false);
    assert_eq!(data["catalogReason"], "pi is not installed");
    assert_eq!(request["v"], 20);
    assert_eq!(request["cmd"], "on_machine");
    assert_eq!(request["machine"], "vps");
    assert_eq!(request["request"]["cmd"], "discover");
    assert_eq!(request["request"]["harness"], "pi");
    assert_eq!(request["request"]["query"], "vendor");
    assert_eq!(request["request"]["limit"], 3);
    assert_eq!(request["request"]["cursor"], "opaque");
}

#[test]
fn harness_list_defaults_to_a_readable_availability_table() {
    let (out, request) = cli(
        &["harness", "ls"],
        serde_json::json!({"status":"discovery","data":{"kind":"harnesses","harnesses":[harness()]}}),
    );
    assert!(out.status.success());
    let text = String::from_utf8(out.stdout).unwrap();
    assert!(text.contains("AVAILABLE") && text.contains("pi is not installed"));
    assert_eq!(request["action"], "harnesses");
}

#[test]
fn old_servers_refuse_discovery_without_printing_an_empty_catalog() {
    let (out, _) = cli(
        &["harness", "ls", "--json"],
        serde_json::json!({"status":"error","message":"this carbon CLI speaks protocol v20, the app speaks v19 — update the Carbon app"}),
    );
    assert!(!out.status.success());
    assert!(out.stdout.is_empty());
    assert!(String::from_utf8_lossy(&out.stderr).contains("update the Carbon app"));
}

fn created() -> serde_json::Value {
    serde_json::json!({"status":"created","configuration":{"harness":"claude_code","model":"opus","effort":"high","mode":"manual","fast":true},"session":{"sessionId":"created-id","title":"Fixture","cwd":"/fixture","projectPath":"/fixture","branch":null,"worktreeName":null,"status":"idle","modified":""}})
}

#[test]
fn json_creation_reports_effective_settings_and_ordinary_creation_keeps_the_id() {
    let (out, request) = cli(&["session", "new", "brief", "--json"], created());
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let receipt: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(receipt["configuration"]["model"], "opus");
    assert_eq!(receipt["configuration"]["mode"], "manual");
    assert_eq!(receipt["configuration"]["fast"], true);
    assert_eq!(request["v"], 20);
    assert_eq!(request["configuration"], true);
    let (out, request) = cli(&["session", "new", "brief"], created());
    assert!(out.status.success());
    assert_eq!(out.stdout, b"created-id\n");
    assert_eq!(request["v"], 6);
    assert!(request.get("configuration").is_none());
}

#[test]
fn json_creation_does_not_silently_accept_a_missing_configuration() {
    let mut response = created();
    response.as_object_mut().unwrap().remove("configuration");
    let (out, _) = cli(&["session", "new", "brief", "--json"], response);
    assert!(!out.status.success());
    assert!(out.stdout.is_empty());
    assert!(String::from_utf8_lossy(&out.stderr).contains("created the session"));
}

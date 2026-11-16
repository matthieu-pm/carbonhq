use super::config::Definition;
use crate::mcp_servers::{McpServerEntry, McpTransport};
use serde_json::{json, Value};

pub(super) fn stdio() -> Definition {
    Definition {
        server: McpServerEntry {
            name: "fixture".into(),
            transport: McpTransport::Stdio,
            command: Some("python3".into()),
            args: vec![
                "-u".into(),
                "-c".into(),
                include_str!("fixtures/stdio.py").into(),
            ],
            env: vec![],
            url: None,
            headers: vec![],
            enabled: true,
            inherited: false,
        },
        project: None,
        header_env: Default::default(),
        bearer_token_env: None,
        oauth: None,
        cwd: None,
        bearer_token_file: None,
        inherit_env: Vec::new(),
    }
}

pub(super) fn initialize() -> Value {
    json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{
        "protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}
    }})
}

pub(super) async fn post(url: &str, message: Value) -> Value {
    crate::http()
        .post(url)
        .header("Accept", "application/json, text/event-stream")
        .json(&message)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap()
}

pub(super) async fn state(url: &str, value: Option<&str>) -> Value {
    let args = value.map_or(json!({}), |value| json!({"value":value}));
    let response = post(url, json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"state","arguments":args}})).await;
    serde_json::from_str(response["result"]["content"][0]["text"].as_str().unwrap()).unwrap()
}

#[tokio::test]
async fn sse_parser_handles_utf8_crlf_and_multiline_data() {
    let body = "event: message\r\ndata: {\r\ndata: \"text\":\"é\"}\r\n\r\n";
    let stream = futures_util::stream::iter(
        body.as_bytes()
            .chunks(1)
            .map(|chunk| Ok::<_, std::io::Error>(axum::body::Bytes::copy_from_slice(chunk))),
    );
    let mut events = Vec::new();
    super::proxy::read_sse(stream, |event, data| events.push((event, data)))
        .await
        .unwrap();
    assert_eq!(
        events,
        vec![("message".into(), "{\n\"text\":\"é\"}".into())]
    );
}

use anyhow::{bail, Context, Result};
use axum::http::HeaderMap;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    sync::{mpsc, RwLock},
    task::JoinHandle,
};

struct Connection {
    url: String,
    headers: RwLock<HeaderMap>,
    output: mpsc::UnboundedSender<String>,
    notifications: Mutex<Option<JoinHandle<()>>>,
}

impl Connection {
    async fn send(self: Arc<Self>, value: Value) -> Result<()> {
        let initialize = value["method"] == "initialize";
        let response = crate::http()
            .post(&self.url)
            .headers(self.headers.read().await.clone())
            .header("Accept", "application/json, text/event-stream")
            .json(&value)
            .send()
            .await?
            .error_for_status()?;
        if let Some(id) = response.headers().get("mcp-session-id") {
            self.headers
                .write()
                .await
                .insert("mcp-session-id", id.clone());
        }
        if response.status() == reqwest::StatusCode::ACCEPTED {
            return Ok(());
        }
        if response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.starts_with("text/event-stream"))
        {
            let output = self.output.clone();
            let mut protocol = None;
            super::proxy::read_sse(response.bytes_stream(), |_, data| {
                if initialize {
                    protocol = serde_json::from_str::<Value>(&data)
                        .ok()
                        .and_then(|message| {
                            message
                                .pointer("/result/protocolVersion")
                                .and_then(Value::as_str)
                                .map(str::to_string)
                        })
                        .or_else(|| protocol.take());
                }
                let _ = output.send(data);
            })
            .await?;
            if let Some(version) = protocol {
                self.headers
                    .write()
                    .await
                    .insert("mcp-protocol-version", version.parse()?);
            }
        } else {
            let body = response.bytes().await?;
            if body.len() > 16 * 1024 * 1024 {
                bail!("MCP message is too large");
            }
            if !body.is_empty() {
                if initialize {
                    let response: Value = serde_json::from_slice(&body)?;
                    if let Some(version) = response
                        .pointer("/result/protocolVersion")
                        .and_then(Value::as_str)
                    {
                        self.headers
                            .write()
                            .await
                            .insert("mcp-protocol-version", version.parse()?);
                    }
                }
                self.output
                    .send(String::from_utf8(body.to_vec())?)
                    .context("MCP client disconnected")?;
            }
        }
        if initialize {
            self.start_notifications();
        }
        Ok(())
    }

    fn start_notifications(self: &Arc<Self>) {
        let mut task = self.notifications.lock().unwrap();
        if task.is_some() {
            return;
        }
        let connection = Arc::downgrade(self);
        *task = Some(tokio::spawn(async move {
            let Some(connection) = connection.upgrade() else {
                return;
            };
            let result = crate::http()
                .get(&connection.url)
                .headers(connection.headers.read().await.clone())
                .header("Accept", "text/event-stream")
                .send()
                .await;
            let Ok(response) = result else { return };
            if !response.status().is_success() {
                return;
            }
            let output = connection.output.clone();
            drop(connection);
            let _ = super::proxy::read_sse(response.bytes_stream(), move |_, data| {
                let _ = output.send(data);
            })
            .await;
        }));
    }
}

impl Drop for Connection {
    fn drop(&mut self) {
        if let Some(task) = self.notifications.lock().unwrap().take() {
            task.abort();
        }
    }
}

struct OutputTask(JoinHandle<()>);
impl Drop for OutputTask {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// Bridges an ACP stdio-only client onto its chat's authenticated loopback route.
pub async fn run(url: &str) -> Result<()> {
    let parsed = reqwest::Url::parse(url)?;
    if parsed.scheme() != "http"
        || parsed.host_str() != Some("127.0.0.1")
        || !parsed.path().starts_with("/mcp/")
    {
        bail!("the MCP bridge accepts only Carbon's loopback endpoints");
    }
    let (output, mut outgoing) = mpsc::unbounded_channel::<String>();
    let _writer = OutputTask(tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        while let Some(data) = outgoing.recv().await {
            if stdout
                .write_all(format!("{data}\n").as_bytes())
                .await
                .is_err()
            {
                break;
            }
            if stdout.flush().await.is_err() {
                break;
            }
        }
    }));
    let connection = Arc::new(Connection {
        url: url.into(),
        headers: RwLock::default(),
        output,
        notifications: Mutex::new(None),
    });
    let mut input = BufReader::new(tokio::io::stdin());
    let mut requests = tokio::task::JoinSet::new();
    loop {
        let mut line = Vec::new();
        let count = (&mut input)
            .take(16 * 1024 * 1024 + 1)
            .read_until(b'\n', &mut line)
            .await?;
        if count == 0 {
            break;
        }
        if count > 16 * 1024 * 1024 {
            bail!("MCP message is too large");
        }
        let value: Value = serde_json::from_slice(&line)?;
        let ordered = value["method"] == "initialize" || value.get("id").is_none();
        let request = value.get("id").is_some() && value.get("method").is_some();
        let id = value.get("id").cloned().unwrap_or(Value::Null);
        let connection = connection.clone();
        let send = async move {
            if let Err(error) = connection.clone().send(value).await {
                if request {
                    let _ = connection.output.send(json!({"jsonrpc":"2.0","id":id,"error":{"code":-32000,"message":"Carbon's MCP proxy disconnected."}}).to_string());
                } else {
                    eprintln!("[MCP bridge] {error}");
                }
            }
        };
        if ordered {
            send.await;
        } else {
            requests.spawn(send);
        }
        while requests.try_join_next().is_some() {}
    }
    requests.abort_all();
    let _ = crate::http()
        .delete(url)
        .headers(connection.headers.read().await.clone())
        .send()
        .await;
    Ok(())
}

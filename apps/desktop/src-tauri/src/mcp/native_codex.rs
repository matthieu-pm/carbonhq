use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::{
    atomic::{AtomicBool, Ordering::SeqCst},
    Arc, LazyLock, Mutex as StdMutex, Weak,
};
use std::time::Duration;

use anyhow::{bail, Context, Result};
use axum::{
    body::Bytes,
    http::{Method, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use futures_util::{Stream, StreamExt};
use serde_json::{json, Value};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    sync::{broadcast, mpsc, Mutex, Notify},
    task::{AbortHandle, JoinHandle},
};

use super::config::{self, Definition};
use crate::harness::codex::rpc::{Incoming, RequestId, RpcClient};
use crate::mcp_servers::McpTransport;

const TIMEOUT: Duration = Duration::from_secs(300);
#[derive(Default)]
struct SharedResource {
    workers: Vec<Weak<Connection>>,
    epoch: u64,
    blocked: u32,
}
type Workers = HashMap<String, SharedResource>;
static WORKERS: LazyLock<StdMutex<Workers>> = LazyLock::new(Default::default);

// App-server emits absent optional metadata as null; MCP clients expect it omitted.
fn mcp_metadata(mut value: Value) -> Value {
    if let Some(fields) = value.as_object_mut() {
        fields.retain(|_, value| !value.is_null());
    }
    value
}

fn mcp_metadata_list(value: &Value) -> Vec<Value> {
    value
        .as_array()
        .map(|items| items.iter().cloned().map(mcp_metadata).collect())
        .unwrap_or_default()
}

/// Only the tested Figma endpoint may use the reduced native-client protocol.
pub fn eligible(definition: &Definition) -> bool {
    definition.server.transport == McpTransport::Http
        && definition.server.url.as_deref().is_some_and(eligible_url)
}

pub fn eligible_url(resource: &str) -> bool {
    reqwest::Url::parse(resource).ok().is_some_and(|url| {
        url.scheme() == "https"
            && url.host_str() == Some("mcp.figma.com")
            && url.port_or_known_default() == Some(443)
            && url.path() == "/mcp"
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none()
    })
}

pub fn connected(row: &Value) -> bool {
    row["runtimeStatus"] == "connected" && row["authStatus"] != "notLoggedIn"
}

#[derive(Default)]
pub struct Route {
    connection: Mutex<Option<Arc<Connection>>>,
    workers: StdMutex<Vec<Weak<Connection>>>,
    stopped: AtomicBool,
}

impl Route {
    /// Reuses a chat's connection, replacing it after cancellation or a dead worker.
    pub async fn connection(&self, definition: &Definition, cwd: &str) -> Result<Arc<Connection>> {
        self.get_or_open(Connection::open(definition, cwd)).await
    }

    /// Client capabilities outlive a cancelled upstream worker within the same chat route.
    async fn get_or_open(
        &self,
        open: impl std::future::Future<Output = Result<Arc<Connection>>>,
    ) -> Result<Arc<Connection>> {
        let mut slot = self.connection.lock().await;
        if self.stopped.load(SeqCst) {
            bail!("this MCP session has closed");
        }
        if let Some(connection) = slot.as_ref().filter(|c| !c.closed.load(SeqCst)) {
            return Ok(connection.clone());
        }
        let elicitation = slot
            .as_ref()
            .map(|previous| previous.elicitation.lock().unwrap().clone());
        let connection = open.await?;
        if let Some(elicitation) = elicitation {
            *connection.elicitation.lock().unwrap() = elicitation;
        }
        let mut workers = self.workers.lock().unwrap();
        workers.retain(|w| w.strong_count() > 0);
        workers.push(Arc::downgrade(&connection));
        drop(workers);
        if self.stopped.load(SeqCst) {
            connection.stop();
            bail!("this MCP session has closed");
        }
        *slot = Some(connection.clone());
        Ok(connection)
    }

    pub fn stop(&self) {
        self.stopped.store(true, SeqCst);
        for worker in self
            .workers
            .lock()
            .unwrap()
            .iter()
            .filter_map(Weak::upgrade)
        {
            worker.stop();
        }
    }
}

impl Drop for Route {
    fn drop(&mut self) {
        self.stop();
    }
}

pub struct Runtime {
    client: RpcClient,
    closed: AtomicBool,
    exited: AtomicBool,
    exit: Notify,
    shutdown: Notify,
    events: broadcast::Sender<(String, Value)>,
    asks: StdMutex<HashMap<String, RequestId>>,
    elicitation: StdMutex<Value>,
    active: StdMutex<Option<mpsc::UnboundedSender<Value>>>,
    cancelled: StdMutex<HashMap<String, AbortHandle>>,
    calls: Mutex<()>,
}

impl Runtime {
    fn can_elicit(&self, params: &Value) -> bool {
        let capabilities = self.elicitation.lock().unwrap();
        let Some(capabilities) = capabilities.as_object() else {
            return false;
        };
        match params["mode"].as_str().unwrap_or("form") {
            "form" => capabilities.is_empty() || capabilities.contains_key("form"),
            "url" => capabilities.contains_key("url"),
            _ => false,
        }
    }

    fn stop(&self) {
        if !self.closed.swap(true, SeqCst) {
            let _ = self.events.send(("carbon/closed".into(), Value::Null));
            self.client.close();
            self.client.disconnect();
            self.shutdown.notify_one();
        }
    }
}

pub struct Connection {
    runtime: Arc<Runtime>,
    pub thread: String,
    pub name: String,
    _task: JoinHandle<()>,
    pub resource: String,
}

impl std::ops::Deref for Connection {
    type Target = Runtime;
    fn deref(&self) -> &Runtime {
        &self.runtime
    }
}

/// Transport overrides must leave native OAuth credentials in Codex.
async fn worker_config(definition: &Definition) -> Result<Value> {
    let resource = definition
        .server
        .url
        .as_deref()
        .context("missing MCP URL")?;
    let mut headers = serde_json::Map::new();
    for pair in &definition.server.headers {
        headers.insert(pair.name.clone(), json!(config::expand(&pair.value).await?));
    }
    for (key, variable) in &definition.header_env {
        headers.insert(key.clone(), json!(config::env(variable).await?));
    }
    if let Some(variable) = &definition.bearer_token_env {
        headers.insert(
            "Authorization".into(),
            json!(format!("Bearer {}", config::env(variable).await?)),
        );
    }
    if definition.bearer_token_file.is_some() {
        bail!("Figma's Codex connection does not support bearer-token files");
    }
    Ok(
        json!({"mcp_servers":{"carbon_figma":{"url":resource,"enabled":true,"required":false,
        "http_headers":headers,"startup_timeout_sec":20,"tool_timeout_sec":300}},
        "features":{"apps":false,"plugins":false,"mcp_connection_sharing":false}}),
    )
}

impl Connection {
    /// Starts the real installed Codex without creating any model turn.
    pub async fn open(definition: &Definition, cwd: &str) -> Result<Arc<Self>> {
        let config = worker_config(definition).await?;
        let executable = crate::binpath::codex().await;
        let version = tokio::time::timeout(
            Duration::from_secs(5),
            tokio::process::Command::new(&executable)
                .arg("--version")
                .kill_on_drop(true)
                .output(),
        )
        .await
        .context("Codex's version check timed out")?
        .context("Install Codex 0.169.0 or later to connect Figma")?;
        let version = String::from_utf8_lossy(&version.stdout);
        let version = version
            .split_whitespace()
            .last()
            .unwrap_or("")
            .split(['.', '-'])
            .take(3)
            .map(str::parse::<u32>)
            .collect::<std::result::Result<Vec<_>, _>>();
        if !version.is_ok_and(|v| v.len() == 3 && v.as_slice() >= [0, 169, 0].as_slice()) {
            bail!("Update Codex to 0.169.0 or later to connect Figma in Carbon");
        }
        Self::spawn(
            &executable,
            definition,
            cwd,
            "carbon_figma".into(),
            config,
            None,
        )
        .await
    }

    async fn spawn(
        executable: &Path,
        definition: &Definition,
        cwd: &str,
        name: String,
        mut config: Value,
        home: Option<&Path>,
    ) -> Result<Arc<Self>> {
        let resource = definition.server.url.clone().context("missing MCP URL")?;
        let epoch = {
            let mut resources = WORKERS.lock().unwrap();
            let resource = resources.entry(resource.clone()).or_default();
            if resource.blocked > 0 {
                bail!("Figma is signing out. Try again when it finishes.");
            }
            resource.epoch
        };
        let mut command = tokio::process::Command::new(executable);
        command
            .args([
                "app-server",
                "-c",
                "features.apps=false",
                "-c",
                "features.plugins=false",
                "-c",
                "features.mcp_connection_sharing=false",
            ])
            .env("PATH", crate::harness::agent_path(executable))
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        #[cfg(unix)]
        command.process_group(0);
        if let Some(home) = home {
            command
                .env("CODEX_HOME", home)
                .args(["-c", "mcp_oauth_credentials_store=\"file\""]);
        }
        let mut child = command
            .spawn()
            .context("Install a current Codex CLI to connect Figma")?;
        let client = RpcClient::new(child.stdin.take().context("missing Codex input")?);
        let mut stdout = BufReader::new(child.stdout.take().context("missing Codex output")?);
        let (events, _) = broadcast::channel(64);
        let runtime = Arc::new(Runtime {
            client,
            closed: AtomicBool::new(false),
            exited: AtomicBool::new(false),
            exit: Notify::new(),
            shutdown: Notify::new(),
            events,
            asks: Default::default(),
            elicitation: StdMutex::new(Value::Null),
            active: Default::default(),
            cancelled: Default::default(),
            calls: Mutex::new(()),
        });
        let read = runtime.clone();
        let task = tokio::spawn(async move {
            let lines = async {
                loop {
                    let mut line = Vec::new();
                    let count = (&mut stdout)
                        .take(16 * 1024 * 1024 + 1)
                        .read_until(b'\n', &mut line)
                        .await?;
                    if count == 0 {
                        break;
                    }
                    if line.len() > 16 * 1024 * 1024 {
                        bail!("Codex MCP response is too large");
                    }
                    match read.client.accept(std::str::from_utf8(&line)?).await {
                        Incoming::Request {
                            id,
                            method,
                            mut params,
                        } if method == "mcpServer/elicitation/request" => {
                            if !read.can_elicit(&params) {
                                let _ = read
                                    .client
                                    .respond(id, json!({"action":"decline","content":null}));
                                continue;
                            }
                            for key in ["threadId", "turnId", "serverName", "environmentId"] {
                                if let Some(p) = params.as_object_mut() {
                                    p.remove(key);
                                }
                            }
                            let key = format!("carbon-elicitation-{}", uuid::Uuid::new_v4());
                            let active = read.active.lock().unwrap().clone();
                            if let Some(active) = active {
                                read.asks.lock().unwrap().insert(key.clone(), id.clone());
                                if active.send(json!({"jsonrpc":"2.0","id":key,"method":"elicitation/create","params":mcp_metadata(params)})).is_err() {
                                    read.asks.lock().unwrap().remove(&key);
                                    let _ = read.client.respond(id, json!({"action":"cancel","content":null}));
                                }
                            } else {
                                let _ = read
                                    .client
                                    .respond(id, json!({"action":"cancel","content":null}));
                            }
                        }
                        Incoming::Request { id, .. } => {
                            let _ = read.client.respond_err(
                                id,
                                -32601,
                                "Carbon's MCP relay does not support this request",
                            );
                        }
                        Incoming::Notification { method, params } => {
                            let _ = read.events.send((method, params));
                        }
                        _ => {}
                    }
                }
                Ok::<_, anyhow::Error>(())
            };
            tokio::select! {
                _ = lines => {},
                _ = read.shutdown.notified() => {},
                _ = child.wait() => {}
            }
            read.stop();
            if tokio::time::timeout(Duration::from_secs(1), child.wait())
                .await
                .is_err()
            {
                let _ = child.kill().await;
            }
            read.exited.store(true, SeqCst);
            read.exit.notify_waiters();
        });
        let mut connection = Self {
            runtime,
            thread: String::new(),
            name,
            _task: task,
            resource,
        };
        connection.client.request("initialize", json!({"clientInfo":{"name":"carbon-mcp-relay","version":env!("CARGO_PKG_VERSION")},"capabilities":{}})).await
            .context("Update Codex to use its MCP connection in Carbon")?;
        connection.client.notify("initialized", json!({}))?;
        let effective = connection
            .client
            .request("config/read", json!({"cwd":cwd,"includeLayers":false}))
            .await?;
        let transport = config["mcp_servers"]
            .get(&connection.name)
            .cloned()
            .unwrap_or_else(|| json!({"url":connection.resource,"enabled":true}));
        let mut overrides = serde_json::Map::new();
        if let Some(servers) = effective
            .pointer("/config/mcp_servers")
            .and_then(Value::as_object)
        {
            if let Some((name, _)) = servers
                .iter()
                .find(|(_, server)| server["url"] == connection.resource)
            {
                connection.name = name.clone();
            } else {
                while servers.contains_key(&connection.name) {
                    connection.name.push_str("_carbon");
                }
            }
            for (name, server) in servers {
                if server.get("command").and_then(Value::as_str).is_some()
                    || server.get("url").and_then(Value::as_str).is_some()
                {
                    overrides.insert(name.clone(), json!({"enabled":false}));
                }
            }
        }
        overrides.insert(connection.name.clone(), transport);
        config["mcp_servers"] = json!(overrides);
        let result = connection
            .client
            .request(
                "thread/start",
                json!({"cwd":cwd,"ephemeral":true,"config":config}),
            )
            .await?;
        connection.thread = result
            .pointer("/thread/id")
            .and_then(Value::as_str)
            .context("Codex did not open an MCP thread")?
            .into();
        let connection = Arc::new(connection);
        let mut workers = WORKERS.lock().unwrap();
        let resource = workers.entry(connection.resource.clone()).or_default();
        if resource.epoch != epoch || resource.blocked > 0 {
            connection.stop();
            bail!("Figma signed out while this connection was starting");
        }
        resource.workers.retain(|w| w.strong_count() > 0);
        resource.workers.push(Arc::downgrade(&connection));
        Ok(connection)
    }

    pub fn stop(&self) {
        self.runtime.stop();
    }

    pub async fn stopped(&self) {
        let notified = self.exit.notified();
        if !self.exited.load(SeqCst) {
            let _ = tokio::time::timeout(Duration::from_secs(3), notified).await;
        }
    }

    pub async fn inventory(&self) -> Result<Value> {
        let result = self
            .client
            .request(
                "mcpServerStatus/list",
                json!({"threadId":self.thread,"serverName":self.name,"detail":"full"}),
            )
            .await?;
        result["data"]
            .as_array()
            .and_then(|rows| rows.iter().find(|r| r["name"] == self.name))
            .cloned()
            .context("Codex did not report the Figma server")
    }

    /// Returns a browser URL while Codex keeps the authorization callback and grant.
    pub async fn login(
        &self,
    ) -> Result<(String, Option<String>, broadcast::Receiver<(String, Value)>)> {
        let events = self.events.subscribe();
        let result = self
            .client
            .request(
                "mcpServer/oauth/login",
                json!({"threadId":self.thread,"name":self.name,"timeoutSecs":300}),
            )
            .await?;
        let url = result["authorizationUrl"]
            .as_str()
            .context("Codex didn't provide a sign-in URL")?;
        let parsed = reqwest::Url::parse(url)?;
        if !matches!(parsed.scheme(), "https" | "http") {
            bail!("Codex returned an invalid sign-in URL");
        }
        Ok((
            url.into(),
            result["loginId"].as_str().map(str::to_string),
            events,
        ))
    }

    async fn execute(&self, method: &str, params: Value) -> Result<Value> {
        if matches!(method, "tools/call" | "resources/read") {
            let status=self.client.request("mcpServerStatus/list",json!({"threadId":self.thread,"serverName":self.name,"detail":"toolsAndAuthOnly"})).await?;
            let row = status["data"]
                .as_array()
                .and_then(|rows| rows.iter().find(|r| r["name"] == self.name));
            // A live native connection can retain its token after terminal logout.
            if row.is_some_and(|row| row["authStatus"] == "notLoggedIn") {
                self.stop();
                bail!("Sign in to Figma in Settings → MCP");
            }
        }
        match method {
            "initialize" => {
                *self.elicitation.lock().unwrap()=params.pointer("/capabilities/elicitation").cloned().unwrap_or(Value::Null);
                let row = self.inventory().await?;
                if !connected(&row) { bail!("Sign in to Figma in Settings → MCP"); }
                Ok(json!({"protocolVersion":"2025-06-18","serverInfo":mcp_metadata(row["serverInfo"].clone()),"capabilities":{"tools":{},"resources":{}}}))
            }
            "tools/list" => { let row = self.inventory().await?; Ok(json!({"tools":row["tools"].as_object().map(|t| t.values().cloned().map(mcp_metadata).collect::<Vec<_>>()).unwrap_or_default()})) }
            "resources/list" => Ok(json!({"resources":mcp_metadata_list(&self.inventory().await?["resources"])})),
            "resources/templates/list" => Ok(json!({"resourceTemplates":mcp_metadata_list(&self.inventory().await?["resourceTemplates"])})),
            "resources/read" => {
                let mut result=self.client.request_within("mcpServer/resource/read", json!({"threadId":self.thread,"server":self.name,"uri":params["uri"],"_meta":params.get("_meta")}), TIMEOUT).await?;
                result["contents"]=json!(mcp_metadata_list(&result["contents"]));
                Ok(mcp_metadata(result))
            },
            "tools/call" => self.client.request_within("mcpServer/tool/call", json!({"threadId":self.thread,"server":self.name,"tool":params["name"],"arguments":params.get("arguments").cloned().unwrap_or(json!({})),"_meta":params.get("_meta")}), TIMEOUT).await,
            "prompts/list" => Ok(json!({"prompts":[]})),
            _ => bail!("This operation is unavailable on Figma's Codex connection"),
        }
    }

    /// Elicitation travels on the call's SSE response; only the calling agent can answer.
    pub async fn handle(self: &Arc<Self>, method: Method, body: Bytes) -> Result<Response> {
        if method == Method::DELETE {
            self.stop();
            return Ok(StatusCode::OK.into_response());
        }
        if method != Method::POST {
            return Ok(StatusCode::METHOD_NOT_ALLOWED.into_response());
        }
        let message: Value = serde_json::from_slice(&body)?;
        let id = message.get("id").cloned();
        let name = message.get("method").and_then(Value::as_str);
        if name.is_none() {
            if let Some(id) = id.as_ref().and_then(Value::as_str) {
                if let Some(rpc_id) = self.asks.lock().unwrap().remove(id) {
                    if let Some(result) = message.get("result") {
                        self.client.respond(rpc_id, result.clone())?;
                    } else {
                        self.client
                            .respond(rpc_id, json!({"action":"cancel","content":null}))?;
                    }
                }
            }
            return Ok(StatusCode::ACCEPTED.into_response());
        }
        if name == Some("notifications/cancelled") {
            if let Some(id) = message.pointer("/params/requestId") {
                if let Some(task) = self.cancelled.lock().unwrap().remove(&id.to_string()) {
                    task.abort();
                }
            }
            return Ok(StatusCode::ACCEPTED.into_response());
        }
        let Some(id) = id else {
            return Ok(StatusCode::ACCEPTED.into_response());
        };
        let name = name.unwrap().to_string();
        let params = message.get("params").cloned().unwrap_or(json!({}));
        if name != "tools/call" && name != "resources/read" {
            let response = match self.execute(&name, params).await {
                Ok(result) => json!({"jsonrpc":"2.0","id":id,"result":result}),
                Err(_) => {
                    json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"This operation is unavailable. Check Figma in Settings → MCP."}})
                }
            };
            return Ok(Json(response).into_response());
        }
        let (send, receive) = mpsc::unbounded_channel();
        let connection = self.clone();
        let key = id.to_string();
        let task_key = key.clone();
        let guard = Call {
            connection: connection.clone(),
            key: task_key,
            armed: false,
        };
        let (start, ready) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move {
            let mut guard = guard;
            let _ = ready.await;
            let _serial = connection.calls.lock().await;
            guard.armed = true;
            *connection.active.lock().unwrap() = Some(send.clone());
            let outcome = connection.execute(&name, params).await;
            connection.active.lock().unwrap().take();
            for (_, rpc_id) in connection.asks.lock().unwrap().drain() {
                let _ = connection
                    .client
                    .respond(rpc_id, json!({"action":"cancel","content":null}));
            }
            let response = match outcome {
                Ok(result) => {
                    guard.armed = false;
                    json!({"jsonrpc":"2.0","id":id,"result":result})
                }
                Err(_) => {
                    json!({"jsonrpc":"2.0","id":id,"error":{"code":-32000,"message":"Figma's connection closed. Check Settings → MCP."}})
                }
            };
            let _ = send.send(response);
        });
        self.cancelled
            .lock()
            .unwrap()
            .insert(key, task.abort_handle());
        let _ = start.send(());
        let stream = CallStream {
            receive,
            task: task.abort_handle(),
        };
        Ok(axum::response::Sse::new(stream.map(|value| {
            Ok::<_, std::convert::Infallible>(
                axum::response::sse::Event::default()
                    .event("message")
                    .data(value.to_string()),
            )
        }))
        .into_response())
    }
}

impl Drop for Connection {
    fn drop(&mut self) {
        // Let the reader reap Codex before a shared grant can be removed.
        self.stop();
    }
}

struct Call {
    connection: Arc<Connection>,
    key: String,
    armed: bool,
}
impl Drop for Call {
    fn drop(&mut self) {
        self.connection.cancelled.lock().unwrap().remove(&self.key);
        if self.armed {
            self.connection.stop();
        }
    }
}

struct CallStream {
    receive: mpsc::UnboundedReceiver<Value>,
    task: AbortHandle,
}
impl Stream for CallStream {
    type Item = Value;
    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Value>> {
        self.receive.poll_recv(cx)
    }
}
impl Drop for CallStream {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// Closes Carbon-owned users of a shared grant before native logout can remove it.
pub async fn stop_resource(resource: &str) {
    let (workers, _block) = revoke(resource);
    stop_workers(workers).await;
}

/// Invalidates workers still starting before waiting for live ones to exit.
fn revoke(resource: &str) -> (Vec<Arc<Connection>>, Logout) {
    let workers = {
        let mut resources = WORKERS.lock().unwrap();
        let resource = resources.entry(resource.into()).or_default();
        resource.epoch += 1;
        resource.blocked += 1;
        std::mem::take(&mut resource.workers)
    };
    (
        workers.into_iter().filter_map(|w| w.upgrade()).collect(),
        Logout(resource.into()),
    )
}

async fn stop_workers(workers: Vec<Arc<Connection>>) {
    for worker in &workers {
        worker.stop();
    }
    for worker in workers {
        worker.stopped().await;
    }
}

/// Removes the real Codex MCP grant without changing its configuration file.
pub async fn logout(definition: &Definition, cwd: &str) -> Result<()> {
    let resource = definition
        .server
        .url
        .as_deref()
        .context("missing MCP URL")?;
    let worker = Connection::open(definition, cwd).await?;
    let name = worker.name.clone();
    let executable = crate::binpath::codex().await;
    logout_with(&executable, resource, &name, cwd, None).await
}

async fn logout_with(
    executable: &Path,
    resource: &str,
    name: &str,
    cwd: &str,
    home: Option<&Path>,
) -> Result<()> {
    let (workers, _block) = revoke(resource);
    stop_workers(workers).await;
    let url_override = format!(
        "mcp_servers.{}.url={}",
        serde_json::to_string(name)?,
        serde_json::to_string(resource)?
    );
    let mut command = tokio::process::Command::new(executable);
    command
        .args(["-c", &url_override, "mcp", "logout", name])
        .env("PATH", crate::harness::agent_path(executable))
        .current_dir(cwd)
        .kill_on_drop(true);
    if let Some(home) = home {
        command
            .env("CODEX_HOME", home)
            .args(["-c", "mcp_oauth_credentials_store=\"file\""]);
    }
    let output = tokio::time::timeout(Duration::from_secs(30), command.output()).await??;
    if !output.status.success() {
        bail!("Codex couldn't sign out of Figma. Try again.");
    }
    Ok(())
}

struct Logout(String);
impl Drop for Logout {
    fn drop(&mut self) {
        if let Some(resource) = WORKERS.lock().unwrap().get_mut(&self.0) {
            resource.blocked = resource.blocked.saturating_sub(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn fixture() -> (Arc<Connection>, std::path::PathBuf) {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("carbon-native-mcp-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&root).await.unwrap();
        let executable = root.join("codex-fixture");
        tokio::fs::write(&executable, include_str!("fixtures/codex.py"))
            .await
            .unwrap();
        tokio::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700))
            .await
            .unwrap();
        let definition = super::super::tests::stdio();
        let mut definition = definition;
        definition.server.url = Some(format!(
            "https://fixture-{}.example/mcp",
            uuid::Uuid::new_v4()
        ));
        let connection = Connection::spawn(
            &executable,
            &definition,
            root.to_str().unwrap(),
            "fixture".into(),
            json!({}),
            None,
        )
        .await
        .unwrap();
        (connection, root)
    }

    async fn request(connection: &Arc<Connection>, method: &str, params: Value) -> Value {
        let response = connection
            .handle(
                Method::POST,
                Bytes::from(
                    json!({"jsonrpc":"2.0","id":7,"method":method,"params":params}).to_string(),
                ),
            )
            .await
            .unwrap();
        let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
            .await
            .unwrap();
        let text = std::str::from_utf8(&bytes).unwrap();
        if let Some(line) = text.lines().find_map(|line| line.strip_prefix("data:")) {
            serde_json::from_str(line.trim()).unwrap()
        } else {
            serde_json::from_str(text).unwrap()
        }
    }

    #[tokio::test]
    async fn native_calls_keep_schemas_results_and_separate_chat_state() {
        let (first, root) = fixture().await;
        let (second, other) = fixture().await;
        let initialized = request(
            &first,
            "initialize",
            json!({"protocolVersion":"2025-06-18"}),
        )
        .await;
        assert!(initialized["result"]["capabilities"]
            .get("prompts")
            .is_none());
        assert!(initialized["result"]["serverInfo"].get("icons").is_none());
        let tools = request(&first, "tools/list", json!({})).await;
        assert_eq!(tools["result"]["tools"][0]["inputSchema"]["type"], "object");
        assert!(tools["result"]["tools"][0].get("title").is_none());
        assert!(
            tools["result"]["tools"][0]["inputSchema"]["properties"]["nullable"]
                .get("default")
                .unwrap()
                .is_null()
        );
        let set = request(
            &first,
            "tools/call",
            json!({"name":"state","arguments":{"value":"alpha"}}),
        )
        .await;
        let reused = request(&first, "tools/call", json!({"name":"state","arguments":{}})).await;
        let isolated = request(
            &second,
            "tools/call",
            json!({"name":"state","arguments":{}}),
        )
        .await;
        assert_eq!(set["result"], reused["result"]);
        assert_ne!(set["result"], isolated["result"]);
        let failure = request(&first, "tools/call", json!({"name":"fail","arguments":{}})).await;
        assert_eq!(failure["result"]["isError"], true);
        assert_eq!(failure["result"]["structuredContent"]["retained"], true);
        let resource = request(&first, "resources/read", json!({"uri":"fixture://read"})).await;
        assert_eq!(resource["result"]["contents"][0]["text"], "resource-ok");
        first.stop();
        second.stop();
        first.stopped().await;
        second.stopped().await;
        tokio::fs::remove_dir_all(root).await.unwrap();
        tokio::fs::remove_dir_all(other).await.unwrap();
    }

    #[tokio::test]
    async fn elicitation_waits_for_the_calling_agent_and_keeps_its_denial() {
        let (previous, previous_root) = fixture().await;
        let route = Route::default();
        let previous = route.get_or_open(async { Ok(previous) }).await.unwrap();
        request(
            &previous,
            "initialize",
            json!({"capabilities":{"elicitation":{}}}),
        )
        .await;
        previous.stop();
        previous.stopped().await;
        let (connection, root) = fixture().await;
        let connection = route.get_or_open(async { Ok(connection) }).await.unwrap();
        let response = connection
            .handle(
                Method::POST,
                Bytes::from(
                    json!({"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"ask"}})
                        .to_string(),
                ),
            )
            .await
            .unwrap();
        let mut body = response.into_body().into_data_stream();
        let first = tokio::time::timeout(Duration::from_secs(2), body.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let text = std::str::from_utf8(&first).unwrap();
        let ask: Value = serde_json::from_str(
            text.lines()
                .find_map(|line| line.strip_prefix("data:"))
                .unwrap()
                .trim(),
        )
        .unwrap();
        assert_eq!(ask["method"], "elicitation/create");
        assert!(ask["params"].get("threadId").is_none());
        assert!(ask["id"]
            .as_str()
            .unwrap()
            .starts_with("carbon-elicitation-"));
        connection.handle(Method::POST,Bytes::from(json!({"jsonrpc":"2.0","id":ask["id"],"result":{"action":"decline","content":null}}).to_string())).await.unwrap();
        let result = tokio::time::timeout(Duration::from_secs(2), body.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let text = std::str::from_utf8(&result).unwrap();
        let result: Value = serde_json::from_str(
            text.lines()
                .find_map(|line| line.strip_prefix("data:"))
                .unwrap()
                .trim(),
        )
        .unwrap();
        assert_eq!(result["result"]["content"][0]["text"], "decline");
        assert!(connection.asks.lock().unwrap().is_empty());
        connection.stop();
        connection.stopped().await;
        tokio::fs::remove_dir_all(previous_root).await.unwrap();
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn a_client_without_elicitation_support_is_not_left_waiting_for_a_question() {
        let (connection, root) = fixture().await;
        request(&connection, "initialize", json!({"capabilities":{}})).await;
        let reply = tokio::time::timeout(
            Duration::from_secs(2),
            request(&connection, "tools/call", json!({"name":"ask"})),
        )
        .await
        .unwrap();
        assert_eq!(reply["result"]["content"][0]["text"], "decline");
        assert!(connection.asks.lock().unwrap().is_empty());
        connection.stop();
        connection.stopped().await;
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn cancelling_a_call_closes_only_its_chat_worker() {
        let (connection, root) = fixture().await;
        let (other, other_root) = fixture().await;
        let mut events = connection.events.subscribe();
        let response = connection
            .handle(
                Method::POST,
                Bytes::from(
                    json!({"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"slow"}})
                        .to_string(),
                ),
            )
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(2), events.recv())
            .await
            .unwrap()
            .unwrap();
        connection.handle(Method::POST,Bytes::from(json!({"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":7}}).to_string())).await.unwrap();
        connection.stopped().await;
        assert!(connection.closed.load(SeqCst));
        assert!(connection.exited.load(SeqCst));
        let reply = request(
            &other,
            "tools/call",
            json!({"name":"echo","arguments":{"value":"still-connected"}}),
        )
        .await;
        assert_eq!(reply["result"]["content"][0]["text"], "still-connected");
        drop(response);
        other.stop();
        other.stopped().await;
        tokio::fs::remove_dir_all(root).await.unwrap();
        tokio::fs::remove_dir_all(other_root).await.unwrap();
    }

    #[tokio::test]
    async fn sign_out_stops_every_carbon_worker_using_the_shared_resource() {
        let (first, root) = fixture().await;
        let (second, other) = fixture().await;
        WORKERS
            .lock()
            .unwrap()
            .entry(first.resource.clone())
            .or_default()
            .workers
            .push(Arc::downgrade(&second));
        stop_resource(&first.resource).await;
        assert!(first.exited.load(SeqCst));
        assert!(second.exited.load(SeqCst));
        tokio::fs::remove_dir_all(root).await.unwrap();
        tokio::fs::remove_dir_all(other).await.unwrap();
    }

    #[tokio::test]
    async fn a_worker_starting_during_sign_out_cannot_restore_the_connection() {
        let (first, root) = fixture().await;
        let marker = root.join("starting");
        let source=include_str!("fixtures/codex.py").replace("if method == \"initialize\":", &format!("if method == \"initialize\":\n        import pathlib, time\n        pathlib.Path({:?}).touch()\n        time.sleep(0.3)",marker.to_str().unwrap()));
        let executable = root.join("codex-fixture");
        tokio::fs::write(&executable, source).await.unwrap();
        let mut definition = super::super::tests::stdio();
        definition.server.url = Some(first.resource.clone());
        let cwd = root.to_str().unwrap().to_string();
        let pending = tokio::spawn(async move {
            Connection::spawn(
                &executable,
                &definition,
                &cwd,
                "fixture".into(),
                json!({}),
                None,
            )
            .await
        });
        tokio::time::timeout(Duration::from_secs(3), async {
            while !marker.exists() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        stop_resource(&first.resource).await;
        assert!(pending.await.unwrap().is_err());
        assert!(first.exited.load(SeqCst));
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[test]
    fn fallback_is_limited_to_the_canonical_figma_endpoint() {
        assert!(eligible_url("https://mcp.figma.com/mcp"));
        for url in [
            "http://mcp.figma.com/mcp",
            "https://mcp.figma.com.evil.test/mcp",
            "https://user@mcp.figma.com/mcp",
            "https://mcp.figma.com/mcp?token=x",
            "https://mcp.figma.com:444/mcp",
            "https://other.example/mcp",
        ] {
            assert!(!eligible_url(url), "{url}");
        }
    }

    #[tokio::test]
    #[ignore = "requires an installed Codex CLI; uses only a local OAuth fixture"]
    async fn installed_codex_completes_oauth_and_shares_logout() {
        use axum::{
            extract::State,
            http::{HeaderMap, Uri},
            routing::any,
            Router,
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let state = base.clone();
        let app=Router::new().fallback(any(|State(base):State<String>, headers:HeaderMap, uri:Uri, body:Bytes| async move {
            let path=uri.path();
            let result=if path.contains("oauth-protected-resource") { json!({"resource":format!("{base}/mcp"),"authorization_servers":[base],"scopes_supported":["read"]}) }
                else if path.contains("oauth-authorization-server") { json!({"issuer":base,"authorization_endpoint":format!("{base}/authorize"),"token_endpoint":format!("{base}/token"),"registration_endpoint":format!("{base}/register"),"response_types_supported":["code"],"grant_types_supported":["authorization_code","refresh_token"],"token_endpoint_auth_methods_supported":["none"],"code_challenge_methods_supported":["S256"]}) }
                else if path=="/register" { let request:Value=serde_json::from_slice(&body).unwrap(); assert_eq!(request["client_name"],"Codex"); json!({"client_id":"fixture-client","redirect_uris":request["redirect_uris"]}) }
                else if path=="/token" { json!({"access_token":"fixture-access","refresh_token":"fixture-refresh","token_type":"Bearer","expires_in":3600}) }
                else {
                    if headers.get("authorization").and_then(|v|v.to_str().ok())!=Some("Bearer fixture-access") {
                        return (StatusCode::UNAUTHORIZED,[("www-authenticate",format!("Bearer resource_metadata=\"{base}/.well-known/oauth-protected-resource\""))]).into_response();
                    }
                    let request:Value=serde_json::from_slice(&body).unwrap();
                    if request.get("id").is_none() { return StatusCode::ACCEPTED.into_response(); }
                    let result=match request["method"].as_str() {
                        Some("initialize")=>json!({"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"fixture","version":"1"}}),
                        Some("tools/list")=>json!({"tools":[{"name":"echo","inputSchema":{"type":"object"}}]}),
                        Some("tools/call")=>json!({"content":[{"type":"text","text":"authenticated"}]}),
                        Some("resources/list")=>json!({"resources":[]}),
                        Some("resources/templates/list")=>json!({"resourceTemplates":[]}),
                        _=>json!({})
                    };
                    json!({"jsonrpc":"2.0","id":request["id"],"result":result})
                };
            Json(result).into_response()
        })).with_state(state);
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let root =
            std::env::temp_dir().join(format!("carbon-native-oauth-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&root).await.unwrap();
        let resource = format!("{base}/mcp");
        tokio::fs::write(root.join("config.toml"),format!("mcp_oauth_credentials_store='file'\n[features]\napps=false\nplugins=false\n[mcp_servers.fixture]\nurl={resource:?}\n")).await.unwrap();
        let mut definition = super::super::tests::stdio();
        definition.server.url = Some(resource.clone());
        definition.server.transport = McpTransport::Http;
        let executable = crate::binpath::codex().await;
        let config = json!({"mcp_servers":{"fixture":{"url":resource,"enabled":true}},"mcp_oauth_credentials_store":"file"});
        let first = Connection::spawn(
            &executable,
            &definition,
            root.to_str().unwrap(),
            "fixture".into(),
            config.clone(),
            Some(&root),
        )
        .await
        .unwrap();
        let (url, login_id, mut events) = first.login().await.unwrap();
        let authorize = reqwest::Url::parse(&url).unwrap();
        let pairs: HashMap<_, _> = authorize.query_pairs().into_owned().collect();
        let mut callback = reqwest::Url::parse(&pairs["redirect_uri"]).unwrap();
        callback
            .query_pairs_mut()
            .append_pair("code", "fixture-code")
            .append_pair("state", &pairs["state"])
            .append_pair("iss", &base);
        assert!(crate::http()
            .get(callback)
            .send()
            .await
            .unwrap()
            .status()
            .is_success());
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let (method, params) = events.recv().await.unwrap();
                if method == "mcpServer/oauthLogin/completed" {
                    assert_eq!(params["success"], true, "{params}");
                    if let Some(id) = &login_id {
                        assert_eq!(params["loginId"], *id);
                    }
                    break;
                }
            }
        })
        .await
        .unwrap();
        let second = Connection::spawn(
            &executable,
            &definition,
            root.to_str().unwrap(),
            "fixture".into(),
            config.clone(),
            Some(&root),
        )
        .await
        .unwrap();
        assert_eq!(
            second.inventory().await.unwrap()["runtimeStatus"],
            "connected"
        );
        assert_eq!(
            request(&second, "tools/call", json!({"name":"echo"})).await["result"]["content"][0]
                ["text"],
            "authenticated"
        );
        let terminal_logout = tokio::process::Command::new(&executable)
            .args([
                "-c",
                "mcp_oauth_credentials_store=\"file\"",
                "mcp",
                "logout",
                "fixture",
            ])
            .env("CODEX_HOME", &root)
            .current_dir(&root)
            .output()
            .await
            .unwrap();
        assert!(terminal_logout.status.success());
        let after = second.inventory().await.unwrap();
        assert_eq!(after["authStatus"], "notLoggedIn");
        let denied = request(&second, "tools/call", json!({"name":"echo"})).await;
        assert!(denied.get("error").is_some());
        logout_with(
            &executable,
            &resource,
            "fixture",
            root.to_str().unwrap(),
            Some(&root),
        )
        .await
        .unwrap();
        assert!(first.exited.load(SeqCst));
        assert!(second.exited.load(SeqCst));
        let third = Connection::spawn(
            &executable,
            &definition,
            root.to_str().unwrap(),
            "fixture".into(),
            config,
            Some(&root),
        )
        .await
        .unwrap();
        assert_ne!(
            third.inventory().await.unwrap()["runtimeStatus"],
            "connected"
        );
        third.stop();
        third.stopped().await;
        tokio::fs::remove_dir_all(root).await.unwrap();
        server.abort();
    }
}

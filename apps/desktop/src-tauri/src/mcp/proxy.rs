use std::collections::{BTreeMap, HashMap};
use std::convert::Infallible;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering::Relaxed},
    Arc, LazyLock, Mutex as StdMutex,
};
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use axum::{
    body::{Body, Bytes},
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, Method, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::any,
    Json, Router,
};
use futures_util::{Stream, StreamExt};
use serde_json::{json, Value};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::TcpListener,
    sync::{broadcast, mpsc, oneshot, Mutex, OnceCell},
    task::JoinHandle,
};

use super::config::{self, Definition};
use crate::events::{AgentEvent, AgentEventPayload};
use crate::harness::Harness;
use crate::mcp_servers::McpTransport;
use crate::sink::Sink;

const LIMIT: usize = 16 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(300);
type Pending = Arc<StdMutex<HashMap<String, oneshot::Sender<Value>>>>;
type Routes = Arc<StdMutex<HashMap<String, Arc<Entry>>>>;

static HUB: LazyLock<Mutex<Option<Hub>>> = LazyLock::new(Default::default);

/// Probes the proxy's real upstreams without spawning any agent CLI.
pub async fn status() -> crate::mcp_servers::McpStatusReport {
    use crate::mcp_servers::{McpStatus, McpStatusReport, McpStatusRow};
    let definitions = match config::definitions().await {
        Ok(definitions) => definitions,
        Err(error) => {
            return McpStatusReport {
                errors: vec![crate::mcp_servers::McpStatusError {
                    harness: Harness::ClaudeCode,
                    error: error.to_string(),
                }],
                ..Default::default()
            }
        }
    };
    let semaphore = Arc::new(tokio::sync::Semaphore::new(4));
    let checks = definitions.into_iter().map(|(definition, signed_out)| {
        let semaphore = semaphore.clone();
        async move {
            let _permit = semaphore.acquire().await;
            let status = if !definition.server.enabled {
                McpStatus::Disabled
            } else if signed_out {
                McpStatus::NeedsAuth
            } else {
                tokio::time::timeout(Duration::from_secs(30), probe(&definition))
                    .await
                    .ok()
                    .and_then(Result::ok)
                    .unwrap_or(McpStatus::Failed)
            };
            McpStatusRow {
                owner: Harness::ClaudeCode,
                project: definition.project,
                name: definition.server.name,
                status,
            }
        }
    });
    McpStatusReport {
        statuses: futures_util::future::join_all(checks).await,
        ..Default::default()
    }
}

async fn probe(definition: &Definition) -> Result<crate::mcp_servers::McpStatus> {
    use crate::mcp_servers::McpStatus;
    let message = json!({"jsonrpc":"2.0", "id":1, "method":"initialize", "params": {
        "protocolVersion":"2025-06-18", "capabilities":{}, "clientInfo":{"name":"carbon", "version":env!("CARGO_PKG_VERSION")}
    }});
    if definition.server.transport == McpTransport::Http {
        let url = config::expand(definition.server.url.as_deref().context("missing URL")?).await?;
        let headers = match config::headers(definition).await {
            Ok(headers) => headers,
            Err(_) => return Ok(McpStatus::NeedsAuth),
        };
        let response = crate::http()
            .post(&url)
            .headers(headers)
            .header("Accept", "application/json, text/event-stream")
            .json(&message)
            .send()
            .await?;
        if response.status() == StatusCode::UNAUTHORIZED
            && super::native_codex::eligible(definition)
        {
            let cwd = definition
                .project
                .clone()
                .or_else(|| std::env::home_dir().map(|p| p.to_string_lossy().into_owned()))
                .unwrap_or("/".into());
            let connection = super::native_codex::Connection::open(definition, &cwd).await?;
            let row = connection.inventory().await?;
            return Ok(if super::native_codex::connected(&row) {
                McpStatus::Connected
            } else if row["authStatus"] == "notLoggedIn"
                || row["runtimeStatus"] == "authenticationRequired"
            {
                McpStatus::NeedsAuth
            } else {
                McpStatus::Failed
            });
        }
        if let Some(session) = response.headers().get("mcp-session-id").cloned() {
            let _ = crate::http()
                .delete(&url)
                .headers(config::headers(definition).await?)
                .header("mcp-session-id", session)
                .send()
                .await;
        }
        return Ok(if response.status() == StatusCode::UNAUTHORIZED {
            McpStatus::NeedsAuth
        } else if response.status().is_success() {
            McpStatus::Connected
        } else {
            McpStatus::Failed
        });
    }
    let (notices, _) = mpsc::unbounded_channel();
    let cwd = definition
        .project
        .clone()
        .or_else(|| std::env::home_dir().map(|p| p.to_string_lossy().into_owned()))
        .unwrap_or("/".into());
    let peer = Peer::open(definition, &cwd, notices).await?;
    let response = peer
        .send(message)
        .await?
        .context("MCP server returned no initialization")?;
    Ok(if response.get("result").is_some() {
        McpStatus::Connected
    } else {
        McpStatus::Failed
    })
}

struct Hub {
    port: u16,
    routes: Routes,
    task: JoinHandle<()>,
}

struct Entry {
    definition: Definition,
    cwd: String,
    peer: OnceCell<Result<Arc<Peer>, String>>,
    notices: mpsc::UnboundedSender<String>,
    failed: AtomicBool,
    native: super::native_codex::Route,
    use_native: AtomicBool,
}

impl Entry {
    fn report(&self, message: &str) {
        if !self.failed.swap(true, Relaxed) {
            let _ = self.notices.send(format!(
                "MCP server ‘{}’: {message}",
                self.definition.server.name
            ));
        }
    }

    async fn peer(&self) -> Result<Arc<Peer>> {
        self.peer
            .get_or_init(|| async {
                Peer::open(&self.definition, &self.cwd, self.notices.clone())
                    .await
                    .map(Arc::new)
                    .map_err(|_| {
                        "Couldn't start the MCP server. Check it in Settings → MCP.".into()
                    })
            })
            .await
            .clone()
            .map_err(|message| anyhow!(message))
    }
}

/// Owns a chat's routes and upstream processes, including across its idle turns.
pub struct SessionProxy {
    port: u16,
    routes: Routes,
    keys: Vec<String>,
    pub servers: BTreeMap<String, String>,
    suppressed: BTreeMap<String, String>,
    notices: Option<mpsc::UnboundedReceiver<String>>,
    reporter: Option<JoinHandle<()>>,
    directory: Option<PathBuf>,
}

impl std::fmt::Debug for SessionProxy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SessionProxy")
            .field("servers", &self.servers.keys().collect::<Vec<_>>())
            .finish()
    }
}

impl SessionProxy {
    /// Allocates authenticated loopback routes without starting MCP processes yet.
    pub async fn new(cwd: &str, harness: Harness) -> Result<Self> {
        let definitions = config::effective(cwd).await?;
        let mut proxy = Self::from_definitions(definitions, cwd).await?;
        let native = if matches!(harness, Harness::Grok | Harness::Fx) {
            config::native(harness, cwd).await?
        } else {
            BTreeMap::new()
        };
        for (_, mut server) in native {
            if proxy.servers.contains_key(&server.name) {
                continue;
            }
            server.enabled = false;
            let name = server.name.clone();
            let url = proxy.add(
                Definition {
                    server,
                    project: None,
                    header_env: Default::default(),
                    bearer_token_env: None,
                    oauth: None,
                    cwd: None,
                    bearer_token_file: None,
                },
                cwd,
            )?;
            proxy.suppressed.insert(name, url);
        }
        Ok(proxy)
    }

    async fn from_definitions(definitions: Vec<Definition>, cwd: &str) -> Result<Self> {
        let mut hub = HUB.lock().await;
        if hub.as_ref().is_some_and(|hub| hub.task.is_finished()) {
            *hub = None;
        }
        if hub.is_none() {
            let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await?;
            let port = listener.local_addr()?.port();
            let routes: Routes = Default::default();
            let app = Router::new()
                .route("/mcp/{key}/{name}", any(handle))
                .layer(DefaultBodyLimit::max(LIMIT))
                .with_state(routes.clone());
            let watched = routes.clone();
            let task = tokio::spawn(async move {
                let result = tokio::spawn(async move { axum::serve(listener, app).await }).await;
                eprintln!("[MCP listener stopped] {result:?}");
                for entry in watched.lock().unwrap().values() {
                    entry.report("Carbon's MCP proxy stopped. Start a new session to reconnect.");
                }
            });
            *hub = Some(Hub { port, routes, task });
        }
        let hub = hub.as_ref().unwrap();
        let (notices_tx, notices) = mpsc::unbounded_channel();
        let mut proxy = Self {
            port: hub.port,
            routes: hub.routes.clone(),
            keys: Vec::new(),
            servers: BTreeMap::new(),
            suppressed: BTreeMap::new(),
            notices: Some(notices),
            reporter: None,
            directory: None,
        };
        for definition in definitions {
            let key = format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            );
            let name = definition.server.name.clone();
            let mut encoded = reqwest::Url::parse("http://localhost")?;
            encoded.path_segments_mut().unwrap().push(&name);
            let encoded = encoded.path().trim_start_matches('/');
            proxy.servers.insert(
                name,
                format!("http://127.0.0.1:{}/mcp/{key}/{encoded}", hub.port),
            );
            proxy.keys.push(key.clone());
            hub.routes.lock().unwrap().insert(
                key,
                Arc::new(Entry {
                    definition,
                    cwd: cwd.into(),
                    peer: OnceCell::new(),
                    notices: notices_tx.clone(),
                    failed: AtomicBool::new(false),
                    native: Default::default(),
                    use_native: AtomicBool::new(false),
                }),
            );
        }
        Ok(proxy)
    }

    fn add(&mut self, definition: Definition, cwd: &str) -> Result<String> {
        let mut url = reqwest::Url::parse(&format!("http://127.0.0.1:{}", self.port))?;
        let key = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        url.path_segments_mut()
            .unwrap()
            .clear()
            .push("mcp")
            .push(&key)
            .push(&definition.server.name);
        let (notices, _) = mpsc::unbounded_channel();
        self.routes.lock().unwrap().insert(
            key.clone(),
            Arc::new(Entry {
                definition,
                cwd: cwd.into(),
                peer: OnceCell::new(),
                notices,
                failed: AtomicBool::new(false),
                native: Default::default(),
                use_native: AtomicBool::new(false),
            }),
        );
        self.keys.push(key);
        Ok(url.into())
    }

    /// Keeps proxy failures visible in the owning chat using its existing event counter.
    pub fn attach(&mut self, session_id: &str, harness: Harness, seq: Arc<AtomicU64>, sink: Sink) {
        let Some(mut notices) = self.notices.take() else {
            return;
        };
        let session_id = session_id.to_string();
        self.reporter = Some(tokio::spawn(async move {
            while let Some(text) = notices.recv().await {
                let event = AgentEvent::mint(
                    session_id.clone(),
                    harness,
                    seq.fetch_add(1, Relaxed),
                    None,
                    None,
                    AgentEventPayload::Notice { text, model: None },
                );
                let _ = sink.emit("agent_event", &event);
                if let Err(error) = crate::store::append_session_event(&session_id, event).await {
                    eprintln!("[MCP notice] {error:#}");
                }
            }
        }));
    }

    /// Names stay identical so tool rows and agent permission rules still match.
    pub fn claude(&self) -> String {
        json!({"mcpServers": self.servers.iter().map(|(name,url)| (name.clone(), json!({"type":"http", "url":url}))).collect::<serde_json::Map<_,_>>()} ).to_string()
    }

    /// Codex deep-merges tables, so an existing stdio transport keeps a stdio bridge.
    pub async fn codex_config(&self, cwd: &str) -> Result<Value> {
        let native = config::native(Harness::Codex, cwd).await?;
        let mut overrides = serde_json::Map::new();
        for name in native
            .keys()
            .filter(|name| !self.servers.contains_key(*name))
        {
            overrides.insert(name.clone(), json!({"enabled":false}));
        }
        let executable = std::env::current_exe()?;
        for (name, url) in &self.servers {
            if native
                .get(name)
                .is_some_and(|s| s.transport == McpTransport::Stdio)
            {
                overrides.insert(
                    name.clone(),
                    json!({"command":executable,"args":["--mcp-bridge",url],"enabled":true}),
                );
            } else {
                overrides.insert(name.clone(), json!({"url":url,"enabled":true}));
            }
        }
        Ok(json!({"mcp_servers":overrides}))
    }

    /// ACP agents advertise HTTP; the stdio bridge covers agents that do not.
    pub fn acp(&self, http: bool) -> Result<Vec<Value>> {
        let executable = std::env::current_exe()?;
        Ok(self.servers.iter().map(|(name,url)| if http {
            json!({"type":"http", "name":name, "url":url, "headers":[]})
        } else {
            json!({"name":name, "command":executable, "args":["--mcp-bridge",url], "env":[]})
        }).collect())
    }

    /// Empty endpoints shadow disk merges after a removal or sign-out.
    pub fn acp_merged(&self) -> Result<Vec<Value>> {
        let mut servers = self.acp(true)?;
        servers.extend(
            self.suppressed
                .iter()
                .map(|(name, url)| json!({"type":"http", "name":name,"url":url,"headers":[]})),
        );
        Ok(servers)
    }

    /// Pi's extension tools preserve its own permission extensions and server names.
    pub async fn pi_extension(&mut self) -> Result<PathBuf> {
        let dir = crate::store::get_home_app_dir()
            .await?
            .join("mcp-runtime")
            .join(uuid::Uuid::new_v4().to_string());
        tokio::fs::create_dir_all(&dir).await?;
        let path = dir.join("proxy.mjs");
        let source = include_str!("pi.mjs").replace(
            "/* CARBON_SERVERS */",
            &serde_json::to_string(&self.servers)?,
        );
        crate::store::write_private_atomic(&path, source.as_bytes())?;
        self.directory = Some(dir);
        Ok(path)
    }
}

impl Drop for SessionProxy {
    fn drop(&mut self) {
        let mut routes = self.routes.lock().unwrap();
        for key in &self.keys {
            if let Some(entry) = routes.remove(key) {
                entry.native.stop();
            }
        }
        if let Some(reporter) = self.reporter.take() {
            reporter.abort();
        }
        if let Some(dir) = self.directory.take() {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
}

async fn handle(
    State(routes): State<Routes>,
    Path((key, name)): Path<(String, String)>,
    method: Method,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    // Browsers must never be able to spend a chat's MCP credentials.
    if headers.contains_key("origin") {
        return StatusCode::FORBIDDEN.into_response();
    }
    let entry = routes.lock().unwrap().get(&key).cloned();
    let Some(entry) = entry.filter(|e| e.definition.server.name == name) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !entry.definition.server.enabled {
        if method != Method::POST {
            return StatusCode::METHOD_NOT_ALLOWED.into_response();
        }
        let Ok(message) = serde_json::from_slice::<Value>(&body) else {
            return StatusCode::BAD_REQUEST.into_response();
        };
        let Some(id) = message.get("id") else {
            return StatusCode::ACCEPTED.into_response();
        };
        let result = match message["method"].as_str() {
            Some("initialize") => json!({"protocolVersion":message["params"]["protocolVersion"], "capabilities":{}, "serverInfo":{"name":name,"version":"1"}}),
            Some("tools/list") => json!({"tools":[]}),
            Some("resources/list") => json!({"resources":[]}),
            Some("resources/templates/list") => json!({"resourceTemplates":[]}),
            Some("prompts/list") => json!({"prompts":[]}),
            _ => return Json(json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"This MCP server is disconnected in Carbon."}})).into_response(),
        };
        return Json(json!({"jsonrpc":"2.0","id":id,"result":result})).into_response();
    }
    let result = if entry.definition.server.transport == McpTransport::Http {
        forward_http(&entry, method, headers, body).await
    } else {
        forward_peer(&entry, method, body).await
    };
    match result {
        Ok(response) => response,
        Err(_) => {
            entry.report("Connection failed. Check Settings → MCP, then start a new session.");
            (StatusCode::BAD_GATEWAY, Json(json!({"jsonrpc":"2.0", "id":null, "error":{"code":-32000,"message":"Carbon couldn't reach this MCP server. Check Settings → MCP."}}))).into_response()
        }
    }
}

async fn forward_http(
    entry: &Arc<Entry>,
    method: Method,
    incoming: HeaderMap,
    body: Bytes,
) -> Result<Response> {
    if !matches!(method, Method::GET | Method::POST | Method::DELETE) {
        return Ok(StatusCode::METHOD_NOT_ALLOWED.into_response());
    }
    if entry.use_native.load(Relaxed) {
        let connection = entry
            .native
            .connection(&entry.definition, &entry.cwd)
            .await?;
        return connection.handle(method, body).await;
    }
    let url = entry
        .definition
        .server
        .url
        .as_deref()
        .context("missing MCP URL")?;
    let mut headers = config::headers(&entry.definition).await?;
    for key in [
        "accept",
        "content-type",
        "mcp-session-id",
        "mcp-protocol-version",
        "last-event-id",
    ] {
        if let Some(value) = incoming.get(key) {
            headers.insert(axum::http::HeaderName::from_static(key), value.clone());
        }
    }
    let response = crate::http()
        .request(method.clone(), config::expand(url).await?)
        .headers(headers)
        .body(body.clone())
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await?;
    if response.status() == StatusCode::UNAUTHORIZED {
        let initialize = serde_json::from_slice::<Value>(&body)
            .ok()
            .is_some_and(|message| message["method"] == "initialize");
        if initialize && super::native_codex::eligible(&entry.definition) {
            let connection = entry
                .native
                .connection(&entry.definition, &entry.cwd)
                .await?;
            let inventory = connection.inventory().await?;
            if super::native_codex::connected(&inventory) {
                entry.use_native.store(true, Relaxed);
                return connection.handle(method, body).await;
            }
        }
        entry.report("Sign in to this server in Settings → MCP.");
    } else if response.status().is_server_error() {
        entry.report("The MCP server returned an error.");
    } else {
        entry.failed.store(false, Relaxed);
    }
    let status = response.status();
    let mut headers = response.headers().clone();
    for key in [
        "connection",
        "transfer-encoding",
        "content-length",
        "www-authenticate",
        "set-cookie",
    ] {
        headers.remove(key);
    }
    let entry = entry.clone();
    let stream = response.bytes_stream().map(move |result| {
        if result.is_err() {
            entry.report("The connection closed unexpectedly. Start a new session to reconnect.");
        }
        result
    });
    let mut response = Response::new(Body::from_stream(stream));
    *response.status_mut() = status;
    *response.headers_mut() = headers;
    Ok(response)
}

async fn forward_peer(entry: &Arc<Entry>, method: Method, body: Bytes) -> Result<Response> {
    let peer = entry.peer().await?;
    match method {
        Method::GET => {
            let events = peer.events.subscribe();
            let stream = futures_util::stream::unfold(events, |mut events| async move {
                match events.recv().await {
                    Ok(value) => Some((
                        Ok::<_, Infallible>(
                            Event::default().event("message").data(value.to_string()),
                        ),
                        events,
                    )),
                    Err(_) => None,
                }
            });
            Ok(Sse::new(stream)
                .keep_alive(KeepAlive::default())
                .into_response())
        }
        Method::POST => {
            let value: Value = serde_json::from_slice(&body)?;
            if !value.is_object() {
                return Ok(StatusCode::BAD_REQUEST.into_response());
            }
            match peer.send(value).await? {
                Some(value) => Ok(Json(value).into_response()),
                None => Ok(StatusCode::ACCEPTED.into_response()),
            }
        }
        Method::DELETE => Ok(StatusCode::OK.into_response()),
        _ => Ok(StatusCode::METHOD_NOT_ALLOWED.into_response()),
    }
}

struct Peer {
    writer: mpsc::Sender<Value>,
    pending: Pending,
    events: broadcast::Sender<Value>,
    task: JoinHandle<()>,
}

impl Peer {
    async fn open(
        definition: &Definition,
        cwd: &str,
        notices: mpsc::UnboundedSender<String>,
    ) -> Result<Self> {
        let pending: Pending = Default::default();
        let (events, _) = broadcast::channel(256);
        let (writer, mut outgoing) = mpsc::channel::<Value>(64);
        let incoming = pending.clone();
        let notifications = events.clone();
        let name = definition.server.name.clone();
        let task = if definition.server.transport == McpTransport::Stdio {
            let program = config::expand(
                definition
                    .server
                    .command
                    .as_deref()
                    .context("missing MCP command")?,
            )
            .await?;
            let mut command = tokio::process::Command::new(expand_home(&program));
            command.env_clear();
            for key in [
                "HOME",
                "LOGNAME",
                "SHELL",
                "TERM",
                "USER",
                "TMPDIR",
                "TMP",
                "TEMP",
                "SystemRoot",
                "COMSPEC",
                "PATHEXT",
            ] {
                if let Some(value) = std::env::var_os(key) {
                    command.env(key, value);
                }
            }
            for arg in &definition.server.args {
                command.arg(config::expand(arg).await?);
            }
            for pair in &definition.server.env {
                command.env(&pair.name, config::expand(&pair.value).await?);
            }
            let working_dir = match &definition.cwd {
                Some(cwd) => config::expand(cwd).await?,
                None => cwd.into(),
            };
            let working_dir = PathBuf::from(expand_home(&working_dir));
            let working_dir = if working_dir.is_absolute() {
                working_dir
            } else {
                std::path::Path::new(cwd).join(working_dir)
            };
            command
                .env(
                    "PATH",
                    crate::harness::agent_path(std::path::Path::new(&program)),
                )
                .current_dir(working_dir)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .kill_on_drop(true);
            #[cfg(unix)]
            command.process_group(0);
            let mut child = command.spawn().context("couldn't start MCP command")?;
            let mut stdin = child.stdin.take().context("missing MCP stdin")?;
            let mut stdout = BufReader::new(child.stdout.take().context("missing MCP stdout")?);
            let pid = child.id();
            tokio::spawn(async move {
                let _tree = ProcessTree(pid);
                let read = async {
                    loop {
                        let mut line = Vec::new();
                        let count = (&mut stdout)
                            .take((LIMIT + 1) as u64)
                            .read_until(b'\n', &mut line)
                            .await?;
                        if count == 0 {
                            return Ok::<_, anyhow::Error>(());
                        }
                        if line.len() > LIMIT {
                            bail!("MCP message is too large");
                        }
                        deliver(serde_json::from_slice(&line)?, &incoming, &notifications);
                    }
                };
                let write = async {
                    while let Some(value) = outgoing.recv().await {
                        stdin.write_all(format!("{value}\n").as_bytes()).await?;
                        stdin.flush().await?;
                    }
                    Ok::<_, anyhow::Error>(())
                };
                tokio::select! { _ = read => {}, _ = write => {}, _ = child.wait() => {} }
                incoming.lock().unwrap().clear();
                let _ = notices.send(format!(
                    "MCP server ‘{name}’ stopped. Start a new session to reconnect."
                ));
            })
        } else {
            let url = config::expand(
                definition
                    .server
                    .url
                    .as_deref()
                    .context("missing SSE URL")?,
            )
            .await?;
            let response = crate::http()
                .get(&url)
                .header("Accept", "text/event-stream")
                .headers(config::headers(definition).await?)
                .send()
                .await?
                .error_for_status()?;
            let definition = definition.clone();
            let on_close = incoming.clone();
            tokio::spawn(async move {
                let (endpoint_out, mut endpoint_in) = mpsc::channel(1);
                let read = read_sse(response.bytes_stream(), move |event, data| {
                    if event == "endpoint" {
                        let _ = endpoint_out.try_send(data);
                    } else if let Ok(value) = serde_json::from_str(&data) {
                        deliver(value, &incoming, &notifications);
                    }
                });
                let write = async {
                    let endpoint = endpoint_in
                        .recv()
                        .await
                        .context("SSE server sent no endpoint")?;
                    let base = reqwest::Url::parse(&url)?;
                    let endpoint = base.join(&endpoint)?;
                    if base.origin() != endpoint.origin() {
                        bail!("SSE endpoint changed origin");
                    }
                    while let Some(value) = outgoing.recv().await {
                        crate::http()
                            .post(endpoint.clone())
                            .headers(config::headers(&definition).await?)
                            .json(&value)
                            .send()
                            .await?
                            .error_for_status()?;
                    }
                    Ok::<_, anyhow::Error>(())
                };
                tokio::select! { _ = read => {}, _ = write => {} }
                on_close.lock().unwrap().clear();
                let _ = notices.send(format!(
                    "MCP server ‘{name}’ disconnected. Start a new session to reconnect."
                ));
            })
        };
        Ok(Self {
            writer,
            pending,
            events,
            task,
        })
    }

    async fn send(&self, value: Value) -> Result<Option<Value>> {
        let request = value.get("id").filter(|_| value.get("method").is_some());
        let waiting = request.map(|id| {
            let key = id.to_string();
            let (tx, rx) = oneshot::channel();
            self.pending.lock().unwrap().insert(key.clone(), tx);
            (key, rx)
        });
        let _cleanup = waiting.as_ref().map(|(key, _)| PendingRequest {
            pending: self.pending.clone(),
            key: key.clone(),
        });
        self.writer
            .send(value)
            .await
            .context("MCP connection is closed")?;
        let Some((key, rx)) = waiting else {
            return Ok(None);
        };
        let result = tokio::time::timeout(REQUEST_TIMEOUT, rx).await;
        self.pending.lock().unwrap().remove(&key);
        Ok(Some(
            result
                .context("MCP request timed out")?
                .context("MCP server disconnected")?,
        ))
    }
}

struct PendingRequest {
    pending: Pending,
    key: String,
}
impl Drop for PendingRequest {
    fn drop(&mut self) {
        self.pending.lock().unwrap().remove(&self.key);
    }
}

impl Drop for Peer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

struct ProcessTree(Option<u32>);

impl Drop for ProcessTree {
    fn drop(&mut self) {
        #[cfg(unix)]
        if let Some(pid) = self.0 {
            unsafe {
                libc::kill(-(pid as i32), libc::SIGKILL);
            }
        }
    }
}

fn deliver(value: Value, pending: &Pending, events: &broadcast::Sender<Value>) {
    if value.get("method").is_none() {
        if let Some(sender) = value
            .get("id")
            .and_then(|id| pending.lock().unwrap().remove(&id.to_string()))
        {
            let _ = sender.send(value);
            return;
        }
    }
    let _ = events.send(value);
}

fn expand_home(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = std::env::home_dir() {
            return home.join(rest).to_string_lossy().into_owned();
        }
    }
    path.into()
}

/// Parses SSE incrementally, including split UTF-8, CRLF and multiline data fields.
pub async fn read_sse<S, E>(stream: S, mut event: impl FnMut(String, String)) -> Result<()>
where
    S: Stream<Item = Result<Bytes, E>>,
    E: std::error::Error + Send + Sync + 'static,
{
    futures_util::pin_mut!(stream);
    let mut buffer = Vec::new();
    let mut kind = String::new();
    let mut data = Vec::new();
    while let Some(chunk) = stream.next().await {
        buffer.extend_from_slice(&chunk?);
        if buffer.len() > LIMIT {
            bail!("SSE message is too large");
        }
        while let Some(end) = buffer.iter().position(|b| *b == b'\n') {
            let line: Vec<_> = buffer.drain(..=end).collect();
            let line = std::str::from_utf8(&line)?.trim_end_matches(['\r', '\n']);
            if line.is_empty() {
                if !data.is_empty() {
                    event(std::mem::take(&mut kind), data.join("\n"));
                    data.clear();
                }
            } else if let Some(value) = line.strip_prefix("event:") {
                kind = value.strip_prefix(' ').unwrap_or(value).into();
            } else if let Some(value) = line.strip_prefix("data:") {
                data.push(value.strip_prefix(' ').unwrap_or(value).to_string());
            }
            if data.iter().map(String::len).sum::<usize>() > LIMIT {
                bail!("SSE message is too large");
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::tests::{initialize, post, state, stdio};

    fn runtime() -> &'static tokio::runtime::Runtime {
        static RUNTIME: std::sync::OnceLock<tokio::runtime::Runtime> = std::sync::OnceLock::new();
        RUNTIME.get_or_init(|| tokio::runtime::Runtime::new().unwrap())
    }

    #[test]
    fn legacy_sse_connections_stay_separate_and_reuse_their_endpoint() {
        runtime().block_on(async {
            type Connections = Arc<Mutex<HashMap<String, (broadcast::Sender<Value>, u64)>>>;
            let connections: Connections = Default::default();
            let app = Router::new().route("/events", axum::routing::get(|State(connections): State<Connections>| async move {
                let id = uuid::Uuid::new_v4().to_string();
                let (tx, rx) = broadcast::channel::<Value>(32);
                connections.lock().await.insert(id.clone(), (tx,0));
                let endpoint = futures_util::stream::once(async move { Ok::<_, Infallible>(Event::default().event("endpoint").data(format!("/messages/{id}"))) });
                let messages = futures_util::stream::unfold(rx, |mut rx| async {
                    rx.recv().await.ok().map(|value| (Ok::<_,Infallible>(Event::default().event("message").data(value.to_string())),rx))
                });
                Sse::new(endpoint.chain(messages))
            })).route("/messages/{id}", axum::routing::post(|State(connections): State<Connections>, Path(id): Path<String>, Json(message): Json<Value>| async move {
                let mut connections = connections.lock().await;
                let (tx,counter) = connections.get_mut(&id).unwrap();
                let result = if message["method"] == "initialize" {
                    json!({"protocolVersion":"2025-06-18", "capabilities":{"tools":{}},"serverInfo":{"name":"fixture","version":"1"},"instructions":id})
                } else { *counter += 1; json!({"counter":*counter}) };
                let _ = tx.send(json!({"jsonrpc":"2.0","id":message["id"],"result":result}));
                StatusCode::ACCEPTED
            })).with_state(connections);
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let url = format!("http://{}/events", listener.local_addr().unwrap());
            let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap(); });
            let mut definition = stdio();
            definition.server.transport = McpTransport::Sse;
            definition.server.url = Some(url);
            let first = SessionProxy::from_definitions(vec![definition.clone()], "/tmp").await.unwrap();
            let second = SessionProxy::from_definitions(vec![definition], "/tmp").await.unwrap();
            let a = &first.servers["fixture"];
            let b = &second.servers["fixture"];
            let (one,two) = tokio::join!(post(a,initialize()), post(b,initialize()));
            assert_ne!(one["result"]["instructions"],two["result"]["instructions"]);
            let call = json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"count"}});
            assert_eq!(post(a,call.clone()).await["result"]["counter"],1);
            assert_eq!(post(b,call.clone()).await["result"]["counter"],1);
            assert_eq!(post(a,call).await["result"]["counter"],2);
            server.abort();
        });
    }

    #[test]
    fn chats_keep_separate_processes_and_reuse_them_between_calls() {
        runtime().block_on(async {
            let first = SessionProxy::from_definitions(vec![stdio()], "/tmp")
                .await
                .unwrap();
            let second = SessionProxy::from_definitions(vec![stdio()], "/tmp")
                .await
                .unwrap();
            let a = &first.servers["fixture"];
            let b = &second.servers["fixture"];
            assert_ne!(a, b);
            let initialized = post(a, initialize()).await;
            assert_eq!(
                initialized["result"]["instructions"],
                "Keep this server's instructions verbatim.\nSecond line."
            );
            assert_eq!(initialized["result"]["_meta"], json!({"fixture":true}));
            post(b, initialize()).await;
            let written = state(a, Some("first chat")).await;
            let other = state(b, None).await;
            assert_eq!(other["value"], Value::Null);
            assert_ne!(written["pid"], other["pid"]);
            let reread = state(a, None).await;
            assert_eq!(reread, written);
            let url = a.clone();
            let pid = written["pid"].as_i64().unwrap() as i32;
            drop(first);
            assert_eq!(
                crate::http()
                    .post(&url)
                    .json(&initialize())
                    .send()
                    .await
                    .unwrap()
                    .status(),
                StatusCode::NOT_FOUND
            );
            for _ in 0..40 {
                if unsafe { libc::kill(pid, 0) } != 0 {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
            assert_ne!(
                unsafe { libc::kill(pid, 0) },
                0,
                "the upstream process must leave with its chat"
            );
            assert_eq!(state(b, None).await, other);
        });
    }

    #[test]
    fn stdio_notifications_reach_the_http_client() {
        runtime().block_on(async {
            let proxy = SessionProxy::from_definitions(vec![stdio()], "/tmp")
                .await
                .unwrap();
            let url = &proxy.servers["fixture"];
            post(url, initialize()).await;
            let response = crate::http()
                .get(url)
                .header("Accept", "text/event-stream")
                .send()
                .await
                .unwrap();
            let (events_tx, mut events_rx) = mpsc::unbounded_channel();
            let reader = tokio::spawn(async move {
                read_sse(response.bytes_stream(), move |_, data| {
                    let _ = events_tx.send(data);
                })
                .await
            });
            post(
                url,
                json!({"jsonrpc":"2.0", "id":3,"method":"fixture/notify"}),
            )
            .await;
            let event = tokio::time::timeout(Duration::from_secs(2), events_rx.recv())
                .await
                .unwrap()
                .unwrap();
            assert_eq!(
                serde_json::from_str::<Value>(&event).unwrap()["method"],
                "notifications/tools/list_changed"
            );
            reader.abort();
        });
    }

    #[test]
    fn a_dead_upstream_reports_a_notice_and_fails_the_call() {
        runtime().block_on(async {
        let mut proxy = SessionProxy::from_definitions(vec![stdio()], "/tmp").await.unwrap();
        let url = &proxy.servers["fixture"];
        post(url, initialize()).await;
        let response = tokio::time::timeout(Duration::from_secs(3), crate::http().post(url).json(&json!({
            "jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"state","arguments":{"value":"exit"}}
        })).send()).await.unwrap().unwrap();
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        let notice = tokio::time::timeout(Duration::from_secs(2), proxy.notices.as_mut().unwrap().recv()).await.unwrap().unwrap();
        assert!(notice.contains("fixture"));
        assert!(notice.contains("stopped") || notice.contains("failed"));
        });
    }

    #[test]
    fn routes_reject_browser_origins_and_other_chats_secrets() {
        runtime().block_on(async {
            let proxy = SessionProxy::from_definitions(vec![stdio()], "/tmp")
                .await
                .unwrap();
            let url = &proxy.servers["fixture"];
            assert_eq!(
                crate::http()
                    .post(url)
                    .header("Origin", "https://example.com")
                    .json(&initialize())
                    .send()
                    .await
                    .unwrap()
                    .status(),
                StatusCode::FORBIDDEN
            );
            let forged = url.replace("fixture", "another-server");
            assert_eq!(
                crate::http()
                    .post(&forged)
                    .json(&initialize())
                    .send()
                    .await
                    .unwrap()
                    .status(),
                StatusCode::NOT_FOUND
            );
        });
    }

    #[test]
    fn http_forwards_session_headers_and_keeps_upstream_tokens_private() {
        runtime().block_on(async {
        use axum::extract::State;
        let seen: Arc<Mutex<Vec<HeaderMap>>> = Default::default();
        let app = Router::new().route("/upstream", any(|State(seen): State<Arc<Mutex<Vec<HeaderMap>>>>, headers: HeaderMap, Json(body): Json<Value>| async move {
            seen.lock().await.push(headers);
            let result = if body["method"] == "initialize" { json!({"protocolVersion":"2025-06-18", "capabilities":{"tools":{}},"serverInfo":{"name":"fixture","version":"1"},"instructions":"upstream instructions"}) }
                else { json!({"content":[{"type":"text","text":"ok"}]}) };
            let mut response = Json(json!({"jsonrpc":"2.0","id":body["id"],"result":result})).into_response();
            response.headers_mut().insert("mcp-session-id", "upstream-session".parse().unwrap());
            response
        })).with_state(seen.clone());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap(); });
        let mut definition = stdio();
        definition.server.transport = McpTransport::Http;
        definition.server.url = Some(format!("http://{address}/upstream"));
        definition.server.headers = vec![crate::mcp_servers::KeyValue { name:"Authorization".into(), value:"Bearer upstream-secret".into() }];
        let proxy = SessionProxy::from_definitions(vec![definition], "/tmp").await.unwrap();
        let url = &proxy.servers["fixture"];
        let response = crate::http().post(url).json(&initialize()).send().await.unwrap();
        assert_eq!(response.headers()["mcp-session-id"], "upstream-session");
        assert_eq!(response.json::<Value>().await.unwrap()["result"]["instructions"], "upstream instructions");
        crate::http().post(url).header("Mcp-Session-Id","upstream-session").header("Mcp-Protocol-Version","2025-06-18")
            .json(&json!({"jsonrpc":"2.0","id":2,"method":"tools/list"})).send().await.unwrap();
        let seen = seen.lock().await;
        assert_eq!(seen[0]["authorization"], "Bearer upstream-secret");
        assert_eq!(seen[1]["mcp-session-id"], "upstream-session");
        assert_eq!(seen[1]["mcp-protocol-version"], "2025-06-18");
        assert!(!proxy.claude().contains("upstream-secret"));
        assert!(!serde_json::to_string(&proxy.acp(true).unwrap()).unwrap().contains("upstream-secret"));
        server.abort();
        });
    }

    #[test]
    #[ignore = "requires installed Codex, Claude Code and an existing native Figma login"]
    fn installed_figma_fallback_calls_and_calling_agent_permissions() {
        runtime().block_on(async {
            let mut definition=stdio();
            definition.server.name="Figma".into();
            definition.server.transport=McpTransport::Http;
            definition.server.url=Some("https://mcp.figma.com/mcp".into());
            let cwd=std::env::temp_dir();
            let proxy=SessionProxy::from_definitions(vec![definition],cwd.to_str().unwrap()).await.unwrap();
            let url=&proxy.servers["Figma"];
            let initialized=post(url,initialize()).await;
            assert!(initialized.get("result").is_some());
            let tools=post(url,json!({"jsonrpc":"2.0","id":2,"method":"tools/list"})).await;
            assert!(tools["result"]["tools"].as_array().unwrap().iter().any(|t|t["name"]=="whoami"));
            let response=crate::http().post(url).json(&json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"whoami","arguments":{}}})).send().await.unwrap();
            let mut successful=false;
            read_sse(response.bytes_stream(),|_,data| {
                let value:Value=serde_json::from_str(&data).unwrap();
                successful=value.get("result").is_some()&&value["result"]["isError"]!=true;
            }).await.unwrap();
            assert!(successful);

            let executable=crate::binpath::claude().await;
            let settings=json!({"disableAllHooks":true,"permissions":{"deny":["mcp__Figma__whoami"]}}).to_string();
            let mut child=tokio::process::Command::new(executable)
                .args(["-p","--input-format","stream-json","--output-format","stream-json","--verbose","--strict-mcp-config","--mcp-config",&proxy.claude(),"--setting-sources","","--settings",&settings,"--no-session-persistence","--tools","","--permission-prompt-tool","stdio","--permission-mode","manual"])
                .env("ENABLE_CLAUDEAI_MCP_SERVERS","false").env("DISABLE_AUTOUPDATER","1").current_dir(&cwd)
                .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true).spawn().unwrap();
            let mut input=child.stdin.take().unwrap();
            let mut output=BufReader::new(child.stdout.take().unwrap());
            async fn control(input:&mut tokio::process::ChildStdin, output:&mut BufReader<tokio::process::ChildStdout>, id:&str, request:Value)->Value {
                input.write_all(format!("{}\n",json!({"type":"control_request","request_id":id,"request":request})).as_bytes()).await.unwrap();
                input.flush().await.unwrap();
                tokio::time::timeout(Duration::from_secs(30),async {
                    loop {
                        let mut line=String::new();assert!(output.read_line(&mut line).await.unwrap()>0);
                        let Ok(value)=serde_json::from_str::<Value>(&line) else {continue};
                        assert_ne!(value["type"],"control_request","deny rule must not ask the host to decide");
                        if value["type"]=="control_response"&&value["response"]["request_id"]==id {return value["response"].clone();}
                    }
                }).await.unwrap()
            }
            control(&mut input,&mut output,"init",json!({"subtype":"initialize"})).await;
            tokio::time::timeout(Duration::from_secs(25),async {
                loop {
                    let status=control(&mut input,&mut output,"status",json!({"subtype":"mcp_status"})).await;
                    if status.pointer("/response/mcpServers").and_then(Value::as_array).is_some_and(|rows|rows.iter().any(|row|row["name"]=="Figma"&&row["status"]=="connected")) { break; }
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }).await.unwrap();
            let denied=control(&mut input,&mut output,"denied",json!({"subtype":"mcp_call","tool":"mcp__Figma__whoami","arguments":{},"result_not_for_model":true,"check_permissions":true})).await;
            assert_eq!(denied["subtype"],"error");
            assert!(denied.to_string().contains("The tool did not run"),"{}",denied["error"]);
            child.kill().await.unwrap();
        });
    }
}

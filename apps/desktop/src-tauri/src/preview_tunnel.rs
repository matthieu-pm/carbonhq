//! A session's managed preview, carried to the reader's Mac as raw TCP over
//! the server's own port (CBN-77). Nothing is published: the server answers
//! `GET /preview-tunnel` beside its main socket, and the app opens a private
//! `127.0.0.1` listener whose every connection rides a WebSocket of its own.
//! Raw bytes, not HTTP, so a dev server's HMR socket works the way a page load
//! does. SSH forwarding needed an SSH login, which a server added by address
//! has none of.
//!
//! ```text
//! → GET /preview-tunnel (WebSocket upgrade, no Origin)
//! → {"token":"…","sessionId":"…"}               first frame, text
//! ← {"ok":true}  or  {"ok":false,"err":"…"} and close
//! ⇄ binary frames, the TCP bytes as they come
//! ⇄ an empty binary frame: this side's TCP reached EOF
//! ```
//!
//! `{"ok":true}` is sent only once the preview's port took the connection, so
//! an admitted tunnel is one that carries bytes.

use std::future::Future;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::Duration;

use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::{
    handshake::server::{ErrorResponse, Request, Response},
    http::StatusCode,
    protocol::WebSocketConfig,
    Message,
};
use tokio_tungstenite::WebSocketStream;

/// The route `serve.rs` hands over on.
pub const ROUTE: &str = "/preview-tunnel";

/// Handshake plus first frame, as `serve.rs` gives its own socket.
const ADMIT: Duration = Duration::from_secs(10);

/// How long the preview's port gets to take a connection.
const UPSTREAM: Duration = Duration::from_secs(5);

/// How often a live bridge asks whether its preview still runs at the address
/// it was admitted to. A stopped preview's port can be taken by anything next.
const RECHECK: Duration = Duration::from_secs(3);

/// The most one read moves; also what bounds memory per direction, since
/// each side waits for its write before reading again.
const CHUNK: usize = 16 * 1024;

/// A peer sending frames past this is not one of ours.
const FRAME_CAP: usize = 1 << 20;

fn ws_config() -> WebSocketConfig {
    WebSocketConfig::default()
        .max_message_size(Some(FRAME_CAP))
        .max_frame_size(Some(FRAME_CAP))
        .max_write_buffer_size(4 * FRAME_CAP)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Hello {
    #[serde(default)]
    token: String,
    #[serde(default)]
    session_id: String,
}

/// Serves one `GET /preview-tunnel` connection: admits it on the server's
/// token, connects to the session's running preview and relays until either
/// side closes or the preview stops.
pub async fn accept(stream: TcpStream, token: &str) -> Result<()> {
    admit_and_relay(stream, token, |session| async move {
        preview_target(&session).await
    })
    .await
}

/// The loopback addresses of `session`'s running preview.
async fn preview_target(session: &str) -> Result<Vec<SocketAddr>, String> {
    let answer = tokio::time::timeout(
        UPSTREAM,
        crate::preview::preview_status(session.to_string()),
    )
    .await
    .map_err(|_| "the preview did not answer in time".to_string())?;
    // Read through its JSON form so the enum's variant names are not this
    // file's business: `{"Ok":{…}}`, `{"Ok":null}` or `{"Err":"…"}`.
    target_of(&serde_json::to_value(answer).unwrap_or_default())
}

/// Where a preview state says to connect, or why not. Only its own `url`, on
/// loopback, on the port the state names — never anything the client sends.
fn target_of(answer: &Value) -> Result<Vec<SocketAddr>, String> {
    if let Some(err) = answer.get("Err") {
        return Err(err
            .as_str()
            .unwrap_or("the preview could not be read")
            .to_string());
    }
    let state = answer.get("Ok").unwrap_or(answer);
    if state.is_null() {
        return Err("no preview runs for this session".into());
    }
    let status = state
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !status.eq_ignore_ascii_case("running") {
        return Err(format!(
            "the preview is {}, not running",
            if status.is_empty() { "unknown" } else { status }
        ));
    }
    let url = state
        .get("url")
        .and_then(Value::as_str)
        .ok_or("the running preview has no address")?;
    let parsed =
        reqwest::Url::parse(url).map_err(|_| "the preview's address is not a URL".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("the preview's address is not http".into());
    }
    let port = parsed
        .port_or_known_default()
        .ok_or("the preview's address names no port")?;
    let named = state.get("port").and_then(Value::as_u64).unwrap_or(0);
    if named != 0 && named != u64::from(port) {
        return Err("the preview's address and port disagree".into());
    }
    let host = parsed.host_str().unwrap_or_default();
    let ips: Vec<IpAddr> = if host.eq_ignore_ascii_case("localhost") {
        vec![Ipv4Addr::LOCALHOST.into(), Ipv6Addr::LOCALHOST.into()]
    } else {
        match host
            .trim_start_matches('[')
            .trim_end_matches(']')
            .parse::<IpAddr>()
        {
            Ok(ip) if ip.is_loopback() => vec![ip],
            // A server bound to every interface is reached on loopback.
            Ok(IpAddr::V4(ip)) if ip.is_unspecified() => vec![Ipv4Addr::LOCALHOST.into()],
            Ok(IpAddr::V6(ip)) if ip.is_unspecified() => vec![Ipv6Addr::LOCALHOST.into()],
            _ => return Err("the preview's address is not on this machine's loopback".into()),
        }
    };
    Ok(ips
        .into_iter()
        .map(|ip| SocketAddr::new(ip, port))
        .collect())
}

/// [`accept`] with where a session's preview runs passed in, so tests need no
/// preview behind them. `resolve` is asked again every [`RECHECK`].
async fn admit_and_relay<F, Fut>(stream: TcpStream, token: &str, resolve: F) -> Result<()>
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = Result<Vec<SocketAddr>, String>>,
{
    let admitted = tokio::time::timeout(ADMIT, async {
        let ws = tokio_tungstenite::accept_hdr_async_with_config(
            stream,
            |req: &Request, resp: Response| {
                // Only the app's Rust side opens this, and it sends no Origin.
                // Any Origin is a page trying tokens against the port.
                if req.headers().contains_key("origin") {
                    let mut refused = ErrorResponse::new(Some("origin not allowed".to_string()));
                    *refused.status_mut() = StatusCode::FORBIDDEN;
                    return Err(refused);
                }
                if req.uri().path() != ROUTE {
                    let mut refused = ErrorResponse::new(None);
                    *refused.status_mut() = StatusCode::NOT_FOUND;
                    return Err(refused);
                }
                Ok(resp)
            },
            Some(ws_config()),
        )
        .await
        .context("handshake")?;
        first_text(ws).await
    })
    .await
    .context("no hello in time")??;
    let Some((ws, hello)) = admitted else {
        return Ok(());
    };
    let Ok(hello) = serde_json::from_str::<Hello>(&hello) else {
        return refuse(ws, "the first frame must be {\"token\":…,\"sessionId\":…}").await;
    };
    if !same_token(&hello.token, token) {
        return refuse(ws, "wrong token").await;
    }
    if hello.session_id.is_empty() {
        return refuse(ws, "no session named").await;
    }
    let target = match resolve(hello.session_id.clone()).await {
        Ok(target) => target,
        Err(e) => return refuse(ws, &e).await,
    };
    let upstream = match connect_any(&target).await {
        Ok(upstream) => upstream,
        Err(e) => return refuse(ws, &e).await,
    };
    let mut ws = ws;
    ws.send(Message::text(json!({ "ok": true }).to_string()))
        .await
        .context("admit")?;
    let session = hello.session_id;
    let moved = async {
        loop {
            tokio::time::sleep(RECHECK).await;
            if resolve(session.clone()).await.ok().as_deref() != Some(&target[..]) {
                return;
            }
        }
    };
    tokio::select! {
        relayed = relay(ws, upstream) => relayed,
        // Dropping the relay drops both sockets.
        () = moved => Ok(()),
    }
}

/// The first text frame, past pings. `None` for a peer that closed first.
async fn first_text<S>(mut ws: WebSocketStream<S>) -> Result<Option<(WebSocketStream<S>, String)>>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    loop {
        match ws.next().await {
            Some(Ok(Message::Text(text))) => return Ok(Some((ws, text.to_string()))),
            Some(Ok(Message::Ping(_) | Message::Pong(_))) => continue,
            _ => return Ok(None),
        }
    }
}

async fn refuse<S>(mut ws: WebSocketStream<S>, why: &str) -> Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    ws.send(Message::text(
        json!({ "ok": false, "err": why }).to_string(),
    ))
    .await
    .ok();
    ws.close(None).await.ok();
    Ok(())
}

/// The first of `targets` to take a connection, in order — `localhost` names
/// both families, and a dev server often listens on one alone.
async fn connect_any(targets: &[SocketAddr]) -> Result<TcpStream, String> {
    for addr in targets {
        if let Ok(Ok(stream)) = tokio::time::timeout(UPSTREAM, TcpStream::connect(addr)).await {
            stream.set_nodelay(true).ok();
            return Ok(stream);
        }
    }
    Err("the preview is not accepting connections".into())
}

/// `serve.rs`'s equal-time compare, so a token cannot be read back a byte at
/// a time off how quickly a wrong one is refused.
fn same_token(given: &str, token: &str) -> bool {
    given.len() == token.len()
        && given
            .bytes()
            .zip(token.bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
}

/// The peer dropped the WebSocket without saying its side was done: a closed
/// app, a restarted server. Ends the relay quietly, both sockets with it.
#[derive(Debug)]
struct Gone;

impl std::fmt::Display for Gone {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("the tunnel closed")
    }
}

impl std::error::Error for Gone {}

/// Copies bytes both ways until both sides' TCP reached EOF. An EOF crosses
/// as an empty binary frame and becomes a write shutdown on the far side, so
/// a client that half-closes still gets its whole answer.
async fn relay<S>(ws: WebSocketStream<S>, tcp: TcpStream) -> Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let (mut sink, mut frames) = ws.split();
    let (mut tcp_read, mut tcp_write) = tcp.into_split();
    let up = async {
        let mut buf = vec![0u8; CHUNK];
        loop {
            let n = tcp_read.read(&mut buf).await?;
            sink.send(Message::binary(buf[..n].to_vec())).await?;
            if n == 0 {
                return Ok::<_, anyhow::Error>(());
            }
        }
    };
    let down = async {
        while let Some(frame) = frames.next().await {
            match frame? {
                Message::Binary(bytes) if bytes.is_empty() => {
                    tcp_write.shutdown().await?;
                    return Ok(());
                }
                Message::Binary(bytes) => tcp_write.write_all(&bytes).await?,
                Message::Close(_) => break,
                _ => {}
            }
        }
        Err(Gone.into())
    };
    match tokio::try_join!(up, down) {
        Ok(_) => {
            sink.close().await.ok();
            Ok(())
        }
        Err(e) if e.is::<Gone>() => Ok(()),
        Err(e) => Err(e),
    }
}

#[cfg(feature = "desktop")]
pub use client::{close_server, close_session, forward};

#[cfg(feature = "desktop")]
mod client {
    use std::collections::HashMap;
    use std::net::Ipv4Addr;
    use std::sync::{Arc, LazyLock, Mutex};
    use std::time::Duration;

    use futures_util::{SinkExt, StreamExt};
    use serde_json::{json, Value};
    use sha2::{Digest, Sha256};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};
    use tokio::sync::Semaphore;
    use tokio::task::{JoinHandle, JoinSet};
    use tokio_tungstenite::tungstenite::Message;

    use super::{relay, ws_config, ROUTE};

    type Socket = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<TcpStream>>;

    /// Connect, TLS, handshake and the server reaching the preview's port.
    const OPEN: Duration = Duration::from_secs(15);

    /// Browser connections one forward carries at once. A page holds six or
    /// so plus its HMR socket; past this a connection is dropped, not queued.
    const MAX_CONNECTIONS: usize = 128;

    const TOO_OLD: &str =
        "This server is too old to open previews here. Update it, then try again.";

    /// What each browser connection needs to open its own tunnel. No `Debug`:
    /// it holds the token.
    struct Endpoint {
        url: String,
        token: String,
        session: String,
    }

    struct Forward {
        server: String,
        session: String,
        port: u16,
        /// The accept loop, which owns the listener and every connection.
        accept: JoinHandle<()>,
    }

    impl Drop for Forward {
        fn drop(&mut self) {
            self.accept.abort();
        }
    }

    #[derive(Default)]
    struct Forwards {
        /// Keyed on [`cache_key`], so a new token or address is a new forward.
        live: HashMap<String, Forward>,
        /// How many times each server's forwards were closed. A forward whose
        /// probe straddled a close was opened on credentials now dead.
        closes: HashMap<String, u64>,
    }

    static FORWARDS: LazyLock<Mutex<Forwards>> = LazyLock::new(Default::default);

    fn forwards() -> std::sync::MutexGuard<'static, Forwards> {
        FORWARDS.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// A hash, so the map holds no token in a form anything could print.
    fn cache_key(server: &str, session: &str, url: &str, token: &str) -> String {
        let mut hash = Sha256::new();
        for part in [server, session, url, token] {
            hash.update((part.len() as u64).to_le_bytes());
            hash.update(part.as_bytes());
        }
        hash.finalize().iter().map(|b| format!("{b:02x}")).collect()
    }

    /// A private `127.0.0.1` port carrying `session`'s running preview on
    /// `server`, whose socket is at `url` and admits `token`. One per server,
    /// session and credentials, reused while its listener lives. The server
    /// is asked once before the port is handed out, so an old server or a
    /// stopped preview is an error here rather than a page that never loads.
    pub async fn forward(
        server: &str,
        session: &str,
        url: &str,
        token: &str,
    ) -> Result<u16, String> {
        let key = cache_key(server, session, url, token);
        let stamp = {
            let list = forwards();
            if let Some(open) = list.live.get(&key).filter(|f| !f.accept.is_finished()) {
                return Ok(open.port);
            }
            list.closes.get(server).copied().unwrap_or(0)
        };
        let endpoint = Arc::new(Endpoint {
            url: tunnel_url(url)?,
            token: token.to_string(),
            session: session.to_string(),
        });
        let probe = open(&endpoint).await?;
        drop(probe);
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(|e| format!("could not open a local port for the preview: {e}"))?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let mut list = forwards();
        if list.closes.get(server).copied().unwrap_or(0) != stamp {
            return Err("the connection to the server restarted. Try again.".into());
        }
        // Two calls racing: the first to land wins, so a page already open
        // on it keeps working.
        if let Some(open) = list.live.get(&key).filter(|f| !f.accept.is_finished()) {
            return Ok(open.port);
        }
        // The session's earlier forward named another address or token,
        // neither of which serves anything now.
        list.live
            .retain(|_, f| !(f.server == server && f.session == session));
        list.live.insert(
            key,
            Forward {
                server: server.to_string(),
                session: session.to_string(),
                port,
                accept: tokio::spawn(serve_local(listener, endpoint)),
            },
        );
        Ok(port)
    }

    /// Drops every forward to `server`, with the connections they carry. For
    /// a connection restart, after which the old token may no longer admit.
    pub fn close_server(server: &str) {
        let mut list = forwards();
        *list.closes.entry(server.to_string()).or_default() += 1;
        list.live.retain(|_, f| f.server != server);
    }

    /// Drops `session`'s forward on `server`, with the connections it carries.
    pub fn close_session(server: &str, session: &str) {
        forwards()
            .live
            .retain(|_, f| !(f.server == server && f.session == session));
    }

    /// The server's socket URL with [`ROUTE`] after whatever path it already
    /// has, so a server behind a path prefix is reached under it too.
    fn tunnel_url(server_url: &str) -> Result<String, String> {
        let url = server_url.trim();
        let url = if let Some(rest) = url.strip_prefix("http://") {
            format!("ws://{rest}")
        } else if let Some(rest) = url.strip_prefix("https://") {
            format!("wss://{rest}")
        } else if url.contains("://") {
            url.to_string()
        } else {
            format!("ws://{url}")
        };
        let mut parsed = reqwest::Url::parse(&url)
            .map_err(|_| "the server's address is not a URL".to_string())?;
        if !matches!(parsed.scheme(), "ws" | "wss") || parsed.host_str().is_none() {
            return Err("the server's address is not a WebSocket address".into());
        }
        let path = format!("{}{ROUTE}", parsed.path().trim_end_matches('/'));
        parsed.set_path(&path);
        parsed.set_query(None);
        parsed.set_fragment(None);
        Ok(parsed.into())
    }

    /// One admitted tunnel, or why not. Bounded by [`OPEN`], so a server that
    /// never answers is an error rather than a wait.
    async fn open(endpoint: &Endpoint) -> Result<Socket, String> {
        let attempt = async {
            let (mut ws, _) = tokio_tungstenite::connect_async_with_config(
                &endpoint.url,
                Some(ws_config()),
                true,
            )
            .await
            .map_err(|e| format!("could not reach the server for the preview: {e}"))?;
            let hello = json!({ "token": endpoint.token, "sessionId": endpoint.session });
            ws.send(Message::text(hello.to_string()))
                .await
                .map_err(|e| e.to_string())?;
            loop {
                match ws.next().await {
                    Some(Ok(Message::Text(text))) => {
                        let frame: Value = serde_json::from_str(&text).unwrap_or_default();
                        return match frame.get("ok").and_then(Value::as_bool) {
                            Some(true) => Ok(ws),
                            Some(false) => Err(frame
                                .get("err")
                                .and_then(Value::as_str)
                                .unwrap_or("the server refused the preview")
                                .to_string()),
                            // An older server takes the route for its main
                            // socket and refuses the hello in its own words.
                            None => Err(TOO_OLD.to_string()),
                        };
                    }
                    Some(Ok(Message::Ping(_) | Message::Pong(_))) => continue,
                    Some(Err(e)) => return Err(e.to_string()),
                    _ => return Err(TOO_OLD.to_string()),
                }
            }
        };
        tokio::time::timeout(OPEN, attempt)
            .await
            .unwrap_or_else(|_| Err("the server did not open the preview in time".into()))
    }

    async fn serve_local(listener: TcpListener, endpoint: Arc<Endpoint>) {
        let slots = Arc::new(Semaphore::new(MAX_CONNECTIONS));
        let mut connections = JoinSet::new();
        loop {
            let browser = tokio::select! {
                accepted = listener.accept() => match accepted {
                    Ok((browser, _)) => browser,
                    Err(e) => {
                        eprintln!("[preview tunnel accept err] {e}");
                        // Out of descriptors, most likely; spinning won't help.
                        tokio::time::sleep(Duration::from_millis(200)).await;
                        continue;
                    }
                },
                Some(_) = connections.join_next() => continue,
            };
            let Ok(slot) = slots.clone().try_acquire_owned() else {
                continue;
            };
            let endpoint = endpoint.clone();
            connections.spawn(async move {
                let _slot = slot;
                carry(browser, &endpoint).await;
            });
        }
    }

    /// One browser connection, over a tunnel of its own.
    async fn carry(mut browser: TcpStream, endpoint: &Endpoint) {
        browser.set_nodelay(true).ok();
        match open(endpoint).await {
            Ok(ws) => {
                if let Err(e) = relay(ws, browser).await {
                    eprintln!("[preview tunnel] {e:#}");
                }
            }
            Err(why) => {
                // Nothing has crossed yet, so an HTTP answer is still valid
                // and says more in the pane than a reset would.
                let answer = format!(
                    "HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{why}",
                    why.len()
                );
                if browser.write_all(answer.as_bytes()).await.is_ok() {
                    browser.shutdown().await.ok();
                    // Closing with the request unread resets the socket,
                    // which can take the answer with it.
                    let mut sink = [0u8; 4096];
                    let drain =
                        async { while matches!(browser.read(&mut sink).await, Ok(n) if n > 0) {} };
                    tokio::time::timeout(Duration::from_secs(1), drain)
                        .await
                        .ok();
                }
            }
        }
    }

    #[cfg(test)]
    pub(super) fn tunnel_url_for_test(url: &str) -> Result<String, String> {
        tunnel_url(url)
    }

    #[cfg(test)]
    pub(super) fn cache_key_for_test(
        server: &str,
        session: &str,
        url: &str,
        token: &str,
    ) -> String {
        cache_key(server, session, url, token)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    /// A stand-in for `carbon-serve`'s route, every session resolving to
    /// `target`.
    async fn tunnel_server(target: SocketAddr) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let (stream, _) = listener.accept().await.unwrap();
                tokio::spawn(admit_and_relay(stream, TOKEN, move |_| async move {
                    Ok(vec![target])
                }));
            }
        });
        format!("ws://{addr}")
    }

    /// An upstream that answers each connection, once its client half-closed,
    /// with how many bytes it got.
    async fn counting_upstream() -> SocketAddr {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let (mut stream, _) = listener.accept().await.unwrap();
                tokio::spawn(async move {
                    let mut got = Vec::new();
                    stream.read_to_end(&mut got).await.unwrap();
                    let body = format!("got {} bytes", got.len());
                    let answer = format!(
                        "HTTP/1.0 200 OK\r\nContent-Length: {}\r\n\r\n{body}",
                        body.len()
                    );
                    stream.write_all(answer.as_bytes()).await.unwrap();
                });
            }
        });
        addr
    }

    async fn hello(url: &str, token: &str) -> Value {
        let (mut ws, _) = tokio_tungstenite::connect_async(format!("{url}{ROUTE}"))
            .await
            .unwrap();
        ws.send(Message::text(
            json!({ "token": token, "sessionId": "s" }).to_string(),
        ))
        .await
        .unwrap();
        loop {
            if let Some(Ok(Message::Text(text))) = ws.next().await {
                return serde_json::from_str(&text).unwrap();
            }
        }
    }

    #[tokio::test]
    async fn a_wrong_token_is_refused_before_any_upstream() {
        let url = tunnel_server(counting_upstream().await).await;
        assert_eq!(
            hello(&url, "nope").await,
            json!({ "ok": false, "err": "wrong token" })
        );
        assert_eq!(hello(&url, &TOKEN[1..]).await["ok"], false);
        assert_eq!(hello(&url, TOKEN).await, json!({ "ok": true }));
    }

    #[tokio::test]
    async fn a_browser_origin_is_refused_at_the_handshake() {
        let url = tunnel_server(counting_upstream().await).await;
        let mut request = format!("{url}{ROUTE}").into_client_request().unwrap();
        request
            .headers_mut()
            .insert("origin", "http://localhost:5173".parse().unwrap());
        assert!(tokio_tungstenite::connect_async(request).await.is_err());
        let elsewhere = format!("{url}/not-the-route");
        assert!(tokio_tungstenite::connect_async(elsewhere).await.is_err());
    }

    #[tokio::test]
    async fn a_preview_not_listening_is_an_error_not_an_admit() {
        let closed = TcpListener::bind("127.0.0.1:0")
            .await
            .unwrap()
            .local_addr()
            .unwrap();
        let url = tunnel_server(closed).await;
        let answer = hello(&url, TOKEN).await;
        assert_eq!(answer["ok"], false);
        assert!(answer["err"].as_str().unwrap().contains("not accepting"));
    }

    #[test]
    fn connects_only_where_a_running_preview_says() {
        let running = |url: &str, port: u16| json!({ "Ok": { "status": "running", "url": url, "port": port } });
        assert_eq!(
            target_of(&running("http://127.0.0.1:5173/", 5173)).unwrap(),
            vec!["127.0.0.1:5173".parse().unwrap()]
        );
        assert_eq!(
            target_of(&running("http://[::1]:3000", 3000)).unwrap(),
            vec!["[::1]:3000".parse().unwrap()]
        );
        assert_eq!(
            target_of(&running("http://localhost:3000", 0))
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            target_of(&running("http://0.0.0.0:8080", 8080)).unwrap(),
            vec!["127.0.0.1:8080".parse().unwrap()]
        );
        // The url and the port the preview owns must agree.
        assert!(target_of(&running("http://127.0.0.1:5432", 5173)).is_err());
        for elsewhere in [
            "http://10.0.0.2:5173",
            "http://example.com:5173",
            "file:///etc/passwd",
        ] {
            assert!(target_of(&running(elsewhere, 5173)).is_err(), "{elsewhere}");
        }
        for status in ["starting", "stopped", "failed"] {
            let state =
                json!({ "Ok": { "status": status, "url": "http://127.0.0.1:5173", "port": 5173 } });
            assert!(target_of(&state).is_err(), "{status}");
        }
        assert!(target_of(&json!({ "Ok": null })).is_err());
        assert_eq!(
            target_of(&json!({ "Err": "no such session" })).unwrap_err(),
            "no such session"
        );
        // A variant serialized PascalCase still reads.
        let pascal =
            json!({ "Ok": { "status": "Running", "url": "http://127.0.0.1:1", "port": 1 } });
        assert!(target_of(&pascal).is_ok());
    }

    #[test]
    fn tokens_compare_whole() {
        assert!(same_token(TOKEN, TOKEN));
        assert!(!same_token(&TOKEN[1..], TOKEN));
        assert!(!same_token("", TOKEN));
    }

    #[cfg(feature = "desktop")]
    mod desktop {
        use super::*;
        use crate::preview_tunnel::client::{cache_key_for_test, tunnel_url_for_test};

        #[test]
        fn the_route_follows_the_servers_own_path() {
            assert_eq!(
                tunnel_url_for_test("ws://box:7317").unwrap(),
                "ws://box:7317/preview-tunnel"
            );
            assert_eq!(
                tunnel_url_for_test("wss://a-b.trycloudflare.com/").unwrap(),
                "wss://a-b.trycloudflare.com/preview-tunnel"
            );
            assert_eq!(
                tunnel_url_for_test("https://host/carbon/").unwrap(),
                "wss://host/carbon/preview-tunnel"
            );
            assert_eq!(
                tunnel_url_for_test("127.0.0.1:7317").unwrap(),
                "ws://127.0.0.1:7317/preview-tunnel"
            );
            assert!(tunnel_url_for_test("ftp://box").is_err());
        }

        #[test]
        fn the_cache_key_names_no_secret() {
            let key = cache_key_for_test("srv", "s", "ws://box", TOKEN);
            assert!(!key.contains(TOKEN) && key.len() == 64);
            assert_ne!(key, cache_key_for_test("srv", "s", "ws://box", "other"));
            // Length-prefixed, so moving a byte between parts moves the key.
            assert_ne!(
                cache_key_for_test("ab", "c", "", ""),
                cache_key_for_test("a", "bc", "", "")
            );
        }

        #[tokio::test]
        async fn http_crosses_whole_with_a_half_close() {
            let url = tunnel_server(counting_upstream().await).await;
            let port = forward("http-test", "s", &url, TOKEN).await.unwrap();
            assert_eq!(
                forward("http-test", "s", &url, TOKEN).await.unwrap(),
                port,
                "reused"
            );
            // Past one chunk, so the relay's loop runs more than once.
            let request = format!("POST / HTTP/1.0\r\n\r\n{}", "x".repeat(100_000));
            let mut browser = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            browser.write_all(request.as_bytes()).await.unwrap();
            browser.shutdown().await.unwrap();
            let mut answer = String::new();
            browser.read_to_string(&mut answer).await.unwrap();
            assert!(
                answer.ends_with(&format!("got {} bytes", request.len())),
                "{answer}"
            );
            close_server("http-test");
        }

        #[tokio::test]
        async fn a_websocket_upgrade_crosses_both_ways() {
            let upstream = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let target = upstream.local_addr().unwrap();
            tokio::spawn(async move {
                loop {
                    let (stream, _) = upstream.accept().await.unwrap();
                    tokio::spawn(async move {
                        // The probe connects and leaves without a handshake.
                        let Ok(mut ws) = tokio_tungstenite::accept_async(stream).await else {
                            return;
                        };
                        while let Some(Ok(message)) = ws.next().await {
                            if message.is_text() || message.is_binary() {
                                ws.send(message).await.unwrap();
                            }
                        }
                    });
                }
            });
            let url = tunnel_server(target).await;
            let port = forward("hmr-test", "s", &url, TOKEN).await.unwrap();
            let (mut hmr, _) =
                tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{port}/hmr"))
                    .await
                    .unwrap();
            hmr.send(Message::text(r#"{"type":"update"}"#))
                .await
                .unwrap();
            assert_eq!(
                hmr.next().await.unwrap().unwrap(),
                Message::text(r#"{"type":"update"}"#)
            );
            let big = vec![7u8; 200_000];
            hmr.send(Message::binary(big.clone())).await.unwrap();
            assert_eq!(hmr.next().await.unwrap().unwrap(), Message::binary(big));
            close_server("hmr-test");
        }

        #[tokio::test]
        async fn an_old_server_is_told_to_update_without_hanging() {
            // What `serve.rs` did before the route: the upgrade taken as its
            // main socket, and a hello with no `v` refused.
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            tokio::spawn(async move {
                let (stream, _) = listener.accept().await.unwrap();
                let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
                ws.next().await;
                let err = json!({ "err": "the first frame must be {\"v\":1,\"token\":\"…\"}" });
                ws.send(Message::text(err.to_string())).await.unwrap();
                ws.close(None).await.ok();
            });
            let refused = forward("old-test", "s", &format!("ws://{addr}"), TOKEN)
                .await
                .unwrap_err();
            assert!(refused.contains("too old"), "{refused}");
            assert!(!refused.contains(TOKEN));
        }

        #[tokio::test]
        async fn closing_the_server_takes_its_listener_down() {
            let url = tunnel_server(counting_upstream().await).await;
            let port = forward("close-test", "s", &url, TOKEN).await.unwrap();
            close_server("close-test");
            let mut gone = false;
            for _ in 0..50 {
                if TcpStream::connect(("127.0.0.1", port)).await.is_err() {
                    gone = true;
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            assert!(gone, "the local port still accepts");
        }
    }
}

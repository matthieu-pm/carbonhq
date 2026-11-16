use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use axum::{
    extract::{Query, State},
    response::IntoResponse,
    routing::get,
    Router,
};
use rmcp::transport::auth::{
    AuthError, AuthorizationManager, AuthorizationRequest, AuthorizationSession,
    CredentialRefreshGuard, CredentialStore, StoredCredentials,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::{oneshot, Mutex};
use ts_rs::TS;

use crate::mcp_servers::McpTarget;
use crate::Fail;

struct Manager {
    generation: String,
    client: AuthorizationManager,
}
type ManagerSlot = Arc<Mutex<Option<Manager>>>;
static MANAGERS: LazyLock<Mutex<HashMap<String, ManagerSlot>>> = LazyLock::new(Default::default);
static LOGINS: LazyLock<Mutex<HashMap<String, LoginStatus>>> = LazyLock::new(Default::default);

#[derive(Default, Serialize, Deserialize)]
struct TokenFile {
    generation: String,
    credentials: Option<StoredCredentials>,
}

#[derive(Clone)]
struct Tokens {
    path: PathBuf,
    generation: String,
}

fn store_error(error: impl std::fmt::Display) -> AuthError {
    AuthError::CredentialStoreError(error.to_string())
}

impl Tokens {
    async fn open(url: &str) -> Result<Self> {
        let digest: String = Sha256::digest(url.as_bytes())
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        let key = format!("mcp-auth-{digest}");
        let path = crate::store::config_dir()
            .await?
            .join(format!("{key}.json"));
        let file: TokenFile = crate::store::read_json(&path).await?;
        Ok(Self {
            path,
            generation: file.generation,
        })
    }

    async fn lock(&self) -> Result<std::fs::File> {
        let path = self.path.with_extension("lock");
        tokio::task::spawn_blocking(move || {
            let mut options = std::fs::OpenOptions::new();
            options.create(true).truncate(false).write(true);
            #[cfg(unix)]
            std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
            let file = options.open(path)?;
            if unsafe { libc::flock(std::os::fd::AsRawFd::as_raw_fd(&file), libc::LOCK_EX) } != 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok::<_, std::io::Error>(file)
        })
        .await?
        .map_err(Into::into)
    }

    async fn reset(url: &str) -> Result<Self> {
        let mut tokens = Self::open(url).await?;
        let _lock = tokens.lock().await?;
        tokens.generation = uuid::Uuid::new_v4().to_string();
        crate::store::write_private_atomic(
            &tokens.path,
            &serde_json::to_vec(&TokenFile {
                generation: tokens.generation.clone(),
                credentials: None,
            })?,
        )?;
        Ok(tokens)
    }
}

#[async_trait]
impl CredentialStore for Tokens {
    async fn load(&self) -> Result<Option<StoredCredentials>, AuthError> {
        let file: TokenFile = crate::store::read_json(&self.path)
            .await
            .map_err(store_error)?;
        Ok((file.generation == self.generation)
            .then_some(file.credentials)
            .flatten())
    }

    async fn save(&self, credentials: StoredCredentials) -> Result<(), AuthError> {
        let file: TokenFile = crate::store::read_json(&self.path)
            .await
            .map_err(store_error)?;
        if file.generation != self.generation {
            return Err(store_error("this MCP sign-in was cancelled"));
        }
        crate::store::write_private_atomic(
            &self.path,
            &serde_json::to_vec(&TokenFile {
                generation: self.generation.clone(),
                credentials: Some(credentials),
            })
            .map_err(store_error)?,
        )
        .map_err(store_error)
    }

    async fn clear(&self) -> Result<(), AuthError> {
        let file: TokenFile = crate::store::read_json(&self.path)
            .await
            .map_err(store_error)?;
        if file.generation != self.generation {
            return Ok(());
        }
        crate::store::write_private_atomic(
            &self.path,
            &serde_json::to_vec(&TokenFile {
                generation: self.generation.clone(),
                credentials: None,
            })
            .map_err(store_error)?,
        )
        .map_err(store_error)
    }

    async fn acquire_refresh_guard(&self) -> Result<Option<CredentialRefreshGuard>, AuthError> {
        let lock = self.lock().await.map_err(store_error)?;
        Ok(Some(CredentialRefreshGuard::new(lock)))
    }
}

/// Every agent uses this grant; the SDK refreshes it under the credential-file lock.
pub async fn access_token(url: &str) -> Result<Option<String>> {
    let url = super::config::expand(url).await?;
    let tokens = Tokens::open(&url).await?;
    if tokens.load().await?.is_none() {
        return Ok(None);
    }
    let slot = MANAGERS
        .lock()
        .await
        .entry(url.clone())
        .or_default()
        .clone();
    let mut manager = slot.lock().await;
    if manager
        .as_ref()
        .is_none_or(|manager| manager.generation != tokens.generation)
    {
        crate::http();
        let mut next = AuthorizationManager::new(&url).await?;
        let _guard = tokens.lock().await?;
        next.set_credential_store(tokens.clone());
        if !next.initialize_from_store().await? {
            return Ok(None);
        }
        *manager = Some(Manager {
            generation: tokens.generation,
            client: next,
        });
    }
    Ok(Some(
        manager.as_ref().unwrap().client.get_access_token().await?,
    ))
}

#[derive(Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct McpLogin {
    pub id: String,
    pub url: String,
}

#[derive(Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum LoginStatus {
    Waiting,
    Complete,
    Failed { message: String },
}

/// Starts one browser sign-in and keeps the pending state until its callback arrives.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn start_mcp_login(target: McpTarget, name: String) -> Result<McpLogin, Fail> {
    Ok(start_login(target, name).await?)
}

async fn start_login(target: McpTarget, name: String) -> Result<McpLogin> {
    let definition = super::config::find(&target, &name).await?;
    let native = super::native_codex::eligible(&definition);
    if native {
        return start_native_login(definition).await;
    }
    let url = definition
        .server
        .url
        .context("local MCP servers do not use browser sign-in")?;
    let resource = url.clone();
    let url = super::config::expand(&url).await?;
    crate::http();
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await?;
    let redirect = format!(
        "http://127.0.0.1:{}/callback",
        listener.local_addr()?.port()
    );
    let mut manager = AuthorizationManager::new(&url).await?;
    let challenge = crate::http().post(&url).header("Accept", "application/json, text/event-stream")
        .json(&serde_json::json!({"jsonrpc":"2.0", "id":1, "method":"initialize", "params":{
            "protocolVersion":"2025-06-18", "capabilities":{}, "clientInfo":{"name":"carbon", "version":env!("CARGO_PKG_VERSION")}
        }})).timeout(Duration::from_secs(30)).send().await?
        .headers().get(reqwest::header::WWW_AUTHENTICATE).and_then(|v| v.to_str().ok()).map(str::to_string);
    let metadata = manager
        .resolve_metadata_from_challenge(challenge.as_deref())
        .await?;
    manager.set_metadata(metadata.metadata);
    let tokens = Tokens::reset(&url).await?;
    manager.set_credential_store(tokens.clone());
    let mut request = AuthorizationRequest::new(&redirect)
        .with_client_name("Carbon")
        .with_initial_scope_selection();
    if let Some(config) = definition.oauth {
        if let Some(id) = config
            .get("clientId")
            .or_else(|| config.get("client_id"))
            .and_then(serde_json::Value::as_str)
        {
            request = request.with_preregistered_client(id);
        }
        if let Some(secret) = config
            .get("clientSecret")
            .or_else(|| config.get("client_secret"))
            .and_then(serde_json::Value::as_str)
        {
            request = request.with_client_secret(secret);
        }
    }
    let session = AuthorizationSession::new(manager, request)
        .await
        .map_err(|(_, error)| registration_error(&url, &error))?;
    let authorization_url = session.get_authorization_url().to_string();
    let id = uuid::Uuid::new_v4().to_string();
    LOGINS.lock().await.insert(id.clone(), LoginStatus::Waiting);
    let (done_tx, done_rx) = oneshot::channel();
    let state = Arc::new(Callback {
        session,
        tokens,
        done: Mutex::new(Some(done_tx)),
    });
    let app = Router::new()
        .route("/callback", get(callback))
        .with_state(state);
    let login_id = id.clone();
    tokio::spawn(async move {
        let (stop_tx, stop_rx) = oneshot::channel::<()>();
        let mut server = tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = stop_rx.await;
                })
                .await
        });
        let result = tokio::time::timeout(Duration::from_secs(300), done_rx).await;
        let status = match result {
            Ok(Ok(Ok(()))) => {
                MANAGERS.lock().await.remove(&url);
                match super::config::signed_out(&resource, false).await {
                    Ok(()) => LoginStatus::Complete,
                    Err(_) => LoginStatus::Failed {
                        message: "Signed in, but Carbon couldn't save the server settings.".into(),
                    },
                }
            }
            Ok(Ok(Err(message))) => LoginStatus::Failed { message },
            _ => LoginStatus::Failed {
                message: "Sign-in timed out. Try again.".into(),
            },
        };
        let _ = stop_tx.send(());
        let _ = tokio::time::timeout(Duration::from_secs(2), &mut server).await;
        server.abort();
        let mut logins = LOGINS.lock().await;
        logins.insert(login_id, status);
        if logins.len() > 100 {
            logins.retain(|_, status| matches!(status, LoginStatus::Waiting));
        }
    });
    Ok(McpLogin {
        id,
        url: authorization_url,
    })
}

/// Codex receives the callback and retains its own shared grant throughout sign-in.
async fn start_native_login(definition: super::config::Definition) -> Result<McpLogin> {
    let resource = definition.server.url.clone().context("missing Figma URL")?;
    let cwd = definition
        .project
        .clone()
        .or_else(|| std::env::home_dir().map(|p| p.to_string_lossy().into_owned()))
        .unwrap_or("/".into());
    let worker = super::native_codex::Connection::open(&definition, &cwd).await?;
    let (url, login_id, mut events) = worker.login().await?;
    let tokens = Tokens::reset(&resource).await?;
    let id = uuid::Uuid::new_v4().to_string();
    LOGINS.lock().await.insert(id.clone(), LoginStatus::Waiting);
    let pending_id = id.clone();
    tokio::spawn(async move {
        let outcome = tokio::time::timeout(Duration::from_secs(300), async {
            loop {
                let (method, params) = events
                    .recv()
                    .await
                    .context("Codex's sign-in connection closed")?;
                if method == "carbon/closed" {
                    anyhow::bail!("Sign-in was cancelled. Try again.");
                }
                if method != "mcpServer/oauthLogin/completed" || params["name"] != worker.name {
                    continue;
                }
                if params
                    .get("threadId")
                    .and_then(serde_json::Value::as_str)
                    .is_some_and(|id| id != worker.thread)
                {
                    continue;
                }
                if let Some(id) = &login_id {
                    if params.get("loginId").and_then(serde_json::Value::as_str) != Some(id) {
                        continue;
                    }
                }
                if params["success"] != true {
                    anyhow::bail!("Couldn't finish Figma sign-in. Try again.");
                }
                if Tokens::open(&resource).await?.generation != tokens.generation {
                    anyhow::bail!("This sign-in was cancelled.");
                }
                super::config::signed_out(&resource, false).await?;
                return Ok::<_, anyhow::Error>(());
            }
        })
        .await;
        let status = match outcome {
            Ok(Ok(())) => LoginStatus::Complete,
            Ok(Err(error)) => LoginStatus::Failed {
                message: error.to_string(),
            },
            Err(_) => LoginStatus::Failed {
                message: "Sign-in timed out. Try again.".into(),
            },
        };
        worker.stop();
        let mut logins = LOGINS.lock().await;
        logins.insert(pending_id, status);
        if logins.len() > 100 {
            logins.retain(|_, status| matches!(status, LoginStatus::Waiting));
        }
    });
    Ok(McpLogin { id, url })
}

struct Callback {
    session: AuthorizationSession,
    tokens: Tokens,
    done: Mutex<Option<oneshot::Sender<Result<(), String>>>>,
}

/// Registration can be refused before the user ever reaches a sign-in page.
fn registration_error(resource: &str, error: &AuthError) -> anyhow::Error {
    if matches!(error, AuthError::RegistrationFailed(message) if message.contains("HTTP 403")) {
        if reqwest::Url::parse(resource)
            .ok()
            .is_some_and(|url| url.host_str() == Some("mcp.figma.com"))
        {
            return anyhow!("Figma only accepts approved MCP clients. Carbon needs Figma approval before you can sign in (HTTP 403).");
        }
        return anyhow!("This server refused to register Carbon (HTTP 403). Its administrator may need to approve Carbon before you can sign in.");
    }
    anyhow!(error.to_string())
}

async fn callback(
    State(state): State<Arc<Callback>>,
    Query(query): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let expected_state = reqwest::Url::parse(state.session.get_authorization_url())
        .ok()
        .and_then(|url| {
            url.query_pairs()
                .find(|(key, _)| key == "state")
                .map(|(_, value)| value.into_owned())
        });
    if query.get("state") != expected_state.as_ref() {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            "This sign-in link is invalid. Return to Carbon to try again.",
        );
    }
    if query.contains_key("error") {
        if let Some(done) = state.done.lock().await.take() {
            let _ = done.send(Err("Sign-in was cancelled. Try again.".into()));
        }
        return (
            axum::http::StatusCode::OK,
            "Sign-in was cancelled. You can return to Carbon.",
        );
    }
    let (Some(code), Some(csrf)) = (query.get("code"), query.get("state")) else {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            "Sign-in was not completed. Return to Carbon to try again.",
        );
    };
    let Ok(_lock) = state.tokens.lock().await else {
        return (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "Couldn't save sign-in. Return to Carbon to try again.",
        );
    };
    match state
        .session
        .handle_callback_with_issuer(code, csrf, query.get("iss").map(String::as_str))
        .await
    {
        Ok(_) => {
            if let Some(done) = state.done.lock().await.take() {
                let _ = done.send(Ok(()));
            }
            (
                axum::http::StatusCode::OK,
                "Signed in. You can return to Carbon and close this tab.",
            )
        }
        Err(_) => {
            if let Some(done) = state.done.lock().await.take() {
                let _ = done.send(Err("Couldn't finish sign-in. Try again.".into()));
            }
            (
                axum::http::StatusCode::BAD_REQUEST,
                "Couldn't finish sign-in. Return to Carbon to try again.",
            )
        }
    }
}

/// Polls only the login's outcome; credentials never cross the app transport.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn mcp_login_status(id: String) -> Result<LoginStatus, Fail> {
    Ok(LOGINS
        .lock()
        .await
        .get(&id)
        .cloned()
        .context("this MCP sign-in has expired")?)
}

/// Invalidates pending logins and refreshes before withholding the server from new sessions.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn logout_mcp_server(target: McpTarget, name: String) -> Result<(), Fail> {
    let definition = super::config::find(&target, &name).await?;
    let native = super::native_codex::eligible(&definition);
    if native {
        let cwd = definition
            .project
            .clone()
            .or_else(|| std::env::home_dir().map(|p| p.to_string_lossy().into_owned()))
            .unwrap_or("/".into());
        super::native_codex::logout(&definition, &cwd).await?;
    }
    let url = definition
        .server
        .url
        .context("local MCP servers do not use browser sign-in")?;
    clear(&url).await?;
    // Codex's grant also reflects a later sign-in from its terminal client.
    super::config::signed_out(&url, !native).await?;
    Ok(())
}

/// Invalidates a removed server's pending sign-ins as well as its stored grant.
pub async fn clear(url: &str) -> Result<()> {
    let url = super::config::expand(url).await?;
    if super::native_codex::eligible_url(&url) {
        super::native_codex::stop_resource(&url).await;
    }
    Tokens::reset(&url).await?;
    MANAGERS.lock().await.remove(&url);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rmcp::transport::auth::{AuthorizationMetadata, OAuthClientConfig};
    use serde_json::json;

    async fn tokens() -> Tokens {
        let root = std::env::temp_dir().join(format!("carbon-mcp-auth-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&root).await.unwrap();
        let tokens = Tokens {
            path: root.join("tokens.json"),
            generation: "original".into(),
        };
        crate::store::write_private_atomic(
            &tokens.path,
            &serde_json::to_vec(&TokenFile {
                generation: tokens.generation.clone(),
                credentials: None,
            })
            .unwrap(),
        )
        .unwrap();
        tokens
    }

    #[tokio::test]
    async fn registration_rejection_explains_the_provider_requirement() {
        let app = Router::new().route(
            "/register",
            axum::routing::post(|| async { (axum::http::StatusCode::FORBIDDEN, "Forbidden") }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        crate::http();
        let mut manager = AuthorizationManager::new(&base).await.unwrap();
        let mut metadata = AuthorizationMetadata::default();
        metadata.authorization_endpoint = format!("{base}/authorize");
        metadata.token_endpoint = format!("{base}/token");
        metadata.registration_endpoint = Some(format!("{base}/register"));
        metadata.response_types_supported = Some(vec!["code".into()]);
        manager.set_metadata(metadata);
        let error = AuthorizationSession::new(
            manager,
            AuthorizationRequest::new("http://127.0.0.1/callback").with_client_name("Carbon"),
        )
        .await
        .err()
        .unwrap()
        .1;
        let generic = registration_error("https://other.example/mcp", &error).to_string();
        assert!(generic.contains("refused to register Carbon"), "{generic}");
        let figma = registration_error("https://mcp.figma.com/mcp", &error).to_string();
        assert!(
            figma.contains("Figma only accepts approved MCP clients"),
            "{figma}"
        );
        assert!(!figma.contains("Registration failed"));
        server.abort();
    }

    #[tokio::test]
    async fn a_pending_login_cannot_restore_signed_out_tokens() {
        let tokens = tokens().await;
        crate::store::write_private_atomic(
            &tokens.path,
            &serde_json::to_vec(&TokenFile {
                generation: "revoked".into(),
                credentials: None,
            })
            .unwrap(),
        )
        .unwrap();
        assert!(tokens
            .save(StoredCredentials::new("client".into(), None, vec![], None))
            .await
            .is_err());
        assert!(tokens.load().await.unwrap().is_none());
        tokio::fs::remove_dir_all(tokens.path.parent().unwrap())
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn token_rotation_is_saved_before_another_connection_can_refresh() {
        let tokens = tokens().await;
        let seen: Arc<Mutex<Vec<String>>> = Default::default();
        let state = seen.clone();
        let app = Router::new().route("/token", axum::routing::post(move |body: String| {
            let seen = state.clone();
            async move {
                let pairs: HashMap<String,String> = form_urlencoded::parse(body.as_bytes()).into_owned().collect();
                seen.lock().await.push(pairs["refresh_token"].clone());
                axum::Json(json!({"access_token":"new-access", "refresh_token":"rotated-refresh", "token_type":"Bearer", "expires_in":3600}))
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        tokens.save(StoredCredentials::new("carbon-test".into(), Some(serde_json::from_value(json!({
            "access_token":"expired-access", "refresh_token":"old-refresh", "token_type":"Bearer", "expires_in":1
        })).unwrap()), vec![], Some(1)).with_issuer(Some(base.clone()))).await.unwrap();
        let make = || async {
            crate::http();
            let mut manager = AuthorizationManager::new(&base).await.unwrap();
            let mut metadata = AuthorizationMetadata::default();
            metadata.issuer = Some(base.clone());
            metadata.authorization_endpoint = format!("{base}/authorize");
            metadata.token_endpoint = format!("{base}/token");
            manager.set_metadata(metadata);
            manager.set_credential_store(tokens.clone());
            manager
                .configure_client(OAuthClientConfig::new(
                    "carbon-test",
                    "http://127.0.0.1/callback",
                ))
                .unwrap();
            manager
        };
        let (a, b) = tokio::join!(make(), make());
        let (first, second) = tokio::join!(a.get_access_token(), b.get_access_token());
        assert_eq!(first.unwrap(), "new-access");
        assert_eq!(second.unwrap(), "new-access");
        assert_eq!(*seen.lock().await, vec!["old-refresh", "rotated-refresh"]);
        let saved = serde_json::to_value(tokens.load().await.unwrap().unwrap()).unwrap();
        assert_eq!(saved["token_response"]["refresh_token"], "rotated-refresh");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&tokens.path)
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        server.abort();
        tokio::fs::remove_dir_all(tokens.path.parent().unwrap())
            .await
            .unwrap();
    }
}

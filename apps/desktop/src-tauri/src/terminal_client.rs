//! Installation-scoped ownership lets a complete quit end our remote shells without stopping another Mac's.
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, OnceCell};
use uuid::Uuid;

#[derive(Default, Clone, Serialize, Deserialize)]
struct Owners {
    active: HashMap<String, Uuid>,
    pending: HashMap<String, Vec<Uuid>>,
}

struct Registry {
    path: PathBuf,
    owners: Mutex<Owners>,
}

async fn registry() -> Result<&'static Registry> {
    static REGISTRY: OnceCell<Registry> = OnceCell::const_new();
    REGISTRY
        .get_or_try_init(|| async {
            let path = crate::store::get_home_app_dir()
                .await?
                .join("terminal-owners.json");
            let owners = Mutex::new(crate::store::read_json(&path).await?);
            Ok(Registry { path, owners })
        })
        .await
}

impl Registry {
    async fn save(&self, current: &mut Owners, next: Owners) -> Result<()> {
        crate::store::write_atomic(&self.path, serde_json::to_vec(&next)?).await?;
        *current = next;
        Ok(())
    }
}

pub(crate) async fn owner(server: &str) -> Result<Uuid> {
    let registry = registry().await?;
    let mut owners = registry.owners.lock().await;
    if let Some(owner) = owners.active.get(server) {
        return Ok(*owner);
    }
    let id = Uuid::new_v4();
    let mut next = owners.clone();
    next.active.insert(server.into(), id);
    registry.save(&mut owners, next).await?;
    Ok(id)
}

/// A disconnected server receives the same idempotent close when it returns.
pub(crate) async fn cleanup(server: String) -> Result<()> {
    let registry = registry().await?;
    let pending = registry
        .owners
        .lock()
        .await
        .pending
        .get(&server)
        .cloned()
        .unwrap_or_default();
    for owner in pending {
        let result = crate::servers::server_invoke(
            server.clone(),
            "terminal_close_owner".into(),
            serde_json::json!({ "owner": owner }),
        )
        .await;
        if let Err(e) = result {
            if !e
                .as_str()
                .is_some_and(|s| s == "unknown command terminal_close_owner")
            {
                return Ok(());
            }
        }
        let mut owners = registry.owners.lock().await;
        let mut next = owners.clone();
        if let Some(ids) = next.pending.get_mut(&server) {
            ids.retain(|id| *id != owner);
            if ids.is_empty() {
                next.pending.remove(&server);
            }
        }
        registry.save(&mut owners, next).await?;
    }
    Ok(())
}

pub(crate) async fn quit_completely() -> Result<()> {
    let registry = registry().await?;
    let servers = {
        let mut owners = registry.owners.lock().await;
        if owners.active.is_empty() && owners.pending.is_empty() {
            return Ok(());
        }
        let mut next = owners.clone();
        for (server, owner) in next.active.drain() {
            if server != crate::servers::LOCAL {
                next.pending.entry(server).or_default().push(owner);
            }
        }
        let servers: Vec<_> = next.pending.keys().cloned().collect();
        registry.save(&mut owners, next).await?;
        servers
    };
    let cleanups = futures_util::future::join_all(servers.into_iter().map(cleanup));
    let _ = tokio::time::timeout(Duration::from_secs(3), cleanups).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::servers::{add_server, list_servers, server_invoke, set_server_on, ServerStatus};
    use serde_json::json;

    /// CARBON_TEST_TERMINAL_HOME names a disposable live server with one coding session.
    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn complete_quit_closes_remote_terminals_after_reconnect() {
        let client =
            std::env::temp_dir().join(format!("carbon-terminal-client-{}", Uuid::new_v4()));
        std::env::set_var("CARBON_HOME", &client);
        let fixture = PathBuf::from(std::env::var_os("CARBON_TEST_TERMINAL_HOME").unwrap());
        let rows: serde_json::Value = crate::store::read_json(&fixture.join("sessions/index.json"))
            .await
            .unwrap();
        let session = rows[0]["sessionId"].clone();
        let token = std::fs::read_to_string(fixture.join("serve-token")).unwrap();
        let port = std::fs::read_to_string(fixture.join("serve-port")).unwrap();
        let url = format!("ws://127.0.0.1:{}", port.lines().next().unwrap());
        crate::servers::start(crate::sink::Sink::new(|_, _| {})).await;
        let server = add_server(url, token, Some("Terminal test".into()))
            .await
            .unwrap()
            .id;
        let connected = || async {
            tokio::time::timeout(Duration::from_secs(10), async {
                while !list_servers()
                    .iter()
                    .any(|s| s.id == server && s.status == ServerStatus::Connected)
                {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
            })
            .await
            .unwrap();
        };
        connected().await;
        let id = Uuid::new_v4();
        let open = json!({"sessionId": session, "id": id, "additional": false});
        let tab = server_invoke(server.clone(), "terminal_open".into(), open)
            .await
            .unwrap();
        assert_eq!(tab[0]["id"], json!(id));
        let old_owner = owner(&server).await.unwrap();
        set_server_on(server.clone(), false).await.unwrap();
        quit_completely().await.unwrap();
        let registry = registry().await.unwrap();
        let saved: Owners = crate::store::read_json(&registry.path).await.unwrap();
        assert_eq!(saved.pending[&server], vec![old_owner]);
        assert!(!saved.active.contains_key(&server));
        set_server_on(server.clone(), true).await.unwrap();
        connected().await;
        tokio::time::timeout(Duration::from_secs(5), async {
            while registry.owners.lock().await.pending.contains_key(&server) {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        assert_ne!(owner(&server).await.unwrap(), old_owner);
        std::fs::remove_dir_all(client).unwrap();
    }
}

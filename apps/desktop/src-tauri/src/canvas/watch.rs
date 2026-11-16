use std::{
    collections::{BTreeMap, BTreeSet},
    sync::LazyLock,
    time::Duration,
};
use tokio::sync::Mutex;

use super::{
    commands::{announce, CANVAS_PROBLEM},
    model::*,
    storage::Store,
};
use crate::sink::Sink;

static SCOPES: LazyLock<Mutex<BTreeMap<String, Vec<String>>>> =
    LazyLock::new(|| Mutex::new(BTreeMap::new()));

pub(super) async fn watch(scope: String, ids: Vec<String>) -> Result<(), String> {
    name(&scope)?;
    if ids.len() > 32 {
        return Err("Watch at most 32 canvases per scope.".into());
    }
    for id in &ids {
        uuid(id)?;
    }
    let mut scopes = SCOPES.lock().await;
    if ids.is_empty() {
        scopes.remove(&scope);
    } else {
        if scopes.len() >= 128 && !scopes.contains_key(&scope) {
            return Err("Too many Canvas watch scopes.".into());
        }
        scopes.insert(scope, ids);
    }
    Ok(())
}

/// Polling also sees another worktree server's atomic renames on the shared config directory.
pub fn start(sink: Sink) {
    tokio::spawn(async move {
        if let Ok(store) = Store::open().await {
            if let Err(error) = store.cleanup_deleted().await {
                eprintln!("[canvas deletion cleanup] {error}");
            }
        }
        let mut observed = BTreeMap::<String, String>::new();
        loop {
            tokio::time::sleep(Duration::from_millis(750)).await;
            let ids: BTreeSet<String> = SCOPES.lock().await.values().flatten().cloned().collect();
            observed.retain(|id, _| ids.contains(id));
            if ids.is_empty() {
                continue;
            }
            let Ok(store) = Store::open().await else {
                continue;
            };
            for id in ids {
                let stamp = store.stamp(&id).await;
                let key = match &stamp {
                    Ok(value) => value.clone(),
                    Err(message) => format!("error:{message}"),
                };
                if observed.get(&id) == Some(&key) {
                    continue;
                }
                observed.insert(id.clone(), key);
                let result = match stamp {
                    Ok(_) => store.reconcile(&id).await,
                    Err(message) => Err(message),
                };
                match result {
                    Ok((canvas, problems)) => {
                        announce(&sink, &canvas);
                        for problem in problems {
                            let _ = sink.emit(CANVAS_PROBLEM, problem);
                        }
                    }
                    Err(message) => {
                        let path = store
                            .dir(&id)
                            .unwrap()
                            .join("canvas.json")
                            .to_string_lossy()
                            .into();
                        let _ = sink.emit(CANVAS_PROBLEM, CanvasProblem { id, path, message });
                    }
                }
            }
        }
    });
}

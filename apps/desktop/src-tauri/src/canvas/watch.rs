use std::{
    collections::{BTreeMap, BTreeSet},
    sync::LazyLock,
    time::Duration,
};
use tokio::sync::Mutex;

use super::{
    commands::{announce, CANVAS_DELETED, CANVAS_PROBLEM},
    model::*,
    storage::Store,
};
use crate::sink::Sink;

static SCOPES: LazyLock<Mutex<BTreeMap<String, Vec<String>>>> =
    LazyLock::new(|| Mutex::new(BTreeMap::new()));

/// Keep each client scope independent so closing one canvas cannot stop another watch.
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
                refresh(&store, &sink, &mut observed, id).await;
            }
        }
    });
}

/// Read shared-store tombstones before directory stamps so remote deletion is a state change.
pub(super) async fn refresh(
    store: &Store,
    sink: &Sink,
    observed: &mut BTreeMap<String, String>,
    id: String,
) {
    match store.deleted(&id).await {
        Ok(Some(deleted)) => {
            let key = format!("deleted:{}", deleted.change.id);
            if observed.get(&id) != Some(&key) {
                let _ = sink.emit(CANVAS_DELETED, deleted);
            }
            observed.insert(id, key);
            return;
        }
        Err(message) => {
            let key = format!("deletion-error:{message}");
            if observed.get(&id) != Some(&key) {
                let path = store
                    .root
                    .join("deleted")
                    .join(format!("{id}.json"))
                    .to_string_lossy()
                    .into();
                let _ = sink.emit(
                    CANVAS_PROBLEM,
                    CanvasProblem {
                        id: id.clone(),
                        path,
                        message,
                    },
                );
            }
            observed.insert(id, key);
            return;
        }
        Ok(None) => {}
    }
    let stamp = store.stamp(&id).await;
    let key = match &stamp {
        Ok(value) => value.clone(),
        Err(message) => format!("error:{message}"),
    };
    if observed.get(&id) == Some(&key) {
        return;
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

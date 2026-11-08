//! Sync baselines and pending writes survive restarts without changing a Page’s identity.

use std::{
    collections::HashMap,
    future::Future,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, LazyLock, Weak,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tokio::{
    fs,
    sync::{Mutex, OwnedMutexGuard},
};

use crate::{
    pages::Page,
    pages_linear::{
        sync_action, LinearDocument, LinearDocumentList, LinearDocumentSummary, LinearDocuments,
        LinearSyncError, SyncAction,
    },
    sink::Sink,
};

const STATE_LIMIT: u64 = 4 * 1024 * 1024;
static QUEUES: LazyLock<Mutex<HashMap<String, Weak<Mutex<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static BACKGROUND_RUNNING: AtomicBool = AtomicBool::new(false);
static BACKGROUND_CURSOR: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct LinearPageLink {
    pub document_id: String,
    pub url: String,
    pub last_synced_at: String,
    pub remote_updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "events.ts")]
pub enum PageSyncStatus {
    Synced,
    LocalChanges,
    Conflict,
    Missing,
    Error,
    Unlinked,
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct PageSyncConflict {
    pub base_title: String,
    #[ts(type = "number")]
    pub local_revision: u64,
    pub remote: LinearDocumentSummary,
    pub remote_preview: String,
    pub remote_bytes: usize,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedConflict {
    base_title: String,
    base_markdown: String,
    local_revision: u64,
    remote: LinearDocument,
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct PageSyncState {
    pub page: Page,
    pub link: Option<LinearPageLink>,
    pub status: PageSyncStatus,
    pub error: Option<String>,
    pub conflict: Option<PageSyncConflict>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PushAttempt {
    title: String,
    markdown: String,
    local_revision: u64,
    expected: LinearDocument,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    version: u8,
    link: LinearPageLink,
    base_title: String,
    base_markdown: String,
    local_base_title: String,
    status: PageSyncStatus,
    error: Option<String>,
    conflict: Option<SavedConflict>,
    attempt: Option<PushAttempt>,
    failures: u32,
    next_retry_at: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Reservation {
    page_id: String,
    remote: LinearDocument,
    project_paths: Vec<String>,
}

#[derive(Clone)]
struct SyncStore {
    root: PathBuf,
}

impl SyncStore {
    async fn open() -> Result<Self, String> {
        Ok(Self {
            root: crate::store::get_home_app_dir()
                .await
                .map_err(|e| e.to_string())?
                .join("pages/linear-sync"),
        })
    }

    fn page_path(&self, id: &str) -> Result<PathBuf, String> {
        canonical_id(id)?;
        Ok(self.root.join(format!("{id}.json")))
    }

    fn reservation_path(&self, remote_id: &str) -> Result<PathBuf, String> {
        canonical_id(remote_id)?;
        Ok(self
            .root
            .join("reservations")
            .join(format!("{remote_id}.json")))
    }

    async fn read(&self, id: &str) -> Result<Option<Record>, String> {
        Ok(self
            .read_record(id)
            .await?
            .filter(|r| r.status != PageSyncStatus::Unlinked))
    }

    async fn read_record(&self, id: &str) -> Result<Option<Record>, String> {
        let record: Option<Record> = read_json(&self.page_path(id)?).await?;
        if record.as_ref().is_some_and(|r| r.version != 1) {
            return Err("This Page’s sync state needs a newer Carbon version.".into());
        }
        Ok(record)
    }

    async fn write(&self, id: &str, record: &Record) -> Result<(), String> {
        write_json(self.page_path(id)?, record).await
    }

    async fn guard(
        &self,
        kind: &str,
        id: &str,
    ) -> Result<(OwnedMutexGuard<()>, std::fs::File), String> {
        canonical_id(id)?;
        let name = format!("{kind}-{id}");
        let key = format!("{}/{name}", self.root.display());
        let queue = {
            let mut held = QUEUES.lock().await;
            held.retain(|_, queue| queue.strong_count() > 0);
            match held.get(&key).and_then(Weak::upgrade) {
                Some(queue) => queue,
                None => {
                    let queue = Arc::new(Mutex::new(()));
                    held.insert(key, Arc::downgrade(&queue));
                    queue
                }
            }
        };
        let owned = queue.lock_owned().await;
        let locks = self.root.join("locks");
        fs::create_dir_all(&locks)
            .await
            .map_err(|e| e.to_string())?;
        let lock = tokio::task::spawn_blocking(move || {
            use std::os::{fd::AsRawFd, unix::fs::OpenOptionsExt};
            let file = std::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(false)
                .mode(0o600)
                .open(locks.join(name))
                .map_err(|e| e.to_string())?;
            if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } != 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }
            Ok::<_, String>(file)
        })
        .await
        .map_err(|e| e.to_string())??;
        Ok((owned, lock))
    }

    async fn ids(&self) -> Result<Vec<String>, String> {
        let mut entries = match fs::read_dir(&self.root).await {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
            Err(e) => return Err(e.to_string()),
        };
        let mut ids = Vec::new();
        while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
            let path = entry.path();
            if path.extension().and_then(|v| v.to_str()) != Some("json") {
                continue;
            }
            if let Some(id) = path
                .file_stem()
                .and_then(|v| v.to_str())
                .filter(|id| canonical_id(id).is_ok())
            {
                if matches!(self.read(id).await, Ok(Some(record)) if record.status != PageSyncStatus::Conflict && record.next_retry_at <= now_millis())
                {
                    ids.push(id.to_string());
                }
            }
        }
        ids.sort();
        Ok(ids)
    }
}

trait Repository: Send + Sync {
    fn read(&self, id: &str) -> impl Future<Output = Result<Page, String>> + Send;
    fn existing(&self, id: &str) -> impl Future<Output = Result<Option<Page>, String>> + Send;
    fn create(
        &self,
        id: &str,
        title: &str,
        markdown: &str,
        projects: &[String],
    ) -> impl Future<Output = Result<Page, String>> + Send;
    fn update(
        &self,
        id: &str,
        revision: u64,
        title: &str,
        markdown: &str,
    ) -> impl Future<Output = Result<Page, String>> + Send;
    fn update_projects(
        &self,
        id: &str,
        revision: u64,
        projects: Vec<String>,
    ) -> impl Future<Output = Result<Page, String>> + Send;
}

trait Remote: Send + Sync {
    fn read(
        &self,
        id: &str,
    ) -> impl Future<Output = Result<LinearDocument, LinearSyncError>> + Send;
    fn push(
        &self,
        expected: &LinearDocument,
        title: &str,
        markdown: &str,
    ) -> impl Future<Output = Result<LinearDocument, LinearSyncError>> + Send;
}

#[derive(Clone)]
struct CorePages {
    sink: Sink,
}

impl Repository for CorePages {
    async fn read(&self, id: &str) -> Result<Page, String> {
        crate::pages::read_page(id.into()).await
    }
    async fn existing(&self, id: &str) -> Result<Option<Page>, String> {
        canonical_id(id)?;
        let path = crate::store::get_home_app_dir()
            .await
            .map_err(|e| e.to_string())?
            .join("pages")
            .join(format!("{id}.md"));
        match fs::metadata(path).await {
            Ok(_) => self.read(id).await.map(Some),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }
    async fn create(
        &self,
        id: &str,
        title: &str,
        markdown: &str,
        projects: &[String],
    ) -> Result<Page, String> {
        crate::pages::create_linked_page(
            self.sink.clone(),
            id.into(),
            title.into(),
            markdown.into(),
            projects.to_vec(),
        )
        .await
    }
    async fn update(
        &self,
        id: &str,
        revision: u64,
        title: &str,
        markdown: &str,
    ) -> Result<Page, String> {
        crate::pages::update_page(
            self.sink.clone(),
            id.into(),
            revision,
            Some(title.into()),
            Some(markdown.into()),
            None,
            None,
        )
        .await
    }
    async fn update_projects(
        &self,
        id: &str,
        revision: u64,
        projects: Vec<String>,
    ) -> Result<Page, String> {
        self.set_projects(id, revision, projects).await
    }
}

impl CorePages {
    async fn set_projects(
        &self,
        id: &str,
        revision: u64,
        projects: Vec<String>,
    ) -> Result<Page, String> {
        crate::pages::update_page(
            self.sink.clone(),
            id.into(),
            revision,
            None,
            None,
            Some(projects),
            None,
        )
        .await
    }
}

impl Remote for LinearDocuments {
    async fn read(&self, id: &str) -> Result<LinearDocument, LinearSyncError> {
        self.read(id).await
    }
    async fn push(
        &self,
        expected: &LinearDocument,
        title: &str,
        markdown: &str,
    ) -> Result<LinearDocument, LinearSyncError> {
        self.push(expected, title, markdown).await
    }
}

struct Engine<R, C> {
    store: SyncStore,
    pages: R,
    remote: C,
}

impl<R: Repository, C: Remote> Engine<R, C> {
    async fn import(
        &self,
        document_id: &str,
        project_paths: Vec<String>,
    ) -> Result<PageSyncState, String> {
        let requested_projects = project_paths.clone();
        let remote = self
            .remote
            .read(document_id)
            .await
            .map_err(|e| e.to_string())?;
        let _import = self.store.guard("import", &remote.summary.id).await?;
        let reservation_path = self.store.reservation_path(&remote.summary.id)?;
        let previous = read_json::<Reservation>(&reservation_path).await?;
        let reservation = if let Some(reservation) = previous {
            let old: Option<Record> =
                read_json(&self.store.page_path(&reservation.page_id)?).await?;
            if old.is_some_and(|r| r.status == PageSyncStatus::Unlinked) {
                let reservation = Reservation {
                    page_id: uuid::Uuid::now_v7().to_string(),
                    remote,
                    project_paths,
                };
                write_json(reservation_path, &reservation).await?;
                reservation
            } else {
                reservation
            }
        } else {
            let reservation = Reservation {
                page_id: uuid::Uuid::now_v7().to_string(),
                remote,
                project_paths,
            };
            write_json(reservation_path, &reservation).await?;
            reservation
        };
        let _page = self.store.guard("page", &reservation.page_id).await?;
        let page = match self.pages.existing(&reservation.page_id).await? {
            Some(page) => page,
            None => {
                self.pages
                    .create(
                        &reservation.page_id,
                        &local_title(&reservation.remote.summary.title),
                        &reservation.remote.markdown,
                        &reservation.project_paths,
                    )
                    .await?
            }
        };
        let page = merge_projects(&self.pages, page, &requested_projects).await?;
        if let Some(record) = self.store.read(&page.id).await? {
            return Ok(state(page, Some(record)));
        }
        let record = record_from(&reservation.remote);
        self.store.write(&page.id, &record).await?;
        Ok(state(page, Some(record)))
    }

    async fn sync(
        &self,
        id: &str,
        revision: u64,
        resolution: Option<&str>,
        expected_remote_updated_at: Option<&str>,
        background: bool,
    ) -> Result<PageSyncState, String> {
        let _guard = self.store.guard("page", id).await?;
        let page = self.pages.read(id).await?;
        check_revision(&page, revision)?;
        let Some(mut record) = self.store.read(id).await? else {
            return Ok(state(page, None));
        };
        if page.trashed {
            return Ok(paused_state(page, record));
        }
        if resolution.is_some_and(|value| !matches!(value, "carbon" | "linear")) {
            return Err("Choose Carbon or Linear to resolve this sync conflict.".into());
        }
        if resolution.is_some() && record.conflict.is_none() {
            return Err(
                "There is no saved sync conflict to resolve. Refresh the Page first.".into(),
            );
        }
        if background
            && (record.status == PageSyncStatus::Conflict || record.next_retry_at > now_millis())
        {
            return Ok(state(page, Some(record)));
        }
        let remote = match self.remote.read(&record.link.document_id).await {
            Ok(remote) => remote,
            Err(error) => return self.fail(page, record, error).await,
        };
        if let Some(choice) = resolution {
            let expected = expected_remote_updated_at
                .ok_or("Refresh both versions before resolving this conflict.")?;
            let displayed = &record
                .conflict
                .as_ref()
                .ok_or("Refresh the conflict first.")?
                .remote;
            if expected != displayed.summary.updated_at
                || expected != remote.summary.updated_at
                || !same_remote(displayed, &remote)
            {
                return self.conflict(page, record, remote).await;
            }
            let current = self.pages.read(id).await?;
            check_revision(&current, revision)?;
            if choice == "linear" {
                return self.pull(current, record, remote).await;
            }
            return self.push(current, record, remote, true).await;
        }
        if record.conflict.is_some() {
            return self
                .conflict(self.pages.read(id).await?, record, remote)
                .await;
        }
        if let Some(attempt) = record.attempt.clone() {
            if remote.summary.title == attempt.title && remote.markdown == attempt.markdown {
                record = confirmed(record, &remote);
                self.store.write(id, &record).await?;
                return Ok(state(self.pages.read(id).await?, Some(record)));
            }
            return self
                .conflict(self.pages.read(id).await?, record, remote)
                .await;
        }
        let effective_title = if page.title == record.local_base_title {
            record.base_title.as_str()
        } else {
            page.title.as_str()
        };
        match sync_action(
            &record.base_title,
            &record.base_markdown,
            effective_title,
            &page.markdown,
            &remote,
        ) {
            SyncAction::Unchanged | SyncAction::Converged => {
                record = confirmed(record, &remote);
                self.store.write(id, &record).await?;
                Ok(state(self.pages.read(id).await?, Some(record)))
            }
            SyncAction::Pull => self.pull(page, record, remote).await,
            SyncAction::Push => self.push(page, record, remote, false).await,
            SyncAction::Conflict => {
                self.conflict(self.pages.read(id).await?, record, remote)
                    .await
            }
        }
    }

    async fn pull(
        &self,
        page: Page,
        record: Record,
        remote: LinearDocument,
    ) -> Result<PageSyncState, String> {
        let updated = self
            .pages
            .update(
                &page.id,
                page.revision,
                &local_title(&remote.summary.title),
                &remote.markdown,
            )
            .await;
        match updated {
            Ok(page) => {
                let record = confirmed(record, &remote);
                self.store.write(&page.id, &record).await?;
                Ok(state(page, Some(record)))
            }
            Err(error) => {
                let current = self.pages.read(&page.id).await?;
                if current.revision != page.revision {
                    self.conflict(current, record, remote).await
                } else {
                    Err(error)
                }
            }
        }
    }

    async fn push(
        &self,
        page: Page,
        mut record: Record,
        remote: LinearDocument,
        force_local_title: bool,
    ) -> Result<PageSyncState, String> {
        let current = self.pages.read(&page.id).await?;
        if current.trashed {
            return Ok(paused_state(current, record));
        }
        if current.revision != page.revision {
            return Ok(state(current, Some(record)));
        }
        let previous_attempt = record.attempt.clone();
        let submitted_title = if !force_local_title && page.title == record.local_base_title {
            remote.summary.title.clone()
        } else {
            page.title.clone()
        };
        record.attempt = Some(PushAttempt {
            title: submitted_title.clone(),
            markdown: page.markdown.clone(),
            local_revision: page.revision,
            expected: remote.clone(),
        });
        self.store.write(&page.id, &record).await?;
        let current = self.pages.read(&page.id).await?;
        if current.trashed || current.revision != page.revision {
            record.attempt = previous_attempt;
            self.store.write(&page.id, &record).await?;
            return Ok(if current.trashed {
                paused_state(current, record)
            } else {
                state(current, Some(record))
            });
        }
        match self
            .remote
            .push(&remote, &submitted_title, &page.markdown)
            .await
        {
            Ok(saved) => {
                let current = self.pages.read(&page.id).await?;
                if current.revision == page.revision
                    && (current.title != local_title(&saved.summary.title)
                        || current.markdown != saved.markdown)
                {
                    match self
                        .pages
                        .update(
                            &page.id,
                            page.revision,
                            &local_title(&saved.summary.title),
                            &saved.markdown,
                        )
                        .await
                    {
                        Ok(_) => {}
                        Err(error) => {
                            if self.pages.read(&page.id).await?.revision == page.revision {
                                return Err(error);
                            }
                        }
                    }
                }
                let record = confirmed(record, &saved);
                self.store.write(&page.id, &record).await?;
                Ok(state(self.pages.read(&page.id).await?, Some(record)))
            }
            Err(LinearSyncError::Conflict(remote)) => {
                self.conflict(self.pages.read(&page.id).await?, record, remote)
                    .await
            }
            Err(error) => {
                self.fail(self.pages.read(&page.id).await?, record, error)
                    .await
            }
        }
    }

    async fn conflict(
        &self,
        page: Page,
        mut record: Record,
        remote: LinearDocument,
    ) -> Result<PageSyncState, String> {
        record.conflict = Some(SavedConflict {
            base_title: record.base_title.clone(),
            base_markdown: record.base_markdown.clone(),
            local_revision: page.revision,
            remote,
        });
        record.status = PageSyncStatus::Conflict;
        record.error = None;
        record.attempt = None;
        record.failures = 0;
        record.next_retry_at = 0;
        self.store.write(&page.id, &record).await?;
        Ok(state(page, Some(record)))
    }

    async fn fail(
        &self,
        page: Page,
        mut record: Record,
        error: LinearSyncError,
    ) -> Result<PageSyncState, String> {
        record.status = if matches!(error, LinearSyncError::Missing) {
            PageSyncStatus::Missing
        } else {
            PageSyncStatus::Error
        };
        record.error = Some(error.to_string());
        // A failed refresh does not prove an earlier uncertain write was rejected.
        record.failures = record.failures.saturating_add(1);
        let delay = if matches!(
            error,
            LinearSyncError::Unauthorized | LinearSyncError::NotConnected
        ) {
            900_000
        } else if matches!(error, LinearSyncError::RateLimited) {
            300_000
        } else {
            (30_000u64.saturating_mul(1u64 << record.failures.min(5))).min(900_000)
        };
        record.next_retry_at = now_millis().saturating_add(delay);
        self.store.write(&page.id, &record).await?;
        Ok(state(page, Some(record)))
    }
}

async fn merge_projects<R: Repository>(
    pages: &R,
    mut page: Page,
    requested: &[String],
) -> Result<Page, String> {
    for _ in 0..3 {
        let merged: Vec<String> = page
            .project_paths
            .iter()
            .chain(requested)
            .cloned()
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect();
        if merged == page.project_paths {
            return Ok(page);
        }
        match pages.update_projects(&page.id, page.revision, merged).await {
            Ok(updated) => return Ok(updated),
            Err(error) => {
                let current = pages.read(&page.id).await?;
                if current.revision == page.revision {
                    return Err(error);
                }
                page = current;
            }
        }
    }
    Err("The Page changed while linking projects. Try importing it again.".into())
}

fn state(page: Page, record: Option<Record>) -> PageSyncState {
    let Some(record) = record else {
        return PageSyncState {
            page,
            link: None,
            status: PageSyncStatus::Unlinked,
            error: None,
            conflict: None,
        };
    };
    let status = if record.status == PageSyncStatus::Synced
        && (page.title != record.local_base_title || page.markdown != record.base_markdown)
    {
        PageSyncStatus::LocalChanges
    } else {
        record.status
    };
    let conflict = record.conflict.map(|conflict| PageSyncConflict {
        base_title: conflict.base_title,
        local_revision: page.revision,
        remote: conflict.remote.summary,
        remote_preview: preview(&conflict.remote.markdown),
        remote_bytes: conflict.remote.markdown.len(),
    });
    PageSyncState {
        page,
        link: Some(record.link),
        status,
        error: record.error,
        conflict,
    }
}

fn paused_state(page: Page, record: Record) -> PageSyncState {
    let mut result = state(page, Some(record));
    result.error = Some("This Page is in Trash. Linear sync is paused.".into());
    result
}

fn record_from(remote: &LinearDocument) -> Record {
    Record {
        version: 1,
        link: link_from(remote),
        base_title: remote.summary.title.clone(),
        base_markdown: remote.markdown.clone(),
        local_base_title: local_title(&remote.summary.title),
        status: PageSyncStatus::Synced,
        error: None,
        conflict: None,
        attempt: None,
        failures: 0,
        next_retry_at: 0,
    }
}

fn link_from(remote: &LinearDocument) -> LinearPageLink {
    LinearPageLink {
        document_id: remote.summary.id.clone(),
        url: remote.summary.url.clone(),
        last_synced_at: crate::events::now_rfc3339(),
        remote_updated_at: remote.summary.updated_at.clone(),
    }
}

fn confirmed(mut record: Record, remote: &LinearDocument) -> Record {
    record.link = link_from(remote);
    record.base_title = remote.summary.title.clone();
    record.local_base_title = local_title(&remote.summary.title);
    record.base_markdown = remote.markdown.clone();
    record.status = PageSyncStatus::Synced;
    record.error = None;
    record.conflict = None;
    record.attempt = None;
    record.failures = 0;
    record.next_retry_at = 0;
    record
}

fn local_title(title: &str) -> String {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        "Untitled".into()
    } else {
        trimmed.into()
    }
}

fn preview(markdown: &str) -> String {
    let mut end = markdown.len().min(16 * 1024);
    while !markdown.is_char_boundary(end) {
        end -= 1;
    }
    markdown[..end].to_string()
}

fn same_remote(a: &LinearDocument, b: &LinearDocument) -> bool {
    a.summary.id == b.summary.id && a.summary.title == b.summary.title && a.markdown == b.markdown
}
fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}
fn canonical_id(id: &str) -> Result<(), String> {
    let value = uuid::Uuid::parse_str(id).map_err(|_| "Invalid Page or Linear document ID.")?;
    if value.to_string() != id {
        return Err("Invalid Page or Linear document ID.".into());
    }
    Ok(())
}
fn check_revision(page: &Page, revision: u64) -> Result<(), String> {
    if page.revision != revision {
        return Err(format!("Page conflict: expected revision {revision}, current revision {}. Refresh before syncing.",page.revision));
    }
    Ok(())
}

async fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<Option<T>, String> {
    let metadata = match fs::metadata(path).await {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    if !metadata.is_file() || metadata.len() > STATE_LIMIT {
        return Err("Page sync state is invalid or too large.".into());
    }
    serde_json::from_slice(&fs::read(path).await.map_err(|e| e.to_string())?)
        .map(Some)
        .map_err(|e| format!("Could not read Page sync state: {e}"))
}

async fn write_json<T: Serialize>(path: PathBuf, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > STATE_LIMIT {
        return Err("Page sync state is too large.".into());
    }
    fs::create_dir_all(path.parent().ok_or("Invalid sync state path.")?)
        .await
        .map_err(|e| e.to_string())?;
    tokio::task::spawn_blocking(move || {
        crate::store::write_private_atomic(&path, &bytes).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn emit(sink: &Sink, state: &PageSyncState) {
    let _ = sink.emit("page_sync_changed", state);
}

/// Discover only the requested page of Linear documents; no document is linked implicitly.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn list_linear_documents(
    query: Option<String>,
    after: Option<String>,
) -> Result<LinearDocumentList, String> {
    LinearDocuments::connected()
        .await
        .map_err(|e| e.to_string())?
        .list(query.as_deref(), after.as_deref())
        .await
        .map_err(|e| e.to_string())
}

/// Conflict bodies are fetched separately so the ordinary state frame carries only one full document.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn read_linear_document(document_id: String) -> Result<LinearDocument, String> {
    LinearDocuments::connected()
        .await
        .map_err(|e| e.to_string())?
        .read(&document_id)
        .await
        .map_err(|e| e.to_string())
}

/// A durable reservation makes retries return the same Page even after an interrupted import.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn import_linear_document(
    sink: Sink,
    document_id: String,
    project_paths: Vec<String>,
) -> Result<PageSyncState, String> {
    let engine = Engine {
        store: SyncStore::open().await?,
        pages: CorePages { sink: sink.clone() },
        remote: LinearDocuments::connected()
            .await
            .map_err(|e| e.to_string())?,
    };
    let result = engine.import(&document_id, project_paths).await?;
    emit(&sink, &result);
    Ok(result)
}

/// Read local sync state without requiring Linear to be reachable or still connected.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn page_sync_status(id: String) -> Result<PageSyncState, String> {
    let store = SyncStore::open().await?;
    let _guard = store.guard("page", &id).await?;
    Ok(state(
        crate::pages::read_page(id.clone()).await?,
        store.read(&id).await?,
    ))
}

/// Explicit conflict resolutions name both the displayed remote timestamp and local revision.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn sync_linear_page(
    sink: Sink,
    id: String,
    revision: u64,
    resolution: Option<String>,
    expected_remote_updated_at: Option<String>,
) -> Result<PageSyncState, String> {
    let store = SyncStore::open().await?;
    let remote = match LinearDocuments::connected().await {
        Ok(remote) => remote,
        Err(error) => {
            let _guard = store.guard("page", &id).await?;
            let page = crate::pages::read_page(id.clone()).await?;
            check_revision(&page, revision)?;
            let mut result = state(page, store.read(&id).await?);
            if result.link.is_some() {
                result.status = PageSyncStatus::Error;
                result.error = Some(error.to_string());
            }
            return Ok(result);
        }
    };
    let engine = Engine {
        store,
        pages: CorePages { sink: sink.clone() },
        remote,
    };
    let result = engine
        .sync(
            &id,
            revision,
            resolution.as_deref(),
            expected_remote_updated_at.as_deref(),
            false,
        )
        .await?;
    emit(&sink, &result);
    Ok(result)
}

/// Unlinking changes Carbon metadata only; the remote document and local history remain intact.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn unlink_linear_page(id: String, revision: u64) -> Result<PageSyncState, String> {
    let store = SyncStore::open().await?;
    unlink_at(
        &store,
        &CorePages {
            sink: Sink::new(|_, _| {}),
        },
        &id,
        revision,
    )
    .await
}

async fn unlink_at<R: Repository>(
    store: &SyncStore,
    pages: &R,
    id: &str,
    revision: u64,
) -> Result<PageSyncState, String> {
    loop {
        let initial = store.read_record(id).await?;
        let _import = match &initial {
            Some(record) => Some(store.guard("import", &record.link.document_id).await?),
            None => None,
        };
        let _page = store.guard("page", id).await?;
        let current = store.read_record(id).await?;
        if current.as_ref().map(|r| &r.link.document_id)
            != initial.as_ref().map(|r| &r.link.document_id)
        {
            continue;
        }
        let page = pages.read(id).await?;
        check_revision(&page, revision)?;
        if let Some(mut record) = current {
            // The tombstone commits unlinking before reservation cleanup, so a crash cannot reactivate an old link.
            record.status = PageSyncStatus::Unlinked;
            record.attempt = None;
            record.conflict = None;
            record.error = None;
            store.write(id, &record).await?;
            let reservation = store.reservation_path(&record.link.document_id)?;
            if read_json::<Reservation>(&reservation)
                .await?
                .is_some_and(|r| r.page_id == id)
            {
                match fs::remove_file(reservation).await {
                    Ok(()) => {}
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => return Err(e.to_string()),
                }
            }
        }
        match fs::remove_file(store.page_path(id)?).await {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
        return Ok(state(page, None));
    }
}

struct BackgroundRun;
impl Drop for BackgroundRun {
    fn drop(&mut self) {
        BACKGROUND_RUNNING.store(false, Ordering::Release);
    }
}

/// The headless server can call one bounded pass periodically to sync agent edits while no window is open.
pub async fn sync_linked_pages(sink: Sink) -> Result<(), String> {
    if BACKGROUND_RUNNING
        .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
        .is_err()
    {
        return Ok(());
    }
    let _running = BackgroundRun;
    let store = SyncStore::open().await?;
    let ids = store.ids().await?;
    if ids.is_empty() {
        return Ok(());
    }
    let remote = LinearDocuments::connected()
        .await
        .map_err(|e| e.to_string())?;
    let count = ids.len().min(4);
    let start = BACKGROUND_CURSOR.fetch_add(count, Ordering::Relaxed) % ids.len();
    let engine = Engine {
        store,
        pages: CorePages { sink: sink.clone() },
        remote,
    };
    for offset in 0..count {
        let id = &ids[(start + offset) % ids.len()];
        let page = match engine.pages.read(id).await {
            Ok(page) if !page.trashed => page,
            _ => continue,
        };
        if let Ok(result) = engine.sync(id, page.revision, None, None, true).await {
            emit(&sink, &result);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pages_linear::LinearDocumentSummary;
    use tokio::sync::Notify;

    const REMOTE_ID: &str = "019a5d79-5c92-7777-8777-777777777777";

    #[derive(Clone, Default)]
    struct TestPages {
        items: Arc<Mutex<HashMap<String, Page>>>,
        crash_after_create: Arc<AtomicBool>,
    }

    impl Repository for TestPages {
        async fn read(&self, id: &str) -> Result<Page, String> {
            self.items
                .lock()
                .await
                .get(id)
                .cloned()
                .ok_or("Missing test Page".into())
        }
        async fn existing(&self, id: &str) -> Result<Option<Page>, String> {
            Ok(self.items.lock().await.get(id).cloned())
        }
        async fn create(
            &self,
            id: &str,
            title: &str,
            markdown: &str,
            projects: &[String],
        ) -> Result<Page, String> {
            let mut items = self.items.lock().await;
            if items.contains_key(id) {
                return Err("Page already exists".into());
            }
            let page = Page {
                id: id.into(),
                title: title.into(),
                markdown: markdown.into(),
                project_paths: projects.to_vec(),
                revision: 1,
                created: "t1".into(),
                modified: "t1".into(),
                trashed: false,
                favorite: false,
            };
            items.insert(id.into(), page.clone());
            if self.crash_after_create.swap(false, Ordering::SeqCst) {
                return Err("Interrupted after Page commit".into());
            }
            Ok(page)
        }
        async fn update(
            &self,
            id: &str,
            revision: u64,
            title: &str,
            markdown: &str,
        ) -> Result<Page, String> {
            let mut items = self.items.lock().await;
            let page = items.get_mut(id).ok_or("Missing test Page")?;
            check_revision(page, revision)?;
            page.title = title.into();
            page.markdown = markdown.into();
            page.revision += 1;
            Ok(page.clone())
        }
        async fn update_projects(
            &self,
            id: &str,
            revision: u64,
            projects: Vec<String>,
        ) -> Result<Page, String> {
            let mut items = self.items.lock().await;
            let page = items.get_mut(id).ok_or("Missing test Page")?;
            check_revision(page, revision)?;
            page.project_paths = projects;
            page.revision += 1;
            Ok(page.clone())
        }
    }

    #[derive(Default)]
    struct Gate {
        entered: Notify,
        release: Notify,
    }

    struct RemoteState {
        document: LinearDocument,
        reads: usize,
        pushes: usize,
        read_gate: Option<Arc<Gate>>,
        push_gate: Option<Arc<Gate>>,
        fail_read: bool,
        uncertain_push: bool,
        normalize: bool,
    }

    #[derive(Clone)]
    struct TestRemote(Arc<Mutex<RemoteState>>);

    impl TestRemote {
        fn new() -> Self {
            Self(Arc::new(Mutex::new(RemoteState {
                document: remote("base", "r1"),
                reads: 0,
                pushes: 0,
                read_gate: None,
                push_gate: None,
                fail_read: false,
                uncertain_push: false,
                normalize: false,
            })))
        }
        async fn replace(&self, markdown: &str, revision: &str) {
            self.0.lock().await.document = remote(markdown, revision);
        }
    }

    impl Remote for TestRemote {
        async fn read(&self, _id: &str) -> Result<LinearDocument, LinearSyncError> {
            let (document, gate) = {
                let mut state = self.0.lock().await;
                state.reads += 1;
                if state.fail_read {
                    return Err(LinearSyncError::Offline("test connection lost".into()));
                }
                (state.document.clone(), state.read_gate.take())
            };
            if let Some(gate) = gate {
                gate.entered.notify_one();
                gate.release.notified().await;
            }
            Ok(document)
        }
        async fn push(
            &self,
            expected: &LinearDocument,
            title: &str,
            markdown: &str,
        ) -> Result<LinearDocument, LinearSyncError> {
            let gate = {
                let mut state = self.0.lock().await;
                if !same_remote(expected, &state.document)
                    || expected.summary.updated_at != state.document.summary.updated_at
                {
                    return Err(LinearSyncError::Conflict(state.document.clone()));
                }
                state.pushes += 1;
                state.push_gate.take()
            };
            if let Some(gate) = gate {
                gate.entered.notify_one();
                gate.release.notified().await;
            }
            let mut state = self.0.lock().await;
            let mut saved = remote(markdown, &format!("p{}", state.pushes));
            saved.summary.title = title.into();
            if state.normalize {
                saved.markdown.push('\n');
            }
            state.document = saved.clone();
            if state.uncertain_push {
                state.uncertain_push = false;
                return Err(LinearSyncError::WriteUncertain);
            }
            Ok(saved)
        }
    }

    fn remote(markdown: &str, revision: &str) -> LinearDocument {
        LinearDocument {
            summary: LinearDocumentSummary {
                id: REMOTE_ID.into(),
                title: "Title".into(),
                url: "https://linear.app/test/document/doc".into(),
                updated_at: revision.into(),
                trashed: false,
                project: None,
            },
            markdown: markdown.into(),
        }
    }

    struct Fixture {
        engine: Engine<TestPages, TestRemote>,
    }
    impl Fixture {
        fn new() -> Self {
            Self {
                engine: Engine {
                    store: SyncStore {
                        root: std::env::temp_dir()
                            .join(format!("carbon-pages-sync-{}", uuid::Uuid::now_v7())),
                    },
                    pages: TestPages::default(),
                    remote: TestRemote::new(),
                },
            }
        }
        async fn import(&self) -> Page {
            self.engine
                .import(REMOTE_ID, vec!["/project".into()])
                .await
                .unwrap()
                .page
        }
        fn restarted(&self) -> Engine<TestPages, TestRemote> {
            Engine {
                store: self.engine.store.clone(),
                pages: self.engine.pages.clone(),
                remote: self.engine.remote.clone(),
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.engine.store.root);
        }
    }

    #[tokio::test]
    async fn repeated_and_concurrent_imports_reuse_the_reserved_page() {
        let fixture = Fixture::new();
        let (a, b) = tokio::join!(
            fixture.engine.import(REMOTE_ID, vec!["/a".into()]),
            fixture.engine.import(REMOTE_ID, vec!["/b".into()])
        );
        assert_eq!(a.unwrap().page.id, b.unwrap().page.id);
        assert_eq!(fixture.engine.pages.items.lock().await.len(), 1);
        let existing = fixture.import().await;
        assert_eq!(fixture.engine.pages.items.lock().await.len(), 1);
        assert_eq!(existing.project_paths, vec!["/a", "/b", "/project"]);
        assert_eq!(existing.revision, 3);
    }

    #[tokio::test]
    async fn import_recovers_a_page_committed_before_link_metadata() {
        let fixture = Fixture::new();
        fixture
            .engine
            .pages
            .crash_after_create
            .store(true, Ordering::SeqCst);
        assert!(fixture.engine.import(REMOTE_ID, vec![]).await.is_err());
        fixture
            .engine
            .remote
            .replace("changed after interruption", "r2")
            .await;
        let resumed = fixture.restarted().import(REMOTE_ID, vec![]).await.unwrap();
        assert_eq!(resumed.page.markdown, "base");
        assert_eq!(fixture.engine.pages.items.lock().await.len(), 1);
        let synced = fixture
            .engine
            .sync(&resumed.page.id, 1, None, None, false)
            .await
            .unwrap();
        assert_eq!(synced.page.markdown, "changed after interruption");
        assert_eq!(synced.status, PageSyncStatus::Synced);
    }

    #[tokio::test]
    async fn a_local_edit_during_remote_pull_is_preserved_as_a_conflict() {
        let fixture = Fixture::new();
        let page = fixture.import().await;
        fixture.engine.remote.replace("remote edit", "r2").await;
        let gate = Arc::new(Gate::default());
        fixture.engine.remote.0.lock().await.read_gate = Some(gate.clone());
        let edit = async {
            gate.entered.notified().await;
            fixture
                .engine
                .pages
                .update(&page.id, 1, "Title", "local edit")
                .await
                .unwrap();
            gate.release.notify_one();
        };
        let (result, ()) = tokio::join!(fixture.engine.sync(&page.id, 1, None, None, false), edit);
        let state = result.unwrap();
        assert_eq!(state.status, PageSyncStatus::Conflict);
        assert_eq!(state.page.markdown, "local edit");
        assert_eq!(state.conflict.unwrap().remote_preview, "remote edit");
    }

    #[tokio::test]
    async fn confirmed_push_advances_only_the_submitted_baseline_when_local_changes_midflight() {
        let fixture = Fixture::new();
        let page = fixture.import().await;
        let submitted = fixture
            .engine
            .pages
            .update(&page.id, 1, "Title", "submitted")
            .await
            .unwrap();
        let gate = Arc::new(Gate::default());
        fixture.engine.remote.0.lock().await.push_gate = Some(gate.clone());
        let edit = async {
            gate.entered.notified().await;
            fixture
                .engine
                .pages
                .update(&page.id, 2, "Title", "newer local")
                .await
                .unwrap();
            gate.release.notify_one();
        };
        let (result, ()) = tokio::join!(
            fixture
                .engine
                .sync(&page.id, submitted.revision, None, None, false),
            edit
        );
        let state = result.unwrap();
        assert_eq!(state.status, PageSyncStatus::LocalChanges);
        assert_eq!(state.page.markdown, "newer local");
        let saved = fixture.engine.store.read(&page.id).await.unwrap().unwrap();
        assert_eq!(saved.base_markdown, "submitted");
        assert_eq!(
            fixture.engine.remote.0.lock().await.document.markdown,
            "submitted"
        );
    }

    #[tokio::test]
    async fn normalized_remote_response_updates_an_unchanged_submitted_page_once() {
        let fixture = Fixture::new();
        let page = fixture.import().await;
        fixture.engine.remote.0.lock().await.normalize = true;
        fixture
            .engine
            .pages
            .update(&page.id, 1, "Title", "submitted")
            .await
            .unwrap();
        let result = fixture
            .engine
            .sync(&page.id, 2, None, None, false)
            .await
            .unwrap();
        assert_eq!(result.status, PageSyncStatus::Synced);
        assert_eq!(result.page.markdown, "submitted\n");
        fixture
            .engine
            .sync(&page.id, result.page.revision, None, None, false)
            .await
            .unwrap();
        assert_eq!(fixture.engine.remote.0.lock().await.pushes, 1);
    }

    #[tokio::test]
    async fn local_title_projection_never_renames_an_untouched_linear_title() {
        let fixture = Fixture::new();
        fixture.engine.remote.0.lock().await.document.summary.title = "  Title  ".into();
        let page = fixture.import().await;
        assert_eq!(page.title, "Title");
        let unchanged = fixture
            .engine
            .sync(&page.id, 1, None, None, false)
            .await
            .unwrap();
        assert_eq!(unchanged.status, PageSyncStatus::Synced);
        assert_eq!(fixture.engine.remote.0.lock().await.pushes, 0);
        fixture
            .engine
            .pages
            .update(&page.id, 1, "Title", "body-only edit")
            .await
            .unwrap();
        let body = fixture
            .engine
            .sync(&page.id, 2, None, None, false)
            .await
            .unwrap();
        assert_eq!(body.status, PageSyncStatus::Synced);
        assert_eq!(
            fixture.engine.remote.0.lock().await.document.summary.title,
            "  Title  "
        );
        fixture
            .engine
            .pages
            .update(
                &page.id,
                body.page.revision,
                "Renamed locally",
                "body-only edit",
            )
            .await
            .unwrap();
        fixture
            .engine
            .sync(&page.id, body.page.revision + 1, None, None, false)
            .await
            .unwrap();
        assert_eq!(
            fixture.engine.remote.0.lock().await.document.summary.title,
            "Renamed locally"
        );
    }

    #[tokio::test]
    async fn empty_linear_titles_are_displayed_as_untitled_without_an_implicit_remote_rename() {
        let fixture = Fixture::new();
        fixture.engine.remote.0.lock().await.document.summary.title = "".into();
        let page = fixture.import().await;
        assert_eq!(page.title, "Untitled");
        assert_eq!(
            fixture
                .engine
                .sync(&page.id, 1, None, None, false)
                .await
                .unwrap()
                .status,
            PageSyncStatus::Synced
        );
        fixture
            .engine
            .pages
            .update(&page.id, 1, "Untitled", "body edit")
            .await
            .unwrap();
        assert_eq!(
            fixture
                .engine
                .sync(&page.id, 2, None, None, false)
                .await
                .unwrap()
                .status,
            PageSyncStatus::Synced
        );
        assert_eq!(
            fixture.engine.remote.0.lock().await.document.summary.title,
            ""
        );
    }

    #[tokio::test]
    async fn conflict_survives_restart_and_resolution_checks_the_displayed_remote() {
        let fixture = Fixture::new();
        let page = fixture.import().await;
        fixture
            .engine
            .pages
            .update(&page.id, 1, "Title", "local edit")
            .await
            .unwrap();
        fixture.engine.remote.replace("remote edit", "r2").await;
        let first = fixture
            .engine
            .sync(&page.id, 2, None, None, false)
            .await
            .unwrap();
        assert_eq!(first.status, PageSyncStatus::Conflict);
        let restarted = fixture.restarted();
        let reads = fixture.engine.remote.0.lock().await.reads;
        assert_eq!(
            restarted
                .sync(&page.id, 2, None, None, true)
                .await
                .unwrap()
                .status,
            PageSyncStatus::Conflict
        );
        assert_eq!(fixture.engine.remote.0.lock().await.reads, reads);
        fixture.engine.remote.replace("newer remote", "r3").await;
        let stale = restarted
            .sync(&page.id, 2, Some("carbon"), Some("r2"), false)
            .await
            .unwrap();
        assert_eq!(stale.status, PageSyncStatus::Conflict);
        assert_eq!(stale.conflict.unwrap().remote.updated_at, "r3");
        assert_eq!(fixture.engine.remote.0.lock().await.pushes, 0);
        let resolved = restarted
            .sync(&page.id, 2, Some("linear"), Some("r3"), false)
            .await
            .unwrap();
        assert_eq!(resolved.status, PageSyncStatus::Synced);
        assert_eq!(resolved.page.markdown, "newer remote");
    }

    #[tokio::test]
    async fn uncertain_write_survives_offline_refresh_and_restart_without_a_duplicate_push() {
        let fixture = Fixture::new();
        let page = fixture.import().await;
        fixture
            .engine
            .pages
            .update(&page.id, 1, "Title", "submitted")
            .await
            .unwrap();
        fixture.engine.remote.0.lock().await.uncertain_push = true;
        assert_eq!(
            fixture
                .engine
                .sync(&page.id, 2, None, None, false)
                .await
                .unwrap()
                .status,
            PageSyncStatus::Error
        );
        fixture.engine.remote.0.lock().await.fail_read = true;
        assert_eq!(
            fixture
                .engine
                .sync(&page.id, 2, None, None, false)
                .await
                .unwrap()
                .status,
            PageSyncStatus::Error
        );
        assert!(fixture
            .engine
            .store
            .read(&page.id)
            .await
            .unwrap()
            .unwrap()
            .attempt
            .is_some());
        fixture.engine.remote.0.lock().await.fail_read = false;
        let result = fixture
            .restarted()
            .sync(&page.id, 2, None, None, false)
            .await
            .unwrap();
        assert_eq!(result.status, PageSyncStatus::Synced);
        assert_eq!(fixture.engine.remote.0.lock().await.pushes, 1);
    }

    #[tokio::test]
    async fn unconfirmed_attempt_with_another_remote_version_requires_explicit_resolution() {
        let fixture = Fixture::new();
        let page = fixture.import().await;
        fixture
            .engine
            .pages
            .update(&page.id, 1, "Title", "submitted")
            .await
            .unwrap();
        fixture.engine.remote.0.lock().await.uncertain_push = true;
        fixture
            .engine
            .sync(&page.id, 2, None, None, false)
            .await
            .unwrap();
        fixture.engine.remote.replace("base", "r3").await;
        let result = fixture
            .restarted()
            .sync(&page.id, 2, None, None, false)
            .await
            .unwrap();
        assert_eq!(result.status, PageSyncStatus::Conflict);
        assert_eq!(fixture.engine.remote.0.lock().await.pushes, 1);
    }

    #[tokio::test]
    async fn unlink_tombstone_prevents_reservation_recovery_from_reactivating_the_old_page() {
        let fixture = Fixture::new();
        let page = fixture.import().await;
        let reservation = fixture.engine.store.reservation_path(REMOTE_ID).unwrap();
        let saved = fs::read(&reservation).await.unwrap();
        let mut tombstone = fixture.engine.store.read(&page.id).await.unwrap().unwrap();
        tombstone.status = PageSyncStatus::Unlinked;
        let unlinked = unlink_at(&fixture.engine.store, &fixture.engine.pages, &page.id, 1)
            .await
            .unwrap();
        assert_eq!(unlinked.status, PageSyncStatus::Unlinked);
        fs::write(&reservation, saved).await.unwrap();
        fixture
            .engine
            .store
            .write(&page.id, &tombstone)
            .await
            .unwrap();
        let imported = fixture.engine.import(REMOTE_ID, vec![]).await.unwrap();
        assert_ne!(imported.page.id, page.id);
        assert!(fixture.engine.store.read(&page.id).await.unwrap().is_none());
        assert_eq!(
            fixture.engine.pages.read(&page.id).await.unwrap().markdown,
            "base"
        );
    }

    #[tokio::test]
    async fn an_unlinked_page_stays_unlinked_after_background_passes_and_restart() {
        let fixture = Fixture::new();
        let page = fixture.import().await;
        unlink_at(&fixture.engine.store, &fixture.engine.pages, &page.id, 1)
            .await
            .unwrap();
        let reads = fixture.engine.remote.0.lock().await.reads;
        let restarted = fixture.restarted();
        let result = restarted.sync(&page.id, 1, None, None, true).await.unwrap();
        assert_eq!(result.status, PageSyncStatus::Unlinked);
        assert!(result.link.is_none());
        assert_eq!(fixture.engine.remote.0.lock().await.reads, reads);
        assert_eq!(
            state(
                fixture.engine.pages.read(&page.id).await.unwrap(),
                restarted.store.read(&page.id).await.unwrap()
            )
            .status,
            PageSyncStatus::Unlinked
        );
    }

    #[tokio::test]
    async fn discarded_and_corrupt_links_do_not_spend_the_background_quota() {
        let fixture = Fixture::new();
        let page = fixture.import().await;
        for _ in 0..40 {
            let mut record = record_from(&remote("discarded", "r1"));
            record.status = PageSyncStatus::Unlinked;
            fixture
                .engine
                .store
                .write(&uuid::Uuid::now_v7().to_string(), &record)
                .await
                .unwrap();
        }
        fs::write(
            fixture
                .engine
                .store
                .page_path(&uuid::Uuid::now_v7().to_string())
                .unwrap(),
            b"broken JSON",
        )
        .await
        .unwrap();
        assert_eq!(
            fixture.engine.store.ids().await.unwrap(),
            vec![page.id.clone()]
        );
        let result = fixture
            .restarted()
            .sync(&page.id, 1, None, None, true)
            .await
            .unwrap();
        assert_eq!(result.status, PageSyncStatus::Synced);
    }

    #[tokio::test]
    async fn trashing_a_page_during_the_remote_read_prevents_push_dispatch() {
        let fixture = Fixture::new();
        let page = fixture.import().await;
        fixture
            .engine
            .pages
            .update(&page.id, 1, "Title", "local change")
            .await
            .unwrap();
        let gate = Arc::new(Gate::default());
        fixture.engine.remote.0.lock().await.read_gate = Some(gate.clone());
        let trash = async {
            gate.entered.notified().await;
            let mut items = fixture.engine.pages.items.lock().await;
            let current = items.get_mut(&page.id).unwrap();
            current.trashed = true;
            current.revision += 1;
            drop(items);
            gate.release.notify_one();
        };
        let (result, ()) = tokio::join!(fixture.engine.sync(&page.id, 2, None, None, false), trash);
        let result = result.unwrap();
        assert!(result.page.trashed);
        assert!(result.error.unwrap().contains("Trash"));
        assert_eq!(fixture.engine.remote.0.lock().await.pushes, 0);
        assert!(fixture
            .engine
            .store
            .read(&page.id)
            .await
            .unwrap()
            .unwrap()
            .attempt
            .is_none());
    }

    #[tokio::test]
    async fn reimport_adds_project_links_without_replacing_existing_content_or_metadata() {
        let fixture = Fixture::new();
        let page = fixture
            .engine
            .import(REMOTE_ID, vec!["/a".into()])
            .await
            .unwrap()
            .page;
        fixture
            .engine
            .pages
            .update(&page.id, 1, "Locally renamed", "local content")
            .await
            .unwrap();
        {
            let mut items = fixture.engine.pages.items.lock().await;
            let current = items.get_mut(&page.id).unwrap();
            current.favorite = true;
            current.trashed = true;
        }
        let imported = fixture
            .engine
            .import(REMOTE_ID, vec!["/b".into()])
            .await
            .unwrap();
        assert_eq!(imported.page.id, page.id);
        assert_eq!(imported.page.project_paths, vec!["/a", "/b"]);
        assert_eq!(imported.page.title, "Locally renamed");
        assert_eq!(imported.page.markdown, "local content");
        assert!(imported.page.favorite && imported.page.trashed);
    }

    #[test]
    fn conflict_state_fits_a_protocol_frame_without_duplicate_document_bodies() {
        let body = "\\\"\n".repeat((256 * 1024) / 3);
        let remote = remote(&body, "r2");
        let page = Page {
            id: uuid::Uuid::now_v7().to_string(),
            title: "Title".into(),
            markdown: body.clone(),
            project_paths: vec![],
            revision: 2,
            created: "t1".into(),
            modified: "t2".into(),
            trashed: false,
            favorite: false,
        };
        let mut record = record_from(&remote);
        record.status = PageSyncStatus::Conflict;
        record.conflict = Some(SavedConflict {
            base_title: "Title".into(),
            base_markdown: body.clone(),
            local_revision: 2,
            remote,
        });
        let response = state(page, Some(record));
        let encoded = serde_json::to_vec(&response).unwrap();
        assert!(encoded.len() + 2048 < 1024 * 1024);
        assert!(response.conflict.unwrap().remote_preview.len() <= 16 * 1024);
        let value = serde_json::from_slice::<serde_json::Value>(&encoded).unwrap();
        assert!(value["link"].get("baseMarkdown").is_none());
        assert!(value["conflict"].get("baseMarkdown").is_none());
        assert!(value["conflict"]["remote"].get("markdown").is_none());
    }
}

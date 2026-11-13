//! Managed Markdown documents shared by the editor and agent commands.

use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use tokio::{fs, sync::Mutex};
use ts_rs::TS;

#[path = "pages_assets.rs"]
mod assets;

#[cfg(test)]
#[path = "pages_links_tests.rs"]
mod links_tests;

use crate::{events::now_rfc3339, sink::Sink};

const MAX_MARKDOWN: usize = 256 * 1024;
const MAX_FILE: u64 = (MAX_MARKDOWN + 96 * 1024) as u64;
static WRITE_LOCK: Mutex<()> = Mutex::const_new(());
pub const PAGES_CHANGED: &str = "pages_changed";
pub const PAGE_ASSETS_CHANGED: &str = "page_assets_changed";

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct PageAsset {
    pub id: String,
    pub name: String,
    pub path: String,
    pub mime_type: String,
    #[ts(type = "number")]
    pub size: u64,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct PageAssetWrite {
    #[ts(type = "number")]
    pub written: u64,
    pub asset: Option<PageAsset>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct Page {
    pub id: String,
    pub title: String,
    pub markdown: String,
    pub project_paths: Vec<String>,
    #[ts(type = "number")]
    pub revision: u64,
    pub created: String,
    pub modified: String,
    pub trashed: bool,
    pub favorite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct PageSummary {
    pub id: String,
    pub title: String,
    pub project_paths: Vec<String>,
    #[ts(type = "number")]
    pub revision: u64,
    pub created: String,
    pub modified: String,
    pub trashed: bool,
    pub favorite: bool,
    pub excerpt: String,
}

impl From<&Page> for PageSummary {
    fn from(page: &Page) -> Self {
        Self {
            id: page.id.clone(),
            title: page.title.clone(),
            project_paths: page.project_paths.clone(),
            revision: page.revision,
            created: page.created.clone(),
            modified: page.modified.clone(),
            trashed: page.trashed,
            favorite: page.favorite,
            excerpt: page
                .markdown
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .chars()
                .take(180)
                .collect(),
        }
    }
}

#[derive(Default)]
struct Edit {
    title: Option<String>,
    markdown: Option<String>,
    project_paths: Option<Vec<String>>,
    favorite: Option<bool>,
    trashed: Option<bool>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Metadata {
    id: String,
    title: String,
    project_paths: Vec<String>,
    revision: u64,
    created: String,
    modified: String,
    trashed: bool,
    favorite: bool,
}

impl Page {
    fn encode(&self) -> Result<String, String> {
        let metadata = Metadata {
            id: self.id.clone(),
            title: self.title.clone(),
            project_paths: self.project_paths.clone(),
            revision: self.revision,
            created: self.created.clone(),
            modified: self.modified.clone(),
            trashed: self.trashed,
            favorite: self.favorite,
        };
        let yaml = serde_yaml_ng::to_string(&metadata).map_err(|e| e.to_string())?;
        Ok(format!("---\n{yaml}---\n{}", self.markdown))
    }

    fn decode(text: &str) -> Result<Self, String> {
        let rest = text.strip_prefix("---\n").ok_or("Invalid Page metadata.")?;
        let (header, markdown) = rest.split_once("\n---\n").ok_or("Invalid Page metadata.")?;
        let metadata: Metadata =
            serde_yaml_ng::from_str(header).map_err(|e| format!("Invalid Page metadata: {e}"))?;
        Ok(Self {
            id: metadata.id,
            title: metadata.title,
            markdown: markdown.to_string(),
            project_paths: metadata.project_paths,
            revision: metadata.revision,
            created: metadata.created,
            modified: metadata.modified,
            trashed: metadata.trashed,
            favorite: metadata.favorite,
        })
    }
}

struct PagesStore {
    root: PathBuf,
    assets: PathBuf,
}

impl PagesStore {
    async fn open() -> Result<Self, String> {
        let home = crate::store::get_home_app_dir()
            .await
            .map_err(|e| e.to_string())?;
        Ok(Self {
            root: home.join("pages"),
            assets: home.join("attachments/pages"),
        })
    }

    fn path(&self, id: &str) -> Result<PathBuf, String> {
        let parsed = uuid::Uuid::parse_str(id).map_err(|_| "Invalid Page ID.")?;
        if parsed.to_string() != id {
            return Err("Invalid Page ID.".into());
        }
        Ok(self.root.join(format!("{id}.md")))
    }

    async fn read(&self, id: &str) -> Result<Page, String> {
        let path = self.path(id)?;
        self.read_at(&path, id, None).await
    }

    async fn read_at(&self, path: &Path, id: &str, revision: Option<u64>) -> Result<Page, String> {
        let text = crate::docs::read_file_capped(&path.to_string_lossy(), MAX_FILE).await?;
        let page = Page::decode(std::str::from_utf8(&text).map_err(|_| "Page is not UTF-8.")?)?;
        if page.id != id || revision.is_some_and(|revision| page.revision != revision) {
            return Err("Page metadata does not match its ID or revision.".into());
        }
        Ok(page)
    }

    fn version_path(&self, id: &str, version: u64) -> PathBuf {
        self.root
            .join("history")
            .join(id)
            .join(format!("{version}.md"))
    }

    async fn read_version(&self, id: &str, version: u64) -> Result<Page, String> {
        let current = self.read(id).await?;
        if version == 0 || version > current.revision {
            return Err("No committed Page revision at this number.".into());
        }
        self.read_at(&self.version_path(id, version), id, Some(version))
            .await
    }

    async fn history(&self, id: &str) -> Result<Vec<PageSummary>, String> {
        let current = self.read(id).await?;
        let mut entries = fs::read_dir(self.root.join("history").join(id))
            .await
            .map_err(|e| e.to_string())?;
        let mut revisions = Vec::new();
        while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            let Some(version) = path
                .file_stem()
                .and_then(|s| s.to_str())
                .and_then(|s| s.parse::<u64>().ok())
            else {
                continue;
            };
            if version > 0 && version <= current.revision {
                revisions.push(version);
            }
        }
        revisions.sort_unstable_by(|a, b| b.cmp(a));
        revisions.truncate(100);
        let mut history = Vec::with_capacity(revisions.len());
        for version in revisions {
            let page = self
                .read_at(&self.version_path(id, version), id, Some(version))
                .await?;
            history.push(PageSummary::from(&page));
        }
        Ok(history)
    }

    async fn restore_version(&self, id: &str, revision: u64, version: u64) -> Result<Page, String> {
        let _guard = WRITE_LOCK.lock().await;
        let _process = self.lock().await?;
        let current = self.read(id).await?;
        check_revision(&current, revision)?;
        if version == 0 || version > current.revision {
            return Err("No committed Page revision at this number.".into());
        }
        let mut restored = self
            .read_at(&self.version_path(id, version), id, Some(version))
            .await?;
        restored.created = current.created;
        restored.project_paths = current.project_paths;
        restored.favorite = current.favorite;
        restored.trashed = current.trashed;
        restored.modified = now_rfc3339();
        restored.revision = current
            .revision
            .checked_add(1)
            .ok_or("Page revision limit reached.")?;
        self.save(&restored).await?;
        Ok(restored)
    }

    async fn list(
        &self,
        query: Option<&str>,
        project: Option<&str>,
        trashed: bool,
    ) -> Result<Vec<PageSummary>, String> {
        let mut entries = match fs::read_dir(&self.root).await {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
            Err(e) => return Err(e.to_string()),
        };
        let words: Vec<String> = query
            .unwrap_or_default()
            .split_whitespace()
            .map(str::to_lowercase)
            .collect();
        if words.len() > 32 || query.unwrap_or_default().len() > 2048 {
            return Err("Search is too long.".into());
        }
        let mut pages = Vec::new();
        while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
            if !entry
                .file_type()
                .await
                .map_err(|e| e.to_string())?
                .is_file()
            {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("md") {
                continue;
            }
            let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            let page = self
                .read(id)
                .await
                .map_err(|e| format!("Could not read Page {id}: {e}"))?;
            if page.trashed != trashed
                || project.is_some_and(|p| !page.project_paths.iter().any(|path| path == p))
            {
                continue;
            }
            let haystack = format!("{}\n{}", page.title, page.markdown).to_lowercase();
            if words.iter().all(|word| haystack.contains(word)) {
                pages.push(PageSummary::from(&page));
            }
        }
        pages.sort_by(|a, b| b.modified.cmp(&a.modified).then_with(|| a.id.cmp(&b.id)));
        Ok(pages)
    }

    async fn backlinks(
        &self,
        id: &str,
        owner: Option<&str>,
        source_owner: Option<&str>,
    ) -> Result<Vec<PageSummary>, String> {
        let owner = owner.unwrap_or("local");
        let source_owner = source_owner.unwrap_or("local");
        self.path(id)?;
        if owner == source_owner {
            self.read(id).await?;
        }
        let mut backlinks = Vec::new();
        for summary in self.list(None, None, false).await? {
            if summary.id == id && owner == source_owner {
                continue;
            }
            let page = self.read(&summary.id).await?;
            let mut image_depth = 0;
            let linked =
                pulldown_cmark::Parser::new_ext(&page.markdown, pulldown_cmark::Options::all())
                    .any(|event| {
                        use pulldown_cmark::{Event, Tag, TagEnd};
                        match event {
                            Event::Start(Tag::Image { .. }) => {
                                image_depth += 1;
                                false
                            }
                            Event::End(TagEnd::Image) => {
                                image_depth -= 1;
                                false
                            }
                            Event::Start(Tag::Link { dest_url, .. }) if image_depth == 0 => {
                                let Some(rest) = dest_url.strip_prefix("carbon-page://") else {
                                    return false;
                                };
                                let Some((server, target)) = rest.split_once('/') else {
                                    return false;
                                };
                                let target = target.split(['#', '?']).next().unwrap_or_default();
                                target == id
                                    && match server {
                                        "local" => source_owner == owner,
                                        "this-mac" => owner == "local",
                                        _ => server == owner,
                                    }
                            }
                            _ => false,
                        }
                    });
            if linked {
                backlinks.push(summary);
            }
        }
        Ok(backlinks)
    }

    /// The lock is mandatory: a failed lock must never turn a guarded save into an overwrite.
    async fn lock(&self) -> Result<std::fs::File, String> {
        fs::create_dir_all(&self.root)
            .await
            .map_err(|e| e.to_string())?;
        let path = self.root.join(".lock");
        tokio::task::spawn_blocking(move || {
            use std::os::fd::AsRawFd;
            use std::os::unix::fs::OpenOptionsExt;
            let file = std::fs::OpenOptions::new()
                .create(true)
                .truncate(false)
                .write(true)
                .mode(0o600)
                .open(path)
                .map_err(|e| e.to_string())?;
            if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } != 0 {
                return Err(format!(
                    "Could not lock Pages: {}",
                    std::io::Error::last_os_error()
                ));
            }
            Ok(file)
        })
        .await
        .map_err(|e| e.to_string())?
    }

    async fn save(&self, page: &Page) -> Result<(), String> {
        validate(page)?;
        let history = self.root.join("history").join(&page.id);
        fs::create_dir_all(&history)
            .await
            .map_err(|e| e.to_string())?;
        let text = page.encode()?;
        let snapshot = history.join(format!("{}.md", page.revision));
        // The current file commits the revision. A crash before it lands leaves only an ignored future snapshot.
        atomic(snapshot, text.as_bytes().to_vec()).await?;
        atomic(self.path(&page.id)?, text.into_bytes()).await
    }

    async fn create(
        &self,
        title: String,
        markdown: String,
        projects: Vec<String>,
    ) -> Result<Page, String> {
        self.create_with_id(uuid::Uuid::now_v7().to_string(), title, markdown, projects)
            .await
    }

    async fn create_with_id(
        &self,
        id: String,
        title: String,
        markdown: String,
        projects: Vec<String>,
    ) -> Result<Page, String> {
        let path = self.path(&id)?;
        let _guard = WRITE_LOCK.lock().await;
        let _process = self.lock().await?;
        match fs::symlink_metadata(path).await {
            Ok(_) => return Err("Page already exists.".into()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
        let now = now_rfc3339();
        let page = Page {
            id,
            title: title.trim().to_string(),
            markdown,
            project_paths: normalize_projects(projects)?,
            revision: 1,
            created: now.clone(),
            modified: now,
            trashed: false,
            favorite: false,
        };
        self.save(&page).await?;
        Ok(page)
    }

    async fn edit(&self, id: &str, revision: u64, edit: Edit) -> Result<Page, String> {
        let _guard = WRITE_LOCK.lock().await;
        let _process = self.lock().await?;
        let mut page = self.read(id).await?;
        check_revision(&page, revision)?;
        if let Some(title) = edit.title {
            page.title = title.trim().to_string();
        }
        if let Some(markdown) = edit.markdown {
            page.markdown = markdown;
        }
        if let Some(projects) = edit.project_paths {
            page.project_paths = normalize_projects(projects)?;
        }
        if let Some(favorite) = edit.favorite {
            page.favorite = favorite;
        }
        if let Some(trashed) = edit.trashed {
            page.trashed = trashed;
        }
        page.revision = page
            .revision
            .checked_add(1)
            .ok_or("Page revision limit reached.")?;
        page.modified = now_rfc3339();
        self.save(&page).await?;
        Ok(page)
    }
}

fn check_revision(page: &Page, revision: u64) -> Result<(), String> {
    if page.revision != revision {
        return Err(format!("Page conflict: expected revision {revision}, current revision {}. Read the Page again before editing.", page.revision));
    }
    Ok(())
}

async fn atomic(path: PathBuf, contents: Vec<u8>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        crate::store::write_private_atomic(&path, &contents).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn normalize_projects(projects: Vec<String>) -> Result<Vec<String>, String> {
    if projects.len() > 32
        || projects.iter().any(|p| {
            !Path::new(p).is_absolute() || p.len() > 2048 || p.chars().any(char::is_control)
        })
    {
        return Err("Link at most 32 projects, using absolute project paths.".into());
    }
    Ok(projects
        .into_iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect())
}

fn validate(page: &Page) -> Result<(), String> {
    if page.title.is_empty()
        || page.title.chars().count() > 240
        || page.title.chars().any(char::is_control)
    {
        return Err("Give the Page a title of 1–240 characters.".into());
    }
    if page.markdown.len() > MAX_MARKDOWN {
        return Err("Page Markdown must be 256 KiB or smaller.".into());
    }
    if page
        .markdown
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err("Page Markdown must be text without binary control characters.".into());
    }
    Ok(())
}

fn announce(sink: &Sink, page: &Page) {
    let _ = sink.emit(PAGES_CHANGED, PageSummary::from(page));
}

/// Searches titles and Markdown without depending on a session or repository checkout.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn list_pages(
    query: Option<String>,
    project_path: Option<String>,
    trashed: Option<bool>,
) -> Result<Vec<PageSummary>, String> {
    PagesStore::open()
        .await?
        .list(
            query.as_deref(),
            project_path.as_deref(),
            trashed.unwrap_or(false),
        )
        .await
}

/// Resolves the stable Page ID independently of its title and project links.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn read_page(id: String) -> Result<Page, String> {
    PagesStore::open().await?.read(&id).await
}

/// Creates one document whose project links all refer to the same Markdown.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn create_page(
    sink: Sink,
    title: String,
    markdown: String,
    project_paths: Vec<String>,
) -> Result<Page, String> {
    let page = PagesStore::open()
        .await?
        .create(title, markdown, project_paths)
        .await?;
    announce(&sink, &page);
    Ok(page)
}

/// Imports reserve a stable ID first, so a retry must never replace an existing document.
pub(crate) async fn create_linked_page(
    sink: Sink,
    id: String,
    title: String,
    markdown: String,
    project_paths: Vec<String>,
) -> Result<Page, String> {
    let page = PagesStore::open()
        .await?
        .create_with_id(id, title, markdown, project_paths)
        .await?;
    announce(&sink, &page);
    Ok(page)
}

/// Refuses stale writes from either the editor or an agent.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn update_page(
    sink: Sink,
    id: String,
    revision: u64,
    title: Option<String>,
    markdown: Option<String>,
    project_paths: Option<Vec<String>>,
    favorite: Option<bool>,
) -> Result<Page, String> {
    let page = PagesStore::open()
        .await?
        .edit(
            &id,
            revision,
            Edit {
                title,
                markdown,
                project_paths,
                favorite,
                ..Default::default()
            },
        )
        .await?;
    announce(&sink, &page);
    Ok(page)
}

/// Trash keeps the document and its revision history recoverable.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn set_page_trashed(
    sink: Sink,
    id: String,
    revision: u64,
    trashed: bool,
) -> Result<Page, String> {
    let page = PagesStore::open()
        .await?
        .edit(
            &id,
            revision,
            Edit {
                trashed: Some(trashed),
                ..Default::default()
            },
        )
        .await?;
    announce(&sink, &page);
    Ok(page)
}

/// Lists the latest 100 committed revisions; older snapshots remain addressable by number.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn page_history(id: String) -> Result<Vec<PageSummary>, String> {
    PagesStore::open().await?.history(&id).await
}

/// Reads an immutable historical document without changing the current Page.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn read_page_version(id: String, version: u64) -> Result<Page, String> {
    PagesStore::open().await?.read_version(&id, version).await
}

/// Restores content as a new guarded revision, retaining current links, favorite and Trash state.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn restore_page_version(
    sink: Sink,
    id: String,
    revision: u64,
    version: u64,
) -> Result<Page, String> {
    let page = PagesStore::open()
        .await?
        .restore_version(&id, revision, version)
        .await?;
    announce(&sink, &page);
    Ok(page)
}

/// Backlinks follow real Markdown links, excluding images, code and trashed source Pages.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn page_backlinks(
    id: String,
    owner: Option<String>,
    source_owner: Option<String>,
) -> Result<Vec<PageSummary>, String> {
    PagesStore::open()
        .await?
        .backlinks(&id, owner.as_deref(), source_owner.as_deref())
        .await
}

/// Incomplete uploads remain hidden until their final manifest commits.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn list_page_assets(id: String) -> Result<Vec<PageAsset>, String> {
    PagesStore::open().await?.list_assets(&id).await
}

/// Chunks stay below the agent wire limit while completed attachments can reach 20 MiB.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn write_page_asset(
    sink: Sink,
    id: String,
    name: String,
    asset_id: String,
    offset: u64,
    data: String,
    complete: bool,
) -> Result<PageAssetWrite, String> {
    let progress = PagesStore::open()
        .await?
        .write_asset(&id, name, &asset_id, offset, data, complete)
        .await?;
    if progress.asset.is_some() {
        let _ = sink.emit(PAGE_ASSETS_CHANGED, serde_json::json!({ "id": id }));
    }
    Ok(progress)
}

/// Agent operations use the same guarded writes and change events as the editor.
pub async fn request(
    request: carbon_proto::PageRequest,
    sink: &Sink,
) -> Result<serde_json::Value, String> {
    use carbon_proto::PageRequest;
    let value = match request {
        PageRequest::List {
            query,
            project_path,
            trashed,
        } => serde_json::to_value(list_pages(query, project_path, Some(trashed)).await?),
        PageRequest::Read { id } => serde_json::to_value(read_page(id).await?),
        PageRequest::LinearList { query, after } => {
            serde_json::to_value(crate::pages_sync::list_linear_documents(query, after).await?)
        }
        PageRequest::LinearRead { document_id } => {
            serde_json::to_value(crate::pages_sync::read_linear_document(document_id).await?)
        }
        PageRequest::ImportLinear {
            document_id,
            project_paths,
        } => serde_json::to_value(
            crate::pages_sync::import_linear_document(sink.clone(), document_id, project_paths)
                .await?,
        ),
        PageRequest::SyncStatus { id } => {
            serde_json::to_value(crate::pages_sync::page_sync_status(id).await?)
        }
        PageRequest::SyncLinear {
            id,
            revision,
            resolution,
            expected_remote_updated_at,
        } => serde_json::to_value(
            crate::pages_sync::sync_linear_page(
                sink.clone(),
                id,
                revision,
                resolution,
                expected_remote_updated_at,
            )
            .await?,
        ),
        PageRequest::UnlinkLinear { id, revision } => {
            serde_json::to_value(crate::pages_sync::unlink_linear_page(id, revision).await?)
        }
        PageRequest::Backlinks {
            id,
            owner,
            source_owner,
        } => serde_json::to_value(page_backlinks(id, owner, source_owner).await?),
        PageRequest::Assets { id } => serde_json::to_value(list_page_assets(id).await?),
        PageRequest::WriteAsset {
            id,
            name,
            asset_id,
            offset,
            data,
            complete,
        } => serde_json::to_value(
            write_page_asset(sink.clone(), id, name, asset_id, offset, data, complete).await?,
        ),
        PageRequest::History { id } => serde_json::to_value(page_history(id).await?),
        PageRequest::ReadVersion { id, version } => {
            serde_json::to_value(read_page_version(id, version).await?)
        }
        PageRequest::RestoreVersion {
            id,
            revision,
            version,
        } => serde_json::to_value(restore_page_version(sink.clone(), id, revision, version).await?),
        PageRequest::Create {
            title,
            markdown,
            project_paths,
        } => serde_json::to_value(create_page(sink.clone(), title, markdown, project_paths).await?),
        PageRequest::Update {
            id,
            revision,
            title,
            markdown,
            project_paths,
            favorite,
        } => serde_json::to_value(
            update_page(
                sink.clone(),
                id,
                revision,
                title,
                markdown,
                project_paths,
                favorite,
            )
            .await?,
        ),
        PageRequest::Trash {
            id,
            revision,
            trashed,
        } => serde_json::to_value(set_page_trashed(sink.clone(), id, revision, trashed).await?),
        PageRequest::Patch {
            id,
            revision,
            old_text,
            new_text,
        } => {
            if old_text.is_empty() {
                return Err("Patch text must not be empty.".into());
            }
            let page = read_page(id.clone()).await?;
            if page.markdown.matches(&old_text).count() != 1 {
                return Err(
                    "Patch text must match exactly once. Read the Page and use a longer selection."
                        .into(),
                );
            }
            let markdown = page.markdown.replacen(&old_text, &new_text, 1);
            serde_json::to_value(
                update_page(sink.clone(), id, revision, None, Some(markdown), None, None).await?,
            )
        }
    };
    value.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> PagesStore {
        let home = std::env::temp_dir().join(format!("carbon-pages-test-{}", uuid::Uuid::new_v4()));
        PagesStore {
            root: home.join("pages"),
            assets: home.join("attachments/pages"),
        }
    }

    #[tokio::test]
    async fn pages_persist_exact_markdown_and_many_project_links() {
        let store = store();
        let markdown =
            "# Notes\n\n---\n\n```rust\nlet x = 1;\n```\n\n| A | B |\n| - | - |\n| é | 漢 |\n\n";
        let page = store
            .create(
                "Notes".into(),
                markdown.into(),
                vec!["/repo/a".into(), "/repo/b".into(), "/repo/a".into()],
            )
            .await
            .unwrap();
        let read = store.read(&page.id).await.unwrap();
        assert_eq!(read.markdown, markdown);
        assert_eq!(read.project_paths, vec!["/repo/a", "/repo/b"]);
        assert_eq!(
            store
                .list(Some("漢 Notes"), Some("/repo/b"), false)
                .await
                .unwrap()
                .len(),
            1
        );
        assert!(store
            .list(Some("missing"), None, false)
            .await
            .unwrap()
            .is_empty());
        fs::remove_dir_all(store.root.parent().unwrap())
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn competing_writers_cannot_silently_replace_each_other() {
        let store = store();
        let page = store
            .create("Notes".into(), "initial".into(), vec![])
            .await
            .unwrap();
        let (first, second) = tokio::join!(
            store.edit(
                &page.id,
                1,
                Edit {
                    markdown: Some("human".into()),
                    ..Default::default()
                }
            ),
            store.edit(
                &page.id,
                1,
                Edit {
                    markdown: Some("agent".into()),
                    ..Default::default()
                }
            )
        );
        assert_ne!(first.is_ok(), second.is_ok());
        assert!(first
            .err()
            .or(second.err())
            .unwrap()
            .starts_with("Page conflict:"));
        assert_eq!(store.read(&page.id).await.unwrap().revision, 2);
        assert!(store
            .root
            .join("history")
            .join(&page.id)
            .join("1.md")
            .exists());
        fs::remove_dir_all(store.root.parent().unwrap())
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn trash_and_restore_keep_identity_and_content() {
        let store = store();
        let page = store
            .create("Notes".into(), "body".into(), vec![])
            .await
            .unwrap();
        store
            .edit(
                &page.id,
                1,
                Edit {
                    trashed: Some(true),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert!(store.list(None, None, false).await.unwrap().is_empty());
        assert_eq!(store.list(None, None, true).await.unwrap().len(), 1);
        let restored = store
            .edit(
                &page.id,
                2,
                Edit {
                    trashed: Some(false),
                    title: Some("Renamed".into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(restored.id, page.id);
        assert_eq!(restored.markdown, "body");
        assert_eq!(restored.revision, 3);
        assert!(store.path("../escape").is_err());
        fs::remove_dir_all(store.root.parent().unwrap())
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn history_restores_content_and_preserves_current_document_metadata() {
        let store = store();
        let original = store
            .create(
                "Original".into(),
                "# First\n".into(),
                vec!["/repo/first".into()],
            )
            .await
            .unwrap();
        let changed = store
            .edit(
                &original.id,
                1,
                Edit {
                    title: Some("Changed".into()),
                    markdown: Some("# Second\n".into()),
                    project_paths: Some(vec!["/repo/second".into()]),
                    favorite: Some(true),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(
            store.read_version(&original.id, 1).await.unwrap().markdown,
            original.markdown
        );
        let trash = store
            .edit(
                &original.id,
                2,
                Edit {
                    trashed: Some(true),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert!(store
            .restore_version(&original.id, 2, 1)
            .await
            .unwrap_err()
            .starts_with("Page conflict:"));
        let restored = store
            .restore_version(&original.id, trash.revision, 1)
            .await
            .unwrap();
        assert_eq!(restored.id, original.id);
        assert_eq!(restored.created, original.created);
        assert_eq!(restored.title, original.title);
        assert_eq!(restored.markdown, original.markdown);
        assert_eq!(restored.project_paths, changed.project_paths);
        assert!(restored.favorite);
        assert!(restored.trashed);
        assert_eq!(restored.revision, 4);
        assert_eq!(
            store.read_version(&original.id, 2).await.unwrap().markdown,
            changed.markdown
        );
        let history = store.history(&original.id).await.unwrap();
        assert_eq!(
            history.iter().map(|p| p.revision).collect::<Vec<_>>(),
            vec![4, 3, 2, 1]
        );
        fs::remove_dir_all(store.root.parent().unwrap())
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn uncommitted_future_snapshots_are_neither_visible_nor_restorable() {
        let store = store();
        let mut orphan = store
            .create("Current".into(), "body".into(), vec![])
            .await
            .unwrap();
        orphan.revision = 2;
        atomic(
            store.version_path(&orphan.id, 2),
            orphan.encode().unwrap().into_bytes(),
        )
        .await
        .unwrap();
        assert_eq!(store.history(&orphan.id).await.unwrap().len(), 1);
        assert!(store.read_version(&orphan.id, 2).await.is_err());
        assert!(store.restore_version(&orphan.id, 1, 2).await.is_err());
        assert_eq!(store.read(&orphan.id).await.unwrap().revision, 1);
        let history = store.version_path(&orphan.id, 1);
        atomic(history, orphan.encode().unwrap().into_bytes())
            .await
            .unwrap();
        assert!(store
            .read_version(&orphan.id, 1)
            .await
            .unwrap_err()
            .contains("metadata"));
        fs::remove_dir_all(store.root.parent().unwrap())
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn a_reserved_import_id_cannot_replace_an_existing_page() {
        let store = store();
        let id = uuid::Uuid::now_v7().to_string();
        let original = store
            .create_with_id(id.clone(), "Imported".into(), "Original".into(), vec![])
            .await
            .unwrap();
        let error = store
            .create_with_id(id.clone(), "Retry".into(), "Overwrite".into(), vec![])
            .await
            .unwrap_err();
        assert_eq!(error, "Page already exists.");
        let current = store.read(&id).await.unwrap();
        assert_eq!(current.title, original.title);
        assert_eq!(current.markdown, original.markdown);
        assert_eq!(current.revision, 1);
        assert!(store
            .create_with_id("../escape".into(), "Invalid".into(), "".into(), vec![])
            .await
            .is_err());
        assert_eq!(store.history(&id).await.unwrap().len(), 1);
        fs::remove_dir_all(store.root.parent().unwrap())
            .await
            .unwrap();
    }
}

use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
};

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::{
    fs,
    sync::{Mutex, MutexGuard},
};

use super::model::*;

static WRITES: Mutex<()> = Mutex::const_new(());

#[derive(Clone)]
pub(super) struct Store {
    pub root: PathBuf,
    shared_lock: bool,
}

pub(super) struct Guard {
    _local: MutexGuard<'static, ()>,
    _process: std::fs::File,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Head {
    format_version: u32,
    min_reader_version: u32,
    id: String,
    revision: u64,
    commit: String,
    #[serde(flatten)]
    extra: Extensions,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredFrame {
    id: String,
    name: String,
    geometry: CanvasGeometry,
    content: String,
    #[serde(flatten)]
    extra: Extensions,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    format_version: u32,
    min_reader_version: u32,
    previous: Option<String>,
    frames: Vec<StoredFrame>,
    #[serde(default)]
    applied_edits: BTreeMap<String, String>,
    #[serde(flatten)]
    canvas: CanvasMetadata,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CanvasMetadata {
    id: String,
    project_path: String,
    #[serde(default)]
    project_key: String,
    name: String,
    revision: u64,
    created: String,
    modified: String,
    camera: Option<CanvasCamera>,
    tokens: BTreeMap<String, String>,
    assets: Vec<CanvasAsset>,
    change: CanvasChange,
    #[serde(flatten)]
    extra: Extensions,
}

impl Snapshot {
    fn summary(&self) -> CanvasSummary {
        CanvasSummary {
            id: self.canvas.id.clone(),
            project_path: self.canvas.project_path.clone(),
            project_key: self.canvas.project_key.clone(),
            name: self.canvas.name.clone(),
            revision: self.canvas.revision,
            modified: self.canvas.modified.clone(),
            frame_count: self.frames.len(),
            change: self.canvas.change.clone(),
        }
    }
}

pub(super) fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Immutable blobs are complete before the manifest makes them reachable.
pub(super) async fn atomic(path: PathBuf, bytes: Vec<u8>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        crate::store::write_private_atomic(&path, &bytes).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Refuse non-files and oversized data before any parser or image consumer reads it.
pub(super) async fn read_bytes(path: &Path, max: u64) -> Result<Vec<u8>, String> {
    let meta = fs::symlink_metadata(path)
        .await
        .map_err(|e| format!("{}: {e}", path.display()))?;
    if !meta.is_file() || meta.len() > max {
        return Err(format!(
            "{} is not a regular file of at most {max} bytes.",
            path.display()
        ));
    }
    crate::docs::read_file_capped(&path.to_string_lossy(), max).await
}

async fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    let bytes = read_bytes(path, MAX_JSON).await?;
    serde_json::from_slice(&bytes)
        .map_err(|e| format!("Invalid Canvas JSON at {}: {e}", path.display()))
}

/// A successful metadata write must remain within the limit used when reopening it.
pub(super) async fn json(path: PathBuf, value: &impl Serialize) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_JSON {
        return Err("Canvas metadata must be 8 MiB or smaller.".into());
    }
    atomic(path, bytes).await
}

/// Additive formats remain readable only while their declared minimum reader is supported.
fn compatible(version: u32, minimum: u32) -> Result<(), String> {
    if minimum == 0 || version == 0 || minimum > version {
        return Err("Invalid Canvas format version.".into());
    }
    if minimum > READER {
        return Err(format!("This canvas requires format reader {minimum}; this build supports {READER}. Update Carbon to open it. The original file has not been changed."));
    }
    Ok(())
}

impl Store {
    /// Shared config storage keeps designs independent of the server or worktree lifetime.
    pub async fn open() -> Result<Self, String> {
        let root = crate::store::config_dir()
            .await
            .map_err(|e| e.to_string())?
            .join("canvases");
        fs::create_dir_all(&root).await.map_err(|e| e.to_string())?;
        Ok(Self {
            root,
            shared_lock: true,
        })
    }

    #[cfg(test)]
    pub fn at(root: PathBuf) -> Self {
        Self {
            root,
            shared_lock: false,
        }
    }

    pub fn dir(&self, id: &str) -> Result<PathBuf, String> {
        uuid(id)?;
        Ok(self.root.join(id))
    }

    /// A missing process lock refuses the write instead of risking lost revisions.
    pub async fn lock(&self) -> Result<Guard, String> {
        let local = WRITES.lock().await;
        let process = if self.shared_lock {
            crate::store::lock_across_processes("canvas")
                .await
                .ok_or("Cannot lock Canvas storage.")?
        } else {
            let root = self.root.clone();
            tokio::task::spawn_blocking(move || {
                std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
                let file = std::fs::OpenOptions::new()
                    .create(true)
                    .truncate(false)
                    .write(true)
                    .open(root.join(".lock"))
                    .map_err(|e| e.to_string())?;
                if unsafe { libc::flock(std::os::fd::AsRawFd::as_raw_fd(&file), libc::LOCK_EX) }
                    != 0
                {
                    return Err("Cannot lock test Canvas storage.".to_string());
                }
                Ok(file)
            })
            .await
            .map_err(|e| e.to_string())??
        };
        Ok(Guard {
            _local: local,
            _process: process,
        })
    }

    /// A deletion tombstone remains authoritative even while directory cleanup is pending.
    pub(super) async fn head(&self, id: &str) -> Result<Head, String> {
        uuid(id)?;
        if fs::try_exists(self.root.join("deleted").join(format!("{id}.json")))
            .await
            .map_err(|e| e.to_string())?
        {
            return Err("This canvas was deleted.".into());
        }
        let head: Head = read_json(&self.dir(id)?.join("canvas.json")).await?;
        self.validate_head(&head, id)?;
        Ok(head)
    }

    /// Reject incompatible or mismatched pointers before trusting their snapshot reference.
    fn validate_head(&self, head: &Head, id: &str) -> Result<(), String> {
        compatible(head.format_version, head.min_reader_version)?;
        uuid(&head.commit)?;
        if head.id != id || head.revision == 0 {
            return Err("Canvas manifest identity or revision does not match.".into());
        }
        Ok(())
    }

    /// Commit identity and revision links must agree before trusting any stored references.
    async fn snapshot(&self, id: &str, commit: &str) -> Result<Snapshot, String> {
        uuid(commit)?;
        let mut snapshot: Snapshot =
            read_json(&self.dir(id)?.join("history").join(format!("{commit}.json"))).await?;
        compatible(snapshot.format_version, snapshot.min_reader_version)?;
        if snapshot.canvas.project_key.is_empty() {
            snapshot.canvas.project_key = project(&snapshot.canvas.project_path)
                .await
                .map(|identity| identity.key)
                .unwrap_or_else(|_| format!("path:{}", snapshot.canvas.project_path));
        }
        if snapshot.canvas.id != id
            || snapshot.canvas.change.id != commit
            || snapshot.canvas.revision == 0
        {
            return Err("Canvas snapshot identity does not match.".into());
        }
        if snapshot.canvas.change.after_revision != snapshot.canvas.revision
            || snapshot.canvas.change.before_revision >= snapshot.canvas.revision
        {
            return Err("Canvas snapshot revision does not match its change.".into());
        }
        Ok(snapshot)
    }

    /// Reconstruct only checksum-matching content and reject broken references before returning a design.
    async fn inflate(&self, snapshot: Snapshot) -> Result<Canvas, String> {
        let dir = self.dir(&snapshot.canvas.id)?;
        let mut frames = Vec::with_capacity(snapshot.frames.len());
        for frame in snapshot.frames {
            if !digest(&frame.content) {
                return Err("Invalid Canvas content reference.".into());
            }
            let bytes = read_bytes(
                &dir.join("content").join(format!("{}.json", frame.content)),
                MAX_JSON,
            )
            .await?;
            if hash(&bytes) != frame.content {
                return Err("Canvas content checksum does not match.".into());
            }
            let content = serde_json::from_slice(&bytes)
                .map_err(|e| format!("Invalid Canvas frame content: {e}"))?;
            frames.push(CanvasFrame {
                id: frame.id,
                name: frame.name,
                geometry: frame.geometry,
                content,
                extra: frame.extra,
            });
        }
        let meta = snapshot.canvas;
        let canvas = Canvas {
            id: meta.id,
            project_key: meta.project_key,
            project_path: meta.project_path,
            name: meta.name,
            revision: meta.revision,
            created: meta.created,
            modified: meta.modified,
            frames,
            camera: meta.camera,
            tokens: meta.tokens,
            assets: meta.assets,
            change: meta.change,
            extra: meta.extra,
        };
        validate(&canvas)?;
        for asset in &canvas.assets {
            let metadata = fs::symlink_metadata(dir.join("assets").join(&asset.hash))
                .await
                .map_err(|e| e.to_string())?;
            if !metadata.is_file() || metadata.len() != asset.size {
                return Err("Canvas asset is missing or has the wrong size.".into());
            }
        }
        Ok(canvas)
    }

    /// Freeze the manifest pointer before reading its immutable snapshot and content.
    pub async fn read(&self, id: &str) -> Result<Canvas, String> {
        let head = self.head(id).await?;
        let snapshot = self.snapshot(id, &head.commit).await?;
        if snapshot.canvas.revision != head.revision {
            return Err("Canvas manifest and snapshot revisions differ.".into());
        }
        let mut canvas = self.inflate(snapshot).await?;
        canvas.project_key = current_project_key(&canvas.project_path, &canvas.project_key).await;
        Ok(canvas)
    }

    async fn summary(&self, id: &str) -> Result<CanvasSummary, String> {
        let head = self.head(id).await?;
        let snapshot = self.snapshot(id, &head.commit).await?;
        if snapshot.canvas.revision != head.revision {
            return Err("Canvas manifest and snapshot revisions differ.".into());
        }
        let mut summary = snapshot.summary();
        summary.project_key =
            current_project_key(&summary.project_path, &summary.project_key).await;
        Ok(summary)
    }

    /// Image bytes must match their immutable reference before copy, recovery or delivery.
    pub(super) async fn asset_bytes(
        &self,
        id: &str,
        asset: &CanvasAsset,
    ) -> Result<Vec<u8>, String> {
        let bytes = read_bytes(
            &self.dir(id)?.join("assets").join(&asset.hash),
            MAX_ASSET as u64,
        )
        .await?;
        if bytes.len() as u64 != asset.size || hash(&bytes) != asset.hash {
            return Err(format!(
                "Canvas asset {} checksum does not match.",
                asset.id
            ));
        }
        Ok(bytes)
    }

    /// Shared-store observers need the committed deletion even after its directory is removed.
    pub async fn deleted(&self, id: &str) -> Result<Option<CanvasSummary>, String> {
        uuid(id)?;
        let path = self.root.join("deleted").join(format!("{id}.json"));
        if !fs::try_exists(&path).await.map_err(|e| e.to_string())? {
            return Ok(None);
        }
        let summary: CanvasSummary = read_json(&path).await?;
        if summary.id != id {
            return Err("Canvas deletion identity does not match.".into());
        }
        Ok(Some(summary))
    }

    /// Compare inode, length and timestamps so an idle canvas does not reparse every frame.
    pub async fn stamp(&self, id: &str) -> Result<String, String> {
        use std::os::unix::fs::MetadataExt;
        let dir = self.dir(id)?;
        let mut paths = vec![dir.join("canvas.json")];
        let mut versions = fs::read_dir(dir.join("edits"))
            .await
            .map_err(|e| e.to_string())?;
        while let Some(version) = versions.next_entry().await.map_err(|e| e.to_string())? {
            if !version
                .file_type()
                .await
                .map_err(|e| e.to_string())?
                .is_dir()
            {
                continue;
            }
            let mut entries = fs::read_dir(version.path())
                .await
                .map_err(|e| e.to_string())?;
            while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
                if entry.path().extension().is_some_and(|s| s == "json") {
                    paths.push(entry.path());
                }
            }
        }
        paths.sort();
        let mut stamp = String::new();
        for path in paths {
            let meta = fs::symlink_metadata(&path)
                .await
                .map_err(|e| e.to_string())?;
            stamp.push_str(&format!(
                "{}:{}:{}:{}:{};",
                path.display(),
                meta.ino(),
                meta.len(),
                meta.mtime(),
                meta.mtime_nsec()
            ));
        }
        Ok(hash(stamp.as_bytes()))
    }

    /// Metadata alone cannot classify a file with missing frame content as readable.
    pub async fn list(&self, project: Option<&str>) -> Result<CanvasList, String> {
        let mut list = CanvasList {
            files: Vec::new(),
            problems: Vec::new(),
        };
        let mut entries = match fs::read_dir(&self.root).await {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(list),
            Err(e) => return Err(e.to_string()),
        };
        while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
            let id = entry.file_name().to_string_lossy().into_owned();
            if uuid(&id).is_err() || !entry.file_type().await.map_err(|e| e.to_string())?.is_dir() {
                continue;
            }
            let checked: Result<Option<CanvasSummary>, String> = async {
                let summary = self.summary(&id).await?;
                if project.is_some_and(|p| p != summary.project_key) {
                    return Ok(None);
                }
                Ok(Some(CanvasSummary::from(&self.read(&id).await?)))
            }
            .await;
            match checked {
                Ok(Some(summary)) => list.files.push(summary),
                Ok(None) => {}
                Err(message) if message == "This canvas was deleted." => {}
                Err(message) => list.problems.push(CanvasProblem {
                    id,
                    path: entry.path().join("canvas.json").to_string_lossy().into(),
                    message,
                }),
            }
        }
        list.files
            .sort_by(|a, b| b.modified.cmp(&a.modified).then(a.id.cmp(&b.id)));
        Ok(list)
    }

    /// The caller holds both write locks; only the manifest rename publishes a revision.
    pub(super) async fn commit(
        &self,
        canvas: &Canvas,
        previous: Option<Head>,
        applied_edit: Option<(String, String)>,
    ) -> Result<(), String> {
        validate(canvas)?;
        let dir = self.dir(&canvas.id)?;
        for part in ["content", "assets", "history", "edits", "uploads"] {
            fs::create_dir_all(dir.join(part))
                .await
                .map_err(|e| e.to_string())?;
        }
        let mut applied_edits = match &previous {
            Some(head) => self.snapshot(&canvas.id, &head.commit).await?.applied_edits,
            None => BTreeMap::new(),
        };
        if let Some((path, digest)) = applied_edit {
            applied_edits.insert(path, digest);
        }
        let mut frames = Vec::new();
        for frame in &canvas.frames {
            let bytes = serde_json::to_vec(&frame.content).map_err(|e| e.to_string())?;
            let reference = hash(&bytes);
            let path = dir.join("content").join(format!("{reference}.json"));
            // Content is addressed by its bytes; never rewrite a blob held by history.
            match fs::try_exists(&path).await.map_err(|e| e.to_string())? {
                true => {
                    if read_bytes(&path, MAX_JSON).await? != bytes {
                        return Err("Stored Canvas content is damaged.".into());
                    }
                }
                false => atomic(path, bytes).await?,
            }
            frames.push(StoredFrame {
                id: frame.id.clone(),
                name: frame.name.clone(),
                geometry: frame.geometry.clone(),
                content: reference,
                extra: frame.extra.clone(),
            });
        }
        let snapshot = Snapshot {
            format_version: previous.as_ref().map_or(READER, |h| h.format_version),
            min_reader_version: previous.as_ref().map_or(READER, |h| h.min_reader_version),
            previous: previous.as_ref().map(|h| h.commit.clone()),
            frames,
            applied_edits,
            canvas: CanvasMetadata {
                id: canvas.id.clone(),
                project_path: canvas.project_path.clone(),
                project_key: canvas.project_key.clone(),
                name: canvas.name.clone(),
                revision: canvas.revision,
                created: canvas.created.clone(),
                modified: canvas.modified.clone(),
                camera: canvas.camera.clone(),
                tokens: canvas.tokens.clone(),
                assets: canvas.assets.clone(),
                change: canvas.change.clone(),
                extra: canvas.extra.clone(),
            },
        };
        let snapshot_path = dir
            .join("history")
            .join(format!("{}.json", canvas.change.id));
        json(snapshot_path, &snapshot).await?;
        let head = Head {
            format_version: snapshot.format_version,
            min_reader_version: snapshot.min_reader_version,
            id: canvas.id.clone(),
            revision: canvas.revision,
            commit: canvas.change.id.clone(),
            extra: previous.map_or_else(BTreeMap::new, |h| h.extra),
        };
        let counter_path = dir.join("revision.json");
        let highest = if fs::try_exists(&counter_path)
            .await
            .map_err(|e| e.to_string())?
        {
            read_json::<u64>(&counter_path).await?.max(canvas.revision)
        } else {
            canvas.revision
        };
        json(counter_path, &highest).await?;
        json(dir.join("canvas.json"), &head).await?;
        // A failed checkpoint cannot turn an already published revision into a failed save.
        if let Err(error) = json(dir.join("recovery.json"), &head).await {
            eprintln!("[canvas recovery checkpoint] {error}");
        }
        Ok(())
    }

    /// Failed initial writes stay outside the visible UUID namespace; the caller holds both locks.
    async fn publish_new(&self, canvas: &Canvas, source: Option<&str>) -> Result<(), String> {
        let pending = Self {
            root: self.root.join("pending"),
            shared_lock: self.shared_lock,
        };
        let staged = pending.dir(&canvas.id)?;
        let destination = self.dir(&canvas.id)?;
        if fs::try_exists(&destination)
            .await
            .map_err(|e| e.to_string())?
        {
            return Err("Canvas already exists.".into());
        }
        let result: Result<(), String> = async {
            validate(canvas)?;
            fs::create_dir_all(staged.join("assets"))
                .await
                .map_err(|e| e.to_string())?;
            if let Some(source) = source {
                for asset in &canvas.assets {
                    let bytes = self.asset_bytes(source, asset).await?;
                    atomic(staged.join("assets").join(&asset.hash), bytes).await?;
                }
            }
            pending.commit(canvas, None, None).await?;
            fs::rename(&staged, destination)
                .await
                .map_err(|e| e.to_string())
        }
        .await;
        if result.is_err() {
            if let Err(error) = fs::remove_dir_all(&staged).await {
                if error.kind() != std::io::ErrorKind::NotFound {
                    eprintln!("[canvas staging cleanup] {error}");
                }
            }
        }
        result
    }

    /// Publish the initial revision without requiring a session or Git repository.
    pub async fn create(&self, project_path: String, name: String) -> Result<Canvas, String> {
        let identity = project(&project_path).await?;
        let _guard = self.lock().await?;
        let now = crate::events::now_rfc3339();
        let canvas = Canvas {
            id: uuid::Uuid::now_v7().to_string(),
            project_path: identity.path,
            project_key: identity.key,
            name,
            revision: 1,
            created: now.clone(),
            modified: now,
            frames: Vec::new(),
            camera: None,
            tokens: BTreeMap::new(),
            assets: Vec::new(),
            change: change(0, CanvasAuthor::default(), None),
            extra: BTreeMap::new(),
        };
        self.publish_new(&canvas, None).await?;
        Ok(canvas)
    }

    /// Hold both locks across the revision check and commit so stale saves cannot win.
    pub async fn edit(
        &self,
        id: &str,
        revision: u64,
        edit: CanvasEdit,
        author: CanvasAuthor,
    ) -> Result<Canvas, String> {
        let _guard = self.lock().await?;
        let previous = self.head(id).await?;
        let mut canvas = self.read(id).await?;
        check_revision(&canvas, revision)?;
        let before = canvas.clone();
        if let Some(name) = edit.name {
            canvas.name = name;
        }
        if let Some(frames) = edit.frames {
            canvas.frames = frames;
        }
        if let Some(tokens) = edit.tokens {
            canvas.tokens = tokens;
        }
        if edit.clear_camera {
            canvas.camera = None;
        } else if let Some(camera) = edit.camera {
            canvas.camera = Some(camera);
        }
        advance(&mut canvas, author, None)?;
        super::undo::record(&before, &mut canvas)?;
        self.commit(&canvas, Some(previous), None).await?;
        Ok(canvas)
    }

    /// Follow committed ancestry only; orphan snapshots never become visible history.
    async fn snapshots(&self, id: &str, version: Option<u64>) -> Result<Vec<Snapshot>, String> {
        let head = self.head(id).await?;
        let mut next = Some(head.commit);
        let mut expected = head.revision;
        let mut history = Vec::new();
        if version.is_some_and(|v| v == 0 || v > expected) {
            return Err("No committed Canvas revision at this number.".into());
        }
        while let Some(commit) = next {
            let snapshot = self.snapshot(id, &commit).await?;
            if snapshot.canvas.revision != expected {
                return Err("Canvas history chain is damaged.".into());
            }
            next = snapshot.previous.clone();
            let before = snapshot.canvas.change.before_revision;
            if version.is_none_or(|v| v == expected) {
                history.push(snapshot);
            }
            if version.is_some_and(|v| v == expected) || (version.is_none() && history.len() == 100)
            {
                return Ok(history);
            }
            expected = before;
        }
        if version.is_some() {
            return Err("Canvas revision is missing from history.".into());
        }
        if expected != 0 {
            return Err("Canvas history chain is incomplete.".into());
        }
        Ok(history)
    }

    /// Expand only the requested committed versions instead of every intermediate frame tree.
    pub async fn history(&self, id: &str, version: Option<u64>) -> Result<Vec<Canvas>, String> {
        let mut versions = Vec::new();
        for snapshot in self.snapshots(id, version).await? {
            versions.push(self.inflate(snapshot).await?);
        }
        Ok(versions)
    }

    /// History lists metadata without allocating a complete design for every past revision.
    pub async fn summaries(&self, id: &str) -> Result<Vec<CanvasSummary>, String> {
        Ok(self
            .snapshots(id, None)
            .await?
            .iter()
            .map(Snapshot::summary)
            .collect())
    }

    /// Historical design state becomes a new revision while the current camera stays put.
    pub async fn restore(
        &self,
        id: &str,
        revision: u64,
        version: u64,
        author: CanvasAuthor,
    ) -> Result<Canvas, String> {
        let _guard = self.lock().await?;
        let previous = self.head(id).await?;
        let current = self.read(id).await?;
        check_revision(&current, revision)?;
        let mut restored = self.history(id, Some(version)).await?.remove(0);
        restored.camera = current.camera.clone();
        restored.project_key = current.project_key.clone();
        restored.revision = current.revision;
        advance(&mut restored, author, Some(version))?;
        super::undo::record(&current, &mut restored)?;
        self.commit(&restored, Some(previous), None).await?;
        Ok(restored)
    }

    /// Fresh layer identities and owned image copies keep deletion of the source harmless.
    pub async fn duplicate(&self, id: &str, revision: u64, name: String) -> Result<Canvas, String> {
        let _guard = self.lock().await?;
        let mut copy = self.read(id).await?;
        check_revision(&copy, revision)?;
        copy.id = uuid::Uuid::now_v7().to_string();
        copy.extra.remove("carbonUndo");
        copy.name = name;
        copy.revision = 1;
        copy.created = crate::events::now_rfc3339();
        copy.modified = copy.created.clone();
        copy.change = change(0, CanvasAuthor::default(), None);
        remap_frames(&mut copy.frames);
        validate(&copy)?;
        self.publish_new(&copy, Some(id)).await?;
        Ok(copy)
    }

    /// Share file-owned assets while assigning fresh identities and a position beyond existing frames.
    pub async fn duplicate_frame(
        &self,
        id: &str,
        revision: u64,
        frame_id: &str,
        author: CanvasAuthor,
    ) -> Result<Canvas, String> {
        let _guard = self.lock().await?;
        let head = self.head(id).await?;
        let mut canvas = self.read(id).await?;
        check_revision(&canvas, revision)?;
        let before = canvas.clone();
        let mut frame = canvas
            .frames
            .iter()
            .find(|f| f.id == frame_id)
            .ok_or("No frame with this ID.")?
            .clone();
        remap_frames(std::slice::from_mut(&mut frame));
        frame.name = format!("{} copy", frame.name.chars().take(235).collect::<String>());
        frame.geometry.x = canvas
            .frames
            .iter()
            .map(|f| f.geometry.x + f.geometry.width)
            .fold(f64::NEG_INFINITY, f64::max)
            + 80.0;
        canvas.frames.push(frame);
        advance(&mut canvas, author, None)?;
        super::undo::record(&before, &mut canvas)?;
        self.commit(&canvas, Some(head), None).await?;
        Ok(canvas)
    }

    /// The guarded commit publishes copies and their file-owned assets together.
    pub(super) async fn paste_layers(
        &self,
        id: &str,
        revision: u64,
        parent: &str,
        after: Option<&str>,
        source: CanvasLayerSource,
    ) -> Result<CanvasLayerPaste, String> {
        use super::nodes;

        if source.layers.is_empty() || source.layers.len() > 100_000 {
            return Err("Choose layers to paste.".into());
        }
        let _guard = self.lock().await?;
        let head = self.head(id).await?;
        let mut canvas = self.read(id).await?;
        check_revision(&canvas, revision)?;
        let before = canvas.clone();
        let original = self
            .history(&source.id, Some(source.revision))
            .await?
            .remove(0);
        let frame_id = nodes::frame_for(&canvas, parent)?.id.clone();
        let mut layers = Vec::new();
        let mut assets = BTreeSet::new();
        let mut seen = BTreeSet::new();
        let mut mapping = BTreeMap::new();
        for layer in source.layers.iter().filter(|layer| seen.insert(*layer)) {
            let frame = nodes::frame_for(&original, layer)?;
            let mut node = nodes::find(&frame.content.nodes, layer)
                .ok_or("Only layers can be pasted here.")?
                .clone();
            layer_asset_ids(&node, &mut assets);
            nodes::reidentify(&mut node, &mut mapping);
            layers.push(node);
        }
        let mut use_tokens = super::tokens::names(&layers);
        let mut checked_tokens = BTreeSet::new();
        while let Some(name) = use_tokens.pop() {
            if !checked_tokens.insert(name.clone()) {
                continue;
            }
            if let Some(value) = canvas
                .tokens
                .get(&name)
                .or_else(|| original.tokens.get(&name))
            {
                use_tokens.extend(super::tokens::used_names(value));
                assets.extend(asset_urls(value).map(str::to_owned));
                let value = value.clone();
                canvas.tokens.entry(name).or_insert(value);
            }
        }
        let node_ids = layers
            .iter()
            .map(|node| nodes::node_id(node).to_owned())
            .collect();
        let children = nodes::children(&mut canvas, parent)?;
        let index = match after {
            Some(anchor) => {
                children
                    .iter()
                    .position(|node| nodes::node_id(node) == anchor)
                    .ok_or("The paste target changed. Select a layer to try again.")?
                    + 1
            }
            None => children.len(),
        };
        children.splice(index..index, layers);
        let mut copies = Vec::new();
        for asset_id in assets {
            let asset = original.assets.iter().find(|asset| asset.id == asset_id);
            if let Some(existing) = canvas.assets.iter().find(|item| item.id == asset_id) {
                if asset.is_some_and(|asset| existing.hash != asset.hash) {
                    return Err("A copied asset conflicts with an existing Canvas asset.".into());
                }
            } else {
                let asset = asset.ok_or("A copied layer refers to a missing asset.")?;
                canvas.assets.push(asset.clone());
                copies.push(asset);
            }
            let frame = canvas
                .frames
                .iter_mut()
                .find(|frame| frame.id == frame_id)
                .unwrap();
            if !frame.content.asset_ids.contains(&asset_id) {
                frame.content.asset_ids.push(asset_id);
            }
        }
        advance(
            &mut canvas,
            CanvasAuthor {
                label: Some("Paste layers".into()),
                ..Default::default()
            },
            None,
        )?;
        super::undo::record(&before, &mut canvas)?;
        validate(&canvas)?;
        for asset in copies {
            let bytes = self.asset_bytes(&original.id, asset).await?;
            self.put_asset(id, &asset.hash, &bytes).await?;
        }
        self.commit(&canvas, Some(head), None).await?;
        Ok(CanvasLayerPaste {
            canvas,
            frame_id,
            node_ids,
        })
    }

    /// A tombstone removes visibility before deleting the file-owned content and assets.
    pub async fn delete(&self, id: &str, revision: u64) -> Result<CanvasSummary, String> {
        let _guard = self.lock().await?;
        let mut canvas = self.read(id).await?;
        check_revision(&canvas, revision)?;
        advance(&mut canvas, CanvasAuthor::default(), None)?;
        let tombstones = self.root.join("deleted");
        fs::create_dir_all(&tombstones)
            .await
            .map_err(|e| e.to_string())?;
        let summary = CanvasSummary::from(&canvas);
        json(tombstones.join(format!("{id}.json")), &summary).await?;
        let deleted = tombstones.join(id);
        if let Err(error) = fs::rename(self.dir(id)?, &deleted).await {
            eprintln!("[canvas cleanup] {error}");
        } else if let Err(error) = fs::remove_dir_all(deleted).await {
            eprintln!("[canvas cleanup] {error}");
        }
        Ok(summary)
    }

    /// The shared lock makes abandoned publication and committed deletion cleanup safe at startup.
    pub async fn cleanup_incomplete(&self) -> Result<(), String> {
        let _guard = self.lock().await?;
        match fs::remove_dir_all(self.root.join("pending")).await {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
        let mut entries = match fs::read_dir(self.root.join("deleted")).await {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(e.to_string()),
        };
        while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
            let path = entry.path();
            if path.extension().is_none_or(|s| s != "json") {
                continue;
            }
            let id = path.file_stem().unwrap_or_default().to_string_lossy();
            uuid(&id)?;
            let tombstone: CanvasSummary = read_json(&path).await?;
            if tombstone.id != id {
                return Err("Invalid Canvas deletion tombstone.".into());
            }
            for dir in [self.dir(&id)?, self.root.join("deleted").join(id.as_ref())] {
                match fs::remove_dir_all(dir).await {
                    Ok(()) => {}
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => return Err(e.to_string()),
                }
            }
        }
        Ok(())
    }

    /// Corrupt manifests stay byte-for-byte recoverable even if checkpoint validation fails.
    pub async fn recover(&self, id: &str) -> Result<Canvas, String> {
        let _guard = self.lock().await?;
        let dir = self.dir(id)?;
        if fs::try_exists(self.root.join("deleted").join(format!("{id}.json")))
            .await
            .map_err(|e| e.to_string())?
        {
            return Err("This canvas was deleted.".into());
        }
        let original = read_bytes(&dir.join("canvas.json"), MAX_JSON).await?;
        // A recognizable future format is never treated as corruption.
        if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&original) {
            if value
                .get("minReaderVersion")
                .and_then(|v| v.as_u64())
                .is_some_and(|v| v > READER as u64)
            {
                return Err(
                    "Update Carbon to recover this canvas. The original file has not been changed."
                        .into(),
                );
            }
        }
        if self.read(id).await.is_ok() {
            return Err("Canvas is readable; recovery is not needed.".into());
        }
        atomic(
            dir.join(format!("canvas.json.broken-{}", uuid::Uuid::now_v7())),
            original,
        )
        .await?;
        let checkpoint: Head = read_json(&dir.join("recovery.json")).await?;
        self.validate_head(&checkpoint, id)?;
        let snapshot = self.snapshot(id, &checkpoint.commit).await?;
        if snapshot.canvas.revision != checkpoint.revision {
            return Err("Canvas recovery checkpoint does not match its snapshot.".into());
        }
        let mut canvas = self.inflate(snapshot).await?;
        for asset in &canvas.assets {
            self.asset_bytes(id, asset).await?;
        }
        let restored = canvas.revision;
        let mut highest = restored.max(read_json::<u64>(&dir.join("revision.json")).await?);
        let mut entries = fs::read_dir(dir.join("history"))
            .await
            .map_err(|e| e.to_string())?;
        while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
            if entry.path().extension().is_none_or(|s| s != "json") {
                continue;
            }
            if let Ok(value) = read_json::<serde_json::Value>(&entry.path()).await {
                if let Some(revision) = value.get("revision").and_then(|v| v.as_u64()) {
                    highest = highest.max(revision);
                }
            }
        }
        advance(
            &mut canvas,
            CanvasAuthor {
                label: Some("Recover manifest".into()),
                ..Default::default()
            },
            Some(restored),
        )?;
        canvas.revision = highest
            .checked_add(1)
            .filter(|v| *v <= 9_007_199_254_740_991)
            .ok_or("Canvas revision limit reached.")?;
        canvas.change.after_revision = canvas.revision;
        self.commit(&canvas, Some(checkpoint), None).await?;
        Ok(canvas)
    }

    /// An edit inbox is revision-scoped, so creating a new one never rewrites an agent's file.
    pub async fn prepare_edit(
        &self,
        id: &str,
        revision: u64,
        frame_id: &str,
    ) -> Result<CanvasEditFile, String> {
        let _guard = self.lock().await?;
        let canvas = self.read(id).await?;
        check_revision(&canvas, revision)?;
        let frame = canvas
            .frames
            .iter()
            .find(|f| f.id == frame_id)
            .ok_or("No frame with this ID.")?;
        let dir = self.dir(id)?.join("edits").join(revision.to_string());
        fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
        let path = dir.join(format!("{frame_id}.json"));
        let edit = CanvasFrameEdit {
            revision,
            frame_id: frame_id.into(),
            content: frame.content.clone(),
            author: CanvasAuthor::default(),
        };
        if !fs::try_exists(&path).await.map_err(|e| e.to_string())? {
            json(path.clone(), &edit).await?;
        }
        Ok(CanvasEditFile {
            path: path.to_string_lossy().into(),
            edit: read_json(&path).await?,
        })
    }

    /// File reconciliation uses the same ordered write lane as manual saves and history.
    pub async fn reconcile(&self, id: &str) -> Result<(Canvas, Vec<CanvasProblem>), String> {
        let _guard = self.lock().await?;
        let mut canvas = self.read(id).await?;
        let dir = self.dir(id)?;
        let mut problems = Vec::new();
        let mut versions = fs::read_dir(dir.join("edits"))
            .await
            .map_err(|e| e.to_string())?;
        let mut paths = Vec::new();
        while let Some(version) = versions.next_entry().await.map_err(|e| e.to_string())? {
            if !version
                .file_type()
                .await
                .map_err(|e| e.to_string())?
                .is_dir()
            {
                continue;
            }
            let mut entries = fs::read_dir(version.path())
                .await
                .map_err(|e| e.to_string())?;
            while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
                if entry.path().extension().is_some_and(|s| s == "json") {
                    paths.push(entry.path());
                }
            }
        }
        paths.sort();
        for path in paths {
            let outcome = self.reconcile_file(&canvas, &path).await;
            match outcome {
                Ok(Some(next)) => canvas = next,
                Ok(None) => {}
                Err(message) => problems.push(CanvasProblem {
                    id: id.into(),
                    path: path.to_string_lossy().into(),
                    message,
                }),
            }
        }
        Ok((canvas, problems))
    }

    /// Persist an exact-byte receipt with the commit so restarts cannot replay an accepted edit.
    async fn reconcile_file(
        &self,
        current: &Canvas,
        path: &Path,
    ) -> Result<Option<Canvas>, String> {
        let bytes = read_bytes(path, MAX_JSON).await?;
        let digest = hash(&bytes);
        let key = path
            .strip_prefix(self.dir(&current.id)?)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .into_owned();
        let head = self.head(&current.id).await?;
        let snapshot = self.snapshot(&current.id, &head.commit).await?;
        if snapshot.applied_edits.get(&key) == Some(&digest) {
            return Ok(None);
        }
        let edit: CanvasFrameEdit = serde_json::from_slice(&bytes).map_err(|e| format!("Frame edit is incomplete or invalid JSON: {e}. The last valid frame is still saved."))?;
        uuid(&edit.frame_id)?;
        let expected = self
            .dir(&current.id)?
            .join("edits")
            .join(edit.revision.to_string())
            .join(format!("{}.json", edit.frame_id));
        if path != expected {
            return Err("Canvas edit identity does not match its path.".into());
        }
        let baseline = self
            .history(&current.id, Some(edit.revision))
            .await?
            .remove(0);
        let original = baseline
            .frames
            .iter()
            .find(|f| f.id == edit.frame_id)
            .ok_or("The edited frame does not exist in its base revision.")?;
        if original.content == edit.content {
            return Ok(None);
        }
        check_revision(current, edit.revision)?;
        let mut canvas = current.clone();
        let frame = canvas
            .frames
            .iter_mut()
            .find(|f| f.id == edit.frame_id)
            .ok_or("The edited frame no longer exists.")?;
        frame.content = edit.content;
        advance(&mut canvas, edit.author, None)?;
        super::undo::record(current, &mut canvas)?;
        self.commit(&canvas, Some(head), Some((key, digest)))
            .await?;
        Ok(Some(canvas))
    }

    /// The upload caller holds both locks until image metadata is published with the revision.
    pub(super) async fn asset_commit(&self, canvas: &Canvas) -> Result<(), String> {
        let head = self.head(&canvas.id).await?;
        self.commit(canvas, Some(head), None).await
    }
}

/// Revisions must stay monotonic and exactly representable by every JSON client.
pub(super) fn advance(
    canvas: &mut Canvas,
    author: CanvasAuthor,
    restored: Option<u64>,
) -> Result<(), String> {
    let before = canvas.revision;
    canvas.revision = before
        .checked_add(1)
        .filter(|v| *v <= 9_007_199_254_740_991)
        .ok_or("Canvas revision limit reached.")?;
    canvas.modified = crate::events::now_rfc3339();
    canvas.change = change(before, author, restored);
    Ok(())
}

fn change(before: u64, author: CanvasAuthor, restored_from: Option<u64>) -> CanvasChange {
    CanvasChange {
        id: uuid::Uuid::now_v7().to_string(),
        before_revision: before,
        after_revision: before + 1,
        author,
        restored_from,
    }
}

pub(super) struct ProjectIdentity {
    pub path: String,
    pub key: String,
}

/// A folder gaining Git metadata is still the same attached project; history bytes stay untouched.
async fn current_project_key(path: &str, saved: &str) -> String {
    if !saved.is_empty() && !saved.starts_with("path:") {
        return saved.to_string();
    }
    // Ordinary folder reads should not spawn Git unless repository metadata has appeared.
    let mut has_git = false;
    for ancestor in Path::new(path).ancestors() {
        if fs::try_exists(ancestor.join(".git")).await.unwrap_or(false) {
            has_git = true;
            break;
        }
    }
    if has_git {
        if let Ok(identity) = project(path).await {
            return identity.key;
        }
    }
    if saved.is_empty() {
        format!("path:{path}")
    } else {
        saved.to_string()
    }
}

/// Git metadata identifies a repository without replacing the reader's attached project path.
pub(super) async fn project(path: &str) -> Result<ProjectIdentity, String> {
    let path = fs::canonicalize(path)
        .await
        .map_err(|e| format!("Cannot open Canvas project: {e}"))?;
    if !path.is_dir() {
        return Err("Canvas project must be a directory.".into());
    }
    let mut top_command = tokio::process::Command::new("git");
    top_command
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(&path);
    let mut common_command = tokio::process::Command::new("git");
    common_command
        .args(["rev-parse", "--path-format=absolute", "--git-common-dir"])
        .current_dir(&path);
    let (top, common) = tokio::join!(top_command.output(), common_command.output());
    if let (Ok(top), Ok(common)) = (top, common) {
        if top.status.success() && common.status.success() {
            let top = fs::canonicalize(PathBuf::from(
                String::from_utf8_lossy(&top.stdout).trim_end_matches('\n'),
            ))
            .await
            .map_err(|e| e.to_string())?;
            let common = fs::canonicalize(PathBuf::from(
                String::from_utf8_lossy(&common.stdout).trim_end_matches('\n'),
            ))
            .await
            .map_err(|e| e.to_string())?;
            let relative = path.strip_prefix(top).map_err(|e| e.to_string())?;
            let identity = serde_json::to_vec(&(common, relative)).map_err(|e| e.to_string())?;
            return Ok(ProjectIdentity {
                path: path.to_string_lossy().into(),
                key: format!("git:{}", hash(&identity)),
            });
        }
    }
    Ok(ProjectIdentity {
        path: path.to_string_lossy().into(),
        key: format!("path:{}", path.display()),
    })
}

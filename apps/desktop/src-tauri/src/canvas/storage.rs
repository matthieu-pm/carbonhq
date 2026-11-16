use std::{
    collections::BTreeMap,
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
struct Head {
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

pub(super) async fn json(path: PathBuf, value: &impl Serialize) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_JSON {
        return Err("Canvas metadata must be 8 MiB or smaller.".into());
    }
    atomic(path, bytes).await
}

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

    async fn head(&self, id: &str) -> Result<Head, String> {
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

    fn validate_head(&self, head: &Head, id: &str) -> Result<(), String> {
        compatible(head.format_version, head.min_reader_version)?;
        uuid(&head.commit)?;
        if head.id != id || head.revision == 0 {
            return Err("Canvas manifest identity or revision does not match.".into());
        }
        Ok(())
    }

    async fn snapshot(&self, id: &str, commit: &str) -> Result<Snapshot, String> {
        uuid(commit)?;
        let snapshot: Snapshot =
            read_json(&self.dir(id)?.join("history").join(format!("{commit}.json"))).await?;
        compatible(snapshot.format_version, snapshot.min_reader_version)?;
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

    pub async fn read(&self, id: &str) -> Result<Canvas, String> {
        let head = self.head(id).await?;
        let snapshot = self.snapshot(id, &head.commit).await?;
        if snapshot.canvas.revision != head.revision {
            return Err("Canvas manifest and snapshot revisions differ.".into());
        }
        self.inflate(snapshot).await
    }

    async fn summary(&self, id: &str) -> Result<CanvasSummary, String> {
        let head = self.head(id).await?;
        let snapshot = self.snapshot(id, &head.commit).await?;
        if snapshot.canvas.revision != head.revision {
            return Err("Canvas manifest and snapshot revisions differ.".into());
        }
        Ok(snapshot.summary())
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
            match self.summary(&id).await {
                Ok(summary) if project.is_none_or(|p| p == summary.project_path) => {
                    list.files.push(summary)
                }
                Ok(_) => {}
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
    async fn commit(
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

    pub async fn create(&self, project_path: String, name: String) -> Result<Canvas, String> {
        let _guard = self.lock().await?;
        let now = crate::events::now_rfc3339();
        let canvas = Canvas {
            id: uuid::Uuid::now_v7().to_string(),
            project_path,
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
        self.commit(&canvas, None, None).await?;
        Ok(canvas)
    }

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
        self.commit(&canvas, Some(previous), None).await?;
        Ok(canvas)
    }

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
        restored.camera = current.camera;
        restored.revision = current.revision;
        advance(&mut restored, author, Some(version))?;
        self.commit(&restored, Some(previous), None).await?;
        Ok(restored)
    }

    pub async fn duplicate(&self, id: &str, revision: u64, name: String) -> Result<Canvas, String> {
        let _guard = self.lock().await?;
        let mut copy = self.read(id).await?;
        check_revision(&copy, revision)?;
        let source = self.dir(id)?;
        copy.id = uuid::Uuid::now_v7().to_string();
        copy.name = name;
        copy.revision = 1;
        copy.created = crate::events::now_rfc3339();
        copy.modified = copy.created.clone();
        copy.change = change(0, CanvasAuthor::default(), None);
        remap_frames(&mut copy.frames);
        validate(&copy)?;
        let dir = self.dir(&copy.id)?;
        fs::create_dir_all(dir.join("assets"))
            .await
            .map_err(|e| e.to_string())?;
        for asset in &copy.assets {
            let bytes =
                read_bytes(&source.join("assets").join(&asset.hash), MAX_ASSET as u64).await?;
            atomic(dir.join("assets").join(&asset.hash), bytes).await?;
        }
        self.commit(&copy, None, None).await?;
        Ok(copy)
    }

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
        self.commit(&canvas, Some(head), None).await?;
        Ok(canvas)
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
            eprintln!("[canvas deletion cleanup] {error}");
        } else if let Err(error) = fs::remove_dir_all(deleted).await {
            eprintln!("[canvas deletion cleanup] {error}");
        }
        Ok(summary)
    }

    /// Finishes file-owned asset cleanup if a process died after committing deletion.
    pub async fn cleanup_deleted(&self) -> Result<(), String> {
        let _guard = self.lock().await?;
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
        self.commit(&canvas, Some(head), Some((key, digest)))
            .await?;
        Ok(Some(canvas))
    }

    pub(super) async fn asset_commit(&self, canvas: &Canvas) -> Result<(), String> {
        let head = self.head(&canvas.id).await?;
        self.commit(canvas, Some(head), None).await
    }
}

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

/// Resolve linked worktrees to their shared repository, while ordinary folders need no Git.
pub(super) async fn project(path: &str) -> Result<String, String> {
    let path = fs::canonicalize(path)
        .await
        .map_err(|e| format!("Cannot open Canvas project: {e}"))?;
    if !path.is_dir() {
        return Err("Canvas project must be a directory.".into());
    }
    let output = tokio::process::Command::new("git")
        .args(["rev-parse", "--path-format=absolute", "--git-common-dir"])
        .current_dir(&path)
        .output()
        .await;
    if let Ok(output) = output {
        if output.status.success() {
            let common = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
            if common.file_name().is_some_and(|name| name == ".git") {
                if let Some(root) = common.parent() {
                    return Ok(root.to_string_lossy().into());
                }
            }
        }
    }
    Ok(path.to_string_lossy().into())
}

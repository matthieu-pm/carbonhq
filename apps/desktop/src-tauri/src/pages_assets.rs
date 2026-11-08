use std::{io::SeekFrom, path::Path};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt},
};

use super::{atomic, PageAsset, PageAssetWrite, PagesStore, WRITE_LOCK};

const CHUNK: usize = 256 * 1024;
const MAX_ASSET: u64 = 20 * 1024 * 1024;

#[cfg(test)]
#[path = "pages_assets_tests.rs"]
mod tests;

#[derive(Serialize, Deserialize)]
struct UploadState {
    name: String,
}

impl PagesStore {
    pub(super) async fn list_assets(&self, id: &str) -> Result<Vec<PageAsset>, String> {
        self.read(id).await?;
        let mut entries = match fs::read_dir(self.assets.join(id)).await {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
            Err(e) => return Err(e.to_string()),
        };
        let mut assets = Vec::new();
        while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let Some(asset_id) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            if valid_id(asset_id).is_err() {
                continue;
            }
            assets.push(self.read_asset(id, asset_id).await?);
        }
        assets.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id)));
        Ok(assets)
    }

    async fn read_asset(&self, id: &str, asset_id: &str) -> Result<PageAsset, String> {
        let manifest = self.assets.join(id).join(format!("{asset_id}.json"));
        let bytes = crate::docs::read_file_capped(&manifest.to_string_lossy(), 16 * 1024).await?;
        let mut asset: PageAsset = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        valid_name(&asset.name)?;
        let expected = self
            .assets
            .join(id)
            .join(format!("{asset_id}-{}", asset.name));
        if asset.id != asset_id
            || Path::new(&asset.path) != expected
            || asset.url != asset_url(id, asset_id)
        {
            return Err("Asset metadata does not match its identity.".into());
        }
        asset.mime_type = mime_type(&asset.name).into();
        let real = fs::canonicalize(&expected)
            .await
            .map_err(|e| e.to_string())?;
        let root = fs::canonicalize(self.assets.join(id))
            .await
            .map_err(|e| e.to_string())?;
        let meta = fs::metadata(&real).await.map_err(|e| e.to_string())?;
        if !real.starts_with(root)
            || !meta.is_file()
            || meta.len() != asset.size
            || asset.size > MAX_ASSET
        {
            return Err("Asset content does not match its metadata.".into());
        }
        Ok(asset)
    }

    pub(super) async fn write_asset(
        &self,
        id: &str,
        name: String,
        asset_id: &str,
        offset: u64,
        data: String,
        complete: bool,
    ) -> Result<PageAssetWrite, String> {
        valid_id(asset_id)?;
        valid_name(&name)?;
        if data.len() > ((CHUNK + 2) / 3) * 4 {
            return Err("Asset chunks must be 256 KiB or smaller.".into());
        }
        let bytes = STANDARD
            .decode(data)
            .map_err(|_| "Invalid base64 asset chunk.")?;
        if bytes.len() > CHUNK {
            return Err("Asset chunks must be 256 KiB or smaller.".into());
        }
        let end = offset
            .checked_add(bytes.len() as u64)
            .filter(|n| *n <= MAX_ASSET)
            .ok_or("Assets must be 20 MiB or smaller.")?;
        let _guard = WRITE_LOCK.lock().await;
        let _process = self.lock().await?;
        if self.read(id).await?.trashed {
            return Err("Restore the Page before attaching a file.".into());
        }
        let dir = self.assets.join(id);
        fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
        let manifest = dir.join(format!("{asset_id}.json"));
        let staging = dir.join(format!("{asset_id}.part"));
        let state_path = dir.join(format!("{asset_id}.upload.json"));
        let finished = dir.join(format!("{asset_id}-{name}"));

        if fs::try_exists(&manifest).await.map_err(|e| e.to_string())? {
            let asset = self.read_asset(id, asset_id).await?;
            if complete
                && asset.name == name
                && end == asset.size
                && range_matches(Path::new(&asset.path), offset, &bytes).await?
            {
                return Ok(PageAssetWrite {
                    written: asset.size,
                    asset: Some(asset),
                });
            }
            return Err("Asset already exists. Use a new asset ID for another file.".into());
        }

        let state = match fs::File::open(&state_path).await {
            Ok(file) => {
                let mut bytes = Vec::new();
                file.take(4097)
                    .read_to_end(&mut bytes)
                    .await
                    .map_err(|e| e.to_string())?;
                if bytes.len() > 4096 {
                    return Err("Asset upload metadata is too large.".into());
                }
                serde_json::from_slice::<UploadState>(&bytes).map_err(|e| e.to_string())?
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                if offset != 0 {
                    return Err("Asset upload offset conflict: expected 0.".into());
                }
                let state = UploadState { name: name.clone() };
                atomic(
                    state_path.clone(),
                    serde_json::to_vec(&state).map_err(|e| e.to_string())?,
                )
                .await?;
                state
            }
            Err(e) => return Err(e.to_string()),
        };
        if state.name != name {
            return Err("Asset upload name changed. Use a new asset ID.".into());
        }

        // A blob renamed before its manifest committed is invisible, but the same final request can finish it.
        if fs::try_exists(&finished).await.map_err(|e| e.to_string())? {
            let size = fs::metadata(&finished)
                .await
                .map_err(|e| e.to_string())?
                .len();
            if !complete || end != size || !range_matches(&finished, offset, &bytes).await? {
                return Err("Asset finalization is incomplete. Retry the same final chunk.".into());
            }
        } else {
            let mut file = fs::OpenOptions::new()
                .create(true)
                .truncate(false)
                .read(true)
                .write(true)
                .open(&staging)
                .await
                .map_err(|e| e.to_string())?;
            let current = file.metadata().await.map_err(|e| e.to_string())?.len();
            if offset > current {
                return Err(format!("Asset upload offset conflict: expected {current}."));
            }
            let overlap = (current - offset).min(bytes.len() as u64) as usize;
            if overlap > 0 && !range_matches(&staging, offset, &bytes[..overlap]).await? {
                return Err("Asset upload offset conflict: existing bytes differ.".into());
            }
            if end > current {
                file.seek(SeekFrom::End(0))
                    .await
                    .map_err(|e| e.to_string())?;
                file.write_all(&bytes[overlap..])
                    .await
                    .map_err(|e| e.to_string())?;
                file.sync_all().await.map_err(|e| e.to_string())?;
            }
            let written = current.max(end);
            if !complete {
                return Ok(PageAssetWrite {
                    written,
                    asset: None,
                });
            }
            if end != written {
                return Err("The final chunk must end at the uploaded length.".into());
            }
            file.sync_all().await.map_err(|e| e.to_string())?;
            drop(file);
            fs::rename(&staging, &finished)
                .await
                .map_err(|e| e.to_string())?;
        }
        let size = fs::metadata(&finished)
            .await
            .map_err(|e| e.to_string())?
            .len();
        let asset = PageAsset {
            id: asset_id.to_string(),
            name: name.clone(),
            path: finished.to_string_lossy().into_owned(),
            mime_type: mime_type(&name).into(),
            size,
            url: asset_url(id, asset_id),
        };
        // Listing the manifest is the commit point; no partial upload is ever listed as an attachment.
        atomic(
            manifest,
            serde_json::to_vec(&asset).map_err(|e| e.to_string())?,
        )
        .await?;
        let _ = fs::remove_file(state_path).await;
        Ok(PageAssetWrite {
            written: size,
            asset: Some(asset),
        })
    }
}

async fn range_matches(path: &Path, offset: u64, expected: &[u8]) -> Result<bool, String> {
    let mut file = fs::File::open(path).await.map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(offset))
        .await
        .map_err(|e| e.to_string())?;
    let mut actual = vec![0; expected.len()];
    match file.read_exact(&mut actual).await {
        Ok(_) => Ok(actual == expected),
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

fn valid_id(id: &str) -> Result<(), String> {
    let uuid = uuid::Uuid::parse_str(id).map_err(|_| "Invalid asset ID.")?;
    if uuid.to_string() != id {
        return Err("Invalid asset ID.".into());
    }
    Ok(())
}

fn valid_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.len() > 200
        || matches!(name, "." | "..")
        || name.contains(['/', '\\'])
        || name.chars().any(char::is_control)
    {
        return Err(
            "Use a file name of 1–200 bytes without path separators or control characters.".into(),
        );
    }
    Ok(())
}

fn asset_url(page: &str, asset: &str) -> String {
    format!("carbon-asset://{page}/{asset}")
}

fn mime_type(name: &str) -> &'static str {
    match Path::new(name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "pdf" => "application/pdf",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "aac" => "audio/aac",
        "opus" => "audio/opus",
        "html" | "htm" => "text/html",
        "txt" | "md" | "markdown" => "text/plain",
        "csv" => "text/csv",
        "json" => "application/json",
        _ => "application/octet-stream",
    }
}

use base64::Engine;
use serde::{Deserialize, Serialize};
use tokio::fs;
use ts_rs::TS;

use super::{
    model::*,
    storage::{advance, atomic, hash, read_bytes, Store},
};

const CHUNK: usize = 256 * 1024;

#[derive(Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CanvasAssetUpload {
    pub asset_id: String,
    pub name: String,
    pub offset: u64,
    pub data: String,
    pub complete: bool,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CanvasAssetProgress {
    pub written: u64,
    pub canvas: Option<Canvas>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CanvasAssetData {
    pub asset: CanvasAsset,
    pub data: String,
}

impl Store {
    /// Chunks are invisible until a revision publishes the finished, immutable image.
    pub async fn upload(
        &self,
        id: &str,
        revision: u64,
        upload: CanvasAssetUpload,
        author: CanvasAuthor,
    ) -> Result<CanvasAssetProgress, String> {
        uuid(&upload.asset_id)?;
        name(&upload.name)?;
        if upload.data.len() > CHUNK.div_ceil(3) * 4 {
            return Err("Canvas upload chunks must be 256 KiB or smaller.".into());
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(upload.data)
            .map_err(|_| "Invalid Canvas asset base64.")?;
        let _guard = self.lock().await?;
        let mut canvas = self.read(id).await?;
        check_revision(&canvas, revision)?;
        if canvas.assets.iter().any(|a| a.id == upload.asset_id) {
            return Err("Canvas asset IDs are immutable. Upload a new image with a new ID.".into());
        }
        let path = self.dir(id)?.join("uploads").join(&upload.asset_id);
        let mut pending = match fs::try_exists(&path).await.map_err(|e| e.to_string())? {
            true => read_bytes(&path, MAX_ASSET as u64).await?,
            false => Vec::new(),
        };
        let offset = usize::try_from(upload.offset).map_err(|_| "Invalid Canvas upload offset.")?;
        let end = offset
            .checked_add(bytes.len())
            .filter(|v| *v <= MAX_ASSET)
            .ok_or("Canvas images must be 20 MiB or smaller.")?;
        if offset == pending.len() {
            pending.extend_from_slice(&bytes);
        } else if end > pending.len() || pending.get(offset..end) != Some(bytes.as_slice()) {
            return Err(format!(
                "Canvas upload offset conflict: {} bytes are already saved.",
                pending.len()
            ));
        }
        if !upload.complete {
            atomic(path, pending.clone()).await?;
            return Ok(CanvasAssetProgress {
                written: pending.len() as u64,
                canvas: None,
            });
        }
        if end != pending.len() {
            return Err("The final Canvas upload chunk must end at the uploaded length.".into());
        }
        let mime = image_type(&pending)
            .ok_or("Canvas assets must be PNG, JPEG, GIF, WebP or AVIF images.")?;
        let digest = hash(&pending);
        let asset = CanvasAsset {
            id: upload.asset_id,
            name: upload.name,
            mime_type: mime.into(),
            size: pending.len() as u64,
            hash: digest.clone(),
            extra: Default::default(),
        };
        let destination = self.dir(id)?.join("assets").join(digest);
        if fs::try_exists(&destination)
            .await
            .map_err(|e| e.to_string())?
        {
            if read_bytes(&destination, MAX_ASSET as u64).await? != pending {
                return Err("Stored Canvas asset is damaged.".into());
            }
        } else {
            atomic(destination, pending.clone()).await?;
        }
        canvas.assets.push(asset);
        advance(&mut canvas, author, None)?;
        self.asset_commit(&canvas).await?;
        let _ = fs::remove_file(path).await;
        Ok(CanvasAssetProgress {
            written: pending.len() as u64,
            canvas: Some(canvas),
        })
    }

    pub async fn read_asset(
        &self,
        id: &str,
        asset_id: &str,
        version: Option<u64>,
    ) -> Result<CanvasAssetData, String> {
        uuid(asset_id)?;
        let canvas = match version {
            Some(v) => self.history(id, Some(v)).await?.remove(0),
            None => self.read(id).await?,
        };
        let asset = canvas
            .assets
            .into_iter()
            .find(|a| a.id == asset_id)
            .ok_or("No Canvas asset with this ID at this revision.")?;
        let bytes = read_bytes(
            &self.dir(id)?.join("assets").join(&asset.hash),
            MAX_ASSET as u64,
        )
        .await?;
        if hash(&bytes) != asset.hash {
            return Err("Canvas asset checksum does not match.".into());
        }
        Ok(CanvasAssetData {
            asset,
            data: base64::engine::general_purpose::STANDARD.encode(bytes),
        })
    }
}

fn image_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else if bytes.get(4..8) == Some(b"ftyp")
        && matches!(bytes.get(8..12), Some(b"avif" | b"avis"))
    {
        Some("image/avif")
    } else {
        None
    }
}

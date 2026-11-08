use super::*;

fn store() -> PagesStore {
    let home = std::env::temp_dir().join(format!("carbon-assets-test-{}", uuid::Uuid::new_v4()));
    PagesStore {
        root: home.join("pages"),
        assets: home.join("attachments/pages"),
    }
}

#[tokio::test]
async fn audio_and_html_uploads_keep_their_preview_metadata() {
    let store = store();
    let page = store
        .create("Media".into(), "".into(), vec![])
        .await
        .unwrap();
    let types = [
        ("audio.wav", "audio/wav"),
        ("audio.mp3", "audio/mpeg"),
        ("audio.m4a", "audio/mp4"),
        ("audio.ogg", "audio/ogg"),
        ("audio.flac", "audio/flac"),
        ("audio.aac", "audio/aac"),
        ("audio.opus", "audio/opus"),
        ("preview.html", "text/html"),
        ("preview.htm", "text/html"),
    ];
    for (name, expected) in types {
        let asset = store
            .write_asset(
                &page.id,
                name.into(),
                &uuid::Uuid::new_v4().to_string(),
                0,
                STANDARD.encode(b"preview bytes"),
                true,
            )
            .await
            .unwrap()
            .asset
            .unwrap();
        assert_eq!(asset.mime_type, expected);
        if name == "audio.wav" {
            let manifest = store
                .assets
                .join(&page.id)
                .join(format!("{}.json", asset.id));
            let mut old = serde_json::to_value(&asset).unwrap();
            old["mimeType"] = "application/octet-stream".into();
            atomic(manifest, serde_json::to_vec(&old).unwrap())
                .await
                .unwrap();
            let listed = store.list_assets(&page.id).await.unwrap();
            assert_eq!(
                listed
                    .iter()
                    .find(|entry| entry.id == asset.id)
                    .unwrap()
                    .mime_type,
                "audio/wav"
            );
        }
    }
    assert_eq!(
        store.list_assets(&page.id).await.unwrap().len(),
        types.len()
    );
    fs::remove_dir_all(store.root.parent().unwrap())
        .await
        .unwrap();
}

#[tokio::test]
async fn uploads_larger_than_one_wire_frame_are_complete_durable_and_retryable() {
    let store = store();
    let page = store
        .create("Assets".into(), "unchanged".into(), vec![])
        .await
        .unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let bytes: Vec<u8> = (0..1024 * 1024 + 63).map(|i| (i % 251) as u8).collect();
    let mut offset = 0;
    let mut final_chunk = None;
    for chunk in bytes.chunks(CHUNK) {
        let end = offset + chunk.len() as u64;
        let complete = end == bytes.len() as u64;
        let encoded = STANDARD.encode(chunk);
        let envelope = carbon_proto::Envelope::new(carbon_proto::Request::Pages(
            carbon_proto::PageRequest::WriteAsset {
                id: page.id.clone(),
                name: "Screenshot.png".into(),
                asset_id: id.clone(),
                offset,
                data: encoded.clone(),
                complete,
            },
        ));
        assert!(
            (carbon_proto::encode_line(&envelope).unwrap().len() as u64) < carbon_proto::MAX_LINE
        );
        let result = store
            .write_asset(
                &page.id,
                "Screenshot.png".into(),
                &id,
                offset,
                encoded.clone(),
                complete,
            )
            .await
            .unwrap();
        assert_eq!(result.written, end);
        if !complete {
            assert!(store.list_assets(&page.id).await.unwrap().is_empty());
        } else {
            final_chunk = Some((offset, encoded, result.asset.unwrap()));
        }
        offset = end;
    }
    let (offset, data, asset) = final_chunk.unwrap();
    assert_eq!(asset.size, bytes.len() as u64);
    assert_eq!(asset.url, format!("carbon-asset://{}/{id}", page.id));
    assert_eq!(asset.mime_type, "image/png");
    assert_eq!(fs::read(&asset.path).await.unwrap(), bytes);
    let retry = store
        .write_asset(&page.id, "Screenshot.png".into(), &id, offset, data, true)
        .await
        .unwrap();
    assert_eq!(retry.asset.unwrap().id, id);
    assert_eq!(store.list_assets(&page.id).await.unwrap().len(), 1);
    assert_eq!(store.read(&page.id).await.unwrap().revision, 1);
    assert_eq!(store.read(&page.id).await.unwrap().markdown, "unchanged");
    fs::remove_dir_all(store.root.parent().unwrap())
        .await
        .unwrap();
}

#[tokio::test]
async fn upload_offsets_ids_names_and_limits_cannot_replace_another_asset() {
    let store = store();
    let page = store
        .create("Assets".into(), "".into(), vec![])
        .await
        .unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let data = STANDARD.encode(b"abc");
    assert!(store
        .write_asset(&page.id, "../escape".into(), &id, 0, data.clone(), true)
        .await
        .is_err());
    assert!(store
        .write_asset(&page.id, "a.txt".into(), "../escape", 0, data.clone(), true)
        .await
        .is_err());
    assert!(store
        .write_asset(&page.id, "a.txt".into(), &id, 1, data.clone(), false)
        .await
        .unwrap_err()
        .contains("offset"));
    store
        .write_asset(&page.id, "a.txt".into(), &id, 0, data.clone(), false)
        .await
        .unwrap();
    assert_eq!(
        store
            .write_asset(&page.id, "a.txt".into(), &id, 0, data.clone(), false)
            .await
            .unwrap()
            .written,
        3
    );
    assert!(store
        .write_asset(
            &page.id,
            "a.txt".into(),
            &id,
            0,
            STANDARD.encode(b"axc"),
            false
        )
        .await
        .is_err());
    assert!(store
        .write_asset(&page.id, "renamed.txt".into(), &id, 3, "".into(), true)
        .await
        .is_err());
    assert!(store
        .write_asset(&page.id, "a.txt".into(), &id, u64::MAX, data.clone(), false)
        .await
        .is_err());
    assert!(store
        .write_asset(
            &page.id,
            "a.txt".into(),
            &id,
            MAX_ASSET,
            data.clone(),
            false
        )
        .await
        .is_err());
    assert!(store
        .write_asset(
            &page.id,
            "a.txt".into(),
            &id,
            0,
            STANDARD.encode(vec![0; CHUNK + 1]),
            false
        )
        .await
        .is_err());
    let result = store
        .write_asset(&page.id, "a.txt".into(), &id, 0, data.clone(), true)
        .await
        .unwrap();
    assert!(store
        .write_asset(
            &page.id,
            "a.txt".into(),
            &id,
            0,
            STANDARD.encode(b"xyz"),
            true
        )
        .await
        .is_err());
    assert_eq!(fs::read(result.asset.unwrap().path).await.unwrap(), b"abc");
    assert_eq!(store.list_assets(&page.id).await.unwrap().len(), 1);
    fs::remove_dir_all(store.root.parent().unwrap())
        .await
        .unwrap();
}

#[tokio::test]
async fn a_renamed_blob_without_its_manifest_remains_hidden_and_can_finish() {
    let store = store();
    let page = store
        .create("Assets".into(), "".into(), vec![])
        .await
        .unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let data = STANDARD.encode(b"abc");
    store
        .write_asset(&page.id, "a.txt".into(), &id, 0, data.clone(), false)
        .await
        .unwrap();
    let dir = store.assets.join(&page.id);
    fs::rename(
        dir.join(format!("{id}.part")),
        dir.join(format!("{id}-a.txt")),
    )
    .await
    .unwrap();
    assert!(store.list_assets(&page.id).await.unwrap().is_empty());
    let asset = store
        .write_asset(&page.id, "a.txt".into(), &id, 0, data, true)
        .await
        .unwrap()
        .asset
        .unwrap();
    assert_eq!(asset.size, 3);
    assert_eq!(store.list_assets(&page.id).await.unwrap()[0].id, id);
    fs::remove_dir_all(store.root.parent().unwrap())
        .await
        .unwrap();
}

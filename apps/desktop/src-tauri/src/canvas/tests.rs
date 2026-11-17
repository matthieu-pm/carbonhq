use std::{collections::BTreeMap, path::PathBuf};

use base64::Engine;
use serde_json::{json, Value};
use tokio::fs;

use super::{
    assets::CanvasAssetUpload,
    model::*,
    storage::{atomic, json as save_json, project, Store},
};

struct Fixture {
    store: Store,
}

impl Fixture {
    fn new() -> Self {
        Self {
            store: Store::at(std::env::temp_dir().join(format!("carbon-canvas-test-{}", id()))),
        }
    }
    async fn canvas(&self) -> Canvas {
        let project = self.store.root.join("project-without-git");
        fs::create_dir_all(&project).await.unwrap();
        self.store
            .create(project.to_string_lossy().into(), "Explorations".into())
            .await
            .unwrap()
    }
    async fn populated(&self) -> Canvas {
        let canvas = self.canvas().await;
        self.store
            .edit(
                &canvas.id,
                1,
                CanvasEdit {
                    frames: Some(vec![frame()]),
                    ..Default::default()
                },
                Default::default(),
            )
            .await
            .unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.store.root);
    }
}

fn id() -> String {
    uuid::Uuid::now_v7().to_string()
}

fn frame() -> CanvasFrame {
    serde_json::from_value(json!({
        "id": id(), "name": "Checkout", "geometry": {"x": 10, "y": 20, "width": 390, "height": 844},
        "content": {"nodes": [{"kind": "element", "id": id(), "name": "Button", "tag": "button",
            "attributes": {"aria-label": "Pay"}, "styles": {"background": "var(--brand)"},
            "children": [{"kind": "text", "id": id(), "name": "Label", "text": "Pay"}]}], "css": ":root { --brand: yellow; }", "assetIds": []}
    })).unwrap()
}

#[tokio::test]
async fn turn_undo_preserves_later_styles_layout_and_camera_and_redoes_only_restored_fields() {
    let fixture = Fixture::new();
    let original = fixture.populated().await;
    let turn = id();
    let author = CanvasAuthor {
        session_id: Some(id()),
        turn_id: Some(turn.clone()),
        label: Some("Agent turn".into()),
    };
    let mut first = original.frames.clone();
    if let CanvasNode::Element { styles, .. } = &mut first[0].content.nodes[0] {
        styles.insert("color".into(), "red".into());
        styles.insert("padding".into(), "24px".into());
    }
    let first = fixture
        .store
        .edit(
            &original.id,
            original.revision,
            CanvasEdit {
                frames: Some(first),
                ..Default::default()
            },
            author.clone(),
        )
        .await
        .unwrap();
    let mut second = first.frames.clone();
    if let CanvasNode::Element { children, .. } = &mut second[0].content.nodes[0] {
        if let CanvasNode::Text { text, .. } = &mut children[0] {
            *text = "Continue".into();
        }
    }
    let second = fixture
        .store
        .edit(
            &original.id,
            first.revision,
            CanvasEdit {
                frames: Some(second),
                ..Default::default()
            },
            author,
        )
        .await
        .unwrap();
    let mut manual = second.frames.clone();
    manual[0].geometry.x = 700.0;
    if let CanvasNode::Element { styles, .. } = &mut manual[0].content.nodes[0] {
        styles.insert("color".into(), "blue".into());
        styles.insert("border-radius".into(), "12px".into());
    }
    let manual = fixture
        .store
        .edit(
            &original.id,
            second.revision,
            CanvasEdit {
                frames: Some(manual),
                camera: Some(CanvasCamera {
                    x: 100.0,
                    y: 80.0,
                    zoom: 0.5,
                    extra: Default::default(),
                }),
                ..Default::default()
            },
            Default::default(),
        )
        .await
        .unwrap();
    let (undone, conflicts) = fixture
        .store
        .undo(&original.id, manual.revision, Some(&turn), false)
        .await
        .unwrap();
    assert_eq!(conflicts.len(), 1);
    assert!(conflicts[0].ends_with("/styles/color"));
    assert_eq!(undone.frames[0].geometry.x, 700.0);
    assert_eq!(undone.camera, manual.camera);
    if let CanvasNode::Element {
        styles, children, ..
    } = &undone.frames[0].content.nodes[0]
    {
        assert_eq!(styles["color"], "blue");
        assert_eq!(styles["border-radius"], "12px");
        assert!(!styles.contains_key("padding"));
        assert!(matches!(&children[0], CanvasNode::Text { text, .. } if text == "Pay"));
    } else {
        panic!("missing element");
    }
    let (redone, conflicts) = fixture
        .store
        .undo(&original.id, undone.revision, None, true)
        .await
        .unwrap();
    assert!(conflicts.is_empty());
    assert_eq!(redone.frames[0].geometry.x, 700.0);
    if let CanvasNode::Element {
        styles, children, ..
    } = &redone.frames[0].content.nodes[0]
    {
        assert_eq!(styles["color"], "blue");
        assert_eq!(styles["padding"], "24px");
        assert!(matches!(&children[0], CanvasNode::Text { text, .. } if text == "Continue"));
    }
    assert!(fixture
        .store
        .undo(&original.id, manual.revision, None, false)
        .await
        .unwrap_err()
        .contains("conflict"));
}

#[tokio::test]
async fn undo_added_frame_keeps_later_manual_content_and_survives_reopening() {
    let fixture = Fixture::new();
    let original = fixture.canvas().await;
    let turn = id();
    let agent = fixture
        .store
        .edit(
            &original.id,
            original.revision,
            CanvasEdit {
                frames: Some(vec![frame()]),
                ..Default::default()
            },
            CanvasAuthor {
                session_id: Some(id()),
                turn_id: Some(turn.clone()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let mut later = agent.frames.clone();
    later[0].name = "Reader's edit".into();
    let manual = fixture
        .store
        .edit(
            &agent.id,
            agent.revision,
            CanvasEdit {
                frames: Some(later),
                ..Default::default()
            },
            Default::default(),
        )
        .await
        .unwrap();
    let reopened = Store::at(fixture.store.root.clone());
    let (undone, conflicts) = reopened
        .undo(&agent.id, manual.revision, Some(&turn), false)
        .await
        .unwrap();
    assert!(!conflicts.is_empty());
    assert_eq!(undone.frames, manual.frames);
    let current = reopened.read(&agent.id).await.unwrap();
    assert_eq!(current.revision, undone.revision);
    assert!(super::undo::state(&current).unwrap().can_redo);
}

#[tokio::test]
async fn undo_preserves_unknown_frame_and_node_extension_fields() {
    let fixture = Fixture::new();
    let original = fixture.populated().await;
    let mut frames = original.frames.clone();
    frames[0]
        .extra
        .insert("layers".into(), json!({"future":true}));
    frames[0].extra.insert("order".into(), json!(["future"]));
    if let CanvasNode::Element {
        extra, children, ..
    } = &mut frames[0].content.nodes[0]
    {
        extra.insert("parent".into(), json!("future"));
        if let CanvasNode::Text { extra, .. } = &mut children[0] {
            extra.insert("children".into(), json!({"future":true}));
        }
    }
    let baseline = fixture
        .store
        .edit(
            &original.id,
            original.revision,
            CanvasEdit {
                frames: Some(frames),
                ..Default::default()
            },
            Default::default(),
        )
        .await
        .unwrap();
    let mut changed = baseline.frames.clone();
    changed[0].name = "Renamed".into();
    let changed = fixture
        .store
        .edit(
            &baseline.id,
            baseline.revision,
            CanvasEdit {
                frames: Some(changed),
                ..Default::default()
            },
            Default::default(),
        )
        .await
        .unwrap();
    let (undone, conflicts) = fixture
        .store
        .undo(&baseline.id, changed.revision, None, false)
        .await
        .unwrap();
    assert!(conflicts.is_empty());
    assert_eq!(undone.frames, baseline.frames);
}

#[test]
fn node_commands_preserve_identity_and_reject_cycles_without_touching_storage() {
    use carbon_proto::CanvasAction;
    let mut canvas: Canvas = serde_json::from_value(json!({
        "id":id(),"projectPath":"/tmp","name":"Design","revision":1,"created":"now","modified":"now","frames":[frame()],"camera":null,"tokens":{},"assets":[],
        "change":{"id":id(),"beforeRevision":0,"afterRevision":1,"author":{},"restoredFrom":null}
    })).unwrap();
    let frame = canvas.frames[0].id.clone();
    let element = super::nodes::node_id(&canvas.frames[0].content.nodes[0]).to_string();
    let duplicate = super::nodes::mutate(
        &mut canvas,
        &CanvasAction::Duplicate {
            node: frame.clone(),
        },
        None,
    )
    .unwrap();
    assert_eq!(canvas.frames.len(), 2);
    assert!(
        canvas.frames[1].geometry.x
            >= canvas.frames[0].geometry.x + canvas.frames[0].geometry.width + 80.0
    );
    assert_ne!(
        super::nodes::node_id(&canvas.frames[1].content.nodes[0]),
        element
    );
    assert_eq!(duplicate["idMap"].as_object().unwrap().len(), 3);
    assert!(super::nodes::mutate(
        &mut canvas,
        &CanvasAction::Move {
            node: element.clone(),
            parent: element.clone(),
            index: None
        },
        None
    )
    .unwrap_err()
    .contains("descendant"));
    super::nodes::mutate(
        &mut canvas,
        &CanvasAction::SetText {
            node: element.clone(),
            text: "Done".into(),
        },
        None,
    )
    .unwrap();
    assert_eq!(
        super::nodes::node_id(&canvas.frames[0].content.nodes[0]),
        element
    );
}

async fn edit_content(fixture: &Fixture, canvas: &Canvas, text: &str) -> PathBuf {
    let file = fixture
        .store
        .prepare_edit(&canvas.id, canvas.revision, &canvas.frames[0].id)
        .await
        .unwrap();
    let mut edit = file.edit;
    edit.content.css = text.into();
    save_json(PathBuf::from(&file.path), &edit).await.unwrap();
    file.path.into()
}

#[tokio::test]
async fn reopen_preserves_identity_nodes_css_geometry_and_history_without_git() {
    let fixture = Fixture::new();
    let original = fixture.populated().await;
    let reopened = Store::at(fixture.store.root.clone())
        .read(&original.id)
        .await
        .unwrap();
    assert_eq!(original.frames, reopened.frames);
    assert_eq!(reopened.revision, 2);
    assert_eq!(reopened.change.before_revision, 1);
    assert_eq!(
        fixture
            .store
            .history(&original.id, None)
            .await
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        fixture
            .store
            .list(Some(&original.project_key))
            .await
            .unwrap()
            .files
            .len(),
        1
    );
    assert!(fixture
        .store
        .list(Some("/another-project"))
        .await
        .unwrap()
        .files
        .is_empty());
}

#[tokio::test]
async fn simultaneous_stores_cannot_both_publish_from_the_same_revision() {
    let fixture = Fixture::new();
    let canvas = fixture.canvas().await;
    let other = Store::at(fixture.store.root.clone());
    let (a, b) = tokio::join!(
        fixture.store.edit(
            &canvas.id,
            1,
            CanvasEdit {
                name: Some("A".into()),
                ..Default::default()
            },
            Default::default()
        ),
        other.edit(
            &canvas.id,
            1,
            CanvasEdit {
                name: Some("B".into()),
                ..Default::default()
            },
            Default::default()
        )
    );
    assert_eq!(a.is_ok() as u8 + b.is_ok() as u8, 1);
    assert!(a.err().or(b.err()).unwrap().contains("conflict"));
    let history = fixture.store.history(&canvas.id, None).await.unwrap();
    assert_eq!(history.len(), 2);
    assert_eq!(history[1].name, "Explorations");
}

#[tokio::test]
async fn invalid_layer_ids_assets_and_geometry_never_publish() {
    let fixture = Fixture::new();
    let canvas = fixture.populated().await;
    let before = fs::read(fixture.store.dir(&canvas.id).unwrap().join("canvas.json"))
        .await
        .unwrap();
    let mut frames = canvas.frames.clone();
    frames.push(frames[0].clone());
    assert!(fixture
        .store
        .edit(
            &canvas.id,
            2,
            CanvasEdit {
                frames: Some(frames),
                ..Default::default()
            },
            Default::default()
        )
        .await
        .unwrap_err()
        .contains("Repeated"));
    let mut frames = canvas.frames.clone();
    frames[0].content.asset_ids.push(id());
    assert!(fixture
        .store
        .edit(
            &canvas.id,
            2,
            CanvasEdit {
                frames: Some(frames),
                ..Default::default()
            },
            Default::default()
        )
        .await
        .unwrap_err()
        .contains("missing asset"));
    let mut frames = canvas.frames.clone();
    frames[0].geometry.width = -1.0;
    assert!(fixture
        .store
        .edit(
            &canvas.id,
            2,
            CanvasEdit {
                frames: Some(frames),
                ..Default::default()
            },
            Default::default()
        )
        .await
        .is_err());
    assert_eq!(
        before,
        fs::read(fixture.store.dir(&canvas.id).unwrap().join("canvas.json"))
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn partial_edit_keeps_saved_frame_and_valid_retry_commits_once() {
    let fixture = Fixture::new();
    let canvas = fixture.populated().await;
    let file = fixture
        .store
        .prepare_edit(&canvas.id, 2, &canvas.frames[0].id)
        .await
        .unwrap();
    atomic(file.path.clone().into(), b"{\"revision\": 2,".to_vec())
        .await
        .unwrap();
    let (unchanged, problems) = fixture.store.reconcile(&canvas.id).await.unwrap();
    assert_eq!(unchanged.frames, canvas.frames);
    assert_eq!(problems.len(), 1);
    assert!(problems[0].message.contains("last valid"));
    let mut edit = file.edit;
    edit.content.css = "button { color: red; }".into();
    save_json(file.path.into(), &edit).await.unwrap();
    let (accepted, problems) = fixture.store.reconcile(&canvas.id).await.unwrap();
    assert!(problems.is_empty());
    assert_eq!(accepted.revision, 3);
    assert_eq!(accepted.frames[0].content, edit.content);
    assert_eq!(
        fixture
            .store
            .reconcile(&canvas.id)
            .await
            .unwrap()
            .0
            .revision,
        3
    );
    assert_eq!(
        fixture.store.history(&canvas.id, Some(2)).await.unwrap()[0].frames,
        canvas.frames
    );
}

#[tokio::test]
async fn stale_content_file_cannot_overwrite_later_layout_or_content() {
    let fixture = Fixture::new();
    let canvas = fixture.populated().await;
    let path = edit_content(&fixture, &canvas, "button { color: red; }").await;
    let newer = fixture
        .store
        .edit(
            &canvas.id,
            2,
            CanvasEdit {
                name: Some("Later manual change".into()),
                ..Default::default()
            },
            Default::default(),
        )
        .await
        .unwrap();
    let (kept, problems) = fixture.store.reconcile(&canvas.id).await.unwrap();
    assert_eq!(kept.revision, newer.revision);
    assert_eq!(kept.frames, canvas.frames);
    assert!(problems[0].message.contains("conflict"));
    assert!(path.exists());
}

#[tokio::test]
async fn an_accepted_content_file_stays_consumed_after_restart_and_later_edits() {
    let fixture = Fixture::new();
    let canvas = fixture.populated().await;
    edit_content(&fixture, &canvas, "button { color: red; }").await;
    let (accepted, _) = fixture.store.reconcile(&canvas.id).await.unwrap();
    let later = fixture
        .store
        .edit(
            &canvas.id,
            3,
            CanvasEdit {
                frames: Some(canvas.frames),
                ..Default::default()
            },
            Default::default(),
        )
        .await
        .unwrap();
    let reopened = Store::at(fixture.store.root.clone());
    let (kept, problems) = reopened.reconcile(&canvas.id).await.unwrap();
    assert_eq!(kept.revision, later.revision);
    assert_ne!(kept.frames, accepted.frames);
    assert!(problems.is_empty());
}

#[tokio::test]
async fn orphan_snapshot_is_never_advertised_as_committed_history() {
    let fixture = Fixture::new();
    let canvas = fixture.canvas().await;
    let dir = fixture.store.dir(&canvas.id).unwrap();
    let head: Value =
        serde_json::from_slice(&fs::read(dir.join("canvas.json")).await.unwrap()).unwrap();
    let snapshot = fs::read(
        dir.join("history")
            .join(format!("{}.json", head["commit"].as_str().unwrap())),
    )
    .await
    .unwrap();
    atomic(dir.join("history").join(format!("{}.json", id())), snapshot)
        .await
        .unwrap();
    assert_eq!(
        fixture.store.history(&canvas.id, None).await.unwrap().len(),
        1
    );
    assert!(fixture.store.history(&canvas.id, Some(2)).await.is_err());
}

#[tokio::test]
async fn unsupported_future_format_refuses_read_write_delete_and_recovery_without_changing_bytes() {
    let fixture = Fixture::new();
    let canvas = fixture.canvas().await;
    let path = fixture.store.dir(&canvas.id).unwrap().join("canvas.json");
    let mut head: Value = serde_json::from_slice(&fs::read(&path).await.unwrap()).unwrap();
    head["formatVersion"] = json!(3);
    head["minReaderVersion"] = json!(3);
    save_json(path.clone(), &head).await.unwrap();
    let original = fs::read(&path).await.unwrap();
    assert!(fixture
        .store
        .read(&canvas.id)
        .await
        .unwrap_err()
        .contains("Update Carbon"));
    assert!(fixture
        .store
        .edit(&canvas.id, 1, Default::default(), Default::default())
        .await
        .is_err());
    assert!(fixture.store.delete(&canvas.id, 1).await.is_err());
    assert!(fixture
        .store
        .recover(&canvas.id)
        .await
        .unwrap_err()
        .contains("Update Carbon"));
    assert_eq!(original, fs::read(&path).await.unwrap());
    assert_eq!(fixture.store.list(None).await.unwrap().problems.len(), 1);
}

#[tokio::test]
async fn compatible_additive_format_and_unknown_metadata_survive_a_rename() {
    let fixture = Fixture::new();
    let canvas = fixture.populated().await;
    let dir = fixture.store.dir(&canvas.id).unwrap();
    let mut head: Value =
        serde_json::from_slice(&fs::read(dir.join("canvas.json")).await.unwrap()).unwrap();
    head["formatVersion"] = json!(2);
    head["newMetadata"] = json!({"keep": true});
    let snapshot_path = dir
        .join("history")
        .join(format!("{}.json", head["commit"].as_str().unwrap()));
    let mut snapshot: Value =
        serde_json::from_slice(&fs::read(&snapshot_path).await.unwrap()).unwrap();
    snapshot["formatVersion"] = json!(2);
    snapshot["futureField"] = json!("preserved");
    save_json(snapshot_path, &snapshot).await.unwrap();
    save_json(dir.join("canvas.json"), &head).await.unwrap();
    let renamed = fixture
        .store
        .edit(
            &canvas.id,
            2,
            CanvasEdit {
                name: Some("Renamed".into()),
                ..Default::default()
            },
            Default::default(),
        )
        .await
        .unwrap();
    assert_eq!(renamed.extra["futureField"], "preserved");
    let head: Value =
        serde_json::from_slice(&fs::read(dir.join("canvas.json")).await.unwrap()).unwrap();
    assert_eq!(head["formatVersion"], 2);
    assert_eq!(head["newMetadata"]["keep"], true);
    assert_eq!(
        fixture.store.read(&canvas.id).await.unwrap().extra["futureField"],
        "preserved"
    );
}

#[tokio::test]
async fn recovery_preserves_broken_bytes_and_ignores_uncommitted_snapshots() {
    let fixture = Fixture::new();
    let canvas = fixture.populated().await;
    let dir = fixture.store.dir(&canvas.id).unwrap();
    let broken = b"{bad manifest\x00\xff".to_vec();
    atomic(dir.join("canvas.json"), broken.clone())
        .await
        .unwrap();
    let recovered = fixture.store.recover(&canvas.id).await.unwrap();
    assert_eq!(recovered.frames, canvas.frames);
    assert_eq!(recovered.revision, 3);
    let mut entries = fs::read_dir(&dir).await.unwrap();
    let mut backups = Vec::new();
    while let Some(entry) = entries.next_entry().await.unwrap() {
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with("canvas.json.broken-")
        {
            backups.push(fs::read(entry.path()).await.unwrap());
        }
    }
    assert_eq!(backups, vec![broken]);
}

#[tokio::test]
async fn failed_recovery_keeps_the_original_and_a_preserved_copy() {
    let fixture = Fixture::new();
    let canvas = fixture.canvas().await;
    let dir = fixture.store.dir(&canvas.id).unwrap();
    atomic(dir.join("canvas.json"), b"broken original".to_vec())
        .await
        .unwrap();
    atomic(dir.join("recovery.json"), b"broken checkpoint".to_vec())
        .await
        .unwrap();
    assert!(fixture.store.recover(&canvas.id).await.is_err());
    assert_eq!(
        fs::read(dir.join("canvas.json")).await.unwrap(),
        b"broken original"
    );
    assert_eq!(fixture.store.list(None).await.unwrap().problems.len(), 1);
}

#[tokio::test]
async fn failed_commit_does_not_change_the_manifest_or_publish_orphan_history() {
    let fixture = Fixture::new();
    let canvas = fixture.populated().await;
    let dir = fixture.store.dir(&canvas.id).unwrap();
    let before = fs::read(dir.join("canvas.json")).await.unwrap();
    fs::rename(dir.join("history"), dir.join("old-history"))
        .await
        .unwrap();
    fs::write(dir.join("history"), b"blocked").await.unwrap();
    assert!(fixture
        .store
        .edit(
            &canvas.id,
            2,
            CanvasEdit {
                name: Some("Not committed".into()),
                ..Default::default()
            },
            Default::default()
        )
        .await
        .is_err());
    assert_eq!(before, fs::read(dir.join("canvas.json")).await.unwrap());
    fs::remove_file(dir.join("history")).await.unwrap();
    fs::rename(dir.join("old-history"), dir.join("history"))
        .await
        .unwrap();
    assert_eq!(
        fixture.store.read(&canvas.id).await.unwrap().name,
        canvas.name
    );
}

const PNG: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6ZkAAAAASUVORK5CYII=";

#[tokio::test]
async fn chunked_images_history_duplication_and_deletion_preserve_file_ownership() {
    let fixture = Fixture::new();
    let canvas = fixture.populated().await;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(PNG)
        .unwrap();
    let asset_id = id();
    let first = || CanvasAssetUpload {
        asset_id: asset_id.clone(),
        name: "pixel.png".into(),
        offset: 0,
        data: base64::engine::general_purpose::STANDARD.encode(&bytes[..12]),
        complete: false,
    };
    let pending = fixture
        .store
        .upload(&canvas.id, 2, first(), Default::default())
        .await
        .unwrap();
    assert_eq!(pending.written, 12);
    assert!(pending.canvas.is_none());
    assert_eq!(
        fixture
            .store
            .upload(&canvas.id, 2, first(), Default::default())
            .await
            .unwrap()
            .written,
        12
    );
    assert!(fixture
        .store
        .read(&canvas.id)
        .await
        .unwrap()
        .assets
        .is_empty());
    let upload = CanvasAssetUpload {
        asset_id: asset_id.clone(),
        name: "pixel.png".into(),
        offset: 12,
        data: base64::engine::general_purpose::STANDARD.encode(&bytes[12..]),
        complete: true,
    };
    let with_asset = fixture
        .store
        .upload(&canvas.id, 2, upload, Default::default())
        .await
        .unwrap()
        .canvas
        .unwrap();
    let mut frames = with_asset.frames.clone();
    frames[0].content.asset_ids.push(asset_id.clone());
    frames[0].content.nodes.push(CanvasNode::Element {
        id: id(),
        name: "Image".into(),
        tag: "img".into(),
        attributes: BTreeMap::from([("src".into(), format!("carbon-canvas-asset://{asset_id}"))]),
        styles: BTreeMap::new(),
        children: Vec::new(),
        extra: Default::default(),
    });
    let design = fixture
        .store
        .edit(
            &canvas.id,
            3,
            CanvasEdit {
                frames: Some(frames),
                ..Default::default()
            },
            CanvasAuthor {
                session_id: Some("session".into()),
                turn_id: Some("turn".into()),
                label: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(design.change.author.turn_id.as_deref(), Some("turn"));
    let copy = fixture
        .store
        .duplicate(&canvas.id, 4, "Copy".into())
        .await
        .unwrap();
    assert_ne!(copy.id, design.id);
    assert_ne!(copy.frames[0].id, design.frames[0].id);
    assert_ne!(copy.frames[0].content.nodes, design.frames[0].content.nodes);
    assert_eq!(copy.assets, design.assets);
    assert_eq!(
        fixture
            .store
            .read_asset(&copy.id, &asset_id, None)
            .await
            .unwrap()
            .data,
        PNG
    );
    fixture.store.delete(&canvas.id, 4).await.unwrap();
    assert!(!fixture.store.dir(&canvas.id).unwrap().exists());
    assert_eq!(
        fixture
            .store
            .read_asset(&copy.id, &asset_id, None)
            .await
            .unwrap()
            .data,
        PNG
    );
    assert!(fixture
        .store
        .root
        .join("deleted")
        .join(format!("{}.json", canvas.id))
        .exists());
}

#[tokio::test]
async fn restore_keeps_the_current_camera_and_records_before_after_revisions() {
    let fixture = Fixture::new();
    let canvas = fixture.populated().await;
    let later = fixture
        .store
        .edit(
            &canvas.id,
            2,
            CanvasEdit {
                name: Some("Later".into()),
                camera: Some(CanvasCamera {
                    x: 100.0,
                    y: 200.0,
                    zoom: 0.5,
                    extra: Default::default(),
                }),
                ..Default::default()
            },
            Default::default(),
        )
        .await
        .unwrap();
    let restored = fixture
        .store
        .restore(&canvas.id, 3, 1, Default::default())
        .await
        .unwrap();
    assert_eq!(restored.revision, 4);
    assert_eq!(restored.camera, later.camera);
    assert_eq!(restored.name, "Explorations");
    assert!(restored.frames.is_empty());
    assert_eq!(restored.change.restored_from, Some(1));
    assert_eq!(restored.change.before_revision, 3);
    assert_eq!(
        fixture.store.history(&canvas.id, Some(2)).await.unwrap()[0].frames,
        canvas.frames
    );
}

#[tokio::test]
async fn ordinary_folders_symlinks_and_linked_git_worktrees_share_project_identity() {
    let fixture = Fixture::new();
    let root = fixture.store.root.join("project");
    fs::create_dir_all(&root).await.unwrap();
    let canonical = fs::canonicalize(&root)
        .await
        .unwrap()
        .to_string_lossy()
        .into_owned();
    assert_eq!(
        project(root.to_str().unwrap()).await.unwrap().path,
        canonical
    );
    std::os::unix::fs::symlink(&root, fixture.store.root.join("alias")).unwrap();
    assert_eq!(
        project(fixture.store.root.join("alias").to_str().unwrap())
            .await
            .unwrap()
            .path,
        canonical
    );
    let output = tokio::process::Command::new("git")
        .args(["init", "-q"])
        .current_dir(&root)
        .output()
        .await
        .unwrap();
    assert!(output.status.success());
    let output = tokio::process::Command::new("git")
        .args([
            "-c",
            "user.name=Canvas test",
            "-c",
            "user.email=canvas@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--allow-empty",
            "-m",
            "Initial",
        ])
        .current_dir(&root)
        .output()
        .await
        .unwrap();
    assert!(output.status.success(), "{:?}", output);
    let linked = fixture.store.root.join("linked");
    let output = tokio::process::Command::new("git")
        .args(["worktree", "add", "--detach"])
        .arg(&linked)
        .current_dir(&root)
        .output()
        .await
        .unwrap();
    assert!(output.status.success(), "{:?}", output);
    assert_eq!(
        project(linked.to_str().unwrap()).await.unwrap().key,
        project(root.to_str().unwrap()).await.unwrap().key
    );
}

#[tokio::test]
async fn recovery_never_reuses_a_revision_even_with_an_old_checkpoint_and_orphan_snapshot() {
    let fixture = Fixture::new();
    let canvas = fixture.populated().await;
    let dir = fixture.store.dir(&canvas.id).unwrap();
    let checkpoint = fs::read(dir.join("recovery.json")).await.unwrap();
    let newer = fixture
        .store
        .edit(
            &canvas.id,
            2,
            CanvasEdit {
                name: Some("Confirmed later save".into()),
                ..Default::default()
            },
            Default::default(),
        )
        .await
        .unwrap();
    atomic(dir.join("recovery.json"), checkpoint).await.unwrap();
    let head: Value =
        serde_json::from_slice(&fs::read(dir.join("canvas.json")).await.unwrap()).unwrap();
    let mut orphan: Value = serde_json::from_slice(
        &fs::read(
            dir.join("history")
                .join(format!("{}.json", head["commit"].as_str().unwrap())),
        )
        .await
        .unwrap(),
    )
    .unwrap();
    orphan["revision"] = json!(9);
    save_json(dir.join("history").join(format!("{}.json", id())), &orphan)
        .await
        .unwrap();
    atomic(dir.join("canvas.json"), b"damaged".to_vec())
        .await
        .unwrap();
    let recovered = fixture.store.recover(&canvas.id).await.unwrap();
    assert_eq!(recovered.revision, 10);
    assert_eq!(recovered.name, canvas.name);
    assert_eq!(recovered.change.before_revision, 2);
    assert_eq!(recovered.change.restored_from, Some(2));
    let history = fixture.store.history(&canvas.id, None).await.unwrap();
    assert_eq!(
        history.iter().map(|c| c.revision).collect::<Vec<_>>(),
        vec![10, 2, 1]
    );
    assert!(fixture
        .store
        .edit(
            &canvas.id,
            newer.revision,
            Default::default(),
            Default::default()
        )
        .await
        .is_err());
}

#[tokio::test]
async fn duplicate_frame_preserves_source_tokens_assets_and_allocates_nonoverlapping_geometry() {
    let fixture = Fixture::new();
    let canvas = fixture.populated().await;
    let duplicate = fixture
        .store
        .duplicate_frame(&canvas.id, 2, &canvas.frames[0].id, Default::default())
        .await
        .unwrap();
    assert_eq!(duplicate.frames[0], canvas.frames[0]);
    assert_eq!(duplicate.frames.len(), 2);
    assert!(
        duplicate.frames[1].geometry.x
            > canvas.frames[0].geometry.x + canvas.frames[0].geometry.width
    );
    assert_ne!(duplicate.frames[0].id, duplicate.frames[1].id);
    assert_eq!(
        duplicate.frames[0].content.css,
        duplicate.frames[1].content.css
    );
    assert_eq!(duplicate.tokens, canvas.tokens);
}

#[tokio::test]
async fn asset_reference_and_upload_offset_errors_cannot_publish() {
    let fixture = Fixture::new();
    let canvas = fixture.populated().await;
    let mut frames = canvas.frames.clone();
    frames[0].content.css = format!(
        "img {{ background: url('carbon-canvas-asset://{}'); }}",
        id()
    );
    assert!(fixture
        .store
        .edit(
            &canvas.id,
            2,
            CanvasEdit {
                frames: Some(frames),
                ..Default::default()
            },
            Default::default()
        )
        .await
        .unwrap_err()
        .contains("assetIds"));
    let upload = CanvasAssetUpload {
        asset_id: id(),
        name: "image.png".into(),
        offset: 2,
        data: PNG.into(),
        complete: true,
    };
    assert!(fixture
        .store
        .upload(&canvas.id, 2, upload, Default::default())
        .await
        .err()
        .unwrap()
        .contains("offset conflict"));
    assert_eq!(fixture.store.read(&canvas.id).await.unwrap().revision, 2);
}

#[tokio::test]
async fn startup_finishes_a_tombstoned_deletion_without_reexposing_the_file() {
    let fixture = Fixture::new();
    let canvas = fixture.populated().await;
    fs::create_dir_all(fixture.store.root.join("deleted"))
        .await
        .unwrap();
    save_json(
        fixture
            .store
            .root
            .join("deleted")
            .join(format!("{}.json", canvas.id)),
        &CanvasSummary::from(&canvas),
    )
    .await
    .unwrap();
    assert!(fixture
        .store
        .read(&canvas.id)
        .await
        .unwrap_err()
        .contains("deleted"));
    assert!(fixture.store.list(None).await.unwrap().files.is_empty());
    assert!(fixture.store.list(None).await.unwrap().problems.is_empty());
    fixture.store.cleanup_incomplete().await.unwrap();
    assert!(!fixture.store.dir(&canvas.id).unwrap().exists());
}

#[tokio::test]
async fn watch_stamp_detects_atomic_replacement_even_when_file_length_is_unchanged() {
    let fixture = Fixture::new();
    let canvas = fixture.populated().await;
    let prepared = fixture
        .store
        .prepare_edit(&canvas.id, 2, &canvas.frames[0].id)
        .await
        .unwrap();
    let before = fixture.store.stamp(&canvas.id).await.unwrap();
    assert_eq!(before, fixture.store.stamp(&canvas.id).await.unwrap());
    let bytes = fs::read(&prepared.path).await.unwrap();
    atomic(prepared.path.into(), bytes).await.unwrap();
    assert_ne!(before, fixture.store.stamp(&canvas.id).await.unwrap());
}

#[tokio::test]
async fn recovery_counter_prevents_reuse_even_when_the_latest_snapshot_is_damaged() {
    let fixture = Fixture::new();
    let canvas = fixture.populated().await;
    let dir = fixture.store.dir(&canvas.id).unwrap();
    let checkpoint = fs::read(dir.join("recovery.json")).await.unwrap();
    fixture
        .store
        .edit(
            &canvas.id,
            2,
            CanvasEdit {
                name: Some("Later save".into()),
                ..Default::default()
            },
            Default::default(),
        )
        .await
        .unwrap();
    let head: Value =
        serde_json::from_slice(&fs::read(dir.join("canvas.json")).await.unwrap()).unwrap();
    atomic(
        dir.join("history")
            .join(format!("{}.json", head["commit"].as_str().unwrap())),
        b"damaged snapshot".to_vec(),
    )
    .await
    .unwrap();
    atomic(dir.join("recovery.json"), checkpoint).await.unwrap();
    atomic(dir.join("canvas.json"), b"damaged manifest".to_vec())
        .await
        .unwrap();
    let recovered = fixture.store.recover(&canvas.id).await.unwrap();
    assert_eq!(recovered.revision, 4);
    assert_eq!(recovered.name, canvas.name);
    assert!(fixture
        .store
        .edit(&canvas.id, 3, Default::default(), Default::default())
        .await
        .is_err());
}

#[tokio::test]
async fn a_deep_tree_is_either_rejected_or_reopens_after_publication() {
    let fixture = Fixture::new();
    let canvas = fixture.canvas().await;
    let mut deep = frame();
    let mut node = CanvasNode::Text {
        id: id(),
        name: "Text".into(),
        text: "Deep".into(),
        extra: Default::default(),
    };
    for _ in 0..64 {
        node = CanvasNode::Element {
            id: id(),
            name: "Container".into(),
            tag: "div".into(),
            attributes: Default::default(),
            styles: Default::default(),
            children: vec![node],
            extra: Default::default(),
        };
    }
    deep.content.nodes = vec![node];
    match fixture
        .store
        .edit(
            &canvas.id,
            1,
            CanvasEdit {
                frames: Some(vec![deep]),
                ..Default::default()
            },
            Default::default(),
        )
        .await
    {
        Ok(saved) => assert_eq!(
            fixture.store.read(&canvas.id).await.unwrap().frames,
            saved.frames
        ),
        Err(_) => assert_eq!(fixture.store.read(&canvas.id).await.unwrap().revision, 1),
    }
}

async fn git_at(path: &std::path::Path, args: &[&str]) {
    let output = tokio::process::Command::new("git")
        .args(args)
        .current_dir(path)
        .output()
        .await
        .unwrap();
    assert!(
        output.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

async fn initial_commit(path: &std::path::Path) {
    git_at(
        path,
        &[
            "-c",
            "user.name=Canvas test",
            "-c",
            "user.email=canvas@example.invalid",
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--allow-empty",
            "-m",
            "Initial",
        ],
    )
    .await;
}

#[tokio::test]
async fn subprojects_stay_distinct_and_follow_their_relative_paths_across_worktrees() {
    let fixture = Fixture::new();
    let root = fixture.store.root.join("main");
    let linked = fixture.store.root.join("linked");
    fs::create_dir_all(root.join("a")).await.unwrap();
    fs::create_dir_all(root.join("b")).await.unwrap();
    git_at(&root, &["init", "-q"]).await;
    initial_commit(&root).await;
    git_at(
        &root,
        &["worktree", "add", "--detach", linked.to_str().unwrap()],
    )
    .await;
    fs::create_dir_all(linked.join("a")).await.unwrap();
    let a = project(root.join("a").to_str().unwrap()).await.unwrap();
    let b = project(root.join("b").to_str().unwrap()).await.unwrap();
    assert_ne!(a.key, b.key);
    assert_eq!(
        a.path,
        fs::canonicalize(root.join("a"))
            .await
            .unwrap()
            .to_string_lossy()
    );
    assert_eq!(
        project(linked.join("a").to_str().unwrap())
            .await
            .unwrap()
            .key,
        a.key
    );
    fixture
        .store
        .create(a.path, "Only project A".into())
        .await
        .unwrap();
    assert!(fixture
        .store
        .list(Some(&b.key))
        .await
        .unwrap()
        .files
        .is_empty());
}

#[tokio::test]
async fn separate_git_metadata_does_not_split_worktree_project_identity() {
    let fixture = Fixture::new();
    let root = fixture.store.root.join("main");
    let linked = fixture.store.root.join("linked");
    let git_data = fixture.store.root.join("metadata");
    fs::create_dir_all(&root).await.unwrap();
    git_at(
        &root,
        &["init", "--separate-git-dir", git_data.to_str().unwrap()],
    )
    .await;
    initial_commit(&root).await;
    git_at(
        &root,
        &["worktree", "add", "--detach", linked.to_str().unwrap()],
    )
    .await;
    let main = project(root.to_str().unwrap()).await.unwrap();
    assert_eq!(
        project(linked.to_str().unwrap()).await.unwrap().key,
        main.key
    );
    assert_eq!(
        main.path,
        fs::canonicalize(root).await.unwrap().to_string_lossy()
    );
}

#[tokio::test]
async fn listing_reports_missing_frame_content_without_hiding_other_files() {
    let fixture = Fixture::new();
    let damaged = fixture.populated().await;
    let healthy = fixture.canvas().await;
    let mut entries = fs::read_dir(fixture.store.dir(&damaged.id).unwrap().join("content"))
        .await
        .unwrap();
    let blob = entries.next_entry().await.unwrap().unwrap().path();
    fs::remove_file(blob).await.unwrap();
    let list = fixture.store.list(None).await.unwrap();
    assert_eq!(list.files.len(), 1);
    assert_eq!(list.files[0].id, healthy.id);
    assert_eq!(list.problems.len(), 1);
    assert_eq!(list.problems[0].id, damaged.id);
}

#[tokio::test]
async fn damaged_image_bytes_refuse_recovery_and_file_duplication() {
    let fixture = Fixture::new();
    let canvas = fixture.populated().await;
    let with_image = fixture
        .store
        .upload(
            &canvas.id,
            2,
            CanvasAssetUpload {
                asset_id: id(),
                name: "image.png".into(),
                offset: 0,
                data: PNG.into(),
                complete: true,
            },
            Default::default(),
        )
        .await
        .unwrap()
        .canvas
        .unwrap();
    let dir = fixture.store.dir(&canvas.id).unwrap();
    let asset = &with_image.assets[0];
    let mut bytes = fs::read(dir.join("assets").join(&asset.hash))
        .await
        .unwrap();
    bytes[20] ^= 1;
    atomic(dir.join("assets").join(&asset.hash), bytes)
        .await
        .unwrap();
    assert!(fixture
        .store
        .duplicate(&canvas.id, 3, "Invalid copy".into())
        .await
        .unwrap_err()
        .contains("checksum"));
    let listed = fixture.store.list(None).await.unwrap();
    assert_eq!(listed.files.len(), 1);
    assert!(
        listed.problems.is_empty(),
        "A rejected duplicate must leave no visible output"
    );
    atomic(dir.join("canvas.json"), b"damaged manifest".to_vec())
        .await
        .unwrap();
    assert!(fixture
        .store
        .recover(&canvas.id)
        .await
        .unwrap_err()
        .contains("checksum"));
    assert_eq!(
        fs::read(dir.join("canvas.json")).await.unwrap(),
        b"damaged manifest"
    );
}

#[tokio::test]
async fn decoded_upload_chunk_limit_is_enforced_before_writing_pending_bytes() {
    let fixture = Fixture::new();
    let canvas = fixture.canvas().await;
    let upload = CanvasAssetUpload {
        asset_id: id(),
        name: "image.png".into(),
        offset: 0,
        data: base64::engine::general_purpose::STANDARD.encode(vec![0u8; 256 * 1024 + 1]),
        complete: false,
    };
    let error = fixture
        .store
        .upload(&canvas.id, 1, upload, Default::default())
        .await
        .err()
        .unwrap();
    assert!(error.contains("256 KiB"));
    assert_eq!(fixture.store.read(&canvas.id).await.unwrap().revision, 1);
}

#[tokio::test]
async fn a_shared_store_deletion_emits_one_tombstone_instead_of_a_missing_file_problem() {
    let fixture = Fixture::new();
    let canvas = fixture.populated().await;
    let emitted = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let recorded = emitted.clone();
    let sink = crate::sink::Sink::new(move |event, payload| {
        recorded.lock().unwrap().push((event.to_string(), payload))
    });
    let mut observed = BTreeMap::new();
    super::watch::refresh(&fixture.store, &sink, &mut observed, canvas.id.clone()).await;
    let peer = Store::at(fixture.store.root.clone());
    let deleted = peer.delete(&canvas.id, 2).await.unwrap();
    super::watch::refresh(&fixture.store, &sink, &mut observed, canvas.id.clone()).await;
    super::watch::refresh(&fixture.store, &sink, &mut observed, canvas.id.clone()).await;
    let events = emitted.lock().unwrap();
    assert_eq!(
        events
            .iter()
            .filter(|(event, _)| event == "canvas_deleted")
            .count(),
        1
    );
    assert!(!events.iter().any(|(event, _)| event == "canvas_problem"));
    assert_eq!(
        events
            .iter()
            .find(|(event, _)| event == "canvas_deleted")
            .unwrap()
            .1["revision"],
        deleted.revision
    );
}

#[tokio::test]
async fn the_documented_layer_depth_boundary_roundtrips_and_one_more_level_is_rejected() {
    let fixture = Fixture::new();
    let canvas = fixture.canvas().await;
    let mut deepest = CanvasNode::Text {
        id: id(),
        name: "Leaf".into(),
        text: "Deep".into(),
        extra: Default::default(),
    };
    for _ in 1..MAX_LAYER_DEPTH {
        deepest = CanvasNode::Element {
            id: id(),
            name: "Container".into(),
            tag: "div".into(),
            attributes: Default::default(),
            styles: Default::default(),
            children: vec![deepest],
            extra: Default::default(),
        };
    }
    let mut nested = frame();
    nested.content.nodes = vec![deepest.clone()];
    let saved = fixture
        .store
        .edit(
            &canvas.id,
            1,
            CanvasEdit {
                frames: Some(vec![nested.clone()]),
                ..Default::default()
            },
            Default::default(),
        )
        .await
        .unwrap();
    assert_eq!(
        fixture.store.read(&canvas.id).await.unwrap().frames,
        saved.frames
    );
    nested.content.nodes = vec![CanvasNode::Element {
        id: id(),
        name: "Too deep".into(),
        tag: "div".into(),
        attributes: Default::default(),
        styles: Default::default(),
        children: vec![deepest],
        extra: Default::default(),
    }];
    assert!(fixture
        .store
        .edit(
            &canvas.id,
            2,
            CanvasEdit {
                frames: Some(vec![nested]),
                ..Default::default()
            },
            Default::default()
        )
        .await
        .unwrap_err()
        .contains("nested"));
    assert_eq!(fixture.store.read(&canvas.id).await.unwrap().revision, 2);
}

#[tokio::test]
async fn initializing_git_keeps_existing_canvases_and_history_in_the_project_and_worktrees() {
    let fixture = Fixture::new();
    let original = fixture.populated().await;
    let owner = PathBuf::from(&original.project_path);
    let snapshot = fixture
        .store
        .dir(&original.id)
        .unwrap()
        .join("history")
        .join(format!("{}.json", original.change.id));
    let bytes = fs::read(&snapshot).await.unwrap();
    assert!(original.project_key.starts_with("path:"));
    git_at(&owner, &["init", "-q"]).await;
    initial_commit(&owner).await;
    let linked = fixture.store.root.join("linked");
    git_at(
        &owner,
        &["worktree", "add", "--detach", linked.to_str().unwrap()],
    )
    .await;
    for directory in [&owner, &linked] {
        let identity = project(directory.to_str().unwrap()).await.unwrap();
        let files = fixture.store.list(Some(&identity.key)).await.unwrap().files;
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].id, original.id);
    }
    let previous = fixture
        .store
        .history(&original.id, Some(1))
        .await
        .unwrap()
        .remove(0);
    assert_eq!(previous.name, original.name);
    assert_eq!(fs::read(snapshot).await.unwrap(), bytes);
    assert!(fixture
        .store
        .read(&original.id)
        .await
        .unwrap()
        .project_key
        .starts_with("git:"));
}

#[tokio::test]
async fn an_initial_publication_failure_cannot_leave_an_unreadable_canvas_row() {
    let fixture = Fixture::new();
    let owner = fixture.store.root.join("project");
    fs::create_dir_all(&owner).await.unwrap();
    atomic(
        fixture.store.root.join("pending"),
        b"blocked staging directory".to_vec(),
    )
    .await
    .unwrap();
    assert!(fixture
        .store
        .create(owner.to_string_lossy().into(), "Not published".into())
        .await
        .is_err());
    let listed = fixture.store.list(None).await.unwrap();
    assert!(listed.files.is_empty());
    assert!(listed.problems.is_empty());
}

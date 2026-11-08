use super::*;

#[tokio::test]
async fn foreign_target_scans_resolve_source_relative_and_explicit_local_owners() {
    let home = std::env::temp_dir().join(format!(
        "carbon-foreign-backlinks-test-{}",
        uuid::Uuid::new_v4()
    ));
    let store = PagesStore {
        root: home.join("pages"),
        assets: home.join("attachments/pages"),
    };
    let target = uuid::Uuid::new_v4().to_string();
    let explicit_remote = store
        .create(
            "Remote target".into(),
            format!("[Target](carbon-page://remote-owner/{target})"),
            vec![],
        )
        .await
        .unwrap();
    let relative_local = store
        .create(
            "Relative target".into(),
            format!("[Target](carbon-page://local/{target})"),
            vec![],
        )
        .await
        .unwrap();
    let absolute_mac = store
        .create(
            "This Mac target".into(),
            format!("[Target](carbon-page://this-mac/{target})"),
            vec![],
        )
        .await
        .unwrap();
    assert!(store.read(&target).await.is_err());
    let foreign = store
        .backlinks(&target, Some("remote-owner"), Some("local"))
        .await
        .unwrap();
    assert_eq!(
        foreign.iter().map(|p| &p.id).collect::<Vec<_>>(),
        vec![&explicit_remote.id]
    );
    let mac_from_remote = store
        .backlinks(&target, Some("local"), Some("remote-owner"))
        .await
        .unwrap();
    assert_eq!(
        mac_from_remote.iter().map(|p| &p.id).collect::<Vec<_>>(),
        vec![&absolute_mac.id]
    );
    assert!(store.backlinks(&target, None, None).await.is_err());
    assert!(store
        .backlinks("../escape", Some("remote-owner"), None)
        .await
        .is_err());
    store
        .create_with_id(target.clone(), "Actual target".into(), "".into(), vec![])
        .await
        .unwrap();
    let mut same_owner: Vec<_> = store
        .backlinks(&target, Some("remote-owner"), Some("remote-owner"))
        .await
        .unwrap()
        .into_iter()
        .map(|p| p.id)
        .collect();
    same_owner.sort();
    let mut expected = vec![explicit_remote.id, relative_local.id];
    expected.sort();
    assert_eq!(same_owner, expected);
    fs::remove_dir_all(home).await.unwrap();
}

#[tokio::test]
async fn backlinks_follow_markdown_links_and_ignore_code_images_and_other_owners() {
    let home = std::env::temp_dir().join(format!("carbon-backlinks-test-{}", uuid::Uuid::new_v4()));
    let store = PagesStore {
        root: home.join("pages"),
        assets: home.join("attachments/pages"),
    };
    let target = store
        .create("Target".into(), "".into(), vec![])
        .await
        .unwrap();
    let local = format!("carbon-page://local/{}", target.id);
    let remote = format!("carbon-page://remote-owner/{}", target.id);
    let linked = store
        .create(
            "Linked".into(),
            format!("[Read]({local}#heading)\n\n[Reference][page]\n\n[page]: {local}"),
            vec![],
        )
        .await
        .unwrap();
    let owner_linked = store
        .create("Owner linked".into(), format!("[Read]({remote})"), vec![])
        .await
        .unwrap();
    store.create("False positives".into(), format!("`[Code]({local})`\n\n```md\n[Code]({local})\n```\n\n![Image]({local})\n\n{local}\n\n[Wrong](https://example.com/{})", target.id), vec![]).await.unwrap();
    assert_eq!(
        store
            .backlinks(&target.id, None, None)
            .await
            .unwrap()
            .iter()
            .map(|p| &p.id)
            .collect::<Vec<_>>(),
        vec![&linked.id]
    );
    let mut ids: Vec<_> = store
        .backlinks(&target.id, Some("remote-owner"), Some("remote-owner"))
        .await
        .unwrap()
        .into_iter()
        .map(|p| p.id)
        .collect();
    ids.sort();
    let mut expected = vec![linked.id.clone(), owner_linked.id.clone()];
    expected.sort();
    assert_eq!(ids, expected);
    store
        .edit(
            &linked.id,
            1,
            Edit {
                trashed: Some(true),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert!(store
        .backlinks(&target.id, None, None)
        .await
        .unwrap()
        .is_empty());
    fs::remove_dir_all(home).await.unwrap();
}

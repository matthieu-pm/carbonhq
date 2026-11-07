#![cfg(all(feature = "serve", unix))]

use std::{os::unix::fs::PermissionsExt, path::PathBuf, process::Stdio, time::Duration};

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::{process::Command, time::timeout};
use tokio_tungstenite::{connect_async, tungstenite::Message};

struct Home(PathBuf);

impl Drop for Home {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[tokio::test]
async fn folder_skills_load_before_slow_pi_discovery() {
    let home = Home(std::env::temp_dir().join(format!("carbon-skills-{}", uuid::Uuid::now_v7())));
    let data = home.0.join("carbon");
    let bin = home.0.join("bin");
    let project = home.0.join("project");
    let skill = project.join(".agents/skills/local-skill");
    let custom = home.0.join("custom/nested/SKILL.md");
    for dir in [&data, &bin, &skill, custom.parent().unwrap()] {
        std::fs::create_dir_all(dir).unwrap();
    }
    std::fs::write(skill.join("SKILL.md"), "---\nname: local-skill\n---\nLocal").unwrap();
    std::fs::write(&custom, "---\nname: pi-custom\n---\nCustom").unwrap();
    std::fs::write(
        data.join("projects.json"),
        json!([{
            "path": project, "name": "fixture", "space": null, "lastSelected": ""
        }])
        .to_string(),
    )
    .unwrap();
    std::fs::write(
        home.0.join("pi-response.json"),
        json!({
            "type": "response", "id": "d1", "command": "get_commands", "success": true,
            "data": {"commands": [{"source": "skill", "name": "skill:pi-custom",
                "sourceInfo": {"path": custom, "scope": "user", "origin": "top-level"}}]}
        })
        .to_string()
            + "\n",
    )
    .unwrap();
    let pi = bin.join("pi");
    std::fs::write(
        &pi,
        "#!/bin/sh\nread -r request\nsleep 3\ncat \"$CARBON_SKILLS_TEST_ROOT/pi-response.json\"\ncat >/dev/null\n",
    )
    .unwrap();
    std::fs::set_permissions(&pi, std::fs::Permissions::from_mode(0o755)).unwrap();

    let mut server = Command::new(env!("CARGO_BIN_EXE_carbon-serve"))
        .args(["--port", "0"])
        .env("CARBON_SKILLS_TEST_ROOT", &home.0)
        .env("CARBON_HOME", &data)
        .env("CARBON_NO_ANALYTICS", "1")
        .env(
            "PATH",
            std::env::join_paths([
                bin.as_path(),
                std::path::Path::new("/usr/bin"),
                std::path::Path::new("/bin"),
            ])
            .unwrap(),
        )
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let port = timeout(Duration::from_secs(10), async {
        loop {
            if let Ok(port) = std::fs::read_to_string(data.join("serve-port")) {
                break port.lines().next().unwrap().to_string();
            }
            assert!(
                server.try_wait().unwrap().is_none(),
                "server exited before listening"
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    let (mut socket, _) = connect_async(format!("ws://127.0.0.1:{port}"))
        .await
        .unwrap();
    let token = std::fs::read_to_string(data.join("serve-token")).unwrap();
    socket
        .send(Message::text(
            json!({"v": 1, "token": token.trim()}).to_string(),
        ))
        .await
        .unwrap();
    socket
        .send(Message::text(
            json!({"id": 1, "cmd": "list_skills", "args": {}}).to_string(),
        ))
        .await
        .unwrap();

    let local = timeout(Duration::from_secs(2), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let reply: Value = serde_json::from_str(frame.to_text().unwrap()).unwrap();
            if reply["id"] == 1 {
                break reply;
            }
        }
    })
    .await
    .expect("folder skills waited for pi instead of loading immediately");
    assert!(local["ok"]["roots"]
        .as_array()
        .unwrap()
        .iter()
        .any(|root| root["skills"]
            .as_array()
            .unwrap()
            .iter()
            .any(|skill| skill["name"] == "local-skill")));

    socket
        .send(Message::text(
            json!({"id": 2, "cmd": "list_skills", "args": {"discoverPi": true}}).to_string(),
        ))
        .await
        .unwrap();
    let discovered = timeout(Duration::from_secs(10), async {
        loop {
            let frame = socket.next().await.unwrap().unwrap();
            let reply: Value = serde_json::from_str(frame.to_text().unwrap()).unwrap();
            if reply["id"] == 2 {
                break reply;
            }
        }
    })
    .await
    .unwrap();
    assert!(
        discovered["ok"]["roots"]
            .as_array()
            .unwrap()
            .iter()
            .any(|root| root["skills"]
                .as_array()
                .unwrap()
                .iter()
                .any(|skill| skill["name"] == "pi-custom")),
        "pi's configured skills must still appear after discovery: {discovered}"
    );
    server.kill().await.unwrap();
}

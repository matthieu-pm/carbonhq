# 0.30.0-beta.7 release checks

CBN-107. Verified on 2026-11-16 before publication. Includes Carbon CLI
0.13.12-beta.2 and protocol v15. Based on merged main at `cbda0056`.

| Check | Result |
| --- | --- |
| Canvas release flag | Packaged servers on arm64 and x86_64 report `canvasEnabled: false`, including with a saved `canvasEnabled: true`. Spaces stays enabled despite the retired disabled setting. Canvas navigation and commands have not shipped; the standalone prototype is absent from production frontend assets. |
| Mounted shipping installer | Applications notice appears before server startup. Existing CLI and login-job checksums stay unchanged. Normal eject succeeds after Quit. |
| Shipping runtime | Unmodified packaged server and CLI authenticate over WebSocket and the orchestration socket on isolated profiles. Harness discovery, Pages create/read and secret request create/status/cancel pass on arm64 and x86_64 through Rosetta. |
| Signed update | Isolated beta.6 downloads and verifies beta.7, installs through Restart to update, launches a new GUI process and reconnects This Mac without a manual open. Saved code font size remains 15px. |
| Startup recovery | Deliberately refused launchd bootstrap recovers after enabling the job without restarting the GUI. |
| Legacy migration | Same-home CLI server exits idle, its job is backed up, and the app takes over. A headless server on a separate home keeps its original PID and job. |
| Automated checks | 1,313 Rust tests pass, 35 ignored; doc tests and headless check pass; 1,139 frontend tests, 3 MCP bridge tests, 53 CLI/installer tests and 12 protocol tests pass. Desktop, website and docs builds pass. |
| Artifact integrity | Deep strict code signatures and both architectures verified, including the bundled CLI, Island and five CEF helpers. Updater signature matches the existing key; modified archive bytes are rejected. |

The GUI first-launch, update and startup-recovery checks use a separate app
identifier and launchd labels, a loopback update feed and disabled global CLI
installation. These overrides exist only in the qualification copy. Its frontend
matches shipping output byte for byte across 1,671 files. The shipping installer
and packaged server/CLI are tested separately. The active installation and global
CLI are preserved; an unmodified shipping GUI first launch and its CLI-install
side effect were not exercised in this run.

This is an isolated data-profile test on the existing Mac, with existing macOS
permissions and provider logins. Intel execution uses Rosetta. No fresh Mac or
permissions reset was tested. This is an ad-hoc-signed, unnotarized beta.

Artifacts:

- DMG SHA-256: `7963eb31210d21dac80300a6120fdb1f99be5f1487cc32091bb45ade2e253e6b`
- Update archive SHA-256: `ae6e0c4612481d8aaf2165ded835d803d06d7a2eaf8d166312ee1fadc2a92c9a`

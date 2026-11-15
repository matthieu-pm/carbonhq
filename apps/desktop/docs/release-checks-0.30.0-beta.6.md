# 0.30.0-beta.6 release checks

CBN-98. Verified on 2026-11-15 before publication. Includes Carbon CLI
0.13.12-beta.1 and protocol v15. Based on merged main at `0d7148c5`.

| Check | Result |
| --- | --- |
| Mounted shipping installer | Applications notice appears before server startup. Carbon login-job files stay unchanged. Normal eject succeeds after Quit. |
| Shipping runtime | Unmodified packaged server and CLI authenticate over WebSocket and the orchestration socket on isolated profiles. Pages create/read and secret request create/status/cancel pass on arm64 and x86_64 through Rosetta. |
| Signed update | Isolated beta.5 downloads and verifies beta.6, installs through Restart to update, launches a new GUI process and reconnects This Mac without a manual open. Saved code font size remains 15px. |
| Startup recovery | Deliberately refused launchd bootstrap recovers after enabling the job without restarting the GUI. |
| Legacy migration | Same-home CLI server exits idle, its job is backed up, and the app takes over. A headless server on a separate home keeps its original PID and job. |
| Automated checks | 1,206 Rust tests pass, 32 ignored; doc tests and headless check pass; 1,114 frontend tests, 32 CLI/installer tests and 8 protocol tests pass. Desktop, website and docs builds pass. |
| Artifact integrity | Deep strict code signatures and both architectures verified, including the bundled CLI, Island and five CEF helpers. Updater signature matches the existing key; modified archive bytes are rejected. |

The GUI first-launch, update and startup-recovery checks use a separate app
identifier and launchd labels, a loopback update feed and disabled global CLI
installation. These overrides exist only in the qualification copy. Its frontend
matches shipping output byte for byte across 1,671 files. The final shipping
installer and packaged server/CLI are tested separately. The active installation
and global CLI are preserved; an unmodified shipping GUI first launch and its
CLI-install side effect were not exercised in this run.

This is an isolated data-profile test on the existing Mac, with existing macOS
permissions and provider logins. Intel execution uses Rosetta. No fresh Mac or
permissions reset was tested. This is an ad-hoc-signed, unnotarized beta.

Artifacts:

- DMG SHA-256: `446e876ef17fd7c3283d1910003796e7f900f27413f663137c289aa1497cc98b`
- Update archive SHA-256: `cbb7584917232db0dd73c40ff4870f6b9c09db2be7bdd8caa959672b0c3d9ccb`

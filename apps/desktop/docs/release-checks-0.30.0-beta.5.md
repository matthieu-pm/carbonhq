# 0.30.0-beta.5 release checks

CBN-66. Verified on 2026-11-13 before publication. Includes carbon CLI 0.13.11
with updated Spaces guidance.

| Check | Result |
| --- | --- |
| Mounted installer | Applications notice shown before server startup; login jobs unchanged; normal eject succeeds. |
| Installed first launch | Final shipping DMG copied to `/Applications/Carbon.app`; isolated `CARBON_HOME`; UI shows This Mac connected; authenticated WebSocket and bundled CLI queries pass. |
| Spaces | Visible on a fresh profile and after updating a profile with `pagesEnabled: false`. UI creates a Page and autosaves title and Markdown; CLI reads the saved revision. |
| Carbon background | New photo visible behind the home dashboard in Carbon dark. |
| CLI installation | Global CLI matches the final bundled executable byte for byte. Bundled agent guidance describes Spaces as shipped. |
| Signed update | Beta.4 downloads and verifies beta.5, then Restart to update swaps the app, launches a new UI process and reconnects This Mac without a manual open. Carbon dark remains selected. |
| Initial registration retry | Deliberately refused launchd bootstrap recovers after enabling the job without restarting the GUI. |
| Legacy migration | A same-home beta.3 CLI server exits idle and hands over to the app; its job is backed up. A server on another home keeps its original PID and job. |
| Active-server safety | The real OS lifetime-lock test passes. |
| Native and Intel execution | Final packaged server and CLI authenticate, query sessions, and create/read Pages with the old disabled flag on arm64 and x86_64 via Rosetta. |
| Automated checks | 1,139 Rust tests pass, 32 ignored; doc tests and headless check pass; 1,065 frontend tests and 30 CLI tests pass. Desktop and website builds pass. |
| Artifact integrity | Deep strict signatures and both architectures verified; updater signature matches existing installs; modified archive bytes are rejected. |

The update rehearsal uses a separate app identifier and launchd labels, a private
loopback feed, and skips global CLI installation. These changes exist only in
the qualification checkout. The unmodified final shipping bundle is tested
separately in Applications, including global CLI installation. The qualification
and shipping frontend output matches byte for byte across 1,672 files.

This is an isolated data-profile test on the existing Mac, with existing macOS
permissions and provider logins. Intel execution uses Rosetta. No fresh Mac, VM
or permissions reset was tested. This is an ad-hoc-signed, unnotarized beta.

Artifacts:

- DMG SHA-256: `88b6daa1da4665fa160897ef722db631acd981112b88a270e5d62dfe113d5b77`
- Update archive SHA-256: `70c586dfe13b6b09cbb45de0ccc46702b19b9ee34f39233888fec33e025ada69`

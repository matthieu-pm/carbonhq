# 0.30.0-beta.4 release checks

CBN-46. Verified on 2026-11-11 before publication. Includes carbon CLI 0.13.11.

| Check | Result |
| --- | --- |
| Mounted shipping DMG | Applications notice shown; no server or Island starts; existing login jobs unchanged; normal eject succeeds. |
| Clean profile | Exact shipping DMG copied to `/Applications/Carbon.app`; fresh `CARBON_HOME`; UI shows This Mac connected; authenticated WebSocket and bundled CLI queries pass. |
| CLI installation | `~/.local/bin/carbon` matches the bundled executable byte for byte and reports 0.13.11. |
| Signed in-app update | Beta.3 downloads the final beta.4 archive, verifies its signature and installs through Restart to update. A new UI process appears without a manual open; the server reconnects on beta.4; the saved font-size preference survives. |
| Initial registration retry | Deliberately refused launchd bootstrap recovers after enabling the job, without restarting the GUI. |
| Missing old executable | A loaded, stopped job naming a missing installer is replaced automatically. |
| Legacy server migration | A same-home 0.29.17 CLI server exits idle and hands over to the app; its job is backed up outside LaunchAgents. A server on another home keeps its original PID and job. Also verified on the regular profile. |
| Active-server safety | The real OS lock test prevents job replacement while another server holds its lifetime lock. |
| Native and Intel execution | Packaged server and bundled CLI authenticate and answer queries on arm64 and x86_64 via Rosetta. |
| Build and automated checks | 1,119 Rust tests pass, 32 ignored; 1,048 frontend tests pass; headless check and universal release build pass. |
| Artifact integrity | Deep strict code-sign verification and both architectures checked; updater key matches existing installs; modified archive bytes are rejected. |

The update rehearsal uses a separate app identifier and launchd labels, a private loopback feed, and skips global CLI installation. These changes exist only in the qualification checkout. The unmodified shipping bundle is tested separately in Applications, including global CLI installation and the regular profile. The release frontend matches the frozen qualification checkout byte for byte (1,671 output files).

The clean-install check uses isolated Carbon data on this Mac. Existing macOS permissions and provider logins were not reset. Intel execution used Rosetta, not a separate Intel Mac. This is an ad-hoc-signed beta, not an Apple-notarized stable release.

Artifacts:

- DMG SHA-256: `9d9f365c9e4fbb42f4c2f6896e7960949795fb1e47064d85f6a122f841e0e0a7`
- Update archive SHA-256: `8c02482727a0670bfca382863d0322e2aade5e6a76117acc7efa937409590b59`

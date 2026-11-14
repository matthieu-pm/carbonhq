# iOS development

Carbon for iPhone and iPad is a SwiftUI client of a Carbon server. It runs no
agent locally. The screen and wire notes are in [PLAN.md](PLAN.md); server
ownership and reconnect rules are in
[server and transport](../desktop/docs/server-and-transport.md).

## Build

Use Xcode with an iOS 17 or newer SDK and XcodeGen. Run from `apps/ios`:

```bash
xcodegen generate
open Carbon.xcodeproj
```

[`project.yml`](project.yml) is the source of the generated project. It names
the Swift package revision, deployment target, schemes and signing settings.
Do not hand-edit or commit the generated `.xcodeproj`. The app also compiles
the Island's `VoiceOrb.swift` and Metal source by relative path, so retain the
repository layout when opening it.

To compile without device signing, choose an installed simulator:

```bash
xcodebuild -showdestinations -project Carbon.xcodeproj -scheme Carbon
xcodebuild -project Carbon.xcodeproj -scheme Carbon -destination 'platform=iOS Simulator,id=<simulator-id>' build
```

Device and TestFlight signing steps remain in [PLAN.md](PLAN.md#stack).
They upload an archive; use them only when publication is requested.

## Keep the wire in step

[`Connection.swift`](Carbon/Connection.swift) implements serve protocol v1.
[`Wire.swift`](Carbon/Wire.swift) holds hand-written `Codable` types. Compare
them with `serve.rs` and the normalized Rust events whenever a command,
argument or event changes. Unknown/malformed optional fields often decode
to an empty value, so a successful build does not prove the phone displays
new data.

[`Store.swift`](Carbon/Store.swift) handles per-server state and reconnects.
Session identity is `(serverId, sessionId)`. Reconnect merges persisted events
by event id and restores unpersisted cards/tasks/queues from `live_state`.
Secret handoffs have a separate metadata list. A stopped server cannot retain
an answerable request.

[`Images.swift`](Carbon/Images.swift) loads prompt, tool-result and Markdown
images. Archived paths are owner-local and load from that server's `/file`
using a Bearer header. Keep the server id in image cache keys. The iOS client
and Island share some source files by path; check both callers before changing
shared types or platform conditionals.

## Validation

Run decoding and formatting tests without a server:

```bash
xcodebuild -project Carbon.xcodeproj -scheme Carbon -destination 'platform=iOS Simulator,id=<simulator-id>' -only-testing:CarbonTests test
```

`CarbonTests` covers image decoding, MCP mentions and PR rules.
`CarbonUITests` uses live server fixtures. Test methods skip when their
required variables are missing; an all-green run with skips is not live
acceptance evidence. Pass variables through `TEST_RUNNER_`, for example:

```bash
TEST_RUNNER_CARBON_URL=ws://127.0.0.1:7399 TEST_RUNNER_CARBON_TOKEN='<scratch-token>' xcodebuild -project Carbon.xcodeproj -scheme Carbon -destination 'platform=iOS Simulator,id=<simulator-id>' -only-testing:CarbonUITests/SmokeTests test
```

Use a scratch server and repository. `SmokeTests.swift` lists its required
session titles, files, permission mode and PR branches. `NewSessionTests`
also needs `CARBON_PROJECT`; clone tests need `CARBON_CLONE`. `DesignTests`
has extra fake-server and reconnect fixtures. Historical scripts in `/tmp`
are not part of this checkout; recreate the documented fixture shape rather
than assuming those scripts still exist. Live tests send prompts, create
sessions and may perform PR actions, so inspect the selected test first.

Inspect the test result screenshots and exercise connection failure,
reconnect, permission/question cards and the changed flow. A simulator build
alone cannot verify camera pairing, device recording or TestFlight behavior.

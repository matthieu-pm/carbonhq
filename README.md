# Carbon

A desktop home for your coding agents. Carbon wraps coding-agent CLIs (Claude
Code, Codex, fx, pi and Grok Build) in a native chat UI. Run many sessions at
once, optionally in separate worktrees, with diff, PR, issue and browser views.

Carbon is based on [Dray](https://github.com/monorepo-labs/dray) by yogesharc,
used under the Apache License 2.0 (see [LICENSE](LICENSE)). This copy renames
the project to Carbon and replaces its branding.

## Layout

| Path                | What                                                   |
| ------------------- | ------------------------------------------------------ |
| `apps/desktop`      | The Tauri app. React 19 + Vite frontend, Rust backend. |
| `apps/web`          | Marketing site. Next.js, deployed to Vercel.           |
| `apps/docs`         | Docs at carbonhq.sh/docs. Blume, deployed to Vercel.    |
| `apps/cli`          | The `carbon` CLI agents use to fan work out.             |
| `crates/carbon-proto` | Wire types shared by the CLI and the app.              |
| `apps/ios`          | SwiftUI client for Carbon servers. XcodeGen project.    |
| `apps/island`       | Native macOS companion, sharing parts of the iOS client. |

## Getting started

For desktop development on macOS, install Xcode Command Line Tools, a Rust
toolchain and cmake. Use the pnpm version in `package.json`; the docs app needs
Node 22.19 or newer. Install and sign in to the agent CLIs you want to run.

```bash
pnpm install --frozen-lockfile
pnpm app    # desktop app
pnpm web    # marketing site on :3000
pnpm docs   # docs site on :4321/docs
pnpm test   # frontend tests
```

Everything else runs from the package's own directory:

```bash
cd apps/desktop && pnpm tauri build
cd apps/desktop/src-tauri && cargo test
```

Run each line from the repository root. The desktop dev shim chooses a free
port and a separate data home for each worktree. `pnpm dev` inside
`apps/desktop` starts only Vite; it does not start the native app or server.
The embedded CEF browser needs the extra setup in
[browser.md](apps/desktop/docs/browser.md).

`cargo test` regenerates `apps/desktop/src/types/events.ts`. Always follow a
filtered run with a bare `cargo test`.

The [engineering docs](apps/desktop/docs/README.md) map subsystems and checks.
See the [docs app guide](apps/docs/README.md) for its build and rewrite setup,
and the [iOS guide](apps/ios/README.md) for native build and test commands.

## The `carbon` CLI

A standalone binary. It talks to Carbon's background server over a Unix
socket, normally `~/.carbon/carbon.sock`, so an agent in one session can
create, list and message others. The server keeps sessions running when the
Mac app closes. A release app installs the bundled CLI in `~/.local/bin`;
headless machines use the installer:

```bash
curl -fsSL https://carbonhq.sh/install.sh | sh
```

On Linux the same line makes the machine a Carbon server: [carbonhq.sh/docs/server](https://carbonhq.sh/docs/server).

Dev builds and explicit `CARBON_HOME` overrides use their own sockets.
Agents receive `CARBON_ENDPOINT` for their owning server. See
[server and transport](apps/desktop/docs/server-and-transport.md) before
starting another server on this machine.

## Releasing

**App:** tag `vX.Y.Z` (stable) or `vX.Y.Z-beta.N` (beta). The tag must match
`apps/desktop/src-tauri/tauri.conf.json`, and a stable release needs a
matching section in `apps/desktop/CHANGELOG.md`.

**CLI:** tag `cli-vX.Y.Z` (stable) or `cli-vX.Y.Z-beta.N` (beta), matching the
version in `apps/cli/Cargo.toml` exactly. Cut one beside every app release, beta
included, so a server can run the core that release expects.

## Credits

Full licence texts are in [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md).

**Themes.** Four palettes are MIT ports, colours theirs and token names ours:
[Catppuccin](https://github.com/catppuccin/catppuccin),
[Cobalt2](https://github.com/wesbos/cobalt2-vscode) (Wes Bos, Roberto Achar),
[One Dark Pro](https://github.com/Binaryify/OneDark-Pro) (Binaryify) and
[gruvbox](https://github.com/morhetz/gruvbox) (Pavel Pertsev).

**Marks.** The [pi](https://pi.dev) mark is MIT, © Earendil Inc. &
Contributors. Claude's and OpenAI's are their owners' trademarks and only name
the agent a session runs on.

**Transcription.** Dictation runs locally on
[transcribe.cpp](https://github.com/handy-computer/transcribe.cpp) (MIT).
Models are `handy-computer`'s GGUF conversions from Hugging Face, CC-BY-4.0
with their base models' terms. The dictation sounds are
[Handy](https://github.com/cjpais/Handy)'s marimba pair, by CJ Pais, MIT.
Handy's name and brand assets are not used here.

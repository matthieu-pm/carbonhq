# Carbon

A desktop home for your coding agents. Carbon wraps coding-agent CLIs (Claude
Code, Codex, fx, pi) in a native chat UI. Run many sessions at once. Each gets
its own worktree, diff view, PR panel, issue panel and embedded browser.

Carbon is based on [Dray](https://github.com/monorepo-labs/dray) by yogesharc,
used under the Apache License 2.0 (see [LICENSE](LICENSE)). This copy renames
the project to Carbon and replaces its branding.

## Layout

| Path                | What                                                   |
| ------------------- | ------------------------------------------------------ |
| `apps/desktop`      | The Tauri app. React 19 + Vite frontend, Rust backend. |
| `apps/web`          | Marketing site. Next.js, deployed to Vercel.           |
| `apps/docs`         | Docs at carbon.forgenow.tech/docs. Blume, deployed to Vercel.    |
| `apps/cli`          | The `carbon` CLI agents use to fan work out.             |
| `crates/carbon-proto` | Wire types shared by the CLI and the app.              |

## Getting started

You need Node with pnpm, a Rust toolchain, and cmake.

```bash
pnpm install
pnpm app    # desktop app
pnpm web    # marketing site on :3000
pnpm test   # frontend tests
```

Everything else runs from the package's own directory:

```bash
cd apps/desktop && pnpm tauri build
cd apps/desktop/src-tauri && cargo test
```

`cargo test` regenerates `apps/desktop/src/types/events.ts`. Always follow a
filtered run with a bare `cargo test`.

## The `carbon` CLI

A standalone binary. It talks to the running app over `~/.carbon/carbon.sock`, so
an agent in one session can create, list and message others.

```bash
curl -fsSL https://carbon.forgenow.tech/install.sh | sh
```

On Linux the same line makes the machine a Carbon server: [carbon.forgenow.tech/docs/server](https://carbon.forgenow.tech/docs/server).

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

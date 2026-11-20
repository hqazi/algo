# Contributing to Algorithm Tutor

Thanks for your interest! Bug reports, problem ideas, documentation fixes and
code are all welcome.

## Reporting a bug or asking for a feature

Open an [issue](https://github.com/hqazi/algo/issues/new/choose). For a bug,
say which version and OS you use and what you did; the app log in `logs/`
in the [data folder](docs/guide/data-and-privacy.md#your-data-folder) helps
(it has no chat text or credentials).

Please report security problems privately: see [SECURITY.md](SECURITY.md).

## Setting up

You need [Node.js](https://nodejs.org) 22 (the version in `.nvmrc`) and git.
Nothing else: Python runs in Pyodide, which is installed with the other
dependencies.

```bash
git clone https://github.com/hqazi/algo.git
```

```bash
cd algo
```

```bash
npm ci
```

```bash
npm run dev
```

`npm run dev` starts the app with hot reload. To try the tutor without an API
key or network, start it with the scripted fake tutor:

```bash
ALGOTUTOR_FAKE_TUTOR="$PWD/apps/desktop/e2e/fake-tutor.json" npm run dev
```

To keep your real data separate, also set `ALGOTUTOR_DATA_DIR` to an empty
folder.

## The checks

Every change must pass these (CI runs them on Linux, macOS and Windows):

| Command | What it checks |
|---|---|
| `npm run typecheck` | TypeScript, every workspace and the scripts. |
| `npm run lint` | ESLint. |
| `npm run format:check` | Prettier (`npm run format` fixes it). Markdown is not reformatted. |
| `npm test` | Vitest: core, main process, UI components, scripts and docs links. |
| `npm run validate:content` | Every curated problem validates and its reference passes in Pyodide. |

And, for changes they cover:

| Command | What it checks |
|---|---|
| `npm run e2e` | Playwright-for-Electron end-to-end tests with the fake tutor. On Linux without a display: `xvfb-run -a npm run e2e`. |
| `npm run check:security` | The Electron security baseline in the built app. |
| `npm run check:exec-host` | The real execution host: CSP, network blocking, timeouts. |
| `npm run check:storage` | SQLite storage in Electron's Node. |
| `npm run check:harnesses` | Rust and Go harnesses (needs `cargo` and `go`). |
| `npm run e2e:claude-code` | The Claude Code backend against a local stand-in (needs `claude`). |
| `npm run smoke:ai` | One real call to the Anthropic API (needs `ANTHROPIC_API_KEY`; never in CI). |

`npm run screenshots` retakes the pictures in `docs/assets/screenshots/` from
the built app with a scripted tutor.

## Ground rules

These keep the app safe and honest. Reviews hold every change to them.

- `packages/core` never imports Electron or Node-only modules.
- Code written by the model (problem references, brute forces) runs only in
  the Pyodide executor.
- Hidden test data never leaves the main process unredacted.
- The API key lives only in the main process and the OS keychain.
- No test calls a real AI provider. Never commit credentials, user data or
  recorded real AI responses.
- Pass/fail always comes from running tests.

## How work is organised

The app is specified in [`docs/SPEC.md`](docs/SPEC.md) and was built ticket
by ticket from [`docs/TASKS.md`](docs/TASKS.md); "How to work a ticket" there
describes the workflow. When a change resolves an open question or pins a
version, add an entry to [`docs/DECISIONS.md`](docs/DECISIONS.md). If a change
needs the spec to change, change `SPEC.md` in the same commit.

[`docs/architecture.md`](docs/architecture.md) is the quickest way into the
code.

### Adding a curated problem

Each problem is a folder under `content/problems/<topic>/<slug>/` with
`problem.md`, `meta.json`, `tests.json` and `reference.py`, in format v2
([SPEC §5.1](docs/SPEC.md#51-format-v2-of-the-dsa-tutor-format), schemas in
`content/schema/`). Give hidden tests a clear `category`: it is all a user
sees when one fails. Run `npm run validate:content` before you commit.

## Releases

Pushing a tag `vX.Y.Z` (or `vX.Y.Z-beta.N`, `vX.Y.Z-rc.N`) runs the Release
workflow: it builds and smoke-tests the installers on all three OSes and
uploads them to a draft GitHub release, and publishes the matching runner
image. A maintainer then publishes the draft. Note changes in
[`CHANGELOG.md`](CHANGELOG.md).

## Licence

By contributing you agree that your contribution is licensed under the
[Apache License 2.0](LICENSE).

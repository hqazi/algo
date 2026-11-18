# Decisions

Why the app is shaped the way it is. Newest entries at the bottom. Tickets add
entries when they resolve a **VERIFY** or **DECISION** from `SPEC.md` §14, or
pin a version.

Format: **D-NN Title** (date, ticket) — decision, then why, then what was
rejected.

---

**D-01 Second attempt, not a refactor of dsa-tutor** (2026-11-17, planning)

Start a new repository and carry over content and logic deliberately (see
`CONTEXT.md`). `dsa-tutor` works, but most of its complexity serves an install
model we are dropping: Docker Compose with two hardened containers, a Unix
socket between them, SELinux relabelling, a local image build, ~20
environment variables (some build-time only, some ignored under compose), a
read-only Settings page, and updates by `git pull` + rebuild.

**D-02 Desktop app on Electron** (2026-11-17, planning)

Electron + React + TypeScript, everything in one language.
- The main process runs the Anthropic TypeScript SDK (and possibly the Claude
  Agent SDK), so the key never reaches the UI.
- Most new features spawn processes (`docker`, `podman`, `cargo`, `go`,
  `claude`); Node `child_process` makes that simple.
- Bundled Chromium gives identical Pyodide, Web Worker and CodeMirror
  behaviour on every OS.
- The `dsa-tutor` React UI ports largely unchanged.
- electron-builder + electron-updater cover installers and auto-update.

Costs accepted: ~100–150 MB download, ~200–300 MB memory, security setup is
our job (SPEC §10), regular releases to keep Chromium patched.

Rejected: **Tauri** (smaller, safer defaults, but a Rust backend and the OS
web view, WebKitGTK on Linux being the usual source of Pyodide/editor bugs);
**a local web app** (`uv tool install` / single binary opening the browser:
least work, but rougher install/update and no keychain integration); **a Python
sidecar inside Electron** (two runtimes to bundle).

Hedge: `packages/core` holds all tutor logic and never imports Electron, so a
different shell later is a new shell, not a rewrite.

**D-03 Python runs in Pyodide; model-written code runs only there**
(2026-11-17, planning)

The containers in `dsa-tutor` existed mainly to sandbox code. Pyodide in a Web
Worker inside a sandboxed, network-blocked window gives that for Python with
nothing to install, on every OS. Model-written code (references, brute forces
from the self-check) runs only in Pyodide in every version, because tests are
language-neutral JSON and references only need to exist in Python.

Costs accepted: a few seconds of first start, code 2–3× slower than CPython
(time limits recalibrated, SPEC §6.2).

**D-04 Language-neutral problem format from v1** (2026-11-17, planning)

Signatures in neutral types (SPEC §5.2) with JSON tests, so v2 adds Rust and Go
by writing harness generators, not by touching problems. The format decision
is cheap now and expensive after more problems exist.

**D-05 Rust and Go: local toolchain by default, container optional; the app
never installs anything** (2026-11-17, planning)

Rust and Go cannot compile in the browser in a practical way. The user's own
code runs with their own `cargo`/`go` (what they would do in a terminal).
Users who want isolation pick a Docker or Podman they already have; the app
only detects runtimes and lets the user choose. Install instructions live in
the README.

Rejected: an install script or in-app installer for Docker (admin rights,
reboots and WSL2 on Windows, group changes on Linux, Docker Desktop licence
terms for larger companies, blocked on managed machines, and we would own
every failure). Podman is the recommended runtime in the docs: free for
everyone, rootless, no daemon.

**D-06 State in SQLite, preferences in JSON, secrets in the keychain,
solutions as files** (2026-11-17, planning)

All under the OS per-user app data folder, never in a repository checkout.
SQLite (with numbered migrations and a backup before each) for progress,
attempts, hints, chats; `settings.json` so preferences stay readable;
`safeStorage` for the API key; solutions as plain files so the user can use
their own editor. Curated problems ship inside the app and are replaced by
updates.

Rejected: git-ignored files in a checkout (there is no checkout in an
installed app, and it mixed code and data in `dsa-tutor`).

**D-07 Tutor backends: Anthropic API, plus Claude Code when found**
(2026-11-17, planning)

Drop `dsa-tutor`'s generic agent-CLI adapter. The `fake` backend stays for
tests only. Whether and how a user's own Claude Code login can be used is a
**VERIFY** in T11 (current flags, Agent SDK, current terms).

**D-08 No agent-skill mode in v1** (2026-11-17, planning)

`dsa-tutor` doubled as a coding-agent skill. Deferred: it can come back on top
of `packages/core`.

**D-09 Tauri considered, Electron kept** (2026-11-18, owner)

The plan was briefly rewritten for Tauri 2 (commit `a9af54e`, reverted). Under
Tauri the API key, hidden tests and tutor tool loop must stay out of the web
view, so all core logic would move to Rust; Pyodide would have to be replaced
by CPython on WASI inside wasmtime (no consistent browser engine to run it
in); there is no official Anthropic Rust SDK to lean on; and the Python
runtime plus wasmtime would add 30–50 MB, eroding Tauri's size advantage. The
estimate rose from about 32 to about 42 dev-days. The owner chose to stay
with Electron (D-02, D-03 stand). The reverted commit keeps the full Tauri
spec if this is ever revisited.

**D-10 Toolchain versions pinned in T01** (2026-11-18, T01)

Exact versions in `package.json` (no ranges); the lockfile pins the rest.

| Package | Version | Note |
|---|---|---|
| Node | 22 (`.nvmrc`, `engines >=22.12 <23`) | SPEC §3.1. |
| Electron | 45.3.4 | Ships Node 24.22 and Chromium 156, so the main/preload code is typed with `@types/node` 24.19.2. |
| electron-vite | 6.0.0 | On Vite 8.3.8 (Rolldown). |
| React / React DOM | 19.3.1 | `@vitejs/plugin-react` 6.3.0. |
| Vitest | 5.1.0 | 5.1.1 was published the same day; took the previous patch. |
| TypeScript | 6.0.3 | Not 7.x: `typescript-eslint` 8.73 supports `<6.1`. |
| ESLint | 10.15.0 | Flat config, `typescript-eslint` 8.73.0. |
| Prettier | 3.10.1 | |

How `packages/core` stays free of Electron and Node: its `tsconfig.json` has
`lib: ["ES2023"]` and `types: []` (no `process`, `Buffer`, DOM, or
`setTimeout`; time is injected), and ESLint `no-restricted-imports` rejects
`electron`, `node:*` and bare built-in names in `packages/core/**`. Core is
consumed as TypeScript source and bundled by electron-vite (excluded from
`externalizeDeps`). The preload is built as CommonJS (`index.cjs`) because
sandboxed preloads cannot be ES modules.

Known issues: npm 10.9 (bundled with Node 22) crashes with `Cannot read
properties of null (reading 'edgesOut')` when *resolving* a fresh tree
(Vitest's optional peers); `npm ci` from the lockfile works. To change
dependencies, use `npx npm@11 install`. `npm audit` reports a high-severity
picomatch ReDoS advisory with no fixed version in dev-only tooling
(Vitest, typescript-eslint); production dependencies audit clean.

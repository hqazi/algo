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

**D-02 Desktop app on Electron** (2026-11-17, planning) — *superseded by D-09*

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

Hedge: the core package holds all tutor logic and never imports Electron, so a
different shell later is a new shell, not a rewrite.

**D-03 Python runs in Pyodide; model-written code runs only there**
(2026-11-17, planning) — *mechanism superseded by D-10; the principle stands*

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
the OS keychain for the API key; solutions as plain files so the user can use
their own editor. Curated problems ship inside the app and are replaced by
updates.

Rejected: git-ignored files in a checkout (there is no checkout in an
installed app, and it mixed code and data in `dsa-tutor`).

**D-07 Tutor backends: Anthropic API, plus Claude Code when found**
(2026-11-17, planning)

Drop `dsa-tutor`'s generic agent-CLI adapter. The `fake` backend stays for
tests only. Whether and how a user's own Claude Code login can be used is a
**VERIFY** in T11 (current flags, MCP integration, current terms).

**D-08 No agent-skill mode in v1** (2026-11-17, planning)

`dsa-tutor` doubled as a coding-agent skill. Deferred: it can come back on top
of the core crate (`tutor-core`).

**D-09 Switch the shell to Tauri 2** (2026-11-18, owner) — *supersedes D-02*

The owner chose Tauri over Electron before any code was written. Gains: a
much smaller download and memory footprint, locked-down defaults (capabilities
per window, no Node in the UI), a built-in updater with its own update
signatures, and a Rust backend. Accepted costs: the backend is Rust (more
code to write, notably an Anthropic client, see D-12); the UI runs in the OS
web view, which differs per OS (WebKitGTK on Linux is the weakest), so the UI
is tested on all three; `tauri-driver` e2e tests do not run on macOS.

The core/shell split from D-02 stays: tutor logic lives in `tutor-core`, a
Rust crate with no Tauri dependency and no direct I/O.

**D-10 Python runs as CPython on WASI inside wasmtime** (2026-11-18,
planning) — *replaces Pyodide from D-03*

With Electron, Pyodide ran in a hidden Chromium window. Under Tauri that would
mean running it in the OS web view: three different engines, network blocking
only through CSP, no way to run it headless in CI, and every tool call from
the tutor would need a round trip through a window. Embedding wasmtime in the
Rust backend instead gives the same sandbox on every OS: no filesystem beyond
a read-only stdlib, no network, an empty environment, memory caps
(`StoreLimits`) and hard deadlines (epoch interruption), callable directly
from the tutor's tools and from `tutor-cli` in CI.

Costs: the CPython WASI runtime and stdlib (tens of MB) plus wasmtime (~10–20
MB) partly eat Tauri's size advantage; WASI CPython is slower than native
(time limits recalibrated in T07); deep recursion needs care (wasm stack size
and recursion limit, VERIFY in T07). The principle from D-03 is unchanged:
model-written code runs only in this sandbox.

Rejected: Pyodide in a Tauri web view (above); RustPython (incomplete
compatibility with CPython behaviour users expect); native CPython in a
subprocess (no real sandbox for model-written code).

**D-11 Core logic in Rust, UI stays React** (2026-11-18, planning)

The API key, hidden tests and the tutor's tool loop must stay out of the web
view, so everything except presentation runs in the Rust backend:
`tutor-core` (pure), `tutor-store`, `tutor-exec`, `tutor-ai`, plus
`tutor-cli` for headless checks. The `dsa-tutor` React UI still ports, talking
to Rust through generated, typed command bindings.

**D-12 Own Anthropic Messages client unless an official Rust SDK exists**
(2026-11-18, planning)

As far as known at planning time there is no official Anthropic Rust SDK
(VERIFY in T10). T10 writes a small client on `reqwest` with SSE streaming and
keeps response content blocks as raw JSON so they are replayed unchanged. The
`claude-code` backend's MCP server uses `rmcp`, the Rust MCP SDK (VERIFY in
T11).

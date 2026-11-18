# Algorithm Tutor: tasks

Work breakdown for [`SPEC.md`](SPEC.md). One ticket per agent session.
Status lives only in the **Progress** table below; edit it by hand.

## How to work a ticket

1. **Pick.** If the user named a ticket, take it. Otherwise take the first
   `todo` ticket in the Progress table whose dependencies are all `done`,
   preferring the critical path (T01 → T03 → T07 → T08 → T10) and the current
   milestone. If a ticket is `in-progress`, ask before taking over. If none is
   ready, say so and stop.
2. **Claim.** Set it to `in-progress` in the table, commit `TNN: start`, push.
3. **Read.** The ticket; the `SPEC.md` sections in its `Spec:` line;
   `DECISIONS.md`; the `CONTEXT.md` rows for it. If it ports from
   `dsa-tutor`, get a read-only checkout (`CONTEXT.md`, "Getting the source")
   and read the old code **and its tests**: the old tests define the behaviour
   to keep.
4. **Build.** Stay inside the ticket's **Owns** paths (small wiring changes
   elsewhere are fine; list them in the notes). The spec is the contract: if
   the ticket needs it changed, change `SPEC.md` in the same branch and say so
   in the commit message. Resolve every **VERIFY** the ticket touches from
   current documentation, not memory; apply a **DECISION**'s default unless
   evidence says otherwise. Record either in `DECISIONS.md`. Write tests with
   the code; commit in small working steps prefixed `TNN:`.
5. **Check.** Everything in SPEC §13 that exists so far: `cargo fmt --check`,
   `cargo clippy --workspace --all-targets -- -D warnings`,
   `cargo test --workspace`; in `apps/desktop/ui`: `npm run typecheck`,
   `npm run lint`, `npm test`; from T04 on,
   `cargo run -p tutor-cli -- validate-content`; plus the ticket's own checks.
   Tick an acceptance box only with evidence (a test, a command's output, a
   manual check actually done).
6. **Finish.** Fill the ticket's **Notes.**: what was built, decisions,
   wiring outside **Owns**, and plainly what was *not* done or not tested. Set
   the table to `done`, or `blocked` with the reason in Notes. Then merge into
   `main` (rules below) and push.

## Rules for every ticket

- Work on a branch `task/TNN-short-name` from the latest `main` (or the
  session's assigned branch). When the checks pass, rebase on `main`, merge
  into `main` fast-forward and push. No pull requests. Never force-push
  `main`.
- `tutor-core` never depends on Tauri and does no I/O except through its
  traits.
- The web view gets only typed commands, channels and events; no Tauri
  plugin that gives it file, shell or network access.
- No test calls a real AI provider. Never commit credentials, user data, or
  recorded real AI responses.
- Model-written code runs only in the `wasi-python` executor; hidden test data
  and expected values never leave the backend.
- Report honestly: list anything not done or not tested.

## Progress

Statuses: `todo`, `in-progress`, `blocked`, `done`.

| Ticket | Title | Milestone | Size | Depends on | Status |
|---|---|---|---|---|---|
| T01 | Repository scaffold | v1 | 3d | — | todo |
| T02 | Security baseline and typed commands | v1 | 2d | T01 | todo |
| T03 | Problem format v2 and neutral types | v1 | 2d | T01 | todo |
| T04 | Port the curated problems and references | v1 | 2d | T03, T07 | todo |
| T05 | SQLite storage and settings | v1 | 2d | T01 | todo |
| T06 | Port the core teaching logic | v1 | 4d | T03, T05 | todo |
| T07 | Executor trait and WASI Python sandbox | v1 | 4d | T03 | todo |
| T08 | Port the UI shell and practice flow | v1 | 4d | T02, T06, T07 | todo |
| T09 | Onboarding and Settings | v1 | 2d | T08 | todo |
| T10 | Tutor: Anthropic backend and chat | v1 | 6d | T06, T08 | todo |
| T11 | Tutor: Claude Code backend | v1 | 3d | T10 | todo |
| T12 | New problems: generate, paste, import | v1 | 3d | T07, T10 | todo |
| T13 | Packaging, auto-update and release workflow | v1 | 3d | T08 | todo |
| T14 | README, end-to-end test, v1 release check | v1 | 2d | T04, T09, T10, T11, T12, T13 | todo |
| T15 | Rust and Go harness generators | v2 | 5d | T04 | todo |
| T16 | Local toolchain executor | v2 | 2d | T15 | todo |
| T17 | Container executor (Docker and Podman) | v2 | 3d | T15 | todo |
| T18 | Settings → Code execution panel | v2 | 2d | T16, T17 | todo |
| T19 | Runner image in CI | v2 | 2d | T13, T15 | todo |
| T20 | README: optional container sandbox and toolchains | v2 | 1d | T18 | todo |

Totals: v1 ≈ 42 dev-days, v2 ≈ 15.

## Order

```
v1:  T01 ─┬─ T02 ───────────────────────────┐
          ├─ T03 ─┬─ T07 ─┬─ T04            ├─ T08 ─┬─ T09
          │       │       └─────────────────┤       ├─ T10 ─┬─ T11
          └─ T05 ─┴─ T06 ───────────────────┘       │       └─ T12 (needs T07)
                                                    └─ T13
                                                    T14 last
v2:  T15 (needs T04) ─┬─ T16 ─┐
                      └─ T17 ─┼─ T18 ─ T20
              T19 (needs T13) ┘
```

Critical path: T01 → T03 → T07 → T08 → T10. {T02, T03, T05} can run in
parallel after T01; {T04, T06, T07} once their dependencies are done; {T09,
T10, T13} after T08.

---

## v1: Python desktop app

### T01 — Repository scaffold

- Milestone: v1
- Size: 3d
- Depends on: —
- Spec: §3.1, §3.2, §13
- Owns: `Cargo.toml` (workspace), `Cargo.lock`, `rust-toolchain.toml`, `crates/*/` (empty crates with one test each), `apps/desktop/src-tauri/` (skeleton), `apps/desktop/ui/` (skeleton), `.github/workflows/ci.yml`, lint/format config, `.gitignore`, `.nvmrc`, `justfile` or root `package.json` scripts

**Goal.** A workspace that builds, lints and tests on Linux, macOS and
Windows in CI, with a Tauri 2 app that opens a React window.

**Scope.**
- Cargo workspace with `tutor-core`, `tutor-store`, `tutor-exec`, `tutor-ai`, `tutor-cli` and the Tauri app crate, per SPEC §3.1. Each library crate has one trivial function and test.
- `apps/desktop/ui`: Vite + React + TypeScript, showing "Algorithm Tutor" and the app version from a trivial command.
- Rust toolchain pinned; Node 22 for the UI (`.nvmrc`).
- One `check` entry point (justfile or npm script) that runs SPEC §13's checks that exist.
- CI on ubuntu, macos, windows: Rust fmt/clippy/test, UI typecheck/lint/test, `tauri build --debug` (or `--no-bundle`) to prove it compiles. Install the Linux WebKitGTK build dependencies (resolve the §14 VERIFY for build deps). No secrets.
- Record pinned versions (Rust, Tauri, Vite, React) in `DECISIONS.md`.

**Acceptance.**
- [ ] The check entry point passes locally and in CI on all three OSes.
- [ ] `npm run tauri dev` (or `cargo tauri dev`) opens a window showing the app name and version.
- [ ] `tutor-core`'s dependencies contain no Tauri, tokio, reqwest, rusqlite or wasmtime (checked by a CI step, e.g. `cargo tree -p tutor-core`).

**Notes.**

### T02 — Security baseline and typed commands

- Milestone: v1
- Size: 2d
- Depends on: T01
- Spec: §3, §8, §10
- Owns: `apps/desktop/src-tauri/capabilities/`, `apps/desktop/src-tauri/tauri.conf.json` (security), `apps/desktop/src-tauri/src/commands/mod.rs`, `apps/desktop/src-tauri/src/ipc.rs`, `apps/desktop/ui/src/bindings/` (generated)

**Goal.** The secure foundation every later ticket builds on.

**Scope.**
- Capabilities: the main window may call only this app's commands; no `fs`, `shell`, `http` or `opener` plugin permissions for the UI (opening the data folder or a README link goes through an app command that validates its target).
- Strict CSP; no remote content; `freezePrototype`; decide on the isolation pattern and record why.
- Typed bindings: resolve the §14 VERIFY and set up generation of TypeScript types for commands and events from Rust; a CI check that the committed bindings are up to date.
- Patterns used by every later ticket: a command returning `Result<T, AppError>` (serialisable, user-readable), a streaming command using `tauri::ipc::Channel` with a `cancel` command, and a broadcast event.
- One example of each, used by the UI.

**Acceptance.**
- [ ] A test or check that the capability files grant no plugin permissions beyond the allowed list.
- [ ] Streaming example with cancel works (test on the Rust side; manual check in the UI).
- [ ] Bindings check fails CI when a command signature changes without regenerating.

**Notes.**

### T03 — Problem format v2 and neutral types

- Milestone: v1
- Size: 2d
- Depends on: T01
- Spec: §5.1, §5.2
- Owns: `crates/tutor-core/src/problem/`, `crates/tutor-core/src/types/`, `crates/tutor-core/src/compare/`, `content/schema/`

**Goal.** The language-neutral problem format, in code.

**Scope.**
- serde types for `meta.json` v2 and `tests.json` v2; JSON Schema generated with `schemars` into `content/schema/`.
- Neutral type parser (`list<list<int>>`, `tree<int>`, `optional<T>`, …) and a validator that checks every test input/expected value against the signature.
- Python mapping (type → Python hint) for stubs and prompts.
- Compare modes `exact`, `unordered`, `unordered_deep`, `float` with tolerance, ported from `dsa-tutor/dsa_tutor/core/grading.py` with the same behaviour.
- A loader that takes file contents (no I/O in core) and returns a validated problem.

**Acceptance.**
- [ ] Unit tests: type parser (valid and invalid), value validation per type, every compare mode (port the `dsa-tutor` cases).
- [ ] The `level-lists` problem from `dsa-tutor`, hand-converted, loads and validates in a test.

**Notes.**

### T04 — Port the curated problems and references

- Milestone: v1
- Size: 2d
- Depends on: T03, T07
- Spec: §5.1, §5.3, §9, §13
- Owns: `content/problems/`, `content/references/`, `crates/tutor-cli/src/convert.rs`, `crates/tutor-cli/src/validate.rs`

**Goal.** All 50 curated problems and the teaching references, in format v2,
verified.

**Scope.**
- `tutor-cli convert-dsa-tutor <path>`: `dsa-tutor/problems/curated/` → `content/problems/` (meta.json `signatures.python` → neutral `signature`, `schema_version` 2, `languages: ["python"]`, `content_version: 1`). See `CONTEXT.md` for the source.
- Copy and adapt `references/` (topics, questionnaire, hint ladder, review rubric, problem spec): tools instead of scripts, language-aware wording.
- `tutor-cli validate-content`: every problem validates and its reference passes every test in `wasi-python`. Add it to CI.
- Set `time_limit_ms` per problem with T07's rule (`tutor-cli measure-limits`).

**Acceptance.**
- [ ] 50 problems under `content/problems/<topic>/<slug>/`, all valid.
- [ ] `validate-content` passes locally and in CI.
- [ ] Any type that did not map cleanly is listed in the notes with how it was resolved.

**Notes.**

### T05 — SQLite storage and settings

- Milestone: v1
- Size: 2d
- Depends on: T01
- Spec: §4.1, §4.2, §4.3
- Owns: `crates/tutor-store/`, `crates/tutor-core/src/storage.rs` (trait)

**Goal.** Durable local state with safe upgrades.

**Scope.**
- Data dir resolution (passed in by the shell; `ALGOTUTOR_DATA_DIR` override).
- rusqlite (`bundled`); embedded numbered migrations with `PRAGMA user_version`, transaction per migration, backup before migrating, refuse newer databases.
- Schema per §4.2.
- A `Storage` trait in `tutor-core` and its SQLite implementation; one async write mutex.
- `settings.json` load/save with serde defaults, unknown keys kept, invalid values reported; change notifications.
- An in-memory `Storage` for core tests.

**Acceptance.**
- [ ] Tests: fresh database, migrate with a sample second migration, refuse a newer database, backup file created.
- [ ] Tests: invalid `settings.json` values fall back to defaults and are reported; unknown keys survive a save.

**Notes.**

### T06 — Port the core teaching logic

- Milestone: v1
- Size: 4d
- Depends on: T03, T05
- Spec: §9, §7.1
- Owns: `crates/tutor-core/src/teaching/`, `crates/tutor-core/src/tools/`

**Goal.** The recommender, levels, hints and attempt recording, and the tutor
tool handlers, in Rust.

**Scope.**
- Port from `dsa-tutor/dsa_tutor/core/state.py`, `catalog.py`, `common.py`, `problems.py` and the topics-table parsing: status, next (topic/difficulty), start, hint, record (outcome from hints/explanation), profile, focus, attempts.
- Tool definitions (name, description, JSON schema) and handlers for §7.1, using the `Storage`, `Executor` and catalog traits. Port descriptions from `dsa-tutor/dsa_tutor/tools/`.
- Behaviour must match `dsa-tutor`: port its tests (`tests/test_scripts.py`, `tests/test_tools.py`) as the spec.

**Acceptance.**
- [ ] Ported tests pass with the in-memory storage and a fake executor.
- [ ] `record_attempt` runs the tests itself (no pass counts from the caller).
- [ ] `get_problem` never returns hidden tests (test).

**Notes.**

### T07 — Executor trait and WASI Python sandbox

- Milestone: v1
- Size: 4d
- Depends on: T03
- Spec: §6.1, §6.2, §6.3, §10
- Owns: `crates/tutor-core/src/exec/` (trait, report, redaction), `crates/tutor-exec/`, `content/runners/python/`, `content/runtime/python/`

**Goal.** Run Python solutions against tests, safely, with limits, on every OS
and headless.

**Scope.**
- First resolve the §14 VERIFY items for the CPython WASI build (source, version, licence, size, stdlib) and record them in `DECISIONS.md`. Add a script that fetches and checksums the runtime into `content/runtime/python/` (or vendor it, if the size is acceptable); note the choice.
- `Executor` trait, `RunReport`, comparison into `TestReport`, and redaction in `tutor-core`.
- `wasi-python` executor with wasmtime: fresh store per job, read-only stdlib preopen only, no network, empty env, `StoreLimits` memory cap, epoch-interruption deadline, captured output with caps, module cache, bounded concurrency.
- Port `dsa-tutor/runners/python/harness.py` (TreeNode/ListNode builders, per-test timing and exception capture, JSON lines out).
- `tutor-cli measure-limits`: run every `dsa-tutor` reference, record times; settle the time-limit DECISION in `DECISIONS.md`. Resolve the recursion-depth VERIFY.

**Acceptance.**
- [ ] Tests: pass, fail, runtime error, syntax error, infinite loop (deadline stops it; the next job works), memory blow-up (capped), huge output (truncated).
- [ ] Tests: `open('/etc/passwd')`, `os.listdir('/')` beyond the stdlib, `socket.socket()`, `os.environ` contents are all blocked or empty.
- [ ] Redacted report contains no hidden input, expected or actual (test).
- [ ] Runs in CI on all three OSes.

**Notes.**

### T08 — Port the UI shell and practice flow

- Milestone: v1
- Size: 4d
- Depends on: T02, T06, T07
- Spec: §2, §8
- Owns: `apps/desktop/ui/src/`, `apps/desktop/src-tauri/src/commands/` (problems, attempts, runs, workspace), `apps/desktop/src-tauri/src/state.rs`

**Goal.** Practise without AI: browse, open, edit, run, submit, progress.

**Scope.**
- Wire app state in the shell: data dir, `tutor-store`, catalog (bundled `content/` + user problems), `wasi-python` executor.
- Port from `dsa-tutor/web/src`: app shell, router, Home, Problems, Practice (Panes, Editor, ResultsPanel, Markdown), Progress. Replace the HTTP client with the generated bindings.
- Commands for problems, attempts, run/submit, workspace files (save as you type; `notify` watcher reloads on external change).
- Light/dark themes; Run and Submit shortcuts.
- Chat pane present but showing "Tutor not configured" (filled by T10).
- Check it in all three web views (WebView2, WKWebView, WebKitGTK).

**Acceptance.**
- [ ] Manual smoke on at least Linux: next problem → edit → run shows visible results → submit records the attempt → progress updates. Notes say which OSes were tried.
- [ ] Editing the solution file in another editor updates the open editor.
- [ ] Ported UI tests pass (Vitest + Testing Library, with mocked bindings).

**Notes.**

### T09 — Onboarding and Settings

- Milestone: v1
- Size: 2d
- Depends on: T08
- Spec: §2, §4.3, §4.4, §4.5, §8
- Owns: `apps/desktop/ui/src/pages/Onboarding*`, `apps/desktop/ui/src/pages/settings/`, `apps/desktop/src-tauri/src/secrets.rs`, `apps/desktop/src-tauri/src/commands/settings.rs`, `apps/desktop/src-tauri/src/commands/data.rs`

**Goal.** Every user-facing setting editable in the app, applied without
restart; the API key in the OS keychain.

**Scope.**
- Onboarding questionnaire (port `ProfileForm`, `references/questionnaire.md`) and the optional "Connect the tutor" step.
- Settings sections per §8 (Updates is wired in T13; Code execution shows the Python runtime status in v1).
- Secrets with `keyring`; resolve the §14 VERIFY; file fallback with warning; `ANTHROPIC_API_KEY` from env shown read-only. Commands can set, test and delete the key, never return it.
- Export / import / reset per §4.5.

**Acceptance.**
- [ ] Changing model, effort or theme applies immediately (test or manual, noted).
- [ ] The key never appears in UI responses, logs, the database or `settings.json` (test stores a known fake key, then searches the data dir and command outputs).
- [ ] Export then import round-trips progress and workspace files (test).

**Notes.**

### T10 — Tutor: Anthropic backend and chat

- Milestone: v1
- Size: 6d
- Depends on: T06, T08
- Spec: §7
- Owns: `crates/tutor-core/src/tutor/` (prompt, turn types), `crates/tutor-ai/`, `apps/desktop/src-tauri/src/commands/chat.rs`, `apps/desktop/ui/src/chat/`, `apps/desktop/ui/src/explanation/`

**Goal.** A working tutor: chat, hint, review, explain, through the tools.

**Scope.**
- `TutorBackend` trait, `ChatEvent`, turn runner with cancel, threads in SQLite, reset chat.
- System prompt builder from the ported teaching rules and references (§7.2).
- Resolve the §14 VERIFY items (Rust SDK or own client; API notes) and the default-model DECISION from current docs; record in `DECISIONS.md`.
- `anthropic` backend: streaming SSE client on `reqwest`, tool loop, raw-JSON content-block replay, cache breakpoint, error mapping with retry-after.
- `fake` backend with scripted scenarios (port the `dsa-tutor` chat fixtures' scenarios).
- Chat UI port (ChatPane, MessageView, effects), Hint/Review/Explain buttons, explanations viewer (sandboxed iframe, versions).
- `tutor-cli smoke-ai` (manual, one real hint turn).

**Acceptance.**
- [ ] Fake-backend tests: explain, hint (one level per press), review, run-tests tool, refusal, rate limit, auth error, cancel.
- [ ] HTTP-level tests of the Anthropic client against a local mock server (SSE parsing, tool loop, error mapping); no real calls.
- [ ] Hidden test data never appears in any request body built for the API (test inspects built requests).
- [ ] With a real key (manual), a hint turn works; notes say whether it was run.

**Notes.**

### T11 — Tutor: Claude Code backend

- Milestone: v1
- Size: 3d
- Depends on: T10
- Spec: §7.3
- Owns: `crates/tutor-ai/src/claude_code/`, `crates/tutor-ai/src/mcp/`

**Goal.** Use the user's installed Claude Code as the tutor backend when it is
found.

**Scope.**
- First resolve the §14 VERIFY: current CLI flags, the `rmcp` API, and what current terms allow regarding a user's own login. Record findings in `DECISIONS.md`; if a subscription login is not appropriate, support only API-key use.
- Detection (path, version, signed-in), status in Settings.
- Loopback MCP server exposing the tutor tools with a per-turn token; spawn with built-in tools disabled and only tutor tools allowed (port `dsa-tutor/dsa_tutor/backends/claude_code.py` and `server/mcp.py`).

**Acceptance.**
- [ ] Test: the spawned command leaves no built-in tool enabled.
- [ ] Test against recorded stream-json fixtures (port `tests/fixtures/claude_code/`).
- [ ] MCP token rejected after the turn ends (test).

**Notes.**

### T12 — New problems: generate, paste, import

- Milestone: v1
- Size: 3d
- Depends on: T07, T10
- Spec: §5.3, §6.3
- Owns: `crates/tutor-core/src/intake/`, `crates/tutor-ai/src/intake/`, `apps/desktop/src-tauri/src/commands/intake.rs`, `apps/desktop/ui/src/intake/`, `content/open-sets/`

**Goal.** Make new problems with the self-check, as in `dsa-tutor`.

**Scope.**
- Intake jobs (generate, paste, import) streamed over a `Channel`; self-check in `wasi-python`, up to 4 attempts with failures fed back.
- Exercism open set: port the pinned index and fetcher (backend, `raw.githubusercontent.com` only), licence and `NOTICE.md`.
- New Problem dialog and Import panel (port from `dsa-tutor/web/src/intake/`).

**Acceptance.**
- [ ] Fake-backend tests: generate, paste, import, self-check failure, not-a-problem, refused import (port the intake fixtures).
- [ ] Model-written code runs only in `wasi-python` (test asserts which executor ran).

**Notes.**

### T13 — Packaging, auto-update and release workflow

- Milestone: v1
- Size: 3d
- Depends on: T08
- Spec: §11
- Owns: `apps/desktop/src-tauri/tauri.conf.json` (bundle, updater), `apps/desktop/src-tauri/icons/`, `apps/desktop/src-tauri/src/updater.rs`, `.github/workflows/release.yml`

**Goal.** Installers for all three OSes that update themselves.

**Scope.**
- Bundle targets per §11; bundle `content/` (problems, references, runners, Python runtime) as resources.
- `tauri-plugin-updater` with `latest.json` on GitHub Releases, stable/beta endpoints, updater key pair (document where the private key lives as a CI secret; never commit it), Settings → Updates wired.
- Release workflow with `tauri-action` on `v*` tags; signing steps run only when OS signing secrets exist. Resolve the §14 VERIFY items for Linux runtime deps and unsigned macOS updates; record the signing DECISION status.

**Acceptance.**
- [ ] A tagged test release produces installers that install and launch (notes say which OSes were actually tried).
- [ ] An older build updates to a newer test release on at least one OS (say which).
- [ ] The bundled app runs Python (the runtime resource is found) on each OS tried.

**Notes.**

### T14 — README, end-to-end test, v1 release check

- Milestone: v1
- Size: 2d
- Depends on: T04, T09, T10, T11, T12, T13
- Spec: §13
- Owns: `README.md`, `e2e/`, `CHANGELOG.md`

**Goal.** v1 ready to hand to someone else.

**Scope.**
- README: install per OS (including first-launch steps for unsigned builds), first run, connecting the tutor, data and backups, privacy (what the tutor sees), troubleshooting.
- `tauri-driver` e2e with the fake tutor (flow in §13) in Linux CI; resolve the §14 VERIFY.
- Go through every SPEC §14 item and confirm it is resolved or explicitly deferred.

**Acceptance.**
- [ ] e2e passes in CI.
- [ ] README followed from scratch on one OS (or a clean VM) without help; notes say which.

**Notes.**

---

## v2: Rust, Go and container runtimes

### T15 — Rust and Go harness generators

- Milestone: v2
- Size: 5d
- Depends on: T04
- Spec: §5.2, §6.4
- Owns: `crates/tutor-core/src/langs/rust/`, `crates/tutor-core/src/langs/go/`, `content/runners/rust/`, `content/runners/go/`

**Goal.** From a neutral signature, generate the stub and the harness for Rust
and Go.

**Scope.**
- Finalise the type mapping (resolve the Rust `int` DECISION); `TreeNode` / `ListNode` adapters per language; JSON via `serde_json` (vendored for offline builds) and `encoding/json`.
- Stub generator (idiomatic names); harness `main` reading tests on stdin, writing one JSON result line per test with timing.
- Mark which problems each language supports (all types supported → add to `languages`).

**Acceptance.**
- [ ] Golden-file tests for stubs and harnesses across all neutral types.
- [ ] Hand-written Rust and Go solutions for 5 problems (tree, linked list, map, tuple, float) pass when compiled locally (CI job with toolchains).

**Notes.**

### T16 — Local toolchain executor

- Milestone: v2
- Size: 2d
- Depends on: T15
- Spec: §6.4, §6.5
- Owns: `crates/tutor-exec/src/local/`, `crates/tutor-exec/src/detect/` (toolchains)

**Goal.** Run Rust and Go solutions with the user's `cargo` and `go`.

**Scope.**
- Detection of `cargo` / `go` (path, version).
- Cached project per problem; compile errors reported as `Compile`; timeout kills the process group (Windows: job object).
- Language picker in the practice view for problems that support it; a workspace file per language.

**Acceptance.**
- [ ] Tests (CI with toolchains): pass, fail, compile error, timeout, incremental rerun.
- [ ] Works on Linux, macOS and Windows CI.

**Notes.**

### T17 — Container executor (Docker and Podman)

- Milestone: v2
- Size: 3d
- Depends on: T15
- Spec: §6.5, §10
- Owns: `crates/tutor-exec/src/container/`, `crates/tutor-exec/src/detect/` (runtimes)

**Goal.** Run Rust and Go in a detected container runtime, hardened.

**Scope.**
- Runtime detection per §6.5 (states, versions, `DOCKER_HOST`, contexts).
- Image pull with progress over a `Channel`; run flags per §6.5; record the Rust target-dir decision.
- Fallback to local with a notice when the runtime disappears.

**Acceptance.**
- [ ] Tests with a fake runtime binary for each detection state and the exact run flags.
- [ ] Real run on Linux CI with Docker: pass, timeout, and no network (a solution that tries to connect fails).

**Notes.**

### T18 — Settings → Code execution panel

- Milestone: v2
- Size: 2d
- Depends on: T16, T17
- Spec: §6.5, §8
- Owns: `apps/desktop/ui/src/pages/settings/CodeExecution*`, `apps/desktop/src-tauri/src/commands/execution.rs`

**Goal.** Detect and choose, never install.

**Scope.**
- Runtime choice (`local` / `podman` / `docker`), detected list with states, Recheck, start-command hint for stopped runtimes, **How to install →** links to README anchors, Pull/Update image, Test sandbox.

**Acceptance.**
- [ ] UI tests for each detection state.
- [ ] Only running runtimes are selectable.

**Notes.**

### T19 — Runner image in CI

- Milestone: v2
- Size: 2d
- Depends on: T13, T15
- Spec: §6.5, §11
- Owns: `runner-image/`, `.github/workflows/runner-image.yml`

**Goal.** `ghcr.io/hqazi/algorithm-tutor-runner:<version>` with Rust and Go,
multi-arch, published on release tags.

**Scope.**
- Minimal image, non-root user, toolchains pinned, `serde_json` pre-fetched for offline builds.
- Published with the app release; version tied to the app.

**Acceptance.**
- [ ] amd64 and arm64 images built in CI; hello-world per language passes inside each.

**Notes.**

### T20 — README: optional container sandbox and toolchains

- Milestone: v2
- Size: 1d
- Depends on: T18
- Spec: §6.5
- Owns: `README.md` (sections "Optional: a container sandbox", "Installing Rust and Go")

**Goal.** Clear install instructions the Settings links point to.

**Scope.**
- Finalise the draft sections already in the README (Podman recommended; Docker Desktop/Engine with the licence note; Colima, OrbStack; rustup and Go).
- Stable anchors matching the Settings links.

**Acceptance.**
- [ ] Every Settings link resolves to a heading in the README (test).

**Notes.**

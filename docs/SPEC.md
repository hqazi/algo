# Algorithm Tutor: specification

Status: draft 2 (2026-11-18), Tauri edition. Tickets that implement it are in
[`TASKS.md`](TASKS.md); the reasoning behind the main choices is in
[`DECISIONS.md`](DECISIONS.md); what is carried over from the first attempt
(`hqazi/dsa-tutor`) is in [`CONTEXT.md`](CONTEXT.md).

Words in **bold caps** mark open items: **VERIFY** (check against current
documentation before relying on it) and **DECISION** (the owner decides; the
default given applies until then). Section 14 lists them all.

## 1. What we are building

A desktop app for practising data structures and algorithms with an AI tutor.
The problem, a code editor, a test runner and a tutor chat sit side by side. It
recommends what to practise next, runs the user's code against real tests,
gives hints one level at a time, reviews solutions and writes explanations.

It is the second version of `dsa-tutor`. The teaching model, the curated
problems and most of the UI carry over. What changes is how it is installed,
configured, updated and how code is run: `dsa-tutor` needed Docker Compose, a
local image build and about twenty environment variables; this app is one
installer, configured from its own Settings screen, that updates itself.

### Goals

1. **Install in one step.** An installer per OS. No terminal, Docker, Python
   or Node needed to practise in Python.
2. **Configure in the app.** Every user-facing setting is on the Settings
   screen and applies without a restart. The API key is entered there and kept
   in the OS keychain.
3. **Update itself.** New versions arrive from GitHub Releases. User data is
   never touched by an update except through explicit database migrations.
4. **Honest feedback.** Pass or fail comes from running the tests, never from
   the model.
5. **Safe by default.** Python, both the user's and any code the model
   writes, runs in a WebAssembly sandbox inside the app (section 6.2).
6. **Works without AI.** Browsing, editing, running, submitting and progress
   need no credentials. The tutor chat and new problems do.
7. **More languages later without redoing problems.** The problem format is
   language-neutral from v1; v2 adds Rust and Go.

### Non-goals (v1)

- Languages other than Python (v2: Rust, Go; section 6.4).
- Installing anything on the user's machine (Docker, toolchains). The app only
  detects what is installed (section 6.5).
- Accounts, sync, a hosted service, multiple users per install.
- A coding-agent skill mode. `dsa-tutor` had one; it may come back later as a
  separate front end on top of `tutor-core`.
- Fetching problems from sites whose terms forbid it. No "fetch by URL".

## 2. Users and main flows

One person, on their own computer.

1. **First run.** Welcome screen → five onboarding questions (or "use
   defaults") → optional "Connect the tutor" step (paste an API key, or use
   Claude Code if it is found) → home.
2. **Practise.** "Next problem" picks one (section 9.2) and opens the practice
   view: statement, editor, results, tutor chat. Run (visible tests), Submit
   (all tests; hidden ones report a category only), Hint, Review, Explain.
3. **New problem.** Generate (topic, difficulty, idea), Paste (a statement the
   user has) or Import (from an openly licensed set). Every new problem passes
   the self-check (section 6.3) before it appears.
4. **Progress.** Level per topic, recent attempts.
5. **Settings.** Tutor (backend, key, model, effort), code execution
   (section 6.5), profile and focus, data (folder, export, import, reset),
   updates, about.

## 3. Architecture

```
┌──────────────────────────── Tauri app (one process) ────────────────────────┐
│                                                                             │
│  Web view (the OS's own)              Rust backend                          │
│  React, CodeMirror 6       typed      ├─ tutor-core   problems, neutral     │
│  no fs, no shell, no net ─ commands ─▶│               types, compare,       │
│  only this app's commands  + events   │               teaching, tools,      │
│                            (channels) │               prompt; traits only   │
│                                       ├─ tutor-store  SQLite, settings.json,│
│                                       │               workspace files       │
│                                       ├─ secrets      OS keychain (keyring) │
│                                       ├─ tutor-ai     Anthropic HTTP client,│
│                                       │               Claude Code + MCP     │
│                                       ├─ tutor-exec   wasmtime + CPython    │
│                                       │               (WASI); v2: local     │
│                                       │               toolchain, container  │
│                                       └─ updater      tauri-plugin-updater  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Layout

A Cargo workspace plus one npm package for the UI.

| Path | What | May depend on |
|---|---|---|
| `crates/tutor-core` | Pure logic: problem schema and validation, neutral types (5.2), test comparison, recommender and levels, hint ladder, tool definitions and handlers, system prompt builder, the `Storage`, `Executor`, `Clock` and `TutorBackend` traits, redaction. | serde, serde_json, thiserror and similar pure crates. **No Tauri, no I/O** (no files, network, processes, clocks except through traits). |
| `crates/tutor-store` | SQLite storage, migrations, `settings.json`, workspace files, export/import. | `tutor-core`, rusqlite (bundled), zip. |
| `crates/tutor-exec` | Executors: `wasi-python` (v1); `local` and `container` (v2). Language harnesses. | `tutor-core`, wasmtime, wasmtime-wasi. |
| `crates/tutor-ai` | Tutor backends: `anthropic` (HTTP), `claude-code` (CLI + MCP), `fake`. Turn runner. | `tutor-core`, reqwest (rustls), tokio, rmcp. |
| `crates/tutor-cli` | Developer tool, not shipped: `validate-content`, `convert-dsa-tutor`, `smoke-ai`, `measure-limits`. | all crates above. |
| `apps/desktop/src-tauri` | The Tauri shell: windows, commands, events, capabilities, secrets, updater, app state wiring. Thin. | all crates above, Tauri plugins. |
| `apps/desktop/ui` | The UI (ported from `dsa-tutor/web`), Vite + React + TypeScript. Calls only generated, typed command bindings. | React, CodeMirror, generated bindings. |
| `content/` | Curated problems, `references/*.md`, runner harnesses, the CPython WASI runtime. Bundled read-only as Tauri resources. | — |

The core/shell split is deliberate: tutor logic must not depend on Tauri, so
another front end (a CLI, an agent skill, a different shell) is a new shell,
not a rewrite. Keeping `tutor-core` free of I/O also makes it fast to test.

### 3.2 Tooling

Rust stable pinned in `rust-toolchain.toml`; Tauri 2; `tauri-specta` (or
equivalent) generates TypeScript bindings for commands and events from Rust
types, so the UI and backend cannot drift (**VERIFY** the current
Tauri 2-compatible option in T02). UI: Node 22 for development only, Vite,
React, CodeMirror 6, Vitest, ESLint. Rust: rustfmt, clippy (`-D warnings`),
`cargo test`. Exact versions are chosen in T01 and recorded in
`DECISIONS.md`. Users never need Rust or Node.

## 4. Data and settings

### 4.1 Where things live

Everything the user produces is under the per-user app data folder (Tauri's
`app_data_dir()`; overridable with `ALGOTUTOR_DATA_DIR` for tests and
development):

```
tutor.db                    SQLite: profile, progress, attempts, hints, chats, problem index
settings.json               preferences (4.3), human-readable
workspace/<slug>/solution.<ext>   the user's code, plain files
problems/generated/<slug>/  problems the tutor made
problems/imported/<slug>/   pasted and imported problems (+ origin.md / NOTICE.md)
explanations/<slug>/        explanation pages, one file per version
cache/                      compiled WASM module cache, open-set downloads, v2 build caches
logs/                       app log (no credentials, no chat bodies)
```

Curated problems live inside the app bundle (`content/`) and are replaced
wholesale by updates. User data refers to problems by slug only.

Solutions are plain files so the user can open them in their own editor. The
app watches the open problem's file (`notify` crate) and reloads it when it
changes on disk.

### 4.2 Database (`tutor.db`)

rusqlite with the `bundled` feature. Numbered SQL migrations embedded in
`tutor-store`, tracked with `PRAGMA user_version`, each in a transaction; a
backup copy `tutor.db.bak-<version>` (SQLite backup API) is made before any
migration. The app refuses to open a database newer than it knows.

| Table | Columns (main) |
|---|---|
| `meta` | `key`, `value` (install id, created) |
| `profile` | single row: goal, experience, group comfort (JSON), focus topic, language, onboarded |
| `topic_progress` | `topic`, `level` (`new` / `learning` / `comfortable`), `unaided_solves`, `updated_at` |
| `problems` | `slug`, `source` (`curated` / `generated` / `pasted` / `imported`), `topic`, `difficulty`, `title`, `path`, `content_version`, `created_at` |
| `attempts` | `id`, `slug`, `language`, `started_at`, `finished_at`, `passed`, `total`, `outcome` (`unaided` / `with_hints` / `gave_up` / open), `hints_used`, `explained`, `notes` |
| `hints` | `attempt_id`, `level`, `given_at` |
| `threads` | `id` (`home` or a slug), `backend`, `backend_state` (JSON), `created_at`, `archived_at` |
| `messages` | `thread_id`, `seq`, `role`, `content` (JSON: text and tool events), `created_at` |
| `test_runs` | `attempt_id`, `kind` (`run` / `submit`), `report` (JSON, already redacted per 6.1), `created_at` |

All writes go through `tutor-store` behind one async mutex, so tool calls from
a chat turn and UI actions cannot interleave writes (as in `dsa-tutor`).

### 4.3 Settings (`settings.json`)

A serde struct with defaults; unknown keys are kept, invalid values fall back
to defaults with a notice shown in Settings. Changes apply immediately (no
restart) and are broadcast to the UI as an event.

| Key | Default | Notes |
|---|---|---|
| `tutor.backend` | `auto` | `auto` / `anthropic` / `claude-code` / `none`. `auto`: Anthropic if a key is stored, else Claude Code if found, else none. |
| `tutor.model` | (T10) | **DECISION**: default model, chosen in T10 from the current models list. |
| `tutor.effort` | `medium` | |
| `execution.runtime` | `local` | v2: `local` / `podman` / `docker` for Rust and Go. Python always uses `wasi-python`. |
| `execution.timeScale` | `1.0` | Multiplier on per-test time limits (slow machines). |
| `editor.fontSize`, `editor.keymap` | `14`, `default` | `default` / `vim` / `emacs`. |
| `ui.theme` | `system` | `system` / `light` / `dark`. |
| `updates.channel` | `stable` | `stable` / `beta`. |
| `updates.auto` | `true` | Check on start and daily; download in background; install on restart. |

Secrets are never in `settings.json` (4.4).

### 4.4 Secrets

The Anthropic API key is stored with the `keyring` crate (macOS Keychain,
Windows Credential Manager, Linux Secret Service). On Linux without a Secret
Service provider, fall back to a file readable only by the user
(`secrets.json`, mode 0600) and show a warning in Settings. **VERIFY** the
crate's current platform support and how it reports a missing provider.

`ANTHROPIC_API_KEY` in the environment, if set, is used and shown in Settings
as "from environment" (read-only). The key never reaches the web view, logs,
the database, `settings.json` or code under test; Settings shows only
"stored, ends in …abcd". The UI can set, test and delete the key, never read
it.

### 4.5 Export, import, reset

- **Export** writes a zip: `tutor.db` (via the SQLite backup API),
  `settings.json`, `workspace/`, `problems/generated/`, `problems/imported/`,
  `explanations/`. Never secrets.
- **Import** validates the zip, exports the current data first, replaces it,
  and reloads the app state.
- **Reset progress** and **Reset everything**, with a confirm dialog and an
  automatic export first.

## 5. Problems

### 5.1 Format (v2 of the `dsa-tutor` format)

```
<problem>/
  problem.md        statement (Markdown), examples generated from visible tests
  meta.json         below
  tests.json        unchanged from dsa-tutor except schema_version 2
  reference.py      optimal reference solution (Python, always)
  brute_force.py    optional; used by the self-check and to compute expected
```

`meta.json`:

```json
{
  "schema_version": 2,
  "slug": "level-lists",
  "title": "Level by Level",
  "topic": "trees",
  "difficulty": "medium",
  "source": "curated",
  "content_version": 1,
  "expected_complexity": { "time": "O(n)", "space": "O(n)" },
  "compare": { "mode": "exact" },
  "time_limit_ms": 2000,
  "signature": {
    "function": "levels",
    "params": [{ "name": "root", "type": "tree<int>" }],
    "returns": "list<list<int>>"
  },
  "languages": ["python"]
}
```

`function` and `params[].name` are snake_case; each language harness converts
to its own convention. `languages` lists the languages the problem is offered
in; a problem can be offered in any language whose harness supports every type
in its signature. A JSON Schema for both files is generated from the Rust
types (`schemars`) into `content/schema/`.

`tests.json` keeps the `dsa-tutor` shape: `{ "schema_version": 2, "tests": [
{ "id", "visibility": "visible" | "hidden", "category", "input": { name: value },
"expected", "explanation"? } ] }`. At least 2 visible and 3 hidden tests;
hidden tests need a meaningful `category`.

Compare modes are unchanged: `exact`, `unordered`, `unordered_deep`, `float`
(+ `tolerance`).

### 5.2 Neutral types

| Type | JSON form | Python | Rust (v2) | Go (v2) |
|---|---|---|---|---|
| `int` | number (integer, 64-bit range) | `int` | `i64` | `int` |
| `float` | number | `float` | `f64` | `float64` |
| `bool` | boolean | `bool` | `bool` | `bool` |
| `string` | string | `str` | `String` | `string` |
| `char` | 1-char string | `str` | `char` | `rune` |
| `list<T>` | array | `list[T]` | `Vec<T>` | `[]T` |
| `tuple<A,B,…>` | array of fixed length | `tuple[A, B]` | `(A, B)` | struct per harness |
| `map<string,T>` / `map<int,T>` | object (int keys as strings) | `dict` | `HashMap` | `map` |
| `optional<T>` | value or `null` | `T \| None` | `Option<T>` | pointer or `ok` pair |
| `tree<T>` | level-order array with `null` gaps | `TreeNode \| None` | `Option<Rc<RefCell<TreeNode>>>` | `*TreeNode` |
| `linked_list<T>` | array | `ListNode \| None` | `Option<Box<ListNode>>` | `*ListNode` |

Graphs are expressed with existing types (`list<list<int>>` adjacency lists or
edge lists, `list<string>` grids). The Rust and Go columns are indicative; T15
finalises them. **DECISION**: whether `int` is `i64` or `i32` in Rust (default
`i64`).

`tutor-core` validates every test input and expected value against the
signature, so a problem that validates is runnable by every harness that
supports its types.

### 5.3 Sources

| Source | Input | Licensing |
|---|---|---|
| Curated | ships with the app (50 problems across 15 topics, from `dsa-tutor`) | Original, Apache 2.0. |
| Generated | topic, difficulty, optional idea | Written fresh by the model in original wording. |
| Pasted | text of a problem statement the user has | Personal practice only; stays in the data folder, sent only to the configured AI provider. Treated as untrusted data in prompts. |
| Imported | a pick from an openly licensed set | v1: Exercism problem-specifications (MIT), pinned commit, as in `dsa-tutor`. Fetched by the backend from `raw.githubusercontent.com` only. Licence and attribution shown under the title and kept in `NOTICE.md`. |

## 6. Code execution

### 6.1 Executor trait

```rust
#[async_trait]
pub trait Executor: Send + Sync {
    fn id(&self) -> ExecutorId;                       // WasiPython | Local | Container
    async fn status(&self) -> ExecutorStatus;         // available, reason, versions
    async fn run(&self, job: RunJob, cancel: CancellationToken) -> RunReport;
}

pub struct RunJob {
    pub language: Language,          // Python in v1
    pub code: String,                // the solution source
    pub signature: Signature,
    pub tests: Vec<TestCase>,        // inputs (expected values stay in core)
    pub time_limit_ms: u64,          // per test, after timeScale
    pub memory_limit_mb: u64,
}

pub struct RunReport {
    pub ok: bool,                    // the harness ran (not: all passed)
    pub error: Option<RunError>,     // Compile | Harness | RuntimeMissing | Cancelled | Limit
    pub results: Vec<RawResult>,     // per test: id, actual (JSON) or error, stdout, time_ms, timed_out
    pub duration_ms: u64,
}
```

Executors never see expected values: they return `actual` per test and
`tutor-core` compares, so every language grades the same way. Core then builds
a `TestReport` (`pass` / `fail` / `error` / `timeout` per test) and
**redacts** it before it leaves the backend: hidden tests keep only `id`,
`category`, `status`, `time_ms`. The web view and the tutor only ever see
redacted reports. Hidden inputs and expected values never leave the backend.

### 6.2 Python: CPython on WASI in wasmtime

- The executor embeds **wasmtime** and runs a **CPython build for WASI**
  (`wasm32-wasip1`), shipped in `content/runtime/python/` with a trimmed
  standard library. **VERIFY** in T07: the source of an official or
  well-maintained CPython WASI build, its version, licence, size, and that
  `collections`, `heapq`, `bisect`, `functools`, `itertools`, `math` and
  `json` work.
- Each job gets a fresh `Store` and instance. WASI context: **no preopened
  directories except the standard library, read-only**; no sockets; an empty
  environment; argv fixed; stdin carries the job (harness, solution, test
  inputs as JSON); stdout and stderr captured in memory with a size cap.
- Limits: memory with `StoreLimits` (default 512 MB); time with epoch
  interruption (a timer thread bumps the epoch; the deadline is the sum of
  per-test limits plus start-up); a bounded wasm stack and a Python recursion
  limit high enough for tree and backtracking problems (**VERIFY** recursion
  depth for the deepest curated problems in T07).
- The harness (`content/runners/python/harness.py`, ported) builds `TreeNode`
  / `ListNode` from JSON, calls the function per test, measures each test with
  `time.perf_counter`, catches exceptions per test, and writes one JSON line
  per test. If the hard deadline hits, the remaining tests are `timeout`.
- The compiled module is cached (`Module::serialize` into `cache/`, keyed by
  wasmtime and runtime versions) so start-up after the first run is fast.
- Runs on a blocking thread pool, at most N jobs at once (default 2).
- Time limits: WASI CPython is slower than native. **DECISION** (T07
  measures): default per-test limit `max(2000 ms, 3 × the slowest reference
  run)`, stored per problem as `time_limit_ms`, times `execution.timeScale`.

This works the same on every OS, needs no window, and runs headless in CI
(`tutor-cli validate-content`).

### 6.3 Self-check

A new problem is accepted only if, in `wasi-python`: the spec validates (5.1,
5.2); `brute_force.py` (if given) computes or agrees with every expected
value; `reference.py` passes every test within the limit. At most 4 attempts
with the failures fed back to the model, then the job fails with the reason.
Same rules as `dsa-tutor/references/problem_spec.md`.

Model-written code (references, brute forces) runs **only** in `wasi-python`,
never in the local toolchain or a container, in every version.

### 6.4 Rust and Go (v2)

- Each language has a harness generator in `tutor-core` that, from the
  signature, writes: the stub the user sees, and a `main` that reads tests from
  stdin as JSON, converts with the type adapters, calls the function, and
  writes one JSON result line per test.
- **Local executor:** uses `cargo` / `go` on `PATH`. One cached project per
  problem under `cache/build/<lang>/<slug>/` so reruns compile incrementally.
  Process per run, killed with its process group (Windows: a job object) on
  timeout. No sandbox: the user's own code, with the user's own rights.
  Settings says so plainly.
- **Container executor:** runs the same harness in the runner image (6.5).

### 6.5 Container runtimes (v2): detect and choose, never install

- Detection (on start, when Settings opens, and on **Recheck**):
  `podman info --format json`, `docker version --format json`, honouring
  `DOCKER_HOST` and the current Docker context; `cargo --version`,
  `go version`. Result per runtime: `not-found` / `installed-not-running` /
  `running` (+ version).
- Settings → Code execution shows the runtime choice for Rust/Go
  (`local` / `podman` / `docker`); only detected and running runtimes are
  selectable. Not found: a **How to install →** link to the README section.
  Installed but stopped: the command to start it (e.g. `podman machine start`).
- The app never installs or starts anything. The only commands it runs are
  detection, `pull` of the runner image, and job runs.
- If the selected runtime disappears, fall back to `local` with a notice.
- **Runner image** `ghcr.io/hqazi/algorithm-tutor-runner:<app version>`, built
  and published by CI with Rust and Go toolchains. **Pull / Update** and
  **Test sandbox** buttons (hello-world per language).
- Each run: `--rm --network none --read-only --cap-drop ALL
  --security-opt no-new-privileges --user 65534:65534 --pids-limit 128
  --memory <limit> --cpus 1 --tmpfs /tmp:rw,noexec,size=64m`, the job folder
  mounted read-only, results on stdout. Rust builds need a writable target
  directory: a per-job tmpfs or a cache volume owned by the runner user
  (decided in T17).

## 7. Tutor

### 7.1 Tools

Ported from `dsa-tutor` SPEC 5.1; definitions and handlers live in
`tutor-core` and call the injected storage and executors.

| Tool | Does | Notes |
|---|---|---|
| `get_status` | profile, levels, open attempts | |
| `next_problem(topic?, difficulty?)` | recommender (9.2) | returns `solve` + slug, or `generate` |
| `start_problem(slug, language?)` | opens an attempt, scaffolds the workspace | UI event `open_problem` |
| `get_problem(slug)` | statement and public meta | never hidden tests |
| `read_solution(slug)` | the workspace file | |
| `run_tests(slug, only?)` | executor + core compare, redacted | UI event `show_results` |
| `take_hint(slug)` | records a hint, returns the level to give | ladder 1–4 |
| `record_attempt(slug, gave_up?, notes?)` | runs the tests itself, then records | the model cannot supply pass counts |
| `read_reference(slug)` | `reference.py` | for review/explanation; prompt forbids quoting it before the attempt is recorded |
| `create_problem(spec, origin?)` | validate + self-check + save | returns self-check result |
| `render_explanation(content)` | writes an explanation version | UI event `open_explanation` |
| `get_profile` / `set_profile` / `set_focus` | | |
| `list_attempts(slug?, last?)` | | |

Deliberately absent: writing the solution file, reading hidden test data,
shell, file access, network access.

### 7.2 System prompt

Built from the teaching rules (ported from `dsa-tutor/SKILL.md`, rewritten for
tools instead of scripts) and `content/references/*.md`. Stable text first so
prompt caching works; per-turn context (problem, current code, last redacted
report, language) goes with the user message. Pasted and imported text is
delimited untrusted data.

### 7.3 Backend trait

```rust
#[async_trait]
pub trait TutorBackend: Send + Sync {
    fn id(&self) -> BackendId;                         // Anthropic | ClaudeCode | Fake
    async fn status(&self) -> BackendStatus;           // available, reason, model
    fn run_turn(&self, turn: Turn, cancel: CancellationToken)
        -> BoxStream<'static, ChatEvent>;
}
```

`ChatEvent`: `TextDelta`, `ToolStart`, `ToolEnd`, `UiEvent`, `Error` (kind:
`auth` / `rate_limit` / `network` / `refusal` / `max_tokens` / `other`, with a
user-readable message), `Done`. Events reach the UI through a Tauri
`Channel` per turn; a `cancel_turn` command cancels it.

- **`anthropic`**: a small Messages API client in `tutor-ai` built on
  `reqwest` (rustls) with SSE streaming, client tools and the tool loop run in
  the backend. **VERIFY** in T10 whether an official Rust SDK exists by then;
  if it does and fits, use it. Response content blocks are kept as raw JSON
  (`serde_json::Value`) and replayed unchanged, so thinking and other blocks
  survive round trips. Port the `dsa-tutor` notes (stream every request, check
  `stop_reason`, handle `refusal` and `max_tokens`, cache breakpoint after
  system prompt and tools, map HTTP errors and `retry-after` to `Error`
  events). **VERIFY** each against the current API docs.
- **`claude-code`**: available when a `claude` executable is found on `PATH`
  (or a configured path) and reports being signed in. Spawned headless per
  turn with every built-in tool disabled and only the tutor tools allowed,
  through an MCP server the backend serves on loopback (`rmcp`, streamable
  HTTP) with a per-turn token (port the `dsa-tutor` 5.3/5.4 notes).
  **VERIFY** in T11: current CLI flags, the `rmcp` API, and that using a
  user's own Claude login this way is permitted by current terms. If it is
  not, ship T11 as "Claude Code with an API key" only.
- **`fake`**: scripted events for tests and UI work; not selectable in
  Settings (enabled with `ALGOTUTOR_FAKE_TUTOR=<script>`).

### 7.4 Threads

One thread per problem plus `home`, stored in `threads` / `messages`. "Reset
chat" archives the thread and starts a new one.

## 8. UI

Ported from `dsa-tutor/web` (React, CodeMirror 6). Pages: Welcome/onboarding,
Home, Problems (browse, filter by topic/difficulty/source), Practice
(statement | editor | results + chat, resizable panes), Progress,
Explanations (sandboxed iframe with `srcdoc`, version picker), Settings.

The UI calls the backend only through the generated bindings (3.2): commands
for requests, `Channel`s for streams (chat turns, intake jobs, image pulls),
and events for broadcasts (settings changed, file changed on disk, update
available).

The UI runs in the OS web view: WebView2 (Chromium) on Windows, WKWebView on
macOS, WebKitGTK on Linux. Test on all three; avoid Chromium-only APIs.

Settings sections: **Tutor** (backend, key entry with a test-connection
button, model, effort, status line), **Code execution** (6.5; v1 shows the
Python runtime status only), **Profile** (questionnaire answers, focus),
**Data** (open data folder, export, import, reset), **Updates** (version,
channel, check now, restart to update), **About** (licences, including
CPython, wasmtime and imported sets).

Keyboard: Run Ctrl/Cmd+Enter, Submit Ctrl/Cmd+Shift+Enter. Light and dark
themes.

## 9. Teaching model (unchanged from dsa-tutor)

### 9.1 Levels

Each topic is **new**, **learning** (something attempted) or **comfortable**
(3 different problems solved without hints). Topics, groups and prerequisites
are in `content/references/topics.md`.

### 9.2 What is next

Stay on the focus topic until comfortable, then the weakest topic whose
prerequisites are comfortable (a group rated `solid` in onboarding counts as
meeting prerequisites). Easy until 2 unaided solves in the topic, then medium.
Unattempted curated problems first; when a topic runs out, offer to generate.

### 9.3 Hints, reviews, explanations

Hint ladder (4 levels), review rubric (correctness from tests, complexity,
edge cases, readability) and explanation content are ported as-is from
`dsa-tutor/references/`, made language-aware (idioms of the attempt's
language).

## 10. Security

| Threat | Mitigation |
|---|---|
| Model-written code harms the machine | Runs only in `wasi-python`: no filesystem beyond a read-only stdlib, no network, no environment, memory and time limits (6.2). |
| User's Python code reads files or the network | Same sandbox. |
| User's Rust/Go code (v2) | Local executor: the user's own code with their own rights, stated in Settings. Container executor for isolation (6.5). |
| A wasmtime escape | Keep wasmtime current (Dependabot / `cargo update` in each release); only the user's and the model's code is run, never downloaded code. Optional later: run the executor in a child process of the app binary for crash and fault isolation. |
| Hidden test data leaks to the tutor or UI | Expected values never leave core; redaction before any report leaves the backend (6.1); `get_problem` never returns hidden tests. |
| API key leaks | Keychain via `keyring`, backend only, never logged, never sent to the web view or code under test (4.4). |
| Prompt injection via pasted/imported problems | Delimited untrusted data; the tutor has no tool that writes code, files or reaches the network. |
| Compromised web view | Tauri 2 capabilities grant the main window only this app's own commands; no `fs`, `shell` or `http` plugins exposed to the UI; strict CSP (`default-src 'self'`, no remote scripts, `connect-src ipc: http://ipc.localhost`); no remote content; `freezePrototype`; consider the isolation pattern (T02 decides). Every command validates its input in Rust. |
| Malicious update | `tauri-plugin-updater` verifies every update with the project's updater public key (separate from OS code signing); updates only from the project's GitHub Releases over HTTPS. |

## 11. Packaging and updates

- Tauri bundler targets: macOS `.app` + `.dmg` (Apple Silicon and Intel),
  Windows NSIS installer (and/or MSI), Linux AppImage + `.deb` (+ `.rpm`).
  WebView2 is bootstrapped by the Windows installer if missing.
- Linux builds need WebKitGTK 4.1 and friends on the build machine; the
  `.deb` declares them as dependencies; the AppImage bundles what it can.
  **VERIFY** the current dependency list in T01/T13.
- `tauri-plugin-updater` with a static `latest.json` on GitHub Releases;
  `stable` and `beta` channels (separate endpoints). Update artifacts are
  signed with the Tauri updater key (private key as a CI secret; public key in
  the app config). Download in background, "Restart to update".
- **DECISION**: OS code signing. Unsigned builds work but show Gatekeeper
  (macOS) and SmartScreen (Windows) warnings on first install. v1 can ship
  unsigned with instructions in the README; the release workflow takes signing
  secrets when they exist. **VERIFY** in T13 how updates behave for an
  unsigned macOS app.
- CI release workflow (`tauri-action`) on a version tag: build all targets,
  publish a draft release with `latest.json`. v2 adds the runner image to
  GHCR.

## 12. Configuration outside the UI

Only for development and tests: `ALGOTUTOR_DATA_DIR`, `ALGOTUTOR_FAKE_TUTOR`,
`ALGOTUTOR_LOG` (log filter), and `ANTHROPIC_API_KEY` (4.4). Nothing a normal
user needs.

## 13. Quality bar

- Rust: `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D
  warnings`, `cargo test --workspace`.
- UI: `npm run typecheck`, `npm run lint`, `npm test` (Vitest + Testing
  Library) in `apps/desktop/ui`.
- Content: `cargo run -p tutor-cli -- validate-content`: every curated problem
  validates and its reference passes in `wasi-python`. Runs headless in CI.
- One end-to-end test with the fake tutor using `tauri-driver` (WebDriver) on
  Linux CI: onboarding, next problem, edit, run, submit, hint, progress.
  (`tauri-driver` does not support macOS; **VERIFY** current support.)
- No test calls a real AI provider. A manual `cargo run -p tutor-cli --
  smoke-ai` makes one real call when `ANTHROPIC_API_KEY` is set.
- CI runs on Linux, macOS and Windows.
- Convenience: a root `justfile` or npm script `check` that runs all of the
  above that apply.

## 14. Open items

| Item | Where | Default until decided |
|---|---|---|
| **DECISION** default tutor model | 4.3, T10 | chosen in T10 from current models |
| **DECISION** time limits under WASI | 6.2, T07 | `max(2 s, 3 × slowest reference)` |
| **DECISION** Rust `int` width | 5.2, T15 | `i64` |
| **DECISION** OS code signing | 11, T13 | ship unsigned, document it |
| **VERIFY** typed bindings crate for Tauri 2 | 3.2, T02 | |
| **VERIFY** `keyring` platform support and missing-provider behaviour | 4.4, T09 | file fallback with warning |
| **VERIFY** CPython WASI build: source, version, licence, size, stdlib modules | 6.2, T07 | |
| **VERIFY** recursion depth and wasm stack for deep problems | 6.2, T07 | |
| **VERIFY** official Anthropic Rust SDK; API behaviour notes | 7.3, T10 | own `reqwest` client |
| **VERIFY** Claude Code CLI flags, `rmcp` API, terms for using a user's login | 7.3, T11 | API key only if unclear |
| **VERIFY** Linux build/runtime dependencies | 11, T01, T13 | |
| **VERIFY** updater behaviour for unsigned macOS builds | 11, T13 | |
| **VERIFY** `tauri-driver` platform support | 13, T14 | Linux only |

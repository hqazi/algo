# Algorithm Tutor: specification

Status: draft 1 (2026-11-17). Tickets that implement it are in
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

1. **Install in one step.** A signed (eventually) installer per OS. No
   terminal, Docker, Python or Node needed to practise in Python.
2. **Configure in the app.** Every user-facing setting is on the Settings
   screen and applies without a restart. The API key is entered there and kept
   in the OS keychain.
3. **Update itself.** New versions arrive from GitHub Releases. User data is
   never touched by an update except through explicit database migrations.
4. **Honest feedback.** Pass or fail comes from running the tests, never from
   the model.
5. **Safe by default.** Code the model writes runs only in the in-app Python
   sandbox (Pyodide). The user's own code runs there too for Python.
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
  separate entry point on top of `packages/core`.
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
   the self-check (section 8.2) before it appears.
4. **Progress.** Level per topic, recent attempts.
5. **Settings.** Tutor (backend, key, model, effort), code execution
   (section 6.5), profile and focus, data (folder, export, import, reset),
   updates, about.

## 3. Architecture

```
┌────────────────────────── Electron app ───────────────────────────┐
│                                                                   │
│  UI window (renderer, sandboxed)        Execution host (hidden    │
│  React, CodeMirror 6                    window, sandboxed, no     │
│  talks only through the preload         network): Pyodide in a    │
│  bridge (typed IPC)                     Web Worker per job        │
│        │                                        ▲                 │
│        ▼                                        │ MessagePort     │
│  Main process (Node) ───────────────────────────┘                 │
│   ├─ packages/core   problems, recommender, grading, tools, prompt│
│   ├─ storage         SQLite (tutor.db), settings.json, files      │
│   ├─ secrets         safeStorage (OS keychain)                    │
│   ├─ tutor           Anthropic API backend, Claude Code backend   │
│   ├─ executors       pyodide │ local toolchain (v2) │ container (v2)
│   └─ updater         electron-updater, GitHub Releases            │
└───────────────────────────────────────────────────────────────────┘
```

### 3.1 Packages

npm workspaces, Node 22, TypeScript throughout.

| Path | What | May depend on |
|---|---|---|
| `packages/core` | Pure logic: problem schema and validation, neutral types (5.2), test comparison, recommender and levels, hint ladder, tool definitions and handlers, system prompt builder, executor and storage *interfaces*. | No Electron, no Node built-ins beyond what runs in both Node and the browser. Storage, executors and time are injected. |
| `apps/desktop/src/main` | Electron main process: windows, IPC handlers, SQLite storage, secrets, executors, tutor backends, updater. | `packages/core`, Electron, Node. |
| `apps/desktop/src/preload` | The only bridge: a typed `window.tutor` API. | Electron `contextBridge`. |
| `apps/desktop/src/renderer` | The UI (ported from `dsa-tutor/web`). | React, CodeMirror. No Node. |
| `apps/desktop/src/exec-host` | The execution host page and Pyodide worker. | Pyodide (bundled). |
| `content/` | Curated problems, `references/*.md` (topics, questionnaire, hint ladder, review rubric, problem spec), runner harnesses. Shipped read-only inside the app. | — |

The core/shell split is deliberate: the tutor logic must not depend on
Electron, so another shell (Tauri, a browser build, an agent skill) is a new
shell, not a rewrite.

### 3.2 Tooling

electron-vite (build), electron-builder (packaging, auto-update), Vitest (unit),
Playwright for Electron (end-to-end), ESLint + Prettier, `zod` for IPC and file
schemas, `node:sqlite` (Node's built-in SQLite, nothing native to rebuild: D-20),
`@anthropic-ai/sdk`. Pyodide is pinned and bundled with the app (works offline).
Exact versions are chosen in T01 and pinned in the lockfile.

## 4. Data and settings

### 4.1 Where things live

Everything the user produces is under the per-user app data folder
(`app.getPath('userData')`; overridable with `ALGOTUTOR_DATA_DIR` for tests
and development):

```
tutor.db                    SQLite: profile, progress, attempts, hints, chats, problem index
settings.json               preferences (4.3), human-readable
secrets.bin                 the API key, encrypted with safeStorage (4.4); never exported
workspace/<slug>/solution.<ext>   the user's code, plain files
problems/generated/<slug>/  problems the tutor made
problems/imported/<slug>/   pasted and imported problems (+ origin.md / NOTICE.md)
explanations/<slug>/        explanation pages, one file per version
cache/                      downloaded open-set files, runner image metadata
agent-home/                 Claude Code's home while it is the tutor (its sessions; 7.3); never exported
logs/                       app log (no credentials, no chat bodies)
backups/                    automatic exports made before an import or reset (4.5)
pending/                    an import or reset waiting for the next start (4.5)
```

Curated problems live inside the app bundle (`content/`) and are replaced
wholesale by updates. User data refers to problems by slug only.

Solutions are plain files so the user can open them in their own editor. The
app watches the open problem's file and reloads it when it changes on disk.

### 4.2 Database (`tutor.db`)

SQLite through `node:sqlite` (D-20). Numbered SQL migrations in
`apps/desktop/src/main/storage/migrations/`, applied at start inside a
transaction; a backup copy `tutor.db.bak-<version>` is made
before any migration. The app refuses to open a database newer than it knows.

| Table | Columns (main) |
|---|---|
| `meta` | `key`, `value` (schema version, install id) |
| `profile` | single row: goal, experience, group comfort (JSON), focus topic, language, onboarded |
| `topic_progress` | `topic`, `level` (`new` / `learning` / `comfortable`), `unaided_solves`, `updated_at` |
| `problems` | `slug`, `source` (`curated` / `generated` / `pasted` / `imported`), `topic`, `difficulty`, `title`, `path`, `content_version`, `created_at` |
| `attempts` | `id`, `slug`, `language`, `started_at`, `finished_at`, `passed`, `total`, `outcome` (`unaided` / `with_hints` / `gave_up` / open), `hints_used`, `explained`, `notes` |
| `hints` | `attempt_id`, `level`, `given_at` |
| `threads` | `id` (`home` or a slug), `backend`, `backend_state` (JSON), `created_at`, `archived_at` |
| `messages` | `thread_id`, `seq`, `role`, `content` (JSON: text and tool events), `created_at` |
| `test_runs` | `attempt_id`, `kind` (`run` / `submit`), `report` (JSON, already redacted per 6.1), `created_at` |

All writes go through one storage module in the main process. State-changing
tool calls and UI actions are serialised (one write queue), as in `dsa-tutor`.

### 4.3 Settings (`settings.json`)

Validated with a `zod` schema; unknown keys are kept, invalid values fall back
to defaults with a notice. Changes apply immediately (no restart). Keys are
nested in the file: `tutor.backend` is `{"tutor": {"backend": "auto"}}`.

| Key | Default | Notes |
|---|---|---|
| `tutor.backend` | `auto` | `auto` / `anthropic` / `claude-code` / `none`. `auto`: Anthropic if a key is set, else none. Claude Code needs the same key (D-25), so it is chosen explicitly. |
| `tutor.model` | `null` | `null` means the backend's default: `claude-opus-5-5` for Anthropic (D-23). |
| `tutor.effort` | `medium` | |
| `tutor.claudeCodePath` | `null` | Absolute path to `claude`; `null`: `PATH`, then the installers' places (D-25). |
| `execution.runtime` | `local` | v2: `local` / `podman` / `docker` for Rust and Go. Python always uses Pyodide. |
| `execution.timeScale` | `1.0` | Multiplier on per-test time limits (slow machines). |
| `editor.fontSize`, `editor.keymap` | `14`, `default` | `default` / `vim` / `emacs`. |
| `ui.theme` | `system` | `system` / `light` / `dark`. |
| `updates.channel` | `stable` | `stable` / `beta`. |
| `updates.auto` | `true` | Download in background, install on quit. |

Secrets are never in `settings.json` (4.4).

### 4.4 Secrets

The Anthropic API key is stored with Electron `safeStorage` (backed by the OS
keychain / DPAPI / libsecret) in `secrets.bin`. On Linux without a keyring,
`safeStorage` falls back to a weak backend: the app detects this
(`getSelectedStorageBackend()` is `basic_text`), warns in Settings and still
works. Only the asynchronous `safeStorage` API is used: the synchronous one is
deprecated in Electron 45 and reports no encryption on Linux without a
keyring (D-24).

`ANTHROPIC_API_KEY` in the environment, if set, is used and shown in Settings
as "from environment" (read-only). The key never reaches the renderer, the
execution host, logs, the database or code under test; Settings shows only
"stored, ends in …abcd".

### 4.5 Export, import, reset

- **Export** writes a zip: `tutor.db` (via SQLite backup API), `settings.json`,
  `workspace/`, `problems/generated/`, `problems/imported/`, `explanations/`.
  Never secrets.
- **Import** validates the zip, backs up current data (an export to
  `backups/`), stages the files in `pending/` and restarts; the swap happens
  at start-up before the database opens (D-24).
- **Reset progress** and **Reset everything** with a confirm dialog and an
  automatic export first. Progress is attempts, hints, test runs and topic
  levels; everything is all of the app's data plus the stored key, applied at
  the next start.

## 5. Problems

### 5.1 Format (v2 of the `dsa-tutor` format)

```
<problem>/
  problem.md        statement (Markdown), examples generated from visible tests;
                    language-neutral (D-19)
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
to its own convention (`levelLists`, `LevelLists`). `languages` lists the
languages the problem is offered in; a problem can be offered in any language
whose harness supports every type in its signature.

Optional fields: `created_at` (ISO time) and `origin` (required for `pasted`
and `imported` problems: `{ "kind": "paste" }` or `{ "kind": "open-set",
"name", "url", "license", "attribution" }`, as in `dsa-tutor`). Unknown keys
are rejected; the zod schemas in `packages/core/src/problems/schema.ts` are
the reference and `content/schema/*.v2.schema.json` their JSON Schema export.

`tests.json` keeps the `dsa-tutor` shape: `{ "schema_version": 2, "tests": [
{ "id", "visibility": "visible" | "hidden", "category", "input": { name: value },
"expected", "explanation"? } ] }`. At least 2 visible and 3 hidden tests;
hidden tests need a meaningful `category`.

Compare modes are unchanged: `exact`, `unordered`, `unordered_deep`, `float`
(+ `tolerance`).

### 5.2 Neutral types

| Type | JSON form | Python | Rust (v2) | Go (v2) |
|---|---|---|---|---|
| `int` | number (integer, 64-bit range; core parses JSON so integers beyond 2^53 stay exact) | `int` | `i64` | `int` |
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

Rules (enforced by the parser, D-12): `tuple` has two or more items; `tree`
and `linked_list` hold a scalar (`int`, `float`, `bool`, `string`, `char`);
`optional<optional<T>>` is not allowed; map keys are `string` or `int`. A
`tree` is read as every harness builds it (each node takes the next two slots
as its children; an empty tree is `[]`, never `[null]`); expected trees have no
trailing `null`s, since harnesses print them without.

`packages/core` validates every test input and expected value against the
signature, so a problem that validates is runnable by every harness that
supports its types.

### 5.3 Sources

| Source | Input | Licensing |
|---|---|---|
| Curated | ships with the app (50 problems across 15 topics, from `dsa-tutor`) | Original, Apache 2.0. |
| Generated | topic, difficulty, optional idea | Written fresh by the model in original wording. |
| Pasted | text of a problem statement the user has | Personal practice only; stays in the data folder, sent only to the configured AI provider. Treated as untrusted data in prompts. |
| Imported | a pick from an openly licensed set | v1: Exercism problem-specifications (MIT), pinned commit, as in `dsa-tutor`. Fetched by the main process from `raw.githubusercontent.com` only. Licence and attribution shown under the title and kept in `NOTICE.md`. |

## 6. Code execution

### 6.1 Executor interface

```ts
interface Executor {
  id: "pyodide" | "local" | "container";
  status(): Promise<ExecutorStatus>;            // available, reason, versions
  run(job: RunJob, signal?: CancelSignal): Promise<RunReport>;  // AbortSignal fits
}

interface RunJob {
  language: Language;                           // "python" in v1
  code: string;                                 // the solution source
  signature: Signature;
  compare: CompareSpec;
  tests: TestCase[];                            // inputs and expected values
  timeLimitMs: number;                          // per test, after timeScale
  memoryLimitMb: number;                        // advisory: Pyodide cannot enforce it (D-14)
}

interface RunReport {
  ok: boolean;                                  // the harness ran (not: all passed)
  error?: { kind: "compile" | "harness" | "runtime-missing" | "cancelled"; message: string };
  results: TestResult[];
  durationMs: number;
}

interface TestResult {
  id: string;
  visibility: "visible" | "hidden";
  category?: string;
  status: "pass" | "fail" | "error" | "timeout";
  // visible tests only:
  input?: unknown; expected?: unknown; actual?: unknown; stdout?: string; message?: string;
  errorType?: string; line?: number;            // for errors: exception type, solution line
  timeMs?: number;
}
```

The types live in `packages/core/src/exec/`; `CancelSignal` is the part of
`AbortSignal` executors use, declared structurally because core has no DOM
types. A load failure (syntax error, missing function, error or endless loop
at import) is `error.kind: "compile"` with every test `error`. stdout is kept
per test up to 2000 characters (the end, with a note of what was dropped);
messages up to 500.

Comparison happens in `packages/core`, not in the harness, so every language
grades the same way: the harness returns `actual` (JSON) and stdout per test,
and core compares (`gradeRun`). Only inputs are sent to the harness, never
expected values. Before a report leaves the main process it is **redacted**
(`redactReport`): hidden tests keep only `id`, `visibility`, `category`,
`status`, `timeMs`. The renderer and the tutor see only redacted reports.
Hidden inputs exist only in the main process and the execution host; expected
values only in the main process.

### 6.2 Python: Pyodide in the execution host

- A hidden `BrowserWindow` with `sandbox: true`, `contextIsolation: true`, no
  Node (its preload only hands over a MessagePort), background throttling
  off, its own in-memory session partition. The page and Pyodide are served
  from the app's files over a `tutor-exec://` protocol registered only on
  that partition; every other request from it is cancelled
  (`session.webRequest`), permissions are denied, navigation, new windows and
  downloads are blocked. CSP (response headers): the page `default-src
  'none'; script-src 'self'; worker-src 'self'; connect-src 'none'`; workers
  `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src
  'self'`, because Pyodide fetches its own bundled files (D-14).
- Each job runs in a fresh Web Worker (Pyodide loaded from the bundle) and the
  worker is terminated when the job ends; nothing survives a job. One spare
  worker is kept started, so start-up (about 2.6 s) is paid ahead of the job.
  Each test has a kill timer of its limit plus 250 ms; on timeout the worker
  is terminated and a fresh one resumes with the next test.
- The Python harness (`content/runners/python/harness.py`, ported) builds
  `TreeNode` / `ListNode` (and tuples, int-keyed maps, floats) from JSON by
  the neutral types, calls the function, serialises the result and captures
  stdout and stderr, per test.
- `micropip`, `pyodide.http`, `pyodide.code`, `pyodide_js` and package loading
  are disabled; Python's `js` module is empty; the worker removes `fetch` and
  the other network APIs from its global scope after start-up (D-14).
- Time limits: Pyodide is slower than CPython (median 2.4× on the curated
  references). Per-test limit `max(2000 ms, 3 × the slowest reference run)`,
  rounded up to 100 ms, stored per problem as `time_limit_ms`, times
  `execution.timeScale` (clamped to 0.5–10). Every curated reference's slowest
  test is under 101 ms, so all get 2000 ms (D-15).
- `npm run check:exec-host` runs these rules against the real window in
  Electron (CI on Linux); Vitest runs the same pool, worker runtime and
  harness on Node worker threads.

### 6.3 Self-check

A new problem is accepted only if, in Pyodide: the spec validates (5.1, 5.2);
`brute_force.py` (if given) computes or agrees with every expected value;
`reference.py` passes every test within the limit. At most 4 attempts with the
failures fed back to the model, then the job fails with the reason. Same rules
as `dsa-tutor/references/problem_spec.md`.

Model-written code (references, brute forces) runs **only** in Pyodide, never
in the local toolchain or a container, in every version.

### 6.4 Rust and Go (v2)

- Each language has a harness generator in `packages/core` that, from the
  signature, writes: the stub the user sees, a `main` that reads tests from
  stdin as JSON, converts with the type adapters, calls the function, and
  writes one JSON result line per test.
- **Local executor:** uses `cargo` / `go` on `PATH`. One cached project per
  problem under `cache/build/<lang>/<slug>/` so reruns compile incrementally.
  Process per run, killed (with its process group) on timeout. No sandbox: the
  user's own code, with the user's own rights. Settings says so plainly.
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
  and published by CI with Python, Rust and Go toolchains. **Pull / Update**
  and **Test sandbox** buttons (hello-world per language).
- Each run: `--rm --network none --read-only --cap-drop ALL
  --security-opt no-new-privileges --user 65534:65534 --pids-limit 128
  --memory <limit> --cpus 1 --tmpfs /tmp:rw,noexec,size=64m`, the job folder
  mounted read-only, results on stdout. Rust builds need a writable target
  directory: a per-job tmpfs or a cache volume owned by the runner user
  (decided in T17).

## 7. Tutor

### 7.1 Tools

Ported from `dsa-tutor` SPEC 5.1; handlers live in `packages/core` and call
injected storage and executors.

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

The registry (`packages/core/src/tools/`) offers `create_problem` and
`render_explanation` only when the app supplies the service behind them
(T12, T10). `start_problem` and `set_profile` also take a `language` (one with
a harness; Python in v1). `run_tests` keeps its redacted report as a `run`
test run when an attempt is open, `record_attempt` as a `submit` (D-21).

### 7.2 System prompt

Built from the teaching rules (ported from `dsa-tutor/SKILL.md`, rewritten for
tools instead of scripts) and `content/references/*.md`. Stable text first so
prompt caching works; per-turn context (problem, current code, last redacted
report, language) goes with the user message. Pasted and imported text is
delimited untrusted data.

### 7.3 Backend interface

```ts
interface TutorBackend {
  id: "anthropic" | "claude-code" | "fake";
  status(): Promise<BackendStatus>;           // available, reason, model
  runTurn(turn: Turn, signal: AbortSignal): AsyncIterable<ChatEvent>;
}
```

`ChatEvent`: `text_delta`, `tool_start`, `tool_end`, `ui_event`, `error`
(kind: `auth` / `rate_limit` / `network` / `refusal` / `max_tokens` /
`cancelled` / `other`, user-readable message), `done`. Chat events go to the
renderer over IPC as a stream per turn; the turn can be cancelled.

- **`anthropic`**: `@anthropic-ai/sdk`, Messages API, streaming, client tools,
  the tool loop run by the main process. Port the `dsa-tutor` notes (stream
  every request, check `stop_reason`, replay content blocks unchanged, cache
  breakpoint after system prompt and tools, map SDK error classes to `error`
  events). Verified against the current API docs in T10 (D-23).
- **`claude-code`**: the user's installed Claude Code (2.1.328 or later),
  found at `tutor.claudeCodePath` or on `PATH`, **with the app's API key
  only** (D-25: current terms do not let an app use a user's Claude
  subscription login). Spawned headless per turn in bare mode (no OAuth or
  keychain, hooks, plugins, CLAUDE.md, skills or subagents), with every
  built-in tool disabled and only the tutor tools allowed, through an MCP
  server the main process serves on loopback with a per-turn token. The key
  never reaches the CLI: it gets a per-turn token for a loopback relay in
  the main process that swaps in the key. Available when found, recent
  enough, and a key is set. The CLI's session is resumed across turns.
- **`fake`**: scripted events for tests and UI work; not selectable in
  Settings (enabled with `ALGOTUTOR_FAKE_TUTOR=<script>`).

### 7.4 Threads

One thread per problem plus `home`, stored in `threads` / `messages`. "Reset
chat" archives the thread and starts a new one: the archived thread keeps its
messages under the id `<id>~<n>` with `archived_at` set (D-23).

## 8. UI

Ported from `dsa-tutor/web` (React, CodeMirror 6). Pages: Welcome/onboarding,
Home, Problems (browse, filter by topic/difficulty/source), Practice
(statement | editor | results + chat, resizable panes), Progress,
Explanations (sandboxed iframe, version picker), Settings.

Settings sections: **Tutor** (backend, key entry with test-connection button,
model, effort, status line), **Code execution** (6.5; v1 shows Python/Pyodide
status only), **Profile** (questionnaire answers, focus), **Data** (open data
folder, export, import, reset), **Updates** (version, channel, check now),
**About** (licences, including Pyodide and imported sets).

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
| Model-written code harms the machine | Runs only in Pyodide inside the sandboxed, network-blocked execution host (6.2). |
| User's Python code reads files or the network | Same: Pyodide in the execution host. |
| User's Rust/Go code (v2) | Local executor: the user's own code with their own rights, stated in Settings. Container executor for isolation (6.5). |
| Hidden test data leaks to the tutor or UI | Redaction in the main process (6.1); `get_problem` never returns hidden tests. |
| API key leaks | `safeStorage`, main process only, never logged, never sent to renderer or code under test (4.4). |
| Prompt injection via pasted/imported problems | Delimited untrusted data; the tutor has no tool that writes code, files or reaches the network. |
| Compromised renderer | `contextIsolation`, `sandbox` (also `app.enableSandbox()`), no `nodeIntegration`, `webSecurity` on. The UI is served over the app's own `tutor-app://` protocol (never `file://`) with a strict CSP header (`connect-src 'none'`); every request from a page to anything else is cancelled, so no remote content. IPC only through the typed `window.tutor` bridge, `zod`-validated in main, accepted only from the UI page's main frame. Navigation, redirects, `window.open`, `<webview>`, permissions and downloads blocked in every web contents. Electron fuses (D-17): `RunAsNode`, `NODE_OPTIONS`, `--inspect` and `file://` extra privileges off; cookie encryption, ASAR integrity (macOS, Windows) and load-only-from-ASAR on. |
| Claude Code as the tutor gets more than the tutor tools | Bare mode, `--tools ""`, only the app's MCP server (`--strict-mcp-config`), only the tutor tools pre-approved with everything else denied (`dontAsk`), no user settings, a minimal environment, an empty working directory, a private home; tokens per turn (D-25). |
| Malicious update | Updates only from the project's GitHub Releases over HTTPS; signed builds (11) verified by the OS/updater. |

## 11. Packaging and updates

- electron-builder targets: macOS `dmg` + `zip` (universal or per-arch),
  Windows `nsis`, Linux `AppImage` + `deb`.
- `electron-updater` with the GitHub provider; channels `stable` and `beta`
  (pre-releases). Download in background, install on quit, "Restart to update"
  button.
- **DECISION**: code signing. macOS auto-update requires a signed and
  notarized app (Apple Developer account); unsigned Windows builds show a
  SmartScreen warning. v1 can ship unsigned with instructions in the README;
  the release workflow takes signing secrets when they exist.
- CI release workflow on a version tag: build all three OSes, publish a draft
  release with update metadata. v2 adds the runner image to GHCR.

## 12. Configuration outside the UI

Only for development and tests: `ALGOTUTOR_DATA_DIR`, `ALGOTUTOR_FAKE_TUTOR`,
`ALGOTUTOR_LOG_LEVEL`, and `ANTHROPIC_API_KEY` (4.4). The Anthropic SDK's own
`ANTHROPIC_BASE_URL` also applies (also as the Claude Code relay's upstream);
the Settings and Claude Code e2e checks use it to point at a local stand-in.
`ALGOTUTOR_TEST_CLAUDE` (tests only) names a `claude` for the real-CLI checks. Nothing a normal user
needs.

## 13. Quality bar

- `npm test` (Vitest) for core and main; `npm run typecheck`; `npm run lint`.
- `npm run validate:content`: every curated problem validates and its
  reference passes in Pyodide (runs in CI via Electron headless or Node +
  Pyodide for the check only).
- One Playwright-for-Electron end-to-end test with the fake tutor: onboarding,
  next problem, edit, run, submit, hint, progress.
- No test calls a real AI provider. A manual `npm run smoke:ai` makes one real
  call when `ANTHROPIC_API_KEY` is set.
- With Claude Code installed, `ALGOTUTOR_TEST_CLAUDE=<path> npm test` and
  `npm run e2e:claude-code` also run the real CLI against a loopback stand-in
  for the API.
- CI runs on Linux, macOS and Windows.

## 14. Open items

| Item | Where | Default until decided |
|---|---|---|
| ~~**DECISION** default tutor model~~ | 4.3, T10 | Resolved: `claude-opus-5-5` (D-23) |
| ~~**DECISION** Pyodide time limits~~ | 6.2, T07 | Resolved: default kept, measured (D-15) |
| **DECISION** Rust `int` width | 5.2, T15 | `i64` |
| **DECISION** code signing | 11, T13 | ship unsigned, document it |
| ~~**VERIFY** Electron `safeStorage` API and Linux fallback~~ | 4.4, T09 | Resolved: async API, `basic_text` warning (D-24) |
| ~~**VERIFY** Anthropic API behaviour notes~~ | 7.3, T10 | Resolved: checked against current docs and SDK 1.5.0 (D-23) |
| ~~**VERIFY** Claude Code CLI flags, Agent SDK, terms for using a user's login~~ | 7.3, T11 | Resolved: API key only, bare mode, no Agent SDK (D-25) |
| ~~**VERIFY** Pyodide can be fully network-blocked and package loading disabled~~ | 6.2, T07 | Resolved: yes, with `connect-src 'self'` for workers (D-14) |

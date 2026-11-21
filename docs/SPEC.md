# Algo: specification

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

v3 adds a **Library** (section 15): articles the user keeps in Markdown
folders (an Obsidian vault), read offline, with tutor chats tied to passages.
The app reads those folders and never fetches web pages.

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
cache/                      downloaded open-set files, runner image metadata, article images (15.4)
articles/generated/         articles the tutor wrote (v3, 15.1)
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
| `threads` | `id` (`home`, a slug, or `article:<uuid>` in v3), `backend`, `backend_state` (JSON), `created_at`, `archived_at`; v3 adds `kind`, `article_id`, `anchor` (JSON), `title` (15.5) |
| `messages` | `thread_id`, `seq`, `role`, `content` (JSON: text and tool events), `created_at` |
| `articles` (v3) | `id`, `folder_id`, `rel_path`, `title`, `source_url`, `frontmatter` (JSON), `content_hash`, `missing_since`, `scanned_at` (15.1) |
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
| `library.folders` | `[]` | v3: `{id, path}` per chosen folder; read only, never written (15.1). |
| `library.images` | `on-open` | v3: `on-open` / `ask`, for images an article links to (15.4). |
| `ui.theme` | `system` | `system` / `light` / `dark`. |
| `ui.leader` | `ctrl+b` | `ctrl+b` / `ctrl+a` / `ctrl+space` / `off`: the tmux-style leader key for pane actions (D-57). |
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
  `workspace/`, `problems/generated/`, `problems/imported/`, `explanations/`,
  `articles/generated/` (v3). Never secrets.
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
| `tuple<A,B,…>` | array of fixed length | `tuple[A, B]` | `(A, B)` | struct per harness (`Tuple`, fields `V0`, `V1`, …) |
| `map<string,T>` / `map<int,T>` | object (int keys as strings) | `dict` | `HashMap<String, T>` / `HashMap<i64, T>` | `map[string]T` / `map[int]T` |
| `optional<T>` | value or `null` | `T \| None` | `Option<T>` | `*T` |
| `tree<T>` | level-order array with `null` gaps | `TreeNode \| None` | `Option<Rc<RefCell<TreeNode>>>` | `*TreeNode` |
| `linked_list<T>` | array | `ListNode \| None` | `Option<Box<ListNode>>` | `*ListNode` |

Graphs are expressed with existing types (`list<list<int>>` adjacency lists or
edge lists, `list<string>` grids). The Rust and Go columns are final (T15,
D-29); Rust `int` is `i64`. Rust and Go have one node type per harness, so
they run a signature only if all its trees share one element type, and all
its linked lists too.

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
  language: Language;
  slug?: string;                                // the problem, if any: the local build cache key
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
- Protocol (D-29): stdin is a `{"nonce"}` header line then one input object
  per test; after each test the harness writes `\x1e<nonce> {record}` on
  stdout, and what the solution printed in between is that test's stdout.
  The project has no third-party dependencies (Rust parses JSON itself), so
  it builds offline. Core's `parseHarnessStream` turns stdout into the same
  `HarnessOutput` the Python harness produces.
- **Local executor** (D-30): uses `cargo` / `go` on `PATH` (plus the
  installers' usual folders, e.g. `~/.cargo/bin`, `/usr/local/go/bin`). One
  cached project per problem under `cache/build/<lang>/<slug>/` (a signature
  hash when there is no slug); files are rewritten only when they change, so
  reruns compile incrementally, and an unchanged project is not rebuilt. A
  build failure is `compile` with the compiler's errors (warnings dropped)
  and the solution line. One harness process runs all tests; each test gets
  its limit + 250 ms from the previous result line, then the process tree is
  killed (POSIX process group; Windows `taskkill /T /F`), the test is
  `timeout` and a fresh process runs the rest (a crash continues the same
  way). Toolchains run with the app's environment minus `ANTHROPIC_*` and
  `ELECTRON_*`, and `GOTOOLCHAIN=local`, `GOPROXY=off`. A missing toolchain
  is `runtime-missing` with what to install. No sandbox: the user's own code,
  with the user's own rights; memory limits are not enforced. Settings says
  so plainly.
- **Language picker** (practice view): the problem's languages, each marked
  available or not (toolchain found). Switching saves first, then moves the
  open attempt (opening one if needed) to the new language; each language
  keeps its own solution file.
- **Container executor:** runs the same harness in the runner image (6.5).

### 6.5 Container runtimes (v2): detect and choose, never install

- Detection (on start, when Settings opens, and on **Recheck**):
  `podman info --format json`, `docker version --format json`, honouring
  `DOCKER_HOST` and the current Docker context; `cargo --version`,
  `go version`. Result per runtime: `not-found` / `installed-not-running` /
  `running` (+ version).
- Settings → Code execution shows the runtime choice for Rust/Go
  (`local` / `podman` / `docker`); only detected and running runtimes are
  selectable (main refuses the setting for one that is not running; D-32).
  Not found: a **How to install →** link to the user guide
  (`docs/guide/code-execution.md`).
  Installed but stopped: the command to start it (e.g. `podman machine start`).
  **Recheck runtimes** detects again. The local choice says plainly that it
  has no sandbox.
- The app never installs or starts anything. The only commands it runs are
  detection, `pull` of the runner image, and job runs.
- If the selected runtime disappears, fall back to `local` with a notice
  (shown in Settings → Code execution while it lasts).
- **Runner image** `ghcr.io/hqazi/algo-runner:<app version>`, built
  and published by CI with Python, Rust and Go toolchains (linux/amd64 and
  linux/arm64; on version tags with the app release, and `edge` on manual
  runs; D-34). **Pull / Update**
  (with progress, per running runtime) and **Test sandbox** buttons
  (hello-world in Rust and Go in that runtime's container, never falling
  back to local).
- Each run (D-31): one container per job, `--rm --network none --read-only
  --cap-drop ALL --security-opt no-new-privileges --user 65534:65534
  --pids-limit 128 --memory <limit, at least 512m> --memory-swap <same>
  --cpus 1 --tmpfs /tmp:rw,noexec,size=64m --pull never`, the job folder
  mounted read-only at `/job`, results on stdout. Rust and Go build in a
  per-job tmpfs `/build` (`rw,exec,size=256m`): nothing persists, every run
  builds from scratch. Build and harness are `exec`s in the container; a
  timed-out harness is killed inside it; the container is removed after the
  job. A missing image is `runtime-missing` (runs never pull).

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

v3: articles have any number of threads, each tied to a passage (15.5).

## 8. UI

Ported from `dsa-tutor/web` (React, CodeMirror 6). Pages: Welcome/onboarding,
Home, Problems (browse, filter by topic/difficulty/source), Practice
(statement | editor | results + chat, resizable panes), Progress,
Explanations (sandboxed iframe, version picker), Library (v3, 15.6),
Settings.

Settings sections: **Tutor** (backend, key entry with test-connection button,
model, effort, status line), **Code execution** (Python/Pyodide status, time
limits, and the Rust/Go runtime choice of 6.5), **Profile** (questionnaire answers, focus), **Data** (open data
folder, export, import, reset), **Updates** (version, channel, check now),
**About** (licences, including Pyodide and imported sets), **Library** (v3,
15.6).

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
| Open-set import reaches other hosts | Only the main process fetches, only `https://raw.githubusercontent.com`, same-host redirects only, size and time caps (D-26); the model has no fetch tool. |
| Compromised renderer | `contextIsolation`, `sandbox` (also `app.enableSandbox()`), no `nodeIntegration`, `webSecurity` on. The UI is served over the app's own `tutor-app://` protocol (never `file://`) with a strict CSP header (`connect-src 'none'`); every request from a page to anything else is cancelled, so no remote content. IPC only through the typed `window.tutor` bridge, `zod`-validated in main, accepted only from the UI page's main frame. Navigation, redirects, `window.open`, `<webview>`, permissions and downloads blocked in every web contents. Electron fuses (D-17): `RunAsNode`, `NODE_OPTIONS`, `--inspect` and `file://` extra privileges off; cookie encryption, ASAR integrity (macOS, Windows) and load-only-from-ASAR on. |
| Claude Code as the tutor gets more than the tutor tools | Bare mode, `--tools ""`, only the app's MCP server (`--strict-mcp-config`), only the tutor tools pre-approved with everything else denied (`dontAsk`), no user settings, a minimal environment, an empty working directory, a private home; tokens per turn (D-25). |
| Library: a note reads files outside its folder (v3) | Images resolved by the main process only; served by random token, never by path; real path must be inside the chosen folder; regular files, size cap, image magic bytes, no SVG (15.3). |
| Library: script or markup in a note (v3) | Raw HTML dropped, DOMPurify allowlist, `img` only with app asset URLs, links only `https`/`http`/`mailto` and opened in the system browser; CSP and request filter unchanged (15.2). |
| Library: an image link reaches the local network (v3) | Main process downloads only; `https` on 443; every address checked (loopback, private, link-local, CGNAT, multicast, mapped forms) and the connection pinned to it; redirects re-checked (15.4). |
| Library: a hostile image file (v3) | Magic bytes and header dimensions checked; size caps; never decoded in the main process; the sandboxed renderer decodes; Electron kept current by updates (15.4). |
| Library: an article instructs the tutor (v3) | Delimited untrusted data; article-mode tools read only the open article; no file, network or code tools (15.5). |
| Library: a reply carries data out through an image URL (v3) | Chat never renders images; only references in the article file are ever downloaded (15.4, 15.5). |
| Library: passages sent to the AI provider (v3) | Stated once before the first article message (15.5). Nothing is sent while only reading. |
| Read aloud: a tampered voice model (v3) | Downloaded by the main process only, on request, from one pinned Hugging Face revision; `https`, redirects only to Hugging Face hosts; each file's SHA-256 checked before use (15.6). The engine runs in a utility process; the renderer only sends text and receives samples. |
| Malicious update | Updates only from the project's GitHub Releases over HTTPS; signed builds (11) verified by the OS/updater. |

## 11. Packaging and updates

- electron-builder targets: macOS `dmg` + `zip` (per arch: x64 and arm64),
  Windows `nsis`, Linux `AppImage` + `deb`.
- `electron-updater` with the GitHub provider; channels `stable` and `beta`
  (pre-releases). Download in background, install on quit, "Restart to update"
  button.
- Code signing (resolved, D-27). macOS auto-update requires a signed and
  notarized app (Apple Developer account); unsigned Windows builds show a
  SmartScreen warning. v1 ships unsigned with instructions in the user guide
  (`docs/guide/installation.md`); the release workflow signs when the signing secrets exist.
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
| ~~**DECISION** Rust `int` width~~ | 5.2, T15 | Resolved: `i64` (D-29) |
| ~~**DECISION** code signing~~ | 11, T13 | Resolved: unsigned until secrets exist; the workflow signs when they do (D-27) |
| ~~**VERIFY** Electron `safeStorage` API and Linux fallback~~ | 4.4, T09 | Resolved: async API, `basic_text` warning (D-24) |
| ~~**VERIFY** Anthropic API behaviour notes~~ | 7.3, T10 | Resolved: checked against current docs and SDK 1.5.0 (D-23) |
| ~~**VERIFY** Claude Code CLI flags, Agent SDK, terms for using a user's login~~ | 7.3, T11 | Resolved: API key only, bare mode, no Agent SDK (D-25) |
| ~~**VERIFY** Pyodide can be fully network-blocked and package loading disabled~~ | 6.2, T07 | Resolved: yes, with `connect-src 'self'` for workers (D-14) |
| ~~**VERIFY** Obsidian Web Clipper's default frontmatter keys and image syntax~~ | 15.1, T21 | Resolved: the seven keys in 15.1; remote images as `![alt](https://…)` (D-39) |
| ~~**DECISION** raw HTML in notes~~ | 15.2, T22 | Resolved: dropped (D-40) |

## 15. Library (v3)

Read articles saved on this computer, offline, and discuss them with the
tutor, several chats per article, each tied to a passage. Decisions: D-37
(where articles come from), D-38 (images).

### 15.1 Where articles come from

The app **reads** Markdown folders the user chooses, typically an Obsidian
vault (or part of one) filled by the Obsidian Web Clipper. It **never writes
to them** and **never fetches a web page**: clipping is the user's browser's
job. The only network use is downloading images an article links to (15.4)
and, once and on request, the read-aloud voice model (15.6).

- `library.folders` (4.3) lists the chosen folders, added with the OS folder
  picker in Settings → Library. Removing a folder removes its index rows and
  any of its chats (with a confirm), never its files.
- A scan finds `*.md` files under each folder, skipping dot-folders
  (`.obsidian/`, `.trash/`, `.git/`), symlinks that lead outside the folder,
  and files over 5 MB. It runs at start, when the Library opens, on
  **Refresh**, and while the Library page is open on file changes
  (`fs.watch`, debounced; a full rescan if watching fails).
- Each note's YAML frontmatter is read as data (YAML core schema, no custom
  tags, aliases capped). Known keys (the clipper's defaults, D-39): `title`,
  `source`, `author`, `published`, `created`, `description`, `tags`. Missing
  title → file name. Unknown keys are kept and shown, never interpreted.
- Groups are the folder tree (as in Obsidian) plus `tags`. The app keeps no
  groups of its own in v3.
- Articles the tutor writes (T25) are the one exception to "only the user's
  folders": they are saved in the app's own `articles/generated/<slug>.md`,
  shown as a **Written by the tutor** group, labelled as AI-written, and
  exported with the user's data. **Write an article** takes a topic, a level
  (beginner / intermediate / advanced) and a length (short / medium / long);
  the tutor's only tool is `save_article`. The app writes the frontmatter
  (`title`, `created`, `tags`, `generated: true`) and removes any image from
  the body, so a generated article never causes a download (15.4). Only the
  app's folder makes an article AI-written, not a `generated` key in a
  user's note (D-43).
- Identity: an article is `(folder id, path inside the folder)` with its
  content hash. A rescan that finds a path gone and a new path with the same
  hash, or the same `source`, moves the article (and its chats) instead of
  dropping it. An article whose file disappears keeps its chats, marked
  "file missing", until the user deletes them.

### 15.2 Rendering

Untrusted Markdown, rendered in the UI window with the existing two layers
(`marked` with raw HTML dropped, then DOMPurify; `lib/markdown.ts`) and an
article allowlist that adds `img` only.

- Raw HTML in notes is dropped (resolved, D-40; some clipped formatting is
  lost).
- Obsidian syntax: `![[file.png]]`, `![[file.png|300]]` (width) and
  `![alt](path)` images; `[[note]]` / `[[note|label]]` / `[[note#heading]]`
  links open that note in the reader if it is in the library, else show as
  plain text; `> [!note]` callouts as styled blockquotes. Note embeds
  (`![[other note]]`) show as a link, not inline. No math, no Mermaid in v3.
- An `img` survives sanitising only if its `src` is an app asset URL
  (15.3, 15.4); anything else becomes a placeholder showing the alt text and
  the host. The window's CSP (`img-src 'self' data:`) and the session's
  request filter already refuse remote loads; both stay as they are.
- Links: `https:`, `http:` and `mailto:` open in the system browser on click
  (`shell.openExternal` from the main process, after checking the scheme);
  every other scheme is removed. The window itself still never navigates.
- Reading needs no API key and no network (goal 6).

### 15.3 Local images

Images inside a library folder are served by the main process under the UI's
own origin: `tutor-app://app/library-asset/<token>`.

- The renderer never sees or sends file paths. When an article is opened the
  main process resolves its image references and returns, per reference, a
  random token (valid for the session, mapped in memory to one file) or a
  reason it could not be shown.
- Resolution, as Obsidian does it: relative to the note, then relative to the
  folder root, then a unique file name anywhere in the folder; ambiguous names
  pick the shortest path.
- A file is served only if its real path (after `realpath`) is inside the
  chosen folder's real path, it is a regular file under 25 MB, and its first
  bytes are PNG, JPEG, GIF or WebP. It is served with that type and
  `X-Content-Type-Options: nosniff`. SVG is not served in v3.

### 15.4 Linked images

An image that points to a website is downloaded once by the main process and
served from a cache, so the article then works offline. The renderer never
contacts the website.

- When: when the article is opened (`library.images: "on-open"`, the
  default), or only after **Load images** on that article (`"ask"`).
  **Make available offline** on a folder downloads every article's images in
  the background. Nothing downloads at import.
- Only `https:` URLs on port 443. `http:` images show a placeholder ("not
  loaded: insecure link"). `data:` image URLs are allowed only for PNG, JPEG,
  GIF and WebP, are capped at 2 MB, and are decoded and served like a
  downloaded image (not left inline).
- Requests: no cookies, no `Referer`, no credentials, a generic
  `User-Agent`, `Accept: image/*`. Redirects followed by hand (at most 3),
  each target checked again.
- No local network: the host is resolved first, and the request is refused
  if any address is loopback, private, link-local, carrier-grade NAT,
  multicast, unspecified, or an IPv4-mapped/IPv6 form of one of those (and
  `localhost`, `*.local`, bare IPs in those ranges). The connection is then
  made to the address that was checked (custom `lookup`), so a DNS change
  between check and connect cannot reach the local network.
- Limits: 10 MB per image, 15 s per request, 4 downloads at a time, 200
  images and 100 MB per article. The body must start with PNG, JPEG, GIF or
  WebP magic bytes, whatever `Content-Type` says; width × height read from
  the header must be at most 100 megapixels. The main process never decodes
  the image: it only checks the header and stores the bytes; the sandboxed
  renderer decodes it.
- Cache: `<data>/cache/article-images/<sha256 of the URL>` plus a small JSON
  record (type, size, dimensions, fetched at). Shared across articles, never
  in the vault, not exported, size shown and cleared in Settings → Library.
  Failed downloads are remembered for 1 hour so a broken image is not
  retried on every open; **Retry** on the placeholder clears that.
- The model can never cause a download: only image references found in the
  article file are downloaded. Chat messages render no images at all (15.5).
- IPC (T23, D-41): `library:article` downloads nothing; `library:load-images`
  (article id, `force`, `retry`) downloads that article's references;
  `library:offline` (folder id, stream) for **Make available offline**;
  `library:image-cache` / `library:clear-image-cache` for Settings. A
  placeholder states why (local network address, not port 443, too many
  redirects, too large, took too long, too many pixels, site error,
  unreachable, over the article's limits).

### 15.5 Chats on passages

Each article can have many threads, each tied to an **anchor**: the passage
the user selected (or a heading), stored as the heading path plus a text
quote with up to 32 characters of context on each side (the W3C text-quote
selector idea). Resolution lives in `packages/core` (pure): exact quote, then
prefix/suffix to pick between repeats, then the heading alone; otherwise the
thread is "detached" and listed without a position.

- Start a thread: select text → **Ask about this**, or a heading's margin
  button. Threads show as margin markers beside their passages and as a list
  in the chat pane; the open thread is below the list (layout in 15.6).
- Storage: `threads` gains `kind` (`home` / `problem` / `article`),
  `article_id`, `anchor` (JSON) and `title` (the first question, editable).
  Article thread ids are `article:<uuid>`. "Reset chat" works as in 7.4;
  the thread stays at its passage, empty. A thread is created when its
  first question is sent. Removing a folder deletes its articles' threads
  (D-42).
- Each turn sends: the article's title, source and outline (headings only),
  the anchored section (capped at 8,000 characters), the quote, and the
  user's message. The article text is delimited untrusted data (7.2), like
  pasted problems. The tutor reads more of the article only through tools.
- Article-mode tools: `read_article_section(heading)`,
  `search_article(query)` (both return text from the open article only,
  capped), `get_profile`, and (T25) `create_problem` from a passage: the
  tutor's own tool and pipeline (6.3, self-check in Pyodide; nothing is
  saved unless it passes), at most 4 calls per message, with the problem
  spec and topics guides in the article prompt. **Make a problem from
  this** in a thread sends a fixed request; a problem that passes is
  offered with **Open in Practice** (not opened by itself). No other
  practice tools, no file or network access.
- Chat messages never render images, in any thread (the chat allowlist has no
  `img`); a test keeps it that way. This stops a planted instruction from
  making the tutor reply with an image URL that carries data out.
- The first time the user sends a message on an article, a one-time notice
  says the passage and outline are sent to the tutor's provider.
- Reading and existing chats work without a key; sending needs one, as for
  problem chats.

### 15.6 UI

A **Library** page in the main navigation, three resizable panes:

- **Left:** the folder tree (folders, then articles by title), a filter box
  (title and tags), **Refresh**.
- **Middle:** the reader: title, source link, author and dates, tags, then
  the body; margin markers for threads; image placeholders with **Load
  images** / **Retry**; a "file missing" banner when the file is gone.
- **Right:** this article's threads (title, passage snippet, last message
  date) and the open thread. Collapsible.

**Read aloud** (T37, T38, D-58, D-59): a button in the reader's header
reads the article with **Kokoro** (Kokoro-82M v1.0, Apache-2.0), an
open-source neural voice that runs on this computer. It starts at the top,
or at the block holding a non-empty selection. Blocks are headings,
paragraphs, list items, quote lines, table cells and definition terms; code
blocks, image placeholders and buttons are skipped; long blocks are spoken in
sentence chunks of at most 240 characters. The block being read is
highlighted and scrolled into view. A bar at the reader's foot has
previous/next block, pause/resume (pause stops the sound where it is),
position, speed (0.75–2×), voice (28 English voices, American and British)
and stop; speed and voice are kept in the renderer's `localStorage` (UI
state of this computer, not in `settings.json` or the export). Another
article or leaving the page stops reading. Leader keys `p` (start, pause,
resume), `n`, `b`, `x`.

- **The model** is not shipped: the first Read aloud offers to download it
  (324 MB: the full-precision ONNX model and the voices) from one pinned
  revision of `onnx-community/Kokoro-82M-v1.0-ONNX` on Hugging Face. Only
  the main process downloads; `https` only, redirects only to
  `huggingface.co` or `*.hf.co`, every file checked against a SHA-256 written
  in the app; into `<data>/cache/kokoro-v1.0/` (not exported; "reset
  everything" removes it). Settings → Library shows it and has **Remove**.
- **The engine** runs in an Electron utility process, started on the first
  chunk and stopped after 5 idle minutes: eSpeak NG (WebAssembly, the
  `phonemizer` package) turns text into phonemes, ONNX Runtime
  (`onnxruntime-node`, shipped native, outside the asar) runs the model. The
  renderer sends text chunks over IPC (`tts:speak`) and gets mono 24 kHz
  samples back, which it plays with Web Audio; the next chunk is made while
  one plays.
- **CPU or GPU**: the CPU by default. Settings → Library → **Use the GPU**
  (`library.readAloudGpu`, off) runs it on the GPU instead, through ONNX
  Runtime's WebGPU provider (Vulkan, Metal or Direct3D 12; DirectML first
  on Windows); if no GPU provider opens and runs, it falls back to the CPU
  and says so. A change applies from the next chunk the engine makes.
  Settings → Library says where it runs and how much faster than real
  time.
- Nothing the learner reads leaves the computer.

Settings → **Library**: folders (add, remove, open in file manager), images
(`on-open` / `ask`), image cache size and **Clear**, and a line saying the app
reads these folders and never changes them.

### 15.7 Not in v3

Writing to the vault, fetching pages by URL, cloud voices or languages
other than English for read aloud, a browser extension, an
in-app browser, groups kept by the app, highlights and annotations stored in
the note, note embeds, SVG, math, and articles counting towards topic levels.

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

**D-11 Exact 64-bit integers: core parses JSON with bigints** (2026-11-18, T03)

Neutral `int` is 64-bit (SPEC §5.2), but `JSON.parse` turns every number into
a double. Three curated problems have integers beyond 2^53 (`floor-sqrt`
inputs `999999999999999999` and `10^18`, `power-mod` inputs, `count-ways`
expected `4660046610375530309`); parsed normally, `999999999999999999` becomes
`10^18` and the test changes meaning. Core's `parseJson` uses
`JSON.parse`'s source-text access (the reviver's third argument; V8 since
Chrome 114 / Node 21, so Node 22, Electron 45 and its Chromium all have it)
to keep integer literals outside ±(2^53 − 1) as `bigint`; `stringifyJson`
writes them back as digits. Compare treats `bigint` and `number` as the same
integer when equal. Every problem file, harness input and harness output
must go through these two functions (T07, T04). Integers outside the i64
range, or written in exponent form beyond 2^53 (`1e20` for an `int`), are
rejected.

Rejected: limiting `int` to ±2^53 (would change three curated problems and
diverge from Python, Rust `i64` and Go `int`); a third-party JSON library
(the built-in does it now); encoding big integers as strings in tests
(changes the format every harness reads).

Caveat: once parsed, `2.0` and `2` are the same number, so an `int` written
as `2.0` passes validation (Python would receive a float).

**D-12 Problem format v2 rules** (2026-11-18, T03)

What the v2 schemas enforce beyond SPEC §5.1's example, and why:

- Unknown keys in `meta.json`, `tests.json` and test cases are errors
  (catches typos in hand-written content; a format change bumps
  `schema_version`). Loading a v1 file says to convert it; a newer version
  says to update the app.
- `time_limit_ms` and `content_version` are required; `created_at` and
  `origin` are optional, with `origin` required and matching for `pasted`
  (`paste`) and `imported` (`open-set`), as in `dsa-tutor`.
- `compare` is required; `tolerance` is allowed only in `float` mode.
  `unordered`/`unordered_deep` need a `list` return type and `float` needs a
  `float` somewhere in it (`dsa-tutor` silently fell back to exact).
- Names are snake_case and not Python keywords; Rust/Go keywords are left to
  the T15 generators to escape.
- Types: `tuple` has ≥ 2 items; `tree`/`linked_list` hold scalars only (each
  harness needs one node type per element type); no `optional<optional<T>>`
  (both levels are `null` in JSON); map keys `string` or `int`, `int` keys
  written as canonical integer strings.
- Tree values are checked the way `dsa-tutor`'s harness builds them: root not
  `null` (empty tree is `[]`), no values left over as children of `null`;
  expected trees must not end in `null` because harnesses print them without
  trailing nulls, so such a test could never pass. Inputs may have trailing
  nulls.
- Test rules from `dsa-tutor`: ≥ 2 visible, ≥ 3 hidden, hidden need a
  category, ids unique slugs, input keys exactly the parameter names.
- `languages` entries must have a harness supporting every type in the
  signature; only Python has one in v1, so `rust`/`go` are rejected until
  T15 registers them in `problems/validate.ts`.

**D-13 Versions pinned in T03** (2026-11-18, T03)

| Package | Version | Note |
|---|---|---|
| zod | 4.6.7 | `packages/core` dependency; `z.toJSONSchema` exports `content/schema/`. |
| tsx | 4.23.15 | Root dev dependency to run TypeScript in `scripts/` (`npm run schema:export`; T04's converter). `scripts/` is type-checked by `tsconfig.scripts.json`. |

**D-14 Pyodide can be network-blocked and package loading disabled**
(2026-11-18, T07; resolves the SPEC §14 VERIFY)

Yes, in layers, each checked in the real Electron window by `npm run
check:exec-host` (Electron 45.3.4, Pyodide 314.0.7, Python 3.14.2):

1. Python cannot reach JavaScript. `loadPyodide({ jsglobals: {} })` makes the
   `js` module an empty object: `js.fetch` is an `AttributeError`, and
   `pyodide.code.run_js` has no `eval` to call. The harness also blocks
   importing `micropip`, `pyodide_js` (the JS API, with `loadPackage`),
   `pyodide.http`, `pyodide.code` and `pyodide.webloop`, and stdin is empty.
   On the JS side `loadPackage`, `loadPackagesFromImports`, `mountNativeFS`,
   `mountNodeFS` and `unpackArchive` throw. `micropip` is not bundled anyway;
   Pyodide's in-memory file system has no `/etc/passwd`.
2. The worker removes `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
   `importScripts`, `indexedDB`, `caches`, `BroadcastChannel`, `Worker` and
   similar from its global scope (and their prototypes) once Pyodide has
   started.
3. CSP, sent as response headers by the protocol handler. The page:
   `default-src 'none'; script-src 'self'; worker-src 'self'; connect-src
   'none'` (verified: `fetch`, images and `blob:` workers are refused).
   Workers: `connect-src 'self'` and `script-src 'self' 'wasm-unsafe-eval'`,
   **not** `connect-src 'none'` as SPEC §6.2 first said: Pyodide fetches its
   own `pyodide.asm.wasm`, `python_stdlib.zip` and lock file, and
   instantiating WebAssembly needs `'wasm-unsafe-eval'`. `'self'` is the
   `tutor-exec://host` origin, which serves only `exec-host/`, `assets/` and
   `pyodide/` from the app's renderer build (any path from the local dev
   server in development).
4. The partition (`exec-host`, in memory) cancels every request that is not
   `tutor-exec://host/...` in `webRequest.onBeforeRequest` (verified with a
   `session.fetch` to an outside host: `ERR_BLOCKED_BY_CLIENT`), denies all
   permissions and downloads, and the window denies navigation and
   `window.open`.

Each job gets fresh workers, terminated at the end, so files, modules and
builtins a solution changes do not reach the next job (tested). Expected
values are never sent to the host, so a solution that forges its worker's
messages (it shares the interpreter with the harness) can only lie about its
own return values, which core still grades.

Found while measuring, and handled:
- Freeing a long chain of Python objects (a 20 000-node linked list) recurses
  once per node in CPython's deallocator and overflows the JavaScript stack,
  which is a fatal Pyodide error, not a `RecursionError`. The harness keeps
  every test's inputs and results alive until the worker is discarded.
  User code that drops a long chain itself can still hit it.
- Deep recursion through C calls (e.g. `1 + max(f(n - 1), 0)`) overflows
  Chromium's worker stack before Python's limit (set to 100 000). The pool
  reports that as a `RecursionError` ("the call stack ran out") and resumes
  with the next test in a fresh worker. Pure-Python recursion 5 000 deep works.

Not done: **memory limits.** `memoryLimitMb` is advisory; WebAssembly memory
only grows and Pyodide's maximum is fixed at build time. A solution that
allocates without bound gets Python's `MemoryError` or a worker crash, which
is reported and does not affect later jobs. Rejected: memory snapshots
(`_makeSnapshot`/`_loadSnapshot`, start in 0.15 s instead of 2 s in Node)
because they are undocumented options (`@ignore` in `pyodide.d.ts`); a warm
spare gives the same result between runs. Rejected for now: interrupting via
`setInterruptBuffer` instead of terminating (needs `SharedArrayBuffer`, so a
cross-origin-isolated page, and still needs termination for C-level loops).

**D-15 Pyodide time limits: the default stands** (2026-11-18, T07; resolves
the SPEC §14 DECISION)

All 50 `dsa-tutor` references were run in the execution host (`npm run
check:exec-host -- --measure ../dsa-tutor/problems/curated`, three runs, signatures
mapped to neutral types on the fly) and on CPython 3.13 through the same
harness. All pass. The slowest test of any problem took at most 100 ms in
Pyodide (`min-daily-pages`, 54–100 ms; next `count-islands` 23–57 ms,
`rope-joining` 25–32 ms, `course-plan` 18–30 ms, `has-route` 18–27 ms);
Pyodide was a median 2.4× slower than CPython on the 15 problems whose
slowest CPython test took ≥ 2 ms.

So `time_limit_ms = max(2000, 3 × slowest reference test)`, rounded up to
100 ms (`timeLimitFromReference`), is 2000 ms for every curated problem, with
≥ 20× headroom. At run time the limit is multiplied by `execution.timeScale`,
clamped to 0.5–10 (`effectiveTimeLimitMs`). The host kills a test at its
limit plus 250 ms (conversions and messaging); a test that returns but took
longer than its limit by the harness's own clock is also a `timeout`.

Start-up, measured in Electron on this machine: first Pyodide start 2.6 s;
a warm job of two tests 15–25 ms; a job with one 500 ms timeout 3.3 s (the
replacement worker's start-up). Back-to-back jobs wait for the spare to
finish starting.

**D-16 Versions pinned in T07** (2026-11-18, T07)

| Package | Version | Note |
|---|---|---|
| pyodide | 314.0.7 | Python 3.14.2. Desktop dependency; its runtime files (`pyodide.mjs`, `pyodide.asm.mjs`, `pyodide.asm.wasm`, `python_stdlib.zip`, `pyodide-lock.json`, about 13.5 MB) are copied into the renderer build under `pyodide/` by a plugin in `electron.vite.config.ts`. 314.0.8 was five days old; took the previous patch. MPL-2.0. |

**D-17 Security baseline: custom UI protocol, IPC envelope, fuses**
(2026-11-18, T02)

- **The UI is served over `tutor-app://app/`**, a privileged custom
  protocol on the default session, not `file://`. It serves only `renderer/`
  and `assets/` from the renderer build, with CSP as a response header
  (`default-src 'none'`, scripts and styles from the app, `connect-src
  'none'`, no frames, objects, forms or `<base>`). This lets the
  `GrantFileProtocolExtraPrivileges` fuse be off and gives IPC a real origin
  to check senders against. The CSP meta tag was removed: in development the
  dev server's page gets a header CSP that also allows Vite's inline preamble
  and its WebSocket, which a stricter meta tag would block.
- **Every request a page makes** in the UI session to anything but the app
  protocol (or the dev server, in development) is cancelled in
  `webRequest.onBeforeRequest`, so remote content is blocked even if CSP is
  bypassed. Requests without a web contents (the main process's own `net`,
  e.g. updates in T13) are not touched.
- **IPC**: `shared/ipc.ts` lists every channel with zod schemas. Main parses
  each request, and its own replies and stream events, and answers with an
  `IpcResult` envelope (`invalid_request`, `unknown_channel`, `forbidden`,
  `cancelled`, `internal`) instead of throwing, because errors thrown across
  `ipcMain.handle` and `contextBridge` lose everything but a prefixed message.
  Only the UI page's main frame may call (checked on `senderFrame`).
  Streams: `ipc:stream:start` (invoke, resolves with the result),
  `ipc:stream:event` (main → page, tagged with the stream id),
  `ipc:stream:cancel` (page → main); a cancel answers at once even if the
  handler ignores its `AbortSignal`, and a closed page cancels its streams.
  MessagePorts were not used: one port per stream adds lifecycle code for no
  gain at this volume. The preload imports only channel names
  (`shared/channels.ts`, checked against the contract at compile time)
  because a sandboxed preload cannot `require` zod.
- **`app.enableSandbox()`** is skipped only when `--no-sandbox` is passed
  explicitly: with it on, Chromium refuses to start as root at all, which
  breaks development in root containers. Every window sets `sandbox: true`
  regardless.
- **Fuses** (`apps/desktop/packaging/fuses.ts`, applied by T13's packaging
  step; Electron 45 has nine, all set, `strictlyRequireAllFuses` on):

  | Fuse | Set | Why |
  |---|---|---|
  | RunAsNode | off | `ELECTRON_RUN_AS_NODE` turns the app into Node. |
  | EnableCookieEncryption | on | No cookies kept; free. |
  | EnableNodeOptionsEnvironmentVariable | off | `NODE_OPTIONS` can preload code. |
  | EnableNodeCliInspectArguments | off | `--inspect` opens a debugger on main. |
  | EnableEmbeddedAsarIntegrityValidation | on | macOS and Windows only; T13 must embed the hash (electron-builder does). |
  | OnlyLoadAppFromAsar | on | So the integrity check covers the app code. |
  | LoadBrowserProcessSpecificV8Snapshot | off | Needs a snapshot we do not build. |
  | GrantFileProtocolExtraPrivileges | off | Nothing uses `file://`. |
  | WasmTrapHandlers | on | Default; WebAssembly (Pyodide) speed. |

  Checked on Linux: `npm run check:fuses` flips a copy of the development
  Electron and reads all nine back. With every fuse but `OnlyLoadAppFromAsar`
  flipped (there is no `app.asar` before T13), the same copy passes
  `check:security` and `check:exec-host`, ignores `ELECTRON_RUN_AS_NODE`
  and `--inspect` (the stock binary honours both).

**D-18 Versions pinned in T02** (2026-11-18, T02)

| Package | Version | Note |
|---|---|---|
| @electron/fuses | 2.1.3 | Desktop dev dependency (`packaging/fuses.ts`). Covers all nine Electron 45 fuses. |
| zod | 4.6.7 | Now also a direct desktop dependency (IPC contract); same version as core. |

**D-19 Curated problems in v2: neutral statements, compact tests**
(2026-11-18, T04)

`scripts/convert-dsa-tutor.ts` converted all 50 `dsa-tutor` curated problems
(at `dsa-tutor` commit `50cdcd3`) to `content/problems/<topic>/<slug>/`.

- **Types.** Every Python hint mapped cleanly: `int`, `bool`, `str` →
  `string` (no parameter or return is a single character, so none became
  `char`), `list[...]` → `list<...>`, `ListNode | None` → `linked_list<int>`,
  `TreeNode | None` → `tree<int>`. No floats, tuples, maps or optionals occur.
  Any other hint makes the converter stop.
- **`problem.md` is language-neutral**, since the same statement serves
  Python now and Rust and Go in v2. Examples are regenerated from the visible
  tests with JSON literals (`null`, `true`, `false`); the Python signature
  block and the "Your solution" script instructions are dropped (the app shows
  the stub in the chosen language); a "## Notes" section says how trees and
  linked lists are written and when order does not matter. Ten sentences were
  reworded (`True` → true, `None` → "an empty list (no node)", `e // 2`,
  "Python's three-argument `pow`" as an example of what not to use). Before
  regenerating anything, the converter re-renders the v1 examples and tail
  with `dsa-tutor`'s own renderer logic and stops if the file differs, so no
  hand edit was lost. `len(x)` in constraints is kept as readable in any
  language. The T03 fixture `level-lists` keeps its older v1-style statement;
  it only exercises the loader.
- **`tests.json` stays compact** (one line, `stringifyJson`, as `dsa-tutor`
  wrote it) and is excluded from Prettier: 3.6 MB of mostly generated large
  inputs would grow several times and slow `format:check` for no reader.
  `meta.json` is Prettier-formatted.
- **`time_limit_ms` is 2000 for all 50.** `npm run validate:content` measures
  every reference on each run and fails if a stored limit is below
  `timeLimitFromReference(slowest)`. On Node Pyodide here the slowest test was
  62 ms (`min-daily-pages`), then 23 ms (`count-islands`), in line with D-15.
- **`npm run validate:content`** runs the references in Pyodide on Node worker
  threads through the execution host's own pool, runtime and harness (the
  path the executor tests use), not in Electron: no display or sandbox setup
  needed, so it runs in CI on all three OSes. About 70 s for the 50 problems,
  mostly worker start-up (each job gets fresh workers, D-14). It also checks
  that the references parse and no longer mention `dsa-tutor`'s scripts, and
  that every topic has a curated problem.
- **References** (`content/references/`): copied and adapted. Script commands
  became the tool names of SPEC §7.1 (`take_hint`, `read_solution`,
  `run_tests`, `record_attempt`, `set_profile`, `create_problem`,
  `render_explanation`...); "idiomatic Python" became idioms of the attempt's
  language (Python, Rust, Go examples); `problem_spec.md` uses neutral types
  and says references and brute forces are always Python. `topics.md` is
  unchanged but for one word; `scripts/content/topics.ts` parses it for the
  content scripts until T06 ports the catalog.


**D-20 SQLite storage: `node:sqlite`, schema version in `meta`, one write
queue** (2026-11-18, T05)

- **`node:sqlite`, Node's built-in SQLite, not better-sqlite3** (owner's
  choice, changing SPEC §3.2). better-sqlite3 13.1.1 was tried first. It is a
  Node-API addon with prebuilt binaries for every OS inside the npm package,
  and the same binary loaded under Node 22 (ABI 127) and Electron 45 (ABI
  150), so Electron never needed a rebuild. But npm 10.9 and 11.21 both
  ignore its `gypfile: false` and run `node-gyp rebuild` on `npm ci`
  because the package ships a `binding.gyp`. That failed CI on Windows (no
  Visual Studio found), and every developer would need a C++ toolchain.
  `node:sqlite` has nothing to install, compile, rebuild, or unpack from the
  asar in T13. It works unflagged in both runtimes (Node 22.23 for unit
  tests, Electron 45.3.4's Node 24.22 in the app; both bundle SQLite
  3.54.1), and everything storage uses exists in both: `DatabaseSync`,
  `isTransaction`, `setAllowUnknownNamedParameters`, `VACUUM INTO`.
  `npm run check:storage` proves it inside the real Electron main process
  on all three OSes in CI.
  Costs accepted: the API is still marked release candidate (stability
  1.2), so a Node or Electron upgrade may need small changes, which
  `check:storage` will catch; and Node 22 prints one `ExperimentalWarning`
  per test worker (Electron prints none). It has no `db.transaction()`
  helper, so `database.ts` has `transaction()`: `BEGIN IMMEDIATE` /
  `COMMIT` / `ROLLBACK`, with savepoints when nested. Rejected: keeping
  better-sqlite3 with `npm ci --ignore-scripts` plus selective rebuilds
  (every install becomes two steps), and installing Visual Studio on the CI
  runner (slower CI; developers still need a toolchain).
- **Schema version** is `meta.schema_version` (0 for an empty file), bumped
  in the same transaction as each migration. `meta.install_id` (a random
  UUID) is written by migration 1. A file with tables but no `meta` is
  refused as not ours. Migrations are `migrations/NNNN-name.sql`, imported
  as text (`?raw`) so they are bundled into the main process; a test checks
  the list in `migrations/index.ts` matches the folder.
- **Backup** before migrating an existing database, with `VACUUM INTO`
  (a consistent copy even in WAL mode) to `tutor.db.bak-<from-version>`; if
  that name is taken (an earlier attempt that rolled back) the next is
  `-2`, `-3`…, so an older backup is never overwritten. A newer database is
  refused before any pragma runs, so its file is byte-for-byte unchanged
  (tested). The app shows an error dialog with the data folder and quits.
- **Connection:** WAL, `synchronous = NORMAL`, `foreign_keys = ON`,
  `busy_timeout = 5000`; tables are `STRICT` with `CHECK`s on every enum
  column. `attempts.slug` has no foreign key to `problems` (curated problems
  come and go with updates; history stays). Hints, test runs and messages
  cascade from their attempt or thread. Upserts use `ON CONFLICT DO UPDATE`,
  not `INSERT OR REPLACE`, so re-saving a thread keeps its messages. JSON
  columns go through core's `stringifyJson`/`parseJson` (D-11), so a test
  report keeps exact 64-bit integers.
- **The `Storage` interface** (`packages/core/src/storage.ts`): synchronous
  reads (`read(fn)`); `write(fn)` queues a synchronous function and runs it
  in one transaction; `serial(task)` queues an async task (run tests, then
  record) and holds the queue until it settles, writing through the function
  it is given. Calling `write`/`serial` from inside a serial task throws
  (detected with `AsyncLocalStorage`) rather than deadlocking; an async
  function passed to `write` is refused and rolled back. Storage keeps records
  as given: validation and timestamps are the caller's (core injects time).
  The profile has the columns `dsa-tutor` used (`interview_date`,
  `hint_preference`) besides SPEC §4.2's main ones.
- **`settings.json`** is nested as the keys read (`{"ui": {"theme":
  "dark"}}`). The schema and lenient parsing are in core
  (`packages/core/src/settings.ts`) so the Settings UI can share them.
  Loading never fails: missing keys take defaults silently, invalid values
  take defaults and are reported (logged now, shown in Settings in T09), a
  file that is not JSON is copied to `settings.json.invalid` first. Changes
  from the app are strict (unknown or invalid keys refuse the whole change),
  written atomically (temp file + rename), keep unknown keys, and notify
  listeners with the changed keys. `tutor.model` is `null` (the backend's
  default) until T10 decides; `tutor.effort` is `low`/`medium`/`high` for now
  (T10 may widen it); `execution.timeScale` is limited to 0.5–10 like the
  clamp in D-15; `editor.fontSize` is an integer 8–40. The file is not
  watched for edits made while the app runs.

**D-21 Teaching logic and tools: ported as-is, over injected services**
(2026-11-19, T06)

`packages/core/src/teaching/` (ported from `dsa-tutor/dsa_tutor/core/state.py`,
`catalog.py`, the topics parsing in `common.py`) and `packages/core/src/tools/`
(from `dsa_tutor/tools/`). Behaviour is `dsa-tutor`'s: the ported learning
loop test (`test_learning_loop`) passes unchanged in substance, as do the
ported tool tests.

- **Injected, not imported:** `Teaching` takes `Storage`, a `ProblemCatalog`
  (`topics()`, synchronous `list()` in catalog order, async `load(slug)`), a
  `Workspace` (read / create-if-missing solution files) and a clock. The
  tools add `executorFor(language)`, `timeScale()`, a `SlugGuard` and,
  optionally, the T12 `createProblem` and T10 `renderExplanation` services.
  `memoryCatalog`, `memoryWorkspace` and `MemoryStorage` (the same queue and
  rollback contract as `SqliteStorage`) are exported for tests and UI work.
- **Levels are always derived from `attempts`**, as `dsa-tutor` derived
  `progress.json` from `attempts.jsonl`. Every state change also rewrites the
  touched topic's `topic_progress` row (level, unaided solves) as a cache for
  the UI. An attempt's topic comes from the catalog, else the `problems`
  index, so history on a problem removed by an update still counts once T08
  keeps that index; attempts whose problem is in neither are left out.
- **Open attempts are rows with `outcome` null** (`dsa-tutor`'s `active` map).
  `take_hint` and `record_attempt` open one if none is open, as before. The
  attempt keeps its language; a resumed attempt keeps it even if the profile
  language changes. `start_problem` refuses a language the problem does not
  list.
- **`onboarded`:** saving the profile through `set_profile` or the defaults
  sets it, as a saved `profile.json` meant onboarded in `dsa-tutor`. A profile
  row with `onboarded = false` (for T09, if it saves answers part-way) reads as
  not onboarded.
- **Runs and records:** `record_attempt` runs every test itself inside
  `storage.serial`, so no other write lands between the run and the record,
  then stores the redacted report as a `submit` test run. `run_tests` does
  not hold the write queue; it stores a `run` test run when an attempt is
  open. Both hold the slug in the `SlugGuard` (`busy` otherwise), shared with
  the UI's Run and Submit (T08), as `RUN_GUARD` was in `dsa-tutor`. Tool
  outputs carry the redacted report (`runView`): hidden cases keep `id`,
  `visibility`, `category`, `status`, `timeMs`; a load or executor failure is
  `run_error`, not `error`, because `error` means the tool failed.
- **Tool results** stay `dsa-tutor`'s compact snake_case JSON (the ported
  descriptions name those fields). The registry validates inputs with the
  ported JSON Schema subset validator, so one schema serves the API, MCP and
  validation; handlers throw `TutorError` (with a `code` where useful:
  `not_onboarded`, `no_problem`, `invalid_slug`, `no_language`,
  `runtime_missing`) and anything else becomes `internal error in <tool>`,
  logged, never shown to the model.
- **Small changes from `dsa-tutor`:** `interview_date` must be a real
  calendar date (not only `YYYY-MM-DD`-shaped); `next_problem` picks only
  problems offered in the learner's language; `get_problem` adds `language`,
  `languages` and `code_signature` (the Python `def` line); the starter file
  says to use Run tests in the app instead of naming a script; `take_hint`'s
  `guide` is `hint_ladder.md`; `start_problem` returns `language`, not a
  problem path. The topics parser is stricter (bad rows, duplicate ids and
  unknown prerequisites are errors) and is now also what the content scripts
  use.


**D-22 Practice UI over IPC: shapes, refusals, files, routes, theme**
(2026-11-19, T08)

- **One practice service for buttons and tools.** `main/practice/service.ts`
  (`Practice`) does Run, Submit, Give up and the reference over core's
  `Teaching`, `runProblemTests` and `runView`, with the same `SlugGuard` the
  tutor's tools get from `practice.toolContext` (T10 builds its registry from
  it), so a button and a chat tool never run one problem at once. Submit runs
  every test inside `storage.serial` and records only when all pass (as
  `dsa-tutor`'s `/submit`); otherwise the attempt stays open and the run is
  stored on it. Saving while the problem's tests run is refused (`busy`), as
  in `dsa-tutor`.
- **IPC shapes** (`shared/practice.ts`) keep `dsa-tutor`'s snake_case names
  so the ported UI keeps its fields. Test values cross as JSON text from
  core's `stringifyJson` (exact 64-bit integers, D-11), never as live values.
  Hidden cases have their own strict schema (`id`, `visibility`, `category`,
  `status`, `time_ms`); since the router parses every reply, a hidden input
  cannot reach the renderer even if a handler forgot `redactReport`.
- **Refusals.** The IPC envelope (D-17) gains code `refused` with a
  `reason` (`busy`, `locked`, `no_solution`, `not_onboarded`, `no_problem`,
  `runtime_missing`…): handlers throw `IpcRefusal`; core's `TutorError`
  maps to it with its `code`. Refusals are not logged as errors.
- **Problems on disk.** `FileCatalog` loads and validates `content/problems/`
  (curated only) and `<data>/problems/{generated,imported}/` (never curated)
  at start-up; an invalid problem is left out and logged, not half-loaded.
  It upserts the `problems` index (never deletes, so history keeps its
  topic). `content/` is the repository's in development and
  `<resources>/content` when packaged (T13 must ship it there).
- **Solution files.** `FileWorkspace` writes atomically (temp + rename) and
  caps a solution at 200 000 bytes. "Edited in another editor" is
  `fs.watch` on the problem's folder (the file is replaced on every atomic
  save), debounced 120 ms, reported only when the content differs from what
  the app last wrote or read, over the `workspace:watch` stream. The open
  editor takes the new text unless it has unsaved edits; then it keeps them
  and offers "Load the file's version".
- **Routes in the hash** (`#/p/<slug>`): the app protocol serves files, with
  no fallback to `index.html`, so `dsa-tutor`'s history routes would break on
  reload. In-page navigation does not fire `will-navigate`, so D-17's
  navigation block is unchanged.
- **Theme.** `ui.theme` sets `nativeTheme.themeSource` at start and on change,
  so `prefers-color-scheme` follows the setting in every window and the
  ported CSS and CodeMirror theme switch need no theme code of their own. The
  picker is in the top bar until Settings exists (T09).
- **End to end.** `npm run e2e` drives the built app with Playwright for
  Electron (`playwright-core`; no browser download) in a temp data folder.
  Playwright emulates a light colour scheme unless launched with
  `colorScheme: null`.
- **Versions pinned:**

  | Package | Version | Note |
  |---|---|---|
  | codemirror | 6.0.2 | With @codemirror/state 6.7.6, view 6.43.15, commands 6.11.1, language 6.13.1, lang-python 6.2.1, theme-one-dark 6.1.3 (as `dsa-tutor`). |
  | marked | 18.1.3 | 18.2.x was under two weeks old. |
  | dompurify | 3.4.17 | 3.4.18 was under two weeks old. |
  | @testing-library/react / dom | 16.3.3 / 10.4.2 | Dev. |
  | jsdom | 30.1.3 | Dev; 31.0 was under two weeks old. UI tests opt in per file (`@vitest-environment jsdom`). |
  | playwright-core | 1.64.1 | Dev; `npm run e2e`. |


**D-23 Tutor: Anthropic backend checked, default model, chat over IPC**
(2026-11-19, T10; resolves the §14 default-model DECISION and the Anthropic
VERIFY)

- **Default model `claude-opus-5-5`** (`tutor.model: null`), never
  date-suffixed: the current Opus and the default the API documentation
  recommends. `tutor.model` overrides it. Effort is sent explicitly from
  `tutor.effort` (`low` / `medium` / `high`, default `medium`), because Opus
  5.5's own default is `medium` and other models default to `high`.
- **The `dsa-tutor` notes, re-checked** against the current API docs and
  `@anthropic-ai/sdk` 1.5.0, all hold: every request streams
  (`client.beta.messages.stream` + `finalMessage()`); `thinking: adaptive`
  (Opus 5.5 rejects `disabled` and `budget_tokens`); `tool_choice` left at
  `auto` (forced choice is a 400 on Opus 5.5); no sampling parameters (a 400
  from API version 2026-10-21); `eager_input_streaming: true` on every tool,
  with every input validated by the registry before a handler runs;
  `stop_reason` checked before content is used (`refusal` ends the turn and
  keeps nothing, with `stop_details.category` in the message; `max_tokens`
  never runs a tool call and answers each with an error result; `pause_turn`
  continues; `model_context_window_exceeded` asks to reset the chat);
  assistant content replayed unchanged (Opus 5.5 checks thinking blocks
  against the conversation, so the transcript is append-only, also on
  cancel); a cache breakpoint on the system prompt (which covers the tools,
  rendered first) plus top-level automatic caching for the conversation;
  server-side refusal fallback on by default for the models that take it
  (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`), with the
  declined attempt's model-internal blocks before a `fallback` block dropped
  when echoing; SDK errors mapped by class, most specific first
  (`APIUserAbortError` → cancelled, `APIConnectionError` incl. timeouts →
  network, 401/403 → auth, 429/529 → rate_limit, others → other with the
  API's own message, the key redacted). The SDK's own retries (2) stay on.
- **Not used** (yet): message threads, compaction, context editing, task
  budgets, `display: "updates"` progress notes. A chat that outgrows the
  context window is reset by the learner.
- **Turns are streams.** `chat:send` is an IPC stream; its cancel aborts the
  turn's signal, which aborts the HTTP stream. A tool already running
  finishes and its result is recorded before the turn ends as `cancelled`.
  One turn per thread (`busy` otherwise); reset is refused while one runs.
- **Stream results travel after their events.** In the real app the invoke
  reply to `STREAM_START` overtook the last `STREAM_EVENT`s (different IPC
  pipes), and the preload dropped them: the tutor's `open_problem` was lost.
  The router now also sends the result on the event channel, in order, and
  the preload resolves from that message (replies refused before a stream
  starts still come back at once). The renderer also shows the stored reply
  if a turn's last event is ever missing.
- **Context comes from main.** The renderer sends only the editor's code
  (after saving it); main adds the problem, title, language and the open
  attempt's last stored (already redacted) test report. `compactReport`
  keeps only id, category and status of hidden cases, a second guard.
  `show_results` UI events are converted to the practice `reportView`, whose
  strict schema already keeps hidden data out of the renderer.
- **Threads.** `threads.backend_state` holds `{ <backend>: state }`, so
  switching backends keeps both. "Reset chat" archives with the new storage
  operation `archiveThread`: the thread and its messages move to
  `<id>~<n>` with `archived_at` set (the `threads` key is the id, so the
  archived copy needs its own), no migration needed.
- **System prompt.** The `SKILL.md` sections are kept as rewritten text in
  `core/tutor/rules.ts` instead of `dsa-tutor`'s start-up regexes; the
  `content/references/` guides are appended as they are (already written for
  tools in T04). `problem_spec` and the generate rows appear only when
  `create_problem` is offered (T12). The prompt is built once at start-up.
- **Explanations.** Rendered in core (`renderExplanationPage`; Python
  highlighting by a small scanner instead of Python's tokenizer), stored by
  main as `explanations/<slug>/<YYYYMMDDTHHMMSSmmmZ>.html`, newest 20 kept;
  shown in an iframe with an empty `sandbox` through `srcdoc` with its own
  CSP meta, which works under the UI's `frame-src 'none'` (checked in the
  real app by the e2e).
- **Backend choice.** `auto`: Anthropic when a key is set, else none
  (Claude Code joins in T11); `claude-code` is "not supported yet" until
  T11. The key is `ANTHROPIC_API_KEY` from the environment until T09 adds
  the keychain. `ALGOTUTOR_FAKE_TUTOR=<script.json>` replaces the choice;
  fake scripts can refer to `$context.slug`.
- **Versions pinned:**

  | Package | Version | Note |
  |---|---|---|
  | @anthropic-ai/sdk | 1.5.0 | 1.6.0 and later were under two weeks old. |

**D-24 Settings, keychain and data: async safeStorage, staged import and
reset, export layout** (2026-11-19, T09; resolves the §14 safeStorage VERIFY)

- **`safeStorage`, checked against Electron 45.3.4** (its bundled API docs,
  `electron.d.ts`, and a probe run in the real app): the synchronous
  `isEncryptionAvailable` / `encryptString` / `decryptString` are
  deprecated in favour of `isAsyncEncryptionAvailable`,
  `encryptStringAsync` and `decryptStringAsync` (which also says when to
  re-encrypt, after a key rotation). On Linux without a keyring (Xvfb, no
  D-Bus) the old `isEncryptionAvailable()` returned `false` while the
  asynchronous API worked, with `getSelectedStorageBackend()` =
  `basic_text` (ciphertext prefix `v10`, plain key not in it), and the
  synchronous `decryptString` could not read what the asynchronous one
  wrote. So the app uses the asynchronous API only (`main/secrets/`).
  `getSelectedStorageBackend()` is called only on Linux and only after
  ready (it returns `unknown` before); `basic_text` shows the weak-storage
  warning in Settings and onboarding, and storing still works (SPEC
  §4.4). If the asynchronous encryptor is unavailable, storing is refused
  and Settings points to `ANTHROPIC_API_KEY`.
- **The key** is a JSON object encrypted whole into `secrets.bin` (mode
  0600, written atomically). `ANTHROPIC_API_KEY` wins over a stored key
  and is shown read-only. Main sends the renderer only `source`, `…abcd`,
  whether a key is also stored, and the storage backend; the key crosses
  IPC once, renderer to main, when the user saves it, and the field is
  cleared. A file that cannot be decrypted is reported without quoting the
  error. Shape check only (20–400 printable ASCII characters); the API
  decides.
- **Test connection** is `GET /v1/models/{model}` with the key in use
  (spends no tokens, checks key and model together); 404 says the model
  is unknown. `@anthropic-ai/sdk` 1.5.0 sends the API key as
  `Authorization: Bearer`, not `x-api-key` (seen in the e2e's stand-in
  server; the API accepts both).
- **Settings apply at once** without new plumbing: the tutor already reads
  backend, model and effort for every turn, practice reads the time scale
  for every run, and a settings listener sets `nativeTheme.themeSource`.
  `settings:get` / `settings:set` replace T08's `settings:theme` channels,
  and the theme picker moved from the top bar to Settings. An empty model
  means the default (`null`). Settings shows the `settings.json` problems
  found at start (D-20).
- **Editor settings:** font size through a CodeMirror theme compartment;
  Vim and Emacs bindings from `@replit/codemirror-vim` /
  `@replit/codemirror-emacs` in a compartment placed before the default
  keymaps. `execution.runtime` is not shown (v2); the Updates section
  saves channel and auto-update, and says checking is not set up yet (T13).
- **Export** is one zip (fflate, in memory; fine at this data size):
  `manifest.json` (`format: algorithm-tutor-export`, `version: 1`, app
  version, schema version, time), `tutor.db` from `SqliteStorage.snapshot`
  (`VACUUM INTO`, queued behind writes, consistent in WAL mode; used rather
  than the SQLite online-backup API, which `node:sqlite` exposes only on
  newer Nodes, and already used for migration backups in D-20),
  `settings.json`, `workspace/`, `problems/generated/`,
  `problems/imported/`, `explanations/`. Never `secrets.bin`, `backups/`,
  `pending/`, `cache/` or `logs/`; symlinks and temp files are skipped.
- **Import** reads the whole zip and refuses it unless every name is a
  plain relative path inside that layout (no `..`, `\`, `:`, absolute
  paths), counts and sizes are within limits (20 000 entries, 256 MB per
  file, 1 GB in all, checked on the declared sizes before inflating and
  again after), the manifest is ours and not newer, `tutor.db` passes
  `PRAGMA quick_check` and has a schema version this app knows, and
  `settings.json` is JSON. Then it exports the current data to
  `backups/<time>-before-import.zip`, writes the files to
  `pending/data/` with `pending/op.json` last, and restarts. At the next
  start, before the database opens, `applyPending` removes the current
  items and moves the staged ones in (no file is replaced while open,
  which matters on Windows). A stage without `op.json` is discarded; one
  without `tutor.db` is refused and changes nothing. The stored key stays
  (it is per machine).
- **Reset progress** (live, `Storage.resetProgress`): deletes attempts
  (hints and test runs cascade) and topic levels; keeps the profile,
  chats, solutions, settings and problems. **Reset everything** is staged
  like an import and at the next start removes the database, settings,
  workspace, own problems, explanations, cache, `tutor.db.bak-*` and the
  stored key. Both confirm with a native dialog in main (a compromised
  renderer cannot skip it) and export to `backups/` first; backups are
  never pruned or reset. Only the app's own items are removed: the data
  folder is Electron's `userData` by default, which also holds Chromium's
  files.
- **Onboarding** saves the five answers in one `profile:set` (mapped to
  core's `setProfile` pairs; comfort groups come from the topics) or the
  defaults, then offers "Connect the tutor" unless a tutor is already
  available (e.g. `ANTHROPIC_API_KEY`). Claude Code joins that step in T11.
- **Versions pinned:**

  | Package | Version | Note |
  |---|---|---|
  | fflate | 0.8.3 | Zip for export / import; pure JS, no dependencies. |
  | @replit/codemirror-vim | 6.3.0 | 6.4.0 pulls a new `-vim-core` package; 6.3.0 has none. |
  | @replit/codemirror-emacs | 6.1.0 | |

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

**D-25 Claude Code backend: API key only, bare mode, key through a loopback
relay, own MCP server** (2026-11-19, T11; resolves the §14 Claude Code VERIFY)

- **Terms: a Claude subscription login is not used.** Checked against the
  current Claude Code docs (`code.claude.com/docs/en/legal-and-compliance`,
  `…/agent-sdk/overview`, `…/authentication`). They say: "Anthropic does not
  permit third-party developers to offer Claude.ai login into their own
  applications, or to route requests through Free, Pro, Max, or Ultra plan
  credentials on behalf of their users"; developers "may not collect, store,
  or intermediate Claude.ai credentials or session tokens"; products built
  on Claude's capabilities "should use API key authentication"; and the
  Agent SDK page: "Unless previously approved, Anthropic does not allow third
  party developers to offer claude.ai login or rate limits for their
  products". The carve-out ("an end user signing in to the unmodified Claude
  Code binary with their own Claude subscription") covers people using Claude
  Code themselves, not an app that drives it for its own feature. At best
  this is unclear, so the SPEC default applies: **Claude Code with an API key
  only**. Asking Anthropic (the docs point to sales) could reopen it.
- **Bare mode enforces it.** `claude --bare` "never reads OAuth credentials
  or the system keychain"; Anthropic auth is `ANTHROPIC_API_KEY` only. It also
  skips hooks, plugins, CLAUDE.md, auto memory, skills and subagents, and
  connects only the MCP servers given on the command line; the docs call it
  "the recommended mode for scripted and SDK calls". The init line of every
  recorded run says `apiKeySource: "ANTHROPIC_API_KEY"`.
- **The key stays in the main process** (SPEC §4.4) through a relay
  (`tutor/claude-code/api-proxy.ts`): the CLI gets `ANTHROPIC_BASE_URL` =
  `http://127.0.0.1:<port>` and a random per-turn token as its
  `ANTHROPIC_API_KEY`; the relay accepts only loopback `POST /v1/messages` and
  `/v1/messages/count_tokens` with a live token, swaps in the real key and
  streams the answer back. Tokens die with the turn. Upstream is the main
  process's `ANTHROPIC_BASE_URL` or the real API (as for the SDK).
- **So Claude Code needs the same key as the Anthropic backend.** `auto`
  stays "Anthropic if a key is set, else none"; Claude Code is chosen
  explicitly. What it adds is Claude Code's own agent loop and the user's
  choice of it; with a subscription ruled out, little else. Onboarding's
  tutor step stays the key form.
- **Agent SDK not used.** `@anthropic-ai/claude-agent-sdk` bundles its own
  native Claude Code binary (an optional dependency per platform) and spawns
  it; it would add a large binary for a feature meant to use the user's own
  installation, and its auth rules are the same. The app spawns the user's
  `claude` directly with the same stream-json protocol.
- **The command** (checked against Claude Code 2.1.328: `claude --help`,
  the CLI reference and headless docs, and runs of the real CLI through the
  backend): `--bare -p --input-format text --output-format stream-json
  --verbose --include-partial-messages --system-prompt-file <f> --tools ""
  --mcp-config <f> --strict-mcp-config --allowedTools mcp__tutor__<a>,…
  --permission-mode dontAsk --setting-sources "" --disable-slash-commands
  --max-turns 24 --model <m> --effort <e> [--resume <id>]`.
  `--system-prompt-file` and `--max-turns` work but are no longer listed in
  `--help` (they are in the CLI reference). `--tools ""` removes every
  built-in tool; MCP tools are limited by `--strict-mcp-config` (only ours)
  and `dontAsk` (only pre-approved calls run). The environment is built from
  nothing (search path, OS basics, `HOME`/`USERPROFILE`/`CLAUDE_CONFIG_DIR` =
  `<data>/agent-home`, temp dirs under it, the relay URL and token, switches
  off for auto-update, telemetry, error reporting and non-essential traffic,
  `NO_PROXY` for loopback, no proxy variables); `cwd` is an empty scratch
  directory; the MCP token is only in a `0600` config file in a per-turn
  `0700` directory deleted after the turn.
- **Minimum version 2.1.328**, the one checked; older ones are refused with
  "run `claude update`". Detection: `tutor.claudeCodePath` (new setting,
  absolute), else `PATH`, else the installers' places (`~/.local/bin`,
  `~/.claude/local`, `/opt/homebrew/bin`, `/usr/local/bin`; an app started
  from the macOS Dock has no shell `PATH`). On Windows only `claude.exe`
  (the native build) is started: `.cmd` shims need a shell. Cached; Settings'
  Recheck or a new path looks again. "Signed in" is not checked: the CLI's
  own login is never used.
- **MCP server written by hand** (`main/mcp/`), not `@modelcontextprotocol/sdk`
  1.32.2 (which would bring Express, Hono and about fifteen packages into the
  main process): Streamable HTTP, stateless, JSON responses, one message per
  POST (batches left the protocol in 2025-06-18); `initialize` (versions
  2025-11-25, 2025-06-18, 2025-03-26), `ping`, `tools/list`, `tools/call`;
  `GET`/`DELETE` 405. Checks before the body is read: loopback peer,
  loopback `Host` and `Origin` (DNS rebinding), a live bearer grant (SHA-256
  hashed, 15-minute expiry, revoked at turn end); the grant is looked up
  again when a call runs. The real CLI connects to it (`status: connected`
  in the fixtures) and calls tools through it.
- **Turns** (ported from `dsa-tutor`): one process per turn in its own
  process group; stream-json parsed as before (auth retries end the turn
  at once, rate limits after 3); the CLI's session id is kept in
  `backend_state` and resumed, with one fresh retry plus a transcript recap
  if the session is gone; cancel and the 10-minute limit kill the group and
  wait (up to 60 s) for a tool already running so its result is reported.
- **Fixtures** `tutor/claude-code/fixtures/{turn,auth}.jsonl` were recorded
  from Claude Code 2.1.328 through the real backend, MCP server and relay,
  with the relay pointed at a loopback stand-in for the Messages API
  (`record.ts`, `mock-messages-api.ts`); no provider was contacted. Unit tests
  replay them through a fake CLI (`fake-claude.mjs`) that makes real MCP
  calls. `ALGOTUTOR_TEST_CLAUDE=<claude>` adds a Vitest case with the real
  CLI, and `npm run e2e:claude-code` runs it in the real app.
- **Data:** `<data>/agent-home/` holds the CLI's sessions; never exported,
  removed by "reset everything".

**D-26 New problems: intake ported as-is, self-check through the executor,
Exercism pinned, Node `fetch`** (2026-11-19, T12)

- **Ported as-is** from `dsa-tutor/dsa_tutor/intake/` and `core/problems.py`
  (`create`): one authoring conversation per job with only an intake
  `create_problem` (no `origin` in its schema; `source`, `origin`,
  `origin_text` dropped from the model's spec), topic and difficulty
  enforced, 4 calls in all (first + 3 repairs), a repair turn when a turn
  ends without a problem, `NOT_A_PROBLEM:` ends a paste or import, one job
  at a time, 15-minute limit, events replayable from the start. The
  recordings of `web/tests/fixtures/intake/*.sse` live on as
  `packages/core/src/intake/fixtures/events/*.json`: core's tests assert the
  jobs produce them exactly, the UI tests replay them.
- **Self-check** (`core/intake/create.ts`): shape checks, then the brute
  force fills missing expected values (10 s per test), then the reference
  must pass every test at the base limit (2000 ms per test); the stored
  `time_limit_ms` is `timeLimitFromReference(slowest)` (D-15). The files are
  then loaded back with the catalog's own `loadProblem` before anything is
  written, so a saved problem always loads. Every test is sent to the
  executor as `visible` so the report keeps each actual value; that report
  never leaves the self-check. Folders are staged under
  `problems/.staging/` and renamed into `problems/generated/<slug>/` or
  `problems/imported/<slug>/` (pasted and imported, with `origin.md` or
  `NOTICE.md`), then the catalog reloads.
- **Pyodide only:** `createProblem` asks its executor registry for
  `pyodide` and refuses an executor whose `id` is anything else, so v2's
  local and container executors can never run model-written code. Tests:
  core (`create.test.ts`, a registry with all three ids) and main
  (`intake/intake.test.ts`, the real Pyodide pool next to spies for `local`
  and `container`; the learner's own `executorFor` points at `local` there
  and is never used).
- **What the UI sees of a failure:** test id, category, status and error
  type; the final error adds the message of visible tests only (a message
  can quote an input). The IPC schemas (`shared/intake.ts`) are strict, so
  the router drops anything else.
- **The chat tutor** gets `create_problem` too (SPEC §7.1), over the same
  factory and slug guard; an `origin` it passes must match `originSchema`.
- **Exercism:** the index (35 entries at commit `84a9685…`) and `LICENSE`
  are copied unchanged from `dsa-tutor` to `content/open-sets/exercism/`.
  Re-checked on 2026-11-19: the `LICENSE` at the pinned commit on
  `raw.githubusercontent.com` is byte-identical to the shipped copy (MIT,
  "Copyright (c) 2014, 2019, 2021 Exercism"), and the pinned files are
  served there. Imported problems record `license: "MIT"` and the copyright
  line in `meta.origin` and keep the full licence in `NOTICE.md`.
  `validate:content` checks the index loads against the topics.
- **Fetching** (`main/intake/fetch.ts`) keeps every rule of `dsa-tutor`'s
  fetcher (https on `raw.githubusercontent.com` only, same-host redirects
  only, at most 3, 15 s per request and 30 s per fetch, 1 MB cap, cache in
  `<data>/cache/open-sets/`). It uses Node's `fetch` (undici) in the main
  process with `redirect: 'manual'`, which returns the 3xx response with its
  `Location` header, so redirects are checked by hand as the tests assume.
  Electron's `net.fetch` was not used: it follows Chromium's fetch, where a
  manual redirect may come back as an opaque response without the header
  (not checked). Node's `fetch` does not use the system proxy settings;
  behind a proxy that needs configuring, an import fails with a
  `fetch` error. Not checked against the live host from the app.

**D-27 Packaging and updates: one bundled main process, fuses in afterPack,
GitHub drafts, unsigned until secrets exist** (2026-11-19, T13)

- **Code signing (the SPEC §11 DECISION): resolved, default kept.** v1 ships
  unsigned. `release.yml` signs only when its secrets exist: macOS
  `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` (notarized with
  `APPLE_API_KEY_P8` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER`, and only
  when signing), Windows `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`. Without
  them macOS sets `CSC_IDENTITY_AUTO_DISCOVERY=false`. Consequences to put
  in the README (T14): Gatekeeper blocks the unsigned app until it is
  allowed in System Settings, Windows SmartScreen warns, and **macOS cannot
  install updates** (Squirrel.Mac requires a signed app; the download works
  and the install fails with an error shown in Settings → Updates). No
  certificates exist yet; no signed build was made.
- **No `node_modules` in the app.** electron-vite externalizes a package's
  `dependencies`, and electron-builder copies them into the asar from the
  npm workspace. Every desktop package is now a `devDependency`, so the main
  process is one bundle (`@anthropic-ai/sdk`, zod, fflate and
  electron-updater included; only `electron` and `node:` built-ins stay
  external, checked in `out/main`) and electron-builder copies nothing
  ("no node modules returned"). `npmRebuild: false`: nothing is native
  (D-20). `app.asar` is 18 MB, mostly Pyodide. Rejected: keeping
  `dependencies` and filtering `node_modules` with `files` patterns (renderer
  packages such as Pyodide and CodeMirror would be packed twice and
  workspace hoisting is fragile).
- **Fuses** (D-17): `packaging/package.ts` runs electron-builder with
  `electron-builder.yml` plus an `afterPack` hook that calls `applyFuses`
  and reads every fuse back, failing the build on a mismatch. afterPack runs
  after the asar integrity data is embedded (macOS, Windows) and before
  signing. electron-builder's own `electronFuses` option was not used: it
  would duplicate the table in `fuses.ts`.
- **Targets** (SPEC §11): macOS `dmg` + `zip` for x64 and arm64 (per arch,
  not universal; the zip is what the macOS updater downloads), Windows
  `nsis` x64 (assisted installer, per user), Linux `AppImage` + `deb` x64.
  App id `io.github.hqazi.algorithmtutor`, executable `algorithm-tutor`, no
  file associations. Icon `build/icon.png` (1024², electron-builder makes
  the `.icns` / `.ico`). `content/` ships as `<resources>/content` (D-22);
  the app's `LICENSE` and a Pyodide MPL-2.0 notice ship in
  `<resources>/notices/` (T07's open licence item).
- **Channels, checked in electron-updater 6.8.11's source**
  (`GitHubProvider.getLatestVersion`, `AppUpdater`): `stable` sets
  `allowPrerelease = false`, which follows GitHub's `/releases/latest`
  (published, non-pre-release only). `beta` sets `allowPrerelease = true`:
  from a stable version it takes the newest release in the feed, from a
  beta version the newest `beta` or stable one, and reads `beta*.yml` for a
  `-beta.N` tag (falling back to `latest*.yml`). The updater's `channel`
  property is never set: setting it turns `allowDowngrade` on. Switching
  beta → stable does not downgrade; the next stable release above the
  installed beta arrives as usual. Drafts are invisible to installed apps.
- **Updater behaviour** (`main/updater/`): automatic updates on → first
  check 30 s after start, then every 4 hours, background download, install
  on quit; off → no background checks, "Check now" and "Download" in
  Settings. A downloaded update always installs on quit and offers "Restart
  to update" (`quitAndInstall(false, true)`). Errors show in Settings and
  never discard a finished download. Development builds report
  `unsupported`. State reaches the UI over the `updates:watch` stream.
- **Release workflow** (`.github/workflows/release.yml`): on `vX.Y.Z` or
  `vX.Y.Z-beta.N` tags. One job creates the draft first (`gh release
  create --draft --verify-tag`, `--prerelease` for betas, so concurrent
  builds cannot create duplicates; electron-builder uploads to an existing
  draft for the tag). Three OS jobs set the version from the tag
  (`package.json` stays `0.0.0`), run the unit tests, package with
  `--publish always` (`releaseType: draft`), then start the packaged app
  (`packaging/smoke.ts`). A maintainer publishes the draft.
- **Checked here (Linux x64 only):** `npm run package` builds the AppImage
  and deb; the deb installs with apt and the installed app, the AppImage and
  the unpacked app pass `smoke.ts` (problems from `<resources>/content`,
  Python in Pyodide out of `app.asar` with the fuses flipped, updater
  present). `packaging/update-check.ts`: a 0.0.1 AppImage updated itself
  to 0.0.2 from a local feed (`--feed`, generic provider) through the same
  IPC as Settings, the file was replaced and relaunched as 0.0.2. Not
  checked: the GitHub provider against real releases, macOS and Windows
  builds, signing, notarization, and the workflow itself (never run: no
  tag was pushed).

**D-28 Versions pinned in T13** (2026-11-19, T13)

| Package | Version | Note |
|---|---|---|
| electron-builder | 26.18.1 | Desktop dev dependency; also downloads Electron, appimagetool and fpm at package time. |
| electron-updater | 6.8.11 | Bundled into the main process. The update check (D-27) ran with this version; 6.8.12 is newer and untried. |

**D-29 Rust and Go harnesses: `i64`, no crates, a nonce-marked stdout
protocol** (2026-11-19, T15; resolves the Rust `int` DECISION)

- **Rust `int` is `i64`** (the default): the format promises the 64-bit range
  (D-11), so `i32` would reject or wrap valid tests. Go `int` is 64-bit on
  every platform the app ships for.
- **Type mapping** (SPEC §5.2, now final). Rust: `i64`, `f64`, `bool`,
  `String`, `char`, `Vec<T>`, `(A, B)`, `HashMap<String|i64, T>`,
  `Option<T>`, `Option<Rc<RefCell<TreeNode>>>`, `Option<Box<ListNode>>`, owned
  arguments (the LeetCode shapes). Go: `int`, `float64`, `bool`, `string`,
  `rune`, `[]T`, a struct per tuple type (`Tuple`, or `Tuple1`, `Tuple2`… when
  a signature has several; fields `V0`, `V1`…), `map[string|int]T`, `*T`,
  `*TreeNode`, `*ListNode`. A returned Go nil slice is `[]`; an empty tree or
  list is `[]`, as in Python.
- **Node types are concrete** (`val: i64`, `Val int`, or the element type of
  the signature's trees/lists). So Rust and Go need every `tree` in a
  signature to share one element type, and every `linked_list` too
  (`compiledHarnessLimit`); all 50 curated problems qualify and now list
  `["python", "rust", "go"]`.
- **Names.** Rust keeps snake_case; keywords become raw identifiers
  (`r#type`), and `self`/`super`/`crate` get a trailing `_`. Go uses
  lowerCamelCase (`level_lists` → `levelLists`); keywords, predeclared names
  (`len`, `string`, …) and `main`/`init` get a trailing `_`. Harness
  identifiers in Go start with `harness`.
- **No `serde_json`** (the ticket suggested it, vendored or cached). The
  Rust runtime has a ~280-line JSON reader/writer (`content/runners/rust/json.rs`)
  and the project has no dependencies, so `cargo build --offline` works with
  no registry cache: in `--network none` containers (§6.5), on offline
  machines, and with nothing for T19 to pre-fetch. Integers parse to `i64`
  exactly; `\u` escapes and surrogate pairs are handled; covered by the
  round-trip check. Go uses `encoding/json` with `UseNumber`. Rejected:
  vendoring serde/serde_json (a lot of third-party source in the repo for
  two functions), relying on a cached registry (first build needs network).
- **Protocol** (`langs/common.ts`): stdin is a `{"nonce": …}` header line
  then one input object per test; the harness reads all of stdin before any
  solution code runs. After each test it writes `\x1e<nonce> {record}\n` to
  stdout; text printed between records is that test's stdout, so solutions
  can print freely and cannot forge a record without the nonce. Records:
  `ok` (`actual` as a JSON value, `time_ms` around the call only), `error`
  (`panic` with the line in `solution.rs`/`.go` when found, or `output`),
  `fatal` (bad input: the run fails as a harness error).
  `parseHarnessStream` maps a missing record to `timeout` (the executor
  killed it) or `crash` (process died: stack overflow, `process::exit`,
  a panic in a goroutine), and skips the rest.
- **Build settings.** Rust: release profile with `overflow-checks = true`
  (overflow panics instead of wrapping silently) and line tables (panic
  lines); the solution runs on a 512 MB-stack thread for deep recursion
  (overflow still aborts: reported as a crash). Go: `go 1.22` in `go.mod`
  (range-over-int works; an older Go may try to download a toolchain, so
  T16 should run with `GOTOOLCHAIN=local`).
- **Offered vs. supported.** `languageSupports` (content validation) knows
  Rust and Go now; `languagesWithHarness()` (what profiles, tutor tools and
  new problems may use) stays `["python"]` until an executor runs them
  (T16/T17), and `teaching.start` refuses languages not offered. (Superseded by D-30: T16 offers Rust and Go.)
- **Checked with** cargo 1.97.0 and go 1.24.7 on Linux (`npm run
  check:harnesses`, CI job `harnesses`). Not checked: macOS and Windows,
  older toolchains.

**D-30 Local toolchain executor: per-test kill timer, respawn, offered
always** (2026-11-19, T16)

- **Rust and Go are offered whether or not the toolchain is installed**
  (`languagesWithHarness()` is now `python, rust, go`). Profiles, the tutor's
  tools and new problems can name them; a run without `cargo` / `go` is
  `runtime-missing` with what to install, and the language picker marks the
  language "not installed" (with the reason). Rejected: making the offered
  set depend on detection — core would need runtime state, and a profile
  choice would change meaning when a toolchain is removed.
- **Cache key:** `RunJob.slug` (new, optional; SPEC §6.1), else
  `sig-<sha256 of the signature>`. A stamp file holds a hash of every
  project file, the toolchain version and the platform; when it matches and
  the binary exists the build is skipped. Files are written only when their
  content changed (mtimes kept), so `cargo` / `go build` stay incremental.
  One job at a time per project folder.
- **Timeouts:** one harness process for all tests (start-up is paid once);
  the kill timer is re-armed with `limit + 250 ms` at each result line (the
  first test also gets 1 s for start-up). On timeout or crash the process
  tree is killed and a fresh process runs the remaining tests, so one
  endless loop costs one test, as in Pyodide. POSIX: the child is spawned
  detached (its own process group) and the group gets SIGKILL, also after a
  normal exit (left-over children). Windows: `taskkill /pid <pid> /T /F`
  (not a job object: no native module needed). Output over 32 MB kills the
  run (reported as a crash).
- **Environment:** the app's environment without `ANTHROPIC_*`,
  `ELECTRON_*`, `ALGORITHM_TUTOR_*`, `GOFLAGS`, `NODE_OPTIONS`; PATH plus
  `~/.cargo/bin`, `/usr/local/go/bin`, `/opt/homebrew/bin`, `/usr/local/bin`,
  `~/go/bin` (Windows: `~/.cargo/bin`, `C:\Program Files\Go\bin`), because
  an app started from the desktop may not get the shell's PATH;
  `GOTOOLCHAIN=local` (D-29), `GOPROXY=off` (no module downloads; the project
  has no dependencies), `CARGO_TERM_COLOR=never`. On Windows only `cargo.exe`
  / `go.exe` are accepted (no shell for `.cmd`); Go builds `harness.exe`.
- **Compile errors:** `load-error` with type `compile error`; Rust keeps
  only `error…` blocks (not warnings or "could not compile"), Go drops the
  `# package` line; the project folder is replaced by `.`; the line is the
  first `solution.rs:N` / `solution.go:N`.
- **Language switch** (`problems:language`, `Teaching.switchLanguage`):
  saves, then updates the open attempt's language (or opens one) and
  creates the language's file from the stub if missing. The attempt is
  recorded in the language it ends in. The editor highlights Python only
  (no new CodeMirror language packages); Go indents with tabs.
- **Checked with** cargo 1.97.0 and go 1.24.7 on Linux (Vitest suites that
  run when the toolchain is on PATH). Not checked: macOS and Windows.

**D-31 Container executor: one hardened container per job, a per-job
`exec` tmpfs for the build** (2026-11-19, T17; resolves the Rust target-dir
DECISION in SPEC §6.5)

- **Detection** (`main/runtimes/`): `podman info --format json` and
  `docker version --format json`, with the app's environment (minus
  `ANTHROPIC_*`, `ELECTRON_*`, `NODE_OPTIONS`) and PATH plus the installers'
  folders (Docker Desktop's and Podman's on macOS and Windows), so Docker
  itself honours `DOCKER_HOST`, `DOCKER_CONTEXT` and the current context.
  `running` needs exit 0 and a server version (Docker prints `Server: null`
  when the daemon is down); a program that is found but does not answer is
  `installed-not-running` with its first stderr lines and a start hint
  (`podman machine start`, `systemctl --user start podman.socket`, Docker
  Desktop, `sudo systemctl start docker`). Reported endpoint: `DOCKER_HOST`
  else the context name; Podman: `CONTAINER_HOST` / `CONTAINER_CONNECTION`.
  Not cached: each job and each Settings check detects again (one command).
- **Target dir: a per-job tmpfs**, not a cache volume. `/tmp` must be
  `noexec`, so the build goes to `/build` (`rw,exec,size=256m,mode=1777`),
  where `/job` (read-only bind mount) is copied, built and run. Nothing
  persists between jobs and there is no volume to own, clean up or migrate,
  and no host folder writable by uid 65534. Cost: every run builds from
  scratch (a few seconds for Rust; the projects have no dependencies).
  `HOME`, `CARGO_HOME`, `GOCACHE`, `GOPATH` point into `/build`;
  `GOTOOLCHAIN=local`, `GOPROXY=off`, `GOFLAGS=-buildvcs=false`,
  `CGO_ENABLED=0`.
- **One container per job, work done with `exec`:** started `--detach`
  running `sleep <budget + 60 s>` (so a leaked container ends by itself),
  removed with `rm --force` at the end. Flags: SPEC §6.5's list plus
  `--detach --name algorithm-tutor-job-<hex> --label algorithm-tutor.job=1
  --pull never --memory-swap <same as --memory>` (no swap beyond the limit),
  the tmpfs `/build`, `--volume <job>:/job:ro`, `--workdir /build` and the
  `--env` values above. Runs never pull; a missing image is
  `runtime-missing` ("pull it in Settings → Code execution").
- **Memory:** `--memory` is the job's limit with a 512 MB floor so the
  compilers fit; the build tmpfs counts against it. So the solution's real
  cap is `max(limit, 512 MB)` minus what the build left in `/build`.
- **Timeouts:** the local executor's per-test timer and respawn
  (`runHarnessBatches`, now shared), 5 s start-up for `exec`. Killing the
  `exec` client does not stop the process inside, so the harness is started
  by `sh -c 'echo $$ > /build/run-<n>.pid && exec "$@"'` and killed with
  `kill -KILL` inside the container on timeout, cancel or too much output.
- **Fallback:** when the chosen runtime is not running at the start of a
  job, the job runs with the local executor and `onNotice` fires once per
  outage (logged by main for now; Settings shows it in T18). A missing image
  does not fall back.
- **Image:** `ghcr.io/hqazi/algorithm-tutor-runner:<app version>`; its
  contract for T19: `cargo`, `go`, `sh`, `cp`, `sleep` on PATH, usable by
  uid 65534 with a read-only root. Tests use a local stand-in
  (`exec/container/test-image/Dockerfile`: `rust:1-slim-bookworm` plus Go
  from `golang:1.24-bookworm`), never pushed.
- **Checked with** Docker 29.10.0 on Linux (cgroup v1), cargo 1.100.0,
  go 1.24.13 in the stand-in image. Not checked: Podman (no Podman here;
  rootless Podman on cgroup v1 cannot apply `--memory`), Docker Desktop on
  macOS/Windows (bind mounts of the app's data folder).

**D-32 Settings → Code execution: detection on open and on Recheck, choice
checked in main, README links by topic, Test sandbox without fallback**
(2026-11-19, T18)

- **Channels:** `exec:runtimes {recheck}` (cargo/go, Podman and Docker as
  detected now, the runner image's presence for running runtimes only, the
  last fallback notice), `exec:pull` (stream: each output line, Docker layer
  counts, then `{ok, message}`; cancellable), `exec:test {runtime}`,
  `exec:install-help {topic}`. Runtimes are detected every time Settings
  opens (never cached); **Recheck runtimes** also forgets the local
  toolchain cache (`LocalExecutor.recheck`). The button is named "Recheck
  runtimes" because the Tutor section already has a "Recheck".
- **Only running runtimes are selectable:** the UI disables the others, and
  `settings:set` refuses a change of `execution.runtime` to a runtime that is
  not running (`refused` / `runtime_not_running`), so a stale page cannot
  choose one. Local is always selectable. A value already in
  `settings.json` is kept; jobs fall back to local (D-31) and Settings says so.
- **Fallback notice:** the container executors' `onNotice` is kept in main
  and shown in Settings while the chosen runtime is down; it is dropped once
  that runtime runs again or another runtime is chosen. It is not pushed to
  the practice view.
- **How to install →** opens a fixed README URL in the system browser
  (`shell.openExternal`): `#optional-a-container-sandbox` for runtimes,
  `#installing-rust-and-go` for toolchains. The renderer names a topic, never
  a URL. T20 must keep those two headings (or update `INSTALL_HELP`).
- **Test sandbox:** hello world (`greet(name: string) -> string`, one test)
  in Rust then Go, with a container executor for that runtime that has no
  fallback, so it never passes by running locally. It needs the image (the
  button is disabled until it is on this computer). Pull / Update is offered
  for each running runtime (Podman and Docker keep separate image stores).
- **Checked with** Docker 29.10.0 and the T17 stand-in image (the real
  hello world passes in both languages), cargo 1.97.0 and go 1.24.7
  locally, and `xvfb-run npm run e2e`. Not checked: Podman, macOS, Windows,
  a real pull of the published image (T19 has not published it).

**D-33 v1 release check: release-candidate tags, the README's install
steps, one e2e for the §13 flow (T14).**

- **Release-candidate tags.** `release.yml` also accepts `vX.Y.Z-rc.N`
  (D-27 allowed only stable and beta). An rc builds and uploads like any
  release, to a draft marked as a pre-release. electron-builder takes the
  update channel from the version's pre-release part, so an rc's metadata
  is `rc*.yml`, not `latest*.yml` or `beta*.yml`: installed apps on
  `stable` or `beta` never update to an rc, which is what a test release
  should do. rc drafts are for checking the workflow and the installers and
  are deleted or left as drafts, never published.
- **README install steps for unsigned builds** (D-27 left these to T14),
  checked against current Apple, Microsoft and Ubuntu behaviour rather than
  tried on each OS: macOS 15 and later no longer offer Control-click → Open
  for unnotarized apps; the path is System Settings → Privacy & Security →
  Open Anyway, with `xattr -dr com.apple.quarantine` as the fallback.
  Windows SmartScreen: More info → Run anyway. Ubuntu 24.04 restricts
  unprivileged user namespaces, which Electron's sandbox needs: the `.deb`
  installs an AppArmor profile (electron-builder 26's `after-install`), the
  AppImage has none, so the README points AppImage users at the `.deb` or
  the sysctl, and never at `--no-sandbox`. AppImages on Ubuntu 24.04 need
  `libfuse2t64`.
- **e2e.** `e2e/v1.e2e.ts` is the single §13 run with the fake tutor
  (onboarding, next problem, run, hint, edit, run, submit, progress); the
  older suites stay as they cover more. The Progress checks wait for the
  topic counts to refresh instead of reading the first paint (CI on Linux
  failed on that race).

**D-34 Runner image: Rust slim base plus Go and Debian's Python, built
natively per arch, the tested image is the one pushed** (2026-11-20, T19)

- **Contents** (`runner-image/Dockerfile`): base
  `rust:1.100.0-slim-trixie` (gcc and libc for linking), `/usr/local/go`
  copied from `golang:1.27.4-trixie`, `python3-minimal` from Debian trixie
  (Python 3.13.5 when built; the patch level follows Debian). Both base
  images are pinned by tag and multi-arch index digest. Docs, Go's
  `test/`, `doc/`, `api/` removed; ~1.7 GB uncompressed on amd64. No crates
  or modules pre-fetched (D-29). Env: `RUSTUP_HOME`, `GOTOOLCHAIN=local`,
  `GOPROXY=off`, `GOFLAGS=-buildvcs=false`, `CGO_ENABLED=0` (the executor
  sets these too, D-31). `USER 65534:65534`, `WORKDIR /tmp`.
- **Arches:** amd64 on `ubuntu-24.04`, arm64 on `ubuntu-24.04-arm` (free
  for public repositories), each built natively with plain `docker build`,
  not QEMU. Each leg runs `runner-image/smoke.sh` (hello world in Python,
  Rust and Go with the executor's hardening flags, read-only root, uid
  65534) and the real-Docker container executor suites
  (`ALGOTUTOR_TEST_RUNNER_IMAGE`), then pushes that same image as
  `sha-<12-char commit>-<arch>`; a last job joins both with
  `docker buildx imagetools create`. No third-party actions; GHCR login
  with `GITHUB_TOKEN` (`packages: write` only in the build and publish jobs).
- **Tags:** version tag `vX.Y.Z[-beta.N|-rc.N]` → `X.Y.Z[...]` (the app's
  version, so `runnerImage(app.getVersion())` finds it), plus `latest` for a
  stable version; `workflow_dispatch` → its `version` input if given, else
  `edge`; every publish also `sha-<commit>`. Pushes to `main` and pull
  requests touching `runner-image/` or the workflow build and check only.
  The image is not part of `release.yml`: both run on the same tag.
- **Checked with** Docker 29.10.0 on Linux amd64 (smoke script and the
  real-Docker suites against the local build). arm64 only in CI.

**D-35 `executableName` is Linux-only** (2026-11-20, T14)

- The first tagged release (`v0.1.0-rc.1`, run 44720024201) showed that a
  top-level `executableName: algorithm-tutor` in `electron-builder.yml`
  renames the app on every OS: electron-builder uses it as
  `productFilename`, so macOS got `algorithm-tutor.app/Contents/MacOS/algorithm-tutor`
  and Windows `algorithm-tutor.exe` (and its Start menu entry). It is now
  set under `linux:` only, where the lower-case name matches the
  `.desktop` file and WM_CLASS; macOS and Windows keep the product name
  (`Algorithm Tutor.app`, `Algorithm Tutor.exe`), which the README's
  `xattr` step and the release smoke step expect. Linux output is
  unchanged (`linux-unpacked/algorithm-tutor`, checked locally).
- The release smoke step on macOS runs the build for the runner's own arch
  (`uname -m`), not whichever of `mac` / `mac-arm64` sorts first.

**D-36 The release checks the draft's assets** (2026-11-20, T14)

- electron-builder uploads `latest*.yml` / `beta*.yml` / `rc*.yml` without
  a log line, and a draft's assets are not visible to the tools used to
  check `v0.1.0-rc.1` and `v0.1.0-rc.2`. A last `check` job in
  `release.yml` (after all three builds) lists the draft's assets and fails
  unless the channel's `.yml`, `-mac.yml` and `-linux.yml` and every
  installer (with its `.blockmap` on Windows and macOS) are there. The
  channel is taken from the version as electron-builder does (`latest`, or
  the pre-release part before the dot).

**D-37 Library: read the user's Markdown folders, never fetch pages**
(2026-11-20, planning)

- v3 adds a Library of articles to read offline and discuss with the tutor
  (SPEC §15). Articles come from Markdown folders the user chooses, normally
  an Obsidian vault filled by the Obsidian Web Clipper (MIT; extracts pages
  with Defuddle in the user's browser and saves Markdown with frontmatter).
  The app reads those folders and never writes to them.
- Why: clipping in the user's own browser already handles pages they are
  logged into, and the app gains no new way to fetch web pages, so the
  security baseline (D-17, D-26) is unchanged except for image downloads
  (D-38). Keeping articles as plain Markdown in Obsidian's format lets both
  apps share one folder.
- A private copy for the user's own reading is ordinary (read-later apps,
  "Save page as"). Articles from the user's folders are not exported or
  shared by the app.
- Rejected: **"Save URL" in the app** (main process fetches and extracts any
  page: a general-purpose fetcher, no logged-in pages; may come later, would
  reuse Defuddle so output matches clipped notes); **our own browser
  extension or a fork of the clipper** (one per browser, store publishing,
  upkeep); **an in-app browser** (a full web browser inside an app that is
  locked down on purpose); **writing groups or annotations into the vault**
  (the app must not change the user's notes).

**D-38 Article images: downloaded by the main process, served locally**
(2026-11-20, planning)

- Images inside a library folder are served by token under the UI's own
  origin (`tutor-app://app/library-asset/<token>`). Images an article links
  to are downloaded once by the main process, checked, cached in
  `<data>/cache/article-images/` and served the same way (SPEC §15.3, §15.4).
  The UI window's CSP (`img-src 'self' data:`) and request filter stay as
  they are: the window still never contacts another host.
- Why: articles keep their pictures offline, and sites learn the user's
  address once, not on every read.
- Safeguards (all in §15.4): `https` only; local-network addresses refused
  and the connection pinned to the checked address; redirects re-checked;
  size, time, count and pixel caps; magic bytes decide the type; SVG not
  served; the main process never decodes images; chat never renders images;
  only references in the article file are downloaded, never URLs the model
  writes.
- Rejected: **loading images straight from the web in the window** (as
  Obsidian does): no pictures offline, the site sees every read, and it
  would open the window's "no remote content" rule; **re-encoding images in
  the main process** (decoding untrusted images in the process that holds
  the key is the larger risk); **writing downloaded images into the vault**
  (the app does not change the user's notes, D-37).

**D-39 Library frontmatter: the Web Clipper's default template; `yaml` 2.9.1**
(2026-11-20, T21)

- VERIFY resolved (SPEC §15.1) from the clipper's source,
  `obsidianmd/obsidian-clipper` at `be99cda` (2026-11-19, version 1.8.3),
  `createDefaultTemplate()` in `src/managers/template-manager.ts`, the
  property types beside it, and `generateFrontmatter()` in
  `src/utils/shared.ts`. Default note: folder `Clippings`, file name
  `{{title}}`, body `{{content}}`, properties in this order:
  `title` (text, `{{title}}`), `source` (text, `{{url}}`), `author`
  (multitext, `{{author|split:", "|wikilink|join}}`), `published` (date),
  `created` (date, `{{date}}`), `description` (text), `tags` (multitext,
  `clippings`). Written as: text quoted (`title: "…"`); multitext as a
  block list of quoted items (`author:\n  - "[[Name]]"`); dates unquoted
  `YYYY-MM-DD`; an empty value as `key:` (null).
- Images: the body is Defuddle's Markdown (`defuddle` ^0.19.11). An `img`
  becomes `![alt](absolute-url "title")` (the largest `srcset` entry), an
  image inside a link `[![alt](src)](href)`, a figure its images then the
  caption as a paragraph. The clipper does not download images: they stay
  remote `https://` links (T23 downloads them). `![[file.png]]` appears only
  in notes the user writes in Obsidian or after Obsidian's "download
  attachments" (T22).
- Parsing: `yaml` **2.9.1** (pure JS, no Node built-ins, so it lives in
  `packages/core`), `parseDocument` with `schema: 'core'`, `customTags: []`,
  `merge: false`, aliases capped at 20 expansions. The core schema has no
  timestamp type, so dates stay strings; an unknown tag leaves a plain
  string. Bad YAML gives no frontmatter (title from the file name) rather
  than skipping the note. `author` wikilinks are shown as their names;
  `tags` may be a list or a comma/space string; a leading `#` is dropped.
- Identity details (SPEC §15.1): a path seen again keeps its row; among
  rows gone from their path, a new path takes one with the same hash
  (same file name preferred), else the same `source`; the rest are marked
  `missing_since` once. A folder that cannot be read (unplugged drive)
  keeps its index unchanged and shows why. Folders that are, contain or
  are inside one already chosen are refused (they would index notes
  twice). Dot-files are skipped like dot-folders.
- Fixture: `packages/core/src/library/fixtures/clipped-default.md`, written
  by hand in that shape, no third-party text.

**D-40 Raw HTML in notes: dropped; how the reader resolves and serves**
(2026-11-20, T22)

- DECISION resolved (SPEC §14, §15.2): raw HTML in a note is **dropped**,
  the default. `marked` renders every HTML block and inline tag as nothing,
  as chat does, and DOMPurify (its own instance, chat allowlist plus `img`)
  runs after. Evidence: the Web Clipper writes Markdown (Defuddle, D-39),
  so clipped notes rarely hold HTML; what does appear (`<sup>`, `<kbd>`,
  `<details>`, embedded `<iframe>`) is formatting or remote content the
  window must not load anyway. Lost: an HTML block (a paragraph that
  starts with a tag) with its text; an inline tag's formatting (its text
  stays).
  Rejected: **an HTML allowlist through DOMPurify** (a second, wider
  allowlist to keep safe for little gain; can be revisited with real
  notes).
- Images: an `img` is emitted only for an `asset` reference from main and
  survives sanitising only if its `src` matches
  `tutor-app://app/library-asset/<token>`; anything else is a placeholder
  (alt text, host, reason). `width` is kept only as digits
  (`![[x.png|300]]`).
- References are found in main from the file itself (`extractRefs`, fenced
  and inline code skipped) and keyed by the text as written (`refKey`:
  trimmed, `<…>` removed), so the renderer cannot ask main to resolve a
  path; main answers per key with a token or a reason (`remote`,
  `insecure`, `data`, `scheme`, `outside`, `not_found`, `not_image`,
  `svg`, `too_large`). Percent-encoding is decoded and `\` treated as `/`
  before the inside-the-folder check. The unique-name fallback lists the
  folder once per open (dot-entries skipped, at most 100,000 files),
  shortest path first, then alphabetical; name match ignores case.
- Tokens: 24 random bytes (base64url) per file per session, in memory;
  checked again on every request (real path inside, regular file opened
  with `O_NOFOLLOW` where the OS has it, 25 MB, magic bytes of the bytes
  served); a removed folder's tokens stop working. Responses carry the
  sniffed type, `nosniff`, `no-store` and `default-src 'none'`. The UI
  protocol handler dispatches `/library-asset/` to this route; the CSP and
  the request filter are unchanged.
- Wikilinks resolve in main to an article id in the same library folder:
  relative to the note, then the folder root, then by file name (shortest
  path), ignoring case. Unresolved links are plain text. Links in the body
  never navigate the window: `#/library/<id>` changes the route; `https:`,
  `http:`, `mailto:` go to `library:open-link`, which checks the scheme
  again in main before `shell.openExternal`.

**D-41 Linked images: own pinned transport, wider address list, how loading works**
(2026-11-20, T23)

- Transport: `node:https.request` with a `lookup` that answers only the
  address already checked, `agent: false` (no shared sockets, no cookie
  jar), SNI and `Host` from the URL. Not `fetch`: Node's `fetch` cannot pin
  the address without the separate `undici` package. The open-set fetcher
  (`intake/fetch.ts`) keeps `fetch`: it only reaches a fixed host list.
- Refused addresses go beyond §15.4's list: documentation and benchmarking
  ranges, `240/4`, IPv6 other than global unicast, NAT64 and 6to4 judged by
  their IPv4 address, Teredo, zone ids; names without a dot and
  `*.localhost`, `*.local`, `*.internal`, `*.lan`, `*.home.arpa`. Every
  address a name has must pass; the first is used.
- Loading: `library:article` never downloads (cached images and recent
  failures show at once; `data:` images are decoded and cached there, no
  network). The reader then calls `library:load-images` with the article id
  only; main re-reads the file, finds the `https:` references itself and
  downloads them (in `ask` mode only with `force`). **Load images** and
  **Retry** are one bar above the article, not buttons inside each
  placeholder (placeholders are sanitised HTML).
- Failure memory is in memory (1 hour, cleared by Retry or Clear): a
  restart tries again. The cache itself lasts.
- "Make available offline" is a stream (`library:offline`): it runs while
  Settings is open; Cancel or leaving Settings stops it (images already
  downloaded stay).
- Per-article caps count references in file order: the first 200; bytes
  include images already cached.

**D-42 Chats on passages: anchors, article mode, thread lifecycle (T24)**

- Anchors (`packages/core/src/library/anchors.ts`) are made and resolved
  against an `AnchorDoc`: a text plus its headings at offsets. The renderer
  builds one from the reader's DOM (text nodes, a line break between
  blocks); main builds one from the Markdown (ATX headings outside fenced
  code, inline Markdown stripped from titles). Quote, prefix and suffix are
  whitespace-normalised (runs to one space), so DOM text and Markdown
  match across line wrapping; the quote is capped at 1,000 characters.
  Repeats are scored by common prefix/suffix length plus a bonus when the
  heading path matches. A quote that is gone falls back to its heading
  (full path first, then the last title alone, case-insensitive); else
  detached. Inline Markdown inside a quote (`**x**`) can make main fall
  back to the heading while the reader still finds the quote: the turn
  then sends the heading's section, which still holds the passage.
- Article mode: the turn's context, tools and system prompt come from
  `ChatDeps.article`, so practice tools are never offered on an article
  thread. Its system prompt is separate (`tools/article-prompt.ts`), built
  once; everything from the file is inside `<article_text>` /
  `<article_quote>` with those tags and `</context>` escaped. A detached
  passage sends the outline and quote but no section; a missing file sends
  only the stored quote. `read_article_section` takes a title or `A > B`
  path (`""` for the opening), 8,000 characters; `search_article` returns
  at most 5 paragraphs of 400 characters with their heading path and the
  total count.
- A thread is created only when its first question is sent (the renderer
  calls `library:thread-create`, then `chat:send`), so choosing a passage
  and walking away leaves nothing behind. The title is the first line of
  the first question (80 characters) until renamed. Reset archives as for
  problems (`<id>~<n>`, with kind, article, anchor and title) and keeps an
  empty current row at the same passage, so the thread stays listed.
  `saveThread` keeps the v3 columns when a caller leaves them out.
- The one-time provider notice is a `meta` row (`library.chat_notice_seen`),
  shown before the first article message is sent; it survives restarts and
  is cleared with the data, not per article.
- Removing a library folder deletes its articles' threads and messages
  (archived ones too), as T21 left for this ticket.
- The Claude Code article test replays `article-turn.jsonl`: the recorded
  `turn.jsonl` with its tool call rewritten to `read_article_section` by
  hand, not a new recording.

**D-43 Tutor-written articles and problems from passages (T25)**

- Generated articles live in `<data>/articles/generated/<slug>.md` and are
  indexed like a library folder under the fixed folder id `generated`
  (settings folder ids are UUIDs), so scanning, reading, chats and images
  work unchanged. The group appears in the tree once it holds an article;
  it is not in Settings → Library and cannot be removed or opened there.
  The reader's `generated` flag comes from the folder, never from a
  frontmatter key, so a clipped note cannot claim or hide the label.
- Writing is one request/response IPC call (`library:write-article`) that
  resolves when the file is indexed: one article at a time, at most 2
  turns (the second reminds the model to save) and 3 `save_article` calls,
  5 minutes. The file is staged under a dot name (skipped by scans) and
  renamed; the slug comes from the title (`-2`, `-3` when taken). No
  progress events and no Stop button: a later ticket can add them.
- The model writes title, tags and body only. The app drops any
  frontmatter it wrote, a leading `# Title`, and every image form
  (`![a](u)`, `![a][r]`, `![[x.png]]`) to its alt text: model text never
  reaches the linked-image downloader (SPEC §15.4).
- `create_problem` in article mode calls the tutor registry's own
  `create_problem` (same slug guard, `chatCreateProblem` factory and
  self-check in Pyodide), so T12's pipeline is reused, not copied. It is
  offered only when the tutor has `createProblem`; the spec schema is taken
  from the tutor tool. The 4-call limit (SPEC §6.3) is per article turn,
  counted in the per-turn tool context; the model gets the failures back
  and repairs. Origin is never passed: a problem from a passage is a
  generated problem in the tutor's own words.
- Success emits `open_problem`, but the global chat effects ignore it for
  `article:` threads; the article pane shows **Open in Practice** instead,
  so a chat on a passage never moves the user (or the thread) to the
  problem page by itself.

**D-44 How the Library security check and end-to-end test reach a "public" image host (T26)**
(2026-11-20, T26)

- Both run the real downloader (`downloadImage`: URL checks, every address
  checked on every hop, manual redirects, caps, magic bytes) and replace
  only name resolution and the socket (`main/testing/standin.ts`): the
  stand-in names (`images.example.com`, `redirect.example.com`) resolve to
  a public-looking address, `private.example.com` to `10.0.0.7`, anything
  else fails; the transport dials `127.0.0.1:<port>` only when the pinned
  address is the stand-in's, so nothing can reach the real network. The
  host is a local HTTPS server with a throwaway self-signed certificate
  made with `openssl` at run time (no key committed).
- The replacement goes in through `setTestHooks` (`main/setup.ts`), set only
  by entries that do not ship: `security-check.js` and a new
  `e2e-main.js` (imports `index.ts` unchanged, then sets the hook before
  `app.whenReady()` resolves). `electron-builder.yml` excludes both and the
  `standin` chunk. No environment variable changes the shipped app's
  downloader. The same hooks give the check a served-files log
  (`AssetRegistry` `onServe`); `UiOptions.onRequest` gives it every request
  a page in the UI session made (the filter itself is unchanged).
- The hostile vault is built at run time (`main/testing/hostile-vault.ts`)
  rather than committed, so the symlink out and the file outside the vault
  are real on every OS.

**D-45 npm dependencies wait 14 days before they are locked**
(2026-11-20, dependency cooldown)

- Hijacked npm releases are usually found and pulled within days, so every
  version in `package-lock.json` must be at least 14 days old when it is
  locked. The lock of 2026-11-19 had 81 versions younger than that; the
  lockfile is now regenerated from scratch with
  `npm install --before=2026-11-06` (inside a container, with
  `--ignore-scripts`), and every one of its 564 versions was checked against
  the registry's publish times.
- Direct dependencies that were younger are pinned to their newest version
  at least 14 days old: `electron` 45.2.3, `vite` 8.3.6,
  `@vitejs/plugin-react` 6.2.1, `eslint` 10.14.0, `typescript-eslint`
  8.72.1, `eslint-plugin-react-refresh` 0.5.7, `prettier` 3.9.10.
- To move a dependency forward: pick a version at least 14 days old, then
  regenerate the lockfile the same way with `--before` set 14 days back.

**D-46 Docs: the README is a front page, the user guide lives in `docs/guide/`**
(2026-11-20, T27)

- The README had grown to 360 lines of install, sandbox and troubleshooting
  detail and did not mention the Library. It is now a front page (logo,
  features, screenshots, quick start, links); the detail moved, unchanged
  where still true, to `docs/guide/*.md`. Settings → Code execution's
  **How to install →** links now open `docs/guide/code-execution.md`
  (`GUIDE_URL`), whose headings keep the old anchors
  (`#optional-a-container-sandbox`, `#installing-rust-and-go`). Builds
  already released link to the README's old anchors and land at the top of
  the README, which links to the guide.
- The repository is `hqazi/algo` (the owner renamed it; GitHub redirects
  the old `hqazi/algorithm-tutor`). Every reference to the repository uses
  the new name: links, `electron-builder.yml` (`publish.repo`, so installed
  apps look for updates there), the package `repository`/`homepage`, the
  `.deb` maintainer, the runner image's `image.source` label and the schema
  `$id`s. Builds already out still ask `hqazi/algorithm-tutor` for updates
  and reach `hqazi/algo` through the redirect, which holds as long as no new
  repository takes the old name.
- Kept: the product name **Algorithm Tutor**, the executable and installer
  names (`algorithm-tutor-<version>-...`), the app id, the data folder and
  the runner image `ghcr.io/hqazi/algorithm-tutor-runner`. They name the
  app, not the repository; renaming them would move users' data or break
  image pulls for released builds.
- Screenshots are generated (`npm run screenshots`) from the built app and a
  scripted tutor, so they can be retaken after UI changes.
- Rejected: a docs site generator (VitePress, Docusaurus). Plain Markdown
  renders on GitHub with no build or hosting; revisit if the guide grows.

**D-47 The app is called Algo** (2026-11-20, T27; supersedes the "Kept" item of D-46)

The owner renamed the app to match the repository; they are its only user,
so nothing has to stay compatible with installed builds.
- Display name **Algo** (`APP_NAME`, `productName`, window title, docs).
  The data folder follows Electron's app name, so it is now
  `.../Algo` (macOS `~/Library/Application Support/Algo`, Windows
  `%APPDATA%\Algo`, Linux `~/.config/Algo`). Nothing migrates the old
  `Algorithm Tutor` folder; move it by hand, or export from the old build
  and import in the new one.
- Technical names `algo`: installers `algo-<version>-<os>-<arch>.<ext>`, the
  Linux executable and `.desktop` file, app id `io.github.hqazi.algo`,
  workspaces `algo`, `@algo/core`, `@algo/desktop`, the runner image
  `ghcr.io/hqazi/algo-runner` (published by the next runner-image run), job
  containers `algo-job-*` with label `algo.job=1`, the importer's
  `User-Agent`, generated harness headers.
- Exports are tagged `algo-export`; `algorithm-tutor-export` still imports.
- The API key is encrypted per app name by `safeStorage`, so the renamed app
  cannot read a key stored by the old one: enter it again.
- Kept: the `ALGOTUTOR_*` development variables (they already read as "algo
  tutor") and the `tutor-app://` protocol. The local executor now strips
  `ALGOTUTOR_*` from the toolchain environment; it stripped
  `ALGORITHM_TUTOR_*`, a prefix nothing used.


**D-48 `npm run check:deps` enforces the 14-day cooldown** (2026-11-20; extends D-45)

D-45 set the rule but nothing checked it, so a later `npm install` could lock
a release that is only hours old. This is a guard against supply-chain
attacks: a hijacked release is usually found and pulled within days.
- `scripts/check-dep-age.ts` (`npm run check:deps`) reads the publish time of
  every registry version in `package-lock.json` and fails if any is younger
  than 14 days, or if a time cannot be read. CI runs it once, on Linux.
- A lock only ages, so the check cannot start failing by itself; a failure
  means a dependency was added or moved.
- Every change to `package.json` or `package-lock.json` runs it before
  merging. To add or move a dependency: pick its newest version at least 14
  days old, pin it exactly, run
  `npm install --before=<date 14 days ago> --ignore-scripts`, then
  `npm run check:deps`. Never `npm update`, or `npm install <pkg>` without a
  version.
- First run (2026-11-20): 564 versions of 523 packages, none younger than
  14 days.

**D-49 Design foundations: tokens, fonts, icons and controls** (2026-11-20, T28)

How `design.md` → Foundations was built, where the plan left a choice.
- **Colours.** Zinc-like neutrals and indigo `#4f46e5` as the accent in both
  themes (white text on it, 6.3:1). The dark accent is too dark to read as
  text on dark surfaces, so a new token `--accent-fg` is the accent used as
  text or an icon (links, the selected Library article): `#4338ca` light,
  `#a5b0fc` dark. `--focus` is the focus ring (`#818cf8` in dark, where the
  accent would be under 3:1). `--faint` (placeholders, disabled) is held to
  3:1, not 4.5:1: it is never content. Old names stay as aliases:
  `--danger` = `--fail`, `--code-bg` = `--surface-2`, `--accent-2` =
  `--accent` (Submit is no longer green). Colour tokens are plain hex so
  `styles.test.ts` can compute WCAG ratios for every text/background pair in
  both themes; vitest processes `styles.css` for that test only
  (`css.include` in `apps/desktop/vitest.config.ts`).
- **Fonts.** `@fontsource-variable/inter` 5.3.0 (weight axis, normal and
  italic) and `@fontsource-variable/jetbrains-mono` 5.3.0 (weight axis,
  normal), imported in `main.tsx` and emitted by Vite into the renderer
  bundle; `font-src 'self'` already allows them. Each `@font-face` has a
  `unicode-range`, so only the subsets a page uses are loaded. Ligatures are
  off in code (`->` stays two characters for learners).
- **Icons.** `lucide-react` 1.69.0 (ISC; the Feather-derived icons are MIT,
  noted in `build/notices/lucide.txt`). A `LucideProvider` in `main.tsx`
  sets 16px and stroke 1.75 for every icon. Icons without a label are
  `aria-hidden`.
- **Controls.** A bare `<button>` is the `secondary` look and a bare
  `<select>` gets `appearance: none` with a chevron (a `data:` SVG, allowed
  by `img-src`), so existing screens change without touching their markup.
  New code uses `components/ui/`. The segmented control is a group of
  buttons with `aria-pressed` rather than radios: options keep the button
  role and name that tests and the guide use ("This problem", "General"),
  while arrow keys move the selection like a radio group with a single tab
  stop. The menu follows the WAI-ARIA menu button pattern, so its items are
  `menuitem`s: when T30 moves **Give up** and **Reset** into "More", the e2e
  tests find them with `getByRole('menuitem', ...)`.
- **Scrollbars** use `::-webkit-scrollbar` (Electron is Chromium). The
  standard `scrollbar-width`/`scrollbar-color` are not set: in Chromium they
  switch the `::-webkit-scrollbar` styles off and cannot hide the thumb
  until hover.
- **Editor.** The CodeMirror chrome (background, gutter, active line,
  selection, panels, tooltips) reads the CSS tokens, so one theme serves
  both modes; light keeps CodeMirror's default highlight colours and dark
  uses One Dark's (`oneDarkHighlightStyle`) on the token background.
- **Practice toolbar.** Run is secondary and Submit primary now (a two-line
  class change in `PracticePage.tsx`), so only one filled button shows; T30
  adds the icons and the "More" menu.

**D-50 App frame: the title bar and edge-to-edge panes** (2026-11-20, T29)

How `design.md` → App frame was built, checked against the Electron 45 docs
(`BaseWindowConstructorOptions`, `win.setTitleBarOverlay`, the custom title
bar tutorial) rather than memory.
- **Window options** (`titleBarOptions` in `main/window.ts`). macOS:
  `titleBarStyle: 'hiddenInset'` with `trafficLightPosition` `{x: 16, y: 16}`
  so the 12px lights sit centred in the 44px bar; the renderer leaves 84px
  for them. Windows and Linux: `titleBarStyle: 'hidden'` with
  `titleBarOverlay` `{color, symbolColor, height: 44}`; the renderer keeps
  its controls out of the overlay with `env(titlebar-area-x/width)`. The
  window's `backgroundColor` is the bar colour, so there is no white flash
  in dark mode. The `webPreferences` baseline is unchanged
  (`check:security` passes).
- **Colours.** The bar is `--bg` and the overlay's symbols `--muted`, per
  theme. The main process cannot read CSS, so the hex values are repeated in
  `TITLE_BAR_COLORS` and `window.test.ts` reads `styles.css` to check they
  (and `--titlebar-h`) match. The theme setting already drives `nativeTheme`
  (`followTheme` in `ipc/handlers/settings.ts`), so the window listens to `nativeTheme`'s
  `updated` event and calls `setTitleBarOverlay` and `setBackgroundColor`;
  no new IPC. On Linux the docs say `symbolColor` is adjusted for contrast
  by Electron anyway.
- **Platform in the renderer** comes from `navigator.userAgent` ("Mac"), not
  a new bridge field: it only chooses the left padding.
- **Drag regions.** The bar is `app-region: drag` (and the `-webkit-`
  spelling); links, buttons, inputs, selects and anything with a `title`
  (the tutor status tooltip) are `no-drag`.
- **Nav.** Home, Problems, Progress, Library, Settings, each a link with a
  lucide icon; the current one is an accent-subtle pill with
  `aria-current="page"` (Problems while practising a problem). Under 1100px
  the labels are visually hidden (still the links' names) and each link has
  its label as `title`. The logo mark is an inline, simplified copy of
  `docs/assets/logo.svg` (no gradients or glow) so nothing is fetched.
- **Tutor status** is a dot and "Tutor" with a visually hidden " on"/" off",
  so its text is still "Tutor on"/"Tutor off" for screen readers and the
  e2e tests; the tooltip names the backend and model, or the reason it is
  off.
- **Onboarding.** While the profile is not onboarded (or on `/welcome`) the
  bar shows only the logo and name; before, New problem and Next problem
  were shown disabled.
- **Panes.** 1px grid columns on `--border` are the separators, with an 8px
  invisible hit area, accent on hover and while dragging, `--focus` when
  focused; arrow keys resize as before, and the separators now expose
  `aria-valuenow`. `Pane` gained `actions` (shown in its `PaneHeader`) and
  `header: false` for content that draws its own `PaneHeader` (the tutor
  chat, which is also on Home, and the Library chats pane once an article
  is open). The Practice editor toolbar moved as is into the Code pane's
  header, and the Library's **Refresh** into the Articles pane's header;
  T30 and T32 restyle their contents.

**D-51 Practice page: toolbar, results and the shared chat parts** (2026-11-20, T30)

How `design.md` → Practice was built, where the plan left a choice.
- **Statement.** The title, then difficulty (a dot in its colour), topic and
  status as `Badge`s. The statement's `## Constraints` section is taken out
  of the Markdown (`pages/practice-statement.ts`) and shown with the target
  complexity in a quiet "Details" block on `--surface-2`; statements without
  that section show only the target there. Statement section headings read
  as small uppercase labels.
- **Toolbar.** The language select (only when more than one language is
  offered, as before), the save state in `--faint` (muted while unsaved or
  saving, red when it failed; the file path stays its tooltip), then **Run**
  (secondary, a play icon in the pass colour) and **Submit** (primary), both
  small (28px) to fit the 44px pane header. The shortcut in their tooltips is
  ⌘Enter / ⇧⌘Enter on macOS and Ctrl+Enter / Ctrl+Shift+Enter elsewhere.
  The "More" menu (`…`, accessible name "More") holds **Give up** (danger),
  which becomes **Reference** once the attempt is recorded, and **Reset**;
  they are `menuitem`s (D-49).
- **Results.** The summary bar is sticky inside the results area: an icon,
  "N/M passed" (`data-testid="summary"`, text unchanged for the tests), the
  run kind and the run's duration. Failing tests come first (each group in
  its order) and start open; passing ones are one line with the input as a
  faint preview and open on click (a button with `aria-expanded`, a chevron,
  no `<details>` triangle). The grid is Input / Expected / **Got** (was
  "Actual"), with Expected tinted pass and Got tinted fail when the test
  failed. Hidden tests read "Hidden test: negative numbers" (was
  "Hidden · Negative Numbers") and have nothing to open; the hidden-failure
  note names the categories in a sentence.
- **Shared chat parts** (`chat/MessageList.tsx`, `chat/Composer.tsx`), for the
  tutor pane now and the Library's chats in T32. `MessageList` takes a thread
  view, an empty text and optional reload/retry, and keeps to the bottom
  while the reader is there. `Composer` is one rounded box with an
  `AutoGrowTextarea` (to 192px) and an icon button inside: **Send** (primary,
  arrow) or, while a reply streams, **Stop** (accessible names unchanged);
  Enter sends, Shift+Enter is a new line, an `extra` slot takes more
  controls (the Library's "Make a problem from this"). The Library still
  uses its own markup until T32, so `chat.css` keeps the older
  `.chat-head`, `.small-button` and `.chat-compose` rules for it.
- **Tutor pane.** The thread switch is a `Segmented` ("This problem",
  "General", and another problem's slug when following one); **New chat** is
  an icon button (pencil-on-square) with its name as the label. Tool chips
  use lucide check / x / spinner icons instead of "✓ ✗ …" characters, so
  their text is the summary only and the e2e tests read their `data-state`.
  Below 340px the pane's "Tutor" title is visually hidden (a container
  query) so the switch fits.
- **Explanation dialog.** "Explanation" as a small label over the problem's
  title, which the caller passes (Practice) or the viewer looks up with
  `problems:get` (opened by the tutor from any page), falling back to the
  slug; **Close** is an icon button with that name.

**D-52 Home dashboard, Problems and Progress** (2026-11-20, T31)

How `design.md` → Home, Problems, Progress was built, where the plan left a
choice.
- **Recommended next without side effects.** `problems:next` takes an
  optional `preview: true`, passed to core's `nextProblem({ dryRun: true })`,
  so Home can show the pick and its reason without moving the focus topic (a
  real pick may). **Start** on the card runs the usual Next problem flow,
  which makes the same pick. Core's reason is written for the tutor; Home
  capitalises it and drops the "no unattempted problem left here, so
  generate one (create_problem)" tail, saying "The tutor writes it" and
  offering **Create it** instead. No other IPC was added: the Continue card
  uses `status:get` (the latest open attempt by start time; others listed as
  "Also in progress") and `problems:list` with `status: 'active'` for titles.
  "Last activity" is the attempt's start time, the only time exposed.
- **Home's heading stays "Practice"** (every e2e suite waits for it); a
  one-line subtitle explains the page. The old Unfinished and Recent lists
  are gone from Home (Progress lists both).
- **Relative times** on Home ("5 min ago", the full date as the tooltip) use
  a small `ago()` in `pages/dashboard.ts`; T33's shared formatter replaces
  it when both are in.
- **Problems filters run in the renderer** on the full `problems:list`
  reply (the same equality filters main applied), so each option shows how
  many problems it would leave given the other filters and the search
  ("Easy (12)"). Source, as a column and a filter, shows only when the list
  has more than one source (or a source filter is set). Rows navigate on
  click; the title stays a real link (keyboard, e2e) and the row gets the
  hover fill while the link has focus. Status is an icon (empty circle new,
  lucide `Contrast` half circle in progress, check solved, slashed circle
  gave up) with the label as visually hidden text and tooltip. The page
  has no top padding so the table header sticks flush to the top.
- **Progress topic rows.** The bar shows distinct problems: unaided
  (`--pass`), with help (`--warn`, solved minus unaided) and tried
  (`--faint`, attempted minus solved, open attempts included). Its length is
  out of three (the unaided solves that make a topic comfortable) or the
  problems attempted if more. Counts sit on the name line, zeros left out;
  the bar is `role="img"` with "N of 3 unaided solves (…)" as its label.
  Group cards are balanced with CSS columns (`columns: 3 20rem`) rather
  than a grid, so short and long groups pack by height.
- **Page CSS** lives in `pages/home.css`, `problems.css`, `progress.css`
  and `problem-bits.css` (difficulty dot, status icon). The old
  `.problem-table`, `.filters`, `.topic-*` rules in `styles.css` are no
  longer used by these pages and were left for T34 to remove, to keep this
  ticket out of `styles.css` while T30 and T33 change it.

**D-53 Onboarding, Settings, dialogs and dates** (2026-11-20, T33)

How `design.md` → Onboarding, Settings, dialogs was built, where the plan
left a choice.
- **Onboarding.** `ProfileForm` has `layout="steps"` (onboarding: one
  question per step, a five-bar indicator with "Question n of 5", Back,
  Continue, and the last step's button keeps its name **Save and
  continue**) and `layout="all"` (Settings → Profile, every question at
  once). The answers are kept across steps and sent in one `profile:set`
  call as before; Enter on an earlier step moves on instead of saving.
  **Use defaults and start** is a ghost button on every step. Choice cards
  keep a real radio (drawn as a ring with `appearance: none`) whose label is
  the card's title only, so names stay "Intermediate" etc.; the line of
  help is `aria-describedby`. The label's `::after` covers the card for
  clicks, and the radio sits above it so it still takes its own clicks.
  Comfort per area stays a select per group (the combobox names are kept).
  The "Connect the tutor" step uses the same centred card.
- **Settings: scroll-spy, not one section at a time.** A sticky list on the
  left (Tutor, Code execution, Appearance, Library, Profile, Data, Updates,
  About; Appearance is kept as its own section, which `design.md`'s list
  omits) jumps to a section and follows the scroll position. Every section
  stays rendered, so no test or the screenshot script needs a click to
  reach a control, and leaving the page does not lose a half-typed field.
  The list items are buttons (the router owns the URL hash) with
  `aria-current`; a jump focuses the section's heading.
- **Rows.** Label left (11.5rem), control right, help and actions under the
  control: existing `<label class="field">` markup is laid out by CSS grid
  (the label text is an anonymous grid item), inline forms use
  `display: contents` on the label; `SettingRow` and `StatusText`
  (`pages/SettingsRow.tsx`) are the label/value row and the dot + text
  status (ok, off, warn, error, pending). The tutor line reads "On: Anthropic
  API, model" (backend names from `app-frame.ts`), not "On · anthropic ·
  model".
- **Dialogs.** `components/Dialog.tsx`: header (title + **Close** icon
  button), scrolling body, footer actions right; Escape and the close
  button call `onClose`; focus moves in and back. Older `.modal` dialogs
  get the same look from the dialog section of `styles.css`. New problem's
  modes are `Segmented` with a new `tabs` option (a WAI-ARIA tablist of
  `tab`s with `aria-selected`), not `aria-pressed` buttons: the mode names
  "Generate" and "Import" are also the submit button's names, and tabs that
  switch a panel are tabs. Difficulty options read Easy / Medium / Hard;
  values unchanged.
- **Toasts.** Bottom-right, surface + shadow, a lucide icon per kind (Info,
  CircleCheck, CircleAlert), dismiss is an icon button named "Dismiss".
- **Dates.** `relativeDate` in `lib/format.ts`: "just now" under a minute,
  "N min ago", "N h ago" for earlier today, "yesterday" and "N days ago" by
  calendar day, then "13 Nov" (with the year when it is not this year's);
  `fullDate` for the tooltip; `components/RelativeTime.tsx` renders both as
  a `<time>`. Used by Settings → Updates; `when()` is left for the pages
  T31 and T32 own.

**D-54 Library page: tree, reader and chats pane** (2026-11-20, T32)

- **Tree.** Folders are buttons with `aria-expanded`, a chevron that turns,
  and an open/closed folder icon, instead of `<details>` (no native
  triangle); articles stay links (`aria-current="page"` on the open one,
  shown as an accent-subtle row). Tab, Enter and Space work as before. A
  nested list's left border is the indent guide. Which folders are closed
  is kept for the visit only (not stored); while a filter is typed every
  matching folder shows open. **Refresh** and **Write an article** are icon
  buttons in the Articles pane's header (names unchanged; Refresh spins
  while it runs); **Write an article** toggles the form below the filter.
  The Level and Length options show capitalised labels; the values sent
  are unchanged.
- **Reader.** 16px body, line height 1.7, at most 70ch plus margins: 48px
  on the left for the chat markers (an accent bar with a wider hit area)
  and 64px on the right for the headings' **Ask**. The source shows as its
  domain (`www.` dropped; a `mailto:` shows the address) with an
  external-link icon; the full URL is the link's `title` and `href`, and
  clicks still go through `library:open-link`. Tags are `Badge`s.
- **Callout and placeholder icons** are lucide icons drawn as CSS masks
  from `data:` SVGs in `pages/library.css`, coloured by the callout type
  (accent by default; warn, fail, pass, muted for quotes). The article
  sanitiser is unchanged (no SVG in article HTML), and the UI CSP already
  allows `data:` images, as for the select chevron (D-49).
- **Ask beside a heading** is hidden (opacity 0) until the pointer is over
  that heading or the button, or the button has keyboard focus; it stays
  in the Tab order with its name. The layer watches `mouseover` on the
  reader to know which heading is under the pointer.
- **Chats pane** uses `MessageList` and `Composer` (D-51). **Make a problem
  from this** is a chip above the composer, as Practice's Hint / Review /
  Explain, rather than in the composer's `extra` slot, where a 240px pane
  cut it off. Thread rows: title and relative time on one line (a
  `<time>` with the full local date as its `title`), the passage snippet
  below in two lines at most. Rename, New chat and Close are icon buttons
  with those names. The provider notice keeps its Send and Cancel. The
  pane's "Chats" title stays visible in a narrow pane (the tutor pane's
  container query hides its own title to fit the thread switch).
- **Relative times** use T33's shared `relativeDate`, with `fullDate` as
  the `<time>`'s tooltip (D-53).
- **CSS.** The page's look is in `pages/library.css`, scoped under
  `.library-page`; the T22 Library rules in `styles.css` are overridden
  there, not deleted, to stay out of `styles.css` while T31 and T33 run in
  parallel (T34 can delete them). `chat.css` lost `.chat-head`,
  `.small-button` and `.chat-compose`.

**D-55 Design pass: window size, narrow layout, focus, disabled primary, dates** (2026-11-21, T34)

- **Minimum window size 800×600** (`MIN_WINDOW_SIZE`, `minWidth`/`minHeight`
  in `main/window.ts`). There was none. 800 is below the 900px breakpoint on
  purpose: the smallest window uses the stacked tabs, which were checked on
  every page; Home, Problems, Progress, Settings and dialogs fit at 800×600
  (pages scroll).
- **Stacked tabs.** `.pane`'s `display: flex` beat the `hidden` attribute, so
  under 900px all three panes showed at once; a global `[hidden] { display:
  none !important }` fixes it everywhere. `Panes` now renders one tree for
  both layouts (tabs and gutters come and go), so crossing 900px no longer
  remounts the editor, a chat draft or the Library's open thread.
- **Disabled primary** uses a new `--accent-disabled` fill at 55% opacity:
  the accent in light, a brighter indigo (`#6655ff`) in dark, where the
  accent faded over a dark surface looked muddy. Send's own 0.35 is gone.
  Disabled controls are exempt from WCAG contrast; the token is plain hex
  like the others so `styles.test.ts` sees it in both themes.
- **Focus.** The code editor shows `--accent-ring` inside its edges when
  focused (it is a text box, like inputs); CodeMirror's own Escape-then-Tab
  (and Ctrl+M) leaves it, so Tab keeps indenting. Onboarding's choice cards
  use the shared 2px `--focus` outline instead of a faint ring. Menu items
  keep a filled row as their focus state (the menu pattern). Asking about a
  passage or heading moves the focus to the question box; the provider
  notice is an alert dialog whose **Send** takes the focus and hands it back
  to the box.
- **Dates.** `when()` and Home's `ago()` are gone: every user-facing date
  (Home, Progress, explanation versions, Library chats, Settings → Updates)
  goes through `relativeDate`/`fullDate` (`RelativeTime`). Explanation
  versions read "Latest · 5 min ago" with the full date as the tooltip.
- **Progress by title.** Attempts carry only the slug, so Progress loads
  `problems:list` (no new IPC) for titles and difficulty; slugs show only
  until it loads. Active problems is a table like Recent attempts. The e2e
  tests find a problem on Progress by its link target (`a[href="#/p/<slug>"]`).
- **Next problem's toast** reads "Next problem: <title>. <Reason>." using
  Home's `reasonText` (capitalised, without the tutor-only tail); the New
  problem dialog's suggestion uses the same text.
- **Settings → Tutor status** rewrites main's "… in Settings …" reason to
  "… below …" on that page only (`reasonHere`); elsewhere it is unchanged.

**D-56 Collapsible panes and pane shortcuts** (2026-11-21, T35)

- **Which panes.** The side panes on multi-pane pages (left and right) and
  Practice's test results. The middle pane (editor, reader) never
  collapses: it is what the room is for. Narrow layout shows one pane at a
  time, so it ignores the collapsed state.
- **Keys follow VS Code**: Ctrl/Cmd+B primary side bar, Ctrl/Cmd+Alt+B the
  secondary one, Ctrl/Cmd+J the bottom panel, Ctrl/Cmd+1–3 editor groups.
  F6 is the usual "next pane" key in desktop apps. Matching uses `e.code`
  (Alt changes `e.key` on macOS). A key event a focused control already
  handled (`defaultPrevented`) is left alone, as with Run/Submit, so the
  Vim (page up) and Emacs (back one character) meanings of Ctrl+B win in
  the editor on Windows and Linux; F6 and the buttons still work there.
- **Mounted while collapsed.** The pane's content stays in the tree,
  hidden, so a chat draft, the open thread and the editor survive, as for
  the narrow tabs (D-55).
- **Collapse button via context.** `Panes` provides the control and
  `PaneHeader` draws the button, so panes that draw their own header (the
  Tutor, the Library's chats) get it without new props.

**D-57 A tmux-style leader key** (2026-11-21, T36)

- **Prefix, not chords.** Asked for: a leader, then a key, like tmux. The
  leader is Ctrl+B by default (tmux's prefix), Ctrl also on macOS as in
  tmux, so it never clashes with Cmd shortcuts. `ui.leader` offers Ctrl+A
  (GNU screen, tmux's common rebinding), Ctrl+Space and off; nothing
  freer, as a free-form key would need validation against keys the app and
  the editor keymaps use.
- **Caught first.** The listener is on `window` in the capture phase and
  stops the event, so the leader works inside the code editor and the key
  after it is never typed. The cost: the leader's own meaning in the
  editor (Ctrl+B is page up in Vim, back a character in Emacs) is lost;
  the setting is the way out. Dialogs keep their keys (leader ignored while
  `aria-modal` is open).
- **Keys.** tmux and Vim habits: `h`/`l` to move left/right (arrows too),
  `o` next pane, `1`–`3` by number, `z` zoom (here: hide both side panes,
  then restore what was open), `?` the list. `[`/`]` for the left/right
  pane. On Practice `j`/`k` move down to the results and up to the editor,
  `t` folds the results, `r`/`s` Run/Submit (Submit records an attempt,
  as Ctrl+Shift+Enter does; two deliberate keys were judged enough).
- **No timeout.** As in tmux the leader waits for the next key; a chip at
  the bottom says so, and Escape, the leader again, an unbound key or the
  window losing focus cancel.
- **T35's Ctrl/Cmd+B and Ctrl/Cmd+Alt+B are gone** (Ctrl+B is the leader);
  Ctrl/Cmd+J, Ctrl/Cmd+1–3 and F6 stay as direct keys.

**D-58 Read aloud with the system's voices** (2026-11-21, T37; the voice is replaced by D-59)

- **Web Speech API, not a cloud or bundled voice.** Asked for: text to
  speech for Library articles. `speechSynthesis` in the renderer uses the
  operating system's voices (macOS, Windows SAPI/OneCore, Linux
  speech-dispatcher): no dependency, no key, offline, and the Library's
  promise that reading sends nothing still holds. Cloud voices (sound
  better) would need another key, network access from main and a privacy
  notice; a bundled neural model (Piper, Kokoro) adds tens of megabytes and
  a WASM or native runtime. Either can come later behind the same bar.
- **Linux needs a switch.** Chromium reaches speech-dispatcher only with
  `--enable-speech-dispatcher`; `beforeReady` adds it on Linux. Without
  speech-dispatcher and a voice the list stays empty and the button says
  what to install.
- **One utterance per chunk.** Blocks (headings, paragraphs, list items,
  cells) are read one by one, long ones in sentence chunks of at most 240
  characters: Chromium engines can stop part way through long utterances,
  the highlight follows the block, and a new speed or voice applies at
  once (the chunk is spoken again). Code blocks are skipped: read out,
  symbols are noise.
- **Pause is cancel.** `speechSynthesis.pause()` is unreliable on Linux and
  with some Windows voices; pause cancels and remembers the chunk, resume
  speaks it again. Each utterance carries a generation number so the end
  or error event of a cancelled one is ignored.
- **Speed and voice in `localStorage`.** Voice ids differ per computer, so
  they are UI state like pane sizes, not settings to export.
- **Leader keys** `p` (start, pause, resume), `n`/`b` (next, back; tmux's
  next/previous window), `x` (stop; tmux's kill). Only while an article is
  open and a voice exists.

**D-59 Read aloud with Kokoro, on the GPU when it is faster** (2026-11-21, T38; the device choice is replaced by D-60)

- **Why.** The system voices of D-58 sounded poor (on Linux, eSpeak through
  speech-dispatcher); asked for: an open-source voice such as Kokoro, on the
  GPU if that helps. Kokoro-82M v1.0 (Apache-2.0) replaces the Web Speech
  API entirely; one engine is simpler to keep right than two. The blocks,
  chunks, highlight, bar and leader keys of D-58 stay.
- **Native runtime, not the browser.** Measured in this container (4
  cores): one 9.4 s sentence took 24 s with transformers.js on WebAssembly
  (q8, one thread), 17 s with threads, 5.7 s with onnxruntime-node on the
  CPU (q8) and 2.5 s with the full-precision model. So the engine is
  onnxruntime-node 1.31.1 in an Electron **utility process**, the full
  model (`model.onnx`, 325 MB: faster and better than the quantized ones on
  a native CPU), and no transformers.js or kokoro-js (they would ship
  onnxruntime-web and sharp for nothing). The text side (normalization,
  eSpeak NG phonemes, the vocabulary) is ported from kokoro-js 1.2.1
  (`main/tts/text.ts`) and checked to give the same phonemes.
- **GPU only when faster.** onnxruntime-node 1.31 bundles a WebGPU provider
  (Dawn: Vulkan on Linux, Metal on macOS, D3D12 on Windows) and, on
  Windows, DirectML; CUDA needs a separate install, so it is not used. On
  first use the CPU and the GPU are timed on the same sentence (after a
  warm-up each) and the GPU is kept only at 1.2× the CPU's speed or better;
  a GPU whose warm-up is far slower than the CPU's run is not timed again
  (a software Vulkan driver here: 0.2× against the CPU's 3.9×). The choice
  is saved in `device.json` beside the model, keyed by runtime version and
  platform, and made again if the GPU fails to open. `ALGO_TTS_DEVICE`
  forces one. Not measured on a real GPU (none here).
- **Download on request, pinned and hashed.** The model is not in the
  installer (it would triple it); the first Read aloud offers it with its
  size. Main downloads from one revision of
  `onnx-community/Kokoro-82M-v1.0-ONNX`, redirects only to Hugging Face
  hosts, SHA-256 per file, `.part` then rename, `ready.json` last; one
  download shared by its callers. It lives in the cache folder: not
  exported, re-downloadable.
- **Audio over IPC, Web Audio in the renderer.** `tts:speak` returns a
  `Float32Array` (24 kHz mono); the renderer plays it and asks for the next
  chunk while one plays, so there is no gap. Pause suspends the
  `AudioContext`, so it stops mid-sentence and resumes there (better than
  D-58's cancel). A new speed or voice applies from the start of the
  current chunk. The renderer's CSP is unchanged (`connect-src 'none'`).
- **Packaging.** `onnxruntime-node` is native: `electron-builder.yml` ships
  it outside the asar as `<resources>/onnxruntime-node` with only the
  binaries for the platform and architecture built (47 MB on Linux x64),
  and main passes its path to the utility process. Checked in a packaged
  Linux build with its fuses on; not built for macOS or Windows here
  (macOS signing of the dylib is untested).
- **VERIFY eSpeak NG's licence before a release.** (Resolved by D-61: it is
  downloaded, not shipped.) `phonemizer` (1.2.1) is
  labelled Apache-2.0 but contains eSpeak NG, which is GPL-3.0-or-later, and
  it is bundled into the utility process. Notices are in
  `build/notices/espeak-ng.txt`. Whether shipping it this way is acceptable
  for an Apache-2.0 app (or whether eSpeak should be downloaded with the
  model, or replaced by a dictionary-based phonemizer) is for the
  maintainer to decide before the next release.

**D-60 Read aloud on the CPU, the GPU only when the learner turns it on** (2026-11-21, T39)

- **Why.** Asked for: simpler logic, the CPU by default, and a setting to
  use the GPU. D-59's choice by timing both devices cost a slow first start
  (about 30 s here with a software Vulkan driver) and took code (a
  benchmark, a warm-up budget, a saved `device.json`, `ALGO_TTS_DEVICE`)
  for a gain that is unmeasured on real GPUs.
- **What.** `library.readAloudGpu` (boolean, default false) in
  `settings.json`, shown in Settings → Library as **Use the GPU**. Off: one
  CPU session. On: the GPU providers of D-59 (DirectML then WebGPU on
  Windows, WebGPU elsewhere), each checked with one short run (which also
  warms it up); if none works, the CPU, and the status says "No GPU could
  be used". Main reads the setting when it starts the utility process; a
  change restarts the process before the next chunk, never during one.
- **Speed shown** is measured on each chunk actually spoken, not by a
  benchmark; until one is spoken Settings shows only the device. Speeds
  under 1× read "slower than real time", so a learner whose GPU is slow
  can see it and turn the setting off.
- `device.json` files left by T38 are ignored.

**D-61 eSpeak NG is downloaded with the voice, not shipped** (2026-11-21, T40; resolves D-59's VERIFY)

- **Why.** The app is Apache-2.0 (`LICENSE`, every `package.json`). eSpeak
  NG, inside `phonemizer` 1.2.1 (whose own label is Apache-2.0), is
  GPL-3.0-or-later. T38 bundled it into `tts-worker.js`, so every installer
  carried GPL code combined with the app's, which would put the
  distributed app under the GPL's terms. The maintainer asked for it to be
  downloaded by users instead. (Not legal advice; the usual reading of the
  GPL, which the FSF's FAQ on "aggregates" and separate programs supports.)
- **What.** eSpeak is one more file of the read-aloud download:
  `phonemizer@1.2.1/dist/phonemizer.js` (1.3 MB, self-contained, no
  imports), from jsDelivr, pinned by size and SHA-256 (the same bytes npm
  publishes; checked against the installed package), redirects refused.
  The app never contains it: `npm run e2e:read-aloud` checks that no built
  file holds eSpeak's code, and a packaged Linux build was checked the same
  way (`tts-worker.js` went from 2.2 MB to 6 KB).
- **Kept apart.** It runs in its own utility process
  (`espeak-worker.ts`, ours, 40 lines: loads the downloaded module by path
  and answers `{text, language}` with phonemes). Main normalizes and splits
  the text (`text.ts`), asks it for phonemes and sends only phonemes to the
  engine process. Plain messages between separate programs, not linking.
- **Notices.** `build/notices/espeak-ng.txt` is replaced by `kokoro.txt`,
  which says what is downloaded, from where, and eSpeak's licence and
  source. The download dialog and the guide say eSpeak comes separately
  because of its licence.
- `phonemizer` stays a devDependency, for `text.test.ts` (phonemes checked
  against the real eSpeak) and the e2e's local copy; it is never imported
  by app code.
- Considered: a dictionary-based phonemizer (permissive licence, nothing
  GPL at all) — more work and worse on unknown words; left as a follow-up.

**D-62 The app may change library folders, on request** (2026-11-21, T42; changes SPEC §15.1, §15.7)

- **Why.** The maintainer asked for the Articles pane to create, move and
  delete articles and folders, in their own folders as well as the tutor's.
  Until now the app promised never to write to a library folder.
- **What.** Only three changes, each started by the user in the tree: make
  a folder, move a file or folder (keeping its name; across library folders
  too), and send one to the OS trash. The app still never edits or creates a
  note itself, except the tutor's articles (T43) saved where the user
  chose. No rename (not asked for).
- **Delete goes to the trash** (`shell.trashItem`), never `rm`, so a mistake
  can be undone in the file manager. The one outright delete is the source
  of a file copied to another drive by a move (`rename` fails with
  `EXDEV`); a folder is not moved across drives.
- **Paths.** The renderer still never sees an absolute path: items are an
  article id or `(folder id, path inside the folder)`. Main checks names in
  core (`pathParts`, `entryNameProblem`: no `.`/`..`, dot names, which the
  scan would hide, Windows-reserved names or characters Obsidian refuses),
  then the real paths: every folder it writes in must be inside the library
  folder's real path; the moved or trashed entry is not followed, so a
  symlink is moved as a link. Existing targets are refused, never replaced.
- **Index and chats.** A move updates the rows directly (folder id and
  path, a folder's rows by prefix), so ids and chats follow even across
  library folders, where a rescan alone would lose them (identity is per
  folder). Scans and changes share one lock so a scan in flight cannot
  undo a move. Trashed articles with chats stay as "file missing" (the
  SPEC's rule for any file that disappears); those without leave the index.
- **AI-written per article.** `articles.generated` (migration 0004) replaces
  "the folder is `generated`", so a tutor article moved into a vault keeps
  its label. As before (D-43), a note's own `generated:` key never sets it.
- **Empty folders show**: the scan now lists folders, kept in memory per
  folder. A folder holding only images (`attachments/`) now shows too, as
  in Obsidian.
- The Settings line and the guide say the app changes the folders only when
  asked.


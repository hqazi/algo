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

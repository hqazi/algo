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
5. **Check.** `npm run typecheck`, `npm run lint`, `npm test`, and
   `npm run validate:content` once it exists (T04), plus the ticket's own
   checks. Tick an acceptance box only with evidence (a test, a command's
   output, a manual check actually done).
6. **Finish.** Fill the ticket's **Notes.**: what was built, decisions,
   wiring outside **Owns**, and plainly what was *not* done or not tested. Set
   the table to `done`, or `blocked` with the reason in Notes. Then merge into
   `main` (rules below) and push.

## Rules for every ticket

- Work on a branch `task/TNN-short-name` from the latest `main` (or the
  session's assigned branch). When the checks pass, rebase on `main`, merge
  into `main` fast-forward and push. No pull requests. Never force-push
  `main`.
- `packages/core` never imports Electron or Node-only modules.
- No test calls a real AI provider. Never commit credentials, user data, or
  recorded real AI responses.
- Model-written code runs only in the Pyodide executor; hidden test data never
  leaves the main process unredacted.
- Report honestly: list anything not done or not tested.

## Progress

Statuses: `todo`, `in-progress`, `blocked`, `done`.

| Ticket | Title | Milestone | Size | Depends on | Status |
|---|---|---|---|---|---|
| T01 | Repository scaffold | v1 | 2d | — | done |
| T02 | Electron security baseline and typed IPC | v1 | 1d | T01 | done |
| T03 | Problem format v2 and neutral types | v1 | 2d | T01 | done |
| T04 | Port the curated problems and references | v1 | 2d | T03, T07 | done |
| T05 | SQLite storage and migrations | v1 | 2d | T01 | done |
| T06 | Port the core teaching logic | v1 | 3d | T05 | done |
| T07 | Executor interface and Pyodide execution host | v1 | 3d | T03 | done |
| T08 | Port the UI shell and practice flow | v1 | 4d | T02, T06, T07 | done |
| T09 | Onboarding and Settings | v1 | 2d | T08 | done |
| T10 | Tutor: Anthropic backend and chat | v1 | 5d | T06, T08 | done |
| T11 | Tutor: Claude Code backend | v1 | 2d | T10 | done |
| T12 | New problems: generate, paste, import | v1 | 3d | T07, T10 | done |
| T13 | Packaging, auto-update and release workflow | v1 | 3d | T08 | todo |
| T14 | README, end-to-end test, v1 release check | v1 | 2d | T04, T09, T10, T11, T12, T13 | todo |
| T15 | Rust and Go harness generators | v2 | 5d | T04 | todo |
| T16 | Local toolchain executor | v2 | 2d | T15 | todo |
| T17 | Container executor (Docker and Podman) | v2 | 3d | T15 | todo |
| T18 | Settings → Code execution panel | v2 | 2d | T16, T17 | todo |
| T19 | Runner image in CI | v2 | 2d | T13, T15 | todo |
| T20 | README: optional container sandbox and toolchains | v2 | 1d | T18 | todo |

## Order

```
v1:  T01 ─┬─ T02 ─────────────────────────┐
          ├─ T03 ─ T07 ─┬─ T04            ├─ T08 ─┬─ T09
          └─ T05 ─ T06 ─┼─────────────────┘       ├─ T10 ─┬─ T11
                        │                         │       └─ T12 (needs T07)
                        │                         └─ T13
                        └──────────────────────────────── T14 (last)
v2:  T15 (needs T04) ─┬─ T16 ─┐
                      └─ T17 ─┼─ T18 ─ T20
              T19 (needs T13) ┘
```

Critical path: T01 → T03 → T07 → T08 → T10. {T02, T03, T05} can run in
parallel after T01; {T04, T06} after their dependencies; {T09, T10, T13}
after T08.

---

## v1: Python desktop app

### T01 — Repository scaffold

- Milestone: v1
- Size: 2d
- Depends on: —
- Spec: §3.1, §3.2, §13
- Owns: `package.json`, `package-lock.json`, `tsconfig*.json`, `packages/core/`, `apps/desktop/` (skeleton only), `.github/workflows/ci.yml`, lint and format config, `.gitignore`, `.nvmrc`

**Goal.** An npm-workspaces monorepo that builds, lints, type-checks and tests
on Linux, macOS and Windows in CI, with an Electron app that opens an empty
React window.

**Scope.**
- Node 22 (`.nvmrc`), npm workspaces: `packages/core`, `apps/desktop`.
- `apps/desktop` on electron-vite with `main`, `preload`, `renderer` entries;
  React + TypeScript renderer showing "Algorithm Tutor".
- `packages/core` with one trivial exported function and a Vitest test.
- Root scripts: `dev`, `build`, `typecheck`, `lint`, `format`, `test`.
- CI: install, typecheck, lint, test on ubuntu, macos, windows. No secrets.
- Pin exact versions of Electron, electron-vite, React, Vitest; record them in
  `DECISIONS.md`.

**Acceptance.**
- [x] `npm ci && npm run typecheck && npm run lint && npm test` passes locally and in CI on all three OSes.
- [x] `npm run dev` opens a window showing the app name.
- [x] `packages/core` has no dependency on Electron or Node built-ins (enforced by a lint rule or tsconfig `lib`/`types`).

**Notes.**

Built: npm workspaces (`packages/core`, `apps/desktop`); `tsconfig.base.json`
(strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`verbatimModuleSyntax`); ESLint flat config (`eslint.config.js`), Prettier
(`.prettierrc.json`, Markdown ignored to keep hand wrapping), `.gitattributes`
forcing LF so `format:check` passes on Windows; Vitest with one project per
workspace (`vitest.config.ts`). Root scripts `dev`, `build`, `typecheck`,
`lint`, `format`, `format:check`, `test`. `apps/desktop` is electron-vite
with `src/main`, `src/preload` (built as CJS for the sandbox) and
`src/renderer` (React, shows "Algorithm Tutor"); the skeleton window already
uses `contextIsolation`, `sandbox`, no `nodeIntegration` and a CSP meta tag,
but the full baseline is T02. Core exports `APP_NAME`/`appTitle` with a test;
the renderer has one render test. CI (`.github/workflows/ci.yml`) runs
`npm ci`, typecheck, lint, format check, test and build on ubuntu, macOS and
Windows, on every push and PR. Versions and the core-isolation mechanism are
in D-10.

Evidence: locally on Linux, `npm ci` then typecheck, lint, format check, test
(3 tests) and build all pass; CI run 2 (44340601241) passed on ubuntu, macOS and Windows (run 1 was cancelled by a newer push). `electron-vite
dev` was run under Xvfb and a screenshot showed the window with the app name.
Core isolation checked by adding a temporary file using `process`,
`document`, `setTimeout` (type errors) and importing `node:fs`, `path`,
`electron` (lint errors).

Not done / caveats: `npm run dev` was checked on Linux only, and as root, so
it needed Chromium's `--no-sandbox` (`npx electron-vite dev -- --no-sandbox`);
normal users do not. It was not opened on macOS or Windows (CI only builds).
`npm install` with Node 22's npm 10.9 crashes on a fresh resolve; use
`npx npm@11 install` to change dependencies (`npm ci` works). One
dev-only `npm audit` advisory (picomatch) has no fix yet. The renderer bundle
is ~565 kB because electron-vite does not minify by default (it is React's
production build); revisit in T13 if size matters. The
desktop `tsconfig.json` is a solution-style file for editors only; scripts
use `tsconfig.node.json` and `tsconfig.web.json` directly.

### T02 — Electron security baseline and typed IPC

- Milestone: v1
- Size: 1d
- Depends on: T01
- Spec: §3, §10
- Owns: `apps/desktop/src/main/window.ts`, `apps/desktop/src/main/ipc/`, `apps/desktop/src/preload/`, `apps/desktop/src/shared/ipc.ts`

**Goal.** The secure foundation every later ticket builds on.

**Scope.**
- Window with `contextIsolation`, `sandbox`, no `nodeIntegration`, `webSecurity`; strict CSP; block navigation, `window.open` and permission requests; no remote content.
- A typed IPC layer: one `shared/ipc.ts` contract (channel → zod request/response schemas), a `handle()` helper in main that validates input, and a typed `window.tutor` bridge in preload. Streaming channels (for chat and job progress) with cancel.
- Electron fuses configured for packaged builds (RunAsNode off, NodeCliInspect off, ASAR integrity where supported).
- One example channel (`app:version`) used by the renderer.

**Acceptance.**
- [x] Unit test: an IPC call with an invalid payload is rejected in main.
- [x] Unit or e2e check that the renderer has no `require`/`process`.
- [x] A streaming channel example with cancel works.

**Notes.**

Built: `shared/ipc.ts` (the contract: invoke and stream channels with zod
schemas, the `IpcResult` envelope, the `TutorBridge` type) and
`shared/channels.ts` (names only, for the preload; matched to the contract
at compile time). `main/ipc/router.ts`: `IpcRouter.handle()` and
`handleStream()` check the sender (the UI page's main frame), parse the
request, parse the handler's reply and events, and answer with an envelope;
streams cancel on request, when the page goes away, or on `dispose()`.
`main/ipc/handlers.ts`: `app:version` and the example stream
`example:count`. `preload/index.ts`: `window.tutor` with `invoke` and
`stream` only. `main/window.ts`: the UI over the `tutor-app://` protocol with
a CSP header, the UI session lock-down (requests, permissions, downloads),
navigation/redirect/`window.open`/`<webview>` guards on every web contents,
and the window itself. `packaging/fuses.ts`: the fuse settings and
`applyFuses()` for T13. Design and fuse table: D-17; versions: D-18. SPEC §10's
"Compromised renderer" row now says what is actually done.

Evidence: `src/main/ipc/router.test.ts` (13 tests: invalid payloads, unknown
channels and untrusted senders refused without calling the handler, contract
breaks reported as `internal`, stream order, cancel, per-page cancel, page
closed, dispose) and `src/main/window.test.ts` (8 tests: trusted URL, request
filter, CSP strings, protocol serving). `npm run check:security` (new, runs in
CI on Linux under Xvfb) starts the built app in Electron and checks from the
real page: loaded over `tutor-app://`; `app:version` rendered; `require`,
`process`, `module`, `Buffer`, `global`, `ipcRenderer` all undefined and
`window.tutor` has only `invoke`/`stream`; invalid payloads and unknown
channels refused over real IPC; a stream delivers 5 events and its result,
and a cancelled one stops (no events after cancel, no stream left running);
CSP blocks `fetch` (also to self), inline script, `eval`, `new Function` and
iframes; navigation and `window.open` refused; notification and geolocation
permission denied; the protocol returns 404 for `main/`, `preload/`,
`pyodide/`, `exec-host/` and `..` paths; a window in the UI session told to
load `https://example.com` gets `ERR_BLOCKED_BY_CLIENT`. `npm run
check:fuses` (new, in CI on all three OSes) flips a copy of Electron and reads
all nine fuses back. Manually on Linux: that copy (with `OnlyLoadAppFromAsar`
left off, as there is no asar yet) passes `check:security` and
`check:exec-host`, and ignores `ELECTRON_RUN_AS_NODE` and `--inspect`; dev
mode (Vite dev server) renders, Vite's WebSocket connects under the dev CSP,
and `app:version` answers. typecheck, lint, format check, 301 tests, build
pass.

A bug found by the tests and fixed: `new URL('tutor-app://x/...').origin` is
`"null"` for every custom-scheme URL, so comparing origins trusted any host.
The sender check compares protocol, host and path.

Wiring outside **Owns**: `main/index.ts` (now small) and new `main/setup.ts`
(start-up shared with the check); `main/exec/host-window.ts` exports its
scheme privileges so both schemes are registered in one call (Electron allows
one); `main/security-check.ts`; renderer `App.tsx`, `ipc.ts` (typed client
that unwraps envelopes into `IpcError`), `env.d.ts`, `styles.css`,
`index.html` (CSP meta tag removed, header instead); `electron.vite.config.ts`
(check entry); `tsconfig.node.json`/`tsconfig.web.json` (`src/shared`,
`packaging`); `eslint.config.js` (Node globals for `packaging/`);
`package.json` scripts `check:security` and `check:fuses`; CI steps.

Not done / caveats:
- Fuses are not applied to any real build yet: there is no packaging until
  T13, which must call `applyFuses()` (or pass the same settings to
  electron-builder's `electronFuses`) and make sure the ASAR integrity hash is
  embedded, or the app will not start on macOS/Windows. `OnlyLoadAppFromAsar`
  and ASAR integrity were therefore not exercised at all. `check:fuses` on
  macOS and Windows only ran in CI, not by hand.
- The camera permission check got `NotFoundError` (this machine has no
  camera), so it does not prove the camera request was denied; notification
  and geolocation do show the handler denying.
- Everything was run as root on Linux with `--no-sandbox`, which also skips
  `app.enableSandbox()` (D-17); CI runs `check:security` as a normal user with
  the sandbox. Not opened on macOS or Windows.
- `example:count` is a placeholder stream; chat and job progress (T08, T10)
  replace it. The example channel was left in rather than hidden behind a
  development flag.
- The renderer bundle includes zod (about 190 kB) because it imports
  `@algorithm-tutor/core`'s index; that predates T02 (T03) and is unchanged.
- Run from `out/main/` directly (not via `electron .`), `app.getVersion()`
  reports Electron's version or `0.0`; packaged builds read `package.json`.

### T03 — Problem format v2 and neutral types

- Milestone: v1
- Size: 2d
- Depends on: T01
- Spec: §5.1, §5.2
- Owns: `packages/core/src/problems/`, `packages/core/src/types/`, `packages/core/src/compare/`, `content/schema/`

**Goal.** The language-neutral problem format, in code.

**Scope.**
- zod schemas for `meta.json` v2 and `tests.json` v2; JSON Schema export to `content/schema/`.
- Neutral type parser (`list<list<int>>`, `tree<int>`, `optional<T>`, …) and a validator that checks every test input/expected value against the signature.
- Python mapping (type → Python hint string) for stubs and prompts.
- Compare modes `exact`, `unordered`, `unordered_deep`, `float` with tolerance, ported from `dsa-tutor` (`dsa_tutor/core/grading.py`) with the same behaviour.
- A loader that reads a problem folder (via an injected file reader) and returns a validated problem.

**Acceptance.**
- [x] Unit tests for the type parser (valid and invalid), value validation per type, every compare mode (port the `dsa-tutor` cases).
- [x] The `level-lists` problem from `dsa-tutor`, hand-converted, loads and validates.

**Notes.**

Built, in `packages/core/src/`:
- `types/`: `parseType`/`formatType` for neutral types (grammar in
  `neutral.ts`), `checkValue` (a JSON value against a type, with paths like
  `input.root[3]`), `pythonType`/`pythonSignatureLine`/`pythonNodeClasses`
  (matches the hints `dsa-tutor` used, e.g. `TreeNode | None`), the
  signature zod schema and `Language`, and `parseJson`/`stringifyJson`,
  which keep integers beyond 2^53 exact as `bigint` (D-11).
- `compare/`: `compareValues` (`exact`, `unordered`, `unordered_deep`,
  `float` + tolerance) and `valuesEqual`, ported from `grading.py`.
- `problems/`: zod schemas for `meta.json` and `tests.json` v2, cross-file
  checks (`crossCheckProblem`: inputs and expected values against the
  signature, compare mode against the return type, language support),
  `loadProblem(reader, dir, { topics? })` over an injected
  `ProblemFileReader`, returning the problem (meta, tests, statement,
  reference, brute force) or every error as `file: path: message`, and
  `problemJsonSchemas()`.
- `content/schema/meta.v2.schema.json`, `tests.v2.schema.json`, written by
  `npm run schema:export`; a test fails if they drift from the zod schemas.

Decisions: D-11 (exact 64-bit integers), D-12 (format v2 rules), D-13
(zod 4.6.7, tsx 4.23.15). `SPEC.md` §5.1 (optional fields, strict keys)
and §5.2 (type rules, tree shape, big integers) updated to match.

Evidence: `npm run typecheck`, `npm run lint`, `npm run format:check`,
`npm test` (241 tests) pass locally; CI run 44346025554 passed on
ubuntu, Windows and macOS (macOS on a re-run: the first attempt was
cancelled after 15 minutes waiting for a runner). Compare: `dsa-tutor` has no tests for
compare modes, so `compare/fixtures/gen-dsa-tutor-cases.py` runs the
original `compare()` on 62 cases (every mode, bool/number, key sets,
nesting, tolerance edges) and the port must agree with each; plus bigint
cases. `level-lists` is hand-converted under `problems/fixtures/` and
loads; ~30 mutations of it each produce the expected error. As an extra
check (scratch script, not committed; T04 owns the converter) all 50
curated problems were converted with a plain type map (`TreeNode | None` →
`tree<int>`, `ListNode | None` → `linked_list<int>`, `str` → `string`, …)
and all 50 load and validate.

Wiring outside **Owns**: `zod` in `packages/core/package.json`; `tsx`, the
`schema:export` script and `tsc -p tsconfig.scripts.json` in the root
`package.json` typecheck; new `tsconfig.scripts.json`, `scripts/export-schemas.ts`;
`eslint.config.js` gives `scripts/**` Node globals; `packages/core/src/raw.d.ts`
types Vite `?raw` imports for tests.

Not done / for later tickets:
- No Node file reader for `loadProblem` yet; main (T04/T08) provides one.
  Paths are joined with `/`.
- T07 must use `parseJson`/`stringifyJson` for harness input and output,
  convert `map<int,…>` keys (JSON strings) to Python ints, and build nodes
  from the neutral type rather than `dsa-tutor`'s `"TreeNode" in type` test.
- `tree<T>` and `linked_list<T>` are limited to scalar `T`; `tuple` needs
  ≥ 2 items. Revisit if a problem needs more.
- An `int` written as `2.0` passes validation (indistinguishable after
  parsing; D-11).
- Topic ids are checked only when the caller passes `topics` (the topics
  table arrives with T04's references).
- The time-limit rule is T07's; the fixture uses 2000 ms.

### T04 — Port the curated problems and references

- Milestone: v1
- Size: 2d
- Depends on: T03, T07
- Spec: §5.1, §5.3, §9
- Owns: `content/problems/`, `content/references/`, `scripts/convert-dsa-tutor.ts`, `npm run validate:content`

**Goal.** All 50 curated problems and the teaching references, in format v2,
verified.

**Scope.**
- A one-off conversion script from `dsa-tutor/problems/curated/` (meta.json `signatures.python` → neutral `signature`, `schema_version` 2, `languages: ["python"]`, `content_version: 1`). See `CONTEXT.md` for where the source lives.
- Copy and adapt `references/` (topics, questionnaire, hint ladder, review rubric, problem spec) for the app: tools instead of scripts, language-aware wording.
- `npm run validate:content`: every problem validates and its reference passes every test in Pyodide (via T07's executor; a Node-side Pyodide runner is fine for this check).
- Set `time_limit_ms` per problem from measured reference times (T07's rule).

**Acceptance.**
- [x] 50 problems under `content/problems/<topic>/<slug>/`, all valid.
- [x] `npm run validate:content` passes and runs in CI (run 44388766170: Linux, macOS, Windows).
- [x] Any type that did not map cleanly is listed in the done notes with how it was resolved.

**Notes.**

Built (DECISIONS D-19 has the details and reasons):
- `scripts/convert-dsa-tutor.ts` (CLI) and `scripts/convert/dsa-tutor.ts`
  (pure conversion, unit-tested): 50 problems from `dsa-tutor` commit
  `50cdcd3` into `content/problems/<topic>/<slug>/`. Each is loaded back
  through core's `loadProblem` with the topic list. Re-running it with
  `--force` reproduces the committed files exactly (checked).
- Types: **every hint mapped cleanly** (`str` → `string`, nodes →
  `linked_list<int>` / `tree<int>`, lists, `int`, `bool`); nothing needed a
  special case. The converter throws on anything else.
- `problem.md` made language-neutral: JSON literals in examples (regenerated
  from visible tests), Python signature and script instructions dropped, a
  Notes section for trees/linked lists/order, ten Python-only phrases
  reworded. The converter verifies the v1 examples and tail against
  `dsa-tutor`'s renderer before replacing them.
- `content/references/`: all five ported, script commands → SPEC §7.1 tool
  names, language-aware wording (idioms, costs, neutral types in
  `problem_spec.md`).
- `npm run validate:content` (`scripts/validate-content.ts`): references
  present and free of script commands; every problem loads; folder = topic;
  every topic has a problem; each reference passes every test in Pyodide (Node
  worker threads, same pool/runtime/harness as the host); `time_limit_ms` ≥
  the measured rule. All 50 pass locally in about 70 s; slowest test 62 ms
  (`min-daily-pages`), so 2000 ms stands for every problem.

Wiring outside **Owns**: `scripts/content/topics.ts` (topics.md parser, until
T06), a `scripts` project in the root `vitest.config.ts` for the script
tests, a CI step, `content/problems/**/tests.json` in `.prettierignore`, one
line in SPEC §5.1.

Not done / not tested:
- `validate:content` runs Pyodide on Node, not inside the Electron execution
  host; the host was already checked against the same 50 references in T07
  (D-15) with `check:exec-host --measure`, but that is not re-run in CI on
  the converted files.
- Statements were reviewed by spot checks, not one by one; `len(x)` notation in
  constraints is kept.
- The T03 fixture `level-lists` still has the old v1-style statement.

### T05 — SQLite storage and migrations

- Milestone: v1
- Size: 2d
- Depends on: T01
- Spec: §4.1, §4.2, §4.3
- Owns: `apps/desktop/src/main/storage/`, `packages/core/src/storage.ts` (interface)

**Goal.** Durable local state with safe upgrades.

**Scope.**
- `better-sqlite3`, rebuilt for Electron; data dir resolution (`userData`, `ALGOTUTOR_DATA_DIR`).
- Migration runner: numbered SQL files, transaction per migration, `tutor.db.bak-<version>` before migrating, refuse newer DBs.
- Schema per §4.2.
- A `Storage` interface in core and its SQLite implementation in main; one serialised write queue.
- `settings.json` load/save with zod, defaults, unknown keys kept, change events.

**Acceptance.**
- [x] Tests: fresh DB, migrate from v1 to v2 with a sample migration, refuse a newer DB, backup file created.
- [x] Tests: invalid `settings.json` values fall back to defaults and are reported.
- [x] Storage runs under Electron's Node (rebuild verified in CI). No rebuild exists with `node:sqlite` (D-20); `check:storage` passed on ubuntu, macOS and Windows in CI run 44412267409.

**Notes.**

Built (decisions in D-20):
- `packages/core/src/storage.ts`: record types for every SPEC §4.2 table
  and the `Storage` interface: synchronous `read(fn)`; `write(fn)` (queued,
  one transaction, synchronous `fn`); `serial(task)` (queued async task that
  holds the queue, writing through the function it is given).
- `packages/core/src/settings.ts` (outside **Owns**, but pure and needed by
  the Settings UI later): the §4.3 schema and defaults, `parseSettings`
  (lenient, reports issues), `applySettingsPatch` (strict),
  `settingsForFile` (keeps unknown keys), `changedSettings`.
- `apps/desktop/src/main/storage/`: `paths.ts` (`ALGOTUTOR_DATA_DIR` or
  `userData`; the §4.1 layout), `database.ts` (open + migration runner:
  transaction per migration, `tutor.db.bak-<version>` via `VACUUM INTO`,
  refuses newer and foreign databases), `migrations/0001-initial.sql` (the
  §4.2 schema, `STRICT` tables with `CHECK`s), `sqlite-storage.ts`
  (`SqliteStorage`, the single write queue), `settings-store.ts`
  (`SettingsStore`: load, atomic save, change events), `index.ts`
  (`openAppStorage`), `check.ts` (`npm run check:storage`).
- SQLite is Node's built-in `node:sqlite`, not better-sqlite3 as scoped
  (owner's choice after CI showed `npm ci` compiles better-sqlite3 from
  source and fails on Windows; D-20). Nothing native to install or rebuild:
  it is part of Node 22 and of Electron 45's Node 24.

Tests: 48 new (migrations 11, storage 13, settings store 10, core settings
11, paths 3); `npm test` 374 pass. Typecheck, lint, format check and
`validate:content` pass. `npm run check:storage` (8 checks in the real
Electron main process: `node:sqlite` works, fresh schema, write/read with a
64-bit integer, settings round trip, migrate with backup, refuse newer)
passes here on Linux and runs in CI on all three OSes.

Wiring outside **Owns**: `apps/desktop/src/main/index.ts` opens storage
before the window (error dialog and quit if the database is newer, foreign
or a migration fails; settings issues are logged); `electron.vite.config.ts`
(`storage-check` entry); `check:storage` scripts in both `package.json`s;
the CI step; SPEC §3.2 and §4.3 wording (D-20).

Not done / not tested:
- Nothing uses `Storage` yet (T06), and no IPC exposes settings (T09).
  Settings issues are only logged until T09 shows them.
- The error dialog for an unusable database was not seen: a manual launch
  with schema version 99 blocked on the modal dialog and left the file
  untouched, but nobody looked at the dialog.
- `settings.json` is not watched for edits made while the app runs.
- Export (SQLite backup API, SPEC §4.5) is not built; `node:sqlite`'s
  `backup()` or `VACUUM INTO` will do it.
- Packaged builds are T13's to check (nothing native is involved now).
- Node 22 prints an `ExperimentalWarning` for `node:sqlite` in unit tests.

### T06 — Port the core teaching logic

- Milestone: v1
- Size: 3d
- Depends on: T05
- Spec: §9, §7.1
- Owns: `packages/core/src/teaching/`, `packages/core/src/tools/`

**Goal.** The recommender, levels, hints and attempt recording, and the tutor
tool handlers, in TypeScript.

**Scope.**
- Port from `dsa-tutor/dsa_tutor/core/state.py`, `catalog.py`, `common.py`, `problems.py` and the topics table parsing: status, next (with topic/difficulty), start, hint, record (outcome from hints/explanation), profile, focus, attempts.
- Tool definitions (name, description, JSON schema) and handlers for §7.1, using injected `Storage`, `Executor` and problem catalog. Port descriptions from `dsa-tutor/dsa_tutor/tools/`.
- Behaviour must match `dsa-tutor`: port its tests (`tests/test_scripts.py`, `tests/test_tools.py`) as the spec.

**Acceptance.**
- [x] Ported tests pass with an in-memory storage fake.
- [x] `record_attempt` runs the tests itself (no pass counts from the caller).
- [x] `get_problem` never returns hidden tests (test).

**Notes.**

Built: `packages/core/src/teaching/`: `parseTopics` (topics.md), the
`ProblemCatalog` interface and `memoryCatalog`, `Workspace` and Python
`starterCode`, profile rules, levels (`computeTopics`), the recommender
(`recommend`, `pickProblem`) and `Teaching` (status, profile/defaults/set,
focus, next problem, start, hint, mark explained, record, attempts), plus
`MemoryStorage`, an in-memory `Storage` with the same queue and rollback
contract as `SqliteStorage`. `packages/core/src/tools/`: the ported JSON
Schema subset validator, `ToolRegistry` (validation, error results, UI
events, Anthropic and MCP exports, `subset`), `SlugGuard`,
`runProblemTests`/`runView` (executor → grade → redact, shared with T08's
Run/Submit), and the 15 tools of SPEC §7.1 with `dsa-tutor`'s descriptions
and schemas. Design and the small behaviour changes: D-21; SPEC §7.1 got a
paragraph on optional tools, `language` and stored test runs.

Wiring outside **Owns**: `languagesWithHarness()` in
`packages/core/src/problems/validate.ts`; core exports both modules from
`index.ts`; an `import.meta.glob` declaration in `packages/core/src/raw.d.ts`
(tests load the real content with it); `scripts/content/topics.ts` now
re-exports core's parser; one integration test,
`apps/desktop/src/main/exec/tutor-tools-pyodide.test.ts`.

Evidence: `teaching/teaching.test.ts` ports `test_scripts.py`'s `TestState`
(the full learning loop, hint ladder cap, defaults start at the basics),
explanation-counts-as-hint and the bad-input cases, on the real curated
content; `tools/tutor-tools.test.ts` ports every `test_tools.py` case
(registry, exports, validation, crash handling, each tool, busy guard,
untrusted pasted text, and the hidden-data sweep over three problems with
echoing, raising and non-loading solutions, now also over stored test runs)
with a scripted executor graded by core's real `gradeRun` and
`redactReport`; `record_attempt` rejects `passed`/`total` inputs and is
checked to submit one job with every test. The integration test runs the
starter code, a reference and a wrong/looping solution through real Pyodide
and SQLite. `npm run typecheck`, `lint`, `format:check`, `test` (440 tests),
`validate:content` (50 problems) and `build` pass locally on Linux.

Not done / not tested: `create_problem` and `render_explanation` have their
definitions, schemas, guard and explained-marking here, but their handlers
call services that T12 (spec validation, self-check, saving) and T10
(rendering, versions) must supply; without them the tools are not offered.
`test_create_problem*`, `test_render_explanation`'s page checks and
`test_scripts.py`'s `TestNewProblem` move with those tickets.
`TestRunTests` (harness behaviour) was T07's; `TestDataRoot` is replaced by
T05's data folder. Nothing in the app constructs `Teaching` yet: the catalog
over `content/` and the data folder, the workspace on disk, keeping the
`problems` index in SQLite (which the removed-problem fallback relies on) and
IPC are T08. `MemoryStorage` detects re-entry only synchronously (no
`AsyncLocalStorage` in core). Only checked on Linux; CI covers the rest.

### T07 — Executor interface and Pyodide execution host

- Milestone: v1
- Size: 3d
- Depends on: T03
- Spec: §6.1, §6.2, §6.3, §10
- Owns: `packages/core/src/exec/`, `apps/desktop/src/exec-host/`, `apps/desktop/src/main/exec/`, `content/runners/python/`

**Goal.** Run Python solutions against tests, safely, with timeouts.

**Scope.**
- `Executor` interface and `RunReport` in core; redaction function (hidden tests → id, category, status, time).
- Execution host: hidden sandboxed window, own session partition, all network blocked, CSP `connect-src 'none'`; Pyodide bundled and loaded from app files; one Web Worker per job, terminated on timeout; warm start.
- Port `dsa-tutor/runners/python/harness.py` (TreeNode/ListNode builders, stdout capture) to return `actual` per test; comparison in core.
- Disable `micropip`, package loading and `pyodide.http`.
- Measure all `dsa-tutor` references in Pyodide; record numbers and the time-limit rule in `DECISIONS.md` (resolves the §14 DECISION default or proposes another).
- Resolve the §14 VERIFY on network blocking.

**Acceptance.**
- [x] Tests: pass, fail, runtime error, syntax error, infinite loop (timeout kills it, next job works), large output truncated.
- [x] Test: Python code calling `js.fetch`, `open('/etc/passwd')`, `import micropip` fails or is blocked.
- [x] Redacted report contains no hidden input/expected/actual (test).

**Notes.**

Built:
- `packages/core/src/exec/`: `Executor`, `RunJob`, `RunReport`, `TestResult`
  (SPEC §6.1, plus `errorType` and `line`, and a structural `CancelSignal`
  since core has no DOM types); the harness wire format (`toHarnessRequest`:
  inputs only, as exact JSON text); `gradeRun` (compare in core, time limit,
  stdout/message clipping, compile errors, cancellation); `redactReport`
  (allowlist: hidden tests keep `id`, `visibility`, `category`, `status`,
  `timeMs`); `timeLimitFromReference` / `effectiveTimeLimitMs`.
- `content/runners/python/harness.py`: ported from `dsa-tutor`; now a library
  the worker calls per test (`make_harness`, `load`, `run`), typed by the
  neutral types (trees, linked lists, tuples, int-keyed maps, floats,
  optionals), bounded stdout/stderr capture, import guards.
- `apps/desktop/src/exec-host/`: `runtime.ts` (locked-down Pyodide start,
  shared by the browser worker and the Node test worker), `pool.ts` (single-use
  workers, warm spares, per-test kill timers, resume after timeout, crash and
  stack-overflow handling, cancellation, jobs serialised), `worker.ts`,
  `host.ts` + `index.html`, `preload.ts` (port hand-over only),
  `testing/` (Node worker-thread factory for tests).
- `apps/desktop/src/main/exec/`: `PyodideExecutor` (grades in core),
  `host-window.ts` (`ExecHost`: hidden window, in-memory partition,
  `tutor-exec://` protocol with CSP headers, `webRequest` blocking, permission
  denial, watchdog, restart after a renderer crash), `check.ts`
  (`npm run check:exec-host`, 20 checks in real Electron; `-- --measure <dir>`
  times references).
- Tests: `packages/core/src/exec/*.test.ts` (13) and
  `apps/desktop/src/main/exec/pyodide-executor.test.ts` (25, real Pyodide on
  Node worker threads through the same pool/runtime/harness).

Decisions: D-14 (VERIFY resolved: network blocking and package loading;
worker CSP needs `connect-src 'self'` and `'wasm-unsafe-eval'`, so SPEC §6.2
changed), D-15 (DECISION resolved: default time-limit rule kept; all 50
references measured, slowest test ≤ 100 ms, Pyodide ~2.4× CPython), D-16
(pyodide 314.0.7). SPEC §6.1, §6.2 and §14 updated.

Wiring outside Owns: `apps/desktop/electron.vite.config.ts` (renderer root is
now `src/` with two pages, so the UI page is `out/renderer/renderer/index.html`
/ `<dev>/renderer/index.html`; second preload `exec-host.cjs`; second main
entry `exec-check.js`; plugin copying Pyodide's files); `src/main/index.ts`
(registers the scheme before `ready`, new page path); `tsconfig.node.json` /
`tsconfig.web.json` includes; `apps/desktop/package.json` (pyodide,
`check:exec-host`); root `package.json` script; `.github/workflows/ci.yml`
(Linux step: `xvfb-run -a npm run check:exec-host`, after relaxing Ubuntu's
AppArmor user-namespace restriction for Chromium's sandbox); `.gitignore`
(`__pycache__/`).

Not done / not tested:
- The executor is not wired to IPC or created by the app yet (T08 creates
  `ExecHost` + `PyodideExecutor` with `rendererDir`/`preloadPath`, and must
  `redactReport` before anything reaches the renderer or tutor).
- `memoryLimitMb` is not enforced (D-14).
- User code that frees a very long node chain itself can still crash the
  worker; it is reported as an error on that test and the run continues.
- `check:exec-host` was run here on Linux (as root, so with `--no-sandbox`)
  in both the built app and `electron-vite dev`; on macOS and Windows it has
  not been run, and CI runs it on Linux only. The measurement numbers come
  from one Linux container.
- Pyodide is MPL-2.0; its licence notice in the packaged app is left to T13.
- In development the host page shows harmless CSP refusals of Vite's inline
  preamble and HMR socket.

### T08 — Port the UI shell and practice flow

- Milestone: v1
- Size: 4d
- Depends on: T02, T06, T07
- Spec: §2, §8
- Owns: `apps/desktop/src/renderer/`, `apps/desktop/src/main/ipc/handlers/` (problems, attempts, runs)

**Goal.** Practise without AI: browse, open, edit, run, submit, progress.

**Scope.**
- Port from `dsa-tutor/web/src`: app shell, router, Home, Problems, Practice (Panes, Editor, ResultsPanel, Markdown), Progress. Replace the HTTP client with the `window.tutor` bridge.
- IPC handlers for problems, attempts, run/submit (through T07), workspace files (save as you type, reload on external change).
- Light/dark themes; Run and Submit shortcuts.
- Chat pane present but showing "Tutor not configured" (filled by T10).

**Acceptance.**
- [x] Manual and e2e smoke: next problem → edit → run shows visible results → submit records the attempt → progress updates. (`npm run e2e` in the built app, passing; its screenshots checked by eye in light and dark. No hands-on session by a person.)
- [x] Editing the solution file in another editor updates the open editor. (`npm run e2e`; `FileWorkspace` and `PracticePage` tests.)
- [x] Ported UI tests pass (Vitest + Testing Library). (`ResultsPanel`, Markdown; plus new page tests.)

**Notes.**

Done 2026-11-19. Decisions in D-22.

Built:
- Main: `src/main/practice/` (`FileCatalog`, `FileWorkspace`, `Practice`,
  `openPractice`), `src/main/ipc/handlers/practice.ts` (problems, profile
  defaults, status, workspace get/save/watch, run, submit, give up,
  reference, attempts, theme). `handlers.ts` moved to `handlers/index.ts`.
- Renderer: shell with hash routes, Home, Problems, Practice (Panes,
  CodeMirror Editor, ResultsPanel, Markdown), Progress, a Welcome page with
  "use defaults" only, a "Tutor not configured" pane, toasts, theme picker.
  Run Ctrl/Cmd+Enter, Submit Ctrl/Cmd+Shift+Enter. Ported from
  `dsa-tutor/web/src`; the HTTP client is replaced by `window.tutor`.
- Tests: `practice.test.ts` (real content, SQLite, Pyodide on Node threads,
  temp-dir workspace and watch), ported `ResultsPanel` and Markdown tests,
  `PracticePage` and `App` tests on a fake bridge that parses replies with
  the real contract, router test. `npm run e2e` (Playwright for Electron).

Wiring outside **Owns**: `shared/ipc.ts`, `shared/channels.ts`,
`shared/practice.ts` (new channels; error code `refused`);
`main/ipc/router.ts` (`IpcRefusal`); `main/setup.ts` (`startPractice`),
`main/index.ts`; `main/security-check.ts` (now wires practice in a temp data
folder and waits for the Welcome page instead of the old version text);
`apps/desktop/e2e/`, `tsconfig.node.json`, the `e2e` scripts, CI (e2e on
Linux); dependencies in D-22.

Not done or not tested:
- Onboarding questions and Settings are T09: first run offers only the
  defaults; the theme picker sits in the top bar. The tutor pane is a
  placeholder (T10); New problem and generating when a topic runs out are
  T12 (Next problem says so in a toast). Explanations page not ported (T10).
- The e2e runs on Linux only (CI and here). macOS and Windows run the unit
  tests, including the `fs.watch` test, but not the app end to end.
- Links in problem statements are blocked by D-17's navigation guard, not
  opened in the system browser.
- The editor font size and keymap settings are not applied yet (T09).
- A save pending when the window closes is sent but not awaited
  (`beforeunload` must not block in Electron); up to 700 ms of typing can be
  lost if the app quits at once.
- The renderer bundle is about 1.9 MB; not looked into.

### T09 — Onboarding and Settings

- Milestone: v1
- Size: 2d
- Depends on: T08
- Spec: §2, §4.3, §4.4, §4.5, §8
- Owns: `apps/desktop/src/renderer/pages/Onboarding*`, `apps/desktop/src/renderer/pages/Settings*`, `apps/desktop/src/main/secrets/`, `apps/desktop/src/main/data/` (export/import/reset)

**Goal.** Every user-facing setting editable in the app, applied without
restart; the API key in the OS keychain.

**Scope.**
- Onboarding questionnaire (port `ProfileForm`, `references/questionnaire.md`) and the optional "Connect the tutor" step.
- Settings sections per §8 (Updates section is wired in T13; Code execution shows Pyodide status in v1).
- Secrets via `safeStorage`; weak-backend warning on Linux; `ANTHROPIC_API_KEY` from env shown read-only. Resolve the §14 VERIFY.
- Export / import / reset per §4.5.

**Acceptance.**
- [x] Changing model/effort/theme applies immediately (test or e2e).
- [x] The key never appears in the renderer, logs, DB or settings.json (test greps the data dir after storing a known fake key).
- [x] Export then import round-trips progress and workspace files.

**Notes.**

Done 2026-11-19. Decisions in D-24 (resolves the §14 `safeStorage` VERIFY).

Built:
- `main/secrets/`: `SecretStore` (the key in `secrets.bin` through
  `safeStorage`'s asynchronous API, `ANTHROPIC_API_KEY` first and
  read-only, status with `…abcd` only, weak-backend flag on Linux) and the
  Electron adapter. The tutor's `apiKey()` now reads it.
- `main/data/`: export zip, validated import and "reset everything" staged
  in `pending/` and applied at the next start before storage opens (called
  from `index.ts`), reset progress at once; an automatic export to
  `backups/` before each. `DataService` takes injected dialogs; the app's
  are native Electron dialogs (`setup.ts`).
- IPC (`shared/settings.ts`, `ipc/handlers/settings.ts`): `profile:set`,
  `settings:get` / `settings:set` (replacing `settings:theme` /
  `settings:set-theme`), `secrets:status` / `set-key` / `clear-key`,
  `tutor:test` (no-token `GET /v1/models/{model}`), `exec:status`,
  `data:info` / `open-folder` / `export` / `import` / `reset`.
- Renderer: `OnboardingPage` (the five questions or defaults, then
  "Connect the tutor" unless a tutor is already on; replaces
  `WelcomePage`), `SettingsPage` with Tutor, Code execution, Appearance and
  editor, Profile, Data, Updates, About (`SettingsTutor`, `SettingsData`,
  `SettingsShared`), `components/ProfileForm` (port; groups from the
  topics), a Settings link in the top bar (the theme picker moved there).
  The editor takes font size and Vim/Emacs keymaps from the settings.

Wiring outside **Owns**: `storage/paths.ts` (`secrets`, `backups`,
`pending`), `SqliteStorage.snapshot` and `resetProgress` (+ core's
`Storage` interface and `MemoryStorage`), `AnthropicBackend.testConnection`
and `AppTutor.anthropic`, `setup.ts` / `index.ts`, the practice handlers
(theme channels removed), `App.tsx`, `lib/app*.ts*` (settings instead of
theme), `router.ts` (`/settings`), `Editor.tsx`, `PracticePage.tsx`,
`styles.css`, UI test fixtures, `e2e/practice.e2e.ts` (answers the
questions, skips the tutor step, theme via Settings), new
`e2e/settings.e2e.ts` and the `e2e` script. SPEC §4.1, §4.4, §4.5, §12, §14
updated. New dependencies: fflate, @replit/codemirror-vim,
@replit/codemirror-emacs (D-24).

Evidence (Linux, this session): `npm run typecheck`, `npm run lint`,
`npm run format:check`, `npm test` (41 files, 620 tests) pass;
`npm run validate:content` (50 problems valid). `npm run e2e`
under Xvfb: practice, tutor and the new settings script all pass. The
settings e2e stores a fake key through onboarding with real `safeStorage`
(this machine has no keyring: `basic_text`, warning shown), checks the
connection test against a local stand-in API (`ANTHROPIC_BASE_URL`; no AI
provider called), changes model and effort and sees the next request use
the new model without a restart, solves a problem, exports, resets
progress, imports, relaunches, and finds progress, settings and the
solution file back and the key still stored; then searches every file in
the data folder and Electron's `userData` (170 files), the export and the
app's stdout/stderr for the key: none. Unit tests do the same search over
IPC replies, console output, the data folder and the export (a mutation
writing the key in plain text makes it fail), cover export → import
round-trips with a real `tutor.db` (64-bit integers kept), refusals of bad
archives, both resets, and settings applying at once (model, effort,
backend, theme). `check:security` and `check:storage` still pass.

Not done / not tested:
- Only Linux was run, and only without a keyring (`basic_text`). macOS
  Keychain, Windows DPAPI and GNOME/KDE keyrings are untested here; CI
  runs the unit tests on all three OSes but not the e2e.
- The connection test was never run against the real API (by rule); the
  stand-in only checks the request shape. The SDK 1.5 bearer-token auth was
  observed, not checked against the live API.
- Native dialogs (save, open, confirm) are replaced in the e2e; their real
  look was not checked. "Open data folder" (`shell.openPath`) was not
  exercised.
- A failed apply at start-up (e.g. a file locked on Windows midway) shows
  an error and may leave the data half replaced; the export in `backups/`
  holds the earlier data, but there is no automatic roll-back. Backups are
  never pruned.
- Import and export hold the whole archive in memory (fine for expected
  sizes; limits are 256 MB per file, 1 GB in all).
- Claude Code in onboarding and the backend list: T11. Update checks: T13.
- Vim/Emacs keymaps were checked only for being switched on (attribute and
  font size in the e2e), not for key-by-key behaviour.

### T10 — Tutor: Anthropic backend and chat

- Milestone: v1
- Size: 5d
- Depends on: T06, T08
- Spec: §7
- Owns: `packages/core/src/tutor/`, `apps/desktop/src/main/tutor/`, `apps/desktop/src/renderer/chat/`

**Goal.** A working tutor: chat, hint, review, explain, through the tools.

**Scope.**
- `TutorBackend` interface, `ChatEvent` types, turn runner with cancel.
- System prompt builder from the ported teaching rules and references (§7.2).
- `anthropic` backend with `@anthropic-ai/sdk`: streaming, tool loop, content-block replay, cache breakpoint, error mapping. Resolve the §14 VERIFY items and the default-model DECISION from current docs.
- `fake` backend and recorded fixture scripts (port the `dsa-tutor` chat fixtures' scenarios).
- Chat UI port (ChatPane, MessageView, effects), Hint/Review/Explain buttons, explanations viewer (sandboxed iframe, versions).
- Threads in SQLite; reset chat.
- `npm run smoke:ai` (manual, one real hint turn).

**Acceptance.**
- [x] Fake-backend tests for: explain, hint (level climbs one per press), review, run-tests tool, refusal, rate limit, auth error, cancel.
- [x] Hidden test data never appears in any request built for the API (test inspects built requests).
- [ ] With a real key (manual), a hint turn works; noted in done notes whether it was run.

**Notes.**

Done 2026-11-19, except the manual real-key run (below). Decisions in D-23
(default model `claude-opus-5-5`, the re-checked API notes, SDK pin).

Built:
- Core `packages/core/src/tutor/`: `ChatEvent`s (`chat-events.ts`; not
  `events.ts`, which the core lint rule takes for Node's `events`), the
  `TutorBackend` interface, the teaching rules ported from `SKILL.md`
  (`rules.ts`), `buildSystemPrompt` / `renderUserMessage` /
  `compactReport`, `ChatService` (threads in storage, one turn per thread,
  cancel, reset), `FakeBackend` with its script format, and the
  explanation page renderer and template.
- Main `src/main/tutor/`: `AnthropicBackend` (streaming tool loop,
  append-only transcript, stop reasons, fallbacks, error mapping),
  `ExplanationStore` (versions on disk), `openTutor` (backend choice, the
  registry over the practice service with `render_explanation`, the
  per-turn context, the prompt from `content/references/`).
- Renderer `src/renderer/src/chat/` and `explanation/`: `ChatPane`,
  `MessageView`, `ChatEffects`, the chat store over the `chat:send` stream,
  the explanation viewer (sandboxed iframe, version picker) and the list
  under the statement; the practice page shows the tutor's test runs; the
  top bar says whether the tutor is on.
- `npm run smoke:ai` (`apps/desktop/scripts/smoke-ai.ts`): one real hint
  turn through the app's own wiring.

Evidence: core `tutor/chat.test.ts` (the ported chat scenarios with the fake
backend over the real tools and content: hint climbing 1 → 2, review and
record, run tests, explain, failed tool, refusal / rate limit / auth /
network / max_tokens, a backend that throws or stops early, cancel mid-text
and mid-tool, busy, reset and archive, per-backend state, and a hidden-data
sweep over events and stored messages) and `tutor/prompt.test.ts`;
`main/tutor/anthropic/backend.test.ts` against a scripted SDK client (the
exact request: model, adaptive thinking, effort, cache breakpoints, eager
streaming, fallbacks; append-only replay; the tool loop and schema
validation; every stop reason; error classes from real SDK error objects;
cancel while streaming and while a tool runs; the API key never in a
message or log; and the hidden-data check, which inspects every request
built across two turns with tools that touch hidden tests on three
problems, plus the last stored report in the context);
`main/tutor/tutor.test.ts` (the channels through the IPC router with real
content, files and the fake backend, including a hidden-data check of what
reaches the renderer and the backend); renderer `chat/ChatPane.test.tsx`
with the `dsa-tutor` chat recordings ported to `test/chat-fixtures.ts`.
`npm run e2e` now also runs `e2e/tutor.e2e.ts` in the real app with
`e2e/fake-tutor.json`: what next opens a problem, Hint twice climbs, Review
fills the results panel, Explain renders in the sandboxed frame with its
styles, Stop, the chat survives a reload, New chat. All 15 checks pass, as
do the practice e2e and `check:security` (run as root here, so with
`--no-sandbox`). `npm run typecheck`, `lint`, `format:check`, `test` (578
tests, six full runs in a row green) and `validate:content` pass on Linux.
`PracticePage.test.tsx` had a race from T08 (tests used the editor and the
file watch before the file had loaded; it failed about 1 run in 4 on the
pre-T10 commit too): `open()` now waits for the file to load.

Wiring outside **Owns**: `shared/tutor.ts`, `shared/ipc.ts`,
`shared/channels.ts` (channels `tutor:status`, `chat:thread`, `chat:reset`,
`chat:send`, `explanations:*`); `main/ipc/handlers/tutor.ts`;
`main/setup.ts` (`startPractice` also starts the tutor); the router and
preload change for stream results (D-23); `ipc/testing.ts` (the fake
`ipcMain` moved out of `router.test.ts`); `archiveThread` in core's
`Storage`, `MemoryStorage` and `SqliteStorage` with tests;
`hiddenNeedles` moved to core's test support; `ResultsPanel` kind `tutor`;
`PracticePage`, `HomePage`, `App`, styles, `PracticePage.test.tsx`
(above); the e2e script and
`tsconfig.node.json`; the `smoke:ai` root script; SPEC §4.3, §7.3, §7.4,
§14. `components/TutorPane.tsx` is gone. The renderer code lives under
`renderer/src/chat/`, not `renderer/chat/` as **Owns** says (the renderer's
root is `src/`).

Not done or not tested:
- **The real-key hint turn was not run**: this environment has no API
  key. `npm run smoke:ai` was run once with a dummy key, so one request did
  reach the Anthropic API and came back 401, mapped to the `auth` error as
  intended; that checks the wiring up to authentication, not a real reply.
  Run `ANTHROPIC_API_KEY=... npm run smoke:ai` once by hand.
- The API key comes from `ANTHROPIC_API_KEY` only; key entry, the keychain
  and the model/effort pickers are T09. Claude Code is T11 (selecting it
  says "not supported yet").
- Long chats are not compacted; the model's context-window stop asks the
  learner to reset the chat.
- Python highlighting in explanation pages is a small scanner, not Python's
  tokenizer as in `dsa-tutor`; other languages are not highlighted.
- The e2e runs on Linux only, as before.

### T11 — Tutor: Claude Code backend

- Milestone: v1
- Size: 2d
- Depends on: T10
- Spec: §7.3
- Owns: `apps/desktop/src/main/tutor/claude-code/`, `apps/desktop/src/main/mcp/`

**Goal.** Use the user's installed Claude Code as the tutor backend when it is
found.

**Scope.**
- First resolve the §14 VERIFY: current CLI flags, whether the Claude Agent SDK is the better integration, and what current terms allow regarding a user's own login. Record the findings in `DECISIONS.md`; if a subscription login is not appropriate, support only API-key use.
- Detection (path, version, signed-in), status in Settings.
- Loopback MCP server exposing the tutor tools with a per-turn token; spawn with built-in tools disabled and only tutor tools allowed (port `dsa-tutor/dsa_tutor/backends/claude_code.py` and `server/mcp.py`).

**Acceptance.**
- [x] Test: the spawned command leaves no built-in tool enabled.
- [x] Test against recorded stream-json fixtures (port `tests/fixtures/claude_code/`).
- [x] MCP token rejected after the turn ends (test).

**Notes.**

**The VERIFY came out as "API key only"** (D-25). The current Claude Code
legal and Agent SDK docs say third-party apps may not offer Claude.ai login
or route requests through a user's Free/Pro/Max/Ultra plan, and apps built
on Claude should use API keys. So the SPEC default applies: Claude Code
runs in `--bare` mode (it never reads OAuth or the keychain) with the
app's own API key. That makes it need the same key as the Anthropic
backend, so it is chosen explicitly (`auto` is unchanged) and onboarding's
tutor step stays the key form. If the owner wants the subscription path,
that is a question for Anthropic, not code. No Agent SDK: it bundles its
own Claude Code binary.

Built: `main/mcp/` (per-turn grants, a hand-written stateless Streamable
HTTP MCP server on loopback with Host/Origin checks), and
`main/tutor/claude-code/`: detection (configured path, `PATH`, installer
places; version ≥ 2.1.328; Windows `.exe` only), the command and a minimal
environment, a loopback relay that swaps a per-turn token for the real key
(the key never reaches the CLI), the stream-json parser, and the backend
(one process group per turn, resume with a fresh-session fallback and
recap, cancel and timeout that let a running tool report). Fixtures
re-recorded from Claude Code 2.1.328 through the real backend against a
loopback stand-in API (`fixtures/record.ts`); unit tests replay them
through a fake CLI that makes real MCP calls. Settings → Tutor shows
Claude Code's path and version (Recheck, a path field) when it is the
chosen backend.

Checks: `npm run typecheck`, `lint`, `format:check`, `test` (678 tests,
including the opt-in real-CLI case with `ALGOTUTOR_TEST_CLAUDE`, green 4
runs in a row), `validate:content`, `npm run e2e` (practice, tutor and
settings, unchanged and green) and `check:security` pass on Linux. New
`npm run e2e:claude-code` ran the real app with the real `claude` 2.1.328
against the stand-in API: 10/10 checks (reply streamed, `get_status` called
through the MCP server, every API request carried the app's key and only
`mcp__tutor__*` tools, the second message resumed the session, Settings
showed the path and version).

Wiring outside **Owns**: core `settings.ts` (`tutor.claudeCodePath`) and
its test; `shared/settings.ts`, `shared/tutor.ts`, `shared/channels.ts`,
`shared/ipc.ts` (channel `tutor:claude-code`); `main/ipc/handlers/tutor.ts`;
`main/tutor/index.ts` (backend choice, detection cache, servers started on
the first Claude Code turn and stopped at quit); `main/setup.ts`;
`storage/paths.ts` (`agentHome`) and `data/archive.ts` (reset removes it);
`SettingsTutor.tsx`, `OnboardingPage.tsx` (comment), `SettingsPage.test.tsx`;
`tutor.test.ts`, `settings.test.ts` and `scripts/smoke-ai.ts` (new deps);
`e2e/claude-code.e2e.ts` and the `e2e:claude-code` scripts; SPEC §4.1, §4.3,
§7.3, §10, §12, §13, §14; CONTEXT.

Not done or not tested:
- **No turn with a real API key or a real model.** Every Claude Code run
  here used a dummy key against the loopback stand-in; the relay to the
  real API is tested only against that stand-in.
- **A Claude subscription login is deliberately not supported** (above).
- Only Linux was run. macOS paths and Windows (`claude.exe` only, process
  kill without process groups, `USERPROFILE` as home) are untested; `.cmd`
  shims are refused rather than run through a shell.
- Claude Code versions other than 2.1.328 were not tried; the minimum is set
  to that version.
- The MCP server implements only what Claude Code uses (stateless JSON
  responses); other MCP clients were not tried.
- The real-CLI test and `e2e:claude-code` are opt-in (they need Claude Code
  installed), so CI does not run them.

### T12 — New problems: generate, paste, import

- Milestone: v1
- Size: 3d
- Depends on: T07, T10
- Spec: §5.3, §6.3
- Owns: `packages/core/src/intake/`, `apps/desktop/src/main/intake/`, `apps/desktop/src/renderer/intake/`, `content/open-sets/`

**Goal.** Make new problems with the self-check, as in `dsa-tutor`.

**Scope.**
- Intake jobs (generate, paste, import) with progress events; self-check in Pyodide, up to 4 attempts with failures fed back.
- Exercism open set: port the pinned index and fetcher (main process, `raw.githubusercontent.com` only), licence and `NOTICE.md`.
- New Problem dialog and Import panel (port from `dsa-tutor/web/src/intake/`).

**Acceptance.**
- [x] Fake-backend tests for generate, paste, import, self-check failure, not-a-problem, refused import (port the intake fixtures). `packages/core/src/intake/intake.test.ts` asserts each job's events equal the ported recordings `fixtures/events/{generate,paste,import,repair,self-check-failed,not-a-problem,import-refused}.json`; the UI test replays them; `apps/desktop/src/main/intake/intake.test.ts` runs generate and import over IPC with real Pyodide.
- [x] Model-written code runs only in the Pyodide executor (test: intake with the executor registry asserts which executor ran). `create.test.ts` (registry with `pyodide`, `local`, `container`: only `pyodide` asked and run; a non-Pyodide executor is refused) and the main intake test (real Pyodide next to spies for `local` and `container`, while the learner's own `executorFor` points at `local`).

**Notes.**

Built (DECISIONS D-26):
- `packages/core/src/intake/`: `createProblem` (spec checks, brute force
  fills expected values, self-check of the reference in Pyodide only, files
  loaded back with `loadProblem` before writing, neutral `problem.md` via
  `render.ts`), the authoring prompt (`problem_spec` and `topics` guides,
  pasted/fetched text inside `<problem_text>`), `IntakeService` and jobs
  (ported rules: 4 calls, repair turns, topic/difficulty enforced, app-only
  origin, `NOT_A_PROBLEM`, one job at a time, time-out, cancel, replayable
  events, `publicFailure`), the Exercism importer and `OpenSets`.
- `apps/desktop/src/main/intake/`: the problem factory over the catalog,
  Pyodide and the data folder (staged then renamed; catalog reload), the
  fetcher (`raw.githubusercontent.com` only, same-host redirects, caps,
  cache in `<data>/cache/open-sets/`), `openIntake`.
- IPC (`shared/intake.ts`, `main/ipc/handlers/intake.ts`): `intake:start`,
  `intake:current`, `intake:cancel`, `open-sets:list`, `open-sets:entries`,
  and the `intake:events` stream (replays from the start).
- UI `apps/desktop/src/renderer/src/intake/` (the renderer's code lives
  under `renderer/src/`, not the `renderer/intake/` named in Owns): New
  Problem dialog (Generate, Paste, Import; progress with the self-check
  attempt; failures by test id and category; Stop; keeps working when
  closed and reattaches after a reload), Import panel (licence and
  attribution, search, "imported as").
- `content/open-sets/exercism/`: pinned index and `LICENSE.txt`, copied
  unchanged; the licence re-checked against the pinned commit online. Each
  imported problem keeps `NOTICE.md`; the licence shows under its title
  (existing T08 origin line).
- `npm run e2e` gains `e2e/intake.e2e.ts` (real app, fake tutor
  `e2e/fake-intake.json`): generate with one failing self-check then a pass in
  the real execution host, the problem opens and its starter fails Run;
  paste of a non-problem is refused.

Wiring outside Owns: `main/setup.ts` (factory, open sets, intake,
handlers), `main/tutor/index.ts` (`createProblem` dep, so the chat tutor
also offers `create_problem`; `references` exposed), `main/practice/index.ts`
(`executors`), `shared/channels.ts`, `shared/ipc.ts`, `renderer/src/App.tsx`
("New problem" button; a `generate` recommendation from Next problem opens
the dialog prefilled), `scripts/validate-content.ts` (open-set index check),
`apps/desktop/package.json` (e2e chain), `.prettierignore` (keep the index
as pinned), `packages/core/src/index.ts`. SPEC §10 gains a row for open-set
fetching.

Checks: `npm run typecheck`, `npm run lint`, `npm test` (716 passed, 1
skipped), `npm run format:check`, `npm run validate:content` (50 problems),
`xvfb-run -a npm run check:security`, `xvfb-run -a npm run e2e` (practice,
tutor and intake passed; one settings check, "after import, progress shows
the solve again", failed once in the full chain and passed when
`settings.e2e.ts` was rerun alone: looks timing-related, not touched here).

Not done or not tested:
- No real AI provider was called: authoring with the Anthropic or Claude
  Code backend (intake threads `intake-<job>`, the one-tool registry over
  MCP) is untested; only the fake backend ran.
- The fetcher was not run against the live host from the app; it uses
  Node's `fetch`, which ignores the system proxy (D-26). Only the licence
  file was fetched live (with curl) to verify it.
- No Settings → About listing of the imported sets' licences (SPEC §8);
  left for T14's release check.
- The chat tutor's own `create_problem` (outside intake) has no dedicated
  test beyond the shared factory; generated problems are not deletable from
  the UI (not in scope).

### T13 — Packaging, auto-update and release workflow

- Milestone: v1
- Size: 3d
- Depends on: T08
- Spec: §11
- Owns: `apps/desktop/electron-builder.yml`, `apps/desktop/src/main/updater/`, `.github/workflows/release.yml`, `apps/desktop/build/` (icons)

**Goal.** Installers for all three OSes that update themselves.

**Scope.**
- electron-builder targets per §11; app id, icons, file associations none.
- `electron-updater` with GitHub provider, stable/beta channels, background download, "Restart to update"; wire the Settings → Updates section.
- Release workflow on `v*` tags: build on three OSes, draft GitHub Release with update metadata. Signing steps run only when secrets exist. Record the signing DECISION status.

**Acceptance.**
- [ ] A tagged test release produces installers that install and launch on each OS (done notes say which were actually tried).
- [ ] An older build updates to a newer test release (at least on one OS; say which).

**Notes.**

### T14 — README, end-to-end test, v1 release check

- Milestone: v1
- Size: 2d
- Depends on: T04, T09, T10, T11, T12, T13
- Spec: §13
- Owns: `README.md`, `e2e/`, `CHANGELOG.md`

**Goal.** v1 ready to hand to someone else.

**Scope.**
- README: install per OS (including unsigned-build steps), first run, connecting the tutor, data and backups, privacy (what the tutor sees), troubleshooting.
- Playwright-for-Electron e2e with the fake tutor (flow in §13), in CI on Linux.
- Go through every SPEC §14 item and confirm it is resolved or explicitly deferred.

**Acceptance.**
- [ ] e2e passes in CI.
- [ ] README followed from scratch on one OS by someone (or a clean VM) without help; done notes say which.

**Notes.**

---

## v2: Rust, Go and container runtimes

### T15 — Rust and Go harness generators

- Milestone: v2
- Size: 5d
- Depends on: T04
- Spec: §5.2, §6.4
- Owns: `packages/core/src/langs/rust/`, `packages/core/src/langs/go/`, `content/runners/rust/`, `content/runners/go/`

**Goal.** From a neutral signature, generate the stub and the harness for Rust
and Go.

**Scope.**
- Type mapping finalised (resolve the Rust `int` DECISION); `TreeNode` / `ListNode` adapters per language; JSON in/out via `serde_json` (Rust, vendored or offline-cacheable) and `encoding/json` (Go).
- Stub generator (idiomatic names), harness `main` reading tests on stdin, writing one JSON result line per test with timing.
- Mark which problems each language supports (all types supported → add to `languages`).

**Acceptance.**
- [ ] Golden-file tests for stubs and harnesses across all neutral types.
- [ ] A hand-written Rust and Go solution for 5 problems (one per tricky type: tree, linked list, map, tuple, float) passes when compiled locally (CI job with toolchains).

**Notes.**

### T16 — Local toolchain executor

- Milestone: v2
- Size: 2d
- Depends on: T15
- Spec: §6.4, §6.5
- Owns: `apps/desktop/src/main/exec/local/`

**Goal.** Run Rust and Go solutions with the user's `cargo` and `go`.

**Scope.**
- Detection of `cargo` / `go` (path, version).
- Cached project per problem; compile errors reported as `compile`; timeout kills the process group (Windows: job object or `taskkill /T`).
- Language picker in the practice view for problems that support it; workspace file per language.

**Acceptance.**
- [ ] Tests (CI with toolchains): pass, fail, compile error, timeout, rerun is incremental.
- [ ] Works on Linux, macOS, Windows CI.

**Notes.**

### T17 — Container executor (Docker and Podman)

- Milestone: v2
- Size: 3d
- Depends on: T15
- Spec: §6.5, §10
- Owns: `apps/desktop/src/main/exec/container/`, `apps/desktop/src/main/runtimes/` (detection)

**Goal.** Run Rust and Go in a detected container runtime, hardened.

**Scope.**
- Runtime detection per §6.5 (states, versions, `DOCKER_HOST`, contexts).
- Image pull with progress; run flags per §6.5; Rust target-dir decision recorded.
- Fallback to local with a notice when the runtime disappears.

**Acceptance.**
- [ ] Tests with a fake runtime binary for detection states and the exact run flags.
- [ ] Real run on Linux CI with Docker: pass, timeout, no network (a solution that tries to connect fails).

**Notes.**

### T18 — Settings → Code execution panel

- Milestone: v2
- Size: 2d
- Depends on: T16, T17
- Spec: §6.5, §8
- Owns: `apps/desktop/src/renderer/pages/settings/CodeExecution*`

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

**Goal.** `ghcr.io/hqazi/algorithm-tutor-runner:<version>` with Python, Rust
and Go, multi-arch, published on release tags.

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
- Podman (recommended) on macOS (`brew install podman`, `podman machine init`, `podman machine start`), Windows (`winget install RedHat.Podman-Desktop`, WSL2 note), Linux (apt/dnf/pacman).
- Docker: Docker Desktop on macOS/Windows (licence note for larger companies), Docker Engine on Linux (`docker` group, log out and in).
- Others: Colima, OrbStack.
- rustup and Go install links; "check it works" via Recheck and Test sandbox.
- Stable anchors matching the Settings links.

**Acceptance.**
- [ ] Every Settings link resolves to a heading in the README (test).

**Notes.**

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
- Dependencies: every npm version locked must be at least 14 days old (D-45,
  D-48). Pin exact versions that old, install with
  `npm install --before=<date 14 days ago> --ignore-scripts`, and run
  `npm run check:deps` whenever `package.json` or `package-lock.json` changes.
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
| T13 | Packaging, auto-update and release workflow | v1 | 3d | T08 | done |
| T14 | README, end-to-end test, v1 release check | v1 | 2d | T04, T09, T10, T11, T12, T13 | blocked |
| T15 | Rust and Go harness generators | v2 | 5d | T04 | done |
| T16 | Local toolchain executor | v2 | 2d | T15 | done |
| T17 | Container executor (Docker and Podman) | v2 | 3d | T15 | done |
| T18 | Settings → Code execution panel | v2 | 2d | T16, T17 | done |
| T19 | Runner image in CI | v2 | 2d | T13, T15 | done |
| T20 | README: optional container sandbox and toolchains | v2 | 1d | T18 | done |
| T21 | Library folders and index | v3 | 3d | T05, T09 | done |
| T22 | Reader with local images | v3 | 3d | T21 | done |
| T23 | Linked images: safe download and cache | v3 | 3d | T22 | done |
| T24 | Chats tied to passages | v3 | 4d | T22, T10, T11 | done |
| T25 | Tutor-written articles and problems from passages | v3 | 2d | T24, T12 | done |
| T26 | Library security check and end-to-end test | v3 | 2d | T23, T24 | done |
| T27 | README, user guide, logo, screenshots; rename to Algo | polish | 1d | T26 | done |
| T28 | Design foundations: tokens, fonts, icons, controls | design | 2d | T27 | done |
| T29 | App frame: title-bar navigation and edge-to-edge panes | design | 2d | T28 | done |
| T30 | Practice page refresh | design | 2d | T29 | done |
| T31 | Home dashboard, Problems and Progress refresh | design | 2d | T29 | done |
| T32 | Library refresh | design | 2d | T30 | done |
| T33 | Onboarding, Settings and dialogs refresh | design | 2d | T29 | done |
| T34 | Design pass, screenshots and user guide | design | 1d | T30, T31, T32, T33 | done |
| T35 | Collapsible panes and pane shortcuts | design | 1d | T34 | done |
| T36 | Leader key (tmux-style) for pane actions | design | 1d | T35 | done |
| T37 | Library: read articles aloud | v3 | 1d | T22, T36 | done |
| T38 | Read aloud with Kokoro (GPU when faster) | v3 | 2d | T37 | done |
| T39 | Read aloud: CPU by default, GPU as a setting | v3 | 0.5d | T38 | done |
| T40 | Read aloud: download eSpeak NG instead of shipping it | v3 | 0.5d | T39 | done |
| T41 | Read aloud: buffer chunks ahead | v3 | 0.25d | T40 | done |
| T42 | Library: new folder, move and delete in the tree | v3 | 2d | T32 | in-progress |
| T43 | Write articles: a brief, a destination, and series | v3 | 2d | T42, T25 | todo |

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
v3:  T21 ─ T22 ─┬─ T23 ─────────┐
                └─ T24 ─┬───────┴─ T26
                        └─ T25
design: T28 ─ T29 ─┬─ T30 ─ T32 ─┐
                   ├─ T31 ───────┼─ T34
                   └─ T33 ───────┘
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

**Notes.** (2026-11-19) Both boxes stay unticked: no tag was pushed and no
GitHub release was made from this session, so neither was done against a
real release. What was checked instead is below; the first tagged test
release (T14's release check) should tick them.

- **Built.** `electron-builder.yml` (targets per §11; macOS per arch x64 +
  arm64, NSIS x64, AppImage + deb x64; app id
  `io.github.hqazi.algorithmtutor`; no file associations; `content/` to
  `<resources>/content`; `LICENSE` and a Pyodide MPL-2.0 notice to
  `<resources>/notices/`). `packaging/package.ts` (`npm run package`,
  `npm run package:dir`) runs electron-builder with an `afterPack` hook that
  flips the fuses with `applyFuses` and reads them back. `build/icon.png`
  (1024², new). `main/updater/` (service over electron-updater, `stable` /
  `beta`, background checks and download when automatic updates are on,
  install on quit, "Restart to update") with `updates:status`,
  `updates:check`, `updates:download`, `updates:restart` and the
  `updates:watch` stream; Settings → Updates shows the state and the one
  action that fits. `.github/workflows/release.yml`: on `vX.Y.Z` /
  `vX.Y.Z-beta.N`, one job makes the draft (pre-release for betas), then
  three OS jobs set the version from the tag, run the unit tests, package
  and upload with update metadata, and smoke-test the packaged app.
  Signing and notarization run only when their secrets exist.
- **Decisions.** D-27 (code signing DECISION resolved: unsigned until
  secrets exist; no `node_modules` in the app; fuses in afterPack; channel
  behaviour checked in electron-updater's source; updater behaviour;
  workflow), D-28 (versions). SPEC §11 and §14 updated.
- **Wiring outside Owns.** `apps/desktop/package.json`: every dependency
  moved to `devDependencies` (the main process is fully bundled; D-27),
  `author`, `homepage`, `package` scripts; root `package.json` scripts;
  `src/shared/updates.ts`, `ipc.ts`, `channels.ts` (contract);
  `src/main/setup.ts` (opens the updater); `SettingsPage.tsx` (Updates
  section moved to `SettingsUpdates.tsx`); `packaging/smoke.ts` and
  `packaging/update-check.ts` (new); `ci.yml` packages and smoke-tests on
  Linux.
- **Tests.** `main/updater/service.test.ts` (7: settings → flags, states,
  manual download, restart only when downloaded, errors, timers),
  `SettingsUpdates.test.tsx` (3). typecheck, lint, format, `npm test` (726
  passed, 1 skipped), `validate:content` (50 valid), `check:fuses`,
  `check:security`, `check:exec-host`, `check:storage`, `npm run e2e`
  (4 suites) all pass on Linux.
- **Tried, Linux x64 only (this container):** `npm run package` built the
  AppImage and the deb. The deb installed with apt; the installed app, the
  AppImage (`APPIMAGE_EXTRACT_AND_RUN=1`) and `linux-unpacked` each passed
  `packaging/smoke.ts` (starts with fuses flipped, 50 problems from
  `<resources>/content`, a Run in Pyodide out of `app.asar`, updater
  present). Update: AppImages 0.0.1 and 0.0.2 built with `--feed` (generic
  provider on a local HTTP server); `packaging/update-check.ts` made 0.0.1
  check, download (it fetched `latest-linux.yml` and the AppImage) and
  "Restart to update"; the AppImage on disk became the 0.0.2 file and
  started as 0.0.2.
- **Not done or not tested.** The release workflow has never run (no tag
  pushed). No macOS or Windows build was made or launched; the macOS and
  Windows smoke paths in the workflow are untried. The GitHub provider
  (`stable` / `beta` against real releases) is untested; only the generic
  provider was. deb self-update (electron-updater's `DebUpdater`, needs
  `pkexec`) untested. No signing, notarization or Windows signing (no
  certificates); unsigned macOS builds cannot install updates (D-27). No
  `latest-mac.yml` / `beta*.yml` produced or read here. The README's
  install and unsigned-app instructions are T14's.
- (2026-11-20, T14) The README's install and unsigned-app steps are
  written. The boxes are still open: T14's `v0.1.0-rc.1` tag push was
  refused (HTTP 403 from the session's git proxy), so no release ran.
- (2026-11-20, T14) The user pushed `v0.1.0-rc.1` on `018b0c7`. Release
  run 44720024201 **failed**: the draft (pre-release) was made and all
  three OSes ran the unit tests, packaged and uploaded, but the smoke step
  failed on macOS and Windows with `spawn ... ENOENT`. The top-level
  `executableName: algorithm-tutor` renamed the app on every OS
  (`algorithm-tutor.app`, `algorithm-tutor.exe`) while the workflow looked
  for `Algorithm Tutor`; it is now Linux-only, so macOS and Windows keep the
  product name the README uses (D-35). The macOS smoke step also picked the
  x64 app on the arm64 runner; it now picks the runner's arch. Ubuntu
  passed: the packaged `linux-unpacked` app started as 0.1.0-rc.1, loaded
  50 problems, ran Pyodide and had the updater. Uploaded to the draft
  (from the job logs): `algorithm-tutor-0.1.0-rc.1-linux-x86_64.AppImage`,
  `-linux-amd64.deb`, `-win-x64.exe` (+ `.blockmap`), `-mac-x64.dmg`,
  `-mac-arm64.dmg`, `-mac-x64.zip`, `-mac-arm64.zip` (each + `.blockmap`).
  The update metadata files are uploaded from memory without a log line
  and the API here does not list draft assets, so their presence is not
  confirmed. Boxes still open: no installer was installed on any OS (the
  smoke test runs the unpacked app), macOS and Windows never launched, and
  no update between releases was tried. Needs a new tag `v0.1.0-rc.2`.
- (2026-11-20, T14) The user pushed `v0.1.0-rc.2` on `b4ffbeb`. Release
  run 44721983049 **passed** on all three OSes: each ran the unit tests (61
  files), packaged, uploaded to the draft and passed the smoke test (the
  packaged unpacked app started as 0.1.0-rc.2 on Electron 45.3.4, loaded 50
  problems from `<resources>/content`, ran `compress-runs` in Pyodide, had
  the updater). macOS built x64 and arm64 and smoke-tested arm64 (the
  runner's arch); Windows `Algorithm Tutor.exe`; Linux
  `linux-unpacked/algorithm-tutor`. Uploaded (job logs):
  `algorithm-tutor-0.1.0-rc.2-linux-x86_64.AppImage`, `-linux-amd64.deb`,
  `-win-x64.exe`, `-mac-{x64,arm64}.{dmg,zip}`, each Windows/macOS file with
  its `.blockmap`. The update metadata (`rc.yml`, `rc-mac.yml`,
  `rc-linux.yml` for an rc, D-33) is again not in the logs and draft assets
  cannot be listed from the session, so it is still unconfirmed; a new
  `check` job in `release.yml` now lists the draft's assets and fails when
  an installer or a metadata file is missing (D-36), so the next tag shows
  it. Both boxes stay open: the smoke test runs the unpacked build, not an
  installed one, so nothing was installed from an installer on any OS, and
  no update from an older build to a newer release was tried.

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
- [x] e2e passes in CI.
- [ ] README followed from scratch on one OS by someone (or a clean VM) without help; done notes say which.

**Notes.** (2026-11-20, rc.2) **Still blocked on box 2 (the README
followed from scratch by a person or on a clean VM) and on T13's boxes.**
Release run 44721983049 on `v0.1.0-rc.2` (`b4ffbeb`) passed on ubuntu,
macOS and Windows: build, upload and the packaged-app smoke test (details
and assets in T13's notes). Runner image run 44721983068 pushed
`ghcr.io/hqazi/algorithm-tutor-runner:0.1.0-rc.2` and `:sha-b4ffbebe11b1`
(amd64 + arm64); CI run 44721983085 on the tag passed. Draft (pre-release,
not published): https://github.com/hqazi/algo/releases/tag/untagged-35c391e8f33d48646ac0.
What remains: (1) confirm the update metadata on the draft, either in the
release page's asset list or from the new `check` job on a `v0.1.0-rc.3`
tag (D-36); (2) install each installer (`.dmg`, `.exe`, `.deb` /
AppImage) by following the README on a clean machine or VM and launch it
(T13 box 1, this ticket's box 2); (3) an update from an older build to a
newer release on one OS (T13 box 2; an rc only updates from an rc build on
the `rc` metadata, D-33, so this needs two rc releases or a stable and a
later stable). The rc.1 draft can be deleted.

(2026-11-20, later) **Still blocked: needs tag `v0.1.0-rc.2`
from the user, and box 2 needs a person or a clean VM.** The user pushed
`v0.1.0-rc.1` on `018b0c7`; Release run 44720024201 failed on macOS and
Windows in the smoke step (wrong executable name, fixed on main, D-35);
Ubuntu built, uploaded and passed its smoke test. Per-OS results and the
asset list are in T13's notes. Draft release (pre-release, not published):
https://github.com/hqazi/algorithm-tutor/releases (shown as
`untagged-105b251df7aa3f650f32` while it is a draft). CI on main at
`018b0c7` failed on ubuntu only: `pyodide-executor.test.ts` "truncates
large output" printed 100,000 lines under the default 1 s limit and timed
out on a loaded runner; that test now has a 15 s limit (it tests
truncation, not speed). CI run 44720024309 on the tag itself passed. The
GitHub repository now answers as `hqazi/algo` (runs and releases link
there; uploads to `hqazi/algorithm-tutor` still worked through GitHub's
redirect). The rc.1 draft can be deleted once rc.2 is out.

(2026-11-20) **Blocked: the test release tag could not be
pushed.** `git push origin v0.1.0-rc.1` (the one test release the user
approved, on main `b990d77`) was refused by this session's git proxy with
HTTP 403, a policy denial, so it was not retried or pushed another way. No
tag exists on origin, `release.yml` has never run and there is no draft
release. To unblock: push `v0.1.0-rc.1` on `b990d77` (or later main) from
somewhere allowed to push tags, watch the Release run, then tick T13's two
boxes and the release part of this ticket from it. Everything else is done.

- **Built.** README: status, install per OS with the unsigned-build steps
  (macOS Privacy & Security → Open Anyway, `xattr` fallback, no self-update
  when unsigned; Windows SmartScreen; Linux `.deb` with apt and AppImage
  with FUSE 2), first run, connecting the tutor (key, backends, Claude Code
  with the API key), data folder per OS and export/import/reset backups,
  privacy (what is sent to Anthropic and what never is, the other network
  use: update checks and open-set imports), troubleshooting. The T20
  headings are unchanged (their anchor test passes). `CHANGELOG.md` (new,
  0.1.0). `e2e/v1.e2e.ts`: the SPEC §13 flow in one run with the fake tutor
  (onboarding questions, next problem, Run fails, Hint level 1, edit, Run
  passes, Submit, Progress shows a solve that is not unaided); first in
  `npm run e2e`.
- **SPEC §14.** Every item is resolved (D-15, D-23, D-24, D-25, D-27,
  D-29, D-14); nothing deferred.
- **Decisions.** D-33 (rc tags, README unsigned steps, e2e).
- **Wiring outside Owns.** `.github/workflows/release.yml` accepts
  `vX.Y.Z-rc.N` (pre-release draft; it rejected rc tags before, so the
  approved tag would have failed at once). `apps/desktop/package.json`
  (`e2e` script). Test fixes for CI, which was red on main on all three
  OSes: `practice.e2e.ts` and `settings.e2e.ts` wait for Progress to
  refresh (Linux race); `container-executor.test.ts` fake docker parses
  `--volume` in sh and calls `/bin/ls` (the executor's macOS PATH has no
  `/bin`); `backend.test.ts` allows macOS's `/private/var` path;
  `pyodide-executor.test.ts` recursion limit 30 s (Windows took over 10 s);
  `practice.test.ts` waits until the first run holds the problem.
- **Checks.** Local (Linux x64): typecheck, lint, format:check, `npm test`
  (821 passed, 12 skipped), `validate:content` (50 valid), `xvfb-run -a
  npm run e2e` (5 suites, no failures). CI run 44709122560 on `b990d77`:
  check on ubuntu, macOS and Windows, container and harnesses all pass,
  including `npm run e2e` on Linux (box 1).
- **Not done or not tested.** No tag, no release run, no installers built
  on macOS or Windows, nothing installed from a release, no update between
  releases (T13's boxes stay open). The README has not been followed from
  scratch by anyone or on a clean VM (box 2); its macOS, Windows and Ubuntu
  24.04 steps are written from current OS behaviour and the build config,
  not tried on those OSes. Asset file names in the Install table follow
  `artifactName`; the `.deb` name (`amd64`) is not yet confirmed from a
  real release.

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
- [x] Golden-file tests for stubs and harnesses across all neutral types.
- [x] A hand-written Rust and Go solution for 5 problems (one per tricky type: tree, linked list, map, tuple, float) passes when compiled locally (CI job with toolchains).

**Notes.**

- Built: `packages/core/src/langs/` — `rust/` and `go/` generators (`rustStub`/`goStub`, `rustProject`/`goProject` returning the generated files, the runtime files to copy from `content/runners/<lang>/`, the solution path, build and run commands) and `common.ts` (protocol: `encodeHarnessInput`, `newNonce`, `parseHarnessStream` → `HarnessOutput`, `compiledHarnessLimit`). Fixed runtimes: `content/runners/rust/{harness,json}.rs` (no crates), `content/runners/go/harness.go`. Decisions in D-29 (Rust `int` = `i64`, type mapping, names, no `serde_json`, protocol, build settings); SPEC §5.2 table finalised and §6.4 protocol added; §14 item resolved.
- Tests: `langs/langs.test.ts` — golden files for 7 signatures covering every neutral type, nested and with keyword names (`langs/golden/<lang>/<case>/`, `vitest -u` to regenerate), names, support rule, protocol parsing (stdout split, forged records ignored, timeout, crash, fatal), grading through `gradeRun`, fixtures validate.
- `npm run check:harnesses` (`scripts/check-harnesses.ts`; CI job `harnesses`, Linux): hand-written Rust and Go solutions in `content/runners/<lang>/check/` for `mirror-tree` (tree), `reverse-chain` (linked list) and three fixture problems in `langs/fixtures/` (`group-lengths` map, `best-team` tuple/char/optional, `basket-average` float + map inputs) pass every test; the stub panics with a line, a wrong answer fails, an index error reports its line, runaway recursion is a crash, an endless loop times out, printed text reaches stdout; 18 types round-trip through `echo`; all 14 golden projects compile. Ran here with cargo 1.97.0 and go 1.24.7: all passed (~30 s).
- Content: all 50 curated problems now list `["python", "rust", "go"]` (every signature qualifies). `validate:content` passes.
- Wiring outside Owns: `problems/validate.ts` (per-language support with reasons; `languagesWithHarness()` stays `["python"]` until an executor runs Rust/Go), `teaching/teaching.ts` (`start` refuses languages the app cannot run), `teaching/workspace.ts` (`starterCode` uses the Rust/Go stubs), `tools/tutor-tools.ts` (`get_problem` lists only runnable languages), `problems/loader.test.ts` (unsupported-language case now uses mixed tree types), `core/src/index.ts` export, `package.json` script, `.github/workflows/ci.yml` job, SPEC/DECISIONS, T19 scope line.
- Not done / not tested: no executor runs Rust or Go in the app yet (T16/T17); the language picker is T16. Not tested on macOS or Windows (the check script runs `harness` without `.exe`; T16 handles Windows names) or with toolchains older than the ones above; the CI job uses the runner image's preinstalled `cargo`/`go` (not pinned) and has not run yet. No Rust/Go reference solutions exist for the 50 curated problems, so listing them means "the harness supports the types", not "checked in Rust/Go". Memory limits are not enforced by the harness.

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
- [x] Tests (CI with toolchains): pass, fail, compile error, timeout, rerun is incremental.
- [ ] Works on Linux, macOS, Windows CI. (Linux checked here; the `check` job runs the same tests on macOS and Windows, not yet seen.)

**Notes.**

- Built: `apps/desktop/src/main/exec/local/` — `LocalExecutor` (`id: 'local'`; `status`, `statusFor(language)`, `toolchains`, `recheck`, `run`), `detect.ts` (find `cargo`/`go` on PATH plus the installers' folders, parse versions), `process.ts` (spawn with stdin, output cap, kill the process tree: POSIX process group, Windows `taskkill /T /F`). Cached project per problem in `<data>/cache/build/<lang>/<slug>/` (signature hash without a slug), files rewritten only when changed, build skipped when a stamp (files + toolchain version + platform) matches; build failure → `compile` with the compiler errors and solution line; per-test kill timer re-armed at each result line, then a fresh process runs the remaining tests after a timeout or crash; cancellation kills the tree. Toolchain env drops `ANTHROPIC_*`/`ELECTRON_*`, sets `GOTOOLCHAIN=local`, `GOPROXY=off`. Decisions in D-30; SPEC §6.1 (`RunJob.slug`) and §6.4 (local executor, language picker) updated.
- Language picker: practice view toolbar (`problems:languages`, `problems:language` channels; `Practice.languages` / `switchLanguage`; core `Teaching.switchLanguage`). Switching saves, moves the open attempt (or opens one) to the new language and loads that language's own file; the file watch follows. Unavailable languages are disabled with the reason; if the current one cannot run, a notice says why. Editor: Python highlighting only; Go indents with tabs.
- Rust and Go are now offered everywhere (`languagesWithHarness()` = python, rust, go; D-30), so new problems list them too.
- Tests: `exec/local/local-executor.test.ts` — per toolchain found (Rust and Go): detection, pass, rerun skips the build, changed code rebuilds in the same project without touching other files, fail, compile error (message, line, no temp path; fixed code then passes), one test times out and the rest pass in a second process, cancellation, cache key without a slug; without toolchains: missing toolchain (`runtime-missing`), fake `cargo` detection, version parsing, child env, compile-error parsing, cache key, process-group kill. `practice.test.ts`: switching languages keeps each file; a Go solution of `rotate-playlist` submits and records with the real `go`. `teaching.test.ts`: `switchLanguage`. `PracticePage.test.tsx`: picker saves first, loads the new file, re-watches.
- Checks here (Linux, cargo 1.97.0, go 1.24.7): typecheck, lint, format:check, `npm test` (all passed; the toolchain suites ran), `validate:content`, `check:harnesses`, `build`, `xvfb-run npm run e2e` passed.
- Wiring outside Owns: `core/exec/types.ts` (`RunJob.slug`), `core/tools/run.ts` (passes the slug), `core/problems/validate.ts` (offered languages), `core/teaching/teaching.ts` (`switchLanguage`), tests in `core/intake/create.test.ts`, `core/langs/langs.test.ts`, `core/teaching/teaching.test.ts`; `main/practice/{index,service}.ts`, `main/ipc/handlers/practice.ts`, `shared/{ipc,channels,practice}.ts`, `renderer/.../PracticePage.tsx`, `Editor.tsx`; SPEC, DECISIONS.
- Not done / not tested: not run on macOS or Windows (the Windows paths — `.exe` names, `taskkill`, `harness.exe` for Go — are untested); no CI job pins toolchain versions (the `check` job relies on the runner images' preinstalled `cargo`/`go`, and the suites skip silently where one is missing). Memory limits are not enforced locally. No Rust/Go syntax highlighting. The reference solution is still Python only. Settings → Code execution (runtime choice, Recheck, "no sandbox" wording) is T18; the main process does not log detection results. The app does not fall back from a container runtime (T17).

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
- [x] Tests with a fake runtime binary for detection states and the exact run flags.
- [ ] Real run on Linux CI with Docker: pass, timeout, no network (a solution that tries to connect fails). (Passed here on Linux with a real Docker 29.10.0, Rust and Go; the new CI `container` job runs the same suite but has not run yet.)

**Notes.**

- Built: `main/runtimes/` — `detectRuntime(s)` (`podman info --format json`, `docker version --format json`; states `not-found` / `installed-not-running` / `running` with path, version, endpoint (`DOCKER_HOST` else the Docker context; `CONTAINER_HOST` for Podman), reason and start hint), `runtimeEnv` (app env minus secrets, PATH plus the installers' folders). `main/exec/container/` — `ContainerExecutor` (`id: 'container'`; `detect`, `status`, `statusFor`, `hasImage`, `pull(onProgress, signal)` with Docker layer counts and every output line, `run`), `containerRunArgs` (the exact hardened flags), `runnerImage(version)`, and `test-image/Dockerfile` (a local stand-in for the T19 image, tests only). Per job: project written to `<data>/cache/container-jobs/<id>` (0755/0644), one detached container, build and harness via `exec` in a per-job `exec` tmpfs `/build`, in-container `kill -KILL` on timeout/cancel, `rm --force` and folder removal after. Fallback to the local executor with one notice per outage when the runtime is not running. Decisions in D-31 (Rust target dir: per-job tmpfs); SPEC §6.5 run bullet updated.
- Tests: `runtimes/detect.test.ts` (fake `docker`/`podman` shell scripts: not-found, running, installed-not-running, garbage output, `DOCKER_HOST` passed and reported, context, Podman `CONTAINER_HOST`, start hints, env filtering). `exec/container/container-executor.test.ts`: exact run flags and memory floor; with a fake `docker`: the exact command sequence (version, image inspect, run, exec build, rm), compile error with line, files readable when the container starts, job folder removed; missing image → `runtime-missing` without `run`; fallback runs the local executor with one notice; pull progress; Python refused. Real Docker (when `ALGOTUTOR_TEST_RUNNER_IMAGE` names a local image): Rust and Go pass, one test times out and the rest pass in a second process, a solution that connects to 1.1.1.1:80 fails with "network unreachable", no container or job folder left.
- Shared with T16: the per-test timer/respawn loop moved from `LocalExecutor` to `exec/local/batches.ts` (`runHarnessBatches`), used by both; `runProcess` got `onStderr` (Podman prints pull progress there).
- Checks here (Linux, Docker 29.10.0 started in this sandbox, stand-in image with cargo 1.100.0 / go 1.24.13): typecheck, lint, format:check, `npm test` with `ALGOTUTOR_TEST_RUNNER_IMAGE` set (804 passed, 1 skipped; the real-Docker suite ran), `validate:content`, `build`.
- Wiring outside Owns: `exec/local/{batches.ts (new), local-executor.ts, process.ts}`, `main/practice/index.ts` (Rust/Go go to the container executor when `execution.runtime` is `podman`/`docker`, else local; the language picker asks local when the runtime is stopped; `executors('container')`), `main/setup.ts` (app version for the image tag), `.github/workflows/ci.yml` (new `container` job: builds the stand-in image locally, runs the container and runtime tests; pushes nothing), SPEC, DECISIONS.
- Not done / not tested: Podman not tested at all (not installed here; only the fake); Docker Desktop on macOS/Windows not tested (bind-mounting the data folder, Windows paths in `--volume`). The runner image does not exist yet (T19), so a real user's run reports the image missing until T19 publishes it; no UI for pull, runtime choice, Recheck or the fallback notice (T18; the notice is only logged by main). Memory: `--memory` has a 512 MB floor and the build tmpfs counts against it, so the solution's limit is not exactly the job's; out-of-memory kills are reported as a crash, not as memory. Every container run rebuilds from scratch (no cache). The CI `container` job and the real-Docker suite in CI have not run yet. Not checked under rootless Docker/Podman or cgroup v2 here (this host is cgroup v1).

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
- [x] UI tests for each detection state.
- [x] Only running runtimes are selectable.

**Notes.**

- Built: `renderer/src/pages/SettingsCodeExecution.tsx` (`ExecutionSection`, moved out of `SettingsPage.tsx`; the Settings pages live flat in `renderer/src/pages/`, so the Owns path `pages/settings/CodeExecution*` became `pages/SettingsCodeExecution*`): Python status and time limits as before, plus **Rust and Go** — a radio choice of Local toolchains (cargo/go versions, "No sandbox" wording, **How to install →** when missing) / Podman / Docker, each with its state (`Running · version · endpoint`, `Installed, not running` with the start command and the runtime's reason, `Not found` with **How to install →**). Only running runtimes are enabled; a running one shows the runner image (on this computer / not pulled), **Pull image** / **Update image** with streamed progress (layers, last line, cancel) and **Test sandbox** (one line per language; disabled until the image is present). **Recheck runtimes**, the fallback notice, and a warning when the saved runtime is not running. Main: `main/exec/code-execution.ts` (`CodeExecution`: `view(recheck)`, `refusal`, `pull`, `test`, `notice`; `helloJob`), `main/ipc/handlers/code-execution.ts` (`exec:runtimes`, `exec:pull` stream, `exec:test`, `exec:install-help` with fixed README URLs). `settings:set` refuses a non-running runtime (`runtime_not_running`). Decisions in D-32; SPEC §6.5 and §8 updated.
- Tests: `SettingsCodeExecution.test.tsx` (not found, installed-not-running, running, refused choice, local toolchains + install link, Recheck sends `recheck: true` and enables a runtime that started, fallback notice and "runs locally" warning, pull progress / finish / cancel / re-detect, Test sandbox lines); `main/exec/code-execution.test.ts` (view per state, image checked only when running, Recheck, refusal rule, notice lifetime, Test sandbox uses the no-fallback executor for Rust then Go, IPC schemas, install-help only takes a topic, pull stream; hello world passes with the real local cargo/go and in real Docker with the stand-in image); `settings.test.ts` (runtime refusal). e2e (`settings.e2e.ts`): real detection here showed Podman not found (How to install opened the README URL, `shell.openExternal` stubbed) and Docker running (selectable, saved, Pull/Test offered; then back to local), Recheck.
- Checks here (Linux, Docker 29.10.0, cargo 1.97.0, go 1.24.7): typecheck, lint, format:check, `npm test` with `ALGOTUTOR_TEST_RUNNER_IMAGE=algorithm-tutor-runner:test` (828 passed, 1 skipped), `validate:content`, `xvfb-run -a npm run e2e` passed (the first full run failed once on the unrelated practice check "progress shows the solve"; `practice.e2e.ts` then passed twice alone and the full suite passed on rerun).
- Wiring outside Owns: `main/practice/index.ts` (`codeExecution`, per-runtime container executors, a no-fallback one for Test sandbox, notices kept), `main/setup.ts`, `main/ipc/handlers/settings.ts` (+ test), `shared/{settings,ipc,channels}.ts`, `renderer/src/pages/SettingsPage.tsx`, `styles.css`, `e2e/settings.e2e.ts`, SPEC, DECISIONS.
- Not done / not tested: Podman not tested (not installed here; only fakes). macOS and Windows not tested. A real Pull was not run (the published image does not exist until T19; the e2e does not click Pull or Test sandbox, the real-Docker Test sandbox is covered by the Vitest suite with the stand-in image). The README headings the install links point to are T20's to write. The fallback notice shows only in Settings, not in the practice view. Detection is not re-run on a timer while Settings is open.

### T19 — Runner image in CI

- Milestone: v2
- Size: 2d
- Depends on: T13, T15
- Spec: §6.5, §11
- Owns: `runner-image/`, `.github/workflows/runner-image.yml`

**Goal.** `ghcr.io/hqazi/algorithm-tutor-runner:<version>` with Python, Rust
and Go, multi-arch, published on release tags.

**Scope.**
- Minimal image, non-root user, toolchains pinned. (No `serde_json` to pre-fetch: the harnesses have no dependencies, D-29.)
- Published with the app release; version tied to the app.

**Acceptance.**
- [x] amd64 and arm64 images built in CI; hello-world per language passes inside each. (Run 44712009992 on main, `push` event: both legs built natively, `smoke.sh` printed ok for python, rust, go and the read-only/uid check on `linux/amd64` and `linux/arm64`, and the real-Docker executor suites passed, 18 + 14 tests, in each.)

**Notes.**
- Built: `runner-image/Dockerfile` (base `rust:1.100.0-slim-trixie`, Go 1.27.4 copied from `golang:1.27.4-trixie`, both pinned by tag and index digest; `python3-minimal` from Debian trixie, 3.13.5 when built; `USER 65534:65534`; Go/Rust env as D-31), `runner-image/smoke.sh` (hello world in Python, Rust and Go with the executor's hardening flags, plus read-only root and uid 65534), `.github/workflows/runner-image.yml` (native amd64 on `ubuntu-24.04` and arm64 on `ubuntu-24.04-arm`; smoke script and the real-Docker container executor suites against the built image; the tested image is pushed as `sha-<commit>-<arch>`, then joined into multi-arch tags with `docker buildx imagetools create`; publishes on version tags (`X.Y.Z`, plus `latest` for stable) and on `workflow_dispatch` (`version` input, else `edge`), always with `sha-<commit>`; pushes to main and PRs touching the image build and check only; `GITHUB_TOKEN` only, no third-party actions). Decisions in D-34; SPEC §6.5 runner image bullet updated.
- Wiring outside Owns: `scripts/runner-image.test.ts` (static checks: image name matches `runnerImage()`, bases pinned by digest, uid 65534, both arches and triggers in the workflow), SPEC/DECISIONS.
- Checked locally: image built with Docker 29.10.0 on amd64, `smoke.sh` passed, container executor, runtimes and code-execution suites passed against it (41 tests); typecheck, lint, format:check, `npm test` (825 passed, 12 skipped), validate:content (50 problems).
- The first `workflow_dispatch` run (44711327127) failed on amd64 before any push: the two real-Docker test files ran in parallel on one daemon, so the executor suite's "no container left" check saw the other file's container. Fixed by running the files one after the other (run 44712009992 green). The dispatch was not re-run (one manual trigger was allowed). Its arm64 leg did log in and push `sha-47739ecb1b79-arm64` (single-arch, tested), which created the GHCR package; it is readable anonymously (public). No multi-arch tag (`edge`, a version) exists yet: the publish job (`imagetools create`) has not run. A second dispatch on main publishes `edge`.
- Not done / not tested: no version tag pushed (tag pushes are refused from the session), so the release-tag path is untested; the published image was not pulled by the app (Settings → Pull / Test sandbox); Podman not tried with the image; arm64 checked only in CI, never locally. The README still says the image is not published (true until a release tag runs).
- (2026-11-20, T14) The `v0.1.0-rc.1` tag push (by the user) ran Runner image run 44720024303: both arches built, passed `smoke.sh` and the real-Docker suites, pushed `sha-018b0c7a609d-amd64` / `-arm64`, and the publish job made the multi-arch index (linux/amd64 + linux/arm64, `sha256:3091f28b…`) as `0.1.0-rc.1` and `sha-018b0c7a609d` on `ghcr.io/hqazi/algorithm-tutor-runner` (no `latest`: rc). The release-tag path is now tested; the README's runner-image section says the image is published. Still not tried: pulling it from the app, Podman.

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
- [x] Every Settings link resolves to a heading in the README (test).

**Notes.**
- Built: README sections "Optional: a container sandbox" (Podman on macOS/Windows/Linux with the WSL2 note; Docker Desktop with the licence note, Docker Engine with the `docker` group and log out/in; Colima and OrbStack; `DOCKER_HOST` and contexts; "The runner image"; "Check that it works" via **Recheck runtimes**, Pull image and **Test sandbox**) and "Installing Rust and Go" (rustup, go.dev, check with `cargo --version` / `go version`, then Recheck). Headings unchanged, so `INSTALL_HELP` (D-32) still matches.
- Test: `apps/desktop/src/main/ipc/handlers/install-help.test.ts` reads `README.md`, slugs its headings the GitHub way and checks every `INSTALL_HELP` URL (and every in-README `#` link) resolves; checked that it fails when a heading is renamed. This file is outside **Owns** (the ticket asks for a test).
- The runner image is documented as not published yet (T19 not done): Pull fails until then and Rust/Go run locally.
- Not done / not tested: the install commands were not run on macOS, Windows or Linux here (written from the tools' documentation and T17/T18 notes). The anchor slugging is a reimplementation of GitHub's, checked only for these headings; the links were not opened on github.com.

## v3: Library

Read articles from the user's Markdown folders (an Obsidian vault) offline,
with their images, and discuss them with the tutor in chats tied to
passages. SPEC §15; D-37, D-38. Every ticket here is held to the §10 rows
marked v3: each one it touches gets a test, not only a mention.

### T21 — Library folders and index

- Milestone: v3
- Size: 3d
- Depends on: T05, T09
- Spec: §4.2, §4.3, §15.1, §15.6 (Settings part)
- Owns: `packages/core/src/library/` (frontmatter, scan rules, identity; pure), `apps/desktop/src/main/library/`, `apps/desktop/src/main/storage/migrations/0002-library.sql`, `apps/desktop/src/renderer/src/pages/SettingsLibrary*`

**Goal.** The app knows which articles are in the user's chosen folders,
without ever writing to them.

**Scope.**
- Resolve the **VERIFY**: the Obsidian Web Clipper's current default template (frontmatter keys, how images are written). Record it in `DECISIONS.md`; keep a clipped sample (made by hand, no third-party article text) as a test fixture.
- `library.folders` setting; Settings → Library: add (OS folder picker in main), remove (confirm; drops index rows and, once T24 exists, chats), open in file manager, the "read only" line.
- Scan per §15.1: `*.md`, skip dot-folders, symlinks out of the folder, files over 5 MB; frontmatter parsed as data (YAML, safe schema: no custom tags); title fallback; content hash; move detection by hash or `source`; `missing_since`.
- Rescan at start, on Library open, on Refresh, and on file changes while the page is open (debounced `fs.watch`, rescan on watch errors).
- IPC: `library:folders`, `library:tree`, `library:refresh` (zod-validated; the renderer gets ids and titles, never absolute paths).

**Acceptance.**
- [x] Tests on a temp folder: notes found, dot-folders and large files skipped, a symlink out of the folder ignored, frontmatter read (fixture from the VERIFY), a renamed file keeps its id, a deleted file is marked missing.
- [x] A test proves the scan never writes: the folder's files and mtimes are unchanged after scans, refreshes and removal.
- [x] Migration test (applies on a v1 database with data; backup made).
- [x] Settings UI tests: add, remove with confirm, empty state.

**Notes.**

- Built: `packages/core/src/library/` (frontmatter with `yaml` 2.9.1, core
  schema; scan rules; `planScan` identity: path, then hash with same file
  name preferred, then `source`; `buildTree`), fixture
  `fixtures/clipped-default.md`. `apps/desktop/src/main/library/`: read-only
  folder walk (`scanner.ts`: `.md` only, dot-entries skipped, symlinks only
  if their real path is inside, dirs visited once by real path, 5 MB cap,
  sha256), `articles` table access (`index-store.ts`), `LibraryService`
  (scan at start, Refresh, serialised scans; add with the OS picker, refuses
  overlapping folders; remove drops index rows only; open in file manager),
  `watcher.ts` (recursive `fs.watch`, 500 ms debounce; on a watch error a
  full rescan and a retry after 10 s). Migration `0002-library.sql`.
  Settings → Library (`SettingsLibrary.tsx`): add, remove with an in-page
  confirm, open, counts and missing files, empty state, the read-only line.
- IPC: `library:folders`, `library:add-folder`, `library:remove-folder`,
  `library:open-folder`, `library:tree`, `library:refresh` and the stream
  `library:watch` (rescan on open, then a tree after each change-driven
  scan; T22's page subscribes while open). Ids, names and titles only; a
  test checks no reply contains the temp folder's path.
- Decisions: D-39 (the clipper VERIFY, `yaml` pin, identity details);
  SPEC §15.1 and the open-items table updated.
- Wiring outside **Owns**: `packages/core/src/settings.ts` (`library.folders`,
  ids must differ, at most 50) and `index.ts`; `packages/core/package.json`
  (`yaml`); `apps/desktop/src/shared/{library,ipc,channels}.ts`;
  `main/setup.ts` (service and handlers); `main/storage/sqlite-storage.ts`
  (`readSql`/`writeSql` on the one write queue) and `migrations/index.ts`;
  `main/ipc/handlers/settings.ts` (the settings view leaves out
  `library`, so paths never reach the renderer); `renderer/.../SettingsPage.tsx`,
  `styles.css`, `test/fixtures.ts`; schema-version expectation in
  `sqlite-storage.test.ts`.
- Checks: typecheck, lint, format, `npm test` (all pass), validate:content;
  `storage-check` and `security-check` built and run under xvfb with
  `--no-sandbox` (root container): both pass, schema 1 → 2 with backup.
- Not done / not tested: removing a folder does not yet delete chats (T24
  adds article threads). `library.images`, image cache size and **Clear**
  are T23. Real `fs.watch` events are not exercised by a test (the watcher
  is tested with a fake watch function; `fsWatch` itself is a thin
  wrapper); not tried on macOS or Windows. The Library page itself (tree,
  filter, Refresh button) is T22; the channels are tested through the IPC
  router only.

### T22 — Reader with local images

- Milestone: v3
- Size: 3d
- Depends on: T21
- Spec: §15.2, §15.3, §15.6
- Owns: `apps/desktop/src/renderer/src/library/`, `apps/desktop/src/renderer/src/pages/Library*`, `apps/desktop/src/main/library/assets*`

**Goal.** Open an article and read it, with pictures that are in the vault,
safely.

**Scope.**
- Library page: left tree with filter and Refresh, middle reader (header from frontmatter, body), right pane placeholder for T24; resizable panes reusing the practice view's.
- Markdown per §15.2: article sanitiser config (adds `img` only, `src` must be an app asset URL), Obsidian images, wikilinks to other library notes, callouts, note embeds as links. Resolve the raw-HTML **DECISION** (default: drop).
- Local image resolution and the `tutor-app://app/library-asset/<token>` route per §15.3 (tokens random per session; real path inside the folder; regular file; 25 MB; magic bytes; `nosniff`; no SVG).
- External links open in the system browser through a main-process handler that allows only `https:`, `http:`, `mailto:`.

**Acceptance.**
- [x] Asset route tests: `../` paths, absolute paths, a symlink and a hard-to-spot path (`%2e%2e`, Windows `\`) out of the folder, a non-image renamed `.png`, an SVG, an unknown token: all refused; a real PNG/JPEG/GIF/WebP served with the right type.
- [x] Sanitiser tests: `<script>`, `<img onerror>`, `javascript:` links, an `img` with a remote or `file:` URL → removed or placeholder; wikilinks and callouts render.
- [x] Reading works with no key and the network unavailable (test with the fake tutor and no fetch).
- [x] The window's CSP and request filter are unchanged (existing security tests still pass, unmodified).

**Notes.**

- Built: `main/library/assets.ts`: `extractRefs` (images and wikilinks
  from the file, code skipped), `FolderResolver` (relative to the note,
  then the root, then a unique name, shortest path; `%`-decoding and `\`
  as `/` before the inside check), `checkImageFile` (real path inside,
  regular file, 25 MB, PNG/JPEG/GIF/WebP magic, SVG refused),
  `AssetRegistry` (random session tokens; every request re-checked, type
  from the bytes served, `nosniff`; a removed folder's tokens stop),
  `resolveLink`, `readArticle`, `externalUrl`, `registerReaderHandlers`.
  Renderer: `library/article-markdown.ts` (own DOMPurify instance, chat
  allowlist + `img` with asset `src` only; `![[x.png|300]]`, `![a](p)`,
  wikilinks, note embeds as links, callouts; raw HTML dropped),
  `library/Reader.tsx` (header from frontmatter, "file missing" banner,
  links: `#/library/<id>` in the app, web/mail through main),
  `library/LibraryTree.tsx` (filter by title and tag), `pages/LibraryPage.tsx`
  (tree + Refresh, reader, chat placeholder for T24; subscribes to
  `library:watch` while open; the reader reloads after each scan).
- IPC: `library:article` (header, body, `images` per reference key: asset
  URL or reason; `links` per wikilink target: article id or `null`; never a
  path) and `library:open-link` (refused `scheme` unless `https:`,
  `http:`, `mailto:`).
- Decisions: D-40 (raw HTML dropped; reference keys, tokens, resolution,
  links). SPEC §14 and §15.2 updated.
- Wiring outside **Owns**: `shared/{library,ipc,channels}.ts` (schemas,
  `refKey`, `wikiTarget`, `IMAGE_FILE`, two channels);
  `main/library/service.ts` (`article(id)`); `main/window.ts`
  (`UiOptions.libraryAssets`: the UI protocol handler sends
  `/library-asset/` to the route; CSP and request filter untouched);
  `main/setup.ts` (registry, handlers, `shell.openExternal`);
  `renderer/.../lib/router.ts` (+test: `/library`, `/library/<id>`),
  `App.tsx` (nav link, route), `components/Panes.tsx` (`storageKey`,
  `initialSizes`), `lib/markdown.ts` (exports its allowlists),
  `styles.css`.
- Checks: typecheck, lint, format, `npm test` (67 files, 878 passed);
  `check:security` and `npm run e2e` built and run under xvfb with
  `--no-sandbox`: all pass; `window.test.ts` and `security-check.ts`
  unmodified.
- Not done / not tested: the asset route is tested with `Request`s in
  Vitest, not through Chromium (an image actually drawn in the window is
  for T26's end-to-end test); in `npm run dev` the page comes from Vite's
  origin, so `img-src 'self'` will not load asset URLs there (packaged and
  `electron-vite preview` builds are fine). Linked (`https:`) and `data:`
  images show a placeholder only (T23 adds **Load images** / **Retry**).
  Margin markers and the chat pane are T24. Hard links out of the folder
  cannot be told apart from files inside and are served (as Obsidian
  would show them). Not tried on macOS or Windows (Windows `\` handling is
  unit-tested only).

### T23 — Linked images: safe download and cache

- Milestone: v3
- Size: 3d
- Depends on: T22
- Spec: §15.4, §10 (v3 rows)
- Owns: `apps/desktop/src/main/library/images/`

**Goal.** Pictures an article links to show offline, downloaded once by the
main process, without letting a note reach the local network or deliver
something that is not an image.

**Scope.**
- Downloader per §15.4: `https`/443 only; address check (loopback, private, link-local, CGNAT, multicast, unspecified, IPv4-mapped and other IPv6 forms; `localhost`, `*.local`) with the connection pinned to the checked address; redirects by hand, re-checked, at most 3; no cookies, `Referer` or credentials; caps (size, time, concurrency, count and total per article); magic bytes and header dimensions; never decoded in main. Reuse what fits from `main/intake/fetch.ts`.
- `data:` images (PNG/JPEG/GIF/WebP, 2 MB) stored and served like downloads.
- Cache at `<data>/cache/article-images/`, failure memory (1 hour), served via the T22 asset route.
- `library.images` setting (`on-open` / `ask`); placeholders with **Load images** and **Retry**; **Make available offline** per folder (background, cancellable, progress); cache size and **Clear** in Settings → Library.

**Acceptance.**
- [x] Tests with an injected fetch and resolver: each blocked address class, a public name that resolves to `127.0.0.1` or `10.x`, a redirect to a private address, `http:`, another port, too many redirects, oversized body (with and without `Content-Length`), slow body, HTML served as `image/png`, a PNG claiming 50,000 × 50,000: all refused with a clear placeholder reason.
- [x] A test that the connection goes to the checked address (DNS answer changes between check and connect).
- [x] A served cached image works with the network off; cache cleared from Settings.
- [x] No request leaves the UI window's session (request filter log empty during an article open with remote images). (Checked in Electron by T26's `check:security`.)

**Notes.**

- Built (`main/library/images/`): `address.ts` (public unicast only;
  mapped/compatible/NAT64/6to4 judged by their IPv4; local names),
  `header.ts` (type and width × height from PNG/JPEG/GIF/WebP headers, no
  decoding), `download.ts` (https/443, no user info, resolve-then-check
  every address, `https.request` with a pinned `lookup`, manual redirects
  ≤ 3 each re-checked, generic headers only, 10 MB, 15 s incl. a stalled
  body, magic bytes, 100 MP), `cache.ts` (`<data>/cache/article-images/
  <sha256>` + `.json` record; usage, clear), `linked.ts` (`LinkedImages`:
  view without network, `data:` decode ≤ 2 MB, 4 at a time, in-flight
  dedupe, 200 images / 100 MB per article, 1-hour failure memory, Retry),
  `handlers.ts` (`library:load-images`, `library:image-cache`,
  `library:clear-image-cache`, stream `library:offline`). Renderer:
  `library/linked-images.tsx` (auto-load in `on-open`, **Load images** in
  `ask`, **Retry**; sends the article id only), Settings → Library: mode
  select, cache size + **Clear**, per folder **Make available offline**
  with progress and **Cancel download**.
- Decisions: D-41. SPEC §15.4 gains the IPC/reasons paragraph.
  `library.images` added to core settings (default `on-open`) and to the
  settings view/patch (`library.images` only; folders stay out).
- Wiring outside **Owns**: `shared/{library,ipc,channels,settings}.ts`
  (new reasons, schemas, 3 invoke + 1 stream channel; ref keys up to 3 MB
  for `data:`), `packages/core/src/settings.ts` (+test),
  `main/library/assets.ts` (`AssetRegistry.url(null, …)` = cache variant,
  no folder check; `readArticle(…, linked)`; long `data:` keys in
  `extractRefs`), `main/ipc/handlers/settings.ts` (view), `main/setup.ts`,
  `renderer/.../library/{Reader.tsx,article-markdown.ts}` (bar, reason
  texts), `pages/SettingsLibrary.tsx`, test fixtures. No migration.
- Checks: typecheck, lint, format, `npm test` (70 files, 951 passed);
  `check:security` built and run under xvfb with `--no-sandbox`: all pass.
  Tests: `images/download.test.ts` (every address class, names, DNS
  answering a private address, DNS changing after the check, redirects to
  private/IP/http and > 3, oversize with/without `Content-Length`, stalled
  body, HTML as `image/png`, 50,000 × 50,000 PNG; the real transport
  against a local server reached only through the pinned address of an
  `.invalid` name), `images/linked.test.ts` (IPC: only file references,
  code skipped, ask/force, cache served after a "restart" with the network
  off, failure memory/Retry/expiry, 200-image cap, Clear → 404, `data:`
  rules, offline stream progress), `renderer/.../linked-images.test.tsx`.
- Not done / not tested: the fourth acceptance box (UI session's request
  filter log empty during an article open with remote images) is not
  checked in Electron — main downloads through Node, not the window's
  session, and `check:security` is unchanged; that log check belongs in
  T26's security/e2e test. No real network download was tried (tests use
  fakes and a local plain-HTTP server; TLS/SNI on the real transport is
  untested). The 100 MB per-article cap is not unit-tested (200-image cap
  is). Offline download stops when Settings is left. Failure memory is not
  kept across restarts. Not tried on macOS or Windows.

### T24 — Chats tied to passages

- Milestone: v3
- Size: 4d
- Depends on: T22, T10, T11
- Spec: §7.4, §15.5, §15.6 (chat pane)
- Owns: `packages/core/src/library/anchors*`, `packages/core/src/tools/article*`, `apps/desktop/src/main/storage/migrations/0003-article-threads.sql`, `apps/desktop/src/renderer/src/library/chat/`

**Goal.** Several chats per article, each about a passage, with the tutor
seeing that passage.

**Scope.**
- Anchors in core: create from a selection or heading (heading path, quote, 32-character prefix/suffix); resolve (exact, prefix/suffix for repeats, heading only, detached).
- Migration: `threads.kind`, `article_id`, `anchor`, `title`; existing threads become `home`/`problem`.
- Article-mode turn context and prompt section per §15.5 (outline, anchored section capped at 8,000 characters, quote; delimited untrusted data); tools `read_article_section`, `search_article`, `get_profile`, for both backends (the Claude Code backend gets them through the MCP server).
- UI: **Ask about this** on selection, heading margin button, margin markers, thread list (title, snippet, date), open thread, rename, reset (7.4), detached and "file missing" states, the one-time provider notice.

**Acceptance.**
- [x] Core tests: anchors survive edits around the passage, pick the right one of repeated quotes, fall back to the heading, detach cleanly.
- [x] A turn's context contains the outline and section but not the rest of the article; tools return text from the open article only and are capped.
- [x] Fake-tutor tests: an article containing "ignore your instructions and …" is passed inside the untrusted-data delimiters; the tutor has no tool beyond the three.
- [x] A test that chat messages never render `img` (a reply with `![x](https://…/?d=secret)` makes no request and shows no image), in article and problem threads.
- [x] Both backends: one article turn with tools (fake tutor; Claude Code with its fixture).

**Notes.**

- Built: core `library/anchors.ts` (anchor from a range or a heading;
  resolve: exact quote, prefix/suffix + heading to pick between repeats,
  heading only, detached; `markdownDoc`, outline, sections capped at
  8,000 with a window around the passage; `parseAnchor`), `tools/article.ts`
  (`articleTurnContext`; `read_article_section`, `search_article`,
  `get_profile` bound to the open article, capped), `tools/article-prompt.ts`
  (article system prompt; `<article_text>` / `<article_quote>` delimiters,
  tags escaped). `ChatService`: `article:<uuid>` threads,
  `createArticleThread`, `articleThreads`, `renameThread`, article mode
  per turn (context, tools, prompt from `ChatDeps.article`), title from the
  first question, reset keeps the passage. Migration
  `0003-article-threads.sql` (`kind`, `article_id`, `anchor`, `title`;
  existing threads → `home`/`problem`). Renderer `library/chat/`:
  `dom-doc.ts` (reader DOM as an `AnchorDoc`), `PassageLayer.tsx`
  (**Ask about this** on a selection, **Ask** beside headings, margin
  markers), `ArticleChatPane.tsx` (thread list with title, snippet, date
  and "detached"; open thread, rename, **New chat**, file-missing and
  tutor-off states, the one-time notice), `useArticleChats.ts`.
- IPC: `library:threads`, `library:thread-create`, `library:thread-rename`,
  `library:chat-notice` (`shared/article-chat.ts`); turns and transcripts
  reuse `chat:*` (`threadId` accepts `article:<uuid>`).
- Decisions: D-42. SPEC §15.5 updated (thread created on first question,
  reset keeps the passage, folder removal deletes chats).
- Wiring outside **Owns**: `packages/core/src/storage.ts` (thread kind and
  v3 fields, `listThreads({ articleId })`), `teaching/memory-storage.ts`,
  `tutor/{chat,backend,prompt}.ts`, `tools/{index,tutor-tools}.ts`
  (`GET_PROFILE_DESCRIPTION` shared), `library/index.ts`;
  `main/storage/sqlite-storage.ts`, `migrations/index.ts`;
  `main/tutor/index.ts` (`readArticle`, `articlePrompt`, article mode);
  `main/ipc/handlers/article-chat.ts` (new); `main/library/assets.ts`
  (`readArticleText`), `main/library/index-store.ts` (folder removal
  deletes its article threads); `main/setup.ts`;
  `shared/{article-chat,ipc,channels,tutor}.ts`; `renderer/.../Reader.tsx`
  (`layer`, `onArticle` props), `pages/LibraryPage.tsx`; tests: storage,
  migration, library, tutor, both backends, `claude-code/fixtures/article-turn.jsonl`.
- Checks: typecheck, lint, format, `npm test` (70 files, 912 passed, 12
  skipped), validate:content; `check:security`, `check:storage` and
  `npm run e2e` built and run under xvfb with `--no-sandbox`: all pass.
  (Lint and Prettier were run with `.claude/**` ignored: another agent's
  worktree sits there in this checkout.)
- Not done / not tested: the Claude Code article turn replays a fixture
  derived by hand from the recorded turn, not a new recording with the real
  CLI. Marker and button positions use `getBoundingClientRect`, which jsdom
  lacks: tests check markers exist and open threads, not where they sit; no
  end-to-end test drives a selection in Electron (T26). Selections across
  inline Markdown (`**bold**`) resolve in main to the heading's section
  (D-42). Not tried on macOS or Windows. T25's `create_problem` is not in
  the article tools.

### T25 — Tutor-written articles and problems from passages

- Milestone: v3
- Size: 2d
- Depends on: T24, T12
- Spec: §15.1 (generated articles), §15.5 (tools), §6.3 (self-check)
- Owns: `packages/core/src/library/generate*`, `apps/desktop/src/main/library/generated/`

**Goal.** Ask the tutor to write an article on a topic, and turn a passage
into a practice problem.

**Scope.**
- "Write an article" (topic, level, length): saved to `<data>/articles/generated/<slug>.md` with frontmatter (`title`, `created`, `tags`, `generated: true`), shown under **Written by the tutor**, labelled AI-written, included in export.
- "Make a problem from this" in an article thread: `create_problem` with the passage as delimited context; the problem passes the self-check before it appears (§6.3), as with T12.

**Acceptance.**
- [x] Fake-tutor tests: an article is written, appears in the tree, renders, is exported; a problem from a passage passes the self-check and opens in Practice; a failing self-check shows nothing new.

**Notes.**

- Built: core `library/generate.ts` (request check; slug, tags; body
  cleaning: no frontmatter, no repeated `# Title`, every image form turned
  into its alt text; the file with `title`, `created`, `tags`,
  `generated: true`; `ArticleWriter`: one article at a time over the
  tutor's backend, a single `save_article` tool, at most 2 turns and 3
  saves). Core `tools/article.ts`: `create_problem` in article mode when
  the context has `createProblem` (the tutor registry's own tool, so T12's
  guard, factory and Pyodide self-check), 4 calls per turn, `open_problem`
  + `refresh_state` on success; `article-prompt.ts`: the "problems from a
  passage" rules, `PASSAGE_PROBLEM_REQUEST`, and the `problem_spec` and
  `topics` guides when the tool is offered. Main `library/generated/`:
  `GeneratedArticles` (staged dot file, renamed), `articleWriter`,
  `library:write-article`. UI: **Write an article** (topic, level, length)
  in the Library's left pane, opens the new article; **Written by the
  tutor** group with an AI-written pill; reader label; **Make a problem
  from this** in an article thread and **Open in Practice** when one
  passes.
- Decisions: D-43. SPEC §4.5 (export), §15.1 (writing, images removed),
  §15.5 (`create_problem`) updated.
- Wiring outside **Owns**: `core/src/tools/article.ts`,
  `tools/article-prompt.ts` (as T24 asked), `tutor/prompt.ts`
  (`rewriteGuide` exported), `library/index.ts`; `main/library/service.ts`
  (`generatedDir`: indexed as folder `generated`, not in Settings;
  `articleAt`), `main/library/assets.ts` (`generated` flag from the
  folder), `main/tutor/index.ts` (article `create_problem`, guides),
  `main/setup.ts`, `main/storage/paths.ts` (`generatedArticles`),
  `main/data/archive.ts` (`articles/generated` exported);
  `shared/{library,ipc,channels}.ts`; renderer `library/WriteArticle.tsx`
  (new), `LibraryTree.tsx`, `Reader.tsx`, `chat/ArticleChatPane.tsx`,
  `chat/ChatEffects.tsx` (ignores `open_problem` from `article:` threads),
  `pages/LibraryPage.tsx`, `styles.css`; three renderer test fixtures gain
  `generated: false`.
- Tests: `core/src/library/generate.test.ts` (cleaning, slug, round trip
  through the library parser, writer with the fake backend, article
  `create_problem` limit and prompt); `main/library/generated/generated.test.ts`
  (real index, reader, export, file catalog and Pyodide: an article is
  written, appears under **Written by the tutor**, renders AI-written, is in
  the export zip; a passage problem passes after a repair, ran in Pyodide
  only, and opens through `problems:get`; four failing self-checks add
  nothing and a fifth call is refused); renderer `ArticleChat.test.tsx`
  (button sends the request, **Open in Practice**, AI-written label,
  **Write an article** opens the new id).
- Checks: typecheck, lint, format (repo paths; `.claude/**` is another
  agent's worktree), `npm test` (75 files, 998 passed, 12 skipped),
  validate:content, `check:security` (xvfb, `--no-sandbox`).
- Not done / not tested: no real AI provider (Anthropic or Claude Code)
  wrote an article or a passage problem; the Claude Code backend gets the
  new tools over MCP like any registry but has no fixture for them. Writing
  has no progress events or Stop (it can take minutes; 5-minute limit).
  Generated articles cannot be deleted or edited from the UI. No
  end-to-end (Electron) test of these flows (T26 owns e2e), and
  `npm run e2e` was not run. Not tried on macOS or Windows.


### T26 — Library security check and end-to-end test

- Milestone: v3
- Size: 2d
- Depends on: T23, T24
- Spec: §10 (v3 rows), §13, §15
- Owns: `apps/desktop/e2e/library.e2e.ts`, `apps/desktop/src/main/security-check.ts` (Library additions)

**Goal.** Prove the v3 security rows hold in the built app, not only in unit
tests.

**Scope.**
- A hostile test vault (made by hand): path-escape image links, a symlink out, raw HTML and scripts, `javascript:` links, a fake PNG, an SVG, image links to `127.0.0.1`, `169.254.169.254`, `[::1]` and a name resolving to a private address, a redirect chain to a private address, a prompt-injection passage.
- `check:security` additions: after opening every hostile article the UI session's request log holds only `tutor-app://` requests; the downloader's log shows each hostile URL refused with its reason; no file outside the vault was read (served-files log).
- `library.e2e.ts` with the fake tutor and a local HTTPS stand-in for a public image host: add folder, read, images download once and show offline, ask about a passage, second thread on another passage, markers, reopen.
- Add `library.e2e.ts` to `npm run e2e`.

**Acceptance.**
- [x] `check:security` passes with the hostile vault; each v3 row in §10 is named in its output.
- [ ] `library.e2e.ts` passes on Linux; CI runs it on all three OSes. (Passes on Linux; the CI step for macOS and Windows is added but has not run yet.)

**Notes.**

- Built: `main/testing/hostile-vault.ts` (built at run time: `../`,
  `%2e%2e`, `\`, absolute, `file:`, `notes/../../` and wikilink paths out,
  a symlink out, raw `<script>`/`<img onerror>`/`<iframe>`/`<object>`/
  `<style>`/`onclick`, `javascript:` links raw and Markdown, a text file
  named `.png`, an SVG file and an SVG `data:` URL, linked images to
  `127.0.0.1`, `169.254.169.254`, `[::1]`, `[::ffff:127.0.0.1]`, `10.x`,
  `localhost`, `*.local`, a name resolving to `10.0.0.7`, a redirect chain
  ending there, port 8443, `http:`; a prompt-injection passage with a
  `</article_text>` breakout). `main/testing/standin.ts`: a local HTTPS
  image host (self-signed cert from `openssl` at run time), real PNGs, and
  the real downloader reaching only it (D-44). `check:security` additions:
  opens every hostile article in the window and checks, each named with its
  §10 v3 row (a `v3Rows` summary line, and a final check that all seven
  hold): only `good.png` gets an asset URL and is drawn; nothing from the
  markup reaches the page or runs; the fake PNG and SVGs refused; the
  downloader log has each hostile `https:` URL refused with its reason and
  `http:` never downloaded; the stand-in saw only the good image and the
  redirect hops; the cached linked image is drawn from an asset URL; the
  served-files log is inside the vault or the image cache; the UI session's
  request log holds only `tutor-app://` and nothing was blocked; nothing is
  sent while reading; a passage chat (fake tutor) has the injection only
  inside `<article_text>`/`<article_quote>` with the breakout escaped and
  exactly the three article tools; its reply's image is neither rendered
  nor requested. `e2e/library.e2e.ts` (+ `fake-tutor-library.json`), from
  the new `out/main/e2e-main.js`: add folder in Settings, read (vault image
  and linked image drawn, linked one downloaded once), select text →
  **Ask about this** → provider notice → reply with a tool chip, no image
  rendered or requested; second thread on another passage; two markers,
  each within 30 px of its passage and in order; restart with the image
  host stopped: images drawn from cache, both threads listed, markers back,
  a marker reopens its thread; every page request `tutor-app://`.
- Decisions: D-44.
- Wiring outside **Owns**: `main/setup.ts` (`setTestHooks`: image
  downloader, served-file callback; never set by `index.ts`),
  `main/window.ts` (`UiOptions.onRequest`, called for every page request;
  filter unchanged), `main/library/assets.ts` (`AssetRegistry` `onServe`),
  `main/e2e-main.ts` (new entry), `electron.vite.config.ts`,
  `electron-builder.yml` (excludes `e2e-main.js` and the `standin` chunk),
  `apps/desktop/package.json` (`npm run e2e` runs `library.e2e.ts`),
  `.github/workflows/ci.yml` (library e2e on macOS and Windows).
- Checks: typecheck, lint, format, `npm test` (73 files, 985 passed, 12
  skipped); `check:security` and `npm run e2e` built and run under xvfb
  with `--no-sandbox`: all pass.
- Security bugs found: none; every hostile input was refused as specified.
- Not done / not tested: the CI step on macOS and Windows has not run
  (needs `openssl` on the runner's PATH under bash; the symlink case in
  `check:security` is reported, not required, where it cannot be made;
  `check:security` itself still runs on Linux only). The stand-in replaces
  DNS and the socket, so real TLS to a real host and real DNS are still
  untested. `npm run package:dir` was not re-run to confirm the new
  exclusions. Selections are made with a DOM `Range` plus a `mouseup`, not a
  real mouse drag.

---

## Polish

### T27 — README, user guide, logo and screenshots

- Milestone: polish
- Size: 1d
- Depends on: T26
- Spec: §8, §15 (documented, not changed)
- Owns: `README.md`, `docs/README.md`, `docs/guide/`, `docs/architecture.md`, `docs/assets/`, `CONTRIBUTING.md`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/`, `apps/desktop/build/icon.png`, `apps/desktop/e2e/screenshots.ts`

**Goal.** A front page and docs that read like a finished open-source
project, covering v3.

**Acceptance.**
- [x] README is a front page: logo, badges, screenshot, features (including the Library), quick start, docs index, development, acknowledgements.
- [x] The user guide in `docs/guide/` holds what the README used to (install, first run, tutor, data and privacy, troubleshooting) plus a Library page and a code execution page.
- [x] Settings → Code execution's install links point at `docs/guide/code-execution.md` headings; a test checks them.
- [x] Every relative link and anchor in the README and docs resolves (`scripts/docs-links.test.ts`).
- [x] Screenshots come from the built app (`npm run screenshots`), not mock-ups.

**Notes.** (2026-11-20)
- **Built.** New logo (`docs/assets/logo.svg`; the app icon
  `apps/desktop/build/icon.png` is rendered from it), a social preview card
  (`docs/assets/social-preview.png`, to upload in the repository's
  Settings → General → Social preview), five screenshots from
  `e2e/screenshots.ts` with a scripted tutor (`e2e/fake-tutor-screens.json`).
  README rewritten as a front page; the long install, sandbox and
  troubleshooting sections moved to `docs/guide/` (seven pages, one new for
  the Library); `docs/architecture.md` (Mermaid diagrams), `docs/README.md`
  index, `CONTRIBUTING.md`, `SECURITY.md`, issue forms. CHANGELOG lists the
  Library. Links use the repository's name, `hqazi/algo` (D-46).
- **Found while taking screenshots, fixed.** The Library chat composer
  squeezed its text box to a few characters beside **Make a problem from
  this** (`article-chat.css`: the text box gets its own row).
  `longest-distinct` had no test for the classic "start the window over on
  a repeat" bug, which passed all ten tests; added hidden test `dvdf`
  (category "repeat inside the window").
  CI on `main` was red on macOS and Windows since the T26 merge:
  `library.test.ts` compared the stored folder with the temp path, but the
  library stores the real path (`/private/var/...`, Windows long names);
  the test now resolves its temp folder first (`realpathSync.native`, which
  also expands Windows 8.3 names), and its watch test waits for each
  rescan (`vi.waitFor`) instead of a fixed 30 ms that the slow Windows
  runner missed (test-only changes).
- **Wiring outside Owns.** `code-execution.ts` (`GUIDE_URL`),
  `install-help.test.ts`, comments in `settings.ts`, `ipc.ts`,
  `SettingsCodeExecution.tsx`, `code-execution.test.ts`, `library.test.ts`;
  `package.json`
  scripts `screenshots`; `content/problems/sliding-window/longest-distinct/tests.json`.
- **Repository name.** Every reference to the repository is now
  `hqazi/algo` (D-46), including `publish.repo` for updates and the runner
  image's source label; `settings.e2e.ts` expects the guide URL.
- **Renamed to Algo** (D-47): display name, data folder, installers,
  executable, app id, workspaces, runner image, export tag (old one still
  imports, tested). Screenshots and the social card retaken.
- **Not done.** Screenshots are 1x (1440×880): Playwright's Electron pages ignored both
  `--force-device-scale-factor` and a CDP device-scale override. The new icon
  was not checked in a packaged build (`npm run package:dir` not run). The
  README was not previewed on GitHub itself.


---

## Design refresh

A modern, sleek look for the whole app, from a UI/UX review (2026-11-20).
Target: [`design.md`](design.md).

**Rules for the design tickets.** Read `docs/design.md` first; it is the
contract for how things look, as `SPEC.md` is for what they do. Keep
accessible names of controls (icon-only buttons get `aria-label` and
`title`) so the e2e tests and the guide still hold; where a name must change,
update the tests and the guide in the same ticket. Put page-specific CSS in
its own file next to the page (for example `pages/problems.css`) rather than
growing `styles.css`, so tickets running in parallel do not collide. Any new
npm dependency must pass `npm run check:deps` (14-day cooldown, D-48), be
pinned exactly, and have its licence listed in the third-party notices and
Settings → About. Before finishing: `npm run typecheck`, `npm run lint`,
`npm test`, `npm run e2e` (Linux without a display: `xvfb-run -a`), and
look at the changed screens in light and dark (`npm run screenshots`, or a
scratch copy of `e2e/screenshots.ts` that is not committed).

### T28 — Design foundations: tokens, fonts, icons, controls

- Milestone: design
- Spec: §8, §15.6 (behaviour unchanged); target look in [`design.md`](design.md)
- Size: 2d
- Depends on: T27
- Owns: `apps/desktop/src/renderer/src/styles.css` (tokens, base elements, controls), `apps/desktop/src/renderer/src/components/ui/` (new), `apps/desktop/src/renderer/src/components/Editor.tsx` (theme only), `apps/desktop/src/renderer/src/main.tsx`, `apps/desktop/package.json` (dependencies), `apps/desktop/build/notices/`, `apps/desktop/electron-builder.yml` (notices), `SettingsPage.tsx` licence list

**Goal.** The design system from `design.md` → Foundations, applied to every
existing screen through tokens and base element styles, so the app already
looks cleaner before any page is reworked.

**Acceptance.**
- [x] Colour, type, radius, shadow and motion tokens from `design.md`, light and dark; existing token names still work.
- [x] Inter and JetBrains Mono bundled (no network fetch at runtime); `lucide-react` added; licences in `build/notices/` (shipped by `extraResources`) and in Settings → About.
- [x] Button variants (`primary`, `secondary`, `ghost`, `danger`, `icon`; sizes `sm`, default, `lg`); styled inputs, selects (chevron), textareas; segmented control, menu (popover), auto-growing textarea, pill/badge, tooltip-on-`title` where useful — as small React components in `components/ui/` with unit tests for behaviour (menu keyboard, segmented control selection, textarea growth).
- [x] Thin overlay scrollbars; `prefers-reduced-motion` respected.
- [x] CodeMirror light and dark themes match the tokens.
- [x] Contrast checked for text and accent pairs in both themes (a unit test that computes WCAG ratios for the token pairs is enough).
- [x] Screenshots of every page in light and dark looked at; nothing broken.

**Notes.** (2026-11-20)
- **Built.** Tokens in `styles.css` for light and dark (colour, type,
  radius, shadow, motion, spacing, control heights), old names kept as
  aliases; base element styles (headings, links, code, selection, focus
  ring) and control styles applied to every existing screen through bare
  elements: buttons (secondary by default, `.primary`, `.danger`), inputs,
  selects with a chevron, textareas, checkboxes/radios in the accent,
  20px tinted pills, cards with a soft shadow, dialogs with `--radius-lg`,
  `--shadow-lg` and a blurred backdrop. Thin overlay scrollbars (thumb on
  hover); `prefers-reduced-motion` turns transitions and animations off.
  Inter and JetBrains Mono bundled (`@fontsource-variable/*` 5.3.0) and
  `lucide-react` 1.69.0 (16px, stroke 1.75 via `LucideProvider`); notices
  `build/notices/{inter,jetbrains-mono,lucide}.txt` (shipped by the existing
  `extraResources` entry, so `electron-builder.yml` needed no change) and
  two lines in Settings → About. `components/ui/`: `Button`, `IconButton`
  (requires `aria-label`, which is also its `title`), `Select`,
  `Segmented`, `Menu`, `AutoGrowTextarea`, `Badge`, with 15 unit tests
  (classes, names, menu keyboard and focus return, outside click and Tab,
  segmented selection and arrow keys, textarea growth to the cap).
  CodeMirror chrome from the tokens in both themes (`Editor.tsx`, theme
  only). `styles.test.ts`: WCAG ratios of 34 text/background pairs per
  theme (body 16:1, muted ≥ 5.3:1 on every surface, white on accent 6.3:1,
  links ≥ 7.9:1, statuses on their tints ≥ 4.5:1), every colour token has a
  dark value, reduced motion present.
- **Decisions.** D-49 (palette and the new `--accent-fg` / `--focus`
  tokens, fonts, icons, segmented control as `aria-pressed` buttons, menu
  items as `menuitem`, scrollbars, editor theme, Run/Submit variants).
  `check:deps` passes (567 versions, none younger than 14 days).
- **Wiring outside Owns.** `PracticePage.tsx`: Run lost `primary`, Submit
  `accent` → `primary` (class names only; names unchanged).
  `apps/desktop/vitest.config.ts`: `css.include` so `styles.test.ts` can
  read `styles.css?raw`. `package-lock.json`.
- **Checked.** `npm run typecheck`, `npm run lint`, `npm run format:check`,
  `npm test` (78 files, 1106 passed, 12 skipped), `npm run
  validate:content` (50 problems), `xvfb-run -a npm run e2e` (all six
  suites, no failures; the Library suite's "every request the page made was
  tutor-app://" also shows the fonts come from the app). Screenshots of
  onboarding, home, problems, practice, explanation, New problem, progress,
  settings (four scroll positions) and library in light and dark, taken
  with a scratch script (not committed), looked at; fixed the code
  ligatures they showed in the editor. A check in the same run found
  `Inter Variable` loaded from the bundle.
- **Not done / not tested.** The new `ui/` components are not used by any
  page yet (T29–T33 adopt them). Native widgets still showing: the chat
  composers' resize grips (T30 uses `AutoGrowTextarea`), the Library tree's
  disclosure triangles (T32), radios (accent-coloured; choice cards are
  T33), and the scrollbar inside the explanation iframe, a separate
  sandboxed document this stylesheet does not reach. No custom tooltip
  component: tooltips are `title`. `design.md`'s token table does not list
  `--accent-fg` and `--focus` yet (T34 updates `design.md`). Not checked in
  a packaged build (`npm run package:dir` not run), on macOS or Windows, or
  at the minimum window size; `docs/assets/screenshots/` not retaken (T34).

### T29 — App frame: title-bar navigation and edge-to-edge panes

- Milestone: design
- Spec: §8, §15.6 (behaviour unchanged); target look in [`design.md`](design.md)
- Size: 2d
- Depends on: T28
- Owns: `App.tsx` (shell), `components/Panes.tsx`, `components/AppFrame.tsx`/`Nav*.tsx` (new), shell section of `styles.css`, `apps/desktop/src/main/window.ts` (title bar options), `docs/assets/logo.svg` (mark only, read)

**Goal.** `design.md` → App frame.

**Acceptance.**
- [x] Navigation in the title bar: macOS `hiddenInset` with room for the traffic lights, Windows/Linux `titleBarOverlay` coloured from the theme (updates when the theme changes); draggable bar, non-draggable controls. A window test covers the options per platform.
- [x] Logo mark + **Algo**; nav links with icons and a non-button active state; **New problem** and **Next problem** on the right; tutor status as a dot + label with a tooltip.
- [x] Nav hidden during onboarding.
- [x] Panes edge to edge with 1px dividers as resize handles (keyboard-resizable, as today), and a shared pane header component used by Practice and Library.
- [x] Checks and e2e pass; screenshots looked at in both themes.

**Notes.** (2026-11-20)
- **Built.** `main/window.ts`: `titleBarOptions(platform, dark)` (macOS
  `hiddenInset` with the traffic lights centred in the 44px bar; Windows and
  Linux `hidden` + `titleBarOverlay` in the theme's `--bg`/`--muted`) and
  `followThemeInTitleBar`, which recolours the overlay and window background
  on `nativeTheme` `updated` and stops when the window closes; the
  `webPreferences` baseline is untouched. `components/AppFrame.tsx`
  (`TitleBar`, `LogoMark`) with `app-frame.ts` (platform, tooltip): inline
  logo mark + **Algo**, nav links Home / Problems / Progress / Library /
  Settings with lucide icons and an accent-subtle pill plus
  `aria-current="page"` for the current page (icons only under 1100px,
  names kept), **New problem** (secondary) and **Next problem** (primary),
  tutor status as a dot + "Tutor" (visually hidden "on"/"off"; backend and
  model or the reason in the tooltip). The bar is a drag region, its
  controls are not; only the logo and name show during onboarding.
  `components/PaneHeader.tsx` and `Panes.tsx`: panes edge to edge on
  `--surface`, 1px dividers as separators (wider hit area, accent on hover
  and drag, focus ring, arrow keys as before, `aria-valuenow`), a
  `PaneHeader` per pane from its title and `actions`, or `header: false`
  for content with its own. Tests: 4 new window tests (options per
  platform, recolouring and unsubscribing, colours and height match
  `styles.css`), `AppFrame.test.tsx` (6) and `Panes.test.tsx` (2).
- **Decisions.** D-50.
- **Wiring outside Owns.** `PracticePage.tsx`: the editor toolbar's
  controls moved unchanged into the Code pane's header (`actions`), the
  Tutor pane is `header: false`. `chat/ChatPane.tsx`: its `chat-head` div is
  now a `PaneHeader` (same children). `LibraryPage.tsx`: **Refresh** moved
  from the filter row into the Articles pane's header; the Chats pane is
  `header: false` once an article is open. `library/chat/ArticleChatPane.tsx`:
  the "Chats" head is a `PaneHeader` (the open thread's head is unchanged).
  `components/Link.tsx`: passes `aria-current`. `styles.css`: the shell
  section rewritten, the old pane, gutter, tab and `.toolbar` rules removed
  from the practice section, `--titlebar-h` and `--pane-header-h` tokens.
- **Checked.** `npm run typecheck`, `npm run lint`, `npm run format:check`,
  `npm test` (80 files, 1118 passed, 12 skipped), `npm run
  validate:content` (50 problems), `xvfb-run -a npm run e2e` (all six
  suites, `failures: []`), the security check (`electron
  out/main/security-check.js` with `--no-sandbox` as root under xvfb,
  `failures: []`). Screenshots in light and dark (scratch script, not
  committed) of onboarding, home (also at 1000 and 860px wide), problems,
  practice, explanation, New problem, progress, settings and library, plus
  X-screen captures showing Linux's window controls overlay in the bar
  colour and recoloured when Settings → Theme changes; fixed the overlay
  hiding the bar's bottom border.
- **Not done / not tested.** Seen on Linux (xvfb) only: the macOS
  `hiddenInset` path (traffic light position and the 84px inset) and
  Windows' overlay were not seen. Not checked in a packaged build. The
  explanation dialog, Problems, Progress, Settings and Home content are
  unchanged (T30–T33). The pane headers hold the old controls as they were
  (bare buttons, the full Practice toolbar, the chat thread buttons): the
  Code pane's header wraps to two rows when that pane is narrower than
  about 520px, until T30 moves Give up and Reset into a menu. Narrow layout
  (under 900px) keeps the stacked tabs, restyled only. The user guide still
  says "top bar" (T34).


### T30 — Practice page refresh

- Milestone: design
- Spec: §8, §15.6 (behaviour unchanged); target look in [`design.md`](design.md)
- Size: 2d
- Depends on: T29
- Owns: `pages/PracticePage.tsx`, `components/ResultsPanel.tsx`, `components/Editor.tsx` (toolbar), `chat/` (shared message and composer components), `explanation/ExplanationViewer.tsx` (header), `pages/practice.css` (new)

**Goal.** `design.md` → Practice. The chat message list and composer built
here are reused by the Library (T32).

**Acceptance.**
- [x] Statement header with pills; quiet details block.
- [x] Editor toolbar: styled language select, faint save state, **Run** secondary with icon, **Submit** primary; **Give up** and **Reset** in a "More" menu.
- [x] Results: sticky summary bar; passing tests collapsed, failing open; input / expected / got grid.
- [x] Tutor pane: segmented "This problem / General", icon **New chat**, bubble styles, faint action chips, **Hint / Review / Explain** chips, growing composer with send icon button. Ctrl/Cmd+Enter shortcuts unchanged.
- [x] Explanation dialog shows the problem title.
- [x] Unit tests and e2e updated for moved controls; screenshots looked at in both themes.

**Notes.** (2026-11-20)
- **Built.** `PracticePage.tsx` + `pages/practice.css`: the title with
  difficulty, topic, status (and source) as `Badge`s; the statement's
  Constraints section moved with the target complexity into a quiet
  Details block (`pages/practice-statement.ts`, `splitConstraints`). The
  Code pane's header: styled `Select` for the language, a faint save state,
  **Run** (secondary, play icon, shortcut in the tooltip) and **Submit**
  (primary), and a `Menu` "More" with **Give up** / **Reference** and
  **Reset** (with icons). `ResultsPanel.tsx`: a sticky summary bar (icon,
  "N/M passed", run kind, duration), failing tests first and open, passing
  ones a line with an input preview that opens on click, an Input /
  Expected / Got grid with expected and got tinted, hidden tests as "Hidden
  test: <category>" and the hidden failures named in a sentence. `chat/`:
  new shared `MessageList` and `Composer` (auto-growing text area with the
  Send/Stop icon button inside, Enter to send, an `extra` slot), used by
  `ChatPane` with a `Segmented` thread switch, an icon **New chat**, Hint /
  Review / Explain as chips above the composer; `MessageView` restyled
  (accent-subtle user bubbles, unboxed tutor text, faint chips with lucide
  icons); `chat.css` rewritten. `ExplanationViewer`: header with the
  problem's title (passed in, or looked up with `problems:get`), version
  `Select`, icon **Close**. Tests: `Composer.test.tsx` (2), and new cases in
  `ResultsPanel.test.tsx` (collapse/open, summary bar, order),
  `PracticePage.test.tsx` (header, pills and Details; More menu with Reset
  and Give up; `splitConstraints`) and `ChatPane.test.tsx` (explanation
  title).
- **Decisions.** D-51.
- **Wiring outside Owns.** `explanation/ExplanationList.tsx` passes the
  title to the viewer; `explanation/explanation.css` styles the new header.
  e2e: `practice.e2e.ts` looks for "Hidden test:" (was "Hidden ·");
  `tutor.e2e.ts` and `library.e2e.ts` check tool chips by `data-state`
  instead of a leading "✓". `docs/guide/getting-started.md`: Give up and
  Reset are in the **More** menu. `styles.css` untouched.
- **Checked.** `npm run typecheck`, `npm run lint`, `npm run format:check`,
  `npm test` (81 files, 1125 passed, 12 skipped), `npm run
  validate:content` (50 problems), `xvfb-run -a npm run e2e`: all six
  suites `failures: []` (v1 and practice in the full run; tutor and library
  failed there on the chip check, then passed after the fix, run with
  settings and intake as the rest of the chain). `e2e/screenshots.ts` run
  to a scratch folder: its selectors still work. The Practice page looked
  at in light and dark at 1440×880 and 1000×760 (fresh, after Submit with a
  hidden failure and a hint, after a failing Run, the More menu open, the
  General thread, the explanation dialog) with a scratch script (not
  committed); fixed the Details text size, the tutor header wrapping at
  1000px and failing tests sorting below passing ones.
- **Not done / not tested.** The Library's chats pane still uses its own
  list and composer markup (T32 moves it onto `MessageList` and
  `Composer`; `chat.css` keeps the old rules for it). The narrow layout
  (under 900px, stacked tabs) was not looked at. The give-up and reference
  dialogs keep the shared modal look (T33). `npm run check:security` not
  run (needs `--no-sandbox` as root here; no main-process change).
  macOS (⌘ shortcut text) and Windows not seen; not checked in a packaged
  build. `docs/assets/screenshots/` not retaken (T34).

### T31 — Home dashboard, Problems and Progress refresh

- Milestone: design
- Spec: §8, §15.6 (behaviour unchanged); target look in [`design.md`](design.md)
- Size: 2d
- Depends on: T29
- Owns: `pages/HomePage.tsx`, `pages/ProblemsPage.tsx`, `pages/ProgressPage.tsx`, `pages/home.css`, `pages/problems.css`, `pages/progress.css` (new); read-only use of existing IPC (add a call only if the dashboard truly needs data that is not exposed, and list it in Notes)

**Goal.** `design.md` → Home, Problems, Progress.

**Acceptance.**
- [x] Home: Continue card (or an empty state), Recommended next, progress summary, tutor chat card.
- [x] Problems: toolbar with search icon and styled filters; clickable rows with hover; status icons, difficulty dots; Source column only when sources differ; sticky header; keyboard access to rows kept (links or buttons, not bare `div`s).
- [x] Progress: stat tiles; balanced topic grid; one compact row per topic with a segmented bar; zero counts hidden.
- [x] Tests updated; screenshots looked at in both themes.

**Notes.** (2026-11-20)
- **Built.** Home (`HomePage.tsx`, `home.css`): heading and subtitle, a
  **Continue** card (latest open attempt: title, topic, difficulty dot,
  "Started 5 min ago" with the date as tooltip, hints, **Resume**; other open
  attempts listed under it; an empty state with an icon and one line), a
  **Recommended next** card (the pick's title or "A new … problem", topic,
  difficulty, the reason as a sentence, **Start** / **Create it** running
  the usual Next problem flow, **Browse problems**), a one-line progress
  summary (comfortable, learning, not started, problems solved, **All
  topics**) and the general tutor chat in a card sized to fill a 880px
  window. Problems (`ProblemsPage.tsx`, `problems.css`): toolbar with a
  search box with its icon inside, `ui/Select` filters whose options show
  counts, **Clear** as a ghost button, the count on the right; a table on a
  card with a sticky header, rows that open the problem on click with a
  hover fill, titles as real links in `--text` weight 500 without underline,
  status icons with visually hidden labels, difficulty as dot + word, and
  Source (column and filter) only when sources differ. Progress
  (`ProgressPage.tsx`, `progress.css`): four stat tiles, a legend, topic
  groups as cards balanced by CSS columns, one compact row per topic (name,
  non-zero counts, level badge, a segmented unaided / with help / tried
  bar), active problems and the recent attempts table restyled with outcome
  badges. Shared: `pages/dashboard.ts` (pure helpers), `pages/problem-bits.tsx`
  and `problem-bits.css` (difficulty dot, status icon). Tests:
  `pages/dashboard.test.tsx` (12: helpers, Home fresh and in progress, the
  preview call, no pick; Problems icons, counts, row click, Source column;
  Progress tiles, rows, zero counts hidden, bar label) and
  `main/ipc/handlers/practice.test.ts` (2: `preview` is a dry run, a bad
  `preview` is refused).
- **Decisions.** D-52.
- **Wiring outside Owns.** IPC: `shared/practice.ts` `nextRequest` gained
  `preview?: boolean`, and `main/ipc/handlers/practice.ts` passes it as
  core's `dryRun` (needed for Recommended next; read-only, no test data
  involved). e2e: `practice.e2e.ts` and `v1.e2e.ts` read the topic counts
  (`data-testid="topic-counts"`: "1 unaided", "1 with help") instead of the
  old "1/3 unaided · 1 solved" text. `docs/guide/getting-started.md`: two
  paragraphs for the new Home, Problems filters and Progress bars.
  `styles.css` not touched.
- **Checked.** `npm run typecheck`, `npm run lint`, `npm run format:check`
  (only the uncommitted scratch tour script flagged), `npm test` (83 files,
  1139 passed, 12 skipped), `npm run validate:content` (50 problems),
  `xvfb-run -a npm run e2e` (all six suites `failures: []`, after rebasing
  on T30), the security check by hand (`electron
  out/main/security-check.js --no-sandbox` under xvfb, `failures: []`,
  before the rebase). Screenshots (scratch script, not committed) of Home
  fresh and with a problem in progress plus one solved and one given up,
  Problems (top, scrolled with the sticky header and a hovered row),
  Progress fresh and with data, at 1440×880 and 1000px wide, light and dark;
  fixed what they showed (the header stuck below the page padding, the
  search icon over the placeholder, uneven bar widths, the separator
  replacing the difficulty dot, the chat pushing the composer off screen).
- **Not done / not tested.** Not seen on macOS or Windows, in a packaged
  build, or below 1000px wide (the cards stack under 760px, the tiles go
  two by two under 900px; not looked at). "Last activity" on Continue is
  the attempt's start time (no later time is exposed). Home's relative time
  is a local helper until T33's shared formatter lands. Active problems and
  Recent attempts on Progress still show slugs, not titles (the attempts
  data has no title; the e2e tests click the slug). The unused
  `.problem-table`, `.filters` and `.topic-*` rules in `styles.css` are left
  for T34. `docs/assets/screenshots/` not retaken (T34).

### T32 — Library refresh

- Milestone: design
- Spec: §8, §15.6 (behaviour unchanged); target look in [`design.md`](design.md)
- Size: 2d
- Depends on: T30
- Owns: `pages/LibraryPage.tsx`, `library/` (including `library/chat/`), `pages/library.css` (new)

**Goal.** `design.md` → Library, reusing T30's chat components.

**Acceptance.**
- [x] Tree with chevrons, icons, guides, selected row style; header with filter and icon buttons.
- [x] Reader typography (16–17px, ~70ch), source domain with external icon, callouts with icons, **Ask** on hover/focus only (still reachable by keyboard).
- [x] Chats pane: relative times with full date tooltip; icon buttons for Rename / New chat / Close; Practice's message and composer styles.
- [x] Library e2e passes; screenshots looked at in both themes.

**Notes.** (2026-11-20)
- **Built.** `library/LibraryTree.tsx`: folders as buttons with
  `aria-expanded`, a turning chevron and open/closed folder icons (no
  `<details>`), articles as links with a file icon, indent guides, the open
  article as an accent-subtle row; a typed filter shows matching folders
  open. `pages/LibraryPage.tsx`: **Write an article** and **Refresh** as icon
  buttons in the Articles header (Refresh spins while it runs), the filter
  with a search icon in a sticky row, quieter empty panes;
  `library/WriteArticle.tsx` is opened from the header, with `Select`s,
  `Button`s and capitalised option labels. `library/Reader.tsx`: source as
  its domain with an external-link icon (`library/source-label.ts`; full URL
  in `title`/`href`, opening still through `library:open-link`), AI-written
  and tags as `Badge`s, the "file missing" banner with an icon.
  `pages/library.css` (new): 16px body, line height 1.7, 70ch measure,
  heading scale, code blocks, tables, tinted callouts with lucide icons as
  CSS masks (note/info, warning, danger, tip, success, question, quote),
  image placeholders with an icon, banners. `library/chat/PassageLayer.tsx`:
  a heading's **Ask** (icon + text) shows only while the pointer is over that
  heading or the button, or on keyboard focus; **Ask about this** with an
  icon; accent margin markers with a wider hit area.
  `library/chat/ArticleChatPane.tsx`: on `MessageList` and `Composer`;
  thread rows with title, relative time (`relativeDate`, `fullDate` tooltip,
  from T33's `lib/format.ts`) and a two-line passage snippet; **Rename**,
  **New chat**, **Close** as icon buttons; **Make a problem from this** as a
  chip above the composer; provider notice, passage quote, "passed the
  self-check" note restyled; test ids unchanged. `linked-images.tsx`: Load
  images / Retry as small secondary buttons. `chat.css`: `.chat-head`,
  `.small-button`, `.chat-compose` removed. Tests: tree folding and the
  open article, source label, Write an article from the header
  (`LibraryPage.test.tsx`); heading Ask on hover, thread times and icon
  buttons (`ArticleChat.test.tsx`).
- **Decisions.** D-54.
- **Wiring outside Owns.** `chat/chat.css` (the three old rules removed);
  `docs/guide/library.md` (where Refresh and Write an article are, folding
  folders, Ask on hover, the chat list's times and buttons).
  `e2e/library.e2e.ts` and `e2e/screenshots.ts` needed no change (names and
  test ids kept). `styles.css` untouched.
- **Checked.** After rebasing on T31 and T33: `npm run typecheck`, `npm run
  lint`, `npm run format:check`, `npm test` (84 files, 1153 passed, 12
  skipped), `npm run validate:content` (50 problems), `xvfb-run -a npm run
  e2e` (all six suites `failures: []`, including the Library's "every
  request the page made was tutor-app://"). The Library looked at in light
  and dark at 1440×880 and 1000×760 with a scratch script (not committed):
  tree, reader with callouts, code and a table, heading Ask on hover, a
  selection, the provider notice, a chat thread, the thread list, the empty
  chats state, an article with a local image and two placeholders, the
  Write form, the file-missing banners; fixed the callout title spacing, the
  Write button's pressed state, the "Chats" title hidden in a narrow pane
  and the cut-off **Make a problem from this**.
- **Not done / not tested.** The T22 Library rules in `styles.css` are
  overridden by `pages/library.css`, not deleted (T34 can remove them). Which
  folders are closed is not remembered across visits. The narrow layout
  (under 900px, stacked tabs) and the minimum window size were not looked
  at; macOS and Windows not seen; not checked in a packaged build; `npm run
  check:security` not run (no main-process change).
  `docs/assets/screenshots/` not retaken (T34).

### T33 — Onboarding, Settings and dialogs refresh

- Milestone: design
- Spec: §8, §15.6 (behaviour unchanged); target look in [`design.md`](design.md)
- Size: 2d
- Depends on: T29
- Owns: `pages/OnboardingPage.tsx`, `components/ProfileForm.tsx`, `pages/Settings*.tsx`, `intake/` (dialog look only), `components/Toasts.tsx`, `lib/format.ts` (relative dates), `pages/onboarding.css`, `pages/settings.css` (new), the dialog section of `styles.css`

**Goal.** `design.md` → Onboarding, Settings, dialogs; one shared relative
date formatter used by every page that shows dates.

**Acceptance.**
- [x] Onboarding stepper with choice cards, step indicator, Back / Continue, **Use defaults and start** on every step; answers saved exactly as today.
- [x] Settings with a section list and aligned form rows; status lines as dot + text.
- [x] Dialog styling; New problem's segmented source tabs; capitalised difficulty labels.
- [x] Toasts restyled with icons.
- [x] Relative date formatter with tests; used where dates are shown (the Library chats pane may adopt it in T32).
- [x] Onboarding, settings and intake tests and e2e pass; screenshots looked at in both themes.

**Notes.** (2026-11-20)
- **Built.** Onboarding (`OnboardingPage.tsx`, `ProfileForm.tsx`
  `layout="steps"`, `pages/onboarding.css`): a centred card, one question
  per step, a five-bar step indicator with "Question n of 5", Back,
  Continue (the last step's button is still **Save and continue**), **Use
  defaults and start** on every step; choice cards for goal, experience and
  hints (real radios drawn as rings, label = card title, help line via
  `aria-describedby`); the tutor step in the same card. The answers are
  sent in one `profile:set` call as before (unit test checks the exact
  payload and that nothing is saved before the last step). Settings →
  Profile uses `layout="all"` with the same cards. Settings
  (`SettingsPage.tsx`, `SettingsRow.tsx`, `pages/settings.css`): a sticky
  section list (Tutor, Code execution, Appearance, Library, Profile, Data,
  Updates, About) with scroll-spy and jump (focuses the heading); aligned
  rows (label left, control right, help and actions under the control);
  statuses as dot + text (tutor, API key, test result, Claude Code, Python,
  runtimes, updates, folder errors); Library folders as a bordered list
  with a folder icon, **Add folder…** primary. Dialogs:
  `components/Dialog.tsx` (header with title and **Close** icon button,
  scrolling body, footer right, Escape, focus in and back) and the dialog
  section of `styles.css` (also restyles the older bare `.modal`s); New
  problem uses it, its modes are a segmented tablist, Topic and Difficulty
  side by side, Easy / Medium / Hard (values unchanged; also in the Import
  list), growing text boxes, radios in the Import list drawn as rings.
  Toasts: bottom-right, an icon per kind, an icon Dismiss button. Dates:
  `relativeDate` and `fullDate` in `lib/format.ts` (7 tests) and
  `components/RelativeTime.tsx`, used by Settings → Updates ("checked 2 min
  ago", full date as tooltip). Tests: onboarding (stepper, Back keeps
  answers, defaults on each step), Settings (section list, jump and
  `aria-current`, status as dot + words), intake (tablist, capitalised
  difficulties, close icon and Escape), `Segmented` `tabs` mode.
- **Decisions.** D-53 (scroll-spy instead of one section at a time, so no
  test or the screenshot script needs a click to reach a control;
  Appearance kept as its own section; New problem's modes as tabs, since
  "Generate" and "Import" are also the submit button's names; date rules).
- **Wiring outside Owns.** `components/Dialog.tsx`,
  `components/RelativeTime.tsx` (new, shared); `components/ui/Segmented.tsx`
  gained a `tabs` option (and a test in `ui.test.tsx`), its selected style
  covers `aria-selected`; `components/app-frame.ts` exports `backendName`;
  `e2e/practice.e2e.ts` and `e2e/v1.e2e.ts` click **Continue** through the
  steps; `SettingsPage.test.tsx` Claude Code status text (label and value
  now separate elements). `e2e/screenshots.ts` needed no change (every
  Settings section stays on the page). One rule in the dialog section of
  `styles.css` removes the resize grip from growing text boxes inside
  `.field`.
- **Checked.** `npm run typecheck`, `npm run lint`, `npm run format:check`
  (clean apart from the uncommitted scratch tour), `npm test` (82 files,
  1150 passed, 12 skipped, after rebasing on T30 and T31), `npm run
  validate:content` (50 problems), `xvfb-run -a npm run e2e` (all six
  suites, `failures: []`). A scratch tour (not committed) took onboarding
  (each step, the tutor step), a toast, New problem (Generate, Paste,
  Import) and every Settings section in light and dark at 1440×880, and
  Settings at 1000×760; fixed what they showed (inline forms' grid order,
  the 24rem cap on Settings fields, card heights, help text alignment,
  resize grips, native radios).
- **Not done / not tested.** `check:security` not run (no `webPreferences`
  change). Comfort per area is still a select per group, not a segmented
  control (keeps the combobox names the tests use). The scroll-spy was
  checked by screenshots and a unit test of jump/`aria-current`, not by an
  e2e scroll assertion; under 900px the section list wraps above the
  content (not looked at). `when()` remains for Progress (T31) and the
  Library chats (T32); the explanation version list (T30) was not changed.
  The Practice page's Give-up and Reference dialogs (T30's file) use the
  restyled `.modal` look but not `Dialog`, so they have no close icon.
  Not checked on macOS, Windows or in a packaged build; the user guide and
  `docs/assets/screenshots/` are not updated (T34).

### T34 — Design pass, screenshots and user guide

- Milestone: design
- Spec: §8, §15.6 (behaviour unchanged); target look in [`design.md`](design.md)
- Size: 1d
- Depends on: T30, T31, T32, T33
- Owns: anything needed for consistency fixes (list them), `apps/desktop/e2e/screenshots.ts`, `docs/assets/screenshots/`, `docs/guide/`, `README.md` (screenshots), `docs/design.md`

**Goal.** One consistent app: fix drift between pages, retake every
screenshot, and bring the guide in step.

**Acceptance.**
- [x] Every page reviewed in light and dark at 1440×880 and at the minimum window size; inconsistencies fixed (spacing, radii, button variants, empty states, focus rings).
- [x] Keyboard-only walk through the main flows (onboarding, practice, library, settings) works; focus visible everywhere.
- [x] `screenshots.ts` also captures Home, Problems and Settings; all screenshots retaken; README and guide updated to the new look and any moved controls.
- [x] `design.md` updated where the built app differs from the plan.
- [x] All checks and e2e pass.

**Notes.** (2026-11-21)
- **Built.** A pass over every page plus the review's punch list.
  *Narrow layout:* under 900px every pane of Practice and Library showed at
  once (`.pane`'s `display: flex` beat `hidden`); a global `[hidden]` rule
  fixes it, and `Panes` renders one tree for both layouts so crossing 900px
  keeps the editor, drafts and open chats. *Minimum window size* 800×600
  (there was none). *Dates:* `when()` and Home's `ago()` removed; Home,
  Progress, explanation versions ("Latest · just now", full date tooltip)
  and the Library chats use `RelativeTime`/`relativeDate`/`fullDate`.
  *Progress:* Active problems and Recent attempts by title (from
  `problems:list`), relative times, Active problems as a table on a card
  like Recent attempts. *Next problem toast:* "Next problem: <title>.
  <Reason>." (capitalised with `reasonText`; the New problem dialog's
  suggestion uses it too). *Dialogs:* Give up and Reference on the shared
  `Dialog` (close icon; Keep trying keeps the focus; Reference has no extra
  Close button). *Dark disabled primary:* `--accent-disabled` at 55%
  opacity (Save and test, Send). *Settings → Tutor status* says "below"
  instead of "in Settings" (`pages/settings-text.ts`). *Focus:* the code
  editor shows a ring; choice cards use the shared `--focus` outline; Ask
  moves the focus to the question box; the provider notice's Send takes
  the focus and returns it. *Dead CSS* removed from `styles.css` (old
  `.problem-table`, `.filters`, `.topic-*`, the T22 Library rules, `.kv`,
  `.summary`, `.case-note`, `.diff-*`, status/level/outcome classes,
  `.pill`, `.nav-button`, `button.big`, `.badge-crash`, `.lib-write`); the
  few properties `pages/library.css` still relied on moved there; the
  screens were compared pixel by pixel before and after (no change).
  `e2e/screenshots.ts` also takes home, problems and settings; all eight
  images retaken. Guide (getting-started: title bar, Home, Problems icons,
  narrow tabs, keyboard and the editor's Escape-then-Tab, Settings
  sections and scroll-spy; library: title bar, focus after Ask), README
  (Home, Problems, Settings images) and `design.md` (token table with
  `--accent-fg`, `--accent-disabled`, `--focus`, `--accent-ring`; focus
  rules; narrow windows; onboarding's last button; Settings scroll-spy and
  Appearance; dates; Progress tables) brought in step.
- **Decisions.** D-55.
- **Wiring / files touched.** Renderer: `App.tsx`, `components/Panes.tsx`,
  `components/Editor.tsx` (focus ring), `explanation/version.ts`,
  `ExplanationList.tsx`, `ExplanationViewer.tsx`, `intake/NewProblemDialog.tsx`,
  `library/chat/ArticleChatPane.tsx`, `lib/format.ts` (`when` removed),
  `pages/HomePage.tsx`, `ProgressPage.tsx`, `PracticePage.tsx`,
  `SettingsTutor.tsx`, `settings-text.ts` (new), `dashboard.ts`,
  `styles.css`, `chat/chat.css`, `pages/library.css`, `onboarding.css`,
  `progress.css`; tests for each. Main: `main/window.ts` (`minWidth`,
  `minHeight`) and its test. e2e: `practice`, `v1`, `settings` find a
  problem on Progress by link target, not slug text.
- **Checked.** `npm run typecheck`; `npm run lint` (clean); `npm test` (84
  files, 1156 passed, 12 skipped); `npm run validate:content` (50
  problems); `xvfb-run -a npm run e2e` (all six suites `failures: []`);
  `npx vitest run scripts/docs-links.test.ts` (20 passed); the security
  check by hand (`electron out/main/security-check.js --no-sandbox` under
  xvfb, `failures: []`). `npm run format:check` reports only files under
  the untracked `.claude/worktrees/` (old agent checkouts, not part of the
  repo); every tracked file passes. A scratch tour (not committed) took
  onboarding, Home (fresh and in progress), Problems, Practice (fresh, More
  menu, Give up, after Submit), the explanation, Progress, New problem,
  four Settings sections and the Library (tree, reader, notice, chat,
  threads, Write form) in light and dark at 1440×880 and 800×600, all
  looked at. A scratch keyboard walk (not committed) went onboarding →
  Home → Problems → Practice (Run with Ctrl+Enter, leaving the editor with
  Escape then Tab, More menu, Hint chip, composer) → Settings (Add
  folder…, every control) → Library (tree, heading Ask, notice, chat) in
  both themes, checking a focus indicator on each stop.
- **Not done / not tested.** Seen on Linux under xvfb only: macOS
  (traffic lights, ⌘ shortcut text) and Windows not seen; not checked in a
  packaged build. The keyboard walk's focus check is a heuristic (outline
  or box-shadow) plus screenshots: the date input's internal segments and
  the menu items (a filled row, by design) were not flagged as rings.
  Under 900px Settings' section list wraps above the sections and is not
  sticky. The Settings screenshot shows the "no system keyring" warning,
  as xvfb has none. Comfort per area is still a select per group (T33).

### T35 — Collapsible panes and pane shortcuts

- Milestone: design
- Spec: §8 (behaviour unchanged); look in [`design.md`](design.md) → App frame
- Size: 1d
- Depends on: T34
- Owns: `components/Panes.tsx`, `components/PaneHeader.tsx`, `components/pane-control.ts`, `components/ResultsPanel.tsx`, their tests, pane and results CSS, `docs/guide/getting-started.md`

**Goal.** Give the editor and the reader room: the side panes (Problem and
Tutor; Articles and Chats) and the test results can be hidden, by button
and by keyboard, and the keyboard moves between panes.

**Acceptance.**
- [x] Each side pane's header ends with a collapse button (also in panes that draw their own header, the Tutor and the Library's chats); a collapsed pane is a thin rail that opens it again. State is remembered per page; content stays mounted (drafts survive).
- [x] The Practice results fold to their first line with a button at its end.
- [x] Ctrl/Cmd+B and Ctrl/Cmd+Alt+B toggle the left and right panes, Ctrl/Cmd+J the results; Ctrl/Cmd+1–3 go to a pane (opening it); F6/Shift+F6 cycle. Keys a focused control already handled are left alone.
- [x] Tests; guide, design.md and CHANGELOG updated.

**Notes.** (2026-11-21)
- **Built.** `Panes` keeps a `<storageKey>-collapsed` pair in
  `localStorage`; a collapsed side pane is a `--pane-rail-w` (36px) grid
  column holding a rail button, with the pane's content kept in a hidden
  `.pane-inner`. The divider beside a rail is a plain line. `PaneHeader`
  reads a `PaneControlContext` from `Panes` and appends the collapse
  button, so own-header panes need no change. Going to a pane focuses its
  editor or text box, else its scrolling body; collapsing the pane with
  focus moves focus to the middle pane. Narrow (tabs) layout ignores
  collapsing; there Ctrl/Cmd+1–3 and F6 switch tabs. `ResultsPanel` takes
  `collapsed`/`onToggle`; Practice stores `results-collapsed`. The results
  summary's pass/fail colour now targets only its own icon (`> svg`).
  `PracticePage.test` clears `localStorage` before each test. D-56.
- **Checked.** typecheck, lint, `npm test` (1161 passed, 12 skipped). In
  the built app (xvfb): Ctrl+B from the editor, Ctrl+Alt+B, Ctrl+J,
  Ctrl+3 (focus to the chat box), Ctrl+1 (reopens Problem), F6 (to the
  editor), with screenshots looked at. `practice.e2e` and `library.e2e`
  pass.
- **Not done.** The Library page was not looked at in the built app (unit
  tests cover the shared `Panes`); dark mode not looked at; screenshots in
  `docs/assets/` not retaken (the default layout is unchanged, bar a small
  icon at the end of each side pane's header and the results line); the
  other e2e files not run. Home's tutor card is not collapsible (it is a card, not a pane).

### T36 — Leader key (tmux-style) for pane actions

- Milestone: design
- Spec: §4.3 (`ui.leader`); look in [`design.md`](design.md) → App frame
- Size: 1d
- Depends on: T35
- Owns: `components/leader.ts`, `components/Leader.tsx`, the leader bindings in `Panes.tsx` and `PracticePage.tsx`, `ui.leader` in core and shared settings, Settings → Appearance and editor, their tests, `docs/guide/getting-started.md`

**Goal.** Pane actions behind a leader key, as in tmux: press the leader,
let go, then one key.

**Acceptance.**
- [x] A leader key, default Ctrl+B (Ctrl on macOS too), set in Settings (`ui.leader`: Ctrl+B, Ctrl+A, Ctrl+Space, off).
- [x] It works with focus anywhere, the code editor included; neither the leader nor the key after it reaches the focused control. Escape, the leader again, an unbound key or leaving the window stop waiting; a chip shows it is waiting. Ignored while a dialog is open.
- [x] Panes: `[` `]` hide/show the side panes, `z` hides both and restores, `h`/`l` (or arrows), `o`, `1`–`3` move between panes. Practice: `t` results, `j`/`k` (or arrows) results/editor, `r` Run, `s` Submit. `?` lists the actions of the page.
- [x] T35's direct Ctrl/Cmd+B and Ctrl/Cmd+Alt+B removed (Ctrl+B is now the leader); Ctrl/Cmd+J, Ctrl/Cmd+1–3 and F6 kept.
- [x] Tests; guide, SPEC §4.3, design.md, CHANGELOG updated.

**Notes.** (2026-11-21)
- **Built.** `LeaderProvider` (around the app, reading `ui.leader`; tests
  use `LeaderKeys` with the setting given) listens on `window` in the
  capture phase, so it sees the keys before CodeMirror and stops them
  there. Pages add actions with `useLeaderBindings`, read when a key comes;
  a later registration wins a shared key. `ResultsPanel`'s section takes
  focus (`tabIndex -1`) for leader `j`. Collapse tooltips show the leader
  keys ("Hide Problem (Ctrl+B [)"), none when the leader is off. D-57.
- **Checked.** typecheck, lint, `npm test`. In the built app (xvfb):
  Ctrl+B from inside the editor then `?` (dialog), `z` (both sides hidden,
  nothing typed into the editor), `h`, `l` `l` (to the chat box), `r` (a
  run), `j` (results focused), `k` (editor), `t`; screenshots looked at.
  `settings`, `practice` and `library` e2e pass. Note: UI state in
  `localStorage` (pane sizes, what is collapsed) lives in Electron's
  profile, which the e2e runs share (`ALGOTUTOR_DATA_DIR` does not move
  it); a run left with the results collapsed made `practice.e2e` fail
  until that state was cleared.
- **Not done.** No leader repeat (tmux's `-r` keys) and no way to send
  the leader itself through (tmux's prefix twice); the leader twice just
  cancels. Keys are fixed, only the leader is configurable. Library has
  only the pane actions (none of its own). Not looked at in dark mode or
  on the Library page in the built app; the other e2e files not run.

### T37 — Library: read articles aloud

- Milestone: v3
- Spec: §15.6 (read aloud)
- Size: 1d
- Depends on: T22, T36
- Owns: `library/speech.ts`, `library/useReadAloud.ts`, `library/ReadAloudBar.tsx`, their tests, the read-aloud wiring in `LibraryPage.tsx` and `Reader.tsx`, read-aloud CSS in `library.css`, the Linux speech switch in `main/setup.ts`, `docs/guide/library.md`

**Goal.** Listen to an article: text-to-speech in the reader, with the
system's own voices, offline, the paragraph being read highlighted.

**Acceptance.**
- [x] A **Read aloud** button in the Reader's header starts reading from the top, or from the paragraph holding the selection; a bar at the bottom of the reader has back, play/pause, forward, stop, speed and voice.
- [x] The block being read is highlighted and kept in view; headings, paragraphs, list items, quotes and table cells are read, code blocks and image placeholders skipped.
- [x] Uses the Web Speech API (system voices; nothing leaves the computer); disabled with a reason when no voice is available. Voice and speed are remembered on this computer.
- [x] Stops when the article changes or the page is left; leader `p` play/pause, `x` stop, `n`/`b` next/back paragraph.
- [x] Tests; guide, SPEC §15.6, CHANGELOG updated.

**Notes.** (2026-11-21)
- **Built.** `speech.ts` finds the blocks in the rendered body (own text
  only, so a list item's sub-list is read as its own items) and chunks
  them; `useReadAloud` (on `LibraryPage`, keyed by the article) speaks one
  utterance per chunk with a generation guard against stale end/error
  events, highlights with the `speaking` class, re-finds blocks when the
  body renders again (images loaded, a rescan) keeping its place.
  `ReadAloudButton` in the Reader pane's header, `ReadAloudBar` sticky at
  the foot of the reader pane (a new `.lib-reading` flex wrapper so it sits
  at the bottom of short articles). `Reader` gained an `onBody` prop.
  Linux: `--enable-speech-dispatcher` in `beforeReady` (wiring outside
  Owns: `main/setup.ts`). D-58; SPEC §15.6 and §15.7.
- **Checked.** typecheck, lint, `npm test` (1180 passed, 12 skipped; 16
  new). In the built app (xvfb, Linux container with no speech engine):
  the switch is on, `speechSynthesis` exists with 0 voices and the button
  is disabled with the install hint. With a fake engine injected into the
  page: reading from the top, code block skipped, highlight and bar
  (screenshots looked at), pause then leader `p` resumes the same block,
  the bar goes at the end. `library.e2e` passes.
- **Not done / not tested.** Never heard with a real voice: no speech
  engine here, and not tried on macOS or Windows, so voice quality, the
  real engines' event order on cancel, and whether speech-dispatcher voices
  appear with the switch on a Linux desktop are untested. No word-level
  highlight (`onboundary` is unreliable across engines). No click to
  start at a paragraph (only the selection). Not looked at in dark mode or
  the narrow (tabs) layout; screenshots in `docs/assets/` not retaken; the
  other e2e files not run.

### T38 — Read aloud with Kokoro (GPU when faster)

- Milestone: v3
- Spec: §15.6 (read aloud), §10
- Size: 2d
- Depends on: T37
- Owns: `main/tts/`, `shared/tts.ts`, the `tts:*` channels, `library/useReadAloud.ts`, `library/ReadAloudBar.tsx`, `library/read-aloud-text.ts`, the read-aloud row in `SettingsLibrary.tsx`, `e2e/read-aloud.e2e.ts`, the onnxruntime-node entries in `electron-builder.yml`, `build/notices/{onnxruntime,espeak-ng}.txt`

**Goal.** The system voices sound poor (T37). Read with Kokoro, an
open-source neural voice, on this computer, using the GPU when it makes
Kokoro faster.

**Acceptance.**
- [x] Kokoro-82M v1.0 speaks the reader's chunks; the bar, highlight and leader keys of T37 keep working; 28 English voices, speed 0.75–2×.
- [x] The model is downloaded once, on request, with its size stated; pinned revision, SHA-256 checked, main process only; Settings → Library shows it and removes it.
- [x] The engine runs outside the main process; GPU (WebGPU / DirectML) only when timed faster than the CPU, else CPU; failures fall back to the CPU.
- [x] Packaged builds ship the native runtime for their platform only.
- [x] Tests (main and renderer); a real-model e2e; guide, SPEC, DECISIONS, CHANGELOG updated.

**Notes.** (2026-11-21)
- **Built.** `main/tts/`: `model.ts` (the pinned files and the checked,
  shared download), `text.ts` (kokoro-js's normalization and phonemes,
  ported; eSpeak NG from `phonemizer`), `engine.ts` (sessions, device
  choice by timing, inputs), `worker.ts` (the utility process), `host.ts`
  (starts it, matches replies, stops it when idle), `index.ts` (channels
  `tts:status`, `tts:speak`, `tts:remove`, stream `tts:download`).
  Renderer: `useReadAloud` now plays samples with Web Audio, prefetches
  the next chunk, pauses mid-sentence, offers the download
  (`ReadAloudOffer`); old stored system-voice prefs fall back to Heart.
  `beforeReady` no longer adds `--enable-speech-dispatcher`. `e2e-main`
  serves the model from a local folder when `ALGOTUTOR_E2E_TTS_DIR` is
  set. D-59 (D-58's voice replaced).
- **Checked.** typecheck, lint, `npm test` (1209 passed, 12 skipped; 36
  new or rewritten). The port gives the same phonemes as kokoro-js on test
  sentences (both accents). `npm run e2e:read-aloud` in the built app
  (xvfb), real model: offer, download through the app's checked download,
  real speech played (first chunk 1.7 s long, peak 0.6), highlight, pause,
  the next paragraph, Settings shows "Runs on the CPU, 3.6× faster than
  real time", Remove, no page request off the app; screenshots looked at.
  Device choice with a software Vulkan driver installed: WebGPU 0.2×, CPU
  3.9×, CPU kept; forced to the GPU it runs (slowly). A packaged Linux
  build (fuses on) loads onnxruntime from its resources and speaks.
  `check:security` and `library.e2e` pass.
- **Not done / not tested.** No real GPU here: GPU speed, DirectML and
  Metal are untested, and so is whether the WebGPU provider finds a real
  GPU on Linux desktops. Not built or run on macOS or Windows (signing of
  the native library on macOS untested). The first start times both
  devices: about 30 s on this container with a software GPU; on a machine
  without one the GPU fails at once. **eSpeak NG is GPL-3.0** inside an
  Apache-2.0-labelled package (D-59 VERIFY): decide before a release.
  English only. Guide screenshots not retaken; dark mode and the narrow
  layout not looked at.

### T39 — Read aloud: CPU by default, GPU as a setting

- Milestone: v3
- Spec: §15.6 (read aloud)
- Size: 0.5d
- Depends on: T38
- Owns: `main/tts/`, `shared/tts.ts`, `library.readAloudGpu` in core's and the app's settings, the read-aloud rows in `SettingsLibrary.tsx`, `library/read-aloud-text.ts`, `e2e/read-aloud.e2e.ts`

**Goal.** Simplify T38's device choice: run on the CPU by default, and let
the learner turn on the GPU in Settings if they have one.

**Acceptance.**
- [x] No benchmark or saved device choice; the CPU unless `library.readAloudGpu` is on.
- [x] Settings → Library → **Use the GPU** (off by default) saves the setting; the next chunk runs on the GPU, or on the CPU with "No GPU could be used" when none works.
- [x] Tests (engine, host, Settings); the real-model e2e covers both settings.

**Notes.** (2026-11-21)
- **Built.** `engine.ts` lost the benchmark, the warm-up budget,
  `GPU_MARGIN`, `device.json` and `choiceKey`; it takes `device` and
  reports `fellBack` and the speed of the last chunk. `host.ts` reads the
  setting through `device()` when it starts the process and restarts it
  between chunks when it changed (dropping the old engine info).
  `ALGO_TTS_DEVICE` is gone. New setting `library.readAloudGpu` in
  `packages/core/src/settings.ts`, `shared/settings.ts` and the settings
  view (`main/ipc/handlers/settings.ts`; wiring outside Owns), with test
  fixtures updated. D-60 (D-59's device choice replaced).
- **Checked.** typecheck, lint, `npm test`. `npm run e2e:read-aloud` with
  the real model (xvfb): first chunk now in about 5 s (was about 31 s with
  the benchmark), "Runs on the CPU, 3.6× faster than real time", the box
  off by default, ticking it saves `readAloudGpu: true`, the next read
  restarts on WebGPU (a software Vulkan driver here: "slower than real
  time"), Remove, no page request off the app.
- **Not done / not tested.** Still no real GPU here (DirectML, Metal and
  real WebGPU speed untested); macOS and Windows not built. The settings
  screenshot in the guide not retaken.

### T40 — Read aloud: download eSpeak NG instead of shipping it

- Milestone: v3
- Spec: §15.6 (read aloud)
- Size: 0.5d
- Depends on: T39
- Owns: `main/tts/`, `e2e/read-aloud.e2e.ts`, `build/notices/kokoro.txt`, the read-aloud offer in `ReadAloudBar.tsx`, `espeak-worker` in `electron.vite.config.ts`

**Goal.** eSpeak NG is GPL-3.0 and the app Apache-2.0 (D-59's VERIFY).
Don't ship it: download it with the voice and run it on its own.

**Acceptance.**
- [x] No eSpeak code in the build or the packaged app; it is a pinned, hashed file of the read-aloud download.
- [x] It runs in its own utility process that gets only text; the engine gets only phonemes.
- [x] The offer, the guide and the notices say what is downloaded and why eSpeak is separate.
- [x] Tests (model, host, engine); the real-model e2e; a packaged build speaks.

**Notes.** (2026-11-21)
- **Built.** `model.ts`: `ESPEAK_FILE` (jsDelivr, SHA-256 pinned, its own
  host only) and `urlOf`. New `espeak-worker.ts` (the eSpeak process) and
  `child.ts` (one request/reply utility process with idle stop, shared by
  both). `host.ts` runs `toPhonemes` in main with eSpeak's answers and
  sends phonemes to `worker.ts`; `engine.ts` takes phonemes (its GPU check
  uses fixed phonemes for "Ready."). `setup.ts` forks `espeak-worker.js`
  (wiring outside Owns); `e2e-main.ts` serves every download URL from the
  local folder. Notices: `espeak-ng.txt` → `kokoro.txt`. The offer's stale
  "uses the graphics card when faster" line (from T38) replaced. D-61.
- **Checked.** typecheck, lint, `npm test`. `npm run e2e:read-aloud`
  (real model and eSpeak, xvfb): no eSpeak code in `out/`, eSpeak
  downloaded and checked, speech identical to before (same length and
  peak), pause, next paragraph, the GPU setting, Remove, no page request
  off the app. `npm run package:dir` (Linux): no eSpeak code in the asar or
  resources; the packaged app speaks with the downloaded file.
- **Not done / not tested.** macOS and Windows not built (loading a
  downloaded module from a signed, notarized macOS app untested). An
  install from T38 (not released) is offered the whole download again,
  though only eSpeak's 1.3 MB is fetched. Not a lawyer's opinion: if the
  app is ever sold or relicensed, have one look.

### T41 — Read aloud: buffer chunks ahead

- Milestone: v3
- Spec: §15.6 (read aloud)
- Size: 0.25d
- Depends on: T40
- Owns: `renderer/src/library/useReadAloud.ts`, `renderer/src/library/ReadAloud.test.tsx`

**Goal.** Only one chunk was made ahead, and only once the current one
started, so on a slow CPU a pause could open between chunks and a skip
always waited for the engine. Buffer like a video player.

**Acceptance.**
- [x] While a chunk plays, the next three (`AHEAD`) are made, one request at a time.
- [x] The starts of the current and previous paragraph stay buffered; skipping to them, or forward into the buffer, makes nothing again.
- [x] Audio outside that window is dropped (memory stays at a few chunks).
- [x] Tests: buffer depth, one request in flight, skip into the buffer and back.

**Notes.** (2026-11-21)
- **Built.** `useReadAloud.ts`: `fill` walks the `AHEAD` chunks after the
  one playing, awaiting each before asking for the next, and stops when the
  generation changes (the next chunk's own fill carries on). `kept` is the
  cache window. SPEC §15.6 updated. No change in main: the engine already
  answers one request at a time, which is why the renderer keeps only one
  in flight.
- **Checked.** typecheck, lint, `npm test`. The new tests fail with
  `AHEAD = 1`.
- **Not done / not tested.** Not tried by ear with the real model (no e2e
  run). A request already sent is not cancelled on a skip, so a skip still
  waits behind at most one chunk (as before); cancelling queued requests in
  the engine would need an IPC change. The bar shows no buffered indicator.

### T42 — Library: new folder, move and delete in the tree

- Milestone: v3
- Spec: §15.1, §15.6, §15.7 (changed: the app now writes to library folders, on request)
- Size: 2d
- Depends on: T32
- Owns: `main/library/files.ts`, `main/library/service.ts`, `main/library/index-store.ts`, `main/library/scanner.ts`, `renderer/src/library/LibraryTree.tsx`, `packages/core/src/library/tree.ts`, `packages/core/src/library/files.ts`, migration `0004`

**Goal.** The Articles pane can create folders, move articles and folders
(drag and drop, and a **Move to…** menu item), and delete them (to the OS
trash), in every library folder and the tutor's folder. The maintainer
asked for this, which ends "the app never writes to the vault" (D-62).

**Acceptance.**
- [ ] **New folder** in any folder (root or subfolder); empty folders show in the tree.
- [ ] **Move** an article or folder by drag and drop, or **Move to…** from the row menu; across library folders too. Chats follow.
- [ ] **Delete** an article or folder (confirmed) moves it to the OS trash; articles with chats stay as "file missing", others leave the index. A missing article can be deleted from the tree (its chats go).
- [ ] The renderer sends ids and paths inside a folder only; main refuses `..`, absolute paths, dot names, symlinks out, overwriting, and moving a folder into itself. Root folders cannot be moved or deleted.
- [ ] AI-written is kept per article (not by folder), so a tutor article moved into a vault stays labelled.
- [ ] Tests: path checks (core), file operations on a temp folder, the index after each, the tree UI.

**Notes.**

### T43 — Write articles: a brief, a destination, and series

- Milestone: v3
- Spec: §15.1 (Write an article)
- Size: 2d
- Depends on: T42, T25
- Owns: `packages/core/src/library/generate.ts`, `main/library/generated/`, `renderer/src/library/WriteArticle.tsx`

**Goal.** **Write an article** takes a detailed brief (what to cover) and
where to save it, and can write a **series**: the tutor plans the parts,
then writes them one by one into a folder of their own, linked in order.

**Acceptance.**
- [ ] A brief of up to 4,000 characters, level, length, and a destination folder (any library folder or the tutor's folder).
- [ ] Series: 2–12 parts; the tutor plans titles and summaries (`plan_series`), then writes each part with the plan and the earlier parts' titles; saved as `01 Title.md`… in a new folder named after the series, with `series` and `part` in the frontmatter and links to the previous and next part.
- [ ] Progress per part in the dialog; Stop keeps the parts already written.
- [ ] Every file the tutor writes is labelled AI-written wherever it is saved; still no images.
- [ ] Tests: the planner and series writer with a fake backend, file names, the dialog.

**Notes.**

# Algorithm Tutor: tasks

Work breakdown for [`SPEC.md`](SPEC.md). One ticket = one branch = one agent
session. Pick the next one with the `next-ticket` skill
(`.claude/skills/next-ticket/SKILL.md`) or `node scripts/tasks.mjs next`.

## Rules for every ticket

1. Read the ticket, then the spec sections it lists, `DECISIONS.md`, and the
   parts of `CONTEXT.md` it points to. The spec is the contract: if a ticket
   needs the spec changed (an interface, a schema, a setting), change
   `SPEC.md` in the same branch and say so in the commit message.
2. Stay inside the ticket's **Owns** paths. Touch anything else only for small
   wiring changes, and list them in the done notes.
3. `packages/core` never imports Electron or Node-only modules.
4. Before finishing, run `npm run typecheck`, `npm run lint`, `npm test`, and
   `npm run validate:content` once it exists (T04), plus the ticket's own
   checks. Every acceptance criterion is checked, not assumed.
5. No test calls a real AI provider. Never commit credentials, user data, or
   recorded real AI responses.
6. Resolve every **VERIFY** the ticket touches by reading current
   documentation; record what you found in `DECISIONS.md` or the spec.
7. Report honestly: the done notes list anything not done or not tested.
8. Status lives in this file, in each ticket's `Status:` line:
   `todo` → `in-progress` → `done` (or `blocked`, with the reason in Notes).
   Update it with `node scripts/tasks.mjs set TNN <status>`.

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

- Status: todo
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
- [ ] `npm ci && npm run typecheck && npm run lint && npm test` passes locally and in CI on all three OSes.
- [ ] `npm run dev` opens a window showing the app name.
- [ ] `packages/core` has no dependency on Electron or Node built-ins (enforced by a lint rule or tsconfig `lib`/`types`).

**Notes.**

### T02 — Electron security baseline and typed IPC

- Status: todo
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
- [ ] Unit test: an IPC call with an invalid payload is rejected in main.
- [ ] Unit or e2e check that the renderer has no `require`/`process`.
- [ ] A streaming channel example with cancel works.

**Notes.**

### T03 — Problem format v2 and neutral types

- Status: todo
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
- [ ] Unit tests for the type parser (valid and invalid), value validation per type, every compare mode (port the `dsa-tutor` cases).
- [ ] The `level-lists` problem from `dsa-tutor`, hand-converted, loads and validates.

**Notes.**

### T04 — Port the curated problems and references

- Status: todo
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
- [ ] 50 problems under `content/problems/<topic>/<slug>/`, all valid.
- [ ] `npm run validate:content` passes and runs in CI.
- [ ] Any type that did not map cleanly is listed in the done notes with how it was resolved.

**Notes.**

### T05 — SQLite storage and migrations

- Status: todo
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
- [ ] Tests: fresh DB, migrate from v1 to v2 with a sample migration, refuse a newer DB, backup file created.
- [ ] Tests: invalid `settings.json` values fall back to defaults and are reported.
- [ ] Storage runs under Electron's Node (rebuild verified in CI).

**Notes.**

### T06 — Port the core teaching logic

- Status: todo
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
- [ ] Ported tests pass with an in-memory storage fake.
- [ ] `record_attempt` runs the tests itself (no pass counts from the caller).
- [ ] `get_problem` never returns hidden tests (test).

**Notes.**

### T07 — Executor interface and Pyodide execution host

- Status: todo
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
- [ ] Tests: pass, fail, runtime error, syntax error, infinite loop (timeout kills it, next job works), large output truncated.
- [ ] Test: Python code calling `js.fetch`, `open('/etc/passwd')`, `import micropip` fails or is blocked.
- [ ] Redacted report contains no hidden input/expected/actual (test).

**Notes.**

### T08 — Port the UI shell and practice flow

- Status: todo
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
- [ ] Manual and e2e smoke: next problem → edit → run shows visible results → submit records the attempt → progress updates.
- [ ] Editing the solution file in another editor updates the open editor.
- [ ] Ported UI tests pass (Vitest + Testing Library).

**Notes.**

### T09 — Onboarding and Settings

- Status: todo
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
- [ ] Changing model/effort/theme applies immediately (test or e2e).
- [ ] The key never appears in the renderer, logs, DB or settings.json (test greps the data dir after storing a known fake key).
- [ ] Export then import round-trips progress and workspace files.

**Notes.**

### T10 — Tutor: Anthropic backend and chat

- Status: todo
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
- [ ] Fake-backend tests for: explain, hint (level climbs one per press), review, run-tests tool, refusal, rate limit, auth error, cancel.
- [ ] Hidden test data never appears in any request built for the API (test inspects built requests).
- [ ] With a real key (manual), a hint turn works; noted in done notes whether it was run.

**Notes.**

### T11 — Tutor: Claude Code backend

- Status: todo
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
- [ ] Test: the spawned command leaves no built-in tool enabled.
- [ ] Test against recorded stream-json fixtures (port `tests/fixtures/claude_code/`).
- [ ] MCP token rejected after the turn ends (test).

**Notes.**

### T12 — New problems: generate, paste, import

- Status: todo
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
- [ ] Fake-backend tests for generate, paste, import, self-check failure, not-a-problem, refused import (port the intake fixtures).
- [ ] Model-written code runs only in the Pyodide executor (test: intake with the executor registry asserts which executor ran).

**Notes.**

### T13 — Packaging, auto-update and release workflow

- Status: todo
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

- Status: todo
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

- Status: todo
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

- Status: todo
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

- Status: todo
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

- Status: todo
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

- Status: todo
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

- Status: todo
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

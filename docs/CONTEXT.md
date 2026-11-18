# Context: what comes from dsa-tutor

`hqazi/dsa-tutor` is the first attempt: a Python (FastAPI) server, a React UI,
two Docker containers and a coding-agent skill. This app reuses its content,
teaching model and UI, and replaces its install, configuration and execution
model (`DECISIONS.md` D-01 to D-06).

## Getting the source

Tickets that port code or content need a checkout of `dsa-tutor` next to this
repository:

```bash
git clone https://github.com/hqazi/dsa-tutor ../dsa-tutor
```

In a Claude Code cloud session, attach it to the session first (the
`add_repo` tool) if it is not already there. Treat it as read-only: never
push to it from a ticket here.

Paths below are relative to the `dsa-tutor` root.

## Reuse map

| dsa-tutor | Here | Ticket | How |
|---|---|---|---|
| `problems/curated/<topic>/<slug>/` (50 problems: `problem.md`, `meta.json`, `tests.json`, `reference.py`) | `content/problems/` | T04 | Convert to format v2 (SPEC §5.1): `signatures.python` → neutral `signature`. Keep tests and references. |
| `references/topics.md`, `questionnaire.md`, `hint_ladder.md`, `review_rubric.md`, `problem_spec.md` | `content/references/` | T04 | Copy; replace script commands with tool names; make language-aware. |
| `SKILL.md` (rules, teaching style) | system prompt (`crates/tutor-core/src/tutor/`) | T10 | Rules and style carry over; the command table becomes the tool list. |
| `runners/python/harness.py` | `content/runners/python/` | T07 | Port; return `actual` per test, comparison moves to core. |
| `dsa_tutor/core/grading.py` (compare modes) | `crates/tutor-core/src/compare/` | T03 | Port to Rust with identical behaviour and tests. |
| `dsa_tutor/core/state.py`, `catalog.py`, `problems.py`, `common.py` | `crates/tutor-core/src/teaching/` | T06 | Port to Rust; storage becomes SQLite behind the `Storage` trait. |
| `dsa_tutor/tools/` (registry, schema, tutor tools) | `crates/tutor-core/src/tools/` | T06 | Port tool names, descriptions and schemas (SPEC §7.1). |
| `dsa_tutor/prompt.py` | `crates/tutor-core/src/tutor/` | T10 | Port. |
| `dsa_tutor/backends/anthropic.py` and its notes in `docs/SPEC.md` §5.3 | `crates/tutor-ai/` | T10 | Port to Rust (own `reqwest` client unless an official SDK exists, D-12); re-verify every note. |
| `dsa_tutor/backends/claude_code.py`, `server/mcp.py` | `crates/tutor-ai/src/claude_code/`, `crates/tutor-ai/src/mcp/` | T11 | Port after the T11 VERIFY. |
| `dsa_tutor/backends/fake.py`, `web/tests/fixtures/chat/*.sse`, `intake/*.sse` | fake backend and fixtures | T10, T12 | Port the scenarios. |
| `dsa_tutor/intake/` (jobs, prompt, open sets, Exercism index and LICENSE) | `crates/tutor-core/src/intake/`, `crates/tutor-ai/src/intake/`, `content/open-sets/` | T12 | Port; fetch stays in the backend, `raw.githubusercontent.com` only. |
| `dsa_tutor/core/explanations.py`, `assets/explanation.html`, `scripts/render_explanation.py` | explanations module | T10 | Port; versions per slug. |
| `web/src/` (React, CodeMirror 6) | `apps/desktop/ui/src/` | T08–T12 | Port components; replace `api/client.ts` and SSE with the generated Tauri command bindings and channels. |
| `tests/` (unittest), `web/tests/` (Vitest) | alongside each port | all | The old tests are the behaviour spec: port the cases. |

## Not carried over

- `Dockerfile`, `compose.yaml`, `docker/`, `dsa_tutor/runner/`,
  `dsa_tutor/executor/` (socket and local executors), `SECURITY.md`'s
  container sections: replaced by the `wasi-python` executor (SPEC §6.2) and,
  in v2, optional per-run containers (§6.5).
- `.env` configuration and `dsa_tutor/server/settings.py`: replaced by the
  Settings screen, `settings.json` and the keychain.
- The HTTP server, REST and SSE contract (`dsa_tutor/server/`): replaced by
  typed Tauri commands and channels.
- `backends/agent_cli.py`: dropped (D-07).
- `scripts/` and the skill mode: deferred (D-08).

## Lessons from dsa-tutor worth keeping

- Pass/fail only from running tests; `record_attempt` runs them itself.
- Hidden tests are reported by category only, everywhere.
- Every new problem passes a self-check (reference agrees with brute force,
  passes in time), at most 4 tries.
- Pasted and imported text is untrusted data in prompts.
- The tutor has no tool that writes the solution, reads hidden data, or
  reaches the shell, files or network.
- Its `docs/TASKS.md` worked well as one-ticket-per-agent; this repo keeps
  that, with a Progress table for status.

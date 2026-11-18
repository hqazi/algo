# Algorithm Tutor

A desktop app (Tauri 2: Rust backend, React + TypeScript UI) for practising data structures
and algorithms with an AI tutor. Second version of `hqazi/dsa-tutor`. The
project is in planning: no app code exists yet.

## Read first

- `docs/SPEC.md`: what we are building; the contract.
- `docs/TASKS.md`: the tickets, with status. One ticket per branch and session.
- `docs/DECISIONS.md`: why things are the way they are. Add an entry when you
  resolve a VERIFY or DECISION, or pin a version.
- `docs/CONTEXT.md`: what is ported from `dsa-tutor` and where it lives.

## Working on tickets

Each session works one ticket. Follow "How to work a ticket" in
`docs/TASKS.md`: pick the next ready one from its Progress table, claim it,
build, check, write done notes, then merge straight into `main` (no pull
requests).

## Ground rules

- `tutor-core` never depends on Tauri and does no I/O except through its
  traits.
- The web view gets only this app's typed commands, channels and events; no
  plugin that gives it file, shell or network access.
- Code written by the model (problem references, brute forces) runs only in
  the `wasi-python` executor (CPython on WASI in wasmtime).
- Hidden test data and expected values never leave the Rust backend.
- The API key lives only in the Rust backend and the OS keychain.
- No test calls a real AI provider. Never commit credentials or user data.
- Pass/fail always comes from running tests.
- Report honestly what was not done or not tested.

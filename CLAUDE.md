# Algo

A desktop app (Electron + React + TypeScript) for practising data structures
and algorithms with an AI tutor. Second version of `hqazi/dsa-tutor`. v1 (Python)
and v2 (Rust, Go, containers) are built; T14, the v1 release check, is
blocked. v3 adds a Library of articles (SPEC §15, tickets T21–T26). T27
polished the README and docs and renamed the app from Algorithm Tutor to
Algo (D-47). A design refresh (T28–T34, `docs/design.md`) is planned.

## Read first

- `docs/SPEC.md`: what we are building; the contract.
- `docs/TASKS.md`: the tickets, with status. One ticket per branch and session.
- `docs/DECISIONS.md`: why things are the way they are. Add an entry when you
  resolve a VERIFY or DECISION, or pin a version.
- `docs/CONTEXT.md`: what is ported from `dsa-tutor` and where it lives.
- `docs/architecture.md`: a short tour of the code.
- `docs/design.md`: the target look for the UI; read it before any UI work.
- `docs/guide/`: the user guide. Keep it in step with UI changes;
  `npm run screenshots` retakes the pictures in `docs/assets/screenshots/`.

## Working on tickets

Each session works one ticket. Follow "How to work a ticket" in
`docs/TASKS.md`: pick the next ready one from its Progress table, claim it,
build, check, write done notes, then merge straight into `main` (no pull
requests).

## Ground rules

- `packages/core` never imports Electron or Node-only modules.
- Code written by the model (problem references, brute forces) runs only in
  the Pyodide executor.
- Hidden test data never leaves the main process unredacted.
- The API key lives only in the main process and the OS keychain.
- No test calls a real AI provider. Never commit credentials or user data.
- Pass/fail always comes from running tests.
- Every npm version in `package-lock.json` is at least 14 days old (supply
  chain; D-45, D-48). Add or move a dependency only by pinning a version that
  old and running `npm install --before=<date 14 days ago> --ignore-scripts`;
  `npm run check:deps` must pass before merging.
- Report honestly what was not done or not tested.

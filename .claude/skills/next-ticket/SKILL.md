---
name: next-ticket
description: Pick up and implement the next ticket from docs/TASKS.md for the Algorithm Tutor app. Use when the user says "next ticket", "pick up the next task", "work on T07", "what's next to build", or invokes /next-ticket (optionally with a ticket id like T05).
---

# Next ticket

Takes one ticket from `docs/TASKS.md` from `todo` to `done` on its own branch.
One ticket per session. The spec (`docs/SPEC.md`) is the contract; the ticket
says which parts of it apply.

## 1. Choose the ticket

```bash
node scripts/tasks.mjs next
```

The output lists `ready` tickets (status `todo`, every dependency `done`),
`in_progress` and `blocked` ones.

- If the user named a ticket (`/next-ticket T07`), use that one. If it is not
  ready, say which dependencies are unfinished and ask whether to continue
  anyway or pick a ready one.
- If an `in_progress` ticket exists, ask whether to resume it (another session
  may own it) before starting a new one.
- Otherwise take the first ready ticket on the critical path
  (T01 → T03 → T07 → T08 → T10), else the first ready one by id. Prefer the
  current milestone (`v1` until all v1 tickets are done).
- If nothing is ready, report the in-progress and blocked tickets and stop.

Show the user the ticket (`node scripts/tasks.mjs show TNN`) in a few lines:
id, title, size, goal, acceptance criteria. Ask for a go-ahead unless the user
already said to proceed.

## 2. Branch and claim

- If the session has a designated development branch (cloud sessions do), work
  on that. Otherwise create `task/TNN-short-name` from the latest `main`.
- Claim the ticket: `node scripts/tasks.mjs set TNN in-progress`, commit
  `TNN: start` and push. A claim is only visible to sessions that read this
  branch, so when tickets run in parallel, also tell the user which ticket you
  took.

## 3. Load context

Read, in this order, and only what applies:

1. The full ticket.
2. The `docs/SPEC.md` sections in its `Spec:` line.
3. `docs/DECISIONS.md` (short; read it all).
4. The `docs/CONTEXT.md` rows for this ticket. If the ticket ports from
   `dsa-tutor`, get a read-only checkout (CONTEXT.md, "Getting the source";
   in a cloud session attach `hqazi/dsa-tutor` with `add_repo` if it is
   missing). Read the old code **and its tests**: the old tests define the
   behaviour to keep.
5. Code from finished dependency tickets that this ticket builds on.

## 4. Plan, then build

- Write a short plan (files, interfaces, tests) in a task list. Keep the plan
  inside the ticket's `Owns:` paths. Small wiring changes elsewhere are fine;
  note them.
- If the ticket has a **VERIFY**, resolve it first by reading current
  documentation (web search or fetch); don't rely on memory. Record what you
  found in `docs/DECISIONS.md` (new `D-NN` entry) or in the spec.
- If the ticket has a **DECISION** with a default, apply the default unless the
  evidence you gathered says otherwise; then record it in `DECISIONS.md` and
  tell the user. If it truly needs the owner, ask.
- If the spec is wrong or missing something the ticket needs, change
  `docs/SPEC.md` in the same branch and mention it in the commit message.
- Write tests alongside the code. Port the matching `dsa-tutor` test cases
  where they exist.
- Hard rules (from TASKS.md): `packages/core` never imports Electron or
  Node-only modules; no test calls a real AI provider; no credentials or user
  data committed; hidden test data never leaves the main process unredacted.
- Commit in small, working steps with messages starting `TNN:`.

## 5. Check

Run and fix until green:

```bash
npm run typecheck
```
```bash
npm run lint
```
```bash
npm test
```

Also run `npm run validate:content` once it exists (from T04 on) and any
check the ticket lists. Before T01 is done these scripts don't exist; T01's
job is to create them.

Go through every acceptance checkbox and confirm each one with evidence (a
test name, a command and its output, a manual check you actually did). Tick
the boxes in `docs/TASKS.md` only for criteria that are really met.

## 6. Finish

- Fill the ticket's **Notes.** with done notes: what was built, decisions
  taken, wiring changes outside `Owns:`, and plainly what was **not** done or
  not tested (e.g. "installer only tried on Linux").
- If everything is met: `node scripts/tasks.mjs set TNN done`. If something
  cannot be finished (missing access, an owner decision), set `blocked` and
  write why in Notes.
- Commit `TNN: done` (or `TNN: blocked`) and push the branch.
- Don't open a pull request unless the user asks; offer to.
- Report to the user: what was done, how it was checked, what's left, and what
  `node scripts/tasks.mjs next` now says is ready.

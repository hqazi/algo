# Problem spec (for generating problems)

Generate a problem when the user asks for a new one, or when `next_problem`
returns `"action": "generate"`. Write a spec and pass it to
`create_problem(spec)`.

The app validates the spec, fills in expected outputs from your brute force, and
runs the **self-check** in its Python sandbox: the reference solution must pass
every test within the time limit. Nothing is saved unless it passes. On
`"ok": false`, read `problems` / `failures`, fix the spec (usually a wrong
hand-written expected value or a buggy reference) and call `create_problem`
again; after four failed tries, tell the user it did not work. Never show the
problem to the user before `create_problem` succeeds. On success, call
`start_problem(slug)`.

The problem is language-neutral: the signature uses neutral types, the tests
are JSON, and the app writes the stub in whatever language the user practises
in. The reference solution and brute force are **always Python**, whatever the
user's language: they run only in the sandbox and the user never sees them
before the attempt is recorded.

## Fields

```json
{
  "slug": "busiest-hour-window",
  "title": "Busiest Hour",
  "topic": "sliding-window",
  "difficulty": "medium",
  "statement": "Markdown. What to compute, in plain words, with a small story if it helps.",
  "constraints": ["1 <= len(visits) <= 10^5", "0 <= visits[i] <= 10^4"],
  "notes": "Optional Markdown shown after the constraints (e.g. a follow-up).",
  "signature": {
    "function": "busiest_window",
    "params": [{"name": "visits", "type": "list<int>"}, {"name": "k", "type": "int"}],
    "returns": "int"
  },
  "compare": {"mode": "exact"},
  "expected_complexity": {"time": "O(n)", "space": "O(1)"},
  "tests": [
    {"visibility": "visible", "input": {"visits": [1, 3, 2], "k": 2}, "expected": 5,
     "explanation": "Optional, shown under the example."},
    {"visibility": "visible", "input": {"visits": [4], "k": 1}},
    {"visibility": "hidden", "category": "all zeros", "input": {"visits": [0, 0, 0], "k": 2}},
    {"visibility": "hidden", "category": "large input", "input": {"visits": [...], "k": 5000},
     "expected_by": "reference"}
  ],
  "reference_solution": "def busiest_window(visits, k):\n    ...\n",
  "brute_force": "def busiest_window(visits, k):\n    return max(sum(visits[i:i+k]) for i in range(len(visits)-k+1))\n"
}
```

| Field | Rules |
|---|---|
| `slug` | lowercase words joined by hyphens; must not exist yet. |
| `topic` | an id from `topics.md`. |
| `difficulty` | `easy`, `medium` (or `hard` if the user asks). Match `topics.md`. |
| `signature.function`, `params[].name` | snake_case, not a keyword. Each language's stub converts them to its own convention (`busiestWindow`, `BusiestWindow`). |
| `signature.params[].type`, `returns` | Neutral types: `int` (64-bit), `float`, `bool`, `string`, `char`, `list<T>`, `tuple<A,B,…>`, `map<string,T>` / `map<int,T>`, `optional<T>`, `tree<T>` and `linked_list<T>` (of a scalar). Express graphs with these (`list<list<int>>` adjacency or edge lists, `list<string>` grids). |
| `compare.mode` | `exact` (default), `unordered` (list order ignored; needs a `list` return), `unordered_deep` (order ignored at every level, e.g. groups of items), `float` (+ `tolerance`, default 1e-6 relative; needs a `float` in the return type). |
| `tests[].input` | an object with exactly the parameter names. Trees are level-order arrays with `null` for a missing child (`[]` for an empty tree); linked lists are arrays of values; maps with `int` keys write the keys as strings. |
| `tests[].visibility` | at least **2 visible** (shown as examples) and **3 hidden** tests. |
| `tests[].category` | required for hidden tests; it is all the user sees when one fails, so make it meaningful: `empty input`, `single element`, `duplicates`, `negative numbers`, `large input`... |
| `tests[].expected` | optional when `brute_force` is given; the brute force then computes it. Expected trees have no trailing `null`s. |
| `tests[].expected_by` | `"reference"` only for large performance tests the brute force is too slow for. Needs `brute_force` in the spec (the reference must first agree with it on every other test). |
| `reference_solution` | the optimal solution, in Python, defining the function in the signature; must pass each test within the time limit (2 s; at most a third of it for the slowest test). |
| `brute_force` | strongly recommended: a simple, obviously-correct Python solution, written differently from the reference. It makes expected values trustworthy. |

## Writing a good problem

- **Original wording.** Do not copy well-known problem statements; give it its own
  framing and names. Classic patterns are fine.
- **One clear answer.** If several answers could be valid, define a tie-break
  ("smallest index first") or use an `unordered` compare mode.
- **No hint in the statement** about the technique beyond what an interviewer
  would say. Expected complexity lives in the meta, not in the statement, unless
  the brute force is plausible and you want to rule it out ("aim for O(n)").
- **Function-based.** One function that returns a value (no in-place-only
  mutation, no classes to implement, no printing).
- **Language-neutral wording.** Write `true`, `false` and `null` (not `True` or
  `None`), "a list", "a map", "a string"; do not mention one language's library
  functions, except to rule one out ("do not use a built-in sort").
- **Inputs are JSON**: numbers, strings, booleans, lists, objects, `null`.
- **Visible tests small** (they are printed as the examples); hidden tests cover
  edge cases: empty, single, duplicates, negatives, extremes, plus 1–3 random,
  and for medium problems one `large input` test sized so the expected complexity
  passes easily and a naive approach times out (roughly n = 10^4 to 2·10^4).
- Keep the tests under ~300 KB.

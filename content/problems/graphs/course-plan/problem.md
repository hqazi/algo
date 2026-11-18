# Can You Finish Every Course?

**Topic:** Graphs · **Difficulty:** Medium

There are `courses` courses numbered `0` to `courses - 1`. Each pair `[a, b]` in
`prereqs` means course `b` must be completed **before** course `a`.

Return true if some order lets you finish every course, i.e. the prerequisites
contain no cycle.

## Examples

**Example 1**

```text
Input:  courses = 2, prereqs = [[1, 0]]
Output: true
```

**Example 2**

```text
Input:  courses = 2, prereqs = [[1, 0], [0, 1]]
Output: false
```

Each course needs the other first, so neither can start.

## Constraints

- 1 <= courses <= 10^5
- 0 <= len(prereqs) <= 10^5
- 0 <= a, b < courses

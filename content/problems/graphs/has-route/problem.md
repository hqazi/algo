# Is There a Route?

**Topic:** Graphs · **Difficulty:** Easy

There are `n` towns numbered `0` to `n - 1`. Each road `[a, b]` connects towns `a`
and `b` in both directions. Return true if you can travel from `start` to `end`.

## Examples

**Example 1**

```text
Input:  n = 4, roads = [[0, 1], [1, 2], [3, 3]], start = 0, end = 2
Output: true
```

**Example 2**

```text
Input:  n = 4, roads = [[0, 1], [2, 3]], start = 0, end = 3
Output: false
```

## Constraints

- 1 <= n <= 10^5
- 0 <= len(roads) <= 10^5
- 0 <= a, b, start, end < n

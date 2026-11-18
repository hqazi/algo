# Stepping Stones

**Topic:** Greedy · **Difficulty:** Medium

You stand on stone `0`. From stone `i` you may jump forward **up to** `jumps[i]`
stones. Return true if you can reach the last stone.

## Examples

**Example 1**

```text
Input:  jumps = [2, 3, 1, 1, 4]
Output: true
```

**Example 2**

```text
Input:  jumps = [3, 2, 1, 0, 4]
Output: false
```

Every route lands on stone 3, whose jump length is 0.

## Constraints

- 1 <= len(jumps) <= 10^5
- 0 <= jumps[i] <= 10^5

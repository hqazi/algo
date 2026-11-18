# Longest Stretch Without Repeats

**Topic:** Sliding window · **Difficulty:** Medium

Return the length of the longest substring of `s` in which **no character
repeats**.

## Examples

**Example 1**

```text
Input:  s = "abcabcbb"
Output: 3
```

`abc` is the longest stretch with no repeats.

**Example 2**

```text
Input:  s = "pwwkew"
Output: 3
```

`wke` has length 3; `pwke` is not a substring.

## Constraints

- 0 <= len(s) <= 10^5
- s contains printable ASCII characters

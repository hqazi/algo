# All Balanced Strings

**Topic:** Recursion & backtracking · **Difficulty:** Medium

Return every string made of `pairs` opening brackets `(` and `pairs` closing
brackets `)` that is **balanced**: reading left to right, the number of `)` never
exceeds the number of `(`.

The order of the strings does not matter. Build only valid strings; generating
all `2^(2·pairs)` strings and filtering is too slow for the larger cases.

## Examples

**Example 1**

```text
Input:  pairs = 2
Output: ["(())", "()()"]
```

**Example 2**

```text
Input:  pairs = 1
Output: ["()"]
```

## Constraints

- 0 <= pairs <= 11

## Notes

The order of the returned items does not matter.

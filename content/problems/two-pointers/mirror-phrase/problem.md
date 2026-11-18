# Mirror Phrase

**Topic:** Two pointers · **Difficulty:** Easy

A phrase is a **mirror phrase** if it reads the same forwards and backwards after
you drop everything except letters and digits and ignore upper/lower case.

Return true if `text` is a mirror phrase. Try to use O(1) extra space.

## Examples

**Example 1**

```text
Input:  text = "Was it a car, or a cat I saw?"
Output: true
```

**Example 2**

```text
Input:  text = "race a car"
Output: false
```

Keeping letters gives `raceacar`, which is not the same backwards.

## Constraints

- 0 <= len(text) <= 2 · 10^5
- text contains printable ASCII characters

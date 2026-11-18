# Balanced Brackets

**Topic:** Stacks · **Difficulty:** Easy

`code` contains only the characters `()[]{}`. It is **balanced** if every opening
bracket is closed by the same kind of bracket, and brackets close in the reverse
order they were opened (so `([)]` is not balanced).

Return true if `code` is balanced. The empty string is balanced.

## Examples

**Example 1**

```text
Input:  code = "{[()]}()"
Output: true
```

**Example 2**

```text
Input:  code = "([)]"
Output: false
```

`[` is opened after `(`, so it must close first.

**Example 3**

```text
Input:  code = ""
Output: true
```

## Constraints

- 0 <= len(code) <= 10^5
- code contains only ()[]{}

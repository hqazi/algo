# How Tall Is the Tree?

**Topic:** Binary trees · **Difficulty:** Easy

Return the **depth** of a binary tree: the number of nodes on the longest path from
the root down to a leaf. An empty tree has depth 0.

## Examples

**Example 1**

```text
Input:  root = [3, 9, 20, null, null, 15, 7]
Output: 3
```

The path 3 → 20 → 15 has three nodes.

**Example 2**

```text
Input:  root = []
Output: 0
```

## Constraints

- 0 <= number of nodes <= 10^4

## Notes

Trees are passed in as nodes; the examples write a tree as a list in level order, with `null` for a missing child.

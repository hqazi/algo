# Is It a Search Tree?

**Topic:** Binary trees · **Difficulty:** Medium

A binary tree is a **binary search tree** if, for every node, every value in its
left subtree is strictly smaller than the node's value and every value in its
right subtree is strictly larger.

Return true if the tree is a binary search tree. An empty tree is one.
Checking only each node against its children is not enough.

## Examples

**Example 1**

```text
Input:  root = [2, 1, 3]
Output: true
```

**Example 2**

```text
Input:  root = [5, 1, 4, null, null, 3, 6]
Output: false
```

4 is in the right subtree of 5 but is smaller than 5.

## Constraints

- 0 <= number of nodes <= 10^4
- -2^31 <= node.val <= 2^31 - 1

## Notes

Trees are passed in as nodes; the examples write a tree as a list in level order, with `null` for a missing child.

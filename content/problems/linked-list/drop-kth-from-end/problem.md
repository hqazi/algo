# Drop the K-th From the End

**Topic:** Linked lists · **Difficulty:** Medium

Remove the `k`-th node **counting from the end** of the list (`k = 1` is the last
node) and return the head of the resulting list. `k` is always valid.

Try to do it in one pass with two pointers. Watch out for removing the head itself.

## Examples

**Example 1**

```text
Input:  head = [1, 2, 3, 4, 5], k = 2
Output: [1, 2, 3, 5]
```

The 2nd node from the end holds 4.

**Example 2**

```text
Input:  head = [1], k = 1
Output: []
```

## Constraints

- 1 <= length <= 10^5
- 1 <= k <= length

## Notes

Linked lists are passed in and returned as nodes; the examples write a linked list as the list of its values from the head (`[]` for an empty one).

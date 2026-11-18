# Middle of the Train

**Topic:** Linked lists · **Difficulty:** Easy

Return the **middle node** of a linked list. If there are two middle nodes (even
length), return the second one. For an empty list, return an empty list (no node).

The result is checked as the list that starts at the returned node. Try to find it
in a single pass.

## Examples

**Example 1**

```text
Input:  head = [1, 2, 3, 4, 5]
Output: [3, 4, 5]
```

The middle node holds 3, so the answer is the list starting there.

**Example 2**

```text
Input:  head = [1, 2, 3, 4, 5, 6]
Output: [4, 5, 6]
```

The two middles hold 3 and 4; return the second.

## Constraints

- 0 <= length <= 10^5

## Notes

Linked lists are passed in and returned as nodes; the examples write a linked list as the list of its values from the head (`[]` for an empty one).

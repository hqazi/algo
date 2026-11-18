# Ticket Booth Change

**Topic:** Greedy · **Difficulty:** Easy

A ticket costs 5. Customers arrive in order, each buying one ticket and paying with
a single bill of 5, 10 or 20. The booth starts with **no money** and can only give
change from bills it has received.

Return true if every customer can get correct change.

## Examples

**Example 1**

```text
Input:  bills = [5, 5, 5, 10, 20]
Output: true
```

**Example 2**

```text
Input:  bills = [5, 5, 10, 10, 20]
Output: false
```

After the two 10s the booth holds two 10s and no 5s, so 15 in change is impossible.

## Constraints

- 0 <= len(bills) <= 10^5
- bills[i] is 5, 10 or 20

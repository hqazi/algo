# Fewest Coins

**Topic:** Dynamic programming · **Difficulty:** Medium

You have an unlimited supply of each coin value in `coins`. Return the **fewest
coins** that add up to exactly `amount`, or `-1` if it cannot be done.

Always taking the largest coin first does not work for every coin system.

## Examples

**Example 1**

```text
Input:  coins = [1, 2, 5], amount = 11
Output: 3
```

5 + 5 + 1.

**Example 2**

```text
Input:  coins = [2], amount = 3
Output: -1
```

**Example 3**

```text
Input:  coins = [1, 3, 4], amount = 6
Output: 2
```

Greedy takes 4 + 1 + 1, but 3 + 3 uses only two coins.

## Constraints

- 1 <= len(coins) <= 12
- 1 <= coins[i] <= 10^4
- 0 <= amount <= 10^4

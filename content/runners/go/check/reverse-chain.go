// Check solution (T15): reverse a linked list. Exercises linked_list<int> in and out.
package main

func reverseList(head *ListNode) *ListNode {
	var prev *ListNode
	for head != nil {
		next := head.Next
		head.Next = prev
		prev, head = head, next
	}
	return prev
}

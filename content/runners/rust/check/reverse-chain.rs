// Check solution (T15): reverse a linked list. Exercises linked_list<int> in and out.
use crate::nodes::ListNode;

pub fn reverse_list(head: Option<Box<ListNode>>) -> Option<Box<ListNode>> {
    let mut prev = None;
    let mut node = head;
    while let Some(mut n) = node {
        node = n.next.take();
        n.next = prev;
        prev = Some(n);
    }
    prev
}

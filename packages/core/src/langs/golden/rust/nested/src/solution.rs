// Title
//
// Instructions.
//
// Provided by the harness (do not define it yourself):
//
// pub struct ListNode {
//     pub val: String,
//     pub next: Option<Box<ListNode>>,
// }
//
// impl ListNode {
//     pub fn new(val: String) -> Self {
//         ListNode { next: None, val }
//     }
// }
//
// pub struct TreeNode {
//     pub val: char,
//     pub left: Option<Rc<RefCell<TreeNode>>>,
//     pub right: Option<Rc<RefCell<TreeNode>>>,
// }
//
// impl TreeNode {
//     pub fn new(val: char) -> Self {
//         TreeNode { val, left: None, right: None }
//     }
// }

use crate::nodes::ListNode;
use crate::nodes::TreeNode;
use std::cell::RefCell;
use std::rc::Rc;

pub fn walk_forest(forest: Vec<Option<Rc<RefCell<TreeNode>>>>, path: Option<Option<Box<ListNode>>>) -> Option<Vec<(i64, i64)>> {
    todo!()
}

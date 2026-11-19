// Title
//
// Instructions.
//
// Provided by the harness (do not define it yourself):
//
// pub struct TreeNode {
//     pub val: i64,
//     pub left: Option<Rc<RefCell<TreeNode>>>,
//     pub right: Option<Rc<RefCell<TreeNode>>>,
// }
//
// impl TreeNode {
//     pub fn new(val: i64) -> Self {
//         TreeNode { val, left: None, right: None }
//     }
// }

use crate::nodes::TreeNode;
use std::cell::RefCell;
use std::rc::Rc;

pub fn levels(root: Option<Rc<RefCell<TreeNode>>>) -> Vec<Vec<i64>> {
    todo!()
}

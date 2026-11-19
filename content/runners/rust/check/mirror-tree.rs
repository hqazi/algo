// Check solution (T15): mirror a binary tree. Exercises tree<int> in and out.
use crate::nodes::TreeNode;
use std::cell::RefCell;
use std::rc::Rc;

pub fn mirror(root: Option<Rc<RefCell<TreeNode>>>) -> Option<Rc<RefCell<TreeNode>>> {
    if let Some(node) = &root {
        let mut n = node.borrow_mut();
        let left = n.left.take();
        let right = n.right.take();
        n.left = mirror(right);
        n.right = mirror(left);
    }
    root
}

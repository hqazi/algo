// Check solution (T15): mirror a binary tree. Exercises tree<int> in and out.
package main

func mirror(root *TreeNode) *TreeNode {
	if root == nil {
		return nil
	}
	root.Left, root.Right = mirror(root.Right), mirror(root.Left)
	return root
}

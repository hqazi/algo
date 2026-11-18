"""Regenerate dsa-tutor-cases.json from the original compare() in dsa-tutor.

    python3 gen-dsa-tutor-cases.py path/to/dsa-tutor > dsa-tutor-cases.json

Each case records what dsa-tutor's compare() returned; compare.test.ts checks
the TypeScript port gives the same answer.
"""
import json, sys
sys.path.insert(0, sys.argv[1])
from dsa_tutor.core.grading import compare

E = {"mode": "exact"}; U = {"mode": "unordered"}; D = {"mode": "unordered_deep"}
F = {"mode": "float"}; F3 = {"mode": "float", "tolerance": 1e-3}
cases = [
  # exact: scalars
  ("int equal", 3, 3, E), ("int differs", 3, 4, E), ("int vs float same value", 2, 2.0, E),
  ("float exact differs slightly", 0.1 + 0.2, 0.3, E),
  ("bool equal", True, True, E), ("bool differs", True, False, E),
  ("true is not 1", True, 1, E), ("1 is not true", 1, True, E), ("false is not 0", False, 0, E),
  ("string equal", "abc", "abc", E), ("string differs", "abc", "abd", E),
  ("string vs number", "1", 1, E), ("null equal", None, None, E), ("null vs 0", None, 0, E),
  ("null vs empty list", None, [], E), ("missing spec is exact", [1, 2], [2, 1], None),
  # exact: containers
  ("list equal", [1, [2, 3]], [1, [2, 3]], E), ("list order matters", [1, 2], [2, 1], E),
  ("list length differs", [1, 2], [1, 2, 3], E), ("list vs object", [], {}, E),
  ("object equal any key order", {"a": 1, "b": [1]}, {"b": [1], "a": 1}, E),
  ("object extra key", {"a": 1, "b": 2}, {"a": 1}, E), ("object missing key", {"a": 1}, {"a": 1, "b": 2}, E),
  ("object value differs", {"a": 1}, {"a": 2}, E), ("nested bool vs int", [True], [1], E),
  # unordered
  ("unordered permutation", [3, 1, 2], [1, 2, 3], U), ("unordered duplicates count", [1, 1, 2], [1, 2, 2], U),
  ("unordered length differs", [1, 2], [1, 2, 2], U), ("unordered strings", ["b", "a"], ["a", "b"], U),
  ("unordered top level only", [[2, 1], [3]], [[3], [1, 2]], U), ("unordered whole items", [[1, 2], [3]], [[3], [1, 2]], U),
  ("unordered mixed types", [1, "1", None, True], [True, None, "1", 1], U),
  ("unordered objects", [{"a": 1, "b": 2}, {"a": 0}], [{"a": 0}, {"b": 2, "a": 1}], U),
  ("unordered non-list falls back to exact", 5, 5, U), ("unordered non-list differs", "ab", "ba", U),
  ("unordered list vs non-list", [1], 1, U), ("unordered bool vs int items", [True, 0], [1, 0], U),
  # unordered_deep
  ("deep nested permutation", [[2, 1], [3]], [[3], [1, 2]], D),
  ("deep subsets", [[], [2], [1], [1, 2]], [[], [1], [2], [2, 1]], D),
  ("deep three levels", [[[2, 1]], [[0]]], [[[0]], [[1, 2]]], D),
  ("deep inner multiplicity", [[1, 1, 2]], [[1, 2, 2]], D),
  ("deep lists inside objects keep order", [{"k": [2, 1]}], [{"k": [1, 2]}], D),
  ("deep objects in any order", [{"k": [1]}, {"j": 2}], [{"j": 2}, {"k": [1]}], D),
  ("deep group anagrams", [["tea", "eat"], ["bat"]], [["bat"], ["eat", "tea"]], D),
  ("deep different groups", [["a", "b"], ["c"]], [["a"], ["b", "c"]], D),
  ("deep non-list exact", 1, 1, D),
  # float
  ("float within default tol", 1.0000001, 1.0, F), ("float outside default tol", 1.00001, 1.0, F),
  ("float relative to expected", 1000000.5, 1000000.0, F), ("float relative outside", 1000002.0, 1000000.0, F),
  ("float small absolute floor", 1e-7, 0.0, F), ("float small absolute outside", 2e-6, 0.0, F),
  ("float custom tolerance inside", 1.0009, 1.0, F3), ("float custom tolerance outside", 1.002, 1.0, F3),
  ("float in lists", [0.1 + 0.2, 1.0], [0.3, 1.0], F), ("float in objects", {"x": 0.1 + 0.2}, {"x": 0.3}, F),
  ("float int values", 3, 3, F), ("float bool still strict", True, 1, F),
  ("float order matters", [1.0, 2.0], [2.0, 1.0], F), ("float negative", -2.0000001, -2.0, F),
  ("float exact boundary", 1.5, 1.0, {"mode": "float", "tolerance": 0.5}),
  ("exact ignores tolerance", 1.0000001, 1.0, {"mode": "exact", "tolerance": 0.5}),
]
out = [{"name": n, "actual": a, "expected": b, "spec": s, "equal": compare(a, b, s)} for n, a, b, s in cases]
json.dump({"source": "dsa-tutor dsa_tutor/core/grading.py compare(); regenerate with gen-dsa-tutor-cases.py",
           "cases": out}, sys.stdout, indent=2)

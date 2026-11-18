"""Python harness: run a solution function on test inputs (SPEC §6.1, §6.2).

Ported from dsa-tutor's runners/python/harness.py. It runs inside Pyodide in
the execution host's worker, which calls it directly instead of reading a
stdout protocol:

    h = make_harness(spec_json)   # function name, parameter and return types
    h.load(code)                  # -> JSON: {"ok": true} or {"ok": false, error...}
    h.run(input_json)             # -> JSON: one result per call

The harness never compares results: core does that, so every language grades
the same way and expected values never reach the solution. Types are the
neutral types from the signature, already parsed into JSON objects such as
{"kind": "tree", "of": {"kind": "int"}}. Values travel as JSON text, so
64-bit integers stay exact.

Results:
    {"status": "ok", "actual_json": "...", "time_ms": t, "stdout": "...", "stdout_dropped": n}
    {"status": "error", "error_type": "...", "message": "...", "line": n, "time_ms": t, "stdout": ..., "stdout_dropped": n}
"""
from __future__ import annotations

import io
import json
import math
import sys
import time
import traceback
from collections import deque

SOLUTION_FILE = "solution.py"
STDOUT_LIMIT = 2000
MESSAGE_LIMIT = 500
ACTUAL_LIMIT = 16 * 1024 * 1024
RECURSION_LIMIT = 100_000
LIST_LIMIT = 10_000_000

# Modules a solution may not import: package installation, HTTP, and the
# bridges back into JavaScript (DECISIONS D-14).
BLOCKED_MODULES = ("micropip", "pyodide_js", "pyodide.http", "pyodide.code", "pyodide.webloop")


class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next


class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right


# ---------------------------------------------------------------- guards

class _Blocker:
    """A meta path finder that refuses the blocked modules."""

    def find_spec(self, name, path=None, target=None):
        if any(name == b or name.startswith(b + ".") for b in BLOCKED_MODULES):
            raise ImportError(f"{name} is not available when running solutions")
        return None


def install_guards():
    sys.meta_path.insert(0, _Blocker())
    for name in list(sys.modules):
        if any(name == b or name.startswith(b + ".") for b in BLOCKED_MODULES):
            del sys.modules[name]
    pyodide = sys.modules.get("pyodide")
    for attr in ("http", "code", "webloop"):
        if pyodide is not None and hasattr(pyodide, attr):
            try:
                delattr(pyodide, attr)
            except AttributeError:
                pass
    sys.stdin = io.StringIO("")
    sys.setrecursionlimit(RECURSION_LIMIT)


# ---------------------------------------------------------------- output capture

class Capture(io.TextIOBase):
    """Collects what a solution prints, keeping only the last STDOUT_LIMIT characters."""

    def __init__(self):
        self._parts = deque()
        self._size = 0
        self.dropped = 0

    def writable(self):
        return True

    def write(self, s):
        if not isinstance(s, str):
            raise TypeError(f"write() argument must be str, not {type(s).__name__}")
        self._parts.append(s)
        self._size += len(s)
        if self._size > 2 * STDOUT_LIMIT:
            text = "".join(self._parts)
            keep = text[-STDOUT_LIMIT:]
            self.dropped += len(text) - len(keep)
            self._parts = deque([keep])
            self._size = len(keep)
        return len(s)

    def text(self):
        text = "".join(self._parts)
        if len(text) > STDOUT_LIMIT:
            self.dropped += len(text) - STDOUT_LIMIT
            text = text[-STDOUT_LIMIT:]
        return text


# ---------------------------------------------------------------- conversion

def build_list(values, cls):
    head = None
    for v in reversed(values or []):
        head = cls(v, head)
    return head


def build_tree(values, cls):
    if not values or values[0] is None:
        return None
    root = cls(values[0])
    queue = deque([root])
    i = 1
    while queue and i < len(values):
        node = queue.popleft()
        if i < len(values) and values[i] is not None:
            node.left = cls(values[i])
            queue.append(node.left)
        i += 1
        if i < len(values) and values[i] is not None:
            node.right = cls(values[i])
            queue.append(node.right)
        i += 1
    return root


def list_to_json(node):
    out = []
    while node is not None:
        out.append(plain(node.val))
        node = node.next
        if len(out) > LIST_LIMIT:
            raise ValueError("linked list is too long (cycle?)")
    return out


def tree_to_json(root):
    if root is None:
        return []
    out, queue = [], deque([root])
    while queue:
        node = queue.popleft()
        if node is None:
            out.append(None)
            continue
        out.append(plain(node.val))
        queue.append(node.left)
        queue.append(node.right)
        if len(out) > LIST_LIMIT:
            raise ValueError("tree is too large (cycle?)")
    while out and out[-1] is None:
        out.pop()
    return out


def convert_in(value, t, ns):
    """JSON value -> the Python value a solution receives, by neutral type."""
    kind = t["kind"]
    if value is None:
        return None
    if kind == "float":
        return float(value)
    if kind == "list":
        return [convert_in(v, t["of"], ns) for v in value]
    if kind == "tuple":
        return tuple(convert_in(v, it, ns) for v, it in zip(value, t["items"]))
    if kind == "map":
        key = int if t["key"] == "int" else str
        return {key(k): convert_in(v, t["value"], ns) for k, v in value.items()}
    if kind == "optional":
        return convert_in(value, t["of"], ns)
    if kind == "tree":
        return build_tree(value, ns.get("TreeNode", TreeNode))
    if kind == "linked_list":
        return build_list(value, ns.get("ListNode", ListNode))
    return value


def convert_out(value, t):
    """A solution's return value -> JSON value, by neutral type."""
    kind = t["kind"]
    if value is None:
        if kind == "tree" or kind == "linked_list":
            return []
        return None
    if kind == "tree" and _is_tree(value):
        return tree_to_json(value)
    if kind == "linked_list" and _is_list_node(value):
        return list_to_json(value)
    if kind == "list" and isinstance(value, (list, tuple)):
        return [convert_out(v, t["of"]) for v in value]
    if kind == "tuple" and isinstance(value, (list, tuple)) and len(value) == len(t["items"]):
        return [convert_out(v, it) for v, it in zip(value, t["items"])]
    if kind == "map" and isinstance(value, dict):
        return {str(k): convert_out(v, t["value"]) for k, v in value.items()}
    if kind == "optional":
        return convert_out(value, t["of"])
    return plain(value)


def _is_list_node(v):
    return hasattr(v, "val") and hasattr(v, "next")


def _is_tree(v):
    return hasattr(v, "val") and hasattr(v, "left") and hasattr(v, "right")


def plain(value):
    """Any value -> JSON value, without type information (as in dsa-tutor)."""
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return str(value)
        return value
    if isinstance(value, (list, tuple)):
        return [plain(v) for v in value]
    if isinstance(value, (set, frozenset)):
        items = [plain(v) for v in value]
        try:
            return sorted(items)
        except TypeError:
            return sorted(items, key=lambda v: json.dumps(v, sort_keys=True))
    if isinstance(value, dict):
        return {str(k): plain(v) for k, v in value.items()}
    if _is_list_node(value):
        return list_to_json(value)
    if _is_tree(value):
        return tree_to_json(value)
    raise TypeError(f"return value of type {type(value).__name__} cannot be turned into JSON")


# ---------------------------------------------------------------- running

def error_info(exc):
    """Exception type, message, and the last line in the solution it passed through."""
    line = None
    for frame in traceback.extract_tb(exc.__traceback__):
        if frame.filename == SOLUTION_FILE:
            line = frame.lineno
    if isinstance(exc, SyntaxError) and exc.filename == SOLUTION_FILE and exc.lineno:
        line = exc.lineno
    message = "maximum recursion depth exceeded" if isinstance(exc, RecursionError) else str(exc)
    if isinstance(exc, SyntaxError) and exc.msg:
        message = exc.msg
    return {"error_type": type(exc).__name__, "message": message[:MESSAGE_LIMIT], "line": line}


class Harness:
    def __init__(self, spec):
        self.function = spec["function"]
        self.params = spec["params"]
        self.returns = spec["returns"]
        self.ns = None
        self.func = None

    def _capture(self):
        cap = Capture()
        sys.stdout = cap
        sys.stderr = cap
        return cap

    def _restore(self):
        sys.stdout = sys.__stdout__
        sys.stderr = sys.__stderr__

    def load(self, code):
        """Compile and run the solution module; find the function."""
        ns = {"__name__": "solution", "__file__": SOLUTION_FILE,
              "ListNode": ListNode, "TreeNode": TreeNode}
        cap = self._capture()
        try:
            exec(compile(code, SOLUTION_FILE, "exec"), ns)
            func = ns.get(self.function)
            if not callable(func):
                raise NameError(f"the solution does not define a function named {self.function!r}")
        except BaseException as exc:  # noqa: BLE001 - report anything, including SystemExit
            self._restore()
            return json.dumps({"ok": False, **error_info(exc), "stdout": cap.text(),
                               "stdout_dropped": cap.dropped})
        self._restore()
        self.ns, self.func = ns, func
        return json.dumps({"ok": True})

    def run(self, input_json):
        """Call the function on one test's inputs."""
        if self.func is None:
            raise RuntimeError("load() did not succeed")
        args = json.loads(input_json)
        cap = self._capture()
        elapsed = None
        try:
            kwargs = {p["name"]: convert_in(args[p["name"]], p["type"], self.ns) for p in self.params}
            t0 = time.perf_counter()
            result = self.func(**kwargs)
            elapsed = (time.perf_counter() - t0) * 1000
            actual_json = json.dumps(convert_out(result, self.returns), allow_nan=False)
            if len(actual_json) > ACTUAL_LIMIT:
                raise ValueError(f"the return value is too large ({len(actual_json)} characters of JSON)")
            record = {"status": "ok", "actual_json": actual_json, "time_ms": round(elapsed, 3)}
        except BaseException as exc:  # noqa: BLE001
            record = {"status": "error", **error_info(exc)}
            if elapsed is not None:
                record["time_ms"] = round(elapsed, 3)
        self._restore()
        record["stdout"] = cap.text()
        record["stdout_dropped"] = cap.dropped
        return json.dumps(record)


def make_harness(spec_json):
    return Harness(json.loads(spec_json))

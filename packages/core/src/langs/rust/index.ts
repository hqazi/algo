/**
 * Rust harness generator (SPEC §5.2, §6.4; DECISIONS D-29): from a neutral
 * signature, the stub the user sees and the generated files of a Cargo
 * project that runs it. `content/runners/rust/` holds the fixed runtime
 * (`harness.rs`, `json.rs`).
 *
 * Types: int `i64`, float `f64`, bool, string `String`, char `char`,
 * list `Vec<T>`, tuple `(A, B)`, map `HashMap<String|i64, T>`,
 * optional `Option<T>`, tree `Option<Rc<RefCell<TreeNode>>>`,
 * linked_list `Option<Box<ListNode>>` (the LeetCode shapes).
 */
import { parseType, someType, type NeutralType, type ScalarKind } from '../../types/neutral';
import type { Signature } from '../../types/signature';
import {
  compiledHarnessLimit,
  nodeElement,
  signatureTypes,
  type HarnessProject,
  type StubOptions,
} from '../common';

const KEYWORDS = new Set(
  (
    'as async await break const continue crate dyn else enum extern false fn for if impl in let ' +
    'loop match mod move mut pub ref return self static struct super trait true type unsafe use ' +
    'where while abstract become box do final macro override priv try typeof unsized virtual yield gen'
  ).split(' '),
);
/** Keywords that cannot be raw identifiers. */
const NOT_RAW = new Set(['crate', 'self', 'super']);

/** A snake_case name as a Rust identifier (`type` → `r#type`). */
export function rustName(name: string): string {
  if (NOT_RAW.has(name)) return `${name}_`;
  return KEYWORDS.has(name) ? `r#${name}` : name;
}

const SCALAR: Record<ScalarKind, string> = {
  int: 'i64',
  float: 'f64',
  bool: 'bool',
  string: 'String',
  char: 'char',
};

export function rustType(t: NeutralType): string {
  switch (t.kind) {
    case 'list':
      return `Vec<${rustType(t.of)}>`;
    case 'tuple':
      return `(${t.items.map(rustType).join(', ')})`;
    case 'map':
      return `HashMap<${t.key === 'int' ? 'i64' : 'String'}, ${rustType(t.value)}>`;
    case 'optional':
      return `Option<${rustType(t.of)}>`;
    case 'tree':
      return 'Option<Rc<RefCell<TreeNode>>>';
    case 'linked_list':
      return 'Option<Box<ListNode>>';
    default:
      return SCALAR[t.kind];
  }
}

/** Why the Rust harness cannot run `sig`, or `null`. */
export function rustUnsupported(sig: Signature): string | null {
  return compiledHarnessLimit(sig);
}

/** A callable expression `&Value -> R<T>`. */
function de(t: NeutralType): string {
  switch (t.kind) {
    case 'list':
      return `|v: &Value| de_list(v, ${de(t.of)})`;
    case 'optional':
      return `|v: &Value| de_opt(v, ${de(t.of)})`;
    case 'map':
      return `|v: &Value| de_map_${t.key === 'int' ? 'int' : 'str'}(v, ${de(t.value)})`;
    case 'tree':
      return `|v: &Value| de_tree(v, ${de(t.of)})`;
    case 'linked_list':
      return `|v: &Value| de_linked_list(v, ${de(t.of)})`;
    case 'tuple': {
      const items = t.items.map((it, i) => `(${de(it)})(&a[${i}])?`).join(', ');
      return `|v: &Value| -> R<${rustType(t)}> { let a = de_items(v, ${t.items.length})?; Ok((${items},)) }`;
    }
    default:
      return `de_${t.kind}`;
  }
}

/** A callable expression `&T -> R<Value>`. */
function ser(t: NeutralType): string {
  const ty = rustType(t);
  switch (t.kind) {
    case 'list':
      return `|x: &${ty}| ser_list(x, ${ser(t.of)})`;
    case 'optional':
      return `|x: &${ty}| ser_opt(x, ${ser(t.of)})`;
    case 'map':
      return `|x: &${ty}| ser_map_${t.key === 'int' ? 'int' : 'str'}(x, ${ser(t.value)})`;
    case 'tree':
      return `|x: &${ty}| ser_tree(x, ${ser(t.of)})`;
    case 'linked_list':
      return `|x: &${ty}| ser_linked_list(x, ${ser(t.of)})`;
    case 'tuple': {
      const items = t.items.map((it, i) => `(${ser(it)})(&x.${i})?`).join(', ');
      return `|x: &${ty}| -> R<Value> { Ok(Value::Arr(vec![${items}])) }`;
    }
    default:
      return `ser_${t.kind}`;
  }
}

function uses(sig: Signature, kind: NeutralType['kind']): boolean {
  return signatureTypes(sig).some((t) => someType(t, (x) => x.kind === kind));
}

function nodeDerives(el: ScalarKind): string {
  return el === 'float' ? 'Debug, PartialEq, Clone' : 'Debug, PartialEq, Eq, Clone';
}

function treeNodeLines(el: ScalarKind): string[] {
  const v = SCALAR[el];
  return [
    `#[derive(${nodeDerives(el)})]`,
    'pub struct TreeNode {',
    `    pub val: ${v},`,
    '    pub left: Option<Rc<RefCell<TreeNode>>>,',
    '    pub right: Option<Rc<RefCell<TreeNode>>>,',
    '}',
    '',
    'impl TreeNode {',
    '    #[inline]',
    `    pub fn new(val: ${v}) -> Self {`,
    '        TreeNode { val, left: None, right: None }',
    '    }',
    '}',
  ];
}

function listNodeLines(el: ScalarKind): string[] {
  const v = SCALAR[el];
  return [
    `#[derive(${nodeDerives(el)})]`,
    'pub struct ListNode {',
    `    pub val: ${v},`,
    '    pub next: Option<Box<ListNode>>,',
    '}',
    '',
    'impl ListNode {',
    '    #[inline]',
    `    pub fn new(val: ${v}) -> Self {`,
    '        ListNode { next: None, val }',
    '    }',
    '}',
  ];
}

/** `nodes.rs`: the node types and their converters, for this signature's element types. */
function nodesFile(sig: Signature): string {
  const tree = nodeElement(sig, 'tree');
  const list = nodeElement(sig, 'linked_list');
  const out = [
    '// Generated by Algorithm Tutor: node types for this problem. Do not edit.',
    '#![allow(dead_code, unused_imports)]',
    'use crate::harness::*;',
    'use crate::json::Value;',
    'use std::cell::RefCell;',
    'use std::collections::VecDeque;',
    'use std::rc::Rc;',
  ];
  if (tree) {
    const v = SCALAR[tree];
    out.push(
      '',
      ...treeNodeLines(tree),
      '',
      `pub fn de_tree(v: &Value, f: impl Fn(&Value) -> R<${v}>) -> R<Option<Rc<RefCell<TreeNode>>>> {`,
      '    let vals = de_level_order(v, f)?;',
      '    let mut it = vals.into_iter();',
      '    let root = match it.next() {',
      '        Some(Some(val)) => Rc::new(RefCell::new(TreeNode::new(val))),',
      '        _ => return Ok(None),',
      '    };',
      '    let mut queue = VecDeque::from([root.clone()]);',
      "    'build: while let Some(node) = queue.pop_front() {",
      '        for left in [true, false] {',
      '            match it.next() {',
      "                None => break 'build,",
      '                Some(None) => {}',
      '                Some(Some(val)) => {',
      '                    let child = Rc::new(RefCell::new(TreeNode::new(val)));',
      '                    queue.push_back(child.clone());',
      '                    let mut n = node.borrow_mut();',
      '                    if left { n.left = Some(child) } else { n.right = Some(child) }',
      '                }',
      '            }',
      '        }',
      '    }',
      '    Ok(Some(root))',
      '}',
      '',
      `pub fn ser_tree(x: &Option<Rc<RefCell<TreeNode>>>, f: impl Fn(&${v}) -> R<Value>) -> R<Value> {`,
      '    let mut out = Vec::new();',
      '    let mut queue = VecDeque::from([x.clone()]);',
      '    if x.is_none() {',
      '        return Ok(Value::Arr(out));',
      '    }',
      '    while let Some(slot) = queue.pop_front() {',
      '        match slot {',
      '            None => out.push(Value::Null),',
      '            Some(node) => {',
      '                let n = node.borrow();',
      '                out.push(f(&n.val)?);',
      '                queue.push_back(n.left.clone());',
      '                queue.push_back(n.right.clone());',
      '            }',
      '        }',
      '        if out.len() > NODE_LIMIT {',
      '            return Err(String::from("the tree is too large (a cycle?)"));',
      '        }',
      '    }',
      '    while out.last() == Some(&Value::Null) {',
      '        out.pop();',
      '    }',
      '    Ok(Value::Arr(out))',
      '}',
    );
  }
  if (list) {
    const v = SCALAR[list];
    out.push(
      '',
      ...listNodeLines(list),
      '',
      `pub fn de_linked_list(v: &Value, f: impl Fn(&Value) -> R<${v}>) -> R<Option<Box<ListNode>>> {`,
      '    let vals = de_list(v, f)?;',
      '    let mut head = None;',
      '    for val in vals.into_iter().rev() {',
      '        head = Some(Box::new(ListNode { val, next: head }));',
      '    }',
      '    Ok(head)',
      '}',
      '',
      `pub fn ser_linked_list(x: &Option<Box<ListNode>>, f: impl Fn(&${v}) -> R<Value>) -> R<Value> {`,
      '    let mut out = Vec::new();',
      '    let mut node = x.as_deref();',
      '    while let Some(n) = node {',
      '        out.push(f(&n.val)?);',
      '        node = n.next.as_deref();',
      '    }',
      '    Ok(Value::Arr(out))',
      '}',
    );
  }
  return `${out.join('\n')}\n`;
}

function mainFile(sig: Signature): string {
  const params = sig.params.map((p) => ({ ...p, t: parseType(p.type) }));
  const returns = parseType(sig.returns);
  const names = params.map((p) => JSON.stringify(p.name)).join(', ');
  const lines = [
    `// Generated by Algorithm Tutor: the harness for \`${sig.function}\`. Do not edit.`,
    'mod harness;',
    'mod json;',
    'mod nodes;',
    '#[allow(dead_code, unused_imports, unused_variables, unused_mut)]',
    'mod solution;',
    '',
    '#[allow(unused_imports)]',
    'use harness::*;',
    'use json::Value;',
    '#[allow(unused_imports)]',
    'use nodes::*;',
    '#[allow(unused_imports)]',
    'use std::cell::RefCell;',
    '#[allow(unused_imports)]',
    'use std::collections::HashMap;',
    '#[allow(unused_imports)]',
    'use std::rc::Rc;',
    '',
    '#[allow(unused_variables)]',
    'fn call(args: &[Value]) -> Result<(Value, f64), CallError> {',
  ];
  params.forEach((p, i) => {
    lines.push(
      `    let a${i} = (${de(p.t)})(&args[${i}])`,
      `        .map_err(|e| CallError::Input(format!("${p.name}: {}", e)))?;`,
    );
  });
  const args = params.map((_, i) => `a${i}`).join(', ');
  lines.push(
    '    let start = std::time::Instant::now();',
    `    let result: ${rustType(returns)} = solution::${rustName(sig.function)}(${args});`,
    '    let ms = start.elapsed().as_secs_f64() * 1000.0;',
    `    let actual = (${ser(returns)})(&result).map_err(|e| CallError::Output(e, ms))?;`,
    '    Ok((actual, ms))',
    '}',
    '',
    'fn main() {',
    `    harness::main(&[${names}], call);`,
    '}',
  );
  return `${lines.join('\n')}\n`;
}

const CARGO_TOML = `# Generated by Algorithm Tutor. Do not edit.
[package]
name = "solution"
version = "0.1.0"
edition = "2021"
publish = false

[[bin]]
name = "harness"
path = "src/main.rs"

[dependencies]

[profile.release]
opt-level = 2
debug = "line-tables-only"
overflow-checks = true
incremental = true
`;

/** The `src/solution.rs` the user starts from. */
export function rustStub(sig: Signature, options: StubOptions = {}): string {
  const tree = nodeElement(sig, 'tree');
  const list = nodeElement(sig, 'linked_list');
  const lines: string[] = (options.header ?? []).map((l) => (l ? `// ${l}` : '//'));
  const provided: string[] = [];
  if (list) provided.push(...listNodeLines(list));
  if (tree) {
    if (provided.length) provided.push('');
    provided.push(...treeNodeLines(tree));
  }
  if (provided.length) {
    if (lines.length) lines.push('//');
    lines.push(
      '// Provided by the harness (do not define it yourself):',
      '//',
      ...provided.filter((l) => !l.trim().startsWith('#[')).map((l) => (l ? `// ${l}` : '//')),
    );
  }
  if (lines.length) lines.push('');
  const imports: string[] = [];
  if (list) imports.push('use crate::nodes::ListNode;');
  if (tree) imports.push('use crate::nodes::TreeNode;');
  if (tree) imports.push('use std::cell::RefCell;');
  if (uses(sig, 'map')) imports.push('use std::collections::HashMap;');
  if (tree) imports.push('use std::rc::Rc;');
  if (imports.length) lines.push(...imports, '');
  const params = sig.params.map((p) => `${rustName(p.name)}: ${rustType(parseType(p.type))}`);
  lines.push(
    `pub fn ${rustName(sig.function)}(${params.join(', ')}) -> ${rustType(parseType(sig.returns))} {`,
    '    todo!()',
    '}',
  );
  return `${lines.join('\n')}\n`;
}

/** The Cargo project for `sig` (no external crates; builds offline). */
export function rustProject(sig: Signature): HarnessProject {
  const limit = rustUnsupported(sig);
  if (limit) throw new Error(`the Rust harness cannot run this signature: ${limit}`);
  return {
    language: 'rust',
    files: [
      { path: 'Cargo.toml', content: CARGO_TOML },
      { path: 'src/main.rs', content: mainFile(sig) },
      { path: 'src/nodes.rs', content: nodesFile(sig) },
    ],
    runtimeFiles: [
      { from: 'harness.rs', path: 'src/harness.rs' },
      { from: 'json.rs', path: 'src/json.rs' },
    ],
    solutionPath: 'src/solution.rs',
    build: ['cargo', 'build', '--release', '--offline', '--quiet'],
    run: ['target/release/harness'],
  };
}

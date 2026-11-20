/**
 * Go harness generator (SPEC §5.2, §6.4; DECISIONS D-29): from a neutral
 * signature, the stub the user sees and the generated files of a Go module
 * that runs it. `content/runners/go/harness.go` holds the fixed runtime.
 *
 * Types: int `int`, float `float64`, bool, string, char `rune`, list `[]T`,
 * tuple a struct per harness (`Tuple`, fields `V0`, `V1`, …), map
 * `map[string|int]T`, optional `*T`, tree `*TreeNode`, linked_list `*ListNode`.
 * Names are lowerCamelCase (`level_lists` → `levelLists`).
 */
import { formatType, parseType, type NeutralType, type ScalarKind } from '../../types/neutral';
import type { Signature } from '../../types/signature';
import {
  camelCase,
  compiledHarnessLimit,
  nodeElement,
  signatureTypes,
  type HarnessProject,
  type StubOptions,
} from '../common';

const RESERVED = new Set(
  // keywords
  (
    'break case chan const continue default defer else fallthrough for func go goto if import ' +
    'interface map package range return select struct switch type var ' +
    // predeclared names a parameter would shadow in its own signature or body
    'any bool byte comparable complex64 complex128 error float32 float64 int int8 int16 int32 ' +
    'int64 rune string uint uint8 uint16 uint32 uint64 uintptr true false iota nil append cap ' +
    'clear close complex copy delete imag len make max min new panic print println real recover ' +
    // names package main reserves
    'main init'
  ).split(' '),
);

/** A snake_case name as a Go identifier (`level_lists` → `levelLists`, `type` → `type_`). */
export function goName(name: string): string {
  const n = camelCase(name);
  return RESERVED.has(n) ? `${n}_` : n;
}

const SCALAR: Record<ScalarKind, string> = {
  int: 'int',
  float: 'float64',
  bool: 'bool',
  string: 'string',
  char: 'rune',
};

const CONV: Record<ScalarKind, string> = {
  int: 'Int',
  float: 'Float',
  bool: 'Bool',
  string: 'String',
  char: 'Char',
};

/** Struct names for the signature's distinct tuple types, by canonical spelling. */
function tupleNames(sig: Signature): Map<string, string> {
  const found: string[] = [];
  const visit = (t: NeutralType): void => {
    switch (t.kind) {
      case 'list':
      case 'optional':
      case 'tree':
      case 'linked_list':
        visit(t.of);
        return;
      case 'map':
        visit(t.value);
        return;
      case 'tuple': {
        t.items.forEach(visit);
        const key = formatType(t);
        if (!found.includes(key)) found.push(key);
        return;
      }
      default:
        return;
    }
  };
  signatureTypes(sig).forEach(visit);
  return new Map(found.map((k, i) => [k, found.length === 1 ? 'Tuple' : `Tuple${i + 1}`]));
}

class GoTypes {
  readonly tuples: Map<string, string>;
  constructor(sig: Signature) {
    this.tuples = tupleNames(sig);
  }

  type(t: NeutralType): string {
    switch (t.kind) {
      case 'list':
        return `[]${this.type(t.of)}`;
      case 'tuple':
        return this.tuples.get(formatType(t))!;
      case 'map':
        return `map[${t.key === 'int' ? 'int' : 'string'}]${this.type(t.value)}`;
      case 'optional':
        return `*${this.type(t.of)}`;
      case 'tree':
        return '*TreeNode';
      case 'linked_list':
        return '*ListNode';
      default:
        return SCALAR[t.kind];
    }
  }

  /** A function value `func(any) (T, error)`. */
  de(t: NeutralType): string {
    switch (t.kind) {
      case 'list':
        return `harnessList(${this.de(t.of)})`;
      case 'optional':
        return `harnessOpt(${this.de(t.of)})`;
      case 'map':
        return `harnessMap${t.key === 'int' ? 'Int' : 'Str'}(${this.de(t.value)})`;
      case 'tree':
        return `harnessTree(${this.de(t.of)})`;
      case 'linked_list':
        return `harnessLinkedList(${this.de(t.of)})`;
      case 'tuple':
        return `harnessIn${this.tuples.get(formatType(t))!}`;
      default:
        return `harness${CONV[t.kind]}`;
    }
  }

  /** A function value `func(T) (any, error)`. */
  ser(t: NeutralType): string {
    switch (t.kind) {
      case 'list':
        return `harnessOutList(${this.ser(t.of)})`;
      case 'optional':
        return `harnessOutOpt(${this.ser(t.of)})`;
      case 'map':
        return `harnessOutMap${t.key === 'int' ? 'Int' : 'Str'}(${this.ser(t.value)})`;
      case 'tree':
        return `harnessOutTree(${this.ser(t.of)})`;
      case 'linked_list':
        return `harnessOutLinkedList(${this.ser(t.of)})`;
      case 'tuple':
        return `harnessOut${this.tuples.get(formatType(t))!}`;
      default:
        return `harnessOut${CONV[t.kind]}`;
    }
  }

  /** The tuple types as parsed, in order. */
  tupleTypes(): { name: string; t: Extract<NeutralType, { kind: 'tuple' }> }[] {
    return [...this.tuples].map(([key, name]) => ({
      name,
      t: parseType(key) as Extract<NeutralType, { kind: 'tuple' }>,
    }));
  }
}

function treeNodeLines(el: ScalarKind): string[] {
  return [
    'type TreeNode struct {',
    `\tVal   ${SCALAR[el]}`,
    '\tLeft  *TreeNode',
    '\tRight *TreeNode',
    '}',
  ];
}

function listNodeLines(el: ScalarKind): string[] {
  return ['type ListNode struct {', `\tVal  ${SCALAR[el]}`, '\tNext *ListNode', '}'];
}

function tupleLines(types: GoTypes): string[] {
  const out: string[] = [];
  for (const { name, t } of types.tupleTypes()) {
    if (out.length) out.push('');
    out.push(`type ${name} struct {`);
    t.items.forEach((it, i) => out.push(`\tV${i} ${types.type(it)}`));
    out.push('}');
  }
  return out;
}

/** The type definitions the solution can use, as Go source lines. */
function providedLines(sig: Signature, types: GoTypes): string[] {
  const out: string[] = [];
  const add = (lines: string[]): void => {
    if (!lines.length) return;
    if (out.length) out.push('');
    out.push(...lines);
  };
  const list = nodeElement(sig, 'linked_list');
  const tree = nodeElement(sig, 'tree');
  if (list) add(listNodeLines(list));
  if (tree) add(treeNodeLines(tree));
  add(tupleLines(types));
  return out;
}

function glueFile(sig: Signature): string {
  const types = new GoTypes(sig);
  const tree = nodeElement(sig, 'tree');
  const list = nodeElement(sig, 'linked_list');
  const lines = [
    `// Generated by Algo: the harness for ${sig.function}. Do not edit.`,
    'package main',
    '',
    'import (',
    '\t"errors"',
    '\t"time"',
    ')',
    '',
    'var _ = errors.New',
  ];
  const provided = providedLines(sig, types);
  if (provided.length) lines.push('', ...provided);
  if (tree) {
    const v = SCALAR[tree];
    lines.push(
      '',
      `func harnessTree(f func(any) (${v}, error)) func(any) (*TreeNode, error) {`,
      '\treturn func(v any) (*TreeNode, error) {',
      '\t\tvals, err := harnessLevelOrder(f)(v)',
      '\t\tif err != nil || len(vals) == 0 || vals[0] == nil {',
      '\t\t\treturn nil, err',
      '\t\t}',
      '\t\troot := &TreeNode{Val: *vals[0]}',
      '\t\tqueue := []*TreeNode{root}',
      '\t\ti := 1',
      '\t\tfor len(queue) > 0 && i < len(vals) {',
      '\t\t\tnode := queue[0]',
      '\t\t\tqueue = queue[1:]',
      '\t\t\tif vals[i] != nil {',
      '\t\t\t\tnode.Left = &TreeNode{Val: *vals[i]}',
      '\t\t\t\tqueue = append(queue, node.Left)',
      '\t\t\t}',
      '\t\t\ti++',
      '\t\t\tif i < len(vals) && vals[i] != nil {',
      '\t\t\t\tnode.Right = &TreeNode{Val: *vals[i]}',
      '\t\t\t\tqueue = append(queue, node.Right)',
      '\t\t\t}',
      '\t\t\ti++',
      '\t\t}',
      '\t\treturn root, nil',
      '\t}',
      '}',
      '',
      `func harnessOutTree(f func(${v}) (any, error)) func(*TreeNode) (any, error) {`,
      '\treturn func(root *TreeNode) (any, error) {',
      '\t\tout := []any{}',
      '\t\tif root == nil {',
      '\t\t\treturn out, nil',
      '\t\t}',
      '\t\tqueue := []*TreeNode{root}',
      '\t\tfor len(queue) > 0 {',
      '\t\t\tnode := queue[0]',
      '\t\t\tqueue = queue[1:]',
      '\t\t\tif node == nil {',
      '\t\t\t\tout = append(out, nil)',
      '\t\t\t\tcontinue',
      '\t\t\t}',
      '\t\t\tv, err := f(node.Val)',
      '\t\t\tif err != nil {',
      '\t\t\t\treturn nil, err',
      '\t\t\t}',
      '\t\t\tout = append(out, v)',
      '\t\t\tqueue = append(queue, node.Left, node.Right)',
      '\t\t\tif len(out) > harnessNodeLimit {',
      '\t\t\t\treturn nil, errors.New("the tree is too large (a cycle?)")',
      '\t\t\t}',
      '\t\t}',
      '\t\treturn harnessTrimNulls(out), nil',
      '\t}',
      '}',
    );
  }
  if (list) {
    const v = SCALAR[list];
    lines.push(
      '',
      `func harnessLinkedList(f func(any) (${v}, error)) func(any) (*ListNode, error) {`,
      '\treturn func(v any) (*ListNode, error) {',
      '\t\tvals, err := harnessList(f)(v)',
      '\t\tif err != nil {',
      '\t\t\treturn nil, err',
      '\t\t}',
      '\t\tvar head *ListNode',
      '\t\tfor i := len(vals) - 1; i >= 0; i-- {',
      '\t\t\thead = &ListNode{Val: vals[i], Next: head}',
      '\t\t}',
      '\t\treturn head, nil',
      '\t}',
      '}',
      '',
      `func harnessOutLinkedList(f func(${v}) (any, error)) func(*ListNode) (any, error) {`,
      '\treturn func(node *ListNode) (any, error) {',
      '\t\tout := []any{}',
      '\t\tfor ; node != nil; node = node.Next {',
      '\t\t\tv, err := f(node.Val)',
      '\t\t\tif err != nil {',
      '\t\t\t\treturn nil, err',
      '\t\t\t}',
      '\t\t\tout = append(out, v)',
      '\t\t\tif len(out) > harnessNodeLimit {',
      '\t\t\t\treturn nil, errors.New("the linked list is too long (a cycle?)")',
      '\t\t\t}',
      '\t\t}',
      '\t\treturn out, nil',
      '\t}',
      '}',
    );
  }
  for (const { name, t } of types.tupleTypes()) {
    lines.push(
      '',
      `func harnessIn${name}(v any) (${name}, error) {`,
      `\tvar out ${name}`,
      `\titems, err := harnessItems(v, ${t.items.length})`,
      '\tif err != nil {',
      '\t\treturn out, err',
      '\t}',
    );
    t.items.forEach((it, i) => {
      lines.push(
        `\tif out.V${i}, err = ${types.de(it)}(items[${i}]); err != nil {`,
        '\t\treturn out, err',
        '\t}',
      );
    });
    lines.push('\treturn out, nil', '}', '');
    lines.push(
      `func harnessOut${name}(x ${name}) (any, error) {`,
      `\tout := make([]any, ${t.items.length})`,
      '\tvar err error',
    );
    t.items.forEach((it, i) => {
      lines.push(
        `\tif out[${i}], err = ${types.ser(it)}(x.V${i}); err != nil {`,
        '\t\treturn nil, err',
        '\t}',
      );
    });
    lines.push('\treturn out, nil', '}');
  }

  const params = sig.params.map((p) => ({ name: p.name, t: parseType(p.type) }));
  const returns = parseType(sig.returns);
  lines.push('', 'func harnessCallSolution(args []any) (any, float64, error) {');
  params.forEach((p, i) => {
    lines.push(
      `\ta${i}, err := ${types.de(p.t)}(args[${i}])`,
      '\tif err != nil {',
      `\t\treturn nil, 0, harnessInputError{"${p.name}: " + err.Error()}`,
      '\t}',
    );
  });
  const args = params.map((_, i) => `a${i}`).join(', ');
  lines.push(
    '\tstart := time.Now()',
    `\tresult := ${goName(sig.function)}(${args})`,
    '\tms := float64(time.Since(start).Nanoseconds()) / 1e6',
    `\tactual, err := ${types.ser(returns)}(result)`,
    '\tif err != nil {',
    '\t\treturn nil, ms, harnessOutputError{err.Error()}',
    '\t}',
    '\treturn actual, ms, nil',
    '}',
    '',
    'func main() {',
    `\tharnessMain([]string{${params.map((p) => JSON.stringify(p.name)).join(', ')}}, harnessCallSolution)`,
    '}',
  );
  return `${lines.join('\n')}\n`;
}

/** Why the Go harness cannot run `sig`, or `null`. */
export function goUnsupported(sig: Signature): string | null {
  return compiledHarnessLimit(sig);
}

export function goType(sig: Signature, t: NeutralType): string {
  return new GoTypes(sig).type(t);
}

/** The `solution.go` the user starts from. */
export function goStub(sig: Signature, options: StubOptions = {}): string {
  const types = new GoTypes(sig);
  const lines: string[] = (options.header ?? []).map((l) => (l ? `// ${l}` : '//'));
  const provided = providedLines(sig, types);
  if (provided.length) {
    if (lines.length) lines.push('//');
    lines.push(
      '// Provided by the harness (do not define them yourself):',
      '//',
      ...provided.map((l) => (l ? `//\t${l}` : '//')),
    );
  }
  if (lines.length) lines.push('');
  const params = sig.params.map((p) => `${goName(p.name)} ${types.type(parseType(p.type))}`);
  lines.push(
    'package main',
    '',
    `func ${goName(sig.function)}(${params.join(', ')}) ${types.type(parseType(sig.returns))} {`,
    '\tpanic("not implemented")',
    '}',
  );
  return `${lines.join('\n')}\n`;
}

const GO_MOD = `// Generated by Algo. Do not edit.
module solution

go 1.22
`;

/** The Go module for `sig` (standard library only). */
export function goProject(sig: Signature): HarnessProject {
  const limit = goUnsupported(sig);
  if (limit) throw new Error(`the Go harness cannot run this signature: ${limit}`);
  return {
    language: 'go',
    files: [
      { path: 'go.mod', content: GO_MOD },
      { path: 'glue.go', content: glueFile(sig) },
    ],
    runtimeFiles: [{ from: 'harness.go', path: 'harness.go' }],
    solutionPath: 'solution.go',
    build: ['go', 'build', '-o', 'harness', '.'],
    run: ['harness'],
  };
}

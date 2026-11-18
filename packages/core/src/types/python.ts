/**
 * Neutral types as Python type hints, for stubs and prompts (SPEC §5.2).
 * Matches the hints the `dsa-tutor` problems used, e.g. `TreeNode | None`.
 */
import { parseType, someType, type NeutralType } from './neutral';
import type { Signature } from './signature';

export function pythonType(t: NeutralType): string {
  switch (t.kind) {
    case 'int':
    case 'float':
    case 'bool':
      return t.kind;
    case 'string':
    case 'char':
      return 'str';
    case 'list':
      return `list[${pythonType(t.of)}]`;
    case 'tuple':
      return `tuple[${t.items.map(pythonType).join(', ')}]`;
    case 'map':
      return `dict[${t.key === 'int' ? 'int' : 'str'}, ${pythonType(t.value)}]`;
    case 'optional':
      return `${pythonType(t.of)} | None`;
    case 'tree':
      return 'TreeNode | None';
    case 'linked_list':
      return 'ListNode | None';
  }
}

/** `def levels(root: TreeNode | None) -> list[list[int]]:` */
export function pythonSignatureLine(sig: Signature): string {
  const params = sig.params.map((p) => `${p.name}: ${pythonType(parseType(p.type))}`).join(', ');
  return `def ${sig.function}(${params}) -> ${pythonType(parseType(sig.returns))}:`;
}

/** The node classes a Python stub must define for this signature, in a stable order. */
export function pythonNodeClasses(sig: Signature): ('ListNode' | 'TreeNode')[] {
  const types = [...sig.params.map((p) => p.type), sig.returns].map(parseType);
  const uses = (kind: NeutralType['kind']): boolean =>
    types.some((t) => someType(t, (x) => x.kind === kind));
  const out: ('ListNode' | 'TreeNode')[] = [];
  if (uses('linked_list')) out.push('ListNode');
  if (uses('tree')) out.push('TreeNode');
  return out;
}

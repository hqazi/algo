/**
 * Neutral types (SPEC §5.2): the language-independent types in a problem's
 * signature, e.g. `list<list<int>>`, `tree<int>`, `optional<string>`.
 *
 * Grammar (whitespace between tokens is ignored):
 *
 *   type   := scalar
 *           | "list<" type ">"
 *           | "tuple<" type ("," type)+ ">"        two or more items
 *           | "map<" ("string" | "int") "," type ">"
 *           | "optional<" type ">"                 not optional<optional<…>>
 *           | "tree<" scalar ">"
 *           | "linked_list<" scalar ">"
 *   scalar := "int" | "float" | "bool" | "string" | "char"
 */

export const SCALAR_KINDS = ['int', 'float', 'bool', 'string', 'char'] as const;
export type ScalarKind = (typeof SCALAR_KINDS)[number];
export type MapKeyKind = 'string' | 'int';

export type NeutralType =
  | { kind: ScalarKind }
  | { kind: 'list'; of: NeutralType }
  | { kind: 'tuple'; items: NeutralType[] }
  | { kind: 'map'; key: MapKeyKind; value: NeutralType }
  | { kind: 'optional'; of: NeutralType }
  | { kind: 'tree'; of: ScalarType }
  | { kind: 'linked_list'; of: ScalarType };

export type ScalarType = { kind: ScalarKind };

export class TypeParseError extends Error {
  override name = 'TypeParseError';
}

/** Longest type string accepted; real signatures are far shorter. */
export const MAX_TYPE_LENGTH = 200;

const WRAPPERS = ['list', 'tuple', 'map', 'optional', 'tree', 'linked_list'] as const;

export function isScalar(t: NeutralType): t is ScalarType {
  return (SCALAR_KINDS as readonly string[]).includes(t.kind);
}

/** Parse a neutral type string. Throws `TypeParseError` with a readable message. */
export function parseType(text: string): NeutralType {
  if (text.length > MAX_TYPE_LENGTH) {
    throw new TypeParseError(`type is longer than ${MAX_TYPE_LENGTH} characters`);
  }
  const tokens = tokenize(text);
  let pos = 0;

  const peek = (): string | undefined => tokens[pos];
  const fail = (message: string): never => {
    throw new TypeParseError(`${message} in type "${text}"`);
  };
  const expect = (tok: string): void => {
    const got = tokens[pos];
    if (got !== tok)
      fail(
        got === undefined ? `expected "${tok}" at the end` : `expected "${tok}" but found "${got}"`,
      );
    pos++;
  };

  const parse = (): NeutralType => {
    const name = tokens[pos];
    if (name === undefined) return fail('missing a type');
    pos++;
    if ((SCALAR_KINDS as readonly string[]).includes(name)) {
      if (peek() === '<') fail(`"${name}" takes no type arguments`);
      return { kind: name as ScalarKind };
    }
    if (!(WRAPPERS as readonly string[]).includes(name)) {
      return fail(`unknown type "${name}"`);
    }
    expect('<');
    let result: NeutralType;
    switch (name as (typeof WRAPPERS)[number]) {
      case 'list':
        result = { kind: 'list', of: parse() };
        break;
      case 'optional': {
        const of = parse();
        if (of.kind === 'optional')
          fail('optional<optional<…>> is not allowed (both are null in JSON)');
        result = { kind: 'optional', of };
        break;
      }
      case 'tree':
      case 'linked_list': {
        const of = parse();
        if (!isScalar(of)) fail(`${name}<…> holds a scalar type (${SCALAR_KINDS.join(', ')})`);
        result = { kind: name as 'tree' | 'linked_list', of: of as ScalarType };
        break;
      }
      case 'map': {
        const key = tokens[pos];
        if (key !== 'string' && key !== 'int') fail('map keys must be "string" or "int"');
        pos++;
        expect(',');
        result = { kind: 'map', key: key as MapKeyKind, value: parse() };
        break;
      }
      case 'tuple': {
        const items = [parse()];
        while (peek() === ',') {
          pos++;
          items.push(parse());
        }
        if (items.length < 2) fail('a tuple needs at least two items');
        result = { kind: 'tuple', items };
        break;
      }
    }
    expect('>');
    return result;
  };

  const type = parse();
  if (pos < tokens.length) fail(`unexpected "${tokens[pos]}"`);
  return type;
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  // Words are matched loosely and any other character becomes its own token,
  // so `TreeNode | None` reports the unknown type before the stray "|".
  const re = /\s*([A-Za-z_][A-Za-z0-9_]*|\S)/y;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) tokens.push(m[1] as string);
  return tokens;
}

/** The canonical spelling of a type: no spaces, e.g. `map<string,list<int>>`. */
export function formatType(t: NeutralType): string {
  switch (t.kind) {
    case 'list':
    case 'optional':
    case 'tree':
    case 'linked_list':
      return `${t.kind}<${formatType(t.of)}>`;
    case 'tuple':
      return `tuple<${t.items.map(formatType).join(',')}>`;
    case 'map':
      return `map<${t.key},${formatType(t.value)}>`;
    default:
      return t.kind;
  }
}

/** True if `pred` holds for `t` or any type nested in it. */
export function someType(t: NeutralType, pred: (t: NeutralType) => boolean): boolean {
  if (pred(t)) return true;
  switch (t.kind) {
    case 'list':
    case 'optional':
    case 'tree':
    case 'linked_list':
      return someType(t.of, pred);
    case 'tuple':
      return t.items.some((i) => someType(i, pred));
    case 'map':
      return someType(t.value, pred);
    default:
      return false;
  }
}

/**
 * Check a JSON value against a neutral type (SPEC §5.2), so that a problem
 * that validates is runnable by every harness supporting its types.
 *
 * Values come from `parseJson`, so integers beyond ±(2^53 − 1) are `bigint`.
 */
import type { NeutralType } from './neutral';

export interface ValueCheckOptions {
  /**
   * Also require the canonical form a harness writes back, for expected
   * values: trees without trailing `null`s. Inputs may have them.
   */
  canonical?: boolean;
  /** Stop after this many errors (default 5). */
  maxErrors?: number;
}

const I64_MIN = -(2n ** 63n);
const I64_MAX = 2n ** 63n - 1n;
const INT_KEY = /^-?(?:0|[1-9]\d*)$/;

/** Errors found in `value` as a `type`, each prefixed with its path (e.g. `root[3]`). */
export function checkValue(
  value: unknown,
  type: NeutralType,
  path: string,
  options: ValueCheckOptions = {},
): string[] {
  const errors: string[] = [];
  const max = options.maxErrors ?? 5;
  const canonical = options.canonical ?? false;

  const add = (where: string, message: string): void => {
    if (errors.length < max) errors.push(`${where}: ${message}`);
  };

  const visit = (v: unknown, t: NeutralType, where: string): void => {
    if (errors.length >= max) return;
    switch (t.kind) {
      case 'int':
        if (typeof v === 'bigint') {
          if (v < I64_MIN || v > I64_MAX) add(where, 'integer is outside the 64-bit range');
        } else if (typeof v === 'number' && Number.isInteger(v)) {
          if (!Number.isSafeInteger(v))
            add(where, 'large integers must be written as plain digits');
        } else {
          add(where, `expected int, got ${describe(v)}`);
        }
        return;
      case 'float':
        if (!(typeof v === 'bigint' || (typeof v === 'number' && Number.isFinite(v)))) {
          add(where, `expected float, got ${describe(v)}`);
        }
        return;
      case 'bool':
        if (typeof v !== 'boolean') add(where, `expected bool, got ${describe(v)}`);
        return;
      case 'string':
        if (typeof v !== 'string') add(where, `expected string, got ${describe(v)}`);
        return;
      case 'char':
        if (typeof v !== 'string' || [...v].length !== 1) {
          add(where, `expected char (a one-character string), got ${describe(v)}`);
        }
        return;
      case 'list':
        if (!Array.isArray(v)) return add(where, `expected list, got ${describe(v)}`);
        v.forEach((item, i) => visit(item, t.of, `${where}[${i}]`));
        return;
      case 'tuple':
        if (!Array.isArray(v) || v.length !== t.items.length) {
          return add(where, `expected tuple of ${t.items.length} items, got ${describe(v)}`);
        }
        t.items.forEach((itemType, i) => visit(v[i], itemType, `${where}[${i}]`));
        return;
      case 'map':
        if (!isPlainObject(v))
          return add(where, `expected map (a JSON object), got ${describe(v)}`);
        for (const [k, item] of Object.entries(v)) {
          if (
            t.key === 'int' &&
            !(INT_KEY.test(k) && BigInt(k) >= I64_MIN && BigInt(k) <= I64_MAX)
          ) {
            add(where, `map<int,…> key "${k}" is not an integer`);
          }
          visit(item, t.value, `${where}[${JSON.stringify(k)}]`);
        }
        return;
      case 'optional':
        if (v !== null) visit(v, t.of, where);
        return;
      case 'linked_list':
        if (!Array.isArray(v))
          return add(where, `expected linked_list (an array), got ${describe(v)}`);
        v.forEach((item, i) => visit(item, t.of, `${where}[${i}]`));
        return;
      case 'tree':
        if (!Array.isArray(v))
          return add(where, `expected tree (a level-order array), got ${describe(v)}`);
        checkTreeShape(v, where, canonical, add);
        v.forEach((item, i) => {
          if (item !== null) visit(item, t.of, `${where}[${i}]`);
        });
        return;
    }
  };

  visit(value, type, path);
  return errors;
}

/**
 * A tree is a level-order array with `null` for missing children, read the way
 * every harness builds it: each node takes the next two slots as its left and
 * right child. An empty tree is `[]`.
 */
function checkTreeShape(
  values: unknown[],
  where: string,
  canonical: boolean,
  add: (where: string, message: string) => void,
): void {
  if (values.length === 0) return;
  if (values[0] === null) {
    add(where, 'tree root is null; write an empty tree as []');
    return;
  }
  let open = 1; // nodes whose children have not been read yet
  let i = 1;
  while (open > 0 && i < values.length) {
    open--;
    for (let child = 0; child < 2 && i < values.length; child++, i++) {
      if (values[i] !== null) open++;
    }
  }
  if (i < values.length) {
    add(where, `tree has values from position ${i} on that belong to no node (children of null)`);
  } else if (canonical && values[values.length - 1] === null) {
    add(where, 'tree ends with null; write it without trailing nulls, as a harness prints it');
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `an array of ${v.length}`;
  if (typeof v === 'string')
    return `string ${JSON.stringify(v.length > 20 ? `${v.slice(0, 20)}…` : v)}`;
  if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean') {
    return `${typeof v === 'bigint' ? 'number' : typeof v} ${String(v)}`;
  }
  if (v === undefined) return 'nothing';
  return typeof v === 'object' ? 'an object' : typeof v;
}

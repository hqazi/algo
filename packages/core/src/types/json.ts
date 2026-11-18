/**
 * JSON with exact 64-bit integers.
 *
 * Neutral `int` values use the full 64-bit range (SPEC §5.2), but
 * `JSON.parse` turns every number into a double, so `999999999999999999`
 * silently becomes `1000000000000000000`. `parseJson` keeps integer literals
 * outside ±(2^53 − 1) exact as `bigint`; `stringifyJson` writes them back
 * unchanged. Everything else behaves like the built-in functions.
 *
 * Use these for every problem file, harness input and harness output.
 */

/** A value read from JSON: `bigint` only for integers too large for a double. */
export type JsonValue =
  null | boolean | number | bigint | string | JsonValue[] | { [key: string]: JsonValue };

// `JSON.parse` passes the literal's source text to the reviver as a third
// argument (ES2025 "JSON.parse source text access"; V8 since Chrome 114 and
// Node 21). The ES2023 lib does not type it.
type Reviver = (
  this: unknown,
  key: string,
  value: unknown,
  context?: { source?: string },
) => unknown;
const parseWithSource = JSON.parse as (text: string, reviver: Reviver) => unknown;

const INTEGER_LITERAL = /^-?(?:0|[1-9]\d*)$/;

let sourceAccessChecked = false;

function checkSourceAccess(): void {
  if (sourceAccessChecked) return;
  let seen: string | undefined;
  parseWithSource('1', (_key, value, context) => {
    seen = context?.source;
    return value;
  });
  if (seen !== '1') {
    throw new Error('this JavaScript engine lacks JSON.parse source text access');
  }
  sourceAccessChecked = true;
}

/** Parse JSON text, keeping integer literals beyond ±(2^53 − 1) exact as `bigint`. */
export function parseJson(text: string): JsonValue {
  checkSourceAccess();
  return parseWithSource(text, (_key, value, context) => {
    if (
      typeof value === 'number' &&
      !Number.isSafeInteger(value) &&
      context?.source !== undefined &&
      INTEGER_LITERAL.test(context.source)
    ) {
      return BigInt(context.source);
    }
    return value;
  }) as JsonValue;
}

/**
 * `JSON.stringify` for plain data that writes `bigint` values as integer
 * literals. Same output as the built-in for everything else (key order,
 * `undefined` properties dropped, `undefined` array items and non-finite
 * numbers as `null`). `indent` > 0 pretty-prints like `JSON.stringify(v, null, indent)`.
 */
export function stringifyJson(value: unknown, indent = 0): string {
  const out = write(value, indent > 0 ? ' '.repeat(indent) : '', '');
  if (out === undefined) throw new TypeError('value is not representable as JSON');
  return out;
}

function write(value: unknown, step: string, pad: string): string | undefined {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'bigint':
      return value.toString();
    case 'number':
    case 'boolean':
    case 'string':
      return JSON.stringify(value);
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined;
  }
  const inner = pad + step;
  const open = step ? `\n${inner}` : '';
  const sep = step ? `,\n${inner}` : ',';
  const close = step ? `\n${pad}` : '';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((v: unknown) => write(v, step, inner) ?? 'null');
    return `[${open}${items.join(sep)}${close}]`;
  }
  const colon = step ? ': ' : ':';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const text = write(v, step, inner);
    if (text !== undefined) parts.push(JSON.stringify(k) + colon + text);
  }
  return parts.length ? `{${open}${parts.join(sep)}${close}}` : '{}';
}

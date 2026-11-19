/**
 * A small JSON Schema validator for tool inputs. Ported from
 * `dsa-tutor/dsa_tutor/tools/schema.py`.
 *
 * Covers the subset the tool schemas use: `type` (one name or a list),
 * `properties`, `required`, `additionalProperties` (bool or schema), `enum`,
 * `minLength`, `maxLength`, `pattern`, `minimum`, `maximum`, `items`,
 * `minItems`, `maxItems`, `minProperties`. Unknown keywords (`description`,
 * `title`, ...) are ignored, as JSON Schema says. `validateInput` returns
 * readable problems with a location; an empty list means valid.
 */

export type JsonSchema = { [key: string]: unknown };

const MAX_ERRORS = 10;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const TYPES: Record<string, (v: unknown) => boolean> = {
  object: isObject,
  array: Array.isArray,
  string: (v) => typeof v === 'string',
  integer: (v) => (typeof v === 'number' && Number.isInteger(v)) || typeof v === 'bigint',
  number: (v) => (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'bigint',
  boolean: (v) => typeof v === 'boolean',
  null: (v) => v === null,
};

export function validateInput(value: unknown, schema: JsonSchema, where = 'input'): string[] {
  const errors: string[] = [];
  check(value, schema, where, errors);
  return errors.slice(0, MAX_ERRORS);
}

function check(value: unknown, schema: unknown, where: string, errors: string[]): void {
  if (errors.length >= MAX_ERRORS || !isObject(schema)) return;
  const types = schema.type;
  if (types !== undefined) {
    const names = typeof types === 'string' ? [types] : (types as string[]);
    if (!names.some((n) => TYPES[n]?.(value))) {
      errors.push(`${where} must be ${names.join(' or ')}`);
      return;
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => e === value)) {
    errors.push(`${where} must be one of ${schema.enum.map(show).join(', ')}`);
    return;
  }
  if (typeof value === 'string') {
    const length = [...value].length;
    if (typeof schema.minLength === 'number' && length < schema.minLength)
      errors.push(`${where} must be at least ${schema.minLength} characters`);
    if (typeof schema.maxLength === 'number' && length > schema.maxLength)
      errors.push(`${where} must be at most ${schema.maxLength} characters`);
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value))
      errors.push(`${where} does not match ${schema.pattern}`);
  }
  if (TYPES.number!(value)) {
    const n = value as number | bigint;
    if (typeof schema.minimum === 'number' && n < schema.minimum)
      errors.push(`${where} must be >= ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && n > schema.maximum)
      errors.push(`${where} must be <= ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems)
      errors.push(`${where} needs at least ${schema.minItems} items`);
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems)
      errors.push(`${where} allows at most ${schema.maxItems} items`);
    if (isObject(schema.items))
      value.forEach((item, i) => check(item, schema.items, `${where}[${i}]`, errors));
  }
  if (isObject(value)) {
    const keys = Object.keys(value);
    if (typeof schema.minProperties === 'number' && keys.length < schema.minProperties)
      errors.push(`${where} needs at least ${schema.minProperties} entries`);
    const props = isObject(schema.properties) ? schema.properties : {};
    if (Array.isArray(schema.required))
      for (const key of schema.required as string[])
        if (!Object.hasOwn(value, key)) errors.push(`${where}.${key} is required`);
    const extra = schema.additionalProperties ?? true;
    for (const key of keys) {
      if (Object.hasOwn(props, key)) check(value[key], props[key], `${where}.${key}`, errors);
      else if (extra === false) {
        const allowed = Object.keys(props);
        errors.push(
          `${where}.${key} is not allowed` +
            (allowed.length ? ` (allowed: ${allowed.join(', ')})` : ''),
        );
      } else if (isObject(extra)) check(value[key], extra, `${where}.${key}`, errors);
    }
  }
}

function show(value: unknown): string {
  return value === null ? 'null' : String(value);
}

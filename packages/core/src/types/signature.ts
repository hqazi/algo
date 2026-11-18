/**
 * A problem's function signature in neutral types (SPEC §5.1, §5.2).
 * Names are snake_case; each language harness converts to its own convention.
 */
import { z } from 'zod';
import { parseType, TypeParseError } from './neutral';

/** Languages a problem can be offered in. Only Python has a harness in v1. */
export const LANGUAGES = ['python', 'rust', 'go'] as const;
export type Language = (typeof LANGUAGES)[number];

// Names that cannot be Python identifiers. Rust and Go keywords are escaped or
// renamed by their harness generators (T15), so they are not rejected here.
const PYTHON_KEYWORDS = new Set([
  'False',
  'None',
  'True',
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield',
]);

const SNAKE_CASE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

export const identifierSchema = z
  .string()
  .regex(SNAKE_CASE, 'must be snake_case (lowercase letters, digits, single underscores)')
  .refine((s) => !PYTHON_KEYWORDS.has(s), 'is a reserved word');

export const typeStringSchema = z.string().superRefine((s, ctx) => {
  try {
    parseType(s);
  } catch (e) {
    if (!(e instanceof TypeParseError)) throw e;
    ctx.addIssue({ code: 'custom', message: e.message });
  }
});

export const signatureSchema = z
  .strictObject({
    function: identifierSchema,
    params: z.array(z.strictObject({ name: identifierSchema, type: typeStringSchema })),
    returns: typeStringSchema,
  })
  .superRefine((sig, ctx) => {
    const seen = new Set<string>();
    sig.params.forEach((p, i) => {
      if (seen.has(p.name)) {
        ctx.addIssue({
          code: 'custom',
          path: ['params', i, 'name'],
          message: `duplicate parameter "${p.name}"`,
        });
      }
      seen.add(p.name);
    });
  });

export type Signature = z.infer<typeof signatureSchema>;
export type Param = Signature['params'][number];

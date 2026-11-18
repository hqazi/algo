/**
 * zod schemas for problem format v2 (SPEC §5.1): `meta.json` and `tests.json`.
 *
 * These check each file's shape. Checks that need both files (test inputs
 * against the signature, compare mode against the return type) are in
 * `validate.ts`. JSON Schema versions for editors live in `content/schema/`
 * (`npm run schema:export`).
 */
import { z } from 'zod';
import { LANGUAGES, signatureSchema } from '../types/signature';

export const SCHEMA_VERSION = 2;

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export const SOURCES = ['curated', 'generated', 'pasted', 'imported'] as const;
export const MIN_VISIBLE_TESTS = 2;
export const MIN_HIDDEN_TESTS = 3;

export type Difficulty = (typeof DIFFICULTIES)[number];
export type ProblemSource = (typeof SOURCES)[number];

const slugSchema = z.string().regex(SLUG_RE, 'must be lowercase words joined by hyphens');
const text = z.string().trim().min(1, 'must not be empty');

export const compareSpecSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.enum(['exact', 'unordered', 'unordered_deep']) }),
  z.strictObject({ mode: z.literal('float'), tolerance: z.number().positive().optional() }),
]);

/**
 * Where a pasted or imported problem came from (as in dsa-tutor). For `paste`
 * only `kind` is required; for `open-set` every field is.
 */
export const originSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('paste'),
    name: text.optional(),
    url: z.url({ protocol: /^https?$/ }).optional(),
    license: text.optional(),
    attribution: text.optional(),
  }),
  z.strictObject({
    kind: z.literal('open-set'),
    name: text,
    url: z.url({ protocol: /^https?$/ }),
    license: text,
    attribution: text,
  }),
]);

const ORIGIN_SOURCE = { paste: 'pasted', 'open-set': 'imported' } as const;

export const metaSchema = z
  .strictObject({
    schema_version: z.literal(SCHEMA_VERSION),
    slug: slugSchema,
    title: text,
    topic: slugSchema,
    difficulty: z.enum(DIFFICULTIES),
    source: z.enum(SOURCES),
    origin: originSchema.optional(),
    content_version: z.int().positive(),
    created_at: z.iso.datetime().optional(),
    expected_complexity: z.strictObject({ time: text, space: text }),
    compare: compareSpecSchema,
    time_limit_ms: z.int().positive(),
    signature: signatureSchema,
    languages: z
      .array(z.enum(LANGUAGES))
      .min(1)
      .refine((l) => new Set(l).size === l.length, 'must not repeat a language'),
  })
  .superRefine((meta, ctx) => {
    const { source, origin } = meta;
    if (origin === undefined) {
      if (source === 'pasted' || source === 'imported') {
        ctx.addIssue({
          code: 'custom',
          path: ['origin'],
          message: `${source === 'imported' ? 'an' : 'a'} ${source} problem needs an origin`,
        });
      }
    } else if (ORIGIN_SOURCE[origin.kind] !== source) {
      ctx.addIssue({
        code: 'custom',
        path: ['origin', 'kind'],
        message: `origin.kind "${origin.kind}" belongs to source "${ORIGIN_SOURCE[origin.kind]}", not "${source}"`,
      });
    }
  });

export const testCaseSchema = z.strictObject({
  id: slugSchema,
  visibility: z.enum(['visible', 'hidden']),
  category: z.string().optional(),
  input: z.record(z.string(), z.unknown()),
  // Required (zod treats a missing key as an error); `null` is a real value.
  expected: z.unknown(),
  explanation: z.string().optional(),
});

export const testsFileSchema = z
  .strictObject({
    schema_version: z.literal(SCHEMA_VERSION),
    tests: z.array(testCaseSchema),
  })
  .superRefine(({ tests }, ctx) => {
    const ids = new Set<string>();
    let visible = 0;
    let hidden = 0;
    tests.forEach((t, i) => {
      if (ids.has(t.id))
        ctx.addIssue({
          code: 'custom',
          path: ['tests', i, 'id'],
          message: `duplicate test id "${t.id}"`,
        });
      ids.add(t.id);
      if (t.visibility === 'visible') {
        visible++;
      } else {
        hidden++;
        if (!t.category?.trim()) {
          ctx.addIssue({
            code: 'custom',
            path: ['tests', i, 'category'],
            message: "hidden tests need a category such as 'empty input'",
          });
        }
      }
    });
    if (visible < MIN_VISIBLE_TESTS) {
      ctx.addIssue({
        code: 'custom',
        path: ['tests'],
        message: `needs at least ${MIN_VISIBLE_TESTS} visible tests`,
      });
    }
    if (hidden < MIN_HIDDEN_TESTS) {
      ctx.addIssue({
        code: 'custom',
        path: ['tests'],
        message: `needs at least ${MIN_HIDDEN_TESTS} hidden tests`,
      });
    }
  });

export type ProblemMeta = z.infer<typeof metaSchema>;
export type ProblemOrigin = z.infer<typeof originSchema>;
export type TestCase = z.infer<typeof testCaseSchema>;
export type TestsFile = z.infer<typeof testsFileSchema>;

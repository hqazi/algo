/**
 * JSON Schema versions of the problem file schemas, for editors and other
 * tools. Written to `content/schema/` by `npm run schema:export`; a test
 * fails when the checked-in files are out of date.
 *
 * JSON Schema covers each file's shape only. The cross-file checks (values
 * against neutral types, test counts, unique ids) run in `loadProblem`.
 */
import { z } from 'zod';
import { metaSchema, testsFileSchema } from './schema';

const BASE_ID = 'https://github.com/hqazi/algo/blob/main/content/schema/';

export const SCHEMA_FILES = {
  'meta.v2.schema.json': { schema: metaSchema, title: 'Algo problem meta.json (v2)' },
  'tests.v2.schema.json': {
    schema: testsFileSchema,
    title: 'Algo problem tests.json (v2)',
  },
} as const;

/** File name → JSON Schema document. */
export function problemJsonSchemas(): Record<keyof typeof SCHEMA_FILES, Record<string, unknown>> {
  const out = {} as Record<keyof typeof SCHEMA_FILES, Record<string, unknown>>;
  for (const [file, { schema, title }] of Object.entries(SCHEMA_FILES)) {
    const json = z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'any' });
    out[file as keyof typeof SCHEMA_FILES] = { ...json, $id: BASE_ID + file, title };
  }
  return out;
}

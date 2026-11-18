import { describe, expect, it } from 'vitest';
import { problemJsonSchemas } from './json-schema';
import metaSchemaFile from '../../../../content/schema/meta.v2.schema.json';
import testsSchemaFile from '../../../../content/schema/tests.v2.schema.json';

describe('content/schema', () => {
  it('is up to date with the zod schemas (run `npm run schema:export` if not)', () => {
    const schemas = problemJsonSchemas();
    expect(metaSchemaFile).toEqual(schemas['meta.v2.schema.json']);
    expect(testsSchemaFile).toEqual(schemas['tests.v2.schema.json']);
  });

  it('describes the v2 files', () => {
    const meta = problemJsonSchemas()['meta.v2.schema.json'];
    expect(meta.title).toMatch(/meta\.json/);
    expect(meta.required).toEqual(
      expect.arrayContaining(['schema_version', 'signature', 'languages', 'time_limit_ms']),
    );
  });
});

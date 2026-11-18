/**
 * Write the JSON Schemas for problem files to content/schema/.
 * Run with `npm run schema:export` after changing packages/core/src/problems/schema.ts.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { problemJsonSchemas } from '../packages/core/src/problems/json-schema';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'content', 'schema');
mkdirSync(outDir, { recursive: true });
for (const [file, schema] of Object.entries(problemJsonSchemas())) {
  const path = join(outDir, file);
  const options = (await resolveConfig(path)) ?? {};
  writeFileSync(path, await format(JSON.stringify(schema), { ...options, filepath: path }));
  console.log(`wrote content/schema/${file}`);
}

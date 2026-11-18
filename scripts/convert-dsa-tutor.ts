/**
 * One-off: convert `dsa-tutor`'s curated problems to format v2 (T04).
 *
 *   npx tsx scripts/convert-dsa-tutor.ts [../dsa-tutor] [--force]
 *
 * Reads `<dsa-tutor>/problems/curated/<topic>/<slug>/` and writes
 * `content/problems/<topic>/<slug>/`. See `scripts/convert/dsa-tutor.ts` for
 * what changes. Every converted problem is loaded back through core's
 * validator; the script exits 1 on any error. `time_limit_ms` is the minimum
 * (2000 ms): every reference was measured well under it (DECISIONS D-15), and
 * `npm run validate:content` re-measures it on every run.
 */
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { loadProblem, parseJson, timeLimitFromReference } from '../packages/core/src/index';
import {
  convertMeta,
  convertStatement,
  convertTests,
  type V1Meta,
  type V1TestsFile,
} from './convert/dsa-tutor';
import { readTopics } from './content/topics';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'content', 'problems');

const args = process.argv.slice(2);
const force = args.includes('--force');
const source = resolve(args.find((a) => !a.startsWith('--')) ?? join(ROOT, '..', 'dsa-tutor'));
const curated = join(source, 'problems', 'curated');
if (!existsSync(curated)) {
  console.error(`no ${curated}; pass the dsa-tutor checkout (docs/CONTEXT.md)`);
  process.exit(1);
}
if (existsSync(OUT) && !force) {
  console.error('content/problems exists; pass --force to replace it');
  process.exit(1);
}
await rm(OUT, { recursive: true, force: true });

const topics = await readTopics(join(ROOT, 'content', 'references', 'topics.md'));
const reader = { readText: (p: string) => readFile(p, 'utf8').catch(() => null) };

async function writeJson(path: string, value: unknown): Promise<void> {
  const options = (await resolveConfig(path)) ?? {};
  await writeFile(path, await format(JSON.stringify(value), { ...options, filepath: path }));
}

let count = 0;
const errors: string[] = [];
for (const topic of (await readdir(curated)).sort()) {
  for (const slug of (await readdir(join(curated, topic))).sort()) {
    const from = join(curated, topic, slug);
    const to = join(OUT, topic, slug);
    try {
      const meta = parseJson(await readFile(join(from, 'meta.json'), 'utf8')) as unknown as V1Meta;
      const tests = parseJson(
        await readFile(join(from, 'tests.json'), 'utf8'),
      ) as unknown as V1TestsFile;
      if (meta.topic !== topic) throw new Error(`topic "${meta.topic}" but folder "${topic}"`);
      const extra = (await readdir(from)).filter(
        (f) => !['meta.json', 'tests.json', 'problem.md', 'reference.py'].includes(f),
      );
      if (extra.length) throw new Error(`unexpected files: ${extra.join(', ')}`);

      await mkdir(to, { recursive: true });
      await writeJson(join(to, 'meta.json'), convertMeta(meta, timeLimitFromReference(0)));
      await writeFile(join(to, 'tests.json'), convertTests(tests));
      await writeFile(
        join(to, 'problem.md'),
        convertStatement(await readFile(join(from, 'problem.md'), 'utf8'), meta, tests.tests),
      );
      await copyFile(join(from, 'reference.py'), join(to, 'reference.py'));

      const loaded = await loadProblem(reader, to.replaceAll('\\', '/'), { topics });
      if (!loaded.ok) throw new Error(loaded.errors.join('\n  '));
      count += 1;
    } catch (e) {
      errors.push(`${topic}/${slug}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

for (const e of errors) console.error(e);
console.log(`converted ${count} problems${errors.length ? `, ${errors.length} failed` : ''}`);
process.exit(errors.length ? 1 : 0);

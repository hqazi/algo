/**
 * `npm run check:deps` (D-48): every version in `package-lock.json` must have
 * been on the npm registry for at least 14 days (D-45). Hijacked releases are
 * usually found and pulled within days; waiting keeps them out of the lock.
 *
 * - Reads each package's publish times from registry.npmjs.org and fails if
 *   any locked version is younger than the cooldown, or if a time is missing.
 * - Workspace packages and non-registry sources are skipped.
 * - A lock only ages, so a lock that passes once keeps passing; a failure
 *   means a dependency was added or moved, or the registry could not be read.
 *
 *   npm run check:deps [-- --days 14]
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTRY = 'https://registry.npmjs.org/';
const DAY_MS = 24 * 60 * 60 * 1000;

interface LockEntry {
  name?: string;
  version?: string;
  resolved?: string;
  link?: boolean;
}

function parseDays(argv: string[]): number {
  const i = argv.indexOf('--days');
  if (i === -1) return 14;
  const days = Number(argv[i + 1]);
  if (!Number.isFinite(days) || days < 0) throw new Error('--days needs a number of days');
  return days;
}

async function main(): Promise<void> {
  const days = parseDays(process.argv.slice(2));
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, LockEntry>;
  };

  const wanted = new Map<string, Set<string>>();
  for (const [path, entry] of Object.entries(lock.packages)) {
    const at = path.lastIndexOf('node_modules/');
    if (at === -1 || entry.link || !entry.version || !entry.resolved?.startsWith(REGISTRY)) {
      continue;
    }
    const name = entry.name ?? path.slice(at + 'node_modules/'.length);
    const versions = wanted.get(name) ?? new Set<string>();
    versions.add(entry.version);
    wanted.set(name, versions);
  }

  const cutoff = Date.now() - days * DAY_MS;
  const young: string[] = [];
  const failed: string[] = [];
  let checked = 0;

  async function check(name: string): Promise<void> {
    let times: Record<string, string>;
    try {
      const res = await fetch(REGISTRY + name.replace('/', '%2F'));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      times = ((await res.json()) as { time?: Record<string, string> }).time ?? {};
    } catch (err) {
      failed.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    for (const version of wanted.get(name) ?? []) {
      checked++;
      const published = Date.parse(times[version] ?? '');
      if (Number.isNaN(published)) failed.push(`${name}@${version}: no publish time`);
      else if (published > cutoff) young.push(`${name}@${version} (published ${times[version]})`);
    }
  }

  const names = [...wanted.keys()].sort();
  for (let i = 0; i < names.length; i += 16) {
    await Promise.all(names.slice(i, i + 16).map(check));
  }

  console.log(
    `Checked ${checked} versions of ${names.length} packages against a ${days}-day cooldown ` +
      `(published before ${new Date(cutoff).toISOString()}).`,
  );
  if (young.length > 0) {
    console.error(`\nYounger than ${days} days:\n  ${young.sort().join('\n  ')}`);
    console.error(
      `\nPin each to its newest version at least ${days} days old, then regenerate the lock ` +
        `with npm install --before=${new Date(cutoff).toISOString().slice(0, 10)} (D-45).`,
    );
  }
  if (failed.length > 0) console.error(`\nCould not check:\n  ${failed.sort().join('\n  ')}`);
  if (young.length > 0 || failed.length > 0) process.exit(1);
  console.log('All locked versions are old enough.');
}

await main();

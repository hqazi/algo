/**
 * Explanation pages on disk (SPEC §4.1): `explanations/<slug>/<version>.html`,
 * one file per rendered version, newest `KEEP` per problem. A version id is
 * the UTC render time, `YYYYMMDDTHHMMSSmmmZ` (as `dsa-tutor`'s history, at
 * millisecond precision), so ids sort by age. Ported from
 * `dsa-tutor/dsa_tutor/core/explanations.py` (history part).
 */
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SLUG_RE } from '@algo/core';

export const KEEP = 20;
export const VERSION_RE = /^\d{8}T\d{9}Z$/;

export interface ExplanationVersion {
  id: string;
  /** ISO time it was rendered (seconds). */
  created_at: string;
  latest: boolean;
}

function versionId(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace('.', '');
}

export function versionTime(id: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\d{3}Z$/.exec(id);
  if (!m) throw new Error(`not a version id: ${id}`);
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

function checkSlug(slug: string): void {
  if (!SLUG_RE.test(slug) || slug.length > 80) throw new Error(`invalid slug: ${slug}`);
}

export class ExplanationStore {
  constructor(
    private readonly dir: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private folder(slug: string): string {
    checkSlug(slug);
    return join(this.dir, slug);
  }

  /** Version ids, newest first. */
  async versions(slug: string): Promise<string[]> {
    let names: string[];
    try {
      names = await readdir(this.folder(slug));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
    return names
      .filter((n) => n.endsWith('.html') && VERSION_RE.test(n.slice(0, -5)))
      .map((n) => n.slice(0, -5))
      .sort()
      .reverse();
  }

  async list(slug: string): Promise<ExplanationVersion[]> {
    return (await this.versions(slug)).map((id, i) => ({
      id,
      created_at: versionTime(id),
      latest: i === 0,
    }));
  }

  /** Writes a new version (atomically) and prunes old ones; returns its id. */
  async save(slug: string, html: string): Promise<string> {
    const folder = this.folder(slug);
    await mkdir(folder, { recursive: true });
    const existing = new Set(await this.versions(slug));
    let when = this.clock().getTime();
    const newest = [...existing].sort().at(-1);
    let id = versionId(new Date(when));
    while (existing.has(id) || (newest !== undefined && id <= newest))
      id = versionId(new Date(++when));
    const tmp = join(folder, `.${id}.tmp`);
    await writeFile(tmp, html, 'utf8');
    await rename(tmp, join(folder, `${id}.html`));
    for (const old of (await this.versions(slug)).slice(KEEP))
      await unlink(join(folder, `${old}.html`)).catch(() => undefined);
    return id;
  }

  /** A version's HTML (the latest without `version`), or `null`. */
  async read(slug: string, version?: string | null): Promise<{ id: string; html: string } | null> {
    const id = version ?? (await this.versions(slug))[0];
    if (!id) return null;
    if (!VERSION_RE.test(id)) throw new Error(`invalid version: ${id}`);
    try {
      return { id, html: await readFile(join(this.folder(slug), `${id}.html`), 'utf8') };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }
}

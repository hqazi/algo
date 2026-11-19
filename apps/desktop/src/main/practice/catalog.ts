/**
 * The problem catalog over files (SPEC §5.3): curated problems from the
 * app's `content/problems/<topic>/<slug>/`, plus generated and imported ones
 * from the data folder (`problems/generated/<slug>/`, `problems/imported/<slug>/`,
 * written by T12). Implements core's `ProblemCatalog`.
 *
 * Everything is loaded and validated once at start-up (50 small folders);
 * `reload()` picks up new problems. A problem that fails validation is left
 * out and reported, never half-loaded. Each load also refreshes the `problems`
 * index in `tutor.db`, so attempts on a problem removed by an update keep
 * their topic (DECISIONS D-21).
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  catalogOrder,
  loadProblem,
  parseTopics,
  summaryOf,
  type Problem,
  type ProblemCatalog,
  type ProblemSummary,
  type Storage,
  type Topic,
} from '@algorithm-tutor/core';

export interface CatalogDirs {
  /** The app's `content/` folder (read-only). */
  content: string;
  /** The data folder (generated and imported problems live under it). */
  dataDir: string;
}

export interface CatalogIssue {
  where: string;
  message: string;
}

const reader = { readText: (p: string) => readFile(p, 'utf8').catch(() => null) };
const posix = (p: string): string => p.replaceAll('\\', '/');

async function subdirs(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

export class FileCatalog implements ProblemCatalog {
  private topicRows: Topic[] = [];
  private bySlug = new Map<string, Problem>();
  private order: ProblemSummary[] = [];
  /** Problems left out at the last load, and why. */
  issues: CatalogIssue[] = [];

  private constructor(
    private readonly dirs: CatalogDirs,
    private readonly now: () => string,
    private readonly storage?: Storage,
  ) {}

  /** Loads the topics and every problem; throws only if `topics.md` cannot be read or parsed. */
  static async open(dirs: CatalogDirs, now: () => string, storage?: Storage): Promise<FileCatalog> {
    const catalog = new FileCatalog(dirs, now, storage);
    await catalog.reload();
    return catalog;
  }

  topics(): readonly Topic[] {
    return this.topicRows;
  }

  list(): readonly ProblemSummary[] {
    return this.order;
  }

  load(slug: string): Promise<Problem | null> {
    return Promise.resolve(this.bySlug.get(slug) ?? null);
  }

  /** Read everything again (e.g. after a problem was added). */
  async reload(): Promise<void> {
    const topicsPath = join(this.dirs.content, 'references', 'topics.md');
    const topics = parseTopics(await readFile(topicsPath, 'utf8'));
    const known = new Set(topics.map((t) => t.id));
    const issues: CatalogIssue[] = [];
    const found = new Map<string, { problem: Problem; path: string }>();

    const add = async (dir: string, base: string, expect?: { source: string }): Promise<void> => {
      const where = posix(relative(base, dir));
      const loaded = await loadProblem(reader, posix(dir), { topics: known });
      if (!loaded.ok) {
        issues.push({ where, message: loaded.errors.join('; ') });
        return;
      }
      const p = loaded.problem;
      if (expect && p.meta.source === 'curated') {
        issues.push({ where, message: `a problem in the data folder cannot be curated` });
        return;
      }
      if (!expect && p.meta.source !== 'curated') {
        issues.push({ where, message: `a problem in content/ must be curated` });
        return;
      }
      if (found.has(p.meta.slug)) {
        issues.push({ where, message: `slug "${p.meta.slug}" is already used` });
        return;
      }
      found.set(p.meta.slug, { problem: p, path: where });
    };

    const curated = join(this.dirs.content, 'problems');
    for (const topic of await subdirs(curated))
      for (const slug of await subdirs(join(curated, topic)))
        await add(join(curated, topic, slug), this.dirs.content);
    for (const kind of ['generated', 'imported'] as const) {
      const root = join(this.dirs.dataDir, 'problems', kind);
      for (const slug of await subdirs(root))
        await add(join(root, slug), this.dirs.dataDir, { source: kind });
    }

    this.topicRows = topics;
    this.bySlug = new Map([...found].map(([slug, f]) => [slug, f.problem]));
    this.order = [...this.bySlug.values()].map(summaryOf).sort(catalogOrder);
    this.issues = issues;
    await this.index(found);
  }

  /** Keep the `problems` table in step with what loaded (only adds and updates: history stays). */
  private async index(found: Map<string, { problem: Problem; path: string }>): Promise<void> {
    if (!this.storage) return;
    const now = this.now();
    await this.storage.write((db) => {
      for (const { problem, path } of found.values()) {
        const m = problem.meta;
        const old = db.getProblem(m.slug);
        if (
          old &&
          old.contentVersion === m.content_version &&
          old.path === path &&
          old.title === m.title &&
          old.topic === m.topic &&
          old.difficulty === m.difficulty &&
          old.source === m.source
        )
          continue;
        db.saveProblem({
          slug: m.slug,
          source: m.source,
          topic: m.topic,
          difficulty: m.difficulty,
          title: m.title,
          path,
          contentVersion: m.content_version,
          createdAt: old?.createdAt ?? m.created_at ?? now,
        });
      }
    });
  }
}

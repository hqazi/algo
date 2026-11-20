/**
 * New problems in the main process (SPEC §5.3, §6.3, T12): the problem
 * factory behind `create_problem` (self-check in Pyodide, files written to
 * `problems/generated/` or `problems/imported/`), the Exercism open set with
 * its fetcher, and the intake jobs the New Problem dialog starts.
 *
 * Model-written code (references, brute forces) runs only in the Pyodide
 * executor: the factory is handed `executors`, asks it for `pyodide` only,
 * and refuses anything else (core `createProblem`).
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createProblem,
  ExercismImporter,
  IntakeService,
  OpenSets,
  originSchema,
  RAW_HOST,
  type CreateOptions,
  type ExercismIndex,
  type Executor,
  type ExecutorId,
  type OpenSetEntry,
  type ProblemKind,
  type ProblemWriter,
  type ToolOutput,
  type TutorBackend,
  type TutorToolContext,
} from '@algo/core';
import type { FileCatalog } from '../practice/catalog';
import { Fetcher, type FetchFn } from './fetch';

export { Fetcher } from './fetch';

/** Writes a problem folder atomically: staged, then renamed into place. */
export class FileProblemWriter implements ProblemWriter {
  constructor(private readonly dataDir: string) {}

  async write(kind: ProblemKind, slug: string, files: Record<string, string>): Promise<void> {
    const root = join(this.dataDir, 'problems');
    const target = join(root, kind, slug);
    if (existsSync(target)) throw new Error(`problem folder ${kind}/${slug} exists already`);
    const staging = join(root, '.staging', `${slug}-${randomBytes(6).toString('hex')}`);
    await mkdir(staging, { recursive: true });
    try {
      for (const [name, text] of Object.entries(files)) {
        if (!/^[A-Za-z_]+\.(?:json|md|py)$/.test(name)) throw new Error(`bad file name ${name}`);
        await writeFile(join(staging, name), text, 'utf8');
      }
      await mkdir(join(root, kind), { recursive: true });
      await rename(staging, target);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
}

export interface ProblemFactoryDeps {
  catalog: FileCatalog;
  dataDir: string;
  executors: (id: ExecutorId) => Executor | null;
  now: () => string;
}

export type CreateFn = (
  spec: Record<string, unknown>,
  options: CreateOptions,
) => Promise<ToolOutput>;

/** `createProblem` over the app's catalog, Pyodide and data folder; reloads the catalog after a write. */
export function problemFactory(deps: ProblemFactoryDeps): CreateFn {
  const writer = new FileProblemWriter(deps.dataDir);
  return (spec, options) =>
    createProblem(
      {
        topics: () => deps.catalog.topics(),
        taken: (slug) =>
          deps.catalog.list().some((p) => p.slug === slug) ||
          ['generated', 'imported'].some((k) =>
            existsSync(join(deps.dataDir, 'problems', k, slug)),
          ),
        executors: deps.executors,
        writer,
        now: deps.now,
        created: () => deps.catalog.reload(),
      },
      spec,
      options,
    );
}

/** The chat tutor's `create_problem` (SPEC §7.1): an origin, if any, must be a valid one. */
export function chatCreateProblem(
  create: CreateFn,
): NonNullable<TutorToolContext['createProblem']> {
  return (spec, origin) => {
    if (origin === undefined) return create(spec, {});
    const parsed = originSchema.safeParse(origin);
    if (!parsed.success)
      return Promise.resolve({
        ok: false,
        error: 'invalid spec',
        problems: parsed.error.issues.map((i) => `origin: ${i.message}`),
      });
    return create(spec, { origin: parsed.data });
  };
}

export interface OpenSetFiles {
  contentDir: string;
  cacheDir: string;
  topics: ReadonlySet<string>;
  fetch?: FetchFn;
}

/** The open sets this build ships: Exercism, from `content/open-sets/exercism/`. */
export async function openSets(opts: OpenSetFiles): Promise<{ sets: OpenSets; fetcher: Fetcher }> {
  const dir = join(opts.contentDir, 'open-sets', 'exercism');
  const index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')) as ExercismIndex;
  const license = await readFile(join(dir, 'LICENSE.txt'), 'utf8');
  const fetcherOptions: ConstructorParameters<typeof Fetcher>[0] = {
    allowedHosts: [RAW_HOST],
    cacheDir: join(opts.cacheDir, 'open-sets'),
  };
  if (opts.fetch) fetcherOptions.fetch = opts.fetch;
  const fetcher = new Fetcher(fetcherOptions);
  const exercism = new ExercismImporter(index, license, (url) => fetcher.getText(url), opts.topics);
  return { sets: new OpenSets([exercism]), fetcher };
}

export interface IntakeAppDeps {
  catalog: FileCatalog;
  create: CreateFn;
  sets: OpenSets;
  backend: () => TutorBackend;
  tools: { get(name: string): unknown };
  guides: Record<string, string>;
  guard?: TutorToolContext['guard'];
  log?: (message: string, error?: unknown) => void;
}

export interface AppIntake {
  service: IntakeService;
  sets: OpenSets;
  /** The set's entries, each with the slug of a problem already imported from it. */
  entries(setId: string): Promise<(OpenSetEntry & { imported: string | null })[]>;
}

export function openIntake(deps: IntakeAppDeps): AppIntake {
  const service = new IntakeService({
    backend: deps.backend,
    tools: deps.tools as ConstructorParameters<typeof IntakeService>[0]['tools'],
    create: deps.create,
    topics: () => deps.catalog.topics(),
    slugs: () => deps.catalog.list().map((p) => p.slug),
    openSets: deps.sets,
    guides: deps.guides,
    ...(deps.guard ? { guard: deps.guard } : {}),
    newId: () => `job_${randomBytes(12).toString('hex')}`,
    schedule: (ms, fn) => {
      const t = setTimeout(fn, ms);
      t.unref?.();
      return () => clearTimeout(t);
    },
    clock: () => Date.now(),
    log: (m, e) => (deps.log ?? ((x: string, y?: unknown) => console.warn(x, y ?? '')))(m, e),
  });
  return {
    service,
    sets: deps.sets,
    async entries(setId) {
      const importer = deps.sets.get(setId);
      const byUrl = new Map<string, string>();
      for (const p of deps.catalog.list()) {
        if (p.source !== 'imported') continue;
        const origin = (await deps.catalog.load(p.slug))?.meta.origin;
        if (origin?.kind === 'open-set') byUrl.set(origin.url, p.slug);
      }
      return importer.list().map((e) => ({ ...e, imported: byUrl.get(e.url) ?? null }));
    },
  };
}

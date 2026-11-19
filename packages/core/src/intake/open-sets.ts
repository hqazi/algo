/**
 * Open problem sets that can be imported (SPEC §5.3). Ported from
 * `dsa-tutor/dsa_tutor/intake/open_sets/`.
 *
 *   sets.get('exercism').list()           entries, no network
 *   await sets.get('exercism').fetch(id)  title, description, cases, licence, url, attribution
 *
 * v1 ships one importer, Exercism `problem-specifications` (MIT), pinned to
 * one commit. Its index and licence text live in `content/open-sets/exercism/`
 * and are read by the main process, which also does all fetching
 * (`raw.githubusercontent.com` only; `main/intake/fetch.ts`). The model never
 * fetches anything: there is no tool for it and no "fetch by URL" feature.
 * Everything fetched is untrusted data: the intake job passes it to the model
 * inside `<problem_text source="open-set">`.
 */
import { DIFFICULTIES, SLUG_RE, type Difficulty, type ProblemOrigin } from '../problems/schema';
import { parseJson, stringifyJson } from '../types/json';

export const SET_ID_RE = SLUG_RE;
export const EXERCISM_REPO = 'exercism/problem-specifications';
export const RAW_HOST = 'raw.githubusercontent.com';
export const DESCRIPTION_FILES = ['introduction.md', 'instructions.md', 'description.md'] as const;
export const MAX_DESCRIPTION_CHARS = 30_000;
export const MAX_CASES = 80;
export const MAX_CASES_CHARS = 40_000;

/** An unknown set or entry (`unknown_set`, `unknown_entry`), or a failed fetch (`fetch`). */
export class OpenSetError extends Error {
  constructor(
    readonly code: 'unknown_set' | 'unknown_entry' | 'fetch',
    message: string,
  ) {
    super(message);
    this.name = 'OpenSetError';
  }
}

/** What the main process's fetcher throws. `code` says why. */
export class FetchError extends Error {
  constructor(
    readonly code:
      | 'not_allowed'
      | 'redirect_refused'
      | 'too_many_redirects'
      | 'not_found'
      | 'http'
      | 'too_large'
      | 'timeout'
      | 'network',
    message: string,
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

/** Fetches a URL's body as text; throws `FetchError`. */
export type FetchText = (url: string) => Promise<string>;

export interface OpenSetEntry {
  id: string;
  title: string;
  blurb: string;
  topic: string;
  difficulty: Difficulty;
  /** The entry's page in the set (also `meta.origin.url` once imported). */
  url: string;
}

export interface OpenSetSummary {
  id: string;
  name: string;
  url: string;
  license: string;
  attribution: string;
  entries: number;
}

export interface OpenSetCase {
  description: string;
  input: Record<string, unknown>;
  expected: unknown;
}

export interface OpenSetProblem {
  setId: string;
  id: string;
  title: string;
  /** Markdown, as the set has it. */
  description: string;
  cases: OpenSetCase[];
  license: string;
  url: string;
  attribution: string;
  /** `meta.origin.name`. */
  name: string;
  /** The function the cases exercise, in the set's naming. */
  property?: string;
  /** The licence text to keep beside the imported problem. */
  licenseText: string;
  droppedCases: number;
}

export interface OpenSetImporter {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly license: string;
  readonly attribution: string;
  list(): readonly OpenSetEntry[];
  /** Throws `OpenSetError` (`unknown_entry` or `fetch`). */
  fetch(entryId: string): Promise<OpenSetProblem>;
}

/** The complete `meta.origin` of a problem imported from this entry. */
export function originOf(p: OpenSetProblem): ProblemOrigin {
  return {
    kind: 'open-set',
    name: p.name,
    url: p.url,
    license: p.license,
    attribution: p.attribution,
  };
}

/** `NOTICE.md`: the licence and attribution kept beside an imported problem. */
export function noticeOf(p: OpenSetProblem): string {
  const lines = [
    `# ${p.title}`,
    '',
    `Imported from ${p.name}: ${p.url}`,
    '',
    `Licence: ${p.license}. ${p.attribution}`,
    '',
  ];
  if (p.licenseText.trim())
    lines.push("The set's licence:", '', '```', p.licenseText.trim(), '```', '');
  return lines.join('\n');
}

export function entryOf(importer: OpenSetImporter, entryId: string): OpenSetEntry {
  const e = importer.list().find((x) => x.id === entryId);
  if (!e) throw new OpenSetError('unknown_entry', `${importer.name} has no entry "${entryId}"`);
  return e;
}

export function summaryOfSet(importer: OpenSetImporter): OpenSetSummary {
  return {
    id: importer.id,
    name: importer.name,
    url: importer.url,
    license: importer.license,
    attribution: importer.attribution,
    entries: importer.list().length,
  };
}

/** The importers by id, in display order. */
export class OpenSets {
  private readonly byId: Map<string, OpenSetImporter>;

  constructor(importers: readonly OpenSetImporter[]) {
    this.byId = new Map(importers.map((i) => [i.id, i]));
  }

  get(setId: string): OpenSetImporter {
    const importer = SET_ID_RE.test(setId) ? this.byId.get(setId) : undefined;
    if (!importer) throw new OpenSetError('unknown_set', `no open set "${setId}"`);
    return importer;
  }

  summaries(): OpenSetSummary[] {
    return [...this.byId.values()].map(summaryOfSet);
  }
}

// ---------------------------------------------------------------- Exercism

interface IndexEntry {
  id: string;
  title: string;
  blurb?: string;
  topic: string;
  difficulty: string;
  property?: string;
  files: string[];
  source?: string;
  source_url?: string;
}

export interface ExercismIndex {
  commit: string;
  entries: IndexEntry[];
}

type RawCase = Record<string, unknown>;
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Leaf cases of canonical-data, depth first, group descriptions joined by " / ". */
export function flattenCases(cases: unknown, prefix = ''): RawCase[] {
  const out: RawCase[] = [];
  for (const c of Array.isArray(cases) ? cases : []) {
    if (!isObj(c)) continue;
    const desc = typeof c.description === 'string' ? c.description.trim() : '';
    const label = prefix && desc ? `${prefix} / ${desc}` : desc || prefix;
    if (Array.isArray(c.cases)) out.push(...flattenCases(c.cases, label));
    else if ('input' in c && 'expected' in c && 'property' in c)
      out.push({ ...c, description: label });
  }
  return out;
}

/**
 * The cases the model gets: the newest version of each (`reimplements` drops
 * the old uuid), one property, inputs as objects, within the caps.
 */
export function selectCases(
  data: Record<string, unknown>,
  property: string | undefined,
): { cases: OpenSetCase[]; dropped: number } {
  const leaves = flattenCases(data.cases);
  const replaced = new Set(
    leaves.map((c) => c.reimplements).filter((r): r is string => typeof r === 'string'),
  );
  const picked: OpenSetCase[] = [];
  for (const c of leaves) {
    if (typeof c.uuid === 'string' && replaced.has(c.uuid)) continue;
    if (property && c.property !== property) continue;
    if (!isObj(c.input)) continue;
    picked.push({ description: String(c.description), input: c.input, expected: c.expected });
  }
  const kept: OpenSetCase[] = [];
  let size = 0;
  for (const c of picked.slice(0, MAX_CASES)) {
    size += stringifyJson(c).length;
    if (size > MAX_CASES_CHARS) break;
    kept.push(c);
  }
  return { cases: kept, dropped: picked.length - kept.length };
}

/**
 * Exercism `problem-specifications` (MIT), pinned to the index's commit
 * (DECISIONS D-26 records the licence check). The index lists exercises that
 * fit one function with JSON inputs, each with a suggested topic and
 * difficulty and the canonical-data `property` to use; exercises whose
 * source is a problem site with other terms are left out.
 */
export class ExercismImporter implements OpenSetImporter {
  readonly id = 'exercism';
  readonly name = 'Exercism problem-specifications';
  readonly license = 'MIT';
  readonly url = `https://github.com/${EXERCISM_REPO}`;
  readonly attribution: string;
  private readonly entries: { entry: OpenSetEntry; raw: IndexEntry }[];

  constructor(
    private readonly index: ExercismIndex,
    private readonly licenseText: string,
    private readonly fetchText: FetchText,
    topics: ReadonlySet<string>,
  ) {
    if (!/^[0-9a-f]{40}$/.test(index.commit)) throw new Error('exercism index: bad commit');
    const copyright =
      licenseText
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.toLowerCase().startsWith('copyright')) ?? 'Copyright Exercism';
    this.attribution = `${copyright}. Used under the MIT License.`;
    this.entries = index.entries.map((raw) => {
      if (
        !SLUG_RE.test(raw.id) ||
        !topics.has(raw.topic) ||
        !(DIFFICULTIES as readonly string[]).includes(raw.difficulty) ||
        !raw.files.every((f) => (DESCRIPTION_FILES as readonly string[]).includes(f))
      )
        throw new Error(`exercism index: bad entry "${raw.id}"`);
      return {
        raw,
        entry: {
          id: raw.id,
          title: raw.title,
          blurb: raw.blurb ?? '',
          topic: raw.topic,
          difficulty: raw.difficulty as Difficulty,
          url: `https://github.com/${EXERCISM_REPO}/tree/${index.commit}/exercises/${raw.id}`,
        },
      };
    });
  }

  get commit(): string {
    return this.index.commit;
  }

  list(): readonly OpenSetEntry[] {
    return this.entries.map((e) => e.entry);
  }

  rawUrl(entryId: string, file: string): string {
    return `https://${RAW_HOST}/${EXERCISM_REPO}/${this.index.commit}/exercises/${entryId}/${file}`;
  }

  private async get(url: string): Promise<string> {
    try {
      return await this.fetchText(url);
    } catch (e) {
      const why = e instanceof FetchError ? e.message : 'the download failed';
      throw new OpenSetError('fetch', `Could not fetch the exercise from ${this.name}: ${why}.`);
    }
  }

  async fetch(entryId: string): Promise<OpenSetProblem> {
    const found = this.entries.find((e) => e.entry.id === entryId);
    if (!found) throw new OpenSetError('unknown_entry', `${this.name} has no entry "${entryId}"`);
    const { entry, raw } = found;
    const parts: string[] = [];
    for (const file of raw.files) {
      const text = (await this.get(this.rawUrl(entryId, file))).trim();
      if (text) parts.push(text);
    }
    let description = parts.join('\n\n');
    if (description.length > MAX_DESCRIPTION_CHARS)
      description = `${description.slice(0, MAX_DESCRIPTION_CHARS)}\n\n(the rest of the description was cut)`;
    let data: unknown;
    try {
      data = parseJson(await this.get(this.rawUrl(entryId, 'canonical-data.json')));
    } catch (e) {
      if (e instanceof OpenSetError) throw e;
      throw new OpenSetError('fetch', `The test data of ${entry.title} is not valid JSON.`);
    }
    if (!isObj(data))
      throw new OpenSetError('fetch', `The test data of ${entry.title} has an unexpected shape.`);
    const { cases, dropped } = selectCases(data, raw.property);
    if (!description || !cases.length)
      throw new OpenSetError('fetch', `${entry.title} has no description or no usable test cases.`);
    const problem: OpenSetProblem = {
      setId: this.id,
      id: entryId,
      title: entry.title,
      description,
      cases,
      license: this.license,
      url: entry.url,
      attribution: this.attribution + (raw.source ? ` Exercise source: ${raw.source}.` : ''),
      name: `${this.name}: ${entry.title}`,
      licenseText: this.licenseText,
      droppedCases: dropped,
    };
    if (raw.property) problem.property = raw.property;
    return problem;
  }
}

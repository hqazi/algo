/**
 * The topic table in `content/references/topics.md` (SPEC §9.1): ids, names,
 * groups and prerequisites, in teaching order. Ported from
 * `dsa-tutor/dsa_tutor/core/common.py` (`load_topics`), stricter: a bad row
 * or an unknown prerequisite is an error instead of being skipped.
 */
import { SLUG_RE } from '../problems/schema';
import { TutorError } from './errors';

export interface Topic {
  id: string;
  name: string;
  group: string;
  prerequisites: string[];
}

/** Parse the first `| id | name | group | prerequisites | ... |` table. */
export function parseTopics(markdown: string): Topic[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l) => /^\|\s*id\s*\|\s*name\s*\|\s*group\s*\|/.test(l));
  if (start < 0) throw new TutorError('topics.md: no "| id | name | group |" table');
  const rows: Topic[] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    const [id, name, group, prereqs] = line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim().replace(/^`|`$/g, ''));
    if (!id || !name || !group || prereqs === undefined || !SLUG_RE.test(id))
      throw new TutorError(`topics.md: bad row: ${line}`);
    rows.push({
      id,
      name,
      group,
      prerequisites: ['', '-', '—'].includes(prereqs)
        ? []
        : prereqs
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean),
    });
  }
  if (!rows.length) throw new TutorError('topics.md: no topics found');
  const ids = new Set<string>();
  for (const r of rows) {
    if (ids.has(r.id)) throw new TutorError(`topics.md: duplicate topic "${r.id}"`);
    ids.add(r.id);
  }
  for (const r of rows)
    for (const p of r.prerequisites)
      if (!ids.has(p)) throw new TutorError(`topics.md: ${r.id}: unknown prerequisite "${p}"`);
  return rows;
}

/** Topic groups in first-seen order (the onboarding comfort questions). */
export function topicGroups(topics: readonly Topic[]): string[] {
  const out: string[] = [];
  for (const t of topics) if (!out.includes(t.group)) out.push(t.group);
  return out;
}

/**
 * Topic ids from `content/references/topics.md`: the rows of its first table
 * (`| id | name | group | prerequisites | key patterns |`). Enough for the
 * content scripts; the app's own catalog parser comes with T06.
 */
import { readFile } from 'node:fs/promises';

export interface TopicRow {
  id: string;
  name: string;
  group: string;
  prerequisites: string[];
}

export function parseTopics(markdown: string): TopicRow[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((l) => /^\|\s*id\s*\|\s*name\s*\|\s*group\s*\|/.test(l));
  if (start < 0) throw new Error('topics.md: no "| id | name | group |" table');
  const rows: TopicRow[] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    const [id, name, group, prereqs] = line
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim());
    if (!id || !name || !group || prereqs === undefined)
      throw new Error(`topics.md: bad row: ${line}`);
    rows.push({
      id,
      name,
      group,
      prerequisites: prereqs === '-' ? [] : prereqs.split(',').map((p) => p.trim()),
    });
  }
  const ids = new Set(rows.map((r) => r.id));
  for (const r of rows)
    for (const p of r.prerequisites)
      if (!ids.has(p)) throw new Error(`topics.md: ${r.id}: unknown prerequisite "${p}"`);
  return rows;
}

export async function readTopics(path: string): Promise<Set<string>> {
  return new Set(parseTopics(await readFile(path, 'utf8')).map((r) => r.id));
}

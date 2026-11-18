import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTopics } from './topics';

const TOPICS = new URL('../../content/references/topics.md', import.meta.url);

describe('parseTopics', () => {
  it('reads the 15 topics of content/references/topics.md', () => {
    const rows = parseTopics(readFileSync(TOPICS, 'utf8'));
    expect(rows).toHaveLength(15);
    expect(rows[0]).toEqual({
      id: 'arrays-strings',
      name: 'Arrays & strings',
      group: 'basics',
      prerequisites: [],
    });
    expect(rows.find((r) => r.id === 'graphs')?.prerequisites).toEqual(['trees', 'hashing']);
  });

  it('rejects an unknown prerequisite', () => {
    const md =
      '| id | name | group | prerequisites | key patterns |\n|---|---|---|---|---|\n| a | A | g | b | x |\n';
    expect(() => parseTopics(md)).toThrow(/unknown prerequisite "b"/);
  });

  it('needs the table', () => {
    expect(() => parseTopics('# Topics\n')).toThrow(/no "\| id \| name \| group \|" table/);
  });
});

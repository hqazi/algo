import { describe, expect, it } from 'vitest';
import type { AttemptRecord, ProfileRecord } from '../storage';
import type { ProblemSummary } from './catalog';
import { defaultProfile } from './profile';
import { computeTopics, levelFor } from './progress';
import { pickProblem, recommend } from './recommend';
import { parseTopics, topicGroups } from './topics';
import { TOPICS } from './test-support';

const P = (
  slug: string,
  topic: string,
  difficulty: 'easy' | 'medium' = 'easy',
  source: ProblemSummary['source'] = 'curated',
): ProblemSummary => ({ slug, title: slug, topic, difficulty, source, languages: ['python'] });

let id = 0;
const A = (
  slug: string,
  outcome: AttemptRecord['outcome'],
  at = '2026-11-01T00:00:00Z',
): AttemptRecord => ({
  id: ++id,
  slug,
  language: 'python',
  startedAt: at,
  finishedAt: outcome ? at : null,
  passed: null,
  total: null,
  outcome,
  hintsUsed: 0,
  explained: false,
  notes: '',
});

const profile = (over: Partial<ProfileRecord> = {}): ProfileRecord => ({
  ...defaultProfile(TOPICS, '2026-11-01T00:00:00Z'),
  ...over,
});

describe('topics.md', () => {
  it('parses the real table in teaching order', () => {
    expect(TOPICS[0]).toEqual({
      id: 'arrays-strings',
      name: 'Arrays & strings',
      group: 'basics',
      prerequisites: [],
    });
    expect(TOPICS.find((t) => t.id === 'graphs')?.prerequisites).toEqual(['trees', 'hashing']);
    expect(topicGroups(TOPICS)).toEqual([
      'basics',
      'linear',
      'search-sort',
      'recursion-dp',
      'trees-graphs',
    ]);
  });

  it('rejects broken tables', () => {
    const head = '| id | name | group | prerequisites |\n|---|---|---|---|\n';
    expect(() => parseTopics('no table')).toThrow(/no "\| id/);
    expect(() => parseTopics(head)).toThrow(/no topics/);
    expect(() => parseTopics(`${head}| a | A | g | b |\n`)).toThrow(/unknown prerequisite/);
    expect(() => parseTopics(`${head}| a | A | g | - |\n| a | A | g | - |\n`)).toThrow(/duplicate/);
    expect(() => parseTopics(`${head}| Bad Id | A | g | - |\n`)).toThrow(/bad row/);
  });
});

describe('levels', () => {
  it('new, learning, comfortable after three different unaided solves', () => {
    expect(levelFor({ attempted: 0, solved_unaided: 0 })).toBe('new');
    expect(levelFor({ attempted: 1, solved_unaided: 0 })).toBe('learning');
    expect(levelFor({ attempted: 3, solved_unaided: 3 })).toBe('comfortable');
    const topicOf = (s: string): string | null => (s === 'gone' ? null : 't');
    const stats = computeTopics(
      [
        A('a', 'unaided'),
        A('a', 'unaided'),
        A('b', 'with_hints'),
        A('c', null),
        A('gone', 'unaided'),
      ],
      topicOf,
    );
    expect(stats.get('t')).toMatchObject({
      attempted: 3,
      solved: 2,
      solved_unaided: 1,
      level: 'learning',
    });
    expect(stats.size).toBe(1);
  });
});

describe('recommend', () => {
  const base = { topics: TOPICS, attempted: new Set<string>(), unfinished: [] };

  it('a group rated solid meets the prerequisites of topics that depend on it', () => {
    const problems = [P('s1', 'sliding-window'), P('a1', 'arrays-strings')];
    // basics solid: every basics topic counts as met, so the weakest by comfort
    // rank is a non-basics topic whose prerequisites are basics.
    const rec = recommend({
      ...base,
      profile: profile({
        comfort: {
          basics: 'solid',
          linear: 'none',
          'search-sort': 'some',
          'trees-graphs': 'some',
          'recursion-dp': 'some',
        },
      }),
      stats: new Map(),
      problems,
    });
    expect(rec.topic).toBe('stack');
    expect(rec.action).toBe('generate');
  });

  it('when every topic is comfortable, revisits the one practised longest ago', () => {
    const stats = new Map(
      TOPICS.map((t, i) => [
        t.id,
        {
          attempted: 3,
          solved: 3,
          solved_unaided: 3,
          last_practised:
            t.id === 'heaps'
              ? '2026-01-01T00:00:00Z'
              : `2026-06-${String(10 + i).padStart(2, '0')}T00:00:00Z`,
          level: 'comfortable' as const,
        },
      ]),
    );
    const rec = recommend({
      ...base,
      profile: profile({ focusTopic: 'graphs' }),
      stats,
      problems: [P('h', 'heaps', 'medium')],
    });
    expect(rec.topic).toBe('heaps');
    expect(rec.difficulty).toBe('medium');
    expect(rec.reason).toMatch(/^Graphs is comfortable now; every topic is comfortable; Heaps/);
    expect(rec).toMatchObject({ action: 'solve', slug: 'h', focus_changed: true });
  });

  it('a named topic and difficulty win; unfinished slugs are listed', () => {
    const rec = recommend({
      ...base,
      profile: profile({ focusTopic: 'graphs' }),
      stats: new Map(),
      problems: [P('x', 'trees', 'medium')],
      unfinished: ['b', 'a'],
      topic: 'trees',
      difficulty: 'medium',
    });
    expect(rec).toMatchObject({
      topic: 'trees',
      difficulty: 'medium',
      action: 'solve',
      slug: 'x',
      focus_changed: false,
    });
    expect(rec.unfinished).toEqual(['a', 'b']);
    expect(() =>
      recommend({
        ...base,
        profile: profile(),
        stats: new Map(),
        problems: [],
        topic: 'astrology',
      }),
    ).toThrow(/unknown topic/);
  });

  it('picks curated before other sources, unattempted, in the learner language', () => {
    const problems = [P('g', 't', 'easy', 'generated'), P('c2', 't'), P('c1', 't')];
    expect(pickProblem(problems, 't', 'easy', new Set(), 'python')?.slug).toBe('c2');
    expect(pickProblem(problems, 't', 'easy', new Set(['c1', 'c2']), 'python')?.slug).toBe('g');
    expect(pickProblem(problems, 't', 'easy', new Set(), 'rust')).toBeNull();
  });
});

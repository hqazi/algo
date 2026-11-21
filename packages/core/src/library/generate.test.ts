import { describe, expect, it } from 'vitest';
import { buildArticleRegistry, MAX_PASSAGE_PROBLEM_CALLS } from '../tools/article';
import { buildArticleSystemPrompt, PASSAGE_PROBLEM_REQUEST } from '../tools/article-prompt';
import { FakeBackend, type FakeScript } from '../tutor/fake';
import { UnavailableBackend } from '../tutor/backend';
import { parseNote } from './frontmatter';
import {
  ArticleWriter,
  checkArticleRequest,
  checkPlan,
  PLANNER_REMINDER,
  SeriesStopped,
  seriesFooter,
  type WriteProgress,
  cleanArticleBody,
  cleanTags,
  GenerateError,
  renderGeneratedArticle,
  WRITER_REMINDER,
  type ArticleToSave,
} from './generate';

const LONG =
  'A heap keeps the smallest item on top, so a priority queue pops it in log time. '.repeat(5);
const never = { aborted: false, addEventListener: () => {}, removeEventListener: () => {} };

describe('generated article files', () => {
  it('cleans the body: no frontmatter, no repeated title, no images of any kind', () => {
    const body = [
      '---',
      'title: other',
      '---',
      '# Heaps',
      '',
      '![a heap](https://x.example/h.png?d=secret) and ![ref style][r] and ![[pic.png|300]] and ![[Other note]]',
      '',
      '[r]: https://x.example/r.png',
      '',
      'Text.',
    ].join('\n');
    const out = cleanArticleBody(body, 'Heaps');
    expect(out).not.toMatch(/^---|^# Heaps|!\[|x\.example\/h\.png|pic\.png/m);
    expect(out).toContain('a heap and ref style and  and [[Other note]]');
  });

  it('tags and the frontmatter round-trip through the library parser', () => {
    expect(cleanTags(['#Graphs', 'graphs', 'Dynamic Programming', 3, ''])).toEqual([
      'graphs',
      'dynamic-programming',
    ]);
    const text = renderGeneratedArticle(
      { title: 'A "quoted": title', created: '2026-11-20T10:00:00Z', tags: ['heaps'] },
      'Body.\n',
    );
    expect(parseNote(text, 'x.md')).toMatchObject({
      frontmatter: {
        title: 'A "quoted": title',
        created: '2026-11-20T10:00:00Z',
        tags: ['heaps'],
        generated: true,
      },
      body: expect.stringContaining('Body.'),
    });
  });

  it('checks the request: a brief with its line breaks, and 1 or 2–12 parts', () => {
    expect(checkArticleRequest({ brief: '  Tries  \r\n\r\n\r\n- insert   and search ' })).toEqual({
      brief: 'Tries\n\n- insert and search',
      level: 'intermediate',
      length: 'medium',
      parts: 1,
    });
    expect(checkArticleRequest({ brief: 'x'.repeat(4000), parts: 12 }).parts).toBe(12);
    for (const bad of [
      null,
      { brief: '' },
      { brief: 'x', level: 'guru' },
      { brief: 'x'.repeat(4001) },
      { brief: 'x', parts: 0 },
      { brief: 'x', parts: 13 },
      { brief: 'x', parts: 2.5 },
      { topic: 'old shape' },
    ])
      expect(() => checkArticleRequest(bad)).toThrow(GenerateError);
  });

  it('plans: exact count, titles and summaries, ordered unique file names', () => {
    const plan = checkPlan(
      {
        title: ' Build a compiler ',
        parts: [
          { title: 'Lexing: tokens?', summary: 'Characters to tokens.' },
          { title: 'Lexing: tokens?', summary: 'Again.' },
        ],
      },
      2,
    );
    expect(plan).toEqual({
      title: 'Build a compiler',
      parts: [
        { title: 'Lexing: tokens?', summary: 'Characters to tokens.', file: '01 Lexing tokens' },
        { title: 'Lexing: tokens?', summary: 'Again.', file: '02 Lexing tokens' },
      ],
    });
    expect(checkPlan({ title: 'x', parts: [{ title: 'a', summary: 'b' }] }, 2)).toMatch(
      /exactly 2/,
    );
    expect(
      checkPlan({ title: 'x', parts: [{ title: 'a' }, { title: 'b', summary: 'c' }] }, 2),
    ).toMatch(/summary/);
    expect(checkPlan({ parts: [] }, 2)).toMatch(/title/);
  });

  it('links each part to the previous and next one', () => {
    const plan = {
      title: 'Compilers',
      parts: [
        { title: 'Lexing', summary: 's', file: '01 Lexing' },
        { title: 'Parsing [LL]', summary: 's', file: '02 Parsing LL' },
        { title: 'Codegen', summary: 's', file: '03 Codegen' },
      ],
    };
    expect(seriesFooter(plan, 0)).toContain('Next: [[02 Parsing LL|Parsing LL]] →');
    expect(seriesFooter(plan, 0)).not.toContain('Previous');
    expect(seriesFooter(plan, 1)).toContain(
      '← Previous: [[01 Lexing|Lexing]] · Next: [[03 Codegen|Codegen]] →',
    );
    expect(seriesFooter(plan, 2)).toContain('*Part 3 of 3 of the series “Compilers”.*');
  });
});

describe('ArticleWriter (fake tutor)', () => {
  function writer(script: FakeScript, backend?: UnavailableBackend) {
    const saved: ArticleToSave[] = [];
    const sinks: (string | null)[] = [];
    const fake = new FakeBackend(script);
    const w = new ArticleWriter({
      backend: () => backend ?? fake,
      now: () => '2026-11-20T10:00:00Z',
      newId: () => 'j1',
    });
    const sink = (series: string | null) => {
      sinks.push(series);
      return Promise.resolve({
        save: (a: ArticleToSave) => {
          saved.push(a);
          return Promise.resolve(`id-${saved.length}`);
        },
      });
    };
    return { w, saved, sinks, fake, sink };
  }

  it('saves after a reminder turn, with only save_article offered', async () => {
    const { w, saved, fake, sink, sinks } = writer([
      { match: '^Write an article', steps: [{ text: 'Here it is in chat.' }] },
      {
        match: 'not saved yet',
        steps: [{ tool: 'save_article', input: { title: 'Heaps', tags: ['heaps'], body: LONG } }],
      },
    ]);
    expect(
      await w.write(
        { brief: 'heaps\n- sift down', level: 'beginner', length: 'short' },
        sink,
        never,
      ),
    ).toEqual([{ id: 'id-1', title: 'Heaps' }]);
    expect(sinks).toEqual([null]);
    expect(saved[0]!.markdown).toMatch(/^---\ntitle: "Heaps"\n/);
    expect(saved[0]!.file).toBeUndefined();
    expect(fake.turns.map((t) => t.userText)).toEqual([
      expect.stringContaining('Level: beginner'),
      WRITER_REMINDER,
    ]);
    expect(fake.turns[0]!.userText).toContain('The brief:\nheaps\n- sift down');
    expect(fake.turns[0]!.tools.names()).toEqual(['save_article']);
    expect(fake.turns[1]!.history).toHaveLength(2);
  });

  it('refuses a too-short body, gives up after two turns, and needs a tutor', async () => {
    const { w, saved, sink } = writer([
      [{ tool: 'save_article', input: { title: 'Heaps', body: 'Too short.' } }],
    ]);
    await expect(w.write({ brief: 'heaps' }, sink, never)).rejects.toMatchObject({
      code: 'not_written',
    });
    expect(saved).toEqual([]);
    const off = writer([], new UnavailableBackend('anthropic', 'No key.'));
    await expect(off.w.write({ brief: 'heaps' }, off.sink, never)).rejects.toMatchObject({
      code: 'unavailable',
      message: 'No key.',
    });
  });

  const PLAN = {
    title: 'Writing a compiler',
    parts: [
      { title: 'Lexing', summary: 'Characters into tokens.' },
      { title: 'Parsing', summary: 'Tokens into a tree.' },
      { title: 'Code generation', summary: 'The tree into instructions.' },
    ],
  };

  it('a series: plans, then writes each part with the plan, in order, linked', async () => {
    const { w, saved, sinks, fake, sink } = writer([
      { match: '^Plan a series of 3', steps: [{ text: 'A plan in chat.' }] },
      { match: 'not planned yet', steps: [{ tool: 'plan_series', input: PLAN }] },
      ...PLAN.parts.map((p) => ({
        match: `^Write part \\d of 3 of the series “Writing a compiler”\\.\\nIts title: ${p.title}`,
        steps: [
          { tool: 'save_article', input: { title: 'Ignored', tags: ['compilers'], body: LONG } },
        ],
      })),
    ]);
    const progress: WriteProgress[] = [];
    const out = await w.write(
      { brief: 'How to write a small compiler', parts: 3 },
      sink,
      never,
      (p) => progress.push(p),
    );
    expect(out.map((a) => a.title)).toEqual(['Lexing', 'Parsing', 'Code generation']);
    expect(sinks).toEqual(['Writing a compiler']);
    expect(saved.map((a) => a.file)).toEqual(['01 Lexing', '02 Parsing', '03 Code generation']);
    expect(saved[1]!.markdown).toContain('series: "Writing a compiler"\npart: 2\nparts: 3\n');
    expect(saved[1]!.markdown).toContain(
      '← Previous: [[01 Lexing|Lexing]] · Next: [[03 Code generation|Code generation]] →',
    );
    expect(fake.turns[0]!.tools.names()).toEqual(['plan_series']);
    expect(fake.turns[1]!.userText).toBe(PLANNER_REMINDER);
    const part2 = fake.turns.find((t) => t.userText.includes('Its title: Parsing'))!;
    expect(part2.userText).toContain('2. Parsing: Tokens into a tree.  <- this part');
    expect(part2.userText).toContain('How to write a small compiler');
    expect(part2.history).toEqual([]);
    expect(progress.map((p) => p.kind)).toEqual([
      'planning',
      'planned',
      'writing',
      'saved',
      'writing',
      'saved',
      'writing',
      'saved',
    ]);
  });

  it('a series that stops keeps the parts written and says which', async () => {
    const { w, sink } = writer([
      [{ tool: 'plan_series', input: PLAN }],
      [{ tool: 'save_article', input: { title: 'x', body: LONG } }],
      [{ text: 'no' }],
      [{ text: 'still no' }],
    ]);
    const e = await w.write({ brief: 'compiler', parts: 3 }, sink, never).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SeriesStopped);
    expect((e as SeriesStopped).code).toBe('not_written');
    expect((e as SeriesStopped).written).toEqual([{ id: 'id-1', title: 'Lexing' }]);
  });

  it('a plan with the wrong number of parts is refused, then given up', async () => {
    const { w, sinks, sink } = writer([
      [{ tool: 'plan_series', input: { ...PLAN, parts: PLAN.parts.slice(0, 2) } }],
      [{ text: 'no' }],
    ]);
    await expect(w.write({ brief: 'compiler', parts: 3 }, sink, never)).rejects.toMatchObject({
      code: 'not_written',
    });
    expect(sinks).toEqual([]);
  });
});

describe('create_problem in article mode', () => {
  const getProfile = () => ({ ok: true });

  it('is offered only with createProblem, and is capped per turn', async () => {
    expect(buildArticleRegistry({ body: 'x', getProfile }).names()).not.toContain('create_problem');
    const calls: unknown[] = [];
    const registry = buildArticleRegistry({
      body: '# A\n\ntext',
      getProfile,
      problemSpecSchema: { type: 'object' },
      createProblem: (args) => {
        calls.push(args);
        return Promise.resolve({ ok: false, error: 'self-check failed' });
      },
    });
    expect(registry.names()).toContain('create_problem');
    for (let i = 0; i < MAX_PASSAGE_PROBLEM_CALLS; i++)
      expect((await registry.call('create_problem', { spec: { slug: 'x' } })).output.ok).toBe(
        false,
      );
    const last = await registry.call('create_problem', { spec: { slug: 'x' } });
    expect(last.output).toMatchObject({ ok: false, code: 'limit' });
    expect(calls).toHaveLength(MAX_PASSAGE_PROBLEM_CALLS);
    expect(calls[0]).toEqual({ spec: { slug: 'x' } });
  });

  it('a success emits open_problem; the prompt gains the rules and guide only when offered', async () => {
    const registry = buildArticleRegistry({
      body: 'x',
      getProfile,
      problemSpecSchema: { type: 'object' },
      createProblem: () => Promise.resolve({ ok: true, slug: 'even-count' }),
    });
    const r = await registry.call('create_problem', { spec: {} });
    expect(r.ui).toEqual([
      { type: 'ui', action: 'open_problem', slug: 'even-count' },
      { type: 'ui', action: 'refresh_state' },
    ]);
    const guides = { problem_spec: '# Spec\n\nWrite tests.', hint_ladder: '# Hints' };
    const withTool = buildArticleSystemPrompt(registry.anthropicTools(), guides);
    expect(withTool).toContain(PASSAGE_PROBLEM_REQUEST);
    expect(withTool).toContain('# Guide: problem_spec');
    expect(withTool).not.toContain('Hints');
    const without = buildArticleSystemPrompt(
      buildArticleRegistry({ body: 'x', getProfile }).anthropicTools(),
      guides,
    );
    expect(without).not.toContain('problem_spec');
    expect(without).not.toContain(PASSAGE_PROBLEM_REQUEST);
  });
});

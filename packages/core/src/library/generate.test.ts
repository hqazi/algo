import { describe, expect, it } from 'vitest';
import { buildArticleRegistry, MAX_PASSAGE_PROBLEM_CALLS } from '../tools/article';
import { buildArticleSystemPrompt, PASSAGE_PROBLEM_REQUEST } from '../tools/article-prompt';
import { FakeBackend, type FakeScript } from '../tutor/fake';
import { UnavailableBackend } from '../tutor/backend';
import { parseNote } from './frontmatter';
import {
  ArticleWriter,
  articleSlug,
  checkArticleRequest,
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

  it('slugs, tags and the frontmatter round-trip through the library parser', () => {
    expect(articleSlug('Binary Heaps, explained!', () => false)).toBe('binary-heaps-explained');
    expect(articleSlug('!!!', () => false)).toBe('article');
    const taken = new Set(['heaps', 'heaps-2']);
    expect(articleSlug('Heaps', (s) => taken.has(s))).toBe('heaps-3');
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

  it('checks the request', () => {
    expect(checkArticleRequest({ topic: '  Tries  ' })).toEqual({
      topic: 'Tries',
      level: 'intermediate',
      length: 'medium',
    });
    for (const bad of [
      null,
      { topic: '' },
      { topic: 'x', level: 'guru' },
      { topic: 'x'.repeat(301) },
    ])
      expect(() => checkArticleRequest(bad)).toThrow(GenerateError);
  });
});

describe('ArticleWriter (fake tutor)', () => {
  function writer(script: FakeScript, backend?: UnavailableBackend) {
    const saved: ArticleToSave[] = [];
    const fake = new FakeBackend(script);
    const w = new ArticleWriter({
      backend: () => backend ?? fake,
      save: (a) => {
        saved.push(a);
        return Promise.resolve(`id-${a.slug}`);
      },
      taken: () => false,
      now: () => '2026-11-20T10:00:00Z',
      newId: () => 'j1',
    });
    return { w, saved, fake };
  }

  it('saves after a reminder turn, with only save_article offered', async () => {
    const { w, saved, fake } = writer([
      { match: '^Write an article', steps: [{ text: 'Here it is in chat.' }] },
      {
        match: 'not saved yet',
        steps: [{ tool: 'save_article', input: { title: 'Heaps', tags: ['heaps'], body: LONG } }],
      },
    ]);
    expect(await w.write({ topic: 'heaps', level: 'beginner', length: 'short' }, never)).toEqual({
      id: 'id-heaps',
      title: 'Heaps',
      slug: 'heaps',
    });
    expect(saved[0]!.markdown).toMatch(/^---\ntitle: "Heaps"\n/);
    expect(fake.turns.map((t) => t.userText)).toEqual([
      expect.stringContaining('Level: beginner'),
      WRITER_REMINDER,
    ]);
    expect(fake.turns[0]!.tools.names()).toEqual(['save_article']);
    expect(fake.turns[1]!.history).toHaveLength(2);
  });

  it('refuses a too-short body, gives up after two turns, and needs a tutor', async () => {
    const { w, saved } = writer([
      [{ tool: 'save_article', input: { title: 'Heaps', body: 'Too short.' } }],
    ]);
    await expect(w.write({ topic: 'heaps' }, never)).rejects.toMatchObject({ code: 'not_written' });
    expect(saved).toEqual([]);
    const off = writer([], new UnavailableBackend('anthropic', 'No key.'));
    await expect(off.w.write({ topic: 'heaps' }, never)).rejects.toMatchObject({
      code: 'unavailable',
      message: 'No key.',
    });
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

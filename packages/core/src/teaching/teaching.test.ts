/**
 * The teaching logic. Ports `dsa-tutor/tests/test_scripts.py` (`TestState`,
 * the state parts of `TestExplanation` and `test_core_functions_match_the_cli`)
 * against the real curated content, an in-memory storage and workspace.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { memoryCatalog } from './catalog';
import { TutorError } from './errors';
import { MemoryStorage } from './memory-storage';
import { Teaching } from './teaching';
import { curatedCatalog, tickingClock, TOPICS } from './test-support';
import { memoryWorkspace, workspacePath } from './workspace';

let storage: MemoryStorage;
let workspace: ReturnType<typeof memoryWorkspace>;
let t: Teaching;

beforeEach(async () => {
  storage = new MemoryStorage();
  workspace = memoryWorkspace();
  t = new Teaching({ storage, catalog: await curatedCatalog(), workspace, now: tickingClock() });
});

async function solve(slug: string, hints = 0): ReturnType<Teaching['record']> {
  await t.start(slug);
  for (let i = 0; i < hints; i++) await t.hint(slug);
  return t.record(slug, { passed: 5, total: 5 });
}

async function rejects(p: Promise<unknown>, message?: RegExp): Promise<TutorError> {
  const e = await p.then(
    () => {
      throw new Error('expected a TutorError');
    },
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(TutorError);
  if (message) expect((e as Error).message).toMatch(message);
  return e as TutorError;
}

describe('the learning loop (test_learning_loop)', () => {
  it('follows focus, difficulty and level rules end to end', async () => {
    expect(t.status().onboarded).toBe(false);
    await rejects(t.nextProblem(), /not onboarded/); // must onboard first
    await t.setProfile({
      goal: 'interview',
      interview_date: '2026-12-15',
      'comfort.all': 'some',
      hint_preference: 'struggle',
      focus_topic: 'hashing',
    });
    await rejects(t.setProfile({ 'comfort.basics': 'great' }), /comfort must be one of/);

    const first = await t.nextProblem();
    expect([first.topic, first.difficulty, first.action]).toEqual(['hashing', 'easy', 'solve']);
    expect(first.reason).toContain('focus');
    if (first.action !== 'solve') throw new Error('unreachable');

    const started = await t.start(first.slug);
    expect(workspace.files.has(started.workspace)).toBe(true);
    expect((await t.hint(first.slug)).level).toBe(1);
    let rec = await t.record(first.slug, { passed: 3, total: 3, notes: 'used the complement map' });
    expect(rec.recorded.outcome).toBe('with_hints');
    expect(rec.level).toBe('learning');

    // Two unaided easy solves, then medium is recommended.
    let next = await t.nextProblem();
    if (next.action !== 'solve') throw new Error('expected solve');
    expect(next.slug).not.toBe(first.slug);
    await solve(next.slug);
    next = await t.nextProblem();
    expect(next.difficulty).toBe('easy'); // only 1 unaided so far
    // The other hashing easy problem was attempted with hints: generate one.
    expect(next.action).toBe('generate');
    const medium = await t.nextProblem({ topic: 'hashing', difficulty: 'medium' });
    if (medium.action !== 'solve') throw new Error('expected solve');
    rec = await solve(medium.slug);
    expect(rec.solved_unaided).toBe(2);
    next = await t.nextProblem();
    expect(next.difficulty).toBe('medium');
    if (next.action !== 'solve') throw new Error('expected solve');
    rec = await solve(next.slug);
    expect(rec.level).toBe('comfortable');
    expect(rec.level_changed).toBe(true);

    // Focus is comfortable: move to the weakest topic with prerequisites met.
    const moved = await t.nextProblem();
    expect(moved.focus_changed).toBe(true);
    expect(moved.topic).not.toBe('hashing');
    expect(moved.reason).toMatch(/^Hash maps & sets is comfortable now; /);
    expect(t.getProfile().profile?.focus_topic).toBe(moved.topic);
    if (moved.action !== 'solve') throw new Error('expected solve');

    // A record that claims a solve with failing tests, then giving up.
    await t.start(moved.slug);
    await rejects(
      t.record(moved.slug, { passed: 1, total: 4, outcome: 'unaided' }),
      /every test passes/,
    );
    const gave = await t.record(moved.slug, { passed: 1, total: 4, gaveUp: true });
    expect(gave.recorded.outcome).toBe('gave_up');

    expect(t.attempts({ last: 0 }).attempts).toHaveLength(5);
    expect(t.topicStats().get('hashing')?.level).toBe('comfortable');
    // The topic_progress cache agrees with the attempts.
    expect(storage.read((db) => db.getTopicProgress('hashing'))).toMatchObject({
      level: 'comfortable',
      unaidedSolves: 3,
    });
  });

  it('caps the hint ladder at four (test_hint_ladder_caps)', async () => {
    await t.profileDefaults();
    for (const level of [1, 2, 3, 4]) expect((await t.hint('floor-sqrt')).level).toBe(level);
    const last = await t.hint('floor-sqrt');
    expect(last.level).toBeNull();
    expect(last).toMatchObject({ hints_used: 4 });
    const open = storage.read((db) => db.getOpenAttempt('floor-sqrt'))!;
    expect(storage.read((db) => db.listHints(open.id)).map((h) => h.level)).toEqual([1, 2, 3, 4]);
  });

  it('starts new learners at the basics (test_defaults_start_at_basics)', async () => {
    await t.profileDefaults();
    const out = await t.nextProblem({ dryRun: true });
    expect([out.topic, out.difficulty]).toEqual(['arrays-strings', 'easy']);
    expect(out.focus_changed).toBe(true);
    // A dry run does not move the focus topic.
    expect(t.getProfile().profile?.focus_topic).toBeNull();
    await t.nextProblem();
    expect(t.getProfile().profile?.focus_topic).toBe('arrays-strings');
  });

  it('counts an explanation like a hint (TestExplanation)', async () => {
    await t.profileDefaults();
    await t.start('pair-with-target');
    expect(await t.markExplained('pair-with-target')).toBe(true);
    const rec = await t.record('pair-with-target', { passed: 11, total: 11 });
    expect(rec.recorded.outcome).toBe('with_hints');
    expect(await t.markExplained('pair-with-target')).toBe(false); // nothing open now
  });

  it('rejects bad input (test_core_functions_match_the_cli)', async () => {
    await t.profileDefaults();
    await rejects(t.nextProblem({ difficulty: 'impossible' }), /difficulty must be one of/);
    await rejects(t.start('../escape'), /invalid slug/);
    await rejects(t.start('no-such-problem'), /no problem/);
    await rejects(t.record('floor-sqrt', { passed: 3, total: 2 }), /passed <= total/);
    await rejects(t.record('floor-sqrt', { passed: 0, total: 0 }), /total > 0/);
    await rejects(t.record('floor-sqrt', { passed: 1.5, total: 2 }), /integers/);
    // Nothing was recorded by the failures.
    expect(t.attempts().attempts).toEqual([]);
  });
});

describe('start', () => {
  it('scaffolds once and resumes the open attempt', async () => {
    const a = await t.start('tree-depth');
    expect(a).toMatchObject({ resumed: false, language: 'python', workspace_created: true });
    expect(a.workspace).toBe('workspace/tree-depth/solution.py');
    const code = workspace.files.get(workspacePath('tree-depth', 'python'))!;
    expect(code).toContain('class TreeNode:');
    expect(code).toContain('def max_depth(root: TreeNode | None) -> int:');
    expect(code).toContain('raise NotImplementedError');
    await t.hint('tree-depth');
    const b = await t.start('tree-depth');
    expect(b).toMatchObject({ resumed: true, workspace_created: false, hints_used: 1 });
    expect(storage.read((db) => db.listAttempts())).toHaveLength(1);
  });

  it('refuses a language the problem is not offered in', async () => {
    await rejects(t.start('tree-depth', 'rust'), /not available in rust/);
  });

  it('marks the topic as learning', async () => {
    await t.start('tree-depth');
    expect(t.topicStats().get('trees')).toMatchObject({ attempted: 1, level: 'learning' });
    expect(t.problemStatus('tree-depth')).toBe('active');
  });
});

describe('record', () => {
  it('records without an open attempt, and derives the outcome', async () => {
    const r = await t.record('compress-runs', { passed: 0, total: 6, gaveUp: true });
    expect(r.recorded).toEqual({
      slug: 'compress-runs',
      outcome: 'gave_up',
      hints_used: 0,
      tests_passed: 0,
      tests_total: 6,
    });
    expect(t.problemStatus('compress-runs')).toBe('gave_up');
    await solve('compress-runs');
    expect(t.problemStatus('compress-runs')).toBe('solved');
  });

  it('a failing count is a give-up even without gaveUp', async () => {
    await t.start('floor-sqrt');
    expect((await t.record('floor-sqrt', { passed: 2, total: 5 })).recorded.outcome).toBe(
      'gave_up',
    );
  });

  it('trims and caps notes', async () => {
    await t.record('floor-sqrt', { passed: 1, total: 1, notes: `  ${'x'.repeat(700)}  ` });
    expect(t.attempts().attempts[0]!.notes).toBe('x'.repeat(600));
  });

  it('attempts are listed oldest first, last N, per slug', async () => {
    for (const slug of ['floor-sqrt', 'compress-runs', 'floor-sqrt'])
      await t.record(slug, { passed: 1, total: 1 });
    expect(t.attempts().attempts.map((a) => a.slug)).toEqual([
      'floor-sqrt',
      'compress-runs',
      'floor-sqrt',
    ]);
    expect(t.attempts({ last: 1 }).attempts.map((a) => a.slug)).toEqual(['floor-sqrt']);
    expect(t.attempts({ slug: 'compress-runs' }).attempts).toHaveLength(1);
    const a = t.attempts().attempts[0]!;
    expect(a).toMatchObject({ topic: 'binary-search', difficulty: 'easy', source: 'curated' });
    // A second solve of the same problem does not count twice.
    expect(t.topicStats().get('binary-search')?.solved_unaided).toBe(1);
  });
});

describe('status', () => {
  it('reports levels, open attempts and the last three', async () => {
    await t.setProfile({ focus_topic: 'graphs' });
    for (const slug of ['floor-sqrt', 'insert-position', 'compress-runs', 'count-ways'])
      await t.record(slug, { passed: 1, total: 1 });
    await t.start('tree-depth');
    const s = t.status();
    expect(s.onboarded).toBe(true);
    expect(s.profile?.focus_topic).toBe('graphs');
    expect(s.topics.map((x) => x.topic)).toEqual([
      'arrays-strings',
      'binary-search',
      'trees',
      'graphs',
      'dynamic-programming',
    ]);
    expect(s.topics.find((x) => x.topic === 'graphs')).toMatchObject({
      level: 'new',
      attempted: 0,
    });
    expect(s.untouched_topics).toBe(TOPICS.length - 4);
    expect(s.active).toEqual([
      expect.objectContaining({ slug: 'tree-depth', topic: 'trees', hints_used: 0 }),
    ]);
    expect(s.recent.map((r) => r.slug)).toEqual(['insert-position', 'compress-runs', 'count-ways']);
  });

  it('keeps history for a problem that left the catalog (via the problems index)', async () => {
    await t.record('floor-sqrt', { passed: 1, total: 1 });
    const empty = new Teaching({
      storage,
      catalog: memoryCatalog(TOPICS),
      workspace,
      now: tickingClock(),
    });
    expect(empty.status().topics).toEqual([]);
    await storage.write((db) =>
      db.saveProblem({
        slug: 'floor-sqrt',
        source: 'curated',
        topic: 'binary-search',
        difficulty: 'easy',
        title: 'Floor Square Root',
        path: 'problems/binary-search/floor-sqrt',
        contentVersion: 1,
        createdAt: '2026-11-19T00:00:00Z',
      }),
    );
    expect(empty.status().topics.map((x) => x.topic)).toEqual(['binary-search']);
  });
});

describe('profile', () => {
  it('defaults keep an existing profile', async () => {
    await t.setProfile({ goal: 'interview' });
    const d = await t.profileDefaults();
    expect(d.profile.goal).toBe('interview');
  });

  it('validates every key', async () => {
    await rejects(t.setProfile({}), /at least one/);
    await rejects(t.setProfile({ goal: 'fame' }), /goal must be one of/);
    await rejects(t.setProfile({ interview_date: 'soon' }), /YYYY-MM-DD/);
    await rejects(t.setProfile({ interview_date: '2026-02-30' }), /YYYY-MM-DD/);
    await rejects(t.setProfile({ 'comfort.cooking': 'solid' }), /unknown group/);
    await rejects(t.setProfile({ focus_topic: 'astrology' }), /unknown topic/);
    await rejects(t.setProfile({ language: 'cobol' }), /language must be one of/);
    await rejects(t.setProfile({ admin: 'true' }), /unknown profile key/);
    expect(t.getProfile().onboarded).toBe(false); // nothing saved
  });

  it('general practice has no interview date; null clears', async () => {
    let p = (await t.setProfile({ goal: 'interview', interview_date: '2027-01-10' })).profile;
    expect(p.interview_date).toBe('2027-01-10');
    p = (await t.setProfile({ interview_date: null })).profile;
    expect(p.interview_date).toBeNull();
    p = (await t.setProfile({ interview_date: '2027-01-10', goal: 'general' })).profile;
    expect(p.interview_date).toBeNull();
    p = (await t.setProfile({ 'comfort.all': 'some', 'comfort.trees-graphs': 'none' })).profile;
    expect(p.comfort).toEqual({
      basics: 'some',
      linear: 'some',
      'search-sort': 'some',
      'trees-graphs': 'none',
      'recursion-dp': 'some',
    });
  });

  it('focus needs a profile and can be cleared', async () => {
    await rejects(t.setFocus('hashing'), /not onboarded/);
    await t.profileDefaults();
    expect((await t.setFocus('hashing')).focus_topic).toBe('hashing');
    expect((await t.setFocus(null)).focus_topic).toBeNull();
  });
});

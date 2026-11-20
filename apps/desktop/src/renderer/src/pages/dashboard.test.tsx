// @vitest-environment jsdom
/**
 * T31: Home, Problems and Progress against a fake bridge, and the helpers
 * they compute with.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextResponse, ProblemListItem, TopicView } from '../../../shared/practice';
import { ChatStore, ChatStoreContext } from '../chat/store';
import { AppProvider } from '../lib/app';
import { FakeBridge, installBridge } from '../test/fake-bridge';
import { baseHandlers, TOPICS } from '../test/fixtures';
import { levelCounts, matching, reasonText, topicParts } from './dashboard';
import { HomePage } from './HomePage';
import { ProblemsPage } from './ProblemsPage';
import { ProgressPage } from './ProgressPage';

const item = (over: Partial<ProblemListItem> & { slug: string }): ProblemListItem => ({
  title: over.slug,
  topic: 'hashing',
  difficulty: 'easy',
  source: 'curated',
  languages: ['python'],
  status: 'new',
  ...over,
});

const PROBLEMS: ProblemListItem[] = [
  item({ slug: 'pair-with-target', title: 'Two Receipts', status: 'solved' }),
  item({ slug: 'dup-check', title: 'Seen Before', status: 'active', difficulty: 'medium' }),
  item({ slug: 'anagram-groups', title: 'Anagram Groups', difficulty: 'hard' }),
];

const PICK: NextResponse = {
  action: 'solve',
  slug: 'anagram-groups',
  title: 'Anagram Groups',
  source: 'curated',
  topic: 'hashing',
  topic_name: 'Hash maps & sets',
  difficulty: 'easy',
  focus_changed: false,
  reason: 'hash maps & sets is your weakest topic; easy until 2 unaided solves here (0 so far)',
};

const topic = (over: Partial<TopicView> & { id: string }): TopicView => ({
  ...TOPICS[0]!,
  name: over.id,
  ...over,
});

let bridge: FakeBridge;

beforeEach(() => {
  localStorage.clear();
  bridge = baseHandlers(new FakeBridge())
    .on('problems:list', () => ({ problems: PROBLEMS }))
    .on('problems:next', () => PICK)
    .on('attempts:list', () => ({ attempts: [] }));
  installBridge(bridge);
});
afterEach(cleanup);

function show(page: React.ReactNode): void {
  render(
    <ChatStoreContext.Provider value={new ChatStore()}>
      <AppProvider>{page}</AppProvider>
    </ChatStoreContext.Provider>,
  );
}

describe('helpers', () => {
  it("reasonText: a sentence, without the tutor's instruction to generate", () => {
    expect(reasonText(PICK)).toBe(
      'Hash maps & sets is your weakest topic; easy until 2 unaided solves here (0 so far).',
    );
    expect(
      reasonText({
        ...PICK,
        action: 'generate',
        reason:
          'you asked for this topic; no unattempted problem left here, so generate one (create_problem)',
      } as NextResponse),
    ).toBe('You asked for this topic.');
  });

  it('matching skips one filter, so its counts ignore its own choice', () => {
    const f = { difficulty: 'hard' as const, status: 'new' as const };
    expect(matching(PROBLEMS, f).map((p) => p.slug)).toEqual(['anagram-groups']);
    expect(matching(PROBLEMS, f, 'difficulty').map((p) => p.slug)).toEqual(['anagram-groups']);
    expect(matching(PROBLEMS, f, 'status').map((p) => p.slug)).toEqual(['anagram-groups']);
    expect(matching(PROBLEMS, { difficulty: 'easy' }, 'difficulty')).toHaveLength(3);
  });

  it('topicParts splits distinct problems and hides zero counts', () => {
    expect(topicParts({ attempted: 0, solved: 0, solved_unaided: 0 })).toEqual({
      unaided: 0,
      helped: 0,
      tried: 0,
      text: '',
    });
    expect(topicParts({ attempted: 4, solved: 3, solved_unaided: 1 })).toEqual({
      unaided: 1,
      helped: 2,
      tried: 1,
      text: '1 unaided · 2 with help · 1 tried',
    });
    expect(topicParts({ attempted: 1, solved: 1, solved_unaided: 0 }).text).toBe('1 with help');
  });

  it('levelCounts counts topics by level and problems solved', () => {
    expect(
      levelCounts([
        topic({ id: 'a', level: 'comfortable', solved: 3 }),
        topic({ id: 'b', level: 'learning', solved: 1 }),
        topic({ id: 'c' }),
      ]),
    ).toEqual({ comfortable: 1, learning: 1, new: 1, solved: 4 });
  });
});

describe('HomePage', () => {
  it('fresh: an empty Continue card and the pick, previewed without moving the focus', async () => {
    const onNext = vi.fn();
    show(<HomePage onNext={onNext} nextBusy={false} />);
    expect(await screen.findByText(/Nothing in progress/)).toBeTruthy();
    expect(await screen.findByText('Anagram Groups')).toBeTruthy();
    expect(screen.getByTestId('home-reason').textContent).toMatch(/^Hash maps & sets is your/);
    expect(bridge.calls.find((c) => c.channel === 'problems:next')?.request).toEqual({
      preview: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(onNext).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'browse all problems' }).getAttribute('href')).toBe(
      '#/problems',
    );
    expect(screen.getByRole('heading', { name: 'Practice' })).toBeTruthy();
  });

  it('continues the latest problem in progress, by its title', async () => {
    bridge.on('status:get', () => ({
      onboarded: true,
      topics: [],
      untouched_topics: 0,
      active: [
        {
          slug: 'pair-with-target',
          topic: 'hashing',
          hints_used: 0,
          started_at: '2026-11-18T10:00:00Z',
        },
        { slug: 'dup-check', topic: 'hashing', hints_used: 2, started_at: '2026-11-19T10:00:00Z' },
      ],
      recent: [],
    }));
    show(<HomePage onNext={() => {}} nextBusy={false} />);
    const resume = await screen.findByRole('link', { name: 'Resume' });
    expect(resume.getAttribute('href')).toBe('#/p/dup-check');
    expect(await screen.findByRole('link', { name: 'Seen Before' })).toBeTruthy();
    expect(screen.getByText('2 hints')).toBeTruthy();
    expect(screen.getByText(/Also in progress/).parentElement?.textContent).toContain(
      'Two Receipts',
    );
    expect(bridge.calls.find((c) => c.channel === 'problems:list')?.request).toEqual({
      status: 'active',
    });
  });

  it('says so when there is no pick', async () => {
    bridge.on('problems:next', () => {
      throw new Error('no profile');
    });
    show(<HomePage onNext={() => {}} nextBusy={false} />);
    expect(await screen.findByText(/No pick right now/)).toBeTruthy();
  });
});

describe('ProblemsPage', () => {
  it('lists every problem with status icons and difficulty, and hides Source for one source', async () => {
    show(<ProblemsPage />);
    const link = await screen.findByRole('link', { name: 'Two Receipts' });
    expect(link.getAttribute('href')).toBe('#/p/pair-with-target');
    const row = link.closest('tr')!;
    expect(within(row).getByText('Solved')).toBeTruthy();
    expect(within(row).getByText('Easy')).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Source' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Source' })).toBeNull();
    expect(screen.getByText('3 problems')).toBeTruthy();
    expect(bridge.calls.find((c) => c.channel === 'problems:list')?.request).toEqual({});
  });

  it('filters here, with counts in the options; a row click opens the problem', async () => {
    show(<ProblemsPage />);
    await screen.findByRole('link', { name: 'Two Receipts' });
    const difficulty = screen.getByRole('combobox', { name: 'Difficulty' });
    expect(within(difficulty).getByRole('option', { name: 'Hard (1)' })).toBeTruthy();
    fireEvent.change(difficulty, { target: { value: 'medium' } });
    expect(screen.queryByRole('link', { name: 'Two Receipts' })).toBeNull();
    expect(screen.getByText('1 problem')).toBeTruthy();
    const status = screen.getByRole('combobox', { name: 'Status' });
    expect(within(status).getByRole('option', { name: 'In progress (1)' })).toBeTruthy();
    expect(within(status).getByRole('option', { name: 'Solved (0)' })).toBeTruthy();
    fireEvent.click(screen.getByText('Medium').closest('tr')!);
    expect(window.location.hash).toBe('#/p/dup-check');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('3 problems')).toBeTruthy();
  });

  it('shows Source when the sources differ', async () => {
    bridge.on('problems:list', () => ({
      problems: [...PROBLEMS, item({ slug: 'mine', title: 'Mine', source: 'pasted' })],
    }));
    show(<ProblemsPage />);
    await screen.findByRole('link', { name: 'Mine' });
    expect(screen.getByRole('columnheader', { name: 'Source' })).toBeTruthy();
    const source = screen.getByRole('combobox', { name: 'Source' });
    expect(
      within(source)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Any source', 'Curated (3)', 'Pasted (1)']);
  });
});

describe('ProgressPage', () => {
  it('shows stat tiles and one row per topic with only the non-zero counts', async () => {
    bridge.on('catalog:topics', () => ({
      topics: [
        topic({
          id: 'hashing',
          name: 'Hash maps & sets',
          attempted: 3,
          solved: 2,
          solved_unaided: 1,
          level: 'learning',
        }),
        topic({ id: 'arrays', name: 'Arrays', group: 'linear' }),
      ],
    }));
    show(<ProgressPage />);
    await waitFor(() =>
      expect(screen.getByTestId('topic-hashing').textContent).toContain('1 unaided'),
    );
    const row = screen.getByTestId('topic-hashing');
    expect(within(row).getByTestId('topic-counts').textContent).toBe(
      '1 unaided · 1 with help · 1 tried',
    );
    expect(within(row).getByText('Learning')).toBeTruthy();
    expect(within(row).getByRole('img').getAttribute('aria-label')).toBe(
      'Hash maps & sets: 1 of 3 unaided solves (1 unaided · 1 with help · 1 tried)',
    );
    expect(row.querySelectorAll('.seg')).toHaveLength(3);
    const empty = screen.getByTestId('topic-arrays');
    expect(within(empty).getByTestId('topic-counts').textContent).toBe('');
    expect(empty.querySelectorAll('.seg')).toHaveLength(0);
    const tiles = screen.getAllByRole('term').map((t) => t.parentElement!.textContent);
    expect(tiles).toEqual([
      'Comfortable0 of 2 topics',
      'Learning1 of 2 topics',
      'Not started1 of 2 topics',
      'Solved2 problems',
    ]);
    expect(screen.getByRole('heading', { name: 'Progress', level: 1 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Basics' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Linear' })).toBeTruthy();
    expect(await screen.findByText('No attempts yet.')).toBeTruthy();
  });

  it('lists active problems and recent attempts by title, with relative times', async () => {
    const started = new Date(Date.now() - 5 * 60_000).toISOString();
    bridge
      .on('status:get', () => ({
        onboarded: true,
        topics: [],
        untouched_topics: 0,
        active: [{ slug: 'dup-check', topic: 'hashing', hints_used: 1, started_at: started }],
        recent: [],
      }))
      .on('attempts:list', () => ({
        attempts: [
          {
            id: 1,
            slug: 'pair-with-target',
            topic: 'hashing',
            difficulty: 'easy',
            source: 'curated',
            language: 'python',
            started_at: started,
            ended_at: started,
            outcome: 'unaided',
            hints_used: 0,
            explanation_viewed: false,
            tests_passed: 3,
            tests_total: 3,
            notes: '',
          },
        ],
      }));
    show(<ProgressPage />);
    const active = await screen.findByRole('link', { name: 'Seen Before' });
    expect(active.getAttribute('href')).toBe('#/p/dup-check');
    const done = screen.getByRole('link', { name: 'Two Receipts' });
    expect(done.getAttribute('href')).toBe('#/p/pair-with-target');
    expect(screen.queryByText('dup-check')).toBeNull();
    const times = screen.getAllByText('5 min ago');
    expect(times).toHaveLength(2);
    expect(times[0]!.tagName).toBe('TIME');
    expect(times[0]!.getAttribute('title')).toBeTruthy();
  });
});

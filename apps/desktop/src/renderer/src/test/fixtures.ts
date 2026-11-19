/** Shared replies for UI tests. */
import type {
  ProblemDetail,
  ProfileResponse,
  ReportView,
  TopicView,
  WorkspaceResponse,
} from '../../../shared/practice';
import type { FakeBridge } from './fake-bridge';

export const TOPICS: TopicView[] = [
  {
    id: 'hashing',
    name: 'Hash maps & sets',
    group: 'basics',
    prerequisites: [],
    attempted: 0,
    solved: 0,
    solved_unaided: 0,
    last_practised: null,
    level: 'new',
  },
];

export const PROFILE: ProfileResponse = {
  onboarded: true,
  profile: {
    goal: 'general',
    interview_date: null,
    experience: 'beginner',
    comfort: { basics: 'none' },
    hint_preference: 'early',
    focus_topic: null,
    language: 'python',
    created_at: '2026-11-19T10:00:00Z',
    updated_at: '2026-11-19T10:00:00Z',
  },
};

export const DETAIL: ProblemDetail = {
  meta: {
    slug: 'pair-with-target',
    title: 'Two Receipts',
    topic: 'hashing',
    difficulty: 'easy',
    source: 'curated',
    languages: ['python'],
    expected_complexity: { time: 'O(n)', space: 'O(n)' },
    time_limit_ms: 1000,
  },
  statement_md: '# Two Receipts\n\nFind two receipts.\n',
  examples: [{ id: 'example-1', input: { amounts: '[5,6]', target: '11' }, expected: '[0,1]' }],
  origin: null,
  status: 'new',
  language: 'python',
  attempt_recorded: false,
};

export const STARTER = 'def find_pair(amounts, target):\n    raise NotImplementedError\n';

export const WORKSPACE: WorkspaceResponse = {
  slug: 'pair-with-target',
  language: 'python',
  exists: false,
  code: STARTER,
  starter: STARTER,
  path: '/data/workspace/pair-with-target/solution.py',
};

export const REPORT: ReportView = {
  slug: 'pair-with-target',
  language: 'python',
  passed: 1,
  total: 1,
  all_passed: true,
  duration_ms: 5,
  cases: [
    {
      id: 'example-1',
      visibility: 'visible',
      status: 'pass',
      input: { amounts: '[5,6]', target: '11' },
      expected: '[0,1]',
      actual: '[0,1]',
    },
  ],
};

/** The app-wide channels every page needs. */
export function baseHandlers(bridge: FakeBridge, profile: ProfileResponse = PROFILE): FakeBridge {
  return bridge
    .on('profile:get', () => profile)
    .on('catalog:topics', () => ({ topics: TOPICS }))
    .on('settings:theme', () => ({ theme: 'system' }))
    .on('settings:set-theme', ({ theme }) => ({ theme }))
    .on('status:get', () => ({
      onboarded: profile.onboarded,
      topics: [],
      untouched_topics: 1,
      active: [],
      recent: [],
    }));
}

/** Shared replies for UI tests. */
import { DEFAULT_SETTINGS } from '@algo/core';
import type {
  ProblemDetail,
  ProfileResponse,
  ReportView,
  TopicView,
  WorkspaceResponse,
} from '../../../shared/practice';
import type { KeyStatusView, SettingsResponse } from '../../../shared/settings';
import type { TutorStatusView } from '../../../shared/tutor';
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

export const TUTOR_OFF: TutorStatusView = {
  backend: 'none',
  available: false,
  reason: 'No tutor is set up. Add an Anthropic API key in Settings to use the tutor.',
  model: 'claude-opus-5-5',
};
export const TUTOR_ON: TutorStatusView = {
  backend: 'anthropic',
  available: true,
  reason: null,
  model: 'claude-opus-5-5',
};

export const KEY_NONE: KeyStatusView = {
  source: 'none',
  hint: null,
  stored: false,
  storage: { available: true, backend: null, weak: false },
  problem: null,
};

export function settingsFixture(): SettingsResponse {
  return {
    // Library folders hold paths and are not in the settings view (T21).
    settings: (({ tutor, execution, editor, ui, updates, library }) => ({
      tutor,
      execution,
      editor,
      ui,
      updates,
      library: { images: library.images, readAloudGpu: library.readAloudGpu },
    }))(structuredClone(DEFAULT_SETTINGS)),
    issues: [],
    default_model: 'claude-opus-5-5',
  };
}

/** The app-wide channels every page needs. `settings:set` merges into a fresh copy of the defaults. */
export function baseHandlers(bridge: FakeBridge, profile: ProfileResponse = PROFILE): FakeBridge {
  let settings = settingsFixture();
  return bridge
    .on('profile:get', () => profile)
    .on('catalog:topics', () => ({ topics: TOPICS }))
    .on('settings:get', () => settings)
    .on('settings:set', (patch) => {
      const next = structuredClone(settings.settings) as Record<string, Record<string, unknown>>;
      for (const [g, values] of Object.entries(patch))
        next[g] = { ...next[g], ...(values as Record<string, unknown>) };
      settings = { ...settings, settings: next as SettingsResponse['settings'] };
      return settings;
    })
    .on('secrets:status', () => KEY_NONE)
    .on('library:folders', () => ({ folders: [] }))
    .on('library:image-cache', () => ({ images: 0, bytes: 0 }))
    .on('tutor:status', () => TUTOR_OFF)
    .on('chat:thread', ({ thread }) => ({ thread, running: false, messages: [] }))
    .on('explanations:list', ({ slug }) => ({ slug, versions: [] }))
    .on('status:get', () => ({
      onboarded: profile.onboarded,
      topics: [],
      untouched_topics: 1,
      active: [],
      recent: [],
    }));
}

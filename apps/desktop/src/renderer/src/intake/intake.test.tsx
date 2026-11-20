// @vitest-environment jsdom
/**
 * The New Problem dialog and Import panel against a fake bridge, replaying
 * the intake recordings that core's intake tests produce
 * (`packages/core/src/intake/fixtures/events/`). Ported from
 * `dsa-tutor/web/tests/intake.test.tsx`.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntakeEventView } from '../../../shared/intake';
import { FakeBridge, installBridge, Refused } from '../test/fake-bridge';
import { NewProblemDialog, PASTE_NOTE } from './NewProblemDialog';

const recordings = import.meta.glob<IntakeEventView[]>(
  '../../../../../../packages/core/src/intake/fixtures/events/*.json',
  { import: 'default', eager: true },
);
const recording = (name: string): IntakeEventView[] => {
  const key = Object.keys(recordings).find((k) => k.endsWith(`/${name}.json`));
  if (!key) throw new Error(`no recording ${name}`);
  return recordings[key]!;
};

const TOPICS = [
  { id: 'arrays-strings', name: 'Arrays & strings' },
  { id: 'binary-search', name: 'Binary search' },
];
const JOB = `job_${'a'.repeat(24)}`;
const SET = {
  id: 'exercism',
  name: 'Exercism problem-specifications',
  url: 'https://github.com/exercism/problem-specifications',
  license: 'MIT',
  attribution: 'Copyright (c) 2014, 2019, 2021 Exercism. Used under the MIT License.',
  entries: 2,
};
const ENTRIES = [
  {
    id: 'binary-search',
    title: 'Binary Search',
    blurb: 'Implement a binary search algorithm.',
    topic: 'binary-search',
    difficulty: 'easy' as const,
    url: 'https://github.com/exercism/problem-specifications/tree/x/exercises/binary-search',
    imported: null,
  },
  {
    id: 'isogram',
    title: 'Isogram',
    blurb: 'Words with no repeated letters.',
    topic: 'arrays-strings',
    difficulty: 'easy' as const,
    url: 'https://github.com/exercism/problem-specifications/tree/x/exercises/isogram',
    imported: 'isogram-check',
  },
];

let bridge: FakeBridge;
let created: { slug: string; title: string | null; open: boolean }[];

beforeEach(() => {
  bridge = new FakeBridge()
    .on('intake:current', () => ({ jobId: null }))
    .on('intake:start', () => ({ jobId: JOB }))
    .on('intake:cancel', () => ({ cancelled: true }))
    .on('open-sets:list', () => ({ sets: [SET] }))
    .on('open-sets:entries', () => ({ set: 'exercism', entries: ENTRIES }));
  installBridge(bridge);
  created = [];
});

afterEach(cleanup);

function setup(props: Partial<Parameters<typeof NewProblemDialog>[0]> = {}) {
  return render(
    <NewProblemDialog
      open
      tutorOff={null}
      topics={TOPICS}
      onClose={() => {}}
      onCreated={(slug, title, open) => created.push({ slug, title, open })}
      {...props}
    />,
  );
}

/** Waits for the events stream, then plays a recording into it. */
async function play(name: string): Promise<void> {
  await waitFor(() => expect(bridge.streams.some((s) => s.channel === 'intake:events')).toBe(true));
  const s = bridge.streams.find((x) => x.channel === 'intake:events')!;
  expect(s.request).toEqual({ jobId: JOB });
  const events = recording(name);
  await act(async () => {
    for (const e of events) if (e.type === 'progress') s.emit(e);
    s.finish(events.at(-1));
    await Promise.resolve();
  });
}

const startRequest = () => bridge.calls.find((c) => c.channel === 'intake:start')?.request;

describe('NewProblemDialog', () => {
  it('generates a problem and reports it once (recording: generate)', async () => {
    setup();
    fireEvent.change(screen.getByLabelText(/Idea/), { target: { value: '  sensor readings ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await play('generate');
    expect(startRequest()).toEqual({
      kind: 'generate',
      topic: 'arrays-strings',
      difficulty: 'easy',
      idea: 'sensor readings',
    });
    await waitFor(() =>
      expect(created).toEqual([
        { slug: 'count-even-readings', title: 'Even Readings', open: true },
      ]),
    );
  });

  it('shows progress and the self-check attempt while it works (recording: repair)', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(bridge.streams.length).toBe(1));
    const s = bridge.streams[0]!;
    const events = recording('repair');
    await act(async () => {
      for (const e of events.slice(0, 5)) if (e.type === 'progress') s.emit(e);
      await Promise.resolve();
    });
    expect(screen.getByRole('status').textContent).toContain('Running the self-check');
    expect(screen.getByRole('status').textContent).toContain('(self-check 2 of 4)');
    expect(screen.getByRole('status').textContent).toContain(
      'The self-check failed; the tutor is fixing it',
    );
    // Stop asks main to cancel the job.
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(bridge.channels()).toContain('intake:cancel'));
  });

  it('shows the self-check failure by test id and category (recording: self-check-failed)', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await play('self-check-failed');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('did not pass the self-check after 3 repairs');
    expect(alert.textContent).toContain('hidden-3 (all even): wrong_answer');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(created).toEqual([]);
  });

  it('converts a pasted problem (recordings: paste, not-a-problem)', async () => {
    setup();
    fireEvent.click(screen.getByRole('tab', { name: 'Paste' }));
    expect(screen.getByTestId('paste-note').textContent).toBe(PASTE_NOTE);
    const convert = screen.getByRole('button', { name: 'Convert' }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText('Problem statement'), {
      target: { value: 'too short' },
    });
    expect(convert.disabled).toBe(true);
    const text = 'Given a list of whole numbers, return how many are even.';
    fireEvent.change(screen.getByLabelText('Problem statement'), { target: { value: text } });
    fireEvent.click(convert);
    await play('not-a-problem');
    expect((await screen.findByRole('alert')).textContent).toContain(
      'could not be turned into a problem: it describes no inputs or outputs.',
    );
    expect(startRequest()).toEqual({ kind: 'paste', text });
  });

  it('imports from an open set and shows its licence (recordings: import, import-refused)', async () => {
    setup();
    fireEvent.click(screen.getByRole('tab', { name: 'Import' }));
    expect((await screen.findByTestId('import-licence')).textContent).toContain('MIT');
    await screen.findByText('Binary Search');
    expect(screen.getByText(/imported as/).textContent).toContain('isogram-check');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'binary' } });
    expect(screen.queryByText('Isogram')).toBeNull();
    fireEvent.click(screen.getByRole('radio'));
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await play('import-refused');
    expect((await screen.findByRole('alert')).textContent).toContain('refused a redirect');
    expect(startRequest()).toEqual({ kind: 'import', set: 'exercism', entry: 'binary-search' });

    bridge.streams.length = 0;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await play('import');
    await waitFor(() => expect(created[0]?.slug).toBe('shelf-search'));
  });

  it('has mode tabs, capitalised difficulties, and closes by its icon or Escape', () => {
    const onClose = vi.fn();
    setup({ onClose });
    const tabs = screen.getByRole('tablist', { name: 'How to make the problem' });
    expect(tabs.className).toContain('ui-segmented');
    expect(screen.getByRole('tab', { name: 'Generate' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    const options = [...(screen.getByLabelText('Difficulty') as HTMLSelectElement).options];
    expect(options.map((o) => [o.value, o.textContent])).toEqual([
      ['easy', 'Easy'],
      ['medium', 'Medium'],
      ['hard', 'Hard'],
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'New problem' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('needs the tutor, and shows refusals', async () => {
    const { unmount } = setup({ tutorOff: 'No tutor is set up.' });
    expect((screen.getByRole('button', { name: 'Generate' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(/Needs the AI tutor: No tutor is set up./)).toBeTruthy();
    unmount();
    bridge.on('intake:start', () => {
      throw new Refused('busy', 'A new problem is already being written; wait for it to finish.');
    });
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    expect((await screen.findByRole('alert')).textContent).toContain('already being written');
  });

  it('prefills a suggestion and reattaches to a running job', async () => {
    bridge.on('intake:current', () => ({ jobId: JOB }));
    const onCreated = vi.fn();
    render(
      <NewProblemDialog
        open={false}
        tutorOff={null}
        topics={TOPICS}
        suggestion={{
          topic: 'binary-search',
          difficulty: 'medium',
          reason: 'Time for something new.',
        }}
        onClose={() => {}}
        onCreated={onCreated}
      />,
    );
    await play('generate');
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith('count-even-readings', 'Even Readings', false),
    );
    cleanup();
    bridge.on('intake:current', () => ({ jobId: null }));
    setup({
      suggestion: {
        topic: 'binary-search',
        difficulty: 'medium',
        reason: 'Time for something new.',
      },
    });
    expect(screen.getByText('Time for something new.')).toBeTruthy();
    expect((screen.getByLabelText('Topic') as HTMLSelectElement).value).toBe('binary-search');
    expect((screen.getByLabelText('Difficulty') as HTMLSelectElement).value).toBe('medium');
  });
});

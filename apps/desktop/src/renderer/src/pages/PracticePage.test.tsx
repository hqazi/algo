// @vitest-environment jsdom
/**
 * The practice view against a fake bridge: run, submit, autosave, the
 * keyboard shortcuts, and edits made to the solution file in another editor.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChatStore, ChatStoreContext } from '../chat/store';
import { Toasts } from '../components/Toasts';
import { AppProvider } from '../lib/app';
import { FakeBridge, installBridge, Refused } from '../test/fake-bridge';
import { baseHandlers, DETAIL, REPORT, WORKSPACE } from '../test/fixtures';
import { PracticePage } from './PracticePage';

// jsdom has no layout; CodeMirror measures text ranges.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

let bridge: FakeBridge;
const SLUG = 'pair-with-target';

beforeEach(() => {
  bridge = baseHandlers(new FakeBridge())
    .on('problems:get', () => DETAIL)
    .on('workspace:get', () => WORKSPACE)
    .on('problems:start', () => ({
      slug: SLUG,
      resumed: false,
      language: 'python',
      workspace: `workspace/${SLUG}/solution.py`,
      workspace_created: true,
      hints_used: 0,
    }))
    .on('workspace:save', ({ code }) => ({ bytes: code.length }))
    .on('runs:run', () => REPORT)
    .on('problems:reference', () => ({ slug: SLUG, language: 'python', code: 'def ref(): ...' }));
  installBridge(bridge);
});

afterEach(cleanup);

let chat: ChatStore;

async function open(): Promise<void> {
  chat = new ChatStore();
  render(
    <ChatStoreContext.Provider value={chat}>
      <AppProvider>
        <PracticePage slug={SLUG} />
        <Toasts />
      </AppProvider>
    </ChatStoreContext.Provider>,
  );
  await screen.findByText('Two Receipts');
  // The file has loaded once its watch has started.
  await waitFor(() =>
    expect(bridge.streams.some((s) => s.channel === 'workspace:watch')).toBe(true),
  );
}

const editor = (): EditorView => {
  const el = document.querySelector('.cm-editor');
  if (!el) throw new Error('no editor');
  return EditorView.findFromDOM(el as HTMLElement)!;
};
const editorText = (): string => editor().state.doc.toString();
const type = (text: string): void => {
  act(() => {
    const v = editor();
    v.dispatch({ changes: { from: v.state.doc.length, insert: text } });
  });
};

describe('PracticePage', () => {
  it('shows the statement, the starter code and the tutor (not set up)', async () => {
    await open();
    expect(screen.getByText('Find two receipts.')).toBeTruthy();
    expect(await screen.findByTestId('ai-unavailable')).toBeTruthy();
    expect(editorText()).toBe(WORKSPACE.code);
    expect(screen.getByTestId('save-state').textContent).toBe('Saved');
  });

  it('Run starts the attempt, runs the visible tests and shows the results', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect((await screen.findByTestId('summary')).textContent).toBe('1/1 passed');
    expect(bridge.channels()).toEqual(expect.arrayContaining(['problems:start', 'runs:run']));
    expect(bridge.channels().indexOf('problems:start')).toBeLessThan(
      bridge.channels().indexOf('runs:run'),
    );
  });

  it('saves as you type, and before a run', async () => {
    await open();
    type('# one\n');
    expect(screen.getByTestId('save-state').textContent).toBe('Unsaved changes');
    await waitFor(() => expect(screen.getByTestId('save-state').textContent).toBe('Saved'), {
      timeout: 3000,
    });
    const saves = bridge.calls.filter((c) => c.channel === 'workspace:save');
    expect(saves.at(-1)?.request).toEqual({ slug: SLUG, code: `${WORKSPACE.code}# one\n` });

    type('# two\n');
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    await screen.findByTestId('summary');
    const order = bridge.channels();
    const lastSave = order.lastIndexOf('workspace:save');
    expect(lastSave).toBeLessThan(order.lastIndexOf('runs:run'));
    expect(bridge.calls[lastSave]?.request).toMatchObject({
      code: expect.stringContaining('# two'),
    });
  });

  it('Submit records a solve, says so and opens the reference button', async () => {
    bridge.on('runs:submit', () => ({
      report: REPORT,
      recorded: true,
      record: {
        recorded: {
          slug: SLUG,
          outcome: 'unaided',
          hints_used: 0,
          tests_passed: 1,
          tests_total: 1,
        },
        topic: 'hashing',
        level: 'learning',
        level_changed: true,
        solved_unaided: 1,
      },
    }));
    await open();
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true, shiftKey: true });
    expect(await screen.findByText('Solved unaided. Recorded.')).toBeTruthy();
    expect(screen.getByText(/Level up: Hash maps & sets is now learning/)).toBeTruthy();
    expect(screen.getByTestId('problem-status').textContent).toBe('Solved');
    fireEvent.click(screen.getByRole('button', { name: 'Reference' }));
    expect(await screen.findByText('def ref(): ...')).toBeTruthy();
  });

  it('a submit that does not pass keeps the attempt open', async () => {
    bridge.on('runs:submit', () => ({
      report: { ...REPORT, passed: 0, all_passed: false },
      recorded: false,
    }));
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect((await screen.findByTestId('summary')).textContent).toBe('0/1 passed');
    expect(screen.getByTestId('problem-status').textContent).toBe('In progress');
    expect(screen.getByRole('button', { name: 'Give up' })).toBeTruthy();
  });

  it("shows the tutor's test run in the results panel", async () => {
    await open();
    act(() => {
      (chat as unknown as { emitUi(e: unknown, t: string): void }).emitUi(
        { type: 'ui', action: 'show_results', slug: SLUG, report: REPORT },
        SLUG,
      );
    });
    expect((await screen.findByTestId('summary')).textContent).toBe('1/1 passed');
    expect(screen.getByText(/Run by the tutor/)).toBeTruthy();
  });

  it('says so when the problem is busy', async () => {
    bridge.on('runs:run', () => {
      throw new Refused('busy', 'Tests are already running for this problem.');
    });
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect((await screen.findByText(/already running/)).textContent).toContain('already running');
  });

  it('loads edits made to the file in another editor', async () => {
    await open();
    const watch = bridge.streams.find((s) => s.channel === 'workspace:watch');
    expect(watch?.request).toEqual({ slug: SLUG });
    act(() => watch!.emit({ code: 'def find_pair(amounts, target):\n    return []\n' }));
    expect(editorText()).toBe('def find_pair(amounts, target):\n    return []\n');
    expect(screen.getByText(/Loaded the changes made to the solution file/)).toBeTruthy();
    // Not echoed back as a save.
    await new Promise((r) => setTimeout(r, 900));
    expect(bridge.channels()).not.toContain('workspace:save');
  });

  it('keeps unsaved edits when the file changes outside, and offers the file’s version', async () => {
    await open();
    type('# mine\n');
    const watch = bridge.streams.find((s) => s.channel === 'workspace:watch')!;
    act(() => watch.emit({ code: 'theirs = 1\n' }));
    expect(editorText()).toContain('# mine');
    fireEvent.click(screen.getByRole('button', { name: 'Load the file’s version' }));
    expect(editorText()).toBe('theirs = 1\n');
    expect(screen.queryByTestId('disk-changed')).toBeNull();
  });

  it('stops watching when the page closes', async () => {
    await open();
    const watch = bridge.streams.find((s) => s.channel === 'workspace:watch')!;
    cleanup();
    expect(watch.cancelled).toBe(true);
  });
});

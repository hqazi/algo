// @vitest-environment jsdom
/**
 * The practice view against a fake bridge: run, submit, autosave, the
 * keyboard shortcuts, and edits made to the solution file in another editor.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChatStore, ChatStoreContext } from '../chat/store';
import { Toasts } from '../components/Toasts';
import { AppProvider } from '../lib/app';
import { FakeBridge, installBridge, Refused } from '../test/fake-bridge';
import { baseHandlers, DETAIL, REPORT, WORKSPACE } from '../test/fixtures';
import { PracticePage } from './PracticePage';
import { splitConstraints } from './practice-statement';

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

describe('splitConstraints', () => {
  it('takes the Constraints section out of the statement', () => {
    const md = 'Intro.\n\n## Examples\n\nx\n\n## Constraints\n\n- 1 <= n\n\n## Notes\n\nA note.\n';
    expect(splitConstraints(md)).toEqual({
      body: 'Intro.\n\n## Examples\n\nx\n\n## Notes\n\nA note.\n',
      constraints: '- 1 <= n',
    });
    expect(splitConstraints('A.\n\n## Constraints\n- k > 0\n')).toEqual({
      body: 'A.\n',
      constraints: '- k > 0',
    });
    expect(splitConstraints('No section.\n')).toEqual({ body: 'No section.\n', constraints: null });
  });
});

describe('PracticePage', () => {
  it('shows the title, pills and a Details block with constraints and the target', async () => {
    bridge.on('problems:get', () => ({
      ...DETAIL,
      statement_md: '# Two Receipts\n\nFind two receipts.\n\n## Constraints\n\n- 2 <= n\n',
    }));
    await open();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Two Receipts');
    expect(screen.getByText('Easy').className).toContain('ui-badge-easy');
    expect(screen.getByText('Hash maps & sets')).toBeTruthy();
    const details = screen.getByRole('region', { name: 'Details' });
    expect(details.textContent).toContain('2 <= n');
    expect(details.textContent).toContain('Target time O(n), space O(n)');
    expect(screen.queryByRole('heading', { name: 'Constraints' })).toBeNull();
  });

  it('keeps Give up and Reset in the More menu', async () => {
    const confirm = window.confirm;
    window.confirm = () => true;
    try {
      await open();
      type('# mine\n');
      fireEvent.click(screen.getByRole('button', { name: 'More' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Reset' }));
      await waitFor(() => expect(editorText()).toBe(WORKSPACE.starter));
      fireEvent.click(screen.getByRole('button', { name: 'More' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Give up' }));
      const dialog = screen.getByRole('dialog', { name: 'Give up on this one?' });
      // The shared Dialog: a Close icon in the header; Keep trying has the focus.
      expect(document.activeElement?.textContent).toBe('Keep trying');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      window.confirm = confirm;
    }
  });

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
    // Give up becomes Reference once the attempt is recorded, in the More menu.
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.queryByRole('menuitem', { name: 'Give up' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reference' }));
    expect(await screen.findByText('def ref(): ...')).toBeTruthy();
    const ref = screen.getByRole('dialog', { name: 'Reference solution' });
    fireEvent.keyDown(ref, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
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
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Give up' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Reset' })).toBeTruthy();
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

  it('switches language: saves first, loads that language’s file, re-watches it', async () => {
    bridge
      .on('problems:languages', () => ({
        languages: [
          { language: 'python', available: true },
          { language: 'rust', available: false, reason: 'cargo was not found on PATH' },
          { language: 'go', available: true, version: 'go 1.24.7' },
        ],
      }))
      .on('problems:language', ({ language }) => ({
        ...WORKSPACE,
        language,
        code: 'package main\n',
        path: `/data/workspace/${SLUG}/solution.go`,
      }));
    await open();
    const picker = (await screen.findByTestId('language-picker')) as HTMLSelectElement;
    const rust = [...picker.options].find((o) => o.value === 'rust')!;
    expect(rust.disabled).toBe(true);
    expect(rust.textContent).toBe('Rust (not installed)');
    type('# mine\n');
    fireEvent.change(picker, { target: { value: 'go' } });
    await waitFor(() => expect(editorText()).toBe('package main\n'));
    const channels = bridge.channels();
    expect(channels.indexOf('workspace:save')).toBeLessThan(channels.indexOf('problems:language'));
    expect(bridge.calls.find((c) => c.channel === 'problems:language')?.request).toEqual({
      slug: SLUG,
      language: 'go',
    });
    expect(picker.value).toBe('go');
    await waitFor(() =>
      expect(bridge.streams.filter((s) => s.channel === 'workspace:watch')).toHaveLength(2),
    );
    expect(bridge.streams.find((s) => s.channel === 'workspace:watch')!.cancelled).toBe(true);
  });

  it('stops watching when the page closes', async () => {
    await open();
    const watch = bridge.streams.find((s) => s.channel === 'workspace:watch')!;
    cleanup();
    expect(watch.cancelled).toBe(true);
  });
});

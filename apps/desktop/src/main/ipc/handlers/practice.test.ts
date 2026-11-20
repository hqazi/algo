/** T31: `problems:next` with `preview` asks core for a dry run, so Home's pick does not move the focus. */
import { describe, expect, it, vi } from 'vitest';
import type { Practice } from '../../practice/service';
import { IpcRouter } from '../router';
import { FakeIpcMain, page } from '../testing';
import { registerPracticeHandlers } from './practice';

function setup() {
  const nextProblem = vi.fn(() =>
    Promise.resolve({
      ok: true as const,
      action: 'generate' as const,
      topic: 'hashing',
      topic_name: 'Hash maps & sets',
      difficulty: 'easy' as const,
      focus_changed: true,
      reason: 'hashing is your weakest topic',
    }),
  );
  const practice = { teaching: { nextProblem } } as unknown as Practice;
  const ipc = new FakeIpcMain();
  const router = new IpcRouter(ipc, { isTrustedUrl: () => true });
  registerPracticeHandlers(router, { practice });
  return { ipc, nextProblem };
}

describe('problems:next', () => {
  it('is a dry run with preview, and a real pick without it', async () => {
    const { ipc, nextProblem } = setup();
    const r = await ipc.invoke(page().event, 'problems:next', { preview: true });
    expect(r).toMatchObject({ ok: true, value: { action: 'generate', topic: 'hashing' } });
    expect(nextProblem).toHaveBeenLastCalledWith({
      topic: undefined,
      difficulty: undefined,
      dryRun: true,
    });
    await ipc.invoke(page().event, 'problems:next', {});
    expect(nextProblem).toHaveBeenLastCalledWith({
      topic: undefined,
      difficulty: undefined,
      dryRun: false,
    });
  });

  it('refuses a preview that is not a boolean', async () => {
    const { ipc, nextProblem } = setup();
    const r = await ipc.invoke(page().event, 'problems:next', { preview: 'yes' });
    expect(r).toMatchObject({ ok: false, error: { code: 'invalid_request' } });
    expect(nextProblem).not.toHaveBeenCalled();
  });
});

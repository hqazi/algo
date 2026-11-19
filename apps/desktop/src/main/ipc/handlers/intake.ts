/**
 * IPC handlers for new problems (T12): intake jobs and open sets.
 *
 * `intake:events` replays a job's events from the start and follows it until
 * it ends, so the dialog can close and reopen (or the window reload) without
 * losing a running job. Cancelling that stream only stops following; the
 * job itself stops with `intake:cancel`.
 */
import {
  IntakeError,
  OpenSetError,
  type IntakeEvent,
  type IntakeRequest,
} from '@algorithm-tutor/core';
import type { AppIntake } from '../../intake';
import { IpcRefusal, type IpcRouter } from '../router';

export interface IntakeHandlerDeps {
  intake: AppIntake;
}

function refusing<T>(fn: () => T | Promise<T>): Promise<T> {
  return Promise.resolve()
    .then(fn)
    .catch((e: unknown) => {
      if (e instanceof IntakeError) throw new IpcRefusal(e.code, e.message);
      if (e instanceof OpenSetError) throw new IpcRefusal(e.code, e.message);
      throw e;
    });
}

export function registerIntakeHandlers(router: IpcRouter, { intake }: IntakeHandlerDeps): void {
  const { service } = intake;

  router.handle('intake:start', (req) =>
    refusing(async () => {
      const job = await service.start(req as IntakeRequest);
      return { jobId: job.id };
    }),
  );

  router.handle('intake:current', () => ({ jobId: service.running()?.id ?? null }));

  router.handle('intake:cancel', ({ jobId }) => ({ cancelled: service.cancel(jobId) }));

  router.handle('open-sets:list', () => ({ sets: intake.sets.summaries() }));

  router.handle('open-sets:entries', ({ set }) =>
    refusing(async () => ({ set, entries: await intake.entries(set) })),
  );

  router.handleStream('intake:events', ({ jobId }, { signal, emit }) => {
    const job = service.get(jobId);
    if (!job) throw new IpcRefusal('not_found', 'That new problem is no longer being written.');
    return new Promise<Exclude<IntakeEvent, { type: 'progress' }>>((resolve, reject) => {
      let off: (() => void) | null = null;
      const stop = (): void => {
        off?.();
        reject(new Error('cancelled'));
      };
      signal.addEventListener('abort', stop, { once: true });
      off = job.subscribe((event) => {
        if (event.type === 'progress') {
          emit(event);
          return;
        }
        signal.removeEventListener('abort', stop);
        resolve(event);
      });
    });
  });
}

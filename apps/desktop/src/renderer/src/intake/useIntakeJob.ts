/**
 * Runs one intake job (ported from `dsa-tutor/web/src/intake/useIntakeJob.ts`):
 * `intake:start`, then follows `intake:events`, which replays the job from its
 * first event. On mount it reattaches to a job that is still running (the
 * window was reloaded), so a problem being written is never lost from view.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FailureDetailView, IntakeEventView, IntakeRequestView } from '../../../shared/intake';
import { invoke, IpcError, stream, type Stream } from '../ipc';

export type JobPhase = 'idle' | 'starting' | 'running' | 'done' | 'failed';
type Progress = Extract<IntakeEventView, { type: 'progress' }>;

export interface JobState {
  phase: JobPhase;
  jobId: string | null;
  progress: Progress[];
  slug: string | null;
  title: string | null;
  error: { code: string; message: string; detail?: FailureDetailView | undefined } | null;
}

export const IDLE: JobState = {
  phase: 'idle',
  jobId: null,
  progress: [],
  slug: null,
  title: null,
  error: null,
};

/**
 * `onDone` is called once when a job ends with a problem; when it returns
 * true the state goes back to idle (the dialog has reported it).
 */
export function useIntakeJob(onDone?: (slug: string, title: string) => boolean) {
  const [state, setState] = useState<JobState>(IDLE);
  const current = useRef<Stream<unknown> | null>(null);
  const alive = useRef(true);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  const follow = useCallback(async (jobId: string, from: JobState): Promise<void> => {
    current.current?.cancel();
    let s: JobState = { ...from, phase: 'running', jobId, progress: [] };
    const set = (next: JobState): void => {
      s = next;
      if (alive.current) setState(next);
    };
    set(s);
    const st = stream('intake:events', { jobId }, (event) => {
      if (event.type === 'progress') set({ ...s, progress: [...s.progress, event] });
    });
    current.current = st;
    try {
      const outcome = await st.result;
      if (outcome.type === 'done') {
        set({ ...s, phase: 'done', slug: outcome.slug, title: outcome.title });
        if (done.current?.(outcome.slug, outcome.title)) set(IDLE);
      } else
        set({
          ...s,
          phase: 'failed',
          error: { code: outcome.code, message: outcome.message, detail: outcome.detail },
        });
    } catch (err) {
      if (err instanceof IpcError && err.code === 'cancelled') return;
      set({
        ...s,
        phase: 'failed',
        error: {
          code: err instanceof IpcError ? (err.reason ?? err.code) : 'error',
          message: err instanceof Error ? err.message : String(err),
        },
      });
    } finally {
      if (current.current === st) current.current = null;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    invoke('intake:current')
      .then(({ jobId }) => {
        if (jobId && alive.current) void follow(jobId, IDLE);
      })
      .catch(() => {});
    return () => {
      alive.current = false;
      current.current?.cancel();
    };
  }, [follow]);

  const run = useCallback(
    async (body: IntakeRequestView): Promise<void> => {
      setState({ ...IDLE, phase: 'starting' });
      let jobId: string;
      try {
        jobId = (await invoke('intake:start', body)).jobId;
      } catch (err) {
        if (!alive.current) return;
        setState({
          ...IDLE,
          phase: 'failed',
          error: {
            code: err instanceof IpcError ? (err.reason ?? err.code) : 'error',
            message: err instanceof Error ? err.message : String(err),
          },
        });
        return;
      }
      await follow(jobId, IDLE);
    },
    [follow],
  );

  const stop = useCallback(async (): Promise<void> => {
    if (state.jobId) await invoke('intake:cancel', { jobId: state.jobId }).catch(() => {});
  }, [state.jobId]);

  const reset = useCallback(() => setState(IDLE), []);

  return { state, run, stop, reset };
}

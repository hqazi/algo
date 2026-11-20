/**
 * Handlers for the practice channels (T08): problems, attempts, runs,
 * workspace files and progress, over `Practice` (`main/practice/service.ts`).
 *
 * Expected failures (`TutorError` from core, `PracticeRefusal`) become IPC
 * refusals with a reason the UI can act on (`not_onboarded`, `busy`,
 * `locked`, `no_solution`…); anything else is an internal error.
 */
import { TutorError, type ProfileView } from '@algo/core';
import { PracticeRefusal, type Practice } from '../../practice/service';
import { IpcRefusal, type IpcRouter } from '../router';

export interface PracticeHandlerDeps {
  practice: Practice;
}

/** Run `fn`, turning expected failures into refusals. */
async function refusing<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof PracticeRefusal) throw new IpcRefusal(e.reason, e.message);
    if (e instanceof TutorError) throw new IpcRefusal(e.code ?? 'refused', e.message);
    throw e;
  }
}

/** Core results carry `ok: true`; the IPC envelope already says that. */
type WithoutOk<T> = T extends unknown ? Omit<T, 'ok'> : never;
function withoutOk<T extends { ok: true }>(value: T): WithoutOk<T> {
  const out: Partial<T> = { ...value };
  delete out.ok;
  return out as WithoutOk<T>;
}

const profileOut = (p: { onboarded: boolean; profile: ProfileView | null }) => ({
  onboarded: p.onboarded,
  profile: p.profile ? { ...p.profile, comfort: { ...p.profile.comfort } } : null,
});

export function registerPracticeHandlers(router: IpcRouter, deps: PracticeHandlerDeps): void {
  const { practice } = deps;
  const t = practice.teaching;

  router.handle('catalog:topics', () => refusing(() => ({ topics: practice.topics() })));
  router.handle('profile:get', () => refusing(() => profileOut(t.getProfile())));
  router.handle('profile:defaults', () =>
    refusing(async () => {
      await t.profileDefaults();
      return profileOut(t.getProfile());
    }),
  );
  router.handle('status:get', () =>
    refusing(() => {
      const s = t.status();
      return {
        onboarded: s.onboarded,
        topics: s.topics,
        untouched_topics: s.untouched_topics,
        active: s.active,
        recent: s.recent,
      };
    }),
  );

  router.handle('problems:list', (filters) =>
    refusing(() => ({ problems: practice.problems(filters) })),
  );
  router.handle('problems:get', ({ slug }) => refusing(() => practice.problem(slug)));
  router.handle('problems:next', (req) =>
    refusing(async () =>
      withoutOk(await t.nextProblem({ topic: req.topic, difficulty: req.difficulty })),
    ),
  );
  router.handle('problems:start', ({ slug }) =>
    refusing(async () => withoutOk(await t.start(slug))),
  );
  router.handle('problems:languages', ({ slug }) =>
    refusing(async () => ({ languages: await practice.languages(slug) })),
  );
  router.handle('problems:language', ({ slug, language }) =>
    refusing(() => practice.switchLanguage(slug, language)),
  );
  router.handle('problems:reference', ({ slug }) => refusing(() => practice.reference(slug)));

  router.handle('workspace:get', ({ slug }) => refusing(() => practice.workspace(slug)));
  router.handle('workspace:save', ({ slug, code }) => refusing(() => practice.save(slug, code)));
  router.handleStream('workspace:watch', ({ slug }, { signal, emit }) =>
    refusing(async () => {
      const handle = await practice.watch(slug, (code) => emit({ code }));
      await new Promise<void>((resolve) => {
        if (signal.aborted) return resolve();
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      handle.close();
      return { closed: true as const };
    }),
  );

  router.handle('runs:run', ({ slug }) => refusing(() => practice.run(slug)));
  router.handle('runs:submit', ({ slug }) => refusing(() => practice.submit(slug)));
  router.handle('attempts:give-up', ({ slug, notes }) =>
    refusing(() => practice.giveUp(slug, notes)),
  );
  router.handle('attempts:list', (req) =>
    refusing(() => ({ attempts: practice.attempts({ slug: req.slug, last: req.last }) })),
  );
}

/**
 * Handlers for Settings and onboarding (T09): settings, the API key, the
 * connection test, the executor's status, the questionnaire, and data.
 *
 * Settings apply at once: the tutor reads model, effort and backend for
 * every turn, the practice service reads the time scale for every run, and
 * the theme drives `nativeTheme` through a settings listener (`setup.ts`).
 */
import { TutorError } from '@algorithm-tutor/core';
import type { ProfileUpdate } from '../../../shared/settings';
import { ArchiveError, type DataService } from '../../data';
import type { Practice } from '../../practice/service';
import { SecretError, type SecretStore } from '../../secrets';
import { InvalidSettingsError, type SettingsStore } from '../../storage';
import type { AnthropicBackend } from '../../tutor';
import { IpcRefusal, type IpcRouter } from '../router';

export interface SettingsHandlerDeps {
  settings: SettingsStore;
  secrets: SecretStore;
  anthropic: Pick<AnthropicBackend, 'testConnection'>;
  defaultModel: string;
  practice: Practice;
  data: DataService;
  /**
   * Why a Rust/Go runtime cannot be chosen now (`null`: it can). Only a
   * running runtime is selectable (SPEC §6.5, T18).
   */
  runtimeRefusal?: (runtime: 'local' | 'podman' | 'docker') => Promise<string | null>;
}

async function refusing<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof InvalidSettingsError) throw new IpcRefusal('invalid', e.message);
    if (e instanceof SecretError) throw new IpcRefusal(e.reason, e.message);
    if (e instanceof ArchiveError) throw new IpcRefusal('invalid_archive', e.message);
    if (e instanceof TutorError) throw new IpcRefusal(e.code ?? 'invalid', e.message);
    throw e;
  }
}

/**
 * Keeps `target.themeSource` (Electron's `nativeTheme`) on the theme
 * setting, so `prefers-color-scheme` follows it in every window at once.
 */
export function followTheme(
  settings: SettingsStore,
  target: { themeSource: 'system' | 'light' | 'dark' },
): () => void {
  target.themeSource = settings.get().ui.theme;
  return settings.onChange((c) => {
    if (c.changed.includes('ui.theme')) target.themeSource = c.settings.ui.theme;
  });
}

/** The questionnaire's answers as `Teaching.setProfile` pairs. */
export function profilePairs(u: ProfileUpdate): Record<string, string | null> {
  const pairs: Record<string, string | null> = {
    goal: u.goal,
    interview_date: u.goal === 'interview' ? u.interview_date : null,
    experience: u.experience,
    hint_preference: u.hint_preference,
    focus_topic: u.focus_topic,
  };
  for (const [group, level] of Object.entries(u.comfort)) pairs[`comfort.${group}`] = level;
  return pairs;
}

export function registerSettingsHandlers(router: IpcRouter, deps: SettingsHandlerDeps): void {
  const { settings, secrets, practice, data } = deps;
  const t = practice.teaching;

  // Library folders (paths) are not in the view: Settings → Library has its
  // own channels, which give the renderer ids and names only (T21).
  const view = () => {
    const { tutor, execution, editor, ui, updates, library } = settings.get();
    return {
      settings: { tutor, execution, editor, ui, updates, library: { images: library.images } },
      issues: settings.issues.map((i) => ({ key: i.key, message: i.message })),
      default_model: deps.defaultModel,
    };
  };

  router.handle('profile:set', (u) =>
    refusing(async () => {
      await t.setProfile(profilePairs(u));
      const p = t.getProfile();
      return {
        onboarded: p.onboarded,
        profile: p.profile ? { ...p.profile, comfort: { ...p.profile.comfort } } : null,
      };
    }),
  );

  router.handle('settings:get', () => view());
  router.handle('settings:set', async (patch) => {
    const runtime = patch.execution?.runtime;
    if (runtime && runtime !== settings.get().execution.runtime && deps.runtimeRefusal) {
      const why = await deps.runtimeRefusal(runtime);
      if (why) throw new IpcRefusal('runtime_not_running', `Cannot use ${runtime}: ${why}.`);
    }
    return refusing(() => {
      const tutor = patch.tutor;
      // An empty model means "the default".
      const fixed =
        tutor && 'model' in tutor && typeof tutor.model === 'string' && !tutor.model.trim()
          ? { ...patch, tutor: { ...tutor, model: null } }
          : patch;
      settings.update(fixed);
      return view();
    });
  });

  router.handle('secrets:status', () => secrets.status());
  router.handle('secrets:set-key', ({ key }) => refusing(() => secrets.setApiKey(key)));
  router.handle('secrets:clear-key', () => secrets.clearApiKey());
  router.handle('tutor:test', async () => {
    const r = await deps.anthropic.testConnection();
    return { ok: r.ok, kind: r.kind, message: r.message, model: r.model };
  });

  router.handle('exec:status', async () => {
    const python = practice.toolContext.executorFor('python');
    const s = python
      ? await python.status()
      : { available: false, reason: 'No Python executor.', versions: {} };
    return {
      python: {
        available: s.available,
        reason: s.reason ?? null,
        versions: { ...(s.versions ?? {}) },
      },
    };
  });

  router.handle('data:info', () => data.info());
  router.handle('data:open-folder', async () => ({ opened: await data.openFolder() }));
  router.handle('data:export', () =>
    refusing(async () => ({ path: await data.exportInteractive() })),
  );
  router.handle('data:import', () => refusing(() => data.importInteractive()));
  router.handle('data:reset', ({ scope }) => refusing(() => data.resetInteractive(scope)));
}

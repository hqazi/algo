/**
 * Read aloud with Kokoro (T38, SPEC §15.6, D-59): the IPC channels. The
 * renderer sends text chunks and gets audio back; it never sees a path, and
 * nothing it sends reaches the network (only the model download does, on
 * the learner's say-so).
 */
import type { TtsStatus } from '../../shared/tts';
import { IpcRefusal, type IpcRouter } from '../ipc/router';
import type { TtsHost } from './host';
import { DownloadError, type ModelStore } from './model';

export { ModelStore } from './model';
export { TtsHost } from './host';

export function registerTtsHandlers(
  router: IpcRouter,
  deps: { store: ModelStore; host: TtsHost; log?: (m: string) => void },
): void {
  const { store, host } = deps;

  const status = async (): Promise<TtsStatus> => {
    const e = host.engine;
    return {
      installed: await store.installed(),
      bytes: store.bytes,
      downloading: store.downloading,
      engine: e ? { device: e.device, speed: Math.round(e.speed * 10) / 10, gpu: e.gpu } : null,
    };
  };

  router.handle('tts:status', status);

  router.handle('tts:speak', async ({ text, voice, speed }) => {
    if (!(await store.installed())) {
      throw new IpcRefusal('not_installed', 'The read-aloud voice is not downloaded.');
    }
    try {
      return { audio: await host.speak(text, voice, speed) };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      deps.log?.(`read aloud: ${message}`);
      throw new IpcRefusal('failed', `Read aloud failed: ${message}`);
    }
  });

  router.handle('tts:remove', async () => {
    if (store.downloading) throw new IpcRefusal('busy', 'The voice is still downloading.');
    host.stop();
    await store.remove();
    return status();
  });

  router.handleStream('tts:download', async (_req, { signal, emit }) => {
    try {
      await store.download((p) => emit(p), signal);
      return { installed: true, cancelled: false };
    } catch (e) {
      if (signal.aborted) return { installed: false, cancelled: true };
      if (e instanceof DownloadError) {
        throw new IpcRefusal('failed', `The voice did not download: ${e.message}.`);
      }
      throw e;
    }
  });
}

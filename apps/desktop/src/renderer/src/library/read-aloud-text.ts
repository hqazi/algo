/** Read aloud (T38): text shared by the reader's bar and Settings → Library. */
import type { TtsStatus } from '../../../shared/tts';

export function formatMB(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * Where the engine runs, e.g. "Runs on the GPU (WebGPU), 12× faster than
 * real time"; the speed once a chunk has been spoken.
 */
export function engineText(engine: TtsStatus['engine']): string | null {
  if (!engine) return null;
  const where = engine.device === 'gpu' ? `the GPU (${engine.gpu ?? 'GPU'})` : 'the CPU';
  const speed =
    engine.speed <= 0
      ? ''
      : engine.speed >= 1
        ? `, ${engine.speed}× faster than real time`
        : `, slower than real time (${engine.speed}×)`;
  const why = engine.fellBack ? 'No GPU could be used, so it runs' : 'Runs';
  return `${why} on ${where}${speed}`;
}

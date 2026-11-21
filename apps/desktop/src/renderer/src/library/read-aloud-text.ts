/** Read aloud (T38): text shared by the reader's bar and Settings → Library. */
import type { TtsStatus } from '../../../shared/tts';

export function formatMB(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** Where the engine runs, e.g. "Runs on the GPU (WebGPU), 12× faster than real time". */
export function engineText(engine: TtsStatus['engine']): string | null {
  if (!engine) return null;
  const where = engine.device === 'gpu' ? `the GPU (${engine.gpu ?? 'GPU'})` : 'the CPU';
  return `Runs on ${where}, ${engine.speed}× faster than real time`;
}

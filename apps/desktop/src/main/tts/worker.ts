/**
 * The read-aloud utility process (T38, D-59): an Electron `utilityProcess`
 * started by `host.ts` when the reader first needs speech. It loads
 * onnxruntime-node from the path main passes (the app ships it outside the
 * asar, `<resources>/onnxruntime-node`) and answers one message per chunk.
 * It gets phonemes, not text: eSpeak NG runs in its own process (D-61).
 *
 *   main → here:  { id, phonemes, voice, speed }
 *   here → main:  { id, audio } | { id, error }, and { engine } after each chunk
 */
import { createRequire } from 'node:module';
import type { TtsDevice, VoiceId } from '../../shared/tts';
import { Engine, type EngineInfo, type Ort } from './engine';

export interface WorkerConfig {
  ortPath: string;
  modelDir: string;
  device: TtsDevice;
}

export type WorkerRequest = { id: number; phonemes: string; voice: VoiceId; speed: number };
export type WorkerReply =
  | { id: number; audio: Float32Array<ArrayBuffer> }
  | { id: number; error: string }
  | { engine: EngineInfo }
  | { log: string };

interface ParentPort {
  on(event: 'message', listener: (e: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

const port = (process as unknown as { parentPort?: ParentPort }).parentPort;
const raw = process.env['ALGO_TTS_CONFIG'];

if (port && raw) {
  const config = JSON.parse(raw) as WorkerConfig;
  const ort = createRequire(import.meta.url)(config.ortPath) as Ort;
  const engine = new Engine({
    ort,
    dir: config.modelDir,
    device: config.device,
    log: (m) => port.postMessage({ log: m } satisfies WorkerReply),
  });
  port.on('message', ({ data }) => {
    const req = data as WorkerRequest;
    engine.speak(req.phonemes, req.voice, req.speed).then(
      (audio) => {
        if (engine.current) port.postMessage({ engine: engine.current } satisfies WorkerReply);
        port.postMessage({ id: req.id, audio } satisfies WorkerReply);
      },
      (e: unknown) =>
        port.postMessage({
          id: req.id,
          error: e instanceof Error ? e.message : String(e),
        } satisfies WorkerReply),
    );
  });
}

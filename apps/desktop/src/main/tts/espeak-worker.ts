/**
 * The eSpeak NG utility process (T40, D-61): turns text into phonemes and
 * does nothing else. eSpeak NG is GPL-3.0 and the app is Apache-2.0, so it
 * is not part of the app: the learner downloads it with the voice
 * (`model.ts`, checked by hash) and it runs here, in its own process, as a
 * separate program the app talks to with plain messages.
 *
 *   main → here:  { id, text, language }
 *   here → main:  { id, phonemes } | { id, error }
 *
 * `ALGO_ESPEAK_PATH` is the downloaded module (`espeak/phonemizer.js`).
 */
import { pathToFileURL } from 'node:url';

export type EspeakRequest = { id: number; text: string; language: string };
export type EspeakReply = { id: number; phonemes: string[] } | { id: number; error: string };

interface ParentPort {
  on(event: 'message', listener: (e: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

type Phonemize = (text: string, language: string) => Promise<string[]>;

const port = (process as unknown as { parentPort?: ParentPort }).parentPort;
const path = process.env['ALGO_ESPEAK_PATH'];

if (port && path) {
  // Loaded from disk at run time, never bundled into the app.
  const loaded = import(/* @vite-ignore */ pathToFileURL(path).href) as Promise<{
    phonemize: Phonemize;
  }>;
  port.on('message', ({ data }) => {
    const req = data as EspeakRequest;
    loaded
      .then(({ phonemize }) => phonemize(req.text, req.language))
      .then(
        (phonemes) => port.postMessage({ id: req.id, phonemes } satisfies EspeakReply),
        (e: unknown) =>
          port.postMessage({
            id: req.id,
            error: e instanceof Error ? e.message : String(e),
          } satisfies EspeakReply),
      );
  });
}

/**
 * The end-to-end tests' entry (T26 `e2e/library.e2e.ts`, T38
 * `e2e/read-aloud.e2e.ts`): the app exactly as `index.ts` starts it, except
 * that what it would download comes from local stand-ins instead of the
 * internet:
 *
 * - linked images from a local HTTPS stand-in (`testing/standin.ts`): its
 *   port and certificate in `ALGOTUTOR_E2E_IMAGE_PORT` and
 *   `ALGOTUTOR_E2E_IMAGE_CA` (a PEM file);
 * - the read-aloud model from a folder laid out like the Hugging Face repo,
 *   `ALGOTUTOR_E2E_TTS_DIR` (each file still checked against its hash).
 *
 * At least one must be configured. Not shipped (`electron-builder.yml`).
 */
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTestHooks, type TestHooks } from './setup';
import { standinDownload } from './testing/standin';
import { fileUrl } from './tts/model';
import './index';

const port = Number(process.env['ALGOTUTOR_E2E_IMAGE_PORT']);
const caFile = process.env['ALGOTUTOR_E2E_IMAGE_CA'];
const ttsDir = process.env['ALGOTUTOR_E2E_TTS_DIR'];
if ((!port || !caFile) && !ttsDir) throw new Error('e2e-main: no stand-in is configured');

const hooks: TestHooks = {};
if (port && caFile) {
  hooks.imageDownload = standinDownload({ port, ca: readFileSync(caFile, 'utf8') });
}
if (ttsDir) {
  const prefix = fileUrl('');
  hooks.ttsFetch = async (url) => {
    if (!url.startsWith(prefix)) return new Response('not the model repo', { status: 404 });
    try {
      return new Response(await readFile(join(ttsDir, ...url.slice(prefix.length).split('/'))));
    } catch {
      return new Response('missing', { status: 404 });
    }
  };
}
// Start-up waits for `app.whenReady()`, so this runs before anything downloads.
setTestHooks(hooks);

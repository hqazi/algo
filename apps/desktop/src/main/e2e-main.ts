/**
 * The Library end-to-end test's entry (T26, `e2e/library.e2e.ts`): the app
 * exactly as `index.ts` starts it, except that linked images download from a
 * local HTTPS stand-in (`testing/standin.ts`) instead of the internet. The
 * test passes the stand-in's port and certificate in
 * `ALGOTUTOR_E2E_IMAGE_PORT` and `ALGOTUTOR_E2E_IMAGE_CA` (a PEM file).
 * Not shipped (`electron-builder.yml`).
 */
import { readFileSync } from 'node:fs';
import { setTestHooks } from './setup';
import { standinDownload } from './testing/standin';
import './index';

const port = Number(process.env['ALGOTUTOR_E2E_IMAGE_PORT']);
const caFile = process.env['ALGOTUTOR_E2E_IMAGE_CA'];
if (!port || !caFile) throw new Error('e2e-main: the image stand-in is not configured');
// Start-up waits for `app.whenReady()`, so this runs before the downloader is made.
setTestHooks({ imageDownload: standinDownload({ port, ca: readFileSync(caFile, 'utf8') }) });

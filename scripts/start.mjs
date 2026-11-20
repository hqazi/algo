/**
 * `npm start`: one command that opens the app from a checkout.
 *
 * - Runs `npm ci` when `node_modules` is missing or older than
 *   `package-lock.json` (the lock is held to the 14-day cooldown, D-45/D-48).
 * - Downloads Electron's binary if an earlier install skipped it
 *   (`--ignore-scripts`).
 * - Starts `electron-vite dev`. On Linux it asks for X11 (XWayland): under
 *   Wayland, Chromium cannot use Vulkan and the window may never show.
 *   `ALGO_OZONE_PLATFORM=wayland npm start` overrides that.
 *
 * Plain JavaScript, not TypeScript: it has to run before anything is installed.
 */
import { spawnSync } from 'node:child_process';
import console from 'node:console';
import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(cmd, args) {
  const { status, error } = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (error) throw error;
  if (status !== 0) process.exit(status ?? 1);
}

const installed = join(root, 'node_modules', '.package-lock.json');
if (
  !existsSync(installed) ||
  statSync(installed).mtimeMs < statSync(join(root, 'package-lock.json')).mtimeMs
) {
  console.log('Installing dependencies (npm ci)...');
  run(npm, ['ci']);
}

if (!existsSync(join(root, 'node_modules', 'electron', 'path.txt'))) {
  console.log('Downloading Electron...');
  run(process.execPath, [join(root, 'node_modules', 'electron', 'install.js')]);
}

const electronArgs = [];
if (process.platform === 'linux') {
  electronArgs.push(`--ozone-platform=${process.env['ALGO_OZONE_PLATFORM'] || 'x11'}`);
}
run(npm, ['run', 'dev', '--workspace', 'apps/desktop', '--', '--', ...electronArgs]);

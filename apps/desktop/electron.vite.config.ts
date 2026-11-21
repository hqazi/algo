import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Workspace packages ship TypeScript source, so they are bundled rather than
// left as runtime `require`s like ordinary node_modules dependencies.
const bundled = ['@algo/core'];

const src = (p: string): string => resolve(import.meta.dirname, 'src', p);

// Pyodide's runtime files, shipped with the app and served to the execution
// host at /pyodide/ (SPEC §6.2). Nothing is loaded from a CDN.
const PYODIDE_FILES = [
  'pyodide.mjs',
  'pyodide.asm.mjs',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
  'pyodide-lock.json',
];
const CONTENT_TYPES: Record<string, string> = {
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.zip': 'application/zip',
};
const pyodideDir = dirname(createRequire(import.meta.url).resolve('pyodide/package.json'));

function pyodideAssets(): Plugin {
  return {
    name: 'algo:pyodide-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.match(/^\/pyodide\/([^?]+)/)?.[1];
        if (!name || !PYODIDE_FILES.includes(name)) return next();
        const ext = name.slice(name.lastIndexOf('.'));
        res.setHeader('Content-Type', CONTENT_TYPES[ext] ?? 'application/octet-stream');
        res.end(readFileSync(join(pyodideDir, name)));
      });
    },
    generateBundle() {
      for (const name of PYODIDE_FILES) {
        this.emitFile({
          type: 'asset',
          fileName: `pyodide/${name}`,
          source: readFileSync(join(pyodideDir, name)),
        });
      }
    },
  };
}

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: bundled },
      rolldownOptions: {
        input: {
          index: src('main/index.ts'),
          // `npm run check:exec-host`: drives the real execution host window.
          'exec-check': src('main/exec/check.ts'),
          // `npm run check:security`: the security baseline in the real window.
          'security-check': src('main/security-check.ts'),
          // `npm run check:storage`: SQLite storage under Electron's Node.
          'storage-check': src('main/storage/check.ts'),
          // `npm run e2e` (library.e2e.ts): the app with a local image-host stand-in.
          'e2e-main': src('main/e2e-main.ts'),
          // Read aloud (T38): the Kokoro engine's utility process.
          'tts-worker': src('main/tts/worker.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: { exclude: bundled },
      rolldownOptions: {
        input: { index: src('preload/index.ts'), 'exec-host': src('exec-host/preload.ts') },
        // Sandboxed preload scripts must be CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    // Two pages: the UI (renderer/) and the execution host (exec-host/).
    root: src('.'),
    plugins: [react(), pyodideAssets()],
    worker: { format: 'es' },
    build: {
      rolldownOptions: {
        input: { index: src('renderer/index.html'), 'exec-host': src('exec-host/index.html') },
      },
    },
  },
});

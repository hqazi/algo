import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

// Workspace packages ship TypeScript source, so they are bundled rather than
// left as runtime `require`s like ordinary node_modules dependencies.
const bundled = ['@algorithm-tutor/core'];

export default defineConfig({
  main: {
    build: { externalizeDeps: { exclude: bundled } },
  },
  preload: {
    build: {
      externalizeDeps: { exclude: bundled },
      // Sandboxed preload scripts must be CommonJS.
      rolldownOptions: {
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    plugins: [react()],
  },
});

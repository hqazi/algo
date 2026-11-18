import { fileURLToPath } from 'node:url';

export const HARNESS_PATH = fileURLToPath(
  new URL('../../../../../content/runners/python/harness.py', import.meta.url),
);

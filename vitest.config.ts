import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/core',
      'apps/desktop',
      { test: { name: 'scripts', environment: 'node', include: ['scripts/**/*.test.ts'] } },
    ],
  },
});

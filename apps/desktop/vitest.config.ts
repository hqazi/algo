import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'desktop',
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    // styles.test.ts reads the design tokens (`styles.css?raw`).
    css: { include: [/styles\.css/] },
  },
  oxc: { jsx: { runtime: 'automatic' } },
});

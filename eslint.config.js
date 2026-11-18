import { builtinModules } from 'node:module';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

// packages/core must run in Node and the browser alike (SPEC §3.1).
const nodeOnly = [
  'electron',
  'electron/*',
  ...builtinModules.flatMap((m) => [m, `${m}/*`]),
  'node:*',
];

export default tseslint.config(
  { ignores: ['**/node_modules/', '**/out/', '**/dist/', '**/coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,ts,tsx}'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
  },
  {
    files: [
      '*.{js,ts}',
      'scripts/**/*.ts',
      '**/*.config.{js,ts}',
      'apps/desktop/src/{main,preload}/**/*.ts',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: nodeOnly,
              message:
                'packages/core must not import Electron or Node built-ins; inject it instead.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
);

// @ts-check
/**
 * Lint configuration.
 *
 * The module-boundary rules are duplicated here as a fast editor signal, but the
 * enforcement that matters lives in `tests/integration/architecture.test.ts`: a
 * lint run can be skipped and `pnpm test` is a release gate.
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', 'dist/**', 'node_modules/**', 'tests/fixtures/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Build and fixture scripts are plain Node ESM; TypeScript sources get their
    // globals from `@types/node` instead.
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
    },
  },
  {
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'node:*',
                'fs',
                'path',
                'os',
                'process',
                'child_process',
                '@token-harness/adapters',
                'token-harness',
              ],
              message:
                'core is the domain layer: no filesystem, no process, and no dependency on adapters or the cli (PLAN §1.2).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/platform/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@token-harness/core/*',
                '**/core/src/**',
                '@token-harness/adapters',
                'token-harness',
              ],
              message:
                'platform sits directly above core: entry-point imports only, and never adapters or the cli (PLAN §2.1).',
            },
          ],
        },
      ],
    },
  },
  {
    // RFC 0004 §Process policy: spawning lives in one file, so the invariant can be
    // verified by reading one file.
    files: ['packages/platform/src/**/*.ts'],
    ignores: ['packages/platform/src/process/node-runner.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'node:child_process', message: 'Spawning belongs to NodeProcessRunner.' },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/adapters/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@token-harness/core/*',
                '**/core/src/**',
                '@token-harness/platform/*',
                'token-harness',
              ],
              message:
                'adapters reach core and platform only through their package entry points, and never reach the cli (PLAN §1.1).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/cli/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@token-harness/core/*',
                '@token-harness/platform/*',
                '@token-harness/adapters/*',
              ],
              message: 'Import workspace packages through their entry points.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/test/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.mjs', 'tests/tools/**/*.mjs'],
    rules: {
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);

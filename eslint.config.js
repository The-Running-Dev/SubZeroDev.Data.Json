// @ts-check
import tseslint from 'typescript-eslint';

/**
 * Determinism guard (20-contract.md I1, copied from src/engine/eslint.config.js per
 * 30-slices.md J1.8). The core imports no module and references no fs, fetch, window,
 * process, Date.now, Math.random, or non-bit-stable Math.*. AbortController is the one
 * permitted ambient global, and only to cancel a transport attempt.
 */
export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    files: ['src/core/**/*.ts'],
    ignores: ['src/core/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'I1: the core is deterministic; Math.random is banned.' },
        { object: 'Math', property: 'pow', message: 'I1: not bit-stable across runtimes.' },
        { object: 'Math', property: 'exp', message: 'I1: not bit-stable across runtimes.' },
        { object: 'Math', property: 'log', message: 'I1: not bit-stable across runtimes.' },
        { object: 'Math', property: 'sin', message: 'I1: not bit-stable across runtimes.' },
        { object: 'Math', property: 'cos', message: 'I1: not bit-stable across runtimes.' },
        { object: 'Math', property: 'tan', message: 'I1: not bit-stable across runtimes.' },
        { object: 'Date', property: 'now', message: 'I1: no wall-clock in the core.' },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'I1: the core takes fetch as a port, never ambient.' },
        { name: 'window', message: 'I1: the core is environment-agnostic.' },
        { name: 'process', message: 'I1: the core is environment-agnostic.' },
        { name: 'Date', message: 'I1: no wall-clock in the core; pass time in as data.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['fs', 'fs/*', 'node:fs', 'node:fs/*', 'node:*'],
              message: 'I1: the core imports no module.',
            },
          ],
        },
      ],
    },
  },
);

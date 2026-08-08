// @ts-check
import tseslint from 'typescript-eslint';

/**
 * Two guards over 10-design.md §2's star graph.
 *
 * Determinism guard (20-contract.md I1, copied from src/engine/eslint.config.js per
 * 30-slices.md J1.8). The core imports no module and references no fs, fetch, window,
 * process, Date.now, Math.random, or non-bit-stable Math.*. AbortController is the one
 * permitted ambient global, and only to cancel a transport attempt. This is the core's
 * out-degree half.
 *
 * Leaf boundary guard (20-contract.md I37, D51). Each leaf's in-degree from its siblings is
 * zero: /node, /build, /zod, and /react reach into the core and outward to their own declared
 * dependencies, never sideways. /build importing /node is the specific edge D19 forbids,
 * because it is the seam through which FileSystemPort would acquire a write member.
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
      // D50: I1 says the core imports *no* module and that the guard, not review, is what
      // enforces it. The builtin ban above leaves every npm specifier clean, so the claim
      // rested on review after all. `no-restricted-imports` cannot express "bare specifier" —
      // its gitignore-style matcher normalizes `./` away, so a negation that spares the core's
      // own siblings also spares `js-yaml`. An esquery regex on the source string can.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportDeclaration[source.value=/^[^.]/]',
          message: 'I1: the core imports no module — only its own relative siblings.',
        },
        {
          selector: 'ImportExpression:not([source.value=/^\./])',
          message: 'I1: the core imports no module — only its own relative siblings.',
        },
        {
          selector: ':matches(ExportNamedDeclaration, ExportAllDeclaration)[source.value=/^[^.]/]',
          message: 'I1: the core re-exports from no module — only its own relative siblings.',
        },
      ],
    },
  },
  {
    files: ['src/node/**/*.ts', 'src/build/**/*.ts', 'src/zod/**/*.ts', 'src/react/**/*.ts'],
    ignores: ['src/**/*.test.ts'],
    rules: {
      // I37: the same esquery-on-the-source-string technique D50 established for I1, for the
      // same reason — `no-restricted-imports` normalizes `../` away, so a pattern written to
      // catch a sibling reach cannot be trusted to only catch one. `../core/` is the edge the
      // star graph is made of and is deliberately absent from the alternation.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportDeclaration[source.value=/^\\.\\.\\/(node|build|zod|react)\\//]',
          message: 'I37: a leaf imports no sibling leaf — only the core and its own files.',
        },
        {
          selector: 'ImportExpression[source.value=/^\\.\\.\\/(node|build|zod|react)\\//]',
          message: 'I37: a leaf imports no sibling leaf — only the core and its own files.',
        },
        {
          selector:
            ':matches(ExportNamedDeclaration, ExportAllDeclaration)[source.value=/^\\.\\.\\/(node|build|zod|react)\\//]',
          message: 'I37: a leaf re-exports from no sibling leaf — only the core and its own files.',
        },
      ],
    },
  },
);

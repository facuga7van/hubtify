/**
 * Classic eslintrc config (ESLint 8 + typescript-eslint v5).
 * Works with the existing `eslint --ext .ts,.tsx .` script.
 * Rules are intentionally pragmatic: this is the first lint pass over a
 * codebase that never had one, so noisy stylistic rules are relaxed to keep
 * the signal useful. Tighten over time.
 */
module.exports = {
  root: true,
  env: { browser: true, node: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  ignorePatterns: [
    'node_modules',
    'dist',
    '.vite',
    'out',
    'coverage',
    '.worktrees',
    'e2e/.artifacts',
    'tests/visual/screens',
  ],
  rules: {
    // React Hooks — declared explicitly (not via preset) so it works across
    // plugin major versions. rules-of-hooks catches real bugs.
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    // Unused vars are worth knowing about, but as warnings, and allow the
    // conventional `_`-prefix opt-out.
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
    ],
    // Pragmatic relaxations for a large, previously-unlinted codebase.
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/no-empty-function': 'off',
    '@typescript-eslint/no-inferrable-types': 'off',
    '@typescript-eslint/no-var-requires': 'off',
    'prefer-const': 'warn',
    'no-empty': ['warn', { allowEmptyCatch: true }],
    'no-constant-condition': ['error', { checkLoops: false }],
  },
};

/**
 * ESLint 8.57 (eslintrc format — the `lint` script runs `eslint --ext .ts,.tsx .`).
 *
 * Goal: catch REAL bugs (hook order crashes, unreachable code, accidental globals),
 * not enforce style. Formatting rules are deliberately absent.
 */
module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  settings: {
    react: { version: 'detect' },
  },
  ignorePatterns: [
    'node_modules/',
    '.vite/',
    'out/',
    'dist/',
    'functions/lib/',
    'functions/node_modules/',
    '.worktrees/',
    'docsexample/',
    'designIdeas/',
    '*.config.js',
    '*.config.mjs',
  ],
  rules: {
    // ── The whole point of this config ────────────────────────────────
    // Two rules-of-hooks violations (early return before a hook) shipped
    // and crashed the app because nothing was linting. Never again.
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',

    // ── React correctness (not style) ─────────────────────────────────
    'react/jsx-key': 'error',
    'react/jsx-no-duplicate-props': 'error',
    'react/jsx-no-undef': 'error',
    'react/no-children-prop': 'error',
    'react/no-direct-mutation-state': 'error',
    // The new JSX transform is on (`jsx: 'react-jsx'`), so these are noise.
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    'react/display-name': 'off',

    // ── TypeScript: keep the bug-catching half, drop the nagging half ──
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/no-empty-function': 'off',
    '@typescript-eslint/no-empty-interface': 'off',
    '@typescript-eslint/ban-ts-comment': 'warn',
    '@typescript-eslint/no-var-requires': 'off',
    // Pure style, zero bug value — an explicit `: string = '...'` is fine.
    '@typescript-eslint/no-inferrable-types': 'off',

    // ── Plain-JS footguns ─────────────────────────────────────────────
    'no-unused-vars': 'off', // superseded by the TS version above
    'no-undef': 'off', // TypeScript already does this, and better
    'no-console': 'off',
    'no-empty': ['warn', { allowEmptyCatch: true }],
    'no-constant-condition': ['error', { checkLoops: false }],
    eqeqeq: ['warn', 'smart'],
    'no-var': 'error',
    'prefer-const': 'warn',
  },
  overrides: [
    {
      // Vitest specs: relaxed, they are not shipped.
      files: ['**/*.test.ts', '**/*.test.tsx', 'tests/**/*.ts'],
      env: { node: true },
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
      },
    },
    {
      // Cloud Functions run on Node with their own tsconfig.
      files: ['functions/**/*.ts'],
      env: { node: true, browser: false },
    },
  ],
};

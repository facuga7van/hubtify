import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { fileURLToPath } from 'node:url';
import pkg from './package.json' with { type: 'json' };

// Absolute paths — Vite's browser transform won't resolve relative aliases.
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const alias = {
  '@core': r('./src/core'),
  '@hub': r('./src/hub'),
  '@shared': r('./src/shared'),
  '@modules': r('./src/modules'),
  '@logic': r('./shared-logic'),
};

export default defineConfig({
  // El renderer se compila con este define (vite.renderer.config.ts); sin él un
  // test de browser que monte el shell revienta con «APP_VERSION is not defined».
  define: { APP_VERSION: JSON.stringify(pkg.version) },
  resolve: { alias },
  test: {
    projects: [
      {
        // Backend / IPC tests — run in Node with in-memory SQLite (unchanged).
        extends: true,
        test: {
          name: 'unit',
          globals: true,
          environment: 'node',
          include: ['src/**/*.test.ts', 'shared/**/*.test.ts', 'tests/**/*.test.ts'],
          setupFiles: ['tests/setup.ts'],
        },
      },
      {
        // Visual / component tests — run in a real Chromium via Playwright.
        extends: true,
        test: {
          name: 'browser',
          include: ['tests/visual/**/*.test.tsx'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
            viewport: { width: 900, height: 720 },
          },
        },
      },
    ],
  },
});

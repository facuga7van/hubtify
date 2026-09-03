import { defineConfig, configDefaults } from 'vitest/config';
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
          // Montar una pantalla entera en un Chromium real no entra en los 5 s
          // por defecto de vitest, y con la máquina cargada tampoco en 15 s: se
          // caía con «Test timed out» en suites que pasan sueltas, y el falso
          // negativo se leía como regresión. Va en la config y no en el script
          // de package.json para que valga también en CI y en el IDE.
          testTimeout: 60_000,
          include: ['tests/visual/**/*.test.tsx'],
          // El subárbol mobile corre en su propio project (abajo), con otro
          // viewport y el define de Android.
          exclude: [...configDefaults.exclude, 'tests/visual/mobile/**'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
            viewport: { width: 900, height: 720 },
          },
        },
      },
      {
        // Arnés mobile (spec §7): mismo Chromium, viewport 390×844 y el define
        // de Android. Sin bridge de Capacitor, isNativeMobile() da true, Layout
        // monta MobileShell y TitleBar devuelve null.
        extends: true,
        define: { __HUBTIFY_PLATFORM__: '"android"' },
        test: {
          name: 'browser-mobile',
          // Misma razón que en `browser`: el project móvil es el que más sufre
          // la contención (13 archivos que montan el shell entero).
          testTimeout: 60_000,
          include: ['tests/visual/mobile/**/*.test.tsx'],
          browser: {
            enabled: true,
            // Touch emulado: así `(hover: none)` matchea y las reglas de
            // touch de cada módulo se pueden verificar en el arnés. Las
            // contextOptions van en el provider (BrowserInstanceOption no las
            // acepta: solo `provider`, ver @vitest/browser-playwright).
            provider: playwright({ contextOptions: { hasTouch: true, isMobile: true } }),
            headless: true,
            instances: [{ browser: 'chromium' }],
            viewport: { width: 390, height: 844 },
          },
        },
      },
    ],
  },
});

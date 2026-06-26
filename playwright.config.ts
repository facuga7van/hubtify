import { defineConfig } from '@playwright/test';

// E2E against the REAL packaged Electron app (preload, IPC, native deps).
// Run `npm run package` first so there is an executable to launch.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: './e2e/.artifacts',
});

import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { existsSync, readdirSync, statSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Locate the packaged app bundle produced by `npm run package`.
// Forge drops it under out/<ProductName>-<platform>-<arch>/resources/app.asar.
// We launch the RAW electron binary (from node_modules, so Playwright can
// instrument it) with this bundle as its app — not the rebranded .exe, which
// Playwright cannot attach its CDP to.
function findPackagedApp(): string | null {
  const outDir = join(process.cwd(), 'out');
  if (!existsSync(outDir)) return null;
  for (const entry of readdirSync(outDir)) {
    const dir = join(outDir, entry);
    if (!statSync(dir).isDirectory()) continue;
    const asar = join(dir, 'resources', 'app.asar');
    if (existsSync(asar)) return asar;
  }
  return null;
}

const appPath = findPackagedApp();

test.describe('AuthPage — real Electron window', () => {
  test.skip(!appPath, 'Run `npm run package` first to build the Electron app.');

  let app: ElectronApplication;

  test.beforeAll(async () => {
    // Fresh userData dir → no persisted Firebase session → lands on login,
    // and never touches the real user's profile/data.
    const userDataDir = mkdtempSync(join(tmpdir(), 'hubtify-e2e-'));
    app = await electron.launch({
      args: [appPath!, `--user-data-dir=${userDataDir}`],
    });
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test('login screen renders', async () => {
    const window = await app.firstWindow();
    await window.waitForSelector('.auth-card', { timeout: 30_000 });
    await expect(window.locator('.auth-card__title')).toBeVisible();
    await window.screenshot({ path: 'e2e/screens/electron-01-login.png' });
  });

  test('switch to register', async () => {
    const window = await app.firstWindow();
    await window.getByRole('button', { name: '¿No tenés cuenta? Registrate' }).click();
    await expect(window.getByRole('button', { name: 'Crear Cuenta' })).toBeVisible();
    await window.screenshot({ path: 'e2e/screens/electron-02-register.png' });
  });
});

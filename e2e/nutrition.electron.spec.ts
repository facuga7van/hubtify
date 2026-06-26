import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { existsSync, readdirSync, statSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Smoke test for the REAL packaged Electron app, focused on the Nutrify schema.
// Nutrify's screens live behind the Firebase login, which we can't automate
// without real credentials (and we must not touch the user's real account).
// But the nutrition migrations (V1-V11, incl. the macro + reopen-day work) run
// at boot in electron/main.ts BEFORE any login — against a real on-disk SQLite
// file, not the in-memory DB the unit tests use. So if a migration is broken,
// the main process crashes at startup and the window never appears.
// This verifies the one thing Browser Mode (mocks + :memory:) cannot: that the
// new schema boots clean in the packaged binary.
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

test.describe('Nutrify schema — real Electron boot', () => {
  test.skip(!appPath, 'Run `npm run package` first to build the Electron app.');

  let app: ElectronApplication;
  const stderr: string[] = [];

  test.beforeAll(async () => {
    // Fresh userData dir → migrations run against a brand-new on-disk DB and
    // the real user's profile/data is never touched.
    const userDataDir = mkdtempSync(join(tmpdir(), 'hubtify-nutri-e2e-'));
    app = await electron.launch({
      args: [appPath!, `--user-data-dir=${userDataDir}`],
    });
    // Capture main-process stderr so a migration error that logs but doesn't
    // crash still fails the test.
    app.process().stderr?.on('data', (d) => stderr.push(d.toString()));
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test('app boots — nutrition migrations ran without crashing', async () => {
    // If runModuleMigrations(nutritionMigrations) threw (broken V10/V11),
    // the main process would die and firstWindow would time out.
    const window = await app.firstWindow();
    await window.waitForSelector('.auth-card', { timeout: 30_000 });
    await expect(window.locator('.auth-card__title')).toBeVisible();
    await window.screenshot({ path: 'e2e/screens/electron-nutri-01-boot.png' });
  });

  test('no migration/SQLite errors on the main process', async () => {
    const noise = stderr.join('');
    // Surface anything that looks like a schema/migration failure.
    expect(noise).not.toMatch(/SqliteError|no such column|duplicate column|migration|near ".*": syntax error/i);
  });

  test('macro columns exist in the real on-disk schema', async () => {
    // Ask the main process to introspect the actual SQLite file it migrated.
    // Proves V10 (macros) and V11 (reopen-day soft-delete) physically landed.
    const cols = await app.evaluate(async ({ app: electronApp }) => {
      // Lazy-require so this runs inside the packaged main process.
      const path = require('node:path');
      const Database = require('better-sqlite3');
      const dbPath = path.join(electronApp.getPath('userData'), 'hubtify.db');
      const db = new Database(dbPath, { readonly: true });
      const foodLog = db.prepare("PRAGMA table_info(food_log)").all().map((c: { name: string }) => c.name);
      const closed = db.prepare("PRAGMA table_info(nutrition_daily_closed)").all().map((c: { name: string }) => c.name);
      db.close();
      return { foodLog, closed };
    });
    expect(cols.foodLog).toEqual(expect.arrayContaining(['protein_g', 'carbs_g', 'fat_g', 'deleted_at']));
    expect(cols.closed).toEqual(expect.arrayContaining(['deleted_at', 'updated_at']));
  });
});

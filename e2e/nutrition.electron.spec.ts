import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { existsSync, readdirSync, statSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
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
  let userDataDir: string;
  const stderr: string[] = [];

  test.beforeAll(async () => {
    // Fresh userData dir → migrations run against a brand-new on-disk DB and
    // the real user's profile/data is never touched.
    userDataDir = mkdtempSync(join(tmpdir(), 'hubtify-nutri-e2e-'));
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
    // Introspect the actual on-disk SQLite file the app migrated at boot.
    // Proves V10 (macros) and V11 (reopen-day soft-delete) physically landed.
    // Runs INSIDE the packaged main process: better-sqlite3 is built for
    // Electron's ABI, so it cannot be required from Playwright's plain-node side.
    const dbPath = join(userDataDir, 'hubtify.db');
    // Native module is unpacked outside the asar; require it by absolute path so
    // resolution doesn't depend on the eval scope's module paths.
    const bsqPath = join(dirname(appPath!), 'app.asar.unpacked', 'node_modules', 'better-sqlite3');
    const cols = await app.evaluate(async (_electron, args) => {
      // Playwright's evaluate runs in a bare eval scope with no lexical `require`;
      // reach the bundle's require through the main module instead.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const req = (typeof require === 'function' ? require : (globalThis as any).process.mainModule.require);
      const Database = req(args.bsqPath);
      const db = new Database(args.dbFile, { readonly: true });
      const names = (tbl: string) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        db.prepare(`PRAGMA table_info(${tbl})`).all().map((c: any) => c.name as string);
      const foodLog = names('food_log');
      const closed = names('nutrition_daily_closed');
      db.close();
      return { foodLog, closed };
    }, { dbFile: dbPath, bsqPath });
    expect(cols.foodLog).toEqual(expect.arrayContaining(['protein_g', 'carbs_g', 'fat_g', 'deleted_at']));
    expect(cols.closed).toEqual(expect.arrayContaining(['deleted_at', 'updated_at']));
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

let testDb: Database.Database;

vi.mock('../../shared-logic/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared-logic/db')>();
  return { ...actual, getDb: () => testDb, runModuleMigrations: vi.fn() };
});

const { initCoreTables, applyMigrations, coreMigrations } = await import('../../shared-logic/db');
import { getHandler, clearHandlers } from '../../shared-logic/registry';
import { registerRpgHandlers } from '../../shared-logic/modules/rpg-handlers';
import { NON_MEANINGFUL_EVENT_TYPES } from '../../shared/rpg-engine';

const WEEK = '2026-08-31';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initCoreTables(db);
  applyMigrations(db, coreMigrations);
  const today = new Date().toLocaleDateString('en-CA');
  db.prepare("UPDATE player_stats SET xp = 100, hp = 80, hp_date = ? WHERE user_id = 'default'").run(today);
  return db;
}

const process = (event: Record<string, unknown>) =>
  getHandler('rpg:processEvent')!({}, event);

const seal = (payload: Record<string, unknown>) =>
  process({ type: 'WEEK_SUMMARY', moduleId: 'nutrition', payload, timestamp: Date.now() });

describe('WEEK_SUMMARY', () => {
  beforeEach(() => {
    testDb = setupDb();
    clearHandlers();
    registerRpgHandlers();
  });

  it('paga plano: sin combo ni bonus aleatorio', async () => {
    const res = await seal({ xp: 50, hp: 0, weekStart: WEEK }) as any;
    expect(res.xpGained).toBe(50);
  });

  it('el guard por ref_id impide cobrar la misma semana dos veces', async () => {
    await seal({ xp: 50, hp: 0, weekStart: WEEK });
    const second = await seal({ xp: 50, hp: 0, weekStart: WEEK }) as any;
    expect(second.xpGained).toBe(0);
  });

  it('semanas distintas cobran cada una', async () => {
    await seal({ xp: 50, hp: 0, weekStart: WEEK });
    const other = await seal({ xp: 29, hp: 0, weekStart: '2026-09-07' }) as any;
    expect(other.xpGained).toBe(29);
  });

  it('sin weekStart no se paga: no hay fallback de balde', async () => {
    const res = await seal({ xp: 50, hp: 0 }) as any;
    expect(res.xpGained).toBe(0);
  });

  it('sin payload.xp paga 0 — el emisor DEBE declararlo', async () => {
    const res = await seal({ hp: 0, weekStart: WEEK }) as any;
    expect(res.xpGained).toBe(0);
  });

  it('no cuenta como evento significativo: no alimenta los logros diarios', () => {
    expect(NON_MEANINGFUL_EVENT_TYPES).toContain('WEEK_SUMMARY');
  });

  it('sellar 4 semanas atrasadas no infla el conteo de eventos del día', async () => {
    for (const w of ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24']) {
      await seal({ xp: 50, hp: 0, weekStart: w });
    }
    const meaningful = testDb.prepare(`
      SELECT COUNT(*) AS n FROM rpg_events
      WHERE xp_gained > 0 AND event_type NOT IN (${NON_MEANINGFUL_EVENT_TYPES.map(() => '?').join(',')})
    `).get(...NON_MEANINGFUL_EVENT_TYPES) as { n: number };
    expect(meaningful.n).toBe(0);
  });
});

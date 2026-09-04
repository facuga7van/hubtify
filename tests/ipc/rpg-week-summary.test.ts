import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

let testDb: Database.Database;

vi.mock('../../shared-logic/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared-logic/db')>();
  return { ...actual, getDb: () => testDb, runModuleMigrations: vi.fn() };
});

const { initCoreTables, applyMigrations, coreMigrations } = await import('../../shared-logic/db');
import { getHandler, clearHandlers } from '../../shared-logic/registry';
import { registerRpgHandlers, buildAchievementContext } from '../../shared-logic/modules/rpg-handlers';
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
    // rollRandomBonus() devuelve 1.0 el 70% de las veces (RANDOM_BONUS_TABLE,
    // shared/types.ts): si alguien sacara WEEK_SUMMARY de FLAT_XP_EVENTS,
    // xpGained seguiría dando 50 en la mayoría de las corridas y este test
    // NO lo detectaría. Por eso, igual que rpg-codex para DAY_SEALED, se
    // ceba el combo con eventos reales primero y se verifican las columnas
    // PERSISTIDAS (combo_multiplier / bonus_multiplier), que son deterministas.
    for (let i = 0; i < 4; i++) {
      await process({
        type: 'TASK_COMPLETED', moduleId: 'quests',
        payload: { xp: 10, hp: 0, taskId: `t${i}` }, timestamp: Date.now(),
      });
    }

    const res = await seal({ xp: 50, hp: 0, weekStart: WEEK }) as any;
    expect(res.xpGained).toBe(50);

    const row = testDb.prepare(
      "SELECT xp_gained AS xp, combo_multiplier AS combo, bonus_multiplier AS bonus FROM rpg_events WHERE event_type = 'WEEK_SUMMARY'"
    ).get() as { xp: number; combo: number; bonus: number };
    expect(row.combo).toBe(1.0);
    expect(row.bonus).toBe(1.0);
    expect(row.xp).toBe(50);
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

  it('sellar 4 semanas atrasadas no infla el contexto diario que consume el matcher de logros', async () => {
    // El test viejo armaba el filtro SQL con NON_MEANINGFUL_EVENT_TYPES y
    // consultaba con ese mismo array como predicado: solo podía fallar si
    // WEEK_SUMMARY faltaba del array, algo que el test de arriba ('no cuenta
    // como evento significativo') ya cubre con toContain. Nunca tocaba al
    // matcher real. Este test llama a buildAchievementContext — la misma
    // función que polymath/perfect_day/Cronista consumen — antes y después
    // de sellar 4 semanas atrasadas, y verifica que el conteo diario no se mueva.
    await process({
      type: 'TASK_COMPLETED', moduleId: 'quests',
      payload: { xp: 10, hp: 0, taskId: 'baseline' }, timestamp: Date.now(),
    });
    const today = new Date().toLocaleDateString('en-CA');
    // Los campos de AchievementContext son getters perezosos (lazyField):
    // se recalculan recién al leerlos, no al crear el objeto. Si "before" se
    // leyera después del sellado, ambas lecturas verían la misma base ya
    // inflada y la comparación sería un empate falso. Por eso se fuerza la
    // lectura ACÁ, antes de sellar.
    const beforeCtx = buildAchievementContext(testDb, null, today);
    const before = {
      eventsToday: beforeCtx.eventsToday,
      modulesToday: beforeCtx.modulesToday,
      typesToday: beforeCtx.typesToday,
    };

    for (const w of ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24']) {
      await seal({ xp: 50, hp: 0, weekStart: w });
    }

    const after = buildAchievementContext(testDb, null, today);
    expect(after.eventsToday).toBe(before.eventsToday);
    expect(after.modulesToday).toEqual(before.modulesToday);
    expect(after.typesToday).toEqual(before.typesToday);
  });
});

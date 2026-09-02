/**
 * Review RPG — MEDIO #9: cerrar/reabrir el día de Nutrify inflaba `daily_combo`.
 *
 * El mecanismo cambió con la integración: `nutrition:reopenDay` ya NO revierte
 * nada por su cuenta (buscaba el evento comparando `closed_at` ISO contra
 * `created_at` local y, como ' ' < 'T', nunca lo encontraba). Ahora el cierre
 * emite DAY_SUMMARY con `payload.date` y la reapertura emite DAY_REOPENED con
 * la MISMA fecha: la vía de undo del motor revierte el XP exacto multiplicado,
 * borra la fila del log y devuelve el tick de combo. El bug desapareció por
 * construcción — ya no se compara ningún timestamp.
 *
 * Lo que este test sigue protegiendo es el invariante, no la implementación:
 * close → reopen → close, cuatro veces, deja el combo, el XP y el log de UN
 * solo cierre.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const harness = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  db: null as unknown as Database.Database,
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => harness.handlers.set(channel, fn) },
  app: { getPath: () => '.' },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
}));

vi.mock('../../../shared-logic/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../shared-logic/db')>()),
  getDb: () => harness.db,
}));

const { initCoreTables, applyMigrations, coreMigrations } = await import('../../../shared-logic/db');
const { processRpgEvent } = await import('../../../electron/ipc/rpg-handlers');
const { registerNutritionIpcHandlers } = await import('../../../electron/modules/nutrition.ipc');
registerNutritionIpcHandlers();

async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const fn = harness.handlers.get(channel);
  if (!fn) throw new Error(`no handler registered for ${channel}`);
  return (await fn({}, ...args)) as T;
}

const TODAY = '2026-08-31';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initCoreTables(db);
  applyMigrations(db, coreMigrations);
  for (const m of nutritionMigrations) db.exec(m.up);
  db.prepare(`
    INSERT INTO nutrition_profile (id, age, sex, height_cm, initial_weight_kg, activity_level, deficit_target_kcal, date_of_birth, day_cutoff_hour)
    VALUES (1, 30, 'M', 175, 80, 'moderate', 500, '1996-01-01', 0)
  `).run();
  return db;
}

function stats() {
  return harness.db.prepare('SELECT xp, hp, daily_combo AS combo, combo_date AS comboDate FROM player_stats WHERE user_id = ?')
    .get('default') as { xp: number; hp: number; combo: number; comboDate: string | null };
}

function summaryRows(): number {
  return (harness.db.prepare("SELECT COUNT(*) AS c FROM rpg_events WHERE event_type = 'DAY_SUMMARY'").get() as { c: number }).c;
}

/**
 * El primer DAY_SUMMARY dispara logros `first_*` (fila ACHIEVEMENT_UNLOCKED,
 * idempotente, pagada una sola vez). Ese XP es legítimo y reopen NO lo toca:
 * lo que se revierte es exactamente el evento del cierre.
 */
function achievementXp(): number {
  return (harness.db.prepare("SELECT COALESCE(SUM(xp_gained), 0) AS s FROM rpg_events WHERE event_type = 'ACHIEVEMENT_UNLOCKED'").get() as { s: number }).s;
}

type Breakdown = { xpTotal: number; hpChange: number };

/** Exactamente lo que hace Today.tsx: closeDay y después el evento RPG. */
async function closeAndEmit(): Promise<{ breakdown: Breakdown; xpGained: number }> {
  const res = await invoke<{ success: boolean; breakdown: Breakdown }>('nutrition:closeDay', TODAY);
  expect(res.success).toBe(true);
  const r = processRpgEvent(harness.db, {
    type: 'DAY_SUMMARY', moduleId: 'nutrition',
    // `date` es lo que hace posible el match del undo: sin esto el motor no
    // sabría qué cierre anula una reapertura.
    payload: { xp: res.breakdown.xpTotal, hp: res.breakdown.hpChange, date: TODAY },
    timestamp: Date.now(),
  });
  return { breakdown: res.breakdown, xpGained: r.xpGained };
}

/** Y esto es lo que hace al reabrir: soft-delete + el undo por la vía del motor. */
async function reopenAndEmit(date = TODAY): Promise<{ xpReverted: number }> {
  const res = await invoke<{ success: boolean }>('nutrition:reopenDay', date);
  expect(res.success).toBe(true);
  const r = processRpgEvent(harness.db, {
    type: 'DAY_REOPENED', moduleId: 'nutrition',
    payload: { xp: 0, hp: 0, date },
    timestamp: Date.now(),
  });
  return { xpReverted: -r.xpGained };
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 7, 31, 12, 0, 0));
  harness.db = setupDb();
  await invoke('nutrition:logFood', { date: TODAY, description: 'almuerzo', calories: 1500, source: 'manual' });
});

afterEach(() => { vi.useRealTimers(); });

describe('reabrir un día revierte el cierre por completo', () => {
  it('revierte el XP MULTIPLICADO que pagó el motor, no el base, y limpia el log', async () => {
    const { breakdown, xpGained } = await closeAndEmit();
    expect(breakdown.xpTotal).toBeGreaterThan(0);
    expect(summaryRows()).toBe(1);

    const { xpReverted } = await reopenAndEmit();
    expect(xpReverted).toBeCloseTo(xpGained, 2);
    expect(summaryRows()).toBe(0);
    expect(stats().xp).toBeCloseTo(achievementXp(), 2);
  });

  it('devuelve el tick de daily_combo cuando el cierre era de hoy', async () => {
    await closeAndEmit();
    expect(stats().combo).toBe(1);
    await reopenAndEmit();
    expect(stats().combo).toBe(0);
  });

  it('close → reopen → close, 4 veces: el combo, el XP y el log son los de UN cierre', async () => {
    let last = await closeAndEmit();
    for (let i = 0; i < 4; i++) {
      await reopenAndEmit();
      last = await closeAndEmit();
    }
    const s = stats();
    expect(s.combo).toBe(1);
    expect(summaryRows()).toBe(1);
    expect(s.xp).toBeCloseTo(last.xpGained + achievementXp(), 2);
    expect(s.hp).toBe(100 + last.breakdown.hpChange > 100 ? 100 : 100 + last.breakdown.hpChange);
  });

  it('no toca el combo de HOY cuando el cierre revertido es de otro día', async () => {
    await closeAndEmit();
    // Hoy el jugador también hizo otra cosa: combo 2.
    processRpgEvent(harness.db, { type: 'TASK_COMPLETED', moduleId: 'quests', payload: { xp: 10, hp: 0, taskId: 't1' }, timestamp: Date.now() });
    expect(stats().combo).toBe(2);
    // El evento del cierre "envejece" un día (como si se reabriera mañana).
    harness.db.prepare("UPDATE rpg_events SET created_at = '2026-08-30 12:00:00' WHERE event_type = 'DAY_SUMMARY'").run();
    await reopenAndEmit();
    expect(stats().combo).toBe(2);
  });
});

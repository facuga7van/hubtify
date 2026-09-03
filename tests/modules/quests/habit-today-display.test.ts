/**
 * «Marqué el gimnasio hoy y el Hub sigue diciendo que no».
 *
 * Reproduce con los datos REALES del usuario: hábito "Gimnasio", `weekly` con
 * `times_per_week = 3`, con checks el martes 2026-09-01 y el miércoles
 * 2026-09-02 (hoy). La lista de Hábitos lo pinta tildado — lee `checkedToday` —
 * pero el widget del Hub y la pestaña «Hoy» leían el progreso del PERÍODO (2/3)
 * y lo mostraban sin tildar y como pendiente.
 *
 * `habit_checks` tiene UNIQUE(habit_id, date): un hábito no puede recibir un
 * segundo check el mismo día, así que "ya lo marqué hoy" implica siempre "hoy
 * no me debe nada", sea cual sea la meta semanal.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { questsMigrations } from '@modules/quests/quests.schema';
import type { HabitWithStreak } from '../../../src/modules/quests/types';

const harness = vi.hoisted(() => ({ db: null as unknown as Database.Database }));

import { getHandler, clearHandlers } from '../../../shared-logic/registry';

vi.mock('../../../shared-logic/db', () => ({ getDb: () => harness.db }));
vi.mock('../../../src/shared/audio', () => ({ playTaskComplete: vi.fn() }));

const { registerQuestsIpcHandlers } = await import('../../../shared-logic/modules/quests.ipc');
const { isHabitSettledToday, isHabitRelevantToday } = await import('../../../src/modules/quests/utils');

/** Miércoles. El lunes de esa semana es 2026-08-31. */
const TODAY = '2026-09-02';
const YESTERDAY = '2026-09-01';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of questsMigrations) db.exec(m.up);
  return db;
}

function addHabit(db: Database.Database, id: string, frequency: string, timesPerWeek: number): void {
  db.prepare(`
    INSERT INTO habits (id, name, frequency, times_per_week, created_at, updated_at)
    VALUES (?, ?, ?, ?, '2026-04-29T21:50:47.097Z', '2026-04-29T21:50:47.097Z')
  `).run(id, `Habit ${id}`, frequency, timesPerWeek);
}

let seq = 0;
function mark(db: Database.Database, habitId: string, date: string): void {
  db.prepare(
    'INSERT INTO habit_checks (id, habit_id, date, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(`hc${++seq}`, habitId, date, 'check', `${date}T20:35:15.521Z`, `${date}T20:35:15.521Z`);
}

/* ── El handler que consultan el Hub y la pestaña «Hoy» ───────────────────── */

describe('quests:getHabits — pendingToday el día que ya marcaste', () => {
  let habits: Record<string, HabitWithStreak>;

  beforeEach(async () => {
    // Fecha LOCAL congelada: `computeHabits` formatea el día con el reloj de
    // pared, no en UTC, igual que la columna `habit_checks.date`.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 2, 17, 35, 0));

    harness.db = setupDb();
    addHabit(harness.db, 'daily-done', 'daily', 1);
    addHabit(harness.db, 'daily-todo', 'daily', 1);
    addHabit(harness.db, 'gym-today', 'weekly', 3);
    addHabit(harness.db, 'gym-yesterday', 'weekly', 3);
    addHabit(harness.db, 'gym-never', 'weekly', 3);

    mark(harness.db, 'daily-done', TODAY);
    mark(harness.db, 'gym-today', YESTERDAY);
    mark(harness.db, 'gym-today', TODAY);
    mark(harness.db, 'gym-yesterday', YESTERDAY);

    clearHandlers();
    registerQuestsIpcHandlers();
    const rows = await getHandler('quests:getHabits')!({}) as HabitWithStreak[];
    habits = Object.fromEntries(rows.map((h) => [h.id, h]));
  });

  afterEach(() => { vi.useRealTimers(); });

  it('un 3x/semana marcado HOY no vuelve a estar pendiente hoy', () => {
    const gym = habits['gym-today'];
    expect(gym.checkedToday).toBe(true);
    expect(gym.checksThisPeriod).toBe(2);
    expect(gym.targetThisPeriod).toBe(3);
    expect(gym.pendingToday).toBe(false);
  });

  it('un 3x/semana marcado AYER sí está pendiente hoy', () => {
    const gym = habits['gym-yesterday'];
    expect(gym.checkedToday).toBe(false);
    expect(gym.checksThisPeriod).toBe(1);
    expect(gym.pendingToday).toBe(true);
  });

  it('un 3x/semana sin marcar está pendiente hoy', () => {
    expect(habits['gym-never'].checkedToday).toBe(false);
    expect(habits['gym-never'].pendingToday).toBe(true);
  });

  it('el diario marcado hoy no está pendiente y el que falta sí', () => {
    expect(habits['daily-done'].pendingToday).toBe(false);
    expect(habits['daily-todo'].pendingToday).toBe(true);
  });
});

/* ── Los selectores que pintan el tilde ───────────────────────────────────── */

function row(fields: Partial<HabitWithStreak>): HabitWithStreak {
  return {
    id: 'h', name: 'H', frequency: 'weekly', timesPerWeek: 3, createdAt: '2026-01-01T00:00:00.000Z',
    specificDays: null, streak: 0, weekStreak: 0, checkedToday: false, checkedYesterday: false,
    skippedToday: false, checksThisPeriod: 0, targetThisPeriod: 3, pendingToday: true,
    shieldCount: 0, shieldUsed: false, lastShieldStreak: 0,
    ...fields,
  } as HabitWithStreak;
}

describe('isHabitSettledToday', () => {
  it('un 3x/semana marcado hoy queda saldado aunque la semana vaya 2/3', () => {
    expect(isHabitSettledToday(row({ checkedToday: true, checksThisPeriod: 2, pendingToday: false }))).toBe(true);
  });

  it('un 3x/semana sin marcar hoy y con la semana abierta NO está saldado', () => {
    expect(isHabitSettledToday(row({ checksThisPeriod: 2 }))).toBe(false);
  });

  it('un 3x/semana que ya cumplió la meta sigue saldado los días siguientes', () => {
    expect(isHabitSettledToday(row({ checksThisPeriod: 3, pendingToday: false }))).toBe(true);
  });

  it('un salteado de hoy cuenta como saldado', () => {
    expect(isHabitSettledToday(row({ skippedToday: true }))).toBe(true);
  });

  it('un diario depende solo del check de hoy', () => {
    expect(isHabitSettledToday(row({ frequency: 'daily', targetThisPeriod: 1, checkedToday: true }))).toBe(true);
    expect(isHabitSettledToday(row({ frequency: 'daily', targetThisPeriod: 1 }))).toBe(false);
  });
});

describe('isHabitRelevantToday', () => {
  it('el 3x/semana marcado hoy sigue en la lista del Hub (tildado, no oculto)', () => {
    expect(isHabitRelevantToday(row({ checkedToday: true, checksThisPeriod: 2, pendingToday: false }))).toBe(true);
  });

  it('un Lun/Mie/Vie un martes no es asunto de hoy', () => {
    expect(isHabitRelevantToday(row({
      specificDays: [1, 3, 5], checksThisPeriod: 1, targetThisPeriod: 3, pendingToday: false,
    }))).toBe(false);
  });
});

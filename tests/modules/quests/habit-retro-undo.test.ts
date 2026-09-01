/**
 * Review RPG — ALTO #5: check retroactivo de hábito (pagar al marcar, gratis al
 * desmarcar) + BAJO `HABIT_UNCHECKED` sin fecha.
 *
 * `checkHabitForDate(ayer)` es un toggle: marcar pagaba HABIT_CHECKED (5 XP ×
 * combo × bonus), desmarcar no emitía nada, y volver a marcar promovía la fila
 * soft-deleted y pagaba de nuevo. Bajo test:
 *
 *   backend  → `toggleHabitCheck` devuelve el id de la fila y la fecha, y ese
 *              id es ESTABLE a través de off/on (misma fila, promovida).
 *   renderer → `processHabitCheck` emite HABIT_UNCHECKED también en el uncheck
 *              retroactivo, y TODOS los eventos de hábito llevan `date` para
 *              que el motor pueda revertir el check correcto.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { questsMigrations } from '@modules/quests/quests.schema';
import { toggleHabitCheck } from '../../../electron/modules/quests.ipc';

vi.mock('../../../src/shared/audio', () => ({ playTaskComplete: vi.fn() }));

const { processHabitCheck } = await import('../../../src/modules/quests/utils');

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of questsMigrations) db.exec(m.up);
  db.prepare("INSERT INTO habits (id, name, updated_at) VALUES ('h1', 'Leer', '')").run();
  return db;
}

const Y = '2026-07-07';

/* ── Backend: toggleHabitCheck ───────────────────────────────────────────── */

describe('toggleHabitCheck devuelve la identidad del check', () => {
  it('marca → desmarca → marca: mismo checkId (la fila se promueve, no se duplica)', () => {
    const db = setupDb();
    const on = toggleHabitCheck(db, 'h1', Y);
    expect(on.checked).toBe(true);
    expect(on.date).toBe(Y);
    expect(typeof on.checkId).toBe('string');

    const off = toggleHabitCheck(db, 'h1', Y);
    expect(off).toEqual({ checked: false, checkId: on.checkId, date: Y });

    const again = toggleHabitCheck(db, 'h1', Y);
    expect(again).toEqual({ checked: true, checkId: on.checkId, date: Y });

    const rows = db.prepare('SELECT COUNT(*) AS c FROM habit_checks WHERE habit_id = ?').get('h1') as { c: number };
    expect(rows.c).toBe(1);
  });

  it('promover un skip a check devuelve el id de la fila promovida', () => {
    const db = setupDb();
    db.prepare("INSERT INTO habit_checks (id, habit_id, date, kind, created_at, updated_at) VALUES ('s1', 'h1', ?, 'skip', '', '')").run(Y);
    expect(toggleHabitCheck(db, 'h1', Y)).toEqual({ checked: true, checkId: 's1', date: Y });
  });
});

/* ── Renderer: processHabitCheck ─────────────────────────────────────────── */

type ApiStub = {
  questsCheckHabit: ReturnType<typeof vi.fn>;
  questsCheckHabitForDate: ReturnType<typeof vi.fn>;
  processRpgEvent: ReturnType<typeof vi.fn>;
};

function installWindow(api: ApiStub) {
  (globalThis as unknown as { window: unknown }).window = {
    api,
    dispatchEvent: vi.fn(),
  };
}

function rpgResult() {
  return { xpGained: 7, hpChange: 0, leveledUp: false, newTitle: null, milestoneXp: 0, comboMultiplier: 1, bonusMultiplier: 1 };
}

const habit = {
  id: 'h1', name: 'Leer', frequency: 'daily', timesPerWeek: 1, createdAt: '', specificDays: null,
  streak: 0, weekStreak: 0, checkedToday: false, checkedYesterday: false, skippedToday: false,
  checksThisPeriod: 0, targetThisPeriod: 1, pendingToday: true,
  shieldCount: 0, shieldUsed: false,
};

const callbacks = () => ({ toast: vi.fn(), t: ((_k: string, d?: string) => d ?? _k) as never });

const today = () => new Date().toLocaleDateString('en-CA');

describe('processHabitCheck — uncheck retroactivo devuelve el XP', () => {
  let api: ApiStub;
  beforeEach(() => {
    api = {
      questsCheckHabit: vi.fn(),
      questsCheckHabitForDate: vi.fn(),
      processRpgEvent: vi.fn().mockResolvedValue(rpgResult()),
    };
    installWindow(api);
  });

  it('marcar ayer paga HABIT_CHECKED con habitId y date', async () => {
    api.questsCheckHabitForDate.mockResolvedValue({ checked: true, checkId: 'c1', date: Y });
    await processHabitCheck('h1', [habit], callbacks(), Y);
    expect(api.processRpgEvent).toHaveBeenCalledTimes(1);
    expect(api.processRpgEvent.mock.calls[0][0]).toMatchObject({
      type: 'HABIT_CHECKED', moduleId: 'quests', payload: { habitId: 'h1', date: Y },
    });
  });

  it('desmarcar ayer emite HABIT_UNCHECKED con el MISMO habitId y date (antes: nada)', async () => {
    api.questsCheckHabitForDate.mockResolvedValue({ checked: false, checkId: 'c1', date: Y });
    await processHabitCheck('h1', [habit], callbacks(), Y);
    expect(api.processRpgEvent).toHaveBeenCalledTimes(1);
    expect(api.processRpgEvent.mock.calls[0][0]).toMatchObject({
      type: 'HABIT_UNCHECKED', moduleId: 'quests', payload: { habitId: 'h1', date: Y },
    });
  });

  it('click, click, click… sobre "ayer" termina en cero neto: N checks ⇒ N unchecks', async () => {
    let checked = false;
    api.questsCheckHabitForDate.mockImplementation(async () => {
      checked = !checked;
      return { checked, checkId: 'c1', date: Y };
    });
    for (let i = 0; i < 6; i++) await processHabitCheck('h1', [habit], callbacks(), Y);
    const types = api.processRpgEvent.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(types.filter((t) => t === 'HABIT_CHECKED')).toHaveLength(3);
    expect(types.filter((t) => t === 'HABIT_UNCHECKED')).toHaveLength(3);
  });

  it('el check de HOY también lleva date, en el pago y en el undo', async () => {
    api.questsCheckHabit.mockResolvedValue({ checked: true, checkId: 'c2', date: today() });
    await processHabitCheck('h1', [habit], callbacks());
    expect(api.processRpgEvent.mock.calls[0][0]).toMatchObject({
      type: 'HABIT_CHECKED', payload: { habitId: 'h1', date: today() },
    });

    api.processRpgEvent.mockClear();
    api.questsCheckHabit.mockResolvedValue({ checked: false, checkId: 'c2', date: today() });
    await processHabitCheck('h1', [{ ...habit, checkedToday: true, checksThisPeriod: 1 }], callbacks());
    expect(api.processRpgEvent.mock.calls[0][0]).toMatchObject({
      type: 'HABIT_UNCHECKED', payload: { habitId: 'h1', date: today() },
    });
  });
});

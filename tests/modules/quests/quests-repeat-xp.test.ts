/**
 * Review RPG — ALTO #4: misiones recurrentes.
 *
 * Completar una tarea con `repeat_rule` genera la siguiente instancia con un
 * taskId NUEVO, así que el guard de undo por `ref_id` no la cubre: completar N
 * instancias en un minuto pagaba N veces XP + combo + total_tasks.
 *
 * Regla bajo test: como máximo UN pago de XP por cadena (`repeat_of`) por día
 * LOCAL. La segunda instancia completada el mismo día queda completada igual
 * (la cadena avanza), pero `setTaskStatus` responde `paysXp: false` y el
 * renderer no emite `TASK_COMPLETED`.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { questsMigrations } from '@modules/quests/quests.schema';
import { setTaskStatus } from '../../../shared-logic/modules/quests.ipc';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const m of questsMigrations) db.exec(m.up);
  return db;
}

function addTask(db: Database.Database, id: string, fields: {
  dueDate?: string | null; repeatRule?: string | null; repeatOf?: string | null;
  repeatAnchor?: string | null; status?: number; completedAt?: string | null;
} = {}): void {
  db.prepare(`
    INSERT INTO tasks (id, name, description, status, tier, category, due_date, task_order,
                       repeat_rule, repeat_of, repeat_anchor, completed_at, created_at, updated_at)
    VALUES (?, ?, '', ?, 2, '', ?, 0, ?, ?, ?, ?, '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z')
  `).run(id, `Task ${id}`, fields.status ?? 0, fields.dueDate ?? null,
    fields.repeatRule ?? null, fields.repeatOf ?? null, fields.repeatAnchor ?? null,
    fields.completedAt ?? null);
}

function statusOf(db: Database.Database, id: string): number {
  return (db.prepare('SELECT status FROM tasks WHERE id = ?').get(id) as { status: number }).status;
}

const DAILY = '{"freq":"daily"}';
const NOW = '2026-07-08T13:00:00.000Z';
const D1 = (hhmmss: string) => `2026-07-08 ${hhmmss}`;
const D2 = (hhmmss: string) => `2026-07-09 ${hhmmss}`;

describe('setTaskStatus — un solo pago de XP por cadena recurrente por día (#4)', () => {
  it('una tarea sin regla paga siempre', () => {
    const db = setupDb();
    addTask(db, 'plain', { dueDate: '2026-07-08' });
    const res = setTaskStatus(db, 'plain', true, { now: NOW, completedAt: D1('10:00:00') });
    expect(res).toEqual({ paysXp: true });
    expect(statusOf(db, 'plain')).toBe(1);
  });

  it('la instancia recién generada NO paga si se completa el mismo día', () => {
    const db = setupDb();
    addTask(db, 'root', { dueDate: '2026-07-08', repeatRule: DAILY });

    const first = setTaskStatus(db, 'root', true, { now: NOW, completedAt: D1('10:00:00') });
    expect(first?.paysXp).toBe(true);
    expect(first?.repeated).toBeDefined();

    // "La próxima ya está en el tablero" → click → click → click…
    const second = setTaskStatus(db, first!.repeated!.nextTaskId, true, { now: NOW, completedAt: D1('10:00:30') });
    expect(second?.paysXp).toBe(false);
    // La cadena avanza igual: la tarea queda completada y la siguiente se genera.
    expect(statusOf(db, first!.repeated!.nextTaskId)).toBe(1);
    expect(second?.repeated).toBeDefined();

    const third = setTaskStatus(db, second!.repeated!.nextTaskId, true, { now: NOW, completedAt: D1('10:01:00') });
    expect(third?.paysXp).toBe(false);

    const paid = [first, second, third].filter((r) => r?.paysXp).length;
    expect(paid).toBe(1);
  });

  it('un día local nuevo vuelve a pagar', () => {
    const db = setupDb();
    addTask(db, 'root', { dueDate: '2026-07-08', repeatRule: DAILY });
    const first = setTaskStatus(db, 'root', true, { now: NOW, completedAt: D1('23:59:00') });
    const next = setTaskStatus(db, first!.repeated!.nextTaskId, true, { now: NOW, completedAt: D2('00:01:00') });
    expect(next?.paysXp).toBe(true);
  });

  it('des-completar la instancia pagada libera el pago del día (neto: uno)', () => {
    const db = setupDb();
    addTask(db, 'root', { dueDate: '2026-07-08', repeatRule: DAILY });
    const first = setTaskStatus(db, 'root', true, { now: NOW, completedAt: D1('10:00:00') });
    expect(first?.paysXp).toBe(true);

    // Undo: el renderer emite TASK_UNCOMPLETED (refund por ref_id). Backend:
    expect(setTaskStatus(db, 'root', false, { now: NOW })).toBeUndefined();
    expect(statusOf(db, 'root')).toBe(0);

    // Ahora la única completada hoy de la cadena sería la siguiente → paga.
    const next = setTaskStatus(db, first!.repeated!.nextTaskId, true, { now: NOW, completedAt: D1('10:05:00') });
    expect(next?.paysXp).toBe(true);
  });

  it('una instancia completada hoy en OTRO dispositivo (sync) también bloquea el pago', () => {
    const db = setupDb();
    addTask(db, 'root', { dueDate: '2026-07-07', repeatRule: DAILY, status: 1, completedAt: D1('08:00:00') });
    addTask(db, 'inst', { dueDate: '2026-07-08', repeatRule: DAILY, repeatOf: 'root' });
    const res = setTaskStatus(db, 'inst', true, { now: NOW, completedAt: D1('09:00:00') });
    expect(res?.paysXp).toBe(false);
  });

  it('la raíz completada AYER no bloquea la instancia de hoy', () => {
    const db = setupDb();
    addTask(db, 'root', { dueDate: '2026-07-07', repeatRule: DAILY, status: 1, completedAt: '2026-07-07 21:00:00' });
    addTask(db, 'inst', { dueDate: '2026-07-08', repeatRule: DAILY, repeatOf: 'root' });
    const res = setTaskStatus(db, 'inst', true, { now: NOW, completedAt: D1('09:00:00') });
    expect(res?.paysXp).toBe(true);
  });

  /* ── quests v14: ni el intervalo ni el ancla abren una segunda puerta ────
   *
   * Las dos novedades sólo mueven FECHAS. El pago sigue siendo «uno por cadena
   * por día LOCAL», que no mira el vencimiento en ningún momento — así que un
   * intervalo corto o un ancla que empuja la próxima al mismo día no pueden
   * cobrar dos veces. Esto lo fija por si alguien "optimiza" chainPaidToday
   * usando due_date en vez de completed_at.
   */
  const EVERY_2_DAYS = '{"freq":"daily","interval":2}';

  it('con intervalo, encadenar completados el mismo día sigue pagando UNA vez', () => {
    const db = setupDb();
    addTask(db, 'root', { dueDate: '2026-07-08', repeatRule: EVERY_2_DAYS });
    const first = setTaskStatus(db, 'root', true, { now: NOW, completedAt: D1('10:00:00') });
    expect(first?.paysXp).toBe(true);
    // La generada vence el 10, pero se la marca hoy igual: la cadena avanza,
    // el pago no.
    const second = setTaskStatus(db, first!.repeated!.nextTaskId, true, { now: NOW, completedAt: D1('10:00:30') });
    expect(second?.paysXp).toBe(false);
    const third = setTaskStatus(db, second!.repeated!.nextTaskId, true, { now: NOW, completedAt: D1('10:01:00') });
    expect(third?.paysXp).toBe(false);
    expect([first, second, third].filter((r) => r?.paysXp).length).toBe(1);
  });

  it("con ancla 'completion' —que apunta la próxima al futuro— tampoco paga dos veces", () => {
    const db = setupDb();
    addTask(db, 'root', { dueDate: '2026-07-08', repeatRule: DAILY, repeatAnchor: 'completion' });
    const first = setTaskStatus(db, 'root', true, { now: NOW, completedAt: D1('10:00:00') });
    expect(first?.paysXp).toBe(true);
    const second = setTaskStatus(db, first!.repeated!.nextTaskId, true, { now: NOW, completedAt: D1('11:00:00') });
    expect(second?.paysXp).toBe(false);
    // Y el ancla se hereda, así que la cadena entera cuenta desde el tilde.
    expect(
      (db.prepare('SELECT repeat_anchor AS a FROM tasks WHERE id = ?').get(second!.repeated!.nextTaskId) as { a: string | null }).a,
    ).toBe('completion');
  });
});

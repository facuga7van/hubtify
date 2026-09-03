import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initCoreTables, applyMigrations, coreMigrations } from '../../shared-logic/db';
import { questsMigrations } from '@modules/quests/quests.schema';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';
import { financeMigrations } from '@modules/finance/finance.schema';
import { cauldronMigrations } from '@modules/cauldron/cauldron.schema';
import { notificationsMigrations } from '../../shared-logic/modules/notifications.schema';
import { mergeQuestDataInto, clearUserDataInto } from '../../shared-logic/modules/sync.ipc';

/**
 * EL CORAZÓN DEL MODO INVITADO: los datos que se cargan sin cuenta sobreviven a
 * vincular una cuenta después, porque el pull FUSIONA sobre la base existente
 * en vez de reemplazarla (`src/shared/sync.ts:283-423`, todo pasa por
 * `syncMerge*Data`), y porque el invitado nunca escribió `last_uid`, que es lo
 * único que dispara el borrado en `Layout.retrySyncPull` (`Layout.tsx:529-533`).
 *
 * La base local es UNA sola y no está indexada por uid: `sync:setCurrentUser`
 * guarda `last_uid` en `app_state` como centinela de "¿cambió la cuenta?"
 * (`sync.ipc.ts:1007-1017`). Por eso "vincular después" sale gratis.
 */

const T0 = '2026-06-01T10:00:00.000Z';

function bootAll(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initCoreTables(db);
  applyMigrations(db, coreMigrations);
  applyMigrations(db, questsMigrations);
  applyMigrations(db, nutritionMigrations);
  applyMigrations(db, financeMigrations);
  applyMigrations(db, notificationsMigrations);
  applyMigrations(db, cauldronMigrations);
  return db;
}

const task = (id: string, name: string) => ({
  id, name, description: '', status: 0, tier: 2, category: '',
  projectId: null, dueDate: null, order: 0, completedAt: null,
  createdAt: T0, updatedAt: T0, deletedAt: null,
});

/** Lo que el invitado cargó sin cuenta. */
function seedGuestWork(db: Database.Database) {
  db.prepare(
    `INSERT INTO tasks (id, name, description, status, tier, category, task_order, created_at, updated_at)
     VALUES ('guest-1', 'Mi primera misión sin cuenta', '', 0, 2, '', 0, ?, ?)`,
  ).run(T0, T0);
  db.prepare(
    `INSERT INTO habits (id, name, frequency, times_per_week, created_at, updated_at)
     VALUES ('guest-h', 'Ritual del invitado', 'daily', 7, ?, ?)`,
  ).run(T0, T0);
}

const names = (db: Database.Database) =>
  (db.prepare('SELECT id FROM tasks ORDER BY id').all() as { id: string }[]).map(r => r.id);

const lastUid = (db: Database.Database) =>
  (db.prepare(`SELECT value FROM app_state WHERE key = 'last_uid'`).get() as { value: string } | undefined)?.value ?? null;

/** Lo que hace `sync:setCurrentUser` (sync.ipc.ts:1007-1010). */
function setCurrentUser(db: Database.Database, uid: string) {
  db.prepare(`INSERT OR REPLACE INTO app_state (key, value) VALUES ('last_uid', ?)`).run(uid);
}

let guest: typeof import('../../src/shared/guest');
const originalWindow = (globalThis as { window?: unknown }).window;
const originalStorage = (globalThis as { localStorage?: unknown }).localStorage;

beforeEach(async () => {
  const map = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
  };
  (globalThis as { window?: unknown }).window = new EventTarget();
  vi.resetModules();
  guest = await import('../../src/shared/guest');
});

afterEach(() => {
  (globalThis as { window?: unknown }).window = originalWindow;
  (globalThis as { localStorage?: unknown }).localStorage = originalStorage;
});

describe('los datos del invitado sobreviven al vincular una cuenta', () => {
  it('el modo invitado no escribe last_uid', () => {
    const db = bootAll();
    guest.enterGuestMode();
    seedGuestWork(db);
    // Ningún handler de shared-logic recibe uid: el invitado trabaja contra la
    // misma base de siempre y el centinela queda vacío.
    expect(lastUid(db)).toBeNull();
    expect(guest.clearsLocalDataOnLink(lastUid(db), 'uid-nuevo')).toBe(false);
  });

  it('el pull de la cuenta nueva FUSIONA: la misión del invitado sigue ahí', () => {
    const db = bootAll();
    guest.enterGuestMode();
    seedGuestWork(db);

    // ── vincular ──────────────────────────────────────────────
    // useAuth.login: syncSetCurrentUser(uid) y después syncPull(uid).
    expect(guest.clearsLocalDataOnLink(lastUid(db), 'uid-nuevo')).toBe(false);
    setCurrentUser(db, 'uid-nuevo');
    guest.leaveGuestMode();

    mergeQuestDataInto(db, {
      projects: [], subtasks: [], categories: [], habitChecks: [], drawings: [],
      habits: [],
      tasks: [task('cloud-1', 'Misión que venía de la nube')],
    } as never);

    // La del invitado NO se borró, y la de la nube se sumó.
    expect(names(db)).toEqual(['cloud-1', 'guest-1']);
    expect(
      (db.prepare(`SELECT name FROM tasks WHERE id = 'guest-1'`).get() as { name: string }).name,
    ).toBe('Mi primera misión sin cuenta');
    // El ritual tampoco: el merge de hábitos es un UPSERT, no un reemplazo.
    expect((db.prepare('SELECT COUNT(*) c FROM habits').get() as { c: number }).c).toBe(1);
    // Y el flag quedó apagado: ya no es invitado.
    expect(guest.isGuestMode()).toBe(false);
  });

  it('salir del modo invitado no toca ninguna fila', () => {
    const db = bootAll();
    guest.enterGuestMode();
    seedGuestWork(db);
    const before = names(db);
    guest.leaveGuestMode();
    expect(names(db)).toEqual(before);
  });
});

describe('CASO BORDE documentado (no arreglado): cuenta previa distinta', () => {
  /**
   * Escenario real: el dispositivo YA tuvo la cuenta X (last_uid grabado),
   * después alguien usa el modo invitado, y después inicia sesión con OTRA
   * cuenta Y. `Layout.retrySyncPull` (`Layout.tsx:531-533`) dispara
   * `syncClearUserData()` y se lleva puestos los datos del invitado.
   *
   * `Layout.tsx` no es de esta tanda; el test afirma el comportamiento ACTUAL
   * para que quede escrito y para que cambiarlo rompa algo a propósito.
   * El arreglo sería: si el modo invitado estuvo activo, hacer que el borrado
   * pida confirmación (o que empuje primero a la cuenta nueva) en vez de
   * ejecutarse en silencio.
   */
  it('la condición de borrado da true y la base del invitado se pierde', () => {
    const db = bootAll();
    setCurrentUser(db, 'uid-viejo-X');  // el dispositivo ya tuvo la cuenta X
    guest.enterGuestMode();
    seedGuestWork(db);
    expect(names(db)).toEqual(['guest-1']);

    // Ahora entra la cuenta Y.
    expect(guest.clearsLocalDataOnLink(lastUid(db), 'uid-nuevo-Y')).toBe(true);
    clearUserDataInto(db);

    expect(names(db)).toEqual([]);  // ← comportamiento ACTUAL, no deseado
  });

  it('si la cuenta previa es la MISMA que se vincula, no se pierde nada', () => {
    const db = bootAll();
    setCurrentUser(db, 'uid-X');
    guest.enterGuestMode();
    seedGuestWork(db);
    expect(guest.clearsLocalDataOnLink(lastUid(db), 'uid-X')).toBe(false);
    expect(names(db)).toEqual(['guest-1']);
  });
});

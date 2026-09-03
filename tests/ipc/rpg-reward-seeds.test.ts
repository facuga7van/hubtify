import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { initCoreTables, applyMigrations, coreMigrations } from '../../shared-logic/db';
import { getRewards, deleteReward, saveReward } from '../../shared-logic/modules/rpg-handlers';

/**
 * The real database had 132 óbolos earned and 0 spent, with `rewards` empty:
 * the sink existed in code and not in life. Three seeded rewards give the coin
 * a meaning — but they must never step on what the user wrote themselves, and
 * they must not multiply across devices.
 */

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initCoreTables(db);
  return db;
}

/** Core migrations up to (but excluding) the seed, so we can stage the table. */
function migrateUpTo(db: Database.Database, version: number): void {
  applyMigrations(db, coreMigrations.filter((m) => m.version <= version));
}

const SEED_IDS = ['seed-reward-chapter', 'seed-reward-game', 'seed-reward-meal'];

describe('recompensas de arranque (core v8)', () => {
  it('siembra tres recompensas en una base nueva', () => {
    const db = freshDb();
    applyMigrations(db, coreMigrations);
    const rewards = getRewards(db);
    expect(rewards.map((r) => r.id).sort()).toEqual([...SEED_IDS].sort());
    expect(rewards.every((r) => r.cost > 0)).toBe(true);
    // Ordenadas por costo: el premio barato es el que se ve primero.
    expect(rewards[0].cost).toBeLessThan(rewards[rewards.length - 1].cost);
  });

  it('no siembra nada si el usuario ya escribió su propio mostrador', () => {
    const db = freshDb();
    migrateUpTo(db, 7);
    saveReward(db, { name: 'Un mate en el balcón', cost: 30 });

    applyMigrations(db, coreMigrations);

    const rewards = getRewards(db);
    expect(rewards).toHaveLength(1);
    expect(rewards[0].name).toBe('Un mate en el balcón');
  });

  it('es idempotente: re-aplicar las migraciones no duplica ni resucita', () => {
    const db = freshDb();
    applyMigrations(db, coreMigrations);
    const [first] = getRewards(db);
    deleteReward(db, first.id);
    expect(getRewards(db)).toHaveLength(2);

    // Segunda pasada, como haría un arranque posterior.
    applyMigrations(db, coreMigrations);
    expect(getRewards(db)).toHaveLength(2);
  });

  it('las semillas son borrables como cualquier otra recompensa', () => {
    const db = freshDb();
    applyMigrations(db, coreMigrations);
    for (const id of SEED_IDS) expect(deleteReward(db, id)).toEqual({ ok: true });
    expect(getRewards(db)).toHaveLength(0);
  });

  it('usa ids deterministas y un updated_at fijo, para que el merge converja', () => {
    const a = freshDb();
    const b = freshDb();
    applyMigrations(a, coreMigrations);
    applyMigrations(b, coreMigrations);

    const rowsOf = (db: Database.Database) => db
      .prepare('SELECT id, name, cost, updated_at FROM rewards ORDER BY id')
      .all();

    // Dos dispositivos que siembran por su cuenta producen filas idénticas:
    // la unión por id no puede multiplicarlas.
    expect(rowsOf(a)).toEqual(rowsOf(b));
    // Y cualquier edición posterior gana el LWW por ser más nueva.
    const stamps = (rowsOf(a) as Array<{ updated_at: string }>).map((r) => r.updated_at);
    expect(new Set(stamps).size).toBe(1);
    expect(stamps[0] < new Date().toISOString()).toBe(true);
  });
});

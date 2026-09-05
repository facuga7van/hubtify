/**
 * El Cierre del Códice mostraba «XP DEL DÍA +NaN»: el renderer leía
 * `summary.xpTotal` y el handler real devuelve `totalXp`. TypeScript no lo
 * veía porque `codexApi.ts` declaraba su propia copia del contrato en vez de
 * derivarla de `HubtifyApi`.
 *
 * Este test cruza las dos puntas por el canal IPC de verdad: registra los
 * handlers del módulo con una DB en memoria, invoca `rpg:getDaySummary` y
 * comprueba que el campo que el modal consume para la cartela de XP EXISTE en
 * la respuesta y es un número finito.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { initCoreTables, applyMigrations, coreMigrations } from '../../shared-logic/db';
import { getHandler } from '../../shared-logic/registry';
import type { DaySummary as CodexDaySummary } from '../../src/hub/codex/codexApi';
import type { DaySummary as ContractDaySummary } from '../../shared/types';
import { pinClockToNoon } from '../helpers/pin-clock';

const harness = vi.hoisted(() => ({ db: null as unknown as Database.Database }));

vi.mock('../../shared-logic/db', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../shared-logic/db')>();
  return { ...original, getDb: () => harness.db };
});

const { registerRpgHandlers } = await import('../../shared-logic/modules/rpg-handlers');
registerRpgHandlers();

pinClockToNoon();

const TODAY = new Date().toLocaleDateString('en-CA');

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initCoreTables(db);
  applyMigrations(db, coreMigrations);
  return db;
}

function seedEvent(db: Database.Database, xp: number, hhmm: string): void {
  db.prepare(`
    INSERT INTO rpg_events (module_id, event_type, xp_gained, hp_change, combo_multiplier, bonus_multiplier, payload, created_at, ref_id, sync_id)
    VALUES ('quests', 'TASK_COMPLETED', ?, 0, 1.0, 1.0, '{}', ?, NULL, ?)
  `).run(xp, `${TODAY} ${hhmm}:00`, `seed-${Math.random()}`);
}

/**
 * El nombre del campo que la línea de cierre del ledger del modal
 * (`.codex-ledger-total__xp`, con `rpg.codexXpToday` como `title`) lee de
 * `summary`, sacado del propio código fuente: si alguien lo renombra en el
 * modal, el test lo sigue; si el handler deja de devolverlo, el test lo denuncia.
 */
function fieldReadByCodexLedgerTotal(): string {
  const src = readFileSync(resolve(__dirname, '../../src/hub/codex/CodexSealModal.tsx'), 'utf8');
  const m = /rpg\.codexXpToday[\s\S]{0,200}?summary\.(\w+)/.exec(src);
  if (!m) throw new Error('no se encontró la cartela de XP en CodexSealModal.tsx');
  return m[1];
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const fn = getHandler(channel);
  if (!fn) throw new Error(`no handler registered for ${channel}`);
  return (await fn({}, ...args)) as T;
}

describe('rpg:getDaySummary — contrato con el Cierre del Códice', () => {
  beforeEach(() => { harness.db = setupDb(); });

  it('devuelve el XP del día en el campo que la cartela del modal lee', async () => {
    seedEvent(harness.db, 15, '08:30');
    seedEvent(harness.db, 12.5, '13:15');

    const summary = await invoke<Record<string, unknown>>('rpg:getDaySummary', TODAY);
    const field = fieldReadByCodexLedgerTotal();

    expect(summary).toHaveProperty(field);
    const value = summary[field];
    expect(typeof value).toBe('number');
    expect(Number.isFinite(value as number)).toBe(true);
    expect(Math.round(value as number)).toBe(28);
    // Lo que se pinta: nunca «+NaN».
    expect(`+${Math.round(value as number)}`).toBe('+28');
  });

  it('el día vacío también da un número (cero), no undefined', async () => {
    const summary = await invoke<ContractDaySummary>('rpg:getDaySummary', TODAY);
    expect(summary.totalXp).toBe(0);
    expect(summary.eventsCount).toBe(0);
  });

  it('el tipo del renderer es el tipo del contrato, no una copia', async () => {
    const summary = await invoke<ContractDaySummary>('rpg:getDaySummary', TODAY);
    // Si `codexApi.ts` volviera a declarar su propio DaySummary, esta
    // asignación deja de compilar en cuanto los dos difieran en un campo.
    const asCodexSees: CodexDaySummary = summary;
    expect(asCodexSees.totalXp).toBe(summary.totalXp);
  });
});

/**
 * De qué receta arranca el caldero cuando nadie eligió.
 *
 * Evidencia de la base real (copia read-only, solo agregados): 41 sesiones, de
 * las cuales **30 son de una receta propia** («test», id `a9247592…`) y 11 de
 * `preset-classic`. Sobre las últimas 20: 16 de la propia, 4 de la clásica.
 * `cauldron:getPresets` ordena `is_default DESC, name ASC`, así que `p[0]` es
 * SIEMPRE «Classic» y las recetas propias quedan al final: el default era el
 * valor menos frecuente de la base.
 *
 * `localStorage` ya recuerda la última usada, pero no cruza de la compu al
 * teléfono. Esto es ese mismo dato, sacado del historial que SÍ sincroniza.
 *
 * Se devuelve la ÚLTIMA usada y no la más usada a propósito: es la definición
 * literal de la banda 9 de C12 («el default es el último valor usado») y es lo
 * mismo que ya hace `quickStartPresetId` en el renderer — dos respuestas
 * distintas para la misma pregunta harían que la compu y el teléfono
 * discreparan sobre qué es «el default».
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { cauldronMigrations } from '@modules/cauldron/cauldron.schema';
import { getLastUsedPresetId } from '../../../shared-logic/modules/cauldron-defaults';

let db: Database.Database;
let seq = 0;

vi.mock('../../../shared-logic/db', () => ({ getDb: () => db }));

function setupDb(): Database.Database {
  const d = new Database(':memory:');
  d.pragma('foreign_keys = ON');
  for (const m of cauldronMigrations) d.exec(m.up);
  return d;
}

function addPreset(id: string, deleted = false): void {
  db.prepare(
    'INSERT INTO cauldron_presets (id, name, is_default, created_at, updated_at, deleted_at) VALUES (?, ?, 0, ?, ?, ?)',
  ).run(id, `Receta ${id}`, '2026-01-01', '2026-01-01', deleted ? '2026-01-02' : null);
}

function addSession(presetId: string | null, startedAt: string, deleted = false): void {
  seq += 1;
  db.prepare(`
    INSERT INTO cauldron_sessions (id, preset_id, type, duration_minutes, completed, started_at, created_at, updated_at, deleted_at)
    VALUES (?, ?, 'work', 25, 1, ?, ?, ?, ?)
  `).run(`s-${seq}`, presetId, startedAt, startedAt, startedAt, deleted ? '2026-02-01' : null);
}

const lastUsed = () => getLastUsedPresetId(db);

beforeEach(() => { db = setupDb(); seq = 0; });

describe('getLastUsedPresetId', () => {
  it('sin sesiones no opina', () => {
    expect(lastUsed()).toEqual({ presetId: null, sampleSize: 0 });
  });

  it('devuelve la receta de la sesión más reciente, no la primera de la lista', () => {
    addPreset('propia');
    addSession('preset-classic', '2026-05-01T10:00:00.000Z');
    addSession('propia', '2026-05-02T10:00:00.000Z');
    expect(lastUsed()).toMatchObject({ presetId: 'propia' });
  });

  it('salta las sesiones de una receta que ya no existe', () => {
    // La receta puede morir por sync mientras sus sesiones siguen en el estante.
    addPreset('viva');
    addPreset('borrada', true);
    addSession('viva', '2026-05-01T10:00:00.000Z');
    addSession('borrada', '2026-05-02T10:00:00.000Z');
    expect(lastUsed().presetId).toBe('viva');
  });

  it('ignora las sesiones borradas', () => {
    addPreset('a'); addPreset('b');
    addSession('a', '2026-05-01T10:00:00.000Z');
    addSession('b', '2026-05-02T10:00:00.000Z', true);
    expect(lastUsed().presetId).toBe('a');
  });

  it('ignora las sesiones sin receta', () => {
    addPreset('a');
    addSession('a', '2026-05-01T10:00:00.000Z');
    addSession(null, '2026-05-02T10:00:00.000Z');
    expect(lastUsed().presetId).toBe('a');
  });

  it('cuenta solo las sesiones utilizables como muestra', () => {
    addPreset('a');
    addSession('a', '2026-05-01T10:00:00.000Z');
    addSession('a', '2026-05-02T10:00:00.000Z');
    addSession(null, '2026-05-03T10:00:00.000Z');
    expect(lastUsed()).toEqual({ presetId: 'a', sampleSize: 2 });
  });

  it('no propone nada cuando todas las recetas usadas murieron', () => {
    addPreset('borrada', true);
    addSession('borrada', '2026-05-02T10:00:00.000Z');
    expect(lastUsed()).toEqual({ presetId: null, sampleSize: 0 });
  });
});

/* El canal, no sólo la función: que el nombre y el registro existan de verdad. */
describe('cauldron:getLastUsedPreset', () => {
  it('está registrado y contesta lo mismo', async () => {
    const { getHandler, clearHandlers } = await import('../../../shared-logic/registry');
    clearHandlers();
    const { registerCauldronIpcHandlers } = await import('../../../shared-logic/modules/cauldron.ipc');
    registerCauldronIpcHandlers();

    addPreset('propia');
    addSession('propia', '2026-05-02T10:00:00.000Z');

    const handler = getHandler('cauldron:getLastUsedPreset');
    expect(handler).toBeTypeOf('function');
    expect(await handler!({})).toEqual({ presetId: 'propia', sampleSize: 1 });
  });
});

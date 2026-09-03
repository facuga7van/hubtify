/**
 * El alta de una misión deja de nacer huérfana.
 *
 * Evidencia de la base real (copia read-only de `%APPDATA%\hubtify\hubtify.db`,
 * solo agregados): de las 37 misiones vivas, **28 tienen proyecto y 9 no**, y el
 * más usado se lleva 14. Sobre las 30 más recientes el reparto es todavía más
 * marcado: proyecto «Dardo» 14, «Whatsnap» 8, `null` **2**. O sea que el
 * `projectId: null` que hardcodea la paleta global (Ctrl+K) es, literalmente, el
 * valor menos frecuente de la base — la definición de la banda 3 de C12.
 *
 * Tier, en cambio, es un empate técnico: 14 contra 13 sobre esas mismas 30. Por
 * eso se devuelve con `sampleSize`, para que el consumidor sepa cuánta evidencia
 * hay detrás.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { questsMigrations } from '@modules/quests/quests.schema';
import { getQuestEntryDefaults } from '../../../shared-logic/modules/quests-defaults';

let db: Database.Database;
let seq = 0;

vi.mock('../../../shared-logic/db', () => ({ getDb: () => db }));

function setupDb(): Database.Database {
  const d = new Database(':memory:');
  d.pragma('foreign_keys = ON');
  for (const m of questsMigrations) d.exec(m.up);
  return d;
}

function addProject(id: string, deleted = false): void {
  db.prepare(
    "INSERT INTO projects (id, name, color, created_at, updated_at, deleted_at) VALUES (?, ?, '#000', '2026-01-01', '2026-01-01', ?)",
  ).run(id, `Proyecto ${id}`, deleted ? '2026-01-02' : null);
}

function addTask(fields: {
  projectId?: string | null;
  tier?: number;
  deleted?: boolean;
  createdAt?: string;
}): void {
  seq += 1;
  const created = fields.createdAt ?? `2026-01-${String(seq).padStart(2, '0')}T00:00:00.000Z`;
  db.prepare(`
    INSERT INTO tasks (id, name, description, tier, category, project_id, status,
                       task_order, created_at, updated_at, deleted_at)
    VALUES (?, ?, '', ?, '', ?, 0, 0, ?, ?, ?)
  `).run(
    `t-${seq}`,
    `Tarea ${seq}`,
    fields.tier ?? 2,
    fields.projectId ?? null,
    created,
    created,
    fields.deleted ? '2026-02-01' : null,
  );
}

const defaults = () => getQuestEntryDefaults(db);

beforeEach(() => { db = setupDb(); seq = 0; });

describe('getQuestEntryDefaults', () => {
  it('sin historial no inventa nada: sin proyecto y tier normal', () => {
    expect(defaults()).toEqual({ projectId: null, tier: 2, sampleSize: 0 });
  });

  it('propone el proyecto más usado de las misiones vivas', () => {
    addProject('p1'); addProject('p2');
    for (let i = 0; i < 5; i++) addTask({ projectId: 'p1' });
    addTask({ projectId: 'p2' });
    expect(defaults()).toMatchObject({ projectId: 'p1', sampleSize: 6 });
  });

  it('«sin proyecto» compite como una elección más y puede ganar', () => {
    // Quien nunca usa proyectos no debe recibir uno impuesto por la inferencia.
    addProject('p1');
    for (let i = 0; i < 5; i++) addTask({ projectId: null });
    addTask({ projectId: 'p1' });
    expect(defaults().projectId).toBeNull();
  });

  it('ignora las misiones borradas', () => {
    addProject('p1'); addProject('p2');
    for (let i = 0; i < 5; i++) addTask({ projectId: 'p1', deleted: true });
    addTask({ projectId: 'p2' });
    expect(defaults()).toMatchObject({ projectId: 'p2', sampleSize: 1 });
  });

  it('descarta un proyecto borrado en vez de proponer un fantasma', () => {
    // El proyecto puede morir por sync mientras sus misiones siguen vivas.
    // Sus misiones se ABSTIENEN: no votan «sin proyecto», que es otra cosa.
    addProject('p1', true); addProject('p2');
    for (let i = 0; i < 5; i++) addTask({ projectId: 'p1' });
    addTask({ projectId: 'p2' });
    expect(defaults().projectId).toBe('p2');
  });

  it('borrar un proyecto no empuja el default a «sin proyecto»', () => {
    addProject('muerto', true); addProject('vivo');
    for (let i = 0; i < 10; i++) addTask({ projectId: 'muerto' });
    addTask({ projectId: null });
    addTask({ projectId: 'vivo' });
    addTask({ projectId: 'vivo' });
    expect(defaults().projectId).toBe('vivo');
  });

  it('devuelve la moda del tier', () => {
    addProject('p1');
    for (let i = 0; i < 3; i++) addTask({ projectId: 'p1', tier: 1 });
    addTask({ projectId: 'p1', tier: 3 });
    expect(defaults().tier).toBe(1);
  });

  it('con empate de tier gana el de la misión más reciente', () => {
    addTask({ tier: 1, createdAt: '2026-01-01T00:00:00.000Z' });
    addTask({ tier: 3, createdAt: '2026-01-02T00:00:00.000Z' });
    expect(defaults().tier).toBe(3);
  });

  it('descarta un tier fuera de 1..3 en vez de proponerlo', () => {
    addTask({ tier: 9 });
    addTask({ tier: 9 });
    expect(defaults().tier).toBe(2);
  });

  it('mira solo una ventana reciente, no toda la historia', () => {
    addProject('viejo'); addProject('nuevo');
    // 40 misiones viejas de un proyecto que dejó de usarse, 30 recientes del actual.
    for (let i = 0; i < 40; i++) addTask({ projectId: 'viejo', createdAt: `2025-01-01T00:00:0${i % 10}.000Z` });
    for (let i = 0; i < 30; i++) addTask({ projectId: 'nuevo', createdAt: `2026-06-01T00:00:0${i % 10}.000Z` });
    const d = defaults();
    expect(d.projectId).toBe('nuevo');
    expect(d.sampleSize).toBeLessThanOrEqual(30);
  });
});

/* El canal, no sólo la función: que el nombre y el registro existan de verdad. */
describe('quests:getEntryDefaults', () => {
  it('está registrado y contesta la misma inferencia', async () => {
    const { getHandler, clearHandlers } = await import('../../../shared-logic/registry');
    clearHandlers();
    const { registerQuestsIpcHandlers } = await import('../../../shared-logic/modules/quests.ipc');
    registerQuestsIpcHandlers();

    addProject('p1');
    for (let i = 0; i < 3; i++) addTask({ projectId: 'p1', tier: 3 });

    const handler = getHandler('quests:getEntryDefaults');
    expect(handler).toBeTypeOf('function');
    expect(await handler!({})).toEqual({ projectId: 'p1', tier: 3, sampleSize: 3 });
  });
});

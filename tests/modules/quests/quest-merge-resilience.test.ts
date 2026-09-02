import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { questsMigrations } from '@modules/quests/quests.schema';
import { mergeQuestDataInto } from '../../../shared-logic/modules/sync.ipc';

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const m of questsMigrations) db.exec(m.up);
  return db;
}

const T = '2026-06-01T10:00:00.000Z';

const task = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: `Task ${id}`, description: '', status: 0, tier: 2, category: '',
  projectId: null, dueDate: null, order: 0, completedAt: null,
  createdAt: T, updatedAt: T, deletedAt: null, ...over,
});
const habit = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: `Habit ${id}`, frequency: 'daily', timesPerWeek: 1,
  createdAt: T, updatedAt: T, deletedAt: null, ...over,
});
const project = (id: string) => ({
  id, name: `Project ${id}`, color: '#8b7355', order: 0,
  createdAt: T, updatedAt: T, deletedAt: null,
});

const count = (db: Database.Database, table: string) =>
  (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;

describe('sync:mergeQuestData resilience (task 7)', () => {
  it('an orphan subtask does not destroy the rest of the pull', () => {
    const db = setupDb();

    expect(() => mergeQuestDataInto(db, {
      projects: [project('p1')],
      tasks: [task('t1'), task('t2')],
      // taskId 'ghost' does not exist locally: this used to raise
      // FOREIGN KEY constraint failed and roll back EVERYTHING below.
      subtasks: [
        { id: 's1', taskId: 'ghost', name: 'Orphan', description: '', tier: 2, status: 0, order: 0, completedAt: null, createdAt: T, updatedAt: T, deletedAt: null },
        { id: 's2', taskId: 't1', name: 'Valid', description: '', tier: 2, status: 0, order: 0, completedAt: null, createdAt: T, updatedAt: T, deletedAt: null },
      ],
      categories: [],
      habits: [habit('h1')],
      habitChecks: [],
      drawings: [],
    } as never)).not.toThrow();

    expect(count(db, 'projects')).toBe(1);
    expect(count(db, 'tasks')).toBe(2);
    expect(count(db, 'habits')).toBe(1);
    // The orphan is dropped, the valid sibling survives.
    expect(count(db, 'subtasks')).toBe(1);
    expect(db.prepare('SELECT id FROM subtasks').get()).toEqual({ id: 's2' });
  });

  it('an orphan habit check does not destroy the rest of the pull', () => {
    const db = setupDb();

    mergeQuestDataInto(db, {
      projects: [], tasks: [task('t1')], subtasks: [], categories: [],
      habits: [habit('h1')],
      habitChecks: [
        { id: 'c1', habitId: 'ghost', date: '2026-06-01', createdAt: T, updatedAt: T, deletedAt: null },
        { id: 'c2', habitId: 'h1', date: '2026-06-01', createdAt: T, updatedAt: T, deletedAt: null },
      ],
      drawings: [],
    } as never);

    expect(count(db, 'tasks')).toBe(1);
    expect(count(db, 'habit_checks')).toBe(1);
    expect(db.prepare('SELECT habit_id FROM habit_checks').get()).toEqual({ habit_id: 'h1' });
  });

  it('an orphan drawing is dropped without losing its task', () => {
    const db = setupDb();
    mergeQuestDataInto(db, {
      projects: [], tasks: [task('t1')], subtasks: [], categories: [], habits: [], habitChecks: [],
      drawings: [
        { id: 'd1', taskId: 'ghost', data: 'xxx', order: 0, createdAt: T, updatedAt: T, deletedAt: null },
        { id: 'd2', taskId: 't1', data: 'yyy', order: 0, createdAt: T, updatedAt: T, deletedAt: null },
      ],
    } as never);
    expect(count(db, 'task_drawings')).toBe(1);
  });

  it('a task with no name is skipped instead of aborting on NOT NULL', () => {
    const db = setupDb();
    expect(() => mergeQuestDataInto(db, {
      tasks: [task('t1', { name: null }), task('t2'), null as never],
    } as never)).not.toThrow();
    expect(count(db, 'tasks')).toBe(1);
    expect(db.prepare('SELECT id FROM tasks').get()).toEqual({ id: 't2' });
  });

  it('a null payload, or one missing every table, is a no-op', () => {
    const db = setupDb();
    expect(mergeQuestDataInto(db, null as never)).toEqual({ changed: false });
    expect(() => mergeQuestDataInto(db, {} as never)).not.toThrow();
    expect(() => mergeQuestDataInto(db, { tasks: null, habits: undefined } as never)).not.toThrow();
    expect(count(db, 'tasks')).toBe(0);
  });

  it('a task pointing at an unknown project keeps the task and drops the link', () => {
    const db = setupDb();
    mergeQuestDataInto(db, { tasks: [task('t1', { projectId: 'ghost' })] } as never);
    expect(db.prepare('SELECT project_id FROM tasks WHERE id = ?').get('t1')).toEqual({ project_id: null });
  });

  it('clamps a habit times_per_week of 0 arriving from sync (task 18)', () => {
    const db = setupDb();
    mergeQuestDataInto(db, { habits: [habit('h1', { frequency: 'weekly', timesPerWeek: 0 })] } as never);
    expect(db.prepare('SELECT times_per_week FROM habits WHERE id = ?').get('h1')).toEqual({ times_per_week: 1 });

    mergeQuestDataInto(db, { habits: [habit('h2', { frequency: 'weekly', timesPerWeek: 99 })] } as never);
    expect(db.prepare('SELECT times_per_week FROM habits WHERE id = ?').get('h2')).toEqual({ times_per_week: 7 });
  });
});

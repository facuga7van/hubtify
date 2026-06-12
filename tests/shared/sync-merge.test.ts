import { describe, it, expect } from 'vitest';
import { mergeQuestData } from '@shared/sync-merge';

interface Rec {
  id: string;
  name?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  [k: string]: unknown;
}

const rec = (id: string, updatedAt: string, extra: Partial<Rec> = {}): Rec => ({
  id,
  name: `rec-${id}`,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt,
  deletedAt: null,
  ...extra,
});

const T1 = '2026-06-01T10:00:00.000Z';
const T2 = '2026-06-02T10:00:00.000Z';
const T3 = '2026-06-03T10:00:00.000Z';

describe('mergeQuestData', () => {
  it('preserves a record that only exists in remote', () => {
    const local = { tasks: [rec('a', T1)] };
    const remote = { tasks: [rec('a', T1), rec('b', T2)] };

    const merged = mergeQuestData(local, remote);

    const ids = (merged.tasks as Rec[]).map(r => r.id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('keeps local record when local updatedAt is newer', () => {
    const local = { tasks: [rec('a', T3, { name: 'local-new' })] };
    const remote = { tasks: [rec('a', T1, { name: 'remote-old' })] };

    const merged = mergeQuestData(local, remote);

    expect(merged.tasks).toHaveLength(1);
    expect((merged.tasks as Rec[])[0].name).toBe('local-new');
  });

  it('keeps remote record when remote updatedAt is newer', () => {
    const local = { habits: [rec('h1', T1, { name: 'local-old' })] };
    const remote = { habits: [rec('h1', T3, { name: 'remote-new' })] };

    const merged = mergeQuestData(local, remote);

    expect(merged.habits).toHaveLength(1);
    expect((merged.habits as Rec[])[0].name).toBe('remote-new');
  });

  it('keeps local record on equal updatedAt (mirror of pull semantics)', () => {
    const local = { tasks: [rec('a', T2, { name: 'local' })] };
    const remote = { tasks: [rec('a', T2, { name: 'remote' })] };

    const merged = mergeQuestData(local, remote);

    expect((merged.tasks as Rec[])[0].name).toBe('local');
  });

  it('propagates a newer local soft-delete', () => {
    const local = { habitChecks: [rec('c1', T3, { deletedAt: T3 })] };
    const remote = { habitChecks: [rec('c1', T1, { deletedAt: null })] };

    const merged = mergeQuestData(local, remote);

    expect((merged.habitChecks as Rec[])[0].deletedAt).toBe(T3);
  });

  it('does not revive a newer remote soft-delete', () => {
    const local = { habitChecks: [rec('c1', T1, { deletedAt: null })] };
    const remote = { habitChecks: [rec('c1', T3, { deletedAt: T3 })] };

    const merged = mergeQuestData(local, remote);

    expect((merged.habitChecks as Rec[])[0].deletedAt).toBe(T3);
  });

  it('returns local data unchanged when remote doc has no questify (new account)', () => {
    const local = { tasks: [rec('a', T1)], habits: [rec('h1', T2)] };

    expect(mergeQuestData(local, undefined)).toEqual(local);
    expect(mergeQuestData(local, null)).toEqual(local);
  });

  it('keeps local collection when remote lacks that collection', () => {
    const local = { tasks: [rec('a', T1)] };
    const remote = { habits: [rec('h1', T2)] };

    const merged = mergeQuestData(local, remote);

    expect((merged.tasks as Rec[]).map(r => r.id)).toEqual(['a']);
  });

  it('preserves a remote-only collection', () => {
    const local = { tasks: [rec('a', T1)] };
    const remote = { drawings: [rec('d1', T2)] };

    const merged = mergeQuestData(local, remote);

    expect((merged.drawings as Rec[]).map(r => r.id)).toEqual(['d1']);
  });

  it('merges rpgEvents as append-only union by id (no LWW)', () => {
    const local = {
      rpgEvents: [
        { id: 1, moduleId: 'quests', eventType: 'taskDone', createdAt: T1 },
        { id: 2, moduleId: 'quests', eventType: 'taskDone', createdAt: T2 },
      ],
    };
    const remote = {
      rpgEvents: [
        { id: 2, moduleId: 'quests', eventType: 'REMOTE-VARIANT', createdAt: T2 },
        { id: 3, moduleId: 'nutrition', eventType: 'mealLogged', createdAt: T3 },
      ],
    };

    const merged = mergeQuestData(local, remote);

    const events = merged.rpgEvents as Array<{ id: number; eventType: string }>;
    expect(events.map(e => e.id).sort()).toEqual([1, 2, 3]);
    // existing id keeps local version — append-only, never overwritten
    expect(events.find(e => e.id === 2)?.eventType).toBe('taskDone');
  });

  it('falls back to createdAt when updatedAt is missing (legacy records)', () => {
    const local = { habits: [{ id: 'h1', name: 'local', createdAt: T1 } as unknown as Rec] };
    const remote = { habits: [{ id: 'h1', name: 'remote', createdAt: T1, updatedAt: T3 } as Rec] };

    const merged = mergeQuestData(local, remote);

    expect((merged.habits as Rec[])[0].name).toBe('remote');
  });

  it('does not invent collections absent on both sides', () => {
    const local = { tasks: [rec('a', T1)] };
    const remote = { tasks: [rec('a', T1)] };

    const merged = mergeQuestData(local, remote);

    expect(Object.keys(merged).sort()).toEqual(['tasks']);
  });
});

import { describe, it, expect } from 'vitest';
import { mergeQuestData, questRecordKey } from '@shared/sync-merge';

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

// ── Collections whose identity is NOT `id` ─────────────────────────────────
// day_seals (PK date) and mastery_xp (PK module_id) carry no `id` in the
// export. Keyed by `r.id` they all landed on Map key `undefined` and the second
// push collapsed 30 sealed days / 4 masteries into ONE row.
describe('mergeQuestData — per-collection record keys', () => {
  const seal = (date: string) => ({ date, sealedAt: T1, xpAwarded: 10, vigor: 100, eventsCount: 3, modules: '[]', updatedAt: T1 });
  const mastery = (moduleId: string, xp: number, updatedAt = T1) => ({ moduleId, xp, updatedAt });

  it('keeps every daySeal across two pushes (3 seals → 3 seals)', () => {
    const local = { daySeals: [seal('2026-06-01'), seal('2026-06-02'), seal('2026-06-03')] };
    const first = mergeQuestData(local, undefined);
    const second = mergeQuestData(local, first);
    const dates = (second.daySeals as Array<{ date: string }>).map(s => s.date).sort();
    expect(dates).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
  });

  it('keeps every masteryXp across two pushes (4 masteries → 4)', () => {
    const local = { masteryXp: [mastery('quests', 10), mastery('finance', 20), mastery('nutrition', 30), mastery('cauldron', 40)] };
    const first = mergeQuestData(local, undefined);
    const second = mergeQuestData(local, first);
    const mods = (second.masteryXp as Array<{ moduleId: string }>).map(m => m.moduleId).sort();
    expect(mods).toEqual(['cauldron', 'finance', 'nutrition', 'quests']);
  });

  it('unions seals from both sides and never re-seals a day the local already has', () => {
    const local = { daySeals: [seal('2026-06-01'), { ...seal('2026-06-02'), xpAwarded: 99, updatedAt: T1 }] };
    const remote = { daySeals: [{ ...seal('2026-06-02'), xpAwarded: 1, updatedAt: T3 }, seal('2026-06-03')] };
    const merged = mergeQuestData(local, remote);
    const seals = merged.daySeals as Array<{ date: string; xpAwarded: number }>;
    expect(seals.map(s => s.date).sort()).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
    // first seal wins (mirror of the pull's INSERT OR IGNORE)
    expect(seals.find(s => s.date === '2026-06-02')?.xpAwarded).toBe(99);
  });

  it('converges masteryXp on MAX(xp) per module (mirror of the pull)', () => {
    const local = { masteryXp: [mastery('quests', 10, T3)] };
    const remote = { masteryXp: [mastery('quests', 50, T1), mastery('finance', 5, T1)] };
    const merged = mergeQuestData(local, remote);
    const byMod = Object.fromEntries((merged.masteryXp as Array<{ moduleId: string; xp: number }>).map(m => [m.moduleId, m.xp]));
    expect(byMod).toEqual({ quests: 50, finance: 5 });
  });

  it('every collection exported by sync:getAllQuestData resolves a real key', () => {
    // One sample record per collection, shaped like the export. A collection
    // whose key resolves to undefined would collapse on the second push.
    const samples: Record<string, Record<string, unknown>> = {
      tasks: { id: 't1' },
      subtasks: { id: 's1' },
      projects: { id: 'p1' },
      categories: { id: 'c1' },
      habits: { id: 'h1' },
      habitChecks: { id: 'hc1' },
      drawings: { id: 'd1' },
      rpgEvents: { syncId: 'e1' },
      achievements: { id: 'a1' },
      daySeals: { date: '2026-06-01' },
      obolosLedger: { id: 'o1' },
      rewards: { id: 'r1' },
      shopPurchases: { id: 'sp1' },
      masteryXp: { moduleId: 'quests' },
    };
    for (const [collection, sample] of Object.entries(samples)) {
      expect(questRecordKey(collection, sample), `${collection} has no key`).toBeDefined();
    }
  });
});

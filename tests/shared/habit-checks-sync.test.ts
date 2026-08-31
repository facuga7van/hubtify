import { describe, it, expect } from 'vitest';
import {
  habitCheckDocId,
  checkToDoc,
  docToCheck,
  migrateArrayToDocs,
  isNewer,
  type HabitCheckRow,
  type HabitCheckDoc,
} from '@shared/habit-checks-sync';

const T1 = '2026-07-06T10:00:00.000Z';
const T2 = '2026-07-07T10:00:00.000Z';
const T3 = '2026-07-08T10:00:00.000Z';

const row = (over: Partial<HabitCheckRow> = {}): HabitCheckRow => ({
  id: 'surrogate-random',
  habitId: 'h1',
  date: '2026-07-09',
  createdAt: T1,
  updatedAt: T2,
  deletedAt: null,
  ...over,
});

describe('habitCheckDocId', () => {
  it('is the deterministic natural key habitId_date', () => {
    expect(habitCheckDocId('h1', '2026-07-09')).toBe('h1_2026-07-09');
  });

  it('is stable across calls (idempotent doc target)', () => {
    expect(habitCheckDocId('abc', '2026-01-01')).toBe(habitCheckDocId('abc', '2026-01-01'));
  });
});

describe('checkToDoc', () => {
  it('maps a live (not deleted) row to checked:true, desktop origin, null claim', () => {
    const doc = checkToDoc(row({ deletedAt: null }));
    expect(doc).toEqual({
      habitId: 'h1',
      date: '2026-07-09',
      checked: true,
      createdAt: T1,
      updatedAt: T2,
      origin: 'desktop',
      rpgClaimedAt: null,
    });
  });

  it('maps a soft-deleted row (deleted_at set) to checked:false', () => {
    const doc = checkToDoc(row({ deletedAt: T3 }));
    expect(doc.checked).toBe(false);
  });
});

describe('docToCheck', () => {
  const doc = (over: Partial<HabitCheckDoc> = {}): HabitCheckDoc => ({
    habitId: 'h1',
    date: '2026-07-09',
    checked: true,
    createdAt: T1,
    updatedAt: T2,
    origin: 'desktop',
    rpgClaimedAt: null,
    ...over,
  });

  it('uses the deterministic docId as the surrogate id', () => {
    expect(docToCheck(doc()).id).toBe('h1_2026-07-09');
  });

  it('checked:true → deleted_at null', () => {
    expect(docToCheck(doc({ checked: true })).deletedAt).toBeNull();
  });

  it('checked:false (uncheck) → deleted_at set to updatedAt', () => {
    const r = docToCheck(doc({ checked: false, updatedAt: T3 }));
    expect(r.deletedAt).toBe(T3);
  });
});

describe('checkToDoc / docToCheck roundtrip', () => {
  it('preserves the checked state (live)', () => {
    const original = row({ deletedAt: null });
    const back = docToCheck(checkToDoc(original));
    expect(back.deletedAt).toBeNull();
    expect(back.habitId).toBe(original.habitId);
    expect(back.date).toBe(original.date);
    expect(back.createdAt).toBe(original.createdAt);
    expect(back.updatedAt).toBe(original.updatedAt);
    // surrogate id normalizes to the deterministic natural key
    expect(back.id).toBe(habitCheckDocId(original.habitId, original.date));
  });

  it('preserves the unchecked state (soft-deleted)', () => {
    const original = row({ deletedAt: T2, updatedAt: T2 });
    const back = docToCheck(checkToDoc(original));
    expect(back.deletedAt).toBe(T2);
  });
});

describe('isNewer (LWW guard)', () => {
  it('local strictly newer → true', () => {
    expect(isNewer(T2, T1)).toBe(true);
  });

  it('local older → false', () => {
    expect(isNewer(T1, T2)).toBe(false);
  });

  it('tie → false (do not clobber a concurrent write)', () => {
    expect(isNewer(T2, T2)).toBe(false);
  });

  it('remote missing → true when local exists (nothing to clobber)', () => {
    expect(isNewer(T1, null)).toBe(true);
    expect(isNewer(T1, undefined)).toBe(true);
  });

  it('local missing → false', () => {
    expect(isNewer(null, T1)).toBe(false);
    expect(isNewer(undefined, T1)).toBe(false);
  });

  it('both missing → false', () => {
    expect(isNewer(null, null)).toBe(false);
  });
});

describe('migrateArrayToDocs', () => {
  it('maps each check to a doc entry with its deterministic docId', () => {
    const entries = migrateArrayToDocs([row({ habitId: 'h1', date: '2026-07-09' })]);
    expect(entries).toHaveLength(1);
    expect(entries[0].docId).toBe('h1_2026-07-09');
    expect(entries[0].doc.origin).toBe('desktop');
  });

  it('collapses duplicates by natural key, keeping the newest by updatedAt', () => {
    const entries = migrateArrayToDocs([
      row({ id: 'a', habitId: 'h1', date: '2026-07-09', updatedAt: T1, deletedAt: T1 }), // older, unchecked
      row({ id: 'b', habitId: 'h1', date: '2026-07-09', updatedAt: T3, deletedAt: null }), // newer, checked
      row({ id: 'c', habitId: 'h2', date: '2026-07-09', updatedAt: T2 }),
    ]);
    // h1_2026-07-09 collapsed to one, h2_2026-07-09 separate → 2 total
    expect(entries).toHaveLength(2);
    const h1 = entries.find(e => e.docId === 'h1_2026-07-09')!;
    // newest wins → checked:true (deleted_at was null on the T3 row)
    expect(h1.doc.checked).toBe(true);
    expect(h1.doc.updatedAt).toBe(T3);
  });

  it('empty array → empty list (safe backfill)', () => {
    expect(migrateArrayToDocs([])).toEqual([]);
  });
});

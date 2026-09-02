import { describe, it, expect, vi } from 'vitest';

// nutrition.ipc.ts imports electron via ipc-handle (ipcMain) and db (app).
// We only exercise the pure BMR/TDEE/activity-factor helpers, so a thin mock
// is enough — getDb() is never called by these helpers (they take db directly).
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') },
}));

import Database from 'better-sqlite3';
import { daysAgoDateString } from '../../../shared/date-utils';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';
import {
  calculateBMR,
  calculateTDEEWithFactor,
  getDynamicActivityFactor,
} from '../../../shared-logic/modules/nutrition.ipc';

function runMigrations(db: Database.Database) {
  for (const m of nutritionMigrations) {
    try {
      db.exec(m.up);
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes('duplicate column name')) continue;
      throw e;
    }
  }
}

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function insertMetric(db: Database.Database, date: string, steps: number | null, gym: boolean) {
  db.prepare('INSERT OR REPLACE INTO nutrition_daily_metrics (date, steps, gym) VALUES (?, ?, ?)')
    .run(date, steps, gym ? 1 : 0);
}

describe('calculateBMR — Mifflin-St Jeor', () => {
  it('male: 10*w + 6.25*h - 5*age + 5', () => {
    // 10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5 = 1780
    expect(calculateBMR(80, 180, 30, 'M')).toBe(1780);
  });

  it('female: 10*w + 6.25*h - 5*age - 161', () => {
    // 800 + 1125 - 150 - 161 = 1614
    expect(calculateBMR(80, 180, 30, 'F')).toBe(1614);
  });

  it('clamps to a floor of 800 for very small bodies', () => {
    // 10*10 + 6.25*100 - 5*90 - 161 = 100 + 625 - 450 - 161 = 114 → clamped to 800
    expect(calculateBMR(10, 100, 90, 'F')).toBe(800);
  });

  it('clamps to a ceiling of 3500 for very large bodies', () => {
    // 10*300 + 6.25*250 - 5*20 + 5 = 3000 + 1562.5 - 100 + 5 = 4467.5 → clamped to 3500
    expect(calculateBMR(300, 250, 20, 'M')).toBe(3500);
  });

  it('treats any non-M sex as female (subtracts 161)', () => {
    // The branch is sex === 'M' ? +5 : -161, so anything else gets -161.
    expect(calculateBMR(80, 180, 30, 'X')).toBe(1614);
  });
});

describe('calculateTDEEWithFactor', () => {
  it('rounds bmr * factor', () => {
    // 1780 * 1.55 = 2759 → Math.round(2759) = 2759
    expect(calculateTDEEWithFactor(1780, 1.55)).toBe(2759);
  });

  it('rounds to nearest integer (1614 * 1.375 = 2219.25 → 2219)', () => {
    expect(calculateTDEEWithFactor(1614, 1.375)).toBe(2219);
  });
});

describe('getDynamicActivityFactor', () => {
  it('returns the base factor when fewer than 3 days of metrics exist', () => {
    const db = setupDb();
    insertMetric(db, daysAgoDateString(0), 5000, true);
    insertMetric(db, daysAgoDateString(1), 5000, true);
    // Only 2 days → not enough history, base level used as-is.
    expect(getDynamicActivityFactor(db, 'sedentary')).toBe(1.2);
    expect(getDynamicActivityFactor(db, 'moderate')).toBe(1.55);
  });

  it('returns base 1.2 for an unknown activity level', () => {
    const db = setupDb();
    // No metrics at all → < 3 → base; unknown level falls back to 1.2.
    expect(getDynamicActivityFactor(db, 'hyperactive')).toBe(1.2);
  });

  it('blends base with a high dynamic factor when activity is maxed out', () => {
    const db = setupDb();
    // 3 days, gym every day + 10000+ steps → gymRatio=1, stepsScore=1 → activityScore=1.
    // dynamicFactor = 1.2 + 1*(1.725-1.2) = 1.725.
    // base moderate=1.55 → 1.55*0.4 + 1.725*0.6 = 0.62 + 1.035 = 1.655.
    insertMetric(db, daysAgoDateString(0), 12000, true);
    insertMetric(db, daysAgoDateString(1), 12000, true);
    insertMetric(db, daysAgoDateString(2), 12000, true);
    expect(getDynamicActivityFactor(db, 'moderate')).toBe(1.655);
  });

  it('blends base with the floor dynamic factor when there is no activity', () => {
    const db = setupDb();
    // 3 days, never gym + 0 steps → activityScore=0 → dynamicFactor=1.2.
    // base sedentary=1.2 → 1.2*0.4 + 1.2*0.6 = 1.2.
    insertMetric(db, daysAgoDateString(0), 0, false);
    insertMetric(db, daysAgoDateString(1), 0, false);
    insertMetric(db, daysAgoDateString(2), 0, false);
    expect(getDynamicActivityFactor(db, 'sedentary')).toBe(1.2);
  });

  it('ignores metrics older than the 14-day window', () => {
    const db = setupDb();
    // Two recent inactive days + two ancient super-active days. The ancient ones
    // fall outside date >= daysAgoDateString(13) so only 2 days count → < 3 → base.
    insertMetric(db, daysAgoDateString(0), 0, false);
    insertMetric(db, daysAgoDateString(1), 0, false);
    insertMetric(db, daysAgoDateString(20), 20000, true);
    insertMetric(db, daysAgoDateString(21), 20000, true);
    expect(getDynamicActivityFactor(db, 'light')).toBe(1.375);
  });

  it('treats null steps as zero in the average', () => {
    const db = setupDb();
    // 5 days, gym on 2 (gymRatio=0.4), steps null → stepsScore=0.
    // activityScore = 0.4*0.5 + 0*0.5 = 0.2 → dynamicFactor = 1.2 + 0.2*0.525 = 1.305.
    // base sedentary=1.2 → 1.2*0.4 + 1.305*0.6 = 0.48 + 0.783 = 1.263.
    insertMetric(db, daysAgoDateString(0), null, true);
    insertMetric(db, daysAgoDateString(1), null, true);
    insertMetric(db, daysAgoDateString(2), null, false);
    insertMetric(db, daysAgoDateString(3), null, false);
    insertMetric(db, daysAgoDateString(4), null, false);
    expect(getDynamicActivityFactor(db, 'sedentary')).toBe(1.263);
  });
});

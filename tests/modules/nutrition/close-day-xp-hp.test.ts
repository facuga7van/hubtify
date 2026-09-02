import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { nutritionMigrations } from '@modules/nutrition/nutrition.schema';

// In-memory DB shared with the mocked db module.
let testDb: Database.Database;

// Capture handlers registered via ipcMain.handle (through ipcHandle) so we can
// invoke nutrition:closeDay directly and read its XP/HP breakdown.
const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
  },
}));

vi.mock('../../../shared-logic/db', () => ({
  getDb: () => testDb,
  runModuleMigrations: vi.fn(),
}));

import { registerNutritionIpcHandlers } from '../../../electron/modules/nutrition.ipc';

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

const DATE = '2026-05-01';

/** Insert the singleton profile row with a chosen deficit/surplus target. */
function setProfile(deficit = 500, weightCheckDay = 1) {
  testDb.prepare(`
    INSERT OR REPLACE INTO nutrition_profile (id, age, sex, height_cm, initial_weight_kg, activity_level, deficit_target_kcal, weight_check_day)
    VALUES (1, 30, 'M', 180, 80, 'moderate', ?, ?)
  `).run(deficit, weightCheckDay);
}

/** Insert the day summary so target = tdee - deficit is fully controlled. */
function setSummary(consumed: number, tdee = 2500) {
  testDb.prepare(`
    INSERT OR REPLACE INTO nutrition_daily_summary (date, total_calories_in, bmr, tdee, balance)
    VALUES (?, ?, 1700, ?, ?)
  `).run(DATE, consumed, tdee, tdee - consumed);
}

function setMetrics(steps: number | null, gym: boolean) {
  testDb.prepare('INSERT OR REPLACE INTO nutrition_daily_metrics (date, steps, gym) VALUES (?, ?, ?)')
    .run(DATE, steps, gym ? 1 : 0);
}

async function closeDay(): Promise<any> {
  return await handlers.get('nutrition:closeDay')!({}, DATE);
}

beforeEach(() => {
  testDb = setupDb();
  handlers.clear();
  registerNutritionIpcHandlers();
});

// With tdee=2500 and deficit=500, target = 2000 in every "deficit goal" case below.

describe('closeDay — XP precision (deficit goal, consumed <= target)', () => {
  it('within 5% of target → precision 30 + bonus 15', async () => {
    setProfile(500);
    setSummary(1900); // deficitPct = (2000-1900)/2000 = 0.05 (exact boundary)
    const r = await closeDay();
    expect(r.breakdown.xpPrecision).toBe(30);
    expect(r.breakdown.xpBonus).toBe(15);
  });

  it('exactly 15% under → precision 30 + bonus 10', async () => {
    setProfile(500);
    setSummary(1700); // deficitPct = 0.15 (exact boundary)
    const r = await closeDay();
    expect(r.breakdown.xpPrecision).toBe(30);
    expect(r.breakdown.xpBonus).toBe(10);
  });

  it('exactly 30% under → precision 30 + bonus 5', async () => {
    setProfile(500);
    setSummary(1400); // deficitPct = 0.30 (exact boundary)
    const r = await closeDay();
    expect(r.breakdown.xpPrecision).toBe(30);
    expect(r.breakdown.xpBonus).toBe(5);
  });

  it('just over 30% under (undereating) → precision 20 + bonus 0', async () => {
    setProfile(500);
    setSummary(1399); // deficitPct = 0.3005 > 0.30
    const r = await closeDay();
    expect(r.breakdown.xpPrecision).toBe(20);
    expect(r.breakdown.xpBonus).toBe(0);
  });

  it('eating exactly at target → precision 30 + bonus 15 (deficitPct 0)', async () => {
    setProfile(500);
    setSummary(2000);
    const r = await closeDay();
    expect(r.breakdown.xpPrecision).toBe(30);
    expect(r.breakdown.xpBonus).toBe(15);
  });
});

describe('closeDay — XP precision (deficit goal, consumed > target)', () => {
  it('over by exactly 10% → precision 15', async () => {
    setProfile(500);
    setSummary(2200); // overPct = 0.10
    const r = await closeDay();
    expect(r.breakdown.xpPrecision).toBe(15);
    expect(r.breakdown.xpBonus).toBe(0);
  });

  it('over by exactly 20% → precision 8', async () => {
    setProfile(500);
    setSummary(2400); // overPct = 0.20
    const r = await closeDay();
    expect(r.breakdown.xpPrecision).toBe(8);
  });

  it('over by more than 20% → precision 2', async () => {
    setProfile(500);
    setSummary(2401); // overPct = 0.2005
    const r = await closeDay();
    expect(r.breakdown.xpPrecision).toBe(2);
  });
});

describe('closeDay — XP precision edge cases', () => {
  it('consumed 0 → precision 0 and no XP at all', async () => {
    setProfile(500);
    setSummary(0);
    const r = await closeDay();
    expect(r.breakdown.xpPrecision).toBe(0);
    expect(r.breakdown.xpBonus).toBe(0);
    expect(r.breakdown.xpTotal).toBe(0);
  });

  it('target <= 0 (deficit exceeds tdee) → flat precision 5', async () => {
    setProfile(2500); // target = 2500 - 2500 = 0 → <= 0 branch
    setSummary(1800);
    const r = await closeDay();
    expect(r.breakdown.xpPrecision).toBe(5);
    expect(r.breakdown.xpBonus).toBe(0);
  });
});

describe('closeDay — XP for steps / gym / weight', () => {
  it('adds +5 each for steps, gym and a logged weekly weight', async () => {
    // Make checkDate == DATE by setting weight_check_day to DATE's day-of-week,
    // so the weekly weight lookup hits the row we insert below.
    const dow = (new Date(DATE + 'T12:00:00').getDay()) || 7;
    setProfile(500, dow);
    setSummary(1900); // precision 30 + bonus 15
    setMetrics(8000, true);
    testDb.prepare('INSERT INTO nutrition_weekly_metrics (date, weight_kg) VALUES (?, ?)').run(DATE, 79.5);

    const r = await closeDay();
    expect(r.breakdown.xpSteps).toBe(5);
    expect(r.breakdown.xpGym).toBe(5);
    expect(r.breakdown.xpWeight).toBe(5);
    // 30 + 15 + 5 + 5 + 5 = 60 (documented max)
    expect(r.breakdown.xpTotal).toBe(60);
  });

  it('0 steps grants no step XP', async () => {
    setProfile(500);
    setSummary(1900);
    setMetrics(0, false);
    const r = await closeDay();
    expect(r.breakdown.xpSteps).toBe(0);
    expect(r.breakdown.xpGym).toBe(0);
    expect(r.breakdown.xpWeight).toBe(0);
    expect(r.breakdown.xpTotal).toBe(45);
  });
});

describe('closeDay — HP (deficit goal)', () => {
  it('at/below target → +10 HP', async () => {
    setProfile(500);
    setSummary(1900);
    const r = await closeDay();
    expect(r.breakdown.hpChange).toBe(10);
  });

  it('over by <=10% → -5 HP', async () => {
    setProfile(500);
    setSummary(2200); // overPct 0.10
    const r = await closeDay();
    expect(r.breakdown.hpChange).toBe(-5);
  });

  it('over by <=20% → -10 HP', async () => {
    setProfile(500);
    setSummary(2400); // overPct 0.20
    const r = await closeDay();
    expect(r.breakdown.hpChange).toBe(-10);
  });

  it('over by >20% → -20 HP', async () => {
    setProfile(500);
    setSummary(2401);
    const r = await closeDay();
    expect(r.breakdown.hpChange).toBe(-20);
  });
});

describe('closeDay — HP (surplus goal, deficit negative)', () => {
  // deficit = -500 → target = 2500 - (-500) = 3000.
  it('at/above target → +10 HP', async () => {
    setProfile(-500);
    setSummary(3000);
    const r = await closeDay();
    expect(r.breakdown.target).toBe(3000);
    expect(r.breakdown.hpChange).toBe(10);
  });

  it('under by <=10% → -5 HP', async () => {
    setProfile(-500);
    setSummary(2700); // underPct = (3000-2700)/3000 = 0.10
    const r = await closeDay();
    expect(r.breakdown.hpChange).toBe(-5);
  });

  it('under by <=20% → -10 HP', async () => {
    setProfile(-500);
    setSummary(2400); // underPct 0.20
    const r = await closeDay();
    expect(r.breakdown.hpChange).toBe(-10);
  });

  it('under by >20% → -20 HP', async () => {
    setProfile(-500);
    setSummary(2399); // underPct 0.2003
    const r = await closeDay();
    expect(r.breakdown.hpChange).toBe(-20);
  });
});

describe('closeDay — HP (maintenance goal, deficit 0)', () => {
  // deficit = 0 → target = tdee = 2500.
  it('within 10% deviation → +10 HP', async () => {
    setProfile(0);
    setSummary(2250); // deviation = 0.10
    const r = await closeDay();
    expect(r.breakdown.target).toBe(2500);
    expect(r.breakdown.hpChange).toBe(10);
  });

  it('deviation <=20% → -5 HP', async () => {
    setProfile(0);
    setSummary(2000); // deviation 0.20
    const r = await closeDay();
    expect(r.breakdown.hpChange).toBe(-5);
  });

  it('deviation <=30% → -10 HP', async () => {
    setProfile(0);
    setSummary(1750); // deviation 0.30
    const r = await closeDay();
    expect(r.breakdown.hpChange).toBe(-10);
  });

  it('deviation >30% → -20 HP', async () => {
    setProfile(0);
    setSummary(1749); // deviation 0.3004
    const r = await closeDay();
    expect(r.breakdown.hpChange).toBe(-20);
  });

  it('maintenance over-eating is symmetric (deviation uses abs)', async () => {
    setProfile(0);
    setSummary(3250); // deviation = |3250-2500|/2500 = 0.30
    const r = await closeDay();
    expect(r.breakdown.hpChange).toBe(-10);
  });
});

describe('closeDay — HP guards', () => {
  it('consumed 0 → no HP change', async () => {
    setProfile(500);
    setSummary(0);
    const r = await closeDay();
    expect(r.breakdown.hpChange).toBe(0);
  });

  it('target <= 0 → no HP change', async () => {
    setProfile(2500); // target 0
    setSummary(1800);
    const r = await closeDay();
    expect(r.breakdown.hpChange).toBe(0);
  });
});

describe('closeDay — persistence and idempotency', () => {
  it('persists the breakdown and refuses to re-close an already-closed day', async () => {
    setProfile(500);
    setSummary(1900);
    const first = await closeDay();
    expect(first.success).toBe(true);

    const stored = testDb.prepare('SELECT xp_total AS xpTotal, hp_change AS hpChange FROM nutrition_daily_closed WHERE date = ?').get(DATE) as { xpTotal: number; hpChange: number };
    expect(stored.xpTotal).toBe(first.breakdown.xpTotal);
    expect(stored.hpChange).toBe(first.breakdown.hpChange);

    const second = await closeDay();
    expect(second).toEqual({ success: false, alreadyClosed: true });
  });

  it('fails when there is no summary for the day', async () => {
    setProfile(500);
    const r = await closeDay();
    expect(r).toEqual({ success: false, error: 'No data for this day' });
  });

  it('reports precisionPct as the absolute deviation percentage', async () => {
    setProfile(500);
    setSummary(1700); // |1700-2000|/2000 = 15%
    const r = await closeDay();
    expect(r.breakdown.precisionPct).toBe(15);
  });
});

import { describe, it, expect } from 'vitest';
import {
  xpThreshold,
  getLevel,
  getTitle,
  getComboMultiplier,
  rollRandomBonus,
  calculateXpGain,
  vigorBonus,
  getStreakMilestoneBonus,
  clampHp,
  xpToNextLevel,
  daysDiff,
  getLocalDateString,
  monthKey,
  pardonsRemaining,
  PARDONS_PER_MONTH,
  sealXp,
  sealWindowStatus,
  SEAL_BASE_XP,
  SEAL_EVENT_CAP,
} from './rpg-engine';
import {
  ACHIEVEMENTS,
  ACHIEVEMENTS_BY_ID,
  EVENT_MODULES,
  type AchievementContext,
  type AchievementEventContext,
} from './achievements';

/** A context where nothing has happened. Override only the field under test. */
function blankContext(overrides: Partial<AchievementContext>): AchievementContext {
  return {
    event: null,
    stats: { level: 1, xp: 0, hp: 100, streak: 0, bestStreak: 0, innSince: null },
    today: '2026-03-21',
    totalEvents: 0,
    countByType: {},
    countByModule: {},
    eventsToday: 0,
    countByTypeToday: {},
    modulesToday: [],
    typesToday: [],
    epicsToday: 0,
    xpToday: 0,
    maxComboToday: 0,
    daysSinceLastActivity: 0,
    distinctHabits: 0,
    sealsCount: 0,
    hasCharacterName: false,
    ...overrides,
  };
}

function blankEvent(overrides: Partial<AchievementEventContext> = {}): AchievementEventContext {
  return {
    type: 'TASK_COMPLETED',
    moduleId: 'quests',
    payload: {},
    hour: 12,
    date: '2026-03-21',
    weekday: 6,
    comboMultiplier: 1.0,
    bonusMultiplier: 1.0,
    xpGained: 15,
    pardonUsed: false,
    ...overrides,
  };
}

describe('xpThreshold', () => {
  it('level 1 is 0', () => { expect(xpThreshold(1)).toBe(0); });
  it('level 2 is 339', () => { expect(xpThreshold(2)).toBe(339); });
  it('level 10 is 3795', () => { expect(xpThreshold(10)).toBe(3795); });
});

describe('getLevel', () => {
  it('0 xp is level 1', () => { expect(getLevel(0)).toBe(1); });
  it('338 xp is still level 1', () => { expect(getLevel(338)).toBe(1); });
  it('339 xp is level 2', () => { expect(getLevel(339)).toBe(2); });
  it('3795 xp is level 10', () => { expect(getLevel(3795)).toBe(10); });
});

describe('getTitle', () => {
  it('level 1 is Campesino', () => { expect(getTitle(1)).toBe('Campesino'); });
  it('level 10 is Guerrero', () => { expect(getTitle(10)).toBe('Guerrero'); });
  it('level 50 is Leyenda', () => { expect(getTitle(50)).toBe('Leyenda'); });
});

describe('getComboMultiplier', () => {
  it('first action is x1.0', () => { expect(getComboMultiplier(0)).toBe(1.0); });
  it('fifth+ action is x2.0 (cap)', () => {
    expect(getComboMultiplier(4)).toBe(2.0);
    expect(getComboMultiplier(10)).toBe(2.0);
  });
});

describe('rollRandomBonus', () => {
  it('returns a valid multiplier', () => {
    const result = rollRandomBonus();
    expect([1.0, 1.5, 2.0, 3.0]).toContain(result);
  });
});

describe('calculateXpGain', () => {
  it('calculates base x combo x bonus', () => {
    expect(calculateXpGain(15, 1.25, 1.0)).toBeCloseTo(18.75);
  });
  // Replaces the two former hp-penalty cases. `calculateHpPenalty` is GONE: it
  // halved every reward at hp = 0 with no way to heal, which is accumulated-debt
  // punishment. HP is now the day's Vigor and never touches XP.
  it('is unaffected by HP — there is no penalty term left', () => {
    expect(calculateXpGain(15, 1.0, 1.0)).toBeCloseTo(15);
    expect(calculateXpGain.length).toBe(3);
  });
});

describe('vigorBonus', () => {
  it('never punishes — the floor is 1.0', () => {
    expect(vigorBonus(0)).toBe(1.0);
    expect(vigorBonus(69)).toBe(1.0);
  });
  it('rewards a healthy day', () => {
    expect(vigorBonus(70)).toBe(1.05);
    expect(vigorBonus(89)).toBe(1.05);
    expect(vigorBonus(90)).toBe(1.1);
    expect(vigorBonus(100)).toBe(1.1);
  });
});

describe('monthKey / pardonsRemaining', () => {
  it('buckets a date into its YYYY-MM month', () => {
    expect(monthKey('2026-08-31')).toBe('2026-08');
  });
  it('gives a full allowance when the stored month is stale or missing', () => {
    expect(pardonsRemaining(null, 0, '2026-08')).toBe(PARDONS_PER_MONTH);
    expect(pardonsRemaining('2026-07', 2, '2026-08')).toBe(PARDONS_PER_MONTH);
  });
  it('subtracts the pardons used inside the current month', () => {
    expect(pardonsRemaining('2026-08', 1, '2026-08')).toBe(1);
    expect(pardonsRemaining('2026-08', 2, '2026-08')).toBe(0);
    expect(pardonsRemaining('2026-08', 9, '2026-08')).toBe(0);
  });
});

describe('getStreakMilestoneBonus', () => {
  it('returns 0 for non-milestone days', () => {
    expect(getStreakMilestoneBonus(1)).toBe(0);
    expect(getStreakMilestoneBonus(2)).toBe(0);
    expect(getStreakMilestoneBonus(5)).toBe(0);
  });
  it('returns correct bonus for milestones', () => {
    expect(getStreakMilestoneBonus(3)).toBe(25);
    expect(getStreakMilestoneBonus(7)).toBe(50);
    expect(getStreakMilestoneBonus(14)).toBe(100);
    expect(getStreakMilestoneBonus(30)).toBe(250);
    expect(getStreakMilestoneBonus(100)).toBe(1000);
  });
});

describe('clampHp', () => {
  it('clamps to 0 when negative', () => {
    expect(clampHp(-10)).toBe(0);
  });
  it('clamps to 100 when over max', () => {
    expect(clampHp(150)).toBe(100);
  });
  it('rounds to nearest integer', () => {
    expect(clampHp(50.7)).toBe(51);
  });
  it('keeps valid values', () => {
    expect(clampHp(50)).toBe(50);
  });
});

describe('xpToNextLevel', () => {
  it('at level 1 with 0 xp needs 339', () => {
    expect(xpToNextLevel(0)).toBe(339);
  });
  it('at level 2 with 339 xp', () => {
    // level 2 threshold is 339, level 3 threshold is round(120 * 3^1.5) = 624
    const result = xpToNextLevel(339);
    expect(result).toBe(624 - 339);
  });
});

describe('daysDiff', () => {
  it('same day is 0', () => {
    expect(daysDiff('2026-03-21', '2026-03-21')).toBe(0);
  });
  it('one day apart is 1', () => {
    expect(daysDiff('2026-03-20', '2026-03-21')).toBe(1);
  });
  it('negative diff', () => {
    expect(daysDiff('2026-03-21', '2026-03-20')).toBe(-1);
  });
});

describe('getLocalDateString', () => {
  it('returns YYYY-MM-DD format', () => {
    const result = getLocalDateString();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── Phase 2: Cierre del Códice ─────────────────────────────────────────────

describe('sealXp', () => {
  it('pays the floor for a one-event day at neutral vigor', () => {
    // (10 + 2*1) * 1.0
    expect(sealXp(1, 50)).toBe(12);
  });

  it('caps the event term at SEAL_EVENT_CAP so a busy day is not a farm', () => {
    expect(sealXp(SEAL_EVENT_CAP, 50)).toBe(50);
    expect(sealXp(500, 50)).toBe(sealXp(SEAL_EVENT_CAP, 50));
  });

  it('applies vigorBonus once, never a penalty', () => {
    expect(sealXp(20, 100)).toBe(Math.round(50 * 1.1)); // 55
    expect(sealXp(20, 75)).toBe(Math.round(50 * 1.05)); // 53
    expect(sealXp(20, 10)).toBe(50);                    // 1.0 floor, never below
  });

  it('never returns less than the base, whatever the vigor', () => {
    for (const hp of [0, 25, 50, 69, 70, 89, 90, 100]) {
      expect(sealXp(0, hp)).toBeGreaterThanOrEqual(SEAL_BASE_XP);
    }
  });
});

describe('sealWindowStatus', () => {
  it('accepts today and yesterday (the grace window)', () => {
    expect(sealWindowStatus('2026-03-21', '2026-03-21')).toBe('ok');
    expect(sealWindowStatus('2026-03-20', '2026-03-21')).toBe('ok');
  });
  it('refuses anything older', () => {
    expect(sealWindowStatus('2026-03-19', '2026-03-21')).toBe('too_old');
  });
  it('refuses the future', () => {
    expect(sealWindowStatus('2026-03-22', '2026-03-21')).toBe('future');
  });
});

// ── Phase 2: achievement catalogue calibration ─────────────────────────────

describe('achievement catalogue', () => {
  it('has ~40 entries with unique ids', () => {
    expect(ACHIEVEMENTS.length).toBe(40);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(40);
  });

  it('keeps ~20% hidden', () => {
    const hidden = ACHIEVEMENTS.filter((a) => a.hidden).length;
    expect(hidden).toBe(8);
    expect(hidden / ACHIEVEMENTS.length).toBeCloseTo(0.2, 2);
  });

  it('derives every i18nKey from the id', () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.i18nKey).toBe(`rpg.achievements.${a.id}`);
    }
  });

  it('carries the roadmap-mandated entries', () => {
    const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
    for (const required of [
      'early_bird', 'night_owl', 'three_epics', 'perfect_day', 'hero_return',
      'chronicler_i', 'chronicler_ii', 'chronicler_iii',
      'steady_hand', 'ledger_closed', 'cauldron_master',
    ]) {
      expect(ids.has(required)).toBe(true);
    }
  });

  it('unlocks first_step on the very first event of a new account', () => {
    const ctx = blankContext({ totalEvents: 1 });
    expect(ACHIEVEMENTS_BY_ID.get('first_step')!.check(ctx)).toBe(true);
  });

  it('does not mistake a brand new account for a returning hero', () => {
    const ctx = blankContext({
      totalEvents: 1,
      daysSinceLastActivity: 0,
      event: blankEvent(),
    });
    expect(ACHIEVEMENTS_BY_ID.get('hero_return')!.check(ctx)).toBe(false);
  });

  it('needs all four event-emitting modules for Día Perfecto', () => {
    expect(ACHIEVEMENTS_BY_ID.get('perfect_day')!.check(
      blankContext({ modulesToday: ['quests', 'nutrition', 'finance'] }),
    )).toBe(false);
    expect(ACHIEVEMENTS_BY_ID.get('perfect_day')!.check(
      blankContext({ modulesToday: [...EVENT_MODULES, 'rpg'] }),
    )).toBe(true);
  });

  it('never asks for more than 2000 of anything (no grind)', () => {
    // The Cronista family is the single sanctioned counting ladder.
    const counting = ACHIEVEMENTS.filter((a) => a.id.startsWith('chronicler_'));
    expect(counting).toHaveLength(3);
    expect(ACHIEVEMENTS_BY_ID.get('chronicler_iii')!.check(blankContext({ totalEvents: 1999 }))).toBe(false);
    expect(ACHIEVEMENTS_BY_ID.get('chronicler_iii')!.check(blankContext({ totalEvents: 2000 }))).toBe(true);
  });

  it('survives an empty context without throwing', () => {
    const ctx = blankContext({});
    for (const a of ACHIEVEMENTS) {
      expect(() => a.check(ctx)).not.toThrow();
    }
  });

  it('unlocks exactly the two backfill entries on a used-but-unmigrated account', () => {
    // What every existing install already satisfies: some history, a named
    // character, and nothing else. The shelf must read 2 / 40.
    const ctx = blankContext({ totalEvents: 12, hasCharacterName: true });
    const hits = ACHIEVEMENTS.filter((a) => a.check(ctx)).map((a) => a.id);
    expect(hits.sort()).toEqual(['awakening', 'first_step']);
  });
});

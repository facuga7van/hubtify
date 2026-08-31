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
} from './rpg-engine';

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

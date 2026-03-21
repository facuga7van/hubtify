import { describe, it, expect } from 'vitest';
import {
  xpThreshold,
  getLevel,
  getTitle,
  getComboMultiplier,
  rollRandomBonus,
  calculateXpGain,
  calculateHpPenalty,
  getStreakMilestoneBonus,
  clampHp,
  xpToNextLevel,
  isStreakActive,
  daysDiff,
  getLocalDateString,
} from './rpg-engine';

describe('xpThreshold', () => {
  it('level 1 is 0', () => { expect(xpThreshold(1)).toBe(0); });
  it('level 2 is 246', () => { expect(xpThreshold(2)).toBe(246); });
  it('level 10 is 1995', () => { expect(xpThreshold(10)).toBe(1995); });
});

describe('getLevel', () => {
  it('0 xp is level 1', () => { expect(getLevel(0)).toBe(1); });
  it('245 xp is still level 1', () => { expect(getLevel(245)).toBe(1); });
  it('246 xp is level 2', () => { expect(getLevel(246)).toBe(2); });
  it('2000 xp is level 10', () => { expect(getLevel(2000)).toBe(10); });
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
    expect(calculateXpGain(15, 1.25, 1.0, 50)).toBeCloseTo(18.75);
  });
  it('applies hp penalty when hp is 0', () => {
    expect(calculateXpGain(15, 1.0, 1.0, 0)).toBeCloseTo(7.5);
  });
  it('no hp penalty when hp > 0', () => {
    expect(calculateXpGain(15, 1.0, 1.0, 1)).toBeCloseTo(15);
  });
});

describe('calculateHpPenalty', () => {
  it('returns 0.5 when hp is 0', () => { expect(calculateHpPenalty(0)).toBe(0.5); });
  it('returns 1.0 when hp > 0', () => {
    expect(calculateHpPenalty(1)).toBe(1.0);
    expect(calculateHpPenalty(100)).toBe(1.0);
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

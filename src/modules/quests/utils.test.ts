import { describe, it, expect } from 'vitest';
import { tierXp, calculateXpForAction } from './utils';

describe('tierXp', () => {
  it('quick tier returns 5', () => {
    expect(tierXp(1)).toBe(5);
  });
  it('normal tier returns 15', () => {
    expect(tierXp(2)).toBe(15);
  });
  it('epic tier returns 40', () => {
    expect(tierXp(3)).toBe(40);
  });
  it('unknown tier defaults to 15', () => {
    expect(tierXp(99)).toBe(15);
  });
});

describe('calculateXpForAction', () => {
  it('returns positive xp', () => {
    const result = calculateXpForAction(2, 0);
    expect(result.xp).toBeGreaterThan(0);
  });

  it('combo multiplier increases with count', () => {
    const first = calculateXpForAction(2, 0);
    // comboMult at 0 is 1.0, at 4 is 2.0
    expect(first.comboMult).toBe(1.0);

    const fifth = calculateXpForAction(2, 4);
    expect(fifth.comboMult).toBe(2.0);
  });

  it('bonus tier is valid', () => {
    const result = calculateXpForAction(2, 0);
    expect(['normal', 'good', 'critical', 'legendary']).toContain(result.bonus.tier);
  });

  it('xp scales with tier', () => {
    // Run multiple times to account for random bonus
    let quickTotal = 0;
    let epicTotal = 0;
    for (let i = 0; i < 100; i++) {
      quickTotal += calculateXpForAction(1, 0).xp;
      epicTotal += calculateXpForAction(3, 0).xp;
    }
    // Epic should average much higher than quick
    expect(epicTotal / 100).toBeGreaterThan(quickTotal / 100);
  });
});

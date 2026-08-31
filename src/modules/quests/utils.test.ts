import { describe, it, expect } from 'vitest';
import { tierXp, bonusMultiplierToTier } from './utils';

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

describe('bonusMultiplierToTier', () => {
  it('maps the multipliers the main-process rpg engine returns', () => {
    expect(bonusMultiplierToTier(1.0)).toBe('normal');
    expect(bonusMultiplierToTier(1.5)).toBe('good');
    expect(bonusMultiplierToTier(2.0)).toBe('critical');
    expect(bonusMultiplierToTier(3.0)).toBe('legendary');
  });
  it('rounds down to the nearest tier', () => {
    expect(bonusMultiplierToTier(1.4)).toBe('normal');
    expect(bonusMultiplierToTier(1.9)).toBe('good');
    expect(bonusMultiplierToTier(2.5)).toBe('critical');
  });
});

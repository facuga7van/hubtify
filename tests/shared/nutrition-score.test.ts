import { describe, it, expect } from 'vitest';
import { scoreNutritionDay } from '../../shared/meal-utils';

const CUT = 500;      // deficit goal
const BULK = -500;    // surplus goal
const MAINTAIN = 0;

describe('scoreNutritionDay — surplus goal (task 19)', () => {
  it('pays MORE for hitting the target than for missing it', () => {
    const hit = scoreNutritionDay(3500, 3500, BULK);
    const missedBadly = scoreNutritionDay(1500, 3500, BULK);

    // The reported inversion: 3500/3500 used to give 15 XP and +10 HP while
    // 1500/3500 (54 % under) gave 20 XP — failing paid better than succeeding.
    expect(hit.xpPrecision + hit.xpBonus).toBeGreaterThan(missedBadly.xpPrecision + missedBadly.xpBonus);
    expect(hit.hpChange).toBe(10);
    expect(missedBadly.hpChange).toBe(-20);
    expect(hit.compliant).toBe(true);
    expect(missedBadly.compliant).toBe(false);
  });

  it('eating above the target is compliant, eating below is not', () => {
    expect(scoreNutritionDay(3600, 3500, BULK).compliant).toBe(true);
    expect(scoreNutritionDay(3400, 3500, BULK).compliant).toBe(false);
  });

  it('ramps the penalty with the size of the shortfall', () => {
    expect(scoreNutritionDay(3200, 3500, BULK).hpChange).toBe(-5);   //  ~8.6 % under
    expect(scoreNutritionDay(2900, 3500, BULK).hpChange).toBe(-10);  // ~17 % under
    expect(scoreNutritionDay(2000, 3500, BULK).hpChange).toBe(-20);  // ~43 % under
  });
});

describe('scoreNutritionDay — deficit goal preserves the historical numbers', () => {
  it('matches the old precision/bonus ladder exactly', () => {
    // target 2000, deficitPct = (target - consumed) / target
    expect(scoreNutritionDay(1950, 2000, CUT)).toMatchObject({ xpPrecision: 30, xpBonus: 15, hpChange: 10 }); // 2.5 %
    expect(scoreNutritionDay(1800, 2000, CUT)).toMatchObject({ xpPrecision: 30, xpBonus: 10, hpChange: 10 }); // 10 %
    expect(scoreNutritionDay(1500, 2000, CUT)).toMatchObject({ xpPrecision: 30, xpBonus: 5, hpChange: 10 });  // 25 %
    expect(scoreNutritionDay(1200, 2000, CUT)).toMatchObject({ xpPrecision: 20, xpBonus: 0, hpChange: 10 });  // 40 % — undereating
    expect(scoreNutritionDay(2100, 2000, CUT)).toMatchObject({ xpPrecision: 15, xpBonus: 0, hpChange: -5 });  // 5 % over
    expect(scoreNutritionDay(2300, 2000, CUT)).toMatchObject({ xpPrecision: 8, xpBonus: 0, hpChange: -10 });  // 15 % over
    expect(scoreNutritionDay(3000, 2000, CUT)).toMatchObject({ xpPrecision: 2, xpBonus: 0, hpChange: -20 });  // 50 % over
  });
});

describe('scoreNutritionDay — maintenance keeps its HP ladder', () => {
  it('uses the same 10/20/30 % breakpoints as before', () => {
    expect(scoreNutritionDay(2000, 2000, MAINTAIN).hpChange).toBe(10);
    expect(scoreNutritionDay(2150, 2000, MAINTAIN).hpChange).toBe(10);   //  7.5 %
    expect(scoreNutritionDay(2350, 2000, MAINTAIN).hpChange).toBe(-5);   // 17.5 %
    expect(scoreNutritionDay(2550, 2000, MAINTAIN).hpChange).toBe(-10);  // 27.5 %
    expect(scoreNutritionDay(3000, 2000, MAINTAIN).hpChange).toBe(-20);  // 50 %
    // Symmetric on the low side.
    expect(scoreNutritionDay(1650, 2000, MAINTAIN).hpChange).toBe(-5);
  });
});

describe('scoreNutritionDay — the +HP band and the "green" band are one and the same', () => {
  it('compliant implies +10 HP and top precision for every goal', () => {
    for (const [goal, consumed, target] of [
      [CUT, 1900, 2000], [BULK, 3600, 3500], [MAINTAIN, 2050, 2000],
    ] as Array<[number, number, number]>) {
      const s = scoreNutritionDay(consumed, target, goal);
      expect(s.compliant).toBe(true);
      expect(s.hpChange).toBe(10);
      expect(s.xpPrecision).toBe(30);
      expect(s.missPct).toBe(0);
    }
  });

  it('degenerate inputs never award HP', () => {
    expect(scoreNutritionDay(0, 2000, CUT)).toMatchObject({ xpPrecision: 0, xpBonus: 0, hpChange: 0 });
    expect(scoreNutritionDay(1500, 0, CUT)).toMatchObject({ xpPrecision: 5, xpBonus: 0, hpChange: 0 });
    expect(scoreNutritionDay(NaN, 2000, CUT).hpChange).toBe(0);
  });
});

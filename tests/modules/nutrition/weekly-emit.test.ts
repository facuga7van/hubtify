import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sealWeek } from '@modules/nutrition/weekly-api';

const report = {
  weekStart: '2026-08-31', weekEnd: '2026-09-06', daysClosed: 7, daysCompliant: 7,
  avgConsumed: 1800, avgTarget: 1900, weightStart: 80.4, weightEnd: 80.0,
  daysSteps: 5, daysGym: 3, streakEnd: 12, xpTotal: 50, sealed: true, closedAt: 'x',
};

beforeEach(() => {
  (globalThis as any).window = { api: {} };
});

describe('sealWeek', () => {
  it('emite WEEK_SUMMARY con el weekStart del report, nunca uno derivado', async () => {
    const processRpgEvent = vi.fn().mockResolvedValue({ xpGained: 50 });
    (window as any).api = {
      nutritionCloseWeek: vi.fn().mockResolvedValue({ success: true, report }),
      processRpgEvent,
    };

    await sealWeek('2026-08-31');

    expect(processRpgEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'WEEK_SUMMARY',
      moduleId: 'nutrition',
      payload: expect.objectContaining({ xp: 50, hp: 0, weekStart: '2026-08-31' }),
    }));
  });

  it('devuelve el XP que PAGÓ el motor, no el que declaró el sello', async () => {
    (window as any).api = {
      nutritionCloseWeek: vi.fn().mockResolvedValue({ success: true, report }),
      processRpgEvent: vi.fn().mockResolvedValue({ xpGained: 0 }),   // el guard ya pagó
    };
    const res = await sealWeek('2026-08-31');
    expect(res!.xpGained).toBe(0);         // NO 50
    expect(res!.report.xpTotal).toBe(50);  // el declarado sigue disponible
  });

  it('no emite nada si el sellado falló', async () => {
    const processRpgEvent = vi.fn();
    (window as any).api = {
      nutritionCloseWeek: vi.fn().mockResolvedValue({ success: false, error: 'Waiting for weigh-in' }),
      processRpgEvent,
    };
    expect(await sealWeek('2026-08-31')).toBeNull();
    expect(processRpgEvent).not.toHaveBeenCalled();
  });
});

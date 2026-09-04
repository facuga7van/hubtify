import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sealWeek } from '@modules/nutrition/weekly-api';

// El sello (`report.weekStart`) y el argumento de `sealWeek` difieren A PROPÓSITO:
// simula al renderer derivando el lunes equivocado (01:00 del lunes, reloj de
// pared local) contra la fila que en realidad quedó sellada. Si el código usa
// el argumento en vez de `report.weekStart`, este test debe fallar.
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

    await sealWeek('2026-09-07');

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
    expect(res).toEqual(expect.objectContaining({ ok: true, xpGained: 0, rpgFailed: false }));
    if (res.ok) expect(res.report.xpTotal).toBe(50);  // el declarado sigue disponible
  });

  it('no emite nada si el sellado falló, y devuelve por qué', async () => {
    const processRpgEvent = vi.fn();
    (window as any).api = {
      nutritionCloseWeek: vi.fn().mockResolvedValue({ success: false, error: 'Waiting for weigh-in' }),
      processRpgEvent,
    };
    const res = await sealWeek('2026-08-31');
    expect(res).toEqual({ ok: false, error: 'Waiting for weigh-in' });
    expect(processRpgEvent).not.toHaveBeenCalled();
  });

  it('si processRpgEvent tira, el sello (ya irreversible) no se pierde', async () => {
    (window as any).api = {
      nutritionCloseWeek: vi.fn().mockResolvedValue({ success: true, report }),
      processRpgEvent: vi.fn().mockRejectedValue(new Error('IPC caído')),
    };

    const res = await sealWeek('2026-08-31');

    expect(res).toEqual(expect.objectContaining({ ok: true, rpgFailed: true, xpGained: 0 }));
    if (res.ok) expect(res.report).toEqual(report);
  });

  it('una razón de fallo distinta también sobrevive', async () => {
    (window as any).api = {
      nutritionCloseWeek: vi.fn().mockResolvedValue({ success: false, error: 'Already closed' }),
      processRpgEvent: vi.fn(),
    };
    expect(await sealWeek('2026-08-31')).toEqual({ ok: false, error: 'Already closed' });
  });
});

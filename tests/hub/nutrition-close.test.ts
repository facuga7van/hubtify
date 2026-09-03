import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  parseSteps,
  nutritionCloseApiReady,
  isNutritionDayClosed,
  readDayMetrics,
  closeNutritionDay,
} from '../../src/hub/codex/nutritionClose';

/**
 * El riesgo de unificar los dos cierres es el XP: ni duplicarlo ni quitarlo.
 * Estos tests fijan el contrato del eslabón que el Códice encadena.
 */

const originalWindow = (globalThis as { window?: unknown }).window;

interface Calls {
  saveDailyMetrics: unknown[];
  closeDay: unknown[];
  rpg: unknown[];
}

function installApi(over: Record<string, unknown> = {}): Calls {
  const calls: Calls = { saveDailyMetrics: [], closeDay: [], rpg: [] };
  const api: Record<string, unknown> = {
    nutritionSaveDailyMetrics: (m: unknown) => { calls.saveDailyMetrics.push(m); return Promise.resolve(); },
    nutritionCloseDay: (d: unknown) => {
      calls.closeDay.push(d);
      return Promise.resolve({ success: true, breakdown: { xpTotal: 42, hpChange: 10 } });
    },
    nutritionIsDayClosed: () => Promise.resolve(false),
    nutritionGetDailyMetrics: () => Promise.resolve({ steps: 8000, gym: 1 }),
    processRpgEvent: (e: unknown) => { calls.rpg.push(e); return Promise.resolve({ xpGained: 42 }); },
    ...over,
  };
  (globalThis as { window?: unknown }).window = { api };
  return calls;
}

beforeEach(() => { installApi(); });
afterEach(() => { (globalThis as { window?: unknown }).window = originalWindow; });

describe('parseSteps', () => {
  it('vacío es sin dato, no cero', () => {
    expect(parseSteps('')).toBeNull();
    expect(parseSteps('   ')).toBeNull();
  });
  it('cero es un dato legítimo', () => {
    expect(parseSteps('0')).toBe(0);
  });
  it('lee enteros', () => {
    expect(parseSteps('8420')).toBe(8420);
    expect(parseSteps(' 8420 ')).toBe(8420);
  });
  it('un negativo o una letra suelta no hacen fallar el cierre entero', () => {
    expect(parseSteps('-5')).toBeNull();
    expect(parseSteps('abc')).toBeNull();
  });
});

describe('nutritionCloseApiReady', () => {
  it('es falso contra un main viejo que no expone los canales', () => {
    installApi({ nutritionCloseDay: undefined });
    expect(nutritionCloseApiReady()).toBe(false);
  });
  it('es verdadero con los tres canales', () => {
    expect(nutritionCloseApiReady()).toBe(true);
  });
});

describe('isNutritionDayClosed', () => {
  it('un error del backend no bloquea el ritual', async () => {
    installApi({ nutritionIsDayClosed: () => Promise.reject(new Error('boom')) });
    expect(await isNutritionDayClosed('2026-09-03')).toBe(false);
  });
  it('traduce lo que devuelve el handler a booleano', async () => {
    installApi({ nutritionIsDayClosed: () => Promise.resolve({ xpTotal: 30 }) });
    expect(await isNutritionDayClosed('2026-09-03')).toBe(true);
  });
});

describe('readDayMetrics', () => {
  it('precarga pasos y gimnasio', async () => {
    expect(await readDayMetrics('2026-09-03')).toEqual({ steps: '8000', gym: true });
  });
  it('sin fila devuelve el formulario vacío', async () => {
    installApi({ nutritionGetDailyMetrics: () => Promise.resolve(null) });
    expect(await readDayMetrics('2026-09-03')).toEqual({ steps: '', gym: false });
  });
});

describe('closeNutritionDay', () => {
  it('guarda métricas, cierra y paga el XP UNA vez', async () => {
    const calls = installApi();
    const result = await closeNutritionDay('2026-09-03', '8420', true);

    expect(result).toEqual({ xpTotal: 42, hpChange: 10 });
    expect(calls.saveDailyMetrics).toEqual([{ date: '2026-09-03', steps: 8420, gym: true }]);
    expect(calls.closeDay).toEqual(['2026-09-03']);
    expect(calls.rpg).toHaveLength(1);
    expect(calls.rpg[0]).toMatchObject({
      type: 'DAY_SUMMARY',
      moduleId: 'nutrition',
      payload: { xp: 42, hp: 10, date: '2026-09-03' },
    });
  });

  // Este es el guard que hace seguro encadenar el cierre al sello.
  it('un día ya cerrado no vuelve a pagar', async () => {
    const calls = installApi({
      nutritionCloseDay: () => Promise.resolve({ success: false, alreadyClosed: true }),
    });
    expect(await closeNutritionDay('2026-09-03', '', false)).toBeNull();
    expect(calls.rpg).toHaveLength(0);
  });

  it('un cierre sin desglose tampoco paga', async () => {
    const calls = installApi({ nutritionCloseDay: () => Promise.resolve({ success: true }) });
    expect(await closeNutritionDay('2026-09-03', '', false)).toBeNull();
    expect(calls.rpg).toHaveLength(0);
  });

  it('manda steps null cuando el campo quedó vacío', async () => {
    const calls = installApi();
    await closeNutritionDay('2026-09-03', '', false);
    expect(calls.saveDailyMetrics).toEqual([{ date: '2026-09-03', steps: null, gym: false }]);
  });
});

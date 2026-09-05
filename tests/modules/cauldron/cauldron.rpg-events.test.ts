/**
 * Logros v2: los dos eventos de registro del Caldero (xp 0). `full_circle`
 * escucha CAULDRON_LAP_COMPLETED y `one_more_log` escucha POMODORO_EXTENDED.
 * Ninguno paga ni cuenta como evento del día — lo que se fija acá es que se
 * emitan cuando corresponde, con el payload que el matcher espera, y nunca dos
 * veces por la misma vuelta.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { CauldronSessionEndResult } from '../../../shared/types';
import { NON_MEANINGFUL_EVENT_TYPES } from '../../../shared/rpg-engine';

const processRpgEvent = vi.fn(async () => ({ xpGained: 0 }));
(globalThis as unknown as { window: unknown }).window = { api: { processRpgEvent } };

const { isLapClose, emitLapCompleted, emitPomodoroExtended } = await import('@modules/cauldron/rpg-events');

const lapEnd = (over: Partial<CauldronSessionEndResult> = {}): CauldronSessionEndResult => ({
  sessionType: 'long_break', completed: true, nextType: 'work', cycleComplete: true, taskId: 'task-1', ...over,
});

beforeEach(() => { processRpgEvent.mockClear(); });

describe('isLapClose', () => {
  it('una vuelta cierra cuando el descanso largo termina completo', () => {
    expect(isLapClose(lapEnd())).toBe(true);
  });
  it('un segmento común, o uno cortado, no cierra nada', () => {
    expect(isLapClose(lapEnd({ sessionType: 'work', cycleComplete: false }))).toBe(false);
    expect(isLapClose(lapEnd({ completed: false }))).toBe(false);
  });
  // El backend marca `cycleComplete` mirando solo `sessionType`, así que la
  // prórroga del descanso largo llega con el flag prendido: sería la misma vuelta
  // registrada dos veces.
  it('la prórroga del descanso largo NO cierra la vuelta otra vez', () => {
    expect(isLapClose(lapEnd({ isExtension: true }))).toBe(false);
  });
});

describe('emitLapCompleted', () => {
  it('emite CAULDRON_LAP_COMPLETED con xp 0 y la misión vinculada', async () => {
    await emitLapCompleted(lapEnd());
    expect(processRpgEvent).toHaveBeenCalledTimes(1);
    expect(processRpgEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAULDRON_LAP_COMPLETED',
      moduleId: 'cauldron',
      payload: { xp: 0, hp: 0, taskId: 'task-1' },
    }));
  });
  it('no emite nada si la vuelta no cerró', async () => {
    await emitLapCompleted(lapEnd({ sessionType: 'work', cycleComplete: false }));
    await emitLapCompleted(lapEnd({ isExtension: true }));
    expect(processRpgEvent).not.toHaveBeenCalled();
  });
  it('nunca tira: un registro caído no rompe el timer', async () => {
    processRpgEvent.mockRejectedValueOnce(new Error('engine down'));
    await expect(emitLapCompleted(lapEnd())).resolves.toBeUndefined();
  });
});

describe('emitPomodoroExtended', () => {
  it('emite POMODORO_EXTENDED con xp 0, el tipo de segmento y los minutos', async () => {
    await emitPomodoroExtended('work', 5, 'task-1');
    expect(processRpgEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'POMODORO_EXTENDED',
      moduleId: 'cauldron',
      payload: { xp: 0, hp: 0, sessionType: 'work', minutes: 5, taskId: 'task-1' },
    }));
  });
  it('sin misión viaja taskId null, nunca undefined', async () => {
    await emitPomodoroExtended('break', 5);
    const event = processRpgEvent.mock.calls[0][0] as unknown as { payload: Record<string, unknown> };
    expect(event.payload.taskId).toBeNull();
  });
  it('nunca tira', async () => {
    processRpgEvent.mockRejectedValueOnce(new Error('engine down'));
    await expect(emitPomodoroExtended('work', 5)).resolves.toBeUndefined();
  });
});

// Si alguno de los dos faltara acá, el sello y el Cronista se autoalimentarían
// con registros que no pagan nada.
it('los dos eventos son de registro puro para el sello y el Cronista', () => {
  expect(NON_MEANINGFUL_EVENT_TYPES).toContain('CAULDRON_LAP_COMPLETED');
  expect(NON_MEANINGFUL_EVENT_TYPES).toContain('POMODORO_EXTENDED');
});

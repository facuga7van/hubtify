import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * En modo invitado no hay sesión de Firebase, y `estimateNutrition` era la
 * ÚNICA llamada a `httpsCallable` de todo `src/`: sin manejarla, el invitado
 * veía un `Error('Login required…')` crudo en la acción principal de Nutrify.
 *
 * El servicio no puede decidir la UI (los componentes de nutrición no son de
 * esta tanda), pero sí tiene que dejar el error IDENTIFICABLE para que el
 * llamador distinga «no hay sesión» (→ modo manual, `nutrify.aiUnavailableShort`)
 * de «falló la red» (→ reintentar).
 */

const currentUser = { value: null as unknown };
const callable = vi.fn();

vi.mock('../../../src/shared/firebase', () => ({
  getActiveAuth: () => ({ get currentUser() { return currentUser.value; } }),
  getActiveFunctions: () => ({}),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: () => callable,
}));

let mod: typeof import('../../../src/modules/nutrition/estimate-service');

beforeEach(async () => {
  currentUser.value = null;
  callable.mockReset();
  mod = await import('../../../src/modules/nutrition/estimate-service');
});

describe('estimateNutrition sin sesión (modo invitado)', () => {
  it('no pega a la red', async () => {
    await expect(mod.estimateNutrition('milanesa con papas')).rejects.toBeInstanceOf(Error);
    expect(callable).not.toHaveBeenCalled();
  });

  it('el error se puede distinguir de un fallo de red', async () => {
    const err = await mod.estimateNutrition('milanesa').catch((e: unknown) => e);
    expect(mod.isNoSessionError(err)).toBe(true);
    expect((err as { code?: string }).code).toBe(mod.NO_SESSION_ERROR_CODE);
  });

  it('un fallo de red NO se confunde con falta de sesión', async () => {
    currentUser.value = { uid: 'u1' };
    const netErr = Object.assign(new Error('network'), { code: 'unavailable' });
    callable.mockRejectedValue(netErr);
    const err = await mod.estimateNutrition('milanesa').catch((e: unknown) => e);
    expect(mod.isNoSessionError(err)).toBe(false);
  });

  it('un error cualquiera (null, string) tampoco', () => {
    expect(mod.isNoSessionError(null)).toBe(false);
    expect(mod.isNoSessionError('Login required to estimate nutrition')).toBe(false);
    expect(mod.isNoSessionError(new Error('boom'))).toBe(false);
  });

  it('con sesión sigue llamando a la función como siempre', async () => {
    currentUser.value = { uid: 'u1' };
    callable.mockResolvedValue({ data: { calories: 500, items: [{ name: 'milanesa', calories: 500 }] } });
    const result = await mod.estimateNutrition('milanesa');
    expect(callable).toHaveBeenCalledWith({ description: 'milanesa' });
    expect(result.calories).toBe(500);
  });
});

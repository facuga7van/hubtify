import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { markVirtualDevice, isVirtualDevice } from '../../src/shared/platform-detect';

/**
 * `isVirtualDevice()` decide si el Caldero se dibuja quieto. Arranca en `false`
 * a propósito: `Device.getInfo()` tiene 2 s de techo en `install-api.ts`, y si
 * el bridge no contesta el default tiene que ser «teléfono de verdad, con todos
 * los efectos», nunca al revés.
 */
describe('isVirtualDevice', () => {
  afterEach(() => markVirtualDevice(false));

  test('por defecto es false — un bridge mudo no degrada la app', () => {
    expect(isVirtualDevice()).toBe(false);
  });

  test('markVirtualDevice(true) lo enciende', () => {
    markVirtualDevice(true);
    expect(isVirtualDevice()).toBe(true);
  });

  test('solo `true` cuenta como virtual', () => {
    markVirtualDevice(false);
    expect(isVirtualDevice()).toBe(false);
  });
});

/**
 * El CSS no puede leer un módulo de TS: el vapor lleva `filter: blur(5px)` y
 * las brasas animan `box-shadow`, y eso se apaga con `[data-lowfx]` en el
 * `<html>`. Si el atributo no viaja, la mitad del arreglo no existe.
 */
describe('marca [data-lowfx] en el documento', () => {
  const el = { attrs: new Map<string, string>() };

  beforeEach(() => {
    el.attrs.clear();
    vi.stubGlobal('document', {
      documentElement: {
        setAttribute: (k: string, v: string) => el.attrs.set(k, v),
        removeAttribute: (k: string) => el.attrs.delete(k),
      },
    });
  });
  afterEach(() => { markVirtualDevice(false); vi.unstubAllGlobals(); });

  test('en virtual pone data-lowfx', () => {
    markVirtualDevice(true);
    expect(el.attrs.get('data-lowfx')).toBe('true');
  });

  test('en un teléfono real lo saca', () => {
    markVirtualDevice(true);
    markVirtualDevice(false);
    expect(el.attrs.has('data-lowfx')).toBe(false);
  });
});

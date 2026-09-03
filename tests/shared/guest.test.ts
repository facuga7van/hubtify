import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Modo invitado: el piso de C1 de la rúbrica de user journey. La app arranca
 * usable sin cuenta y ofrece vincular después.
 *
 * Lo que se prueba acá es el CONTRATO del flag, no la UI:
 *  - es un flag propio en localStorage, NO un `CachedAccount` falso (fabricar
 *    uno haría que `logout()` empuje sync contra un uid inventado);
 *  - salir del modo invitado NO puede tocar la base local;
 *  - la condición que Layout usa para decidir si borra al vincular es
 *    inspeccionable desde un test (ver `guest-link.test.ts`).
 */

type Api = { syncClearUserData: () => Promise<unknown>; syncSetCurrentUser: (uid: string) => Promise<unknown> };

let guest: typeof import('../../src/shared/guest');
let api: Api;

const originalWindow = (globalThis as { window?: unknown }).window;
const originalStorage = (globalThis as { localStorage?: unknown }).localStorage;

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
    _map: map,
  };
}

let storage: ReturnType<typeof fakeStorage>;

beforeEach(async () => {
  storage = fakeStorage();
  (globalThis as { localStorage?: unknown }).localStorage = storage;
  (globalThis as { window?: unknown }).window = new EventTarget();
  api = {
    syncClearUserData: vi.fn(async () => ({ success: true })),
    syncSetCurrentUser: vi.fn(async () => undefined),
  };
  (globalThis.window as unknown as { api: Api }).api = api;
  vi.resetModules();
  guest = await import('../../src/shared/guest');
});

afterEach(() => {
  (globalThis as { window?: unknown }).window = originalWindow;
  (globalThis as { localStorage?: unknown }).localStorage = originalStorage;
});

describe('guest flag', () => {
  it('arranca apagado', () => {
    expect(guest.isGuestMode()).toBe(false);
  });

  it('entrar lo prende y lo persiste bajo su propia clave', () => {
    guest.enterGuestMode();
    expect(guest.isGuestMode()).toBe(true);
    expect(storage.getItem(guest.GUEST_STORAGE_KEY)).toBe('true');
  });

  it('no fabrica una cuenta cacheada', () => {
    guest.enterGuestMode();
    // `accountStore` guarda en 'hubtify_accounts' y exige uid+email+firebaseAppName.
    expect(storage.getItem('hubtify_accounts')).toBeNull();
    expect([...storage._map.keys()]).toEqual([guest.GUEST_STORAGE_KEY]);
  });

  it('salir lo apaga', () => {
    guest.enterGuestMode();
    guest.leaveGuestMode();
    expect(guest.isGuestMode()).toBe(false);
    expect(storage.getItem(guest.GUEST_STORAGE_KEY)).toBeNull();
  });

  it('salir NUNCA borra la base local', async () => {
    guest.enterGuestMode();
    guest.leaveGuestMode();
    // El punto entero del modo invitado: los datos son los que se van a
    // fusionar con la cuenta. `logout()` (useAuth.ts:183) llama a
    // syncClearUserData; salir del modo invitado no puede pasar por ahí.
    expect(api.syncClearUserData).not.toHaveBeenCalled();
    expect(api.syncSetCurrentUser).not.toHaveBeenCalled();
  });

  it('avisa el cambio por un evento del window', () => {
    const seen: string[] = [];
    (globalThis.window as EventTarget).addEventListener(
      guest.GUEST_CHANGED_EVENT,
      () => seen.push(guest.isGuestMode() ? 'on' : 'off'),
    );
    guest.enterGuestMode();
    guest.leaveGuestMode();
    expect(seen).toEqual(['on', 'off']);
  });

  it('no explota sin localStorage', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(() => guest.enterGuestMode()).not.toThrow();
    expect(guest.isGuestMode()).toBe(false);
  });

  it('un valor basura no cuenta como invitado', () => {
    storage.setItem(guest.GUEST_STORAGE_KEY, 'sí');
    expect(guest.isGuestMode()).toBe(false);
  });
});

describe('clearsLocalDataOnLink — espejo de Layout.retrySyncPull', () => {
  it('sin last_uid (el caso del invitado puro) no borra nada', () => {
    expect(guest.clearsLocalDataOnLink(null, 'uid-nuevo')).toBe(false);
  });

  it('con el MISMO uid tampoco', () => {
    expect(guest.clearsLocalDataOnLink('uid-1', 'uid-1')).toBe(false);
  });

  it('con OTRO uid sí borra — el caso borde documentado', () => {
    expect(guest.clearsLocalDataOnLink('uid-viejo', 'uid-nuevo')).toBe(true);
  });
});

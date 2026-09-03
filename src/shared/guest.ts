import { useEffect, useState } from 'react';

/**
 * Modo invitado — la app usable sin cuenta.
 *
 * POR QUÉ UN FLAG PROPIO Y NO UNA CUENTA FALSA
 * `accountStore.ts` exige `uid` + `email` + `firebaseAppName`, los tres de
 * Firebase. Fabricar un `CachedAccount` de mentira haría que `logout()`
 * (`hooks/useAuth.ts:159-229`) intente un `syncPush` contra un uid inventado y
 * después borre la base local. El modo invitado no puede vivir dentro de esa
 * máquina: es un flag aparte, y nada más que un flag.
 *
 * POR QUÉ ES SEGURO
 * La base local es UNA sola y NO está indexada por uid. `sync:setCurrentUser`
 * guarda `last_uid` en `app_state` (`shared-logic/modules/sync.ipc.ts:1007-1017`)
 * sólo como centinela de «¿cambió la cuenta desde la última vez?»; ningún otro
 * handler recibe uid. El invitado escribe en la misma base de siempre, y cuando
 * después se registra o inicia sesión, `syncPull` FUSIONA sobre lo que ya hay
 * (`sync.ts:283-423`, todo pasa por `syncMerge*Data`) en vez de reemplazarlo.
 * Ver `tests/shared/guest-link.test.ts`.
 */

export const GUEST_STORAGE_KEY = 'hubtify_guest';
export const GUEST_CHANGED_EVENT = 'guest:changed';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): StorageLike | null {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
  } catch {
    // Storage bloqueado por política del navegador / host sin DOM.
    return null;
  }
}

function announce(): void {
  try {
    (globalThis as { window?: EventTarget }).window?.dispatchEvent(new Event(GUEST_CHANGED_EVENT));
  } catch { /* host sin DOM (tests de node) */ }
}

/** ¿Está andando la app sin cuenta? */
export function isGuestMode(): boolean {
  try {
    return storage()?.getItem(GUEST_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Entra al modo invitado. No toca Firebase ni la base: sólo prende el flag. */
export function enterGuestMode(): void {
  try { storage()?.setItem(GUEST_STORAGE_KEY, 'true'); } catch { /* sin storage */ }
  announce();
}

/**
 * Sale del modo invitado — se llama al vincular una cuenta.
 *
 * NUNCA pasa por `logout()`: eso llama a `syncClearUserData()`
 * (`hooks/useAuth.ts:183`) y borraría justo la base que el invitado quiere
 * conservar. Apagar el flag es TODO lo que hay que hacer.
 */
export function leaveGuestMode(): void {
  try { storage()?.removeItem(GUEST_STORAGE_KEY); } catch { /* sin storage */ }
  announce();
}

/**
 * Espejo de la guarda de `Layout.retrySyncPull` (`Layout.tsx:531-533`), que es
 * lo único capaz de borrar la base al iniciar sesión.
 *
 * En modo invitado puro `last_uid` nunca se escribió → devuelve `false` → los
 * datos del invitado sobreviven al vincular. El caso borde en el que devuelve
 * `true` (el dispositivo ya tuvo OTRA cuenta antes) está documentado en
 * `tests/shared/guest-link.test.ts`.
 */
export function clearsLocalDataOnLink(lastUid: string | null, nextUid: string): boolean {
  return !!lastUid && lastUid !== nextUid;
}

/** El flag, reactivo. Se re-lee ante `guest:changed` y ante `account:switched`. */
export function useGuestMode(): boolean {
  const [guest, setGuest] = useState(isGuestMode);
  useEffect(() => {
    const handler = () => setGuest(isGuestMode());
    window.addEventListener(GUEST_CHANGED_EVENT, handler);
    window.addEventListener('account:switched', handler);
    return () => {
      window.removeEventListener(GUEST_CHANGED_EVENT, handler);
      window.removeEventListener('account:switched', handler);
    };
  }, []);
  return guest;
}

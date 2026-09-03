/**
 * ¿Estamos corriendo como app Android (Capacitor)?
 *
 * `__HUBTIFY_PLATFORM__` lo fija el build (`vite.mobile.config.ts` → 'android',
 * `vite.renderer.config.ts` → 'desktop'). Cuando el bridge nativo de Capacitor
 * está presente (`window.Capacitor`), su `isNativePlatform()` confirma que no
 * es el mismo bundle abierto en un navegador de escritorio.
 */
export function isNativeMobile(): boolean {
  if (typeof __HUBTIFY_PLATFORM__ === 'undefined' || __HUBTIFY_PLATFORM__ !== 'android') {
    return false;
  }
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (cap?.isNativePlatform) return cap.isNativePlatform() === true;
  return true;
}

/**
 * ¿Está el bridge nativo de Capacitor (`window.Capacitor`)? Distingue la app
 * Android real del mismo bundle 'android' corriendo en el arnés browser-mobile
 * de vitest, donde no hay plugins que llamar.
 */
export function hasCapacitorBridge(): boolean {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

/**
 * ¿Estamos en un dispositivo VIRTUAL (el emulador de Android)?
 *
 * Lo contesta `Device.getInfo().isVirtual`, que `readOsInfo()` ya pide al
 * arrancar; acá solo se guarda el resultado para poder consultarlo sincrónico
 * desde un render. Arranca en `false`: si el bridge no contesta (hay un timeout
 * de 2 s en `install-api.ts`) el default es un teléfono de verdad, con todos
 * los efectos.
 *
 * Para qué: el emulador rasteriza por software (SwiftShader dentro del proceso
 * qemu del host) y las animaciones continuas del Caldero lo matan — el proceso
 * entero, sin volcado ni log. Es un problema EXCLUSIVO del emulador: en un
 * teléfono con GPU real no se cae. Ver
 * `docs/superpowers/plans/2026-09-03-cauldron-start-crash.md`.
 */
let virtualDevice = false;

export function markVirtualDevice(value: boolean): void {
  virtualDevice = value;
  // El CSS también tiene que enterarse: el vapor lleva `filter: blur(5px)` y
  // las brasas animan `box-shadow`, y eso no se puede apagar desde el JSX.
  if (typeof document !== 'undefined') {
    if (value) document.documentElement.setAttribute('data-lowfx', 'true');
    else document.documentElement.removeAttribute('data-lowfx');
  }
}

export function isVirtualDevice(): boolean {
  return virtualDevice;
}

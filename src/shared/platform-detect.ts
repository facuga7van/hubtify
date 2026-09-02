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

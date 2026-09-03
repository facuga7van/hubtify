import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function readMatch(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(QUERY).matches;
}

/**
 * ¿El sistema pidió menos movimiento?
 *
 * Las animaciones de `shared/animations/*` ya lo consultan por llamada, y el CSS
 * lo respeta con `@media (prefers-reduced-motion: reduce)`. Lo que faltaba era
 * poder apagar movimiento que vive en el JSX — concretamente los `<animate>`
 * SMIL del caldero, que ni el CSS ni GSAP pueden tocar.
 *
 * Se suscribe al cambio en vivo: el ajuste del SO puede cambiar con la app
 * abierta, y leerlo una sola vez al montar dejaba la pantalla moviéndose
 * después de que el usuario pidiera que parara.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(readMatch);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    // Puede haber cambiado entre el primer render y este efecto.
    setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

export default usePrefersReducedMotion;

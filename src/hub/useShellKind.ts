import { useEffect, useState } from 'react';
import { isNativeMobile } from '../shared/platform-detect';

/**
 * Por debajo de este ancho de viewport el shell de escritorio no entra ni con
 * el riel colapsado (spec §7). En Electron la ventana no baja de 700 px
 * (electron/main.ts minWidth), así que en escritorio nunca dispara; existe
 * para que la regla sea la de la spec y no un `if` suelto.
 */
export const MOBILE_SHELL_MAX_WIDTH = 600;

export type ShellKind = 'desktop' | 'mobile';

export function shellKindFor(nativeMobile: boolean, viewportWidth: number): ShellKind {
  return nativeMobile || viewportWidth < MOBILE_SHELL_MAX_WIDTH ? 'mobile' : 'desktop';
}

export function useShellKind(): ShellKind {
  const [kind, setKind] = useState<ShellKind>(() => shellKindFor(isNativeMobile(), window.innerWidth));

  useEffect(() => {
    // Android es mobile fijo: no hay resize que lo cambie.
    if (isNativeMobile()) return;
    const onResize = () => setKind(shellKindFor(false, window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return kind;
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import Sidebar from './Sidebar';
import NotificationBell from '../shared/components/NotificationBell';
import { MenuLines } from '../shared/components/icons';
import { useModalA11y } from '../shared/hooks/useModalA11y';
import { hasCapacitorBridge } from '../shared/platform-detect';
import type { ShellProps } from './shell-types';
import './styles/mobile-shell.css';

/** Título de la cabecera según la ruta: la misma clave que usa el menú. */
const SECTION_TITLES: Array<[prefix: string, key: string, fallback: string]> = [
  ['/quests', 'nav.questify', 'Questify'],
  ['/nutrition', 'nav.nutrify', 'Nutrify'],
  ['/finance', 'nav.coinify', 'Coinify'],
  ['/cauldron', 'nav.cauldron', 'Caldero'],
  ['/achievements', 'nav.achievements', 'Logros'],
  ['/rewards', 'nav.rewards', 'Recompensas'],
  ['/character', 'nav.character', 'Personaje'],
  ['/settings', 'nav.settings', 'Ajustes'],
];

export function sectionTitle(pathname: string): [key: string, fallback: string] {
  const hit = SECTION_TITLES.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix + '/'));
  return hit ? [hit[1], hit[2]] : ['hub.dashboard', 'Tabla del Aventurero'];
}

/**
 * Shell de Android (spec §7): cabecera de 56 px con hamburguesa, título de la
 * sección y campana; el contenido en `.main-content` (mismo nombre que en
 * escritorio: AnimatedOutlet y el level-up lo buscan por clase); y el
 * <Sidebar> real, expandido, dentro de un drawer con scrim.
 *
 * El drawer es un modal como cualquier otro (useModalA11y): Escape lo cierra,
 * el foco entra y vuelve a la hamburguesa. Es lo que hace que el botón atrás
 * de Android (native-shell.ts manda un Escape) lo cierre sin cableado propio.
 */
export default function MobileShell({ stats, onBellClick, onToggleInn, children }: ShellProps) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const scrimRef = useRef<HTMLDivElement>(null);
  const closeDrawer = useCallback(() => setOpen(false), []);
  const { dialogProps, containerRef } = useModalA11y<HTMLDivElement>({ onClose: closeDrawer, active: open });

  // --shell-top: 0 y las reglas [data-shell="mobile"] de layout.css.
  useEffect(() => {
    document.documentElement.dataset.shell = 'mobile';
    return () => { delete document.documentElement.dataset.shell; };
  }, []);

  // Navegar cierra el drawer: el destino ya se ve detrás.
  const prevPath = useRef(pathname);
  useEffect(() => {
    if (prevPath.current === pathname) return;
    prevPath.current = pathname;
    setOpen(false);
  }, [pathname]);

  // Botón atrás: solo con el bridge nativo. El literal de `define` va primero
  // y a propósito (igual que src/main.tsx): esbuild pliega
  // `"desktop" === 'android'` a false y Rollup ELIMINA el import() del bundle
  // de Electron; con solo isNativeMobile() el chunk (y @capacitor/app) se
  // emitiría igual. En el arnés browser-mobile (define android, sin bridge)
  // no se importa nada.
  useEffect(() => {
    if (typeof __HUBTIFY_PLATFORM__ === 'undefined' || __HUBTIFY_PLATFORM__ !== 'android') return;
    if (!hasCapacitorBridge()) return;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    import('../mobile/native-shell')
      .then(({ bindNativeShell }) => bindNativeShell())
      .then((off) => { if (cancelled) off(); else dispose = off; })
      .catch((err) => console.warn('[mobile] native shell:', err));
    return () => { cancelled = true; dispose?.(); };
  }, []);

  useGSAP(() => {
    const drawer = containerRef.current;
    const scrim = scrimRef.current;
    if (!drawer || !scrim) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const d = (s: number) => (reduced ? 0 : s);
    if (open) {
      gsap.set(scrim, { display: 'block' });
      gsap.fromTo(scrim, { opacity: 0 }, { opacity: 1, duration: d(0.2) });
      gsap.fromTo(drawer, { x: '-100%' }, { x: '0%', duration: d(0.28), ease: 'power2.out' });
    } else {
      gsap.to(scrim, { opacity: 0, duration: d(0.2), onComplete: () => { gsap.set(scrim, { display: 'none' }); } });
      gsap.to(drawer, { x: '-100%', duration: d(0.22), ease: 'power2.in' });
    }
  }, [open]);

  const [titleKey, titleFallback] = sectionTitle(pathname);

  return (
    <>
      <header className="mobile-header">
        <button
          type="button"
          className="mobile-header__btn"
          onClick={() => setOpen(true)}
          aria-label={t('hub.openMenu', 'Abrir menú')}
          aria-expanded={open}
          aria-controls="mobile-drawer"
        >
          <MenuLines width={22} height={22} />
        </button>
        {/* La página conserva su propio h1; la cabecera es chrome. */}
        <div className="mobile-header__title" role="heading" aria-level={2}>{t(titleKey, titleFallback)}</div>
        <div className="mobile-header__actions">
          <NotificationBell onClick={onBellClick} />
        </div>
      </header>

      <div className="app-layout app-layout--mobile">
        <main className="main-content">{children}</main>
      </div>

      <div ref={scrimRef} className="mobile-scrim" data-testid="mobile-scrim" onClick={closeDrawer} aria-hidden="true" />
      {/* Tocar un ítem del menú cierra el drawer. El efecto de `pathname` de
          arriba solo cubre el CAMBIO de ruta: tocar la sección en la que ya
          estás no navega y dejaba el menú abierto tapando la página. Solo los
          `.sidebar-nav-item`: la campana (`.notif-bell`) y el selector de
          cuenta del PlayerCard viven acá adentro y se usan con el menú abierto. */}
      <div
        {...dialogProps}
        id="mobile-drawer"
        className="mobile-drawer"
        aria-label={t('hub.mainNavigation', 'Navegación principal')}
        inert={!open}
        onClickCapture={(e) => {
          if ((e.target as HTMLElement).closest?.('.sidebar-nav-item')) closeDrawer();
        }}
      >
        <Sidebar stats={stats} collapsed={false} onBellClick={onBellClick} onToggleInn={onToggleInn} />
      </div>
    </>
  );
}

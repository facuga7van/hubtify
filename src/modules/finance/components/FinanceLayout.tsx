import { useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BookPage } from '../../../shared/components/codex/BookPage';
import { isNativeMobile } from '../../../shared/platform-detect';
import { DollarChip } from './shared/DollarChip';
import { CryptoChip } from './shared/CryptoChip';

/**
 * Tres pestañas, no seis.
 *
 * Seis no entraban en 390 px: la tira scrolleaba **696 px** sin ninguna señal
 * de que seguía, y el último rótulo quedaba cortado a mitad de palabra — la
 * tercera pantalla peor puntuada de toda la app en la auditoría de diseño.
 * Cuotas, Recurrentes, Tarjetas y Préstamos contestan todas la misma pregunta
 * y viven ahora en **Compromisos**; sus rutas viejas redirigen.
 */
const tabs = [
  { path: '/finance', label: 'coinify.dashboard', end: true },
  { path: '/finance/transactions', label: 'coinify.transactions' },
  { path: '/finance/commitments', label: 'coinify.commitments' },
];

export default function FinanceLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const navRef = useRef<HTMLElement>(null);

  // Seis pestañas no entran en 390 px y la tira scrollea: al llegar por link
  // directo a la sexta, la activa quedaba fuera de vista y la primera parecía
  // la elegida. `nearest` no mueve nada cuando ya se ve.
  useEffect(() => {
    // Solo el shell mobile: en escritorio angosto esto movería el scroll de
    // .main-content al cambiar de pestaña. `data-shell` lo pone MobileShell en
    // un efecto PADRE, que corre después del de este hijo: en el primer montaje
    // todavía no está, así que hay que preguntarle también a la plataforma.
    if (!isNativeMobile() && document.documentElement.dataset.shell !== 'mobile') return;
    const active = navRef.current?.querySelector<HTMLElement>('.coin-tab-link--active');
    active?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [location.pathname]);

  return (
    <BookPage
      eyebrow={t('coinify.bookEyebrow', '† TOMO IV †  —  DE REBUS AERIS')}
      title={t('coinify.title', 'Libro del Tesorero')}
      subtitle={t('coinify.bookSubtitle', 'Registro de dádivas, tributos, préstamos y del estado del cofre real')}
      headerExtra={(
        <div className="coin-book__actions">
          {/* Importar el resumen era el camino principal Y no tenía entrada:
              ruta sin pestaña, alcanzable solo por un modal dentro de
              Movimientos. Ahora es la acción primaria del Tomo, visible desde
              las tres pestañas. */}
          <NavLink to="/finance/import" className="rpg-button coin-import-cta">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M4 20h16" />
            </svg>
            {t('coinify.importCta', 'Importar resumen')}
          </NavLink>
          <DollarChip /><CryptoChip />
        </div>
      )}
      className="coin-book"
    >
      {/* Tab navigation. Scrolls horizontally rather than overflowing the page
          when the window is narrow. */}
      <div className="coin-tab-nav-wrap">
        <nav ref={navRef} className="coin-tab-nav" role="tablist">
          {tabs.map((tab) => {
            const isActive = 'end' in tab && tab.end
              ? location.pathname === tab.path
              : location.pathname === tab.path || location.pathname.startsWith(tab.path + '/');
            return (
              <NavLink
                key={tab.path}
                to={tab.path}
                end={'end' in tab ? tab.end : undefined}
                role="tab"
                aria-selected={isActive}
                className={({ isActive: active }) =>
                  `coin-tab-link ${active ? 'coin-tab-link--active' : ''}`
                }
              >
                {t(tab.label)}
              </NavLink>
            );
          })}
        </nav>
      </div>

      <div className="coin-layout__content">
        <Outlet />
      </div>
    </BookPage>
  );
}

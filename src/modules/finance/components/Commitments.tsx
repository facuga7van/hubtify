import { useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { isNativeMobile } from '../../../shared/platform-detect';

/**
 * **Compromisos** — la plata que ya está comprometida.
 *
 * Coinify tenía SEIS pestañas de primer nivel para alguien que usa dos. Cuatro
 * de ellas —Cuotas, Recurrentes, Tarjetas y Préstamos— contestan la misma
 * pregunta («¿qué debo hacia adelante?») y son justamente las que casi no se
 * tocan: en la base real, `finance_loans` y `finance_budgets` están VACÍAS.
 *
 * Acá se agrupan sin reescribir ni un componente: esta página solo aporta la
 * sub-navegación y monta los de siempre por `<Outlet />`. Las rutas viejas
 * siguen vivas como redirecciones, así que ningún link, ningún paso del tour y
 * ningún deep-link se rompe.
 *
 * Préstamos va último a propósito: nunca se usó, pero borrarlo sería tirar una
 * tabla con handlers y tests para ahorrar un renglón. Degradar, no eliminar.
 */
const sections = [
  { path: '/finance/commitments/installments', label: 'coinify.installments' },
  { path: '/finance/commitments/recurring', label: 'coinify.recurringLabel' },
  { path: '/finance/commitments/cards', label: 'coinify.creditCards' },
  { path: '/finance/commitments/loans', label: 'coinify.loans' },
];

export default function Commitments() {
  const { t } = useTranslation();
  const location = useLocation();
  const navRef = useRef<HTMLElement>(null);

  // Igual que la tira de arriba: al llegar por link directo, la sección activa
  // tiene que estar a la vista y no fuera del scroll horizontal.
  useEffect(() => {
    if (!isNativeMobile() && document.documentElement.dataset.shell !== 'mobile') return;
    navRef.current?.querySelector<HTMLElement>('.coin-subtab--active')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [location.pathname]);

  return (
    <div className="coin-commitments">
      <p className="coin-commitments__lede">
        {t('coinify.commitmentsLede', 'Todo lo que ya está comprometido hacia adelante: cuotas en curso, gastos fijos, resúmenes de tarjeta y préstamos.')}
      </p>
      <div className="coin-subtab-wrap">
        <nav ref={navRef} className="coin-subtab-nav" role="tablist"
          aria-label={t('coinify.commitments', 'Compromisos')}>
          {sections.map((section) => (
            <NavLink
              key={section.path}
              to={section.path}
              role="tab"
              aria-selected={location.pathname === section.path}
              className={({ isActive }) => `coin-subtab ${isActive ? 'coin-subtab--active' : ''}`}
            >
              {t(section.label)}
            </NavLink>
          ))}
        </nav>
      </div>
      <Outlet />
    </div>
  );
}

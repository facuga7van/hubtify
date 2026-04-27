import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BookPage } from '../../../shared/components/codex/BookPage';
import { DollarChip } from './shared/DollarChip';

const tabs = [
  { path: '/finance', label: 'coinify.dashboard', end: true },
  { path: '/finance/transactions', label: 'coinify.transactions' },
  { path: '/finance/installments', label: 'coinify.installments' },
  { path: '/finance/cards', label: 'coinify.creditCards' },
  { path: '/finance/loans', label: 'coinify.loans' },
];

export default function FinanceLayout() {
  const { t } = useTranslation();
  const location = useLocation();

  return (
    <BookPage
      eyebrow="† TOMO IV †  —  DE REBUS AERIS"
      title="Libro del Tesorero"
      subtitle="Registro de dádivas, tributos, préstamos y del estado del cofre real"
      headerExtra={<DollarChip />}
      className="coin-book"
    >
      {/* Tab navigation (hidden visually, using NavLinks for routing) */}
      <nav className="coin-tab-nav">
        {tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            end={'end' in tab ? tab.end : undefined}
            className={({ isActive }) =>
              `coin-tab-link ${isActive ? 'coin-tab-link--active' : ''}`
            }
          >
            {t(tab.label)}
          </NavLink>
        ))}
      </nav>

      <div className="coin-layout__content">
        <Outlet />
      </div>
    </BookPage>
  );
}

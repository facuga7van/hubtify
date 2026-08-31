import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BookPage } from '../../../shared/components/codex/BookPage';
import { DollarChip } from './shared/DollarChip';
import { CryptoChip } from './shared/CryptoChip';

const tabs = [
  { path: '/finance', label: 'coinify.dashboard', end: true },
  { path: '/finance/transactions', label: 'coinify.transactions' },
  { path: '/finance/installments', label: 'coinify.installments' },
  { path: '/finance/recurring', label: 'coinify.recurringLabel' },
  { path: '/finance/cards', label: 'coinify.creditCards' },
  { path: '/finance/loans', label: 'coinify.loans' },
];

export default function FinanceLayout() {
  const { t } = useTranslation();
  const location = useLocation();

  return (
    <BookPage
      eyebrow={t('coinify.bookEyebrow', '† TOMO IV †  —  DE REBUS AERIS')}
      title={t('coinify.title', 'Libro del Tesorero')}
      subtitle={t('coinify.bookSubtitle', 'Registro de dádivas, tributos, préstamos y del estado del cofre real')}
      headerExtra={<div style={{ display: 'flex', gap: 6 }}><DollarChip /><CryptoChip /></div>}
      className="coin-book"
    >
      {/* Tab navigation. Scrolls horizontally rather than overflowing the page
          when the window is narrow — six tabs do not fit at the 700px minimum. */}
      <div className="coin-tab-nav-wrap">
        <nav className="coin-tab-nav" role="tablist">
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

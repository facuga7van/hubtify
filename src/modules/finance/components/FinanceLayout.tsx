import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const tabs = [
  { path: '/finance', label: 'coinify.dashboard', end: true },
  { path: '/finance/transactions', label: 'coinify.transactions' },
  { path: '/finance/installments', label: 'coinify.installments' },
  { path: '/finance/cards', label: 'coinify.creditCards' },
  { path: '/finance/loans', label: 'coinify.loans' },
];

export default function FinanceLayout() {
  const { t } = useTranslation();

  return (
    <div className="coin-layout">
      <nav className="coin-layout__nav">
        {tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            end={'end' in tab ? tab.end : undefined}
            className={({ isActive }) =>
              `coin-layout__tab ${isActive ? 'coin-layout__tab--active' : 'coin-layout__tab--inactive'}`
            }
          >
            {t(tab.label)}
          </NavLink>
        ))}
      </nav>

      <div className="coin-layout__content">
        <Outlet />
      </div>
    </div>
  );
}

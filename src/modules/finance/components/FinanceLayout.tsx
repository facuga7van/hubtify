import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const tabs = [
  { path: '/finance', label: 'coinify.dashboard', end: true },
  { path: '/finance/transactions', label: 'coinify.transactions' },
  { path: '/finance/installments', label: 'coinify.installments' },
  { path: '/finance/loans', label: 'coinify.loans' },
  { path: '/finance/recurring', label: 'coinify.recurringLabel' },
  { path: '/finance/import', label: 'coinify.import' },
];

export default function FinanceLayout() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col h-full">
      <nav className="flex gap-1 p-2 border-b border-white/10 overflow-x-auto">
        {tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            end={'end' in tab ? tab.end : undefined}
            className={({ isActive }) =>
              `px-3 py-1.5 rounded text-sm whitespace-nowrap transition-colors ${
                isActive
                  ? 'bg-[var(--rpg-gold)]/20 text-[var(--rpg-gold)]'
                  : 'text-white/60 hover:text-white/80'
              }`
            }
          >
            {t(tab.label)}
          </NavLink>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto p-4">
        <Outlet />
      </div>
    </div>
  );
}

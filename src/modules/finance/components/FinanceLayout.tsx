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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <nav style={{
        display: 'flex',
        gap: 4,
        padding: 8,
        borderBottom: '1px solid var(--rpg-parchment-dark)',
        overflowX: 'auto',
      }}>
        {tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            end={'end' in tab ? tab.end : undefined}
            style={({ isActive }) => ({
              padding: '6px 14px',
              borderRadius: 'var(--rpg-radius)',
              fontSize: '0.85rem',
              fontFamily: 'Cinzel, serif',
              fontWeight: isActive ? 700 : 600,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              background: isActive
                ? 'linear-gradient(to bottom, var(--rpg-gold-dark), var(--rpg-gold))'
                : 'transparent',
              color: isActive ? 'var(--rpg-wood)' : 'var(--rpg-ink-light)',
              opacity: isActive ? 1 : 0.6,
              border: isActive ? '1px solid var(--rpg-gold-light)' : '1px solid transparent',
              transition: 'all 0.2s ease',
            })}
          >
            {t(tab.label)}
          </NavLink>
        ))}
      </nav>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        <Outlet />
      </div>
    </div>
  );
}

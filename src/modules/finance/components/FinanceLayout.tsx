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
      {/* Book-tab navigation */}
      <nav style={{
        display: 'flex',
        gap: 0,
        paddingLeft: 8,
        position: 'relative',
        zIndex: 1,
      }}>
        {tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            end={'end' in tab ? tab.end : undefined}
            style={({ isActive }) => ({
              padding: '7px 16px 9px',
              fontSize: '0.8rem',
              fontFamily: 'Cinzel, serif',
              fontWeight: isActive ? 700 : 500,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              color: isActive ? 'var(--rpg-gold-light)' : 'var(--rpg-ink-light)',
              opacity: isActive ? 1 : 0.85,
              background: isActive
                ? 'linear-gradient(180deg, var(--rpg-leather) 0%, var(--rpg-wood) 100%)'
                : 'linear-gradient(180deg, rgba(139,90,43,0.4) 0%, rgba(139,90,43,0.18) 100%)',
              borderTop: isActive ? '2px solid var(--rpg-gold-dark)' : '2px solid rgba(201,168,76,0.5)',
              borderLeft: isActive ? '1px solid var(--rpg-gold-dark)' : '1px solid rgba(201,168,76,0.45)',
              borderRight: isActive ? '1px solid var(--rpg-gold-dark)' : '1px solid rgba(201,168,76,0.45)',
              borderBottom: isActive ? '1px solid var(--rpg-wood)' : '1px solid rgba(201,168,76,0.3)',
              borderRadius: '6px 6px 0 0',
              marginBottom: isActive ? -1 : 0,
              position: 'relative',
              transition: 'all 0.15s ease',
            })}
          >
            {t(tab.label)}
          </NavLink>
        ))}
      </nav>

      {/* Content area with top border connecting to active tab */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: 16,
        borderTop: '1px solid var(--rpg-gold-dark)',
      }}>
        <Outlet />
      </div>
    </div>
  );
}

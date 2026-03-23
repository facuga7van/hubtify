import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PlayerCard from './PlayerCard';
import type { PlayerStats } from '../../shared/types';
import { useAuthContext } from '../shared/AuthContext';
import './styles/layout.css';

interface SidebarProps { stats: PlayerStats | null; collapsed: boolean; onToggle: () => void; }

function NavIcon({ name }: { name: string }) {
  const s = { width: 18, height: 18, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'home': return (
      <svg {...s} viewBox="0 0 18 18"><path d="M3 9l6-6 6 6"/><path d="M5 8v7h3v-4h2v4h3V8"/></svg>
    );
    case 'sword': return (
      <svg {...s} viewBox="0 0 18 18"><path d="M14 2l-8 8M6 10l-2 2 2 2 2-2M10.5 5.5l2 2M14 2l2 2-3 3"/></svg>
    );
    case 'goblet': return (
      <svg {...s} viewBox="0 0 18 18"><path d="M6 3h6v4c0 2-1.5 3-3 3s-3-1-3-3V3z"/><path d="M9 10v3M6 13h6"/><path d="M12 5h2c1 0 1.5 1 1 2s-1.5 1.5-3 1.5M6 5H4c-1 0-1.5 1-1 2s1.5 1.5 3 1.5"/></svg>
    );
    case 'coins': return (
      <svg {...s} viewBox="0 0 18 18"><ellipse cx="7" cy="10" rx="5" ry="3"/><path d="M2 10v2c0 1.7 2.2 3 5 3s5-1.3 5-3v-2"/><ellipse cx="11" cy="7" rx="5" ry="3"/><path d="M6 7v2c0 1.7 2.2 3 5 3s5-1.3 5-3V7"/></svg>
    );
    case 'shield': return (
      <svg {...s} viewBox="0 0 18 18"><path d="M9 2L3 5v4c0 4 3 6 6 7 3-1 6-3 6-7V5L9 2z"/><path d="M7 9l2 2 3-4"/></svg>
    );
    case 'settings': return (
      <svg {...s} viewBox="0 0 24 24">
        <path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/>
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H10a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V10c.26.6.77 1.02 1.51 1.08H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
      </svg>
    );
    default: return null;
  }
}

const navKeys = [
  { path: '/', key: 'nav.home', icon: 'home' },
  { path: '/quests', key: 'nav.questify', icon: 'sword' },
  { path: '/nutrition', key: 'nav.nutrify', icon: 'goblet' },
  { path: '/finance', key: 'nav.coinify', icon: 'coins' },
  { path: '/character', key: 'nav.character', icon: 'shield' },
  { path: '/settings', key: 'nav.settings', icon: 'settings' },
];

export default function Sidebar({ stats, collapsed, onToggle }: SidebarProps) {
  const { t, i18n } = useTranslation();
  const { user: authUser, logout } = useAuthContext();

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      {/* Toggle button */}
      <button onClick={onToggle} className="sidebar-toggle" title={collapsed ? 'Expand' : 'Collapse'}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
          style={{ transition: 'transform 0.2s', transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)' }}>
          <path d="M9 2L4 7l5 5"/>
        </svg>
      </button>

      <PlayerCard stats={stats} collapsed={collapsed} />

      {!collapsed && (
        <div style={{ padding: '4px 14px', opacity: 0.3 }}>
          <img src={new URL('../../assets/footer.png', import.meta.url).href}
            alt="" style={{ width: '100%', height: 'auto' }} />
        </div>
      )}

      <nav className="sidebar-nav">
        {navKeys.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
            title={collapsed ? t(item.key) : undefined}
          >
            <NavIcon name={item.icon} />
            {!collapsed && <span>{t(item.key)}</span>}
          </NavLink>
        ))}
      </nav>

      {!collapsed && (
        <div style={{ padding: '4px 14px', opacity: 0.3 }}>
          <img src={new URL('../../assets/footer.png', import.meta.url).href}
            alt="" style={{ width: '100%', height: 'auto' }} />
        </div>
      )}

      <div className="sidebar-footer">
        {authUser ? (
          <div style={{ marginBottom: 6 }}>
            {!collapsed && (
              <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {authUser.email}
              </div>
            )}
            <button className="rpg-button" onClick={async () => { await logout(); }}
              title={collapsed ? t('auth.logout') : undefined}
              style={{ fontSize: '0.7rem', padding: collapsed ? '4px' : '3px 8px', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M5 1H2v10h3M8 3l3 3-3 3M4 6h7"/>
              </svg>
              {!collapsed && t('auth.logout')}
            </button>
          </div>
        ) : (
          <div style={{ marginBottom: 6 }}>
            <NavLink to="/login" className="rpg-button"
              title={collapsed ? t('auth.loginForSync') : undefined}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: '0.75rem', padding: collapsed ? '6px' : '6px 10px', width: '100%', textDecoration: 'none' }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M7 1h4v10H7M1 6h7M6 3l3 3-3 3"/>
              </svg>
              {!collapsed && t('auth.loginForSync')}
            </NavLink>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between' }}>
          {!collapsed && (
            <div style={{ fontSize: '0.8rem', opacity: 0.5 }}>
              {t('app.version')}
            </div>
          )}
          <button onClick={() => {
            const newLang = i18n.language === 'es' ? 'en' : 'es';
            i18n.changeLanguage(newLang);
            localStorage.setItem('hubtify_lang', newLang);
          }} style={{ background: 'none', border: 'none', color: 'var(--rpg-gold)', cursor: 'pointer', fontSize: '0.75rem' }}>
            {i18n.language === 'es' ? 'EN' : 'ES'}
          </button>
        </div>
      </div>
    </aside>
  );
}

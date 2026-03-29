import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PlayerCard from './PlayerCard';
import type { PlayerStats } from '../../shared/types';
import Tooltip from '../shared/components/Tooltip';
import './styles/layout.css';

interface SidebarProps { stats: PlayerStats | null; collapsed: boolean; onToggle?: () => void; }

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
    case 'trophy': return (
      <svg {...s} viewBox="0 0 18 18"><path d="M5 3h8v4c0 2.5-1.8 4-4 4s-4-1.5-4-4V3z"/><path d="M9 11v3M6 14h6"/><path d="M13 5h1.5c.8 0 1.3.8 1 1.5-.5 1-1.3 1.8-2.5 2M5 5H3.5c-.8 0-1.3.8-1 1.5.5 1 1.3 1.8 2.5 2"/></svg>
    );
    case 'village': return (
      <svg {...s} viewBox="0 0 18 18"><path d="M2 16h14"/><path d="M4 16V9l3-3 3 3v7"/><path d="M7 12h0"/><path d="M12 16v-5l2.5-2L17 11v5"/><path d="M7 6V3"/></svg>
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

const navKeys: Array<{ path: string; key: string; icon: string; comingSoon?: boolean }> = [
  { path: '/', key: 'nav.home', icon: 'home' },
  { path: '/quests', key: 'nav.questify', icon: 'sword' },
  { path: '/nutrition', key: 'nav.nutrify', icon: 'goblet' },
  { path: '/finance', key: 'nav.coinify', icon: 'coins', comingSoon: true },
  { path: '/achievements', key: 'nav.achievements', icon: 'trophy', comingSoon: true },
  { path: '/village', key: 'nav.village', icon: 'village', comingSoon: true },
  { path: '/character', key: 'nav.character', icon: 'shield' },
  { path: '/settings', key: 'nav.settings', icon: 'settings' },
];

export default function Sidebar({ stats, collapsed, onToggle }: SidebarProps) {
  const { t, i18n } = useTranslation();

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      <PlayerCard stats={stats} collapsed={collapsed} />

      {!collapsed && (
        <div style={{ padding: '4px 14px', opacity: 0.3 }}>
          <img src={new URL('../../assets/footer.png', import.meta.url).href}
            alt="" style={{ width: '100%', height: 'auto' }} />
        </div>
      )}

      <nav className="sidebar-nav">
        {navKeys.map((item) => (
          item.comingSoon ? (
            <Tooltip key={item.path} text={t('common.comingSoon')}>
              <div
                className="sidebar-nav-item"
                style={{ opacity: 0.35, cursor: 'default' }}
              >
                <NavIcon name={item.icon} />
                {!collapsed && <span>{t(item.key)}</span>}
              </div>
            </Tooltip>
          ) : (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
              title={collapsed ? t(item.key) : undefined}
            >
              <NavIcon name={item.icon} />
              {!collapsed && <span>{t(item.key)}</span>}
            </NavLink>
          )
        ))}
      </nav>

      {!collapsed && (
        <div style={{ padding: '4px 14px', opacity: 0.3 }}>
          <img src={new URL('../../assets/footer.png', import.meta.url).href}
            alt="" style={{ width: '100%', height: 'auto' }} />
        </div>
      )}

      <div className="sidebar-footer">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between' }}>
          {!collapsed && (
            <div style={{ fontSize: '0.7rem', fontFamily: 'Fira Code, monospace', opacity: 0.35 }}>
              v{APP_VERSION}
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

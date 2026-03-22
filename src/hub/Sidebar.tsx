import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PlayerCard from './PlayerCard';
import type { PlayerStats } from '../../shared/types';
import { useAuthContext } from '../shared/AuthContext';
import { syncPush } from '../shared/sync';
import './styles/layout.css';

interface SidebarProps { stats: PlayerStats | null; }

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
      <svg {...s} viewBox="0 0 18 18">
        <circle cx="9" cy="9" r="2.5"/>
        <path d="M9 1v2M9 15v2M1 9h2M15 9h2M3.5 3.5l1.4 1.4M13.1 13.1l1.4 1.4M3.5 14.5l1.4-1.4M13.1 4.9l1.4-1.4"/>
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

export default function Sidebar({ stats }: SidebarProps) {
  const { t, i18n } = useTranslation();
  const { user: authUser, logout } = useAuthContext();

  return (
    <aside className="sidebar">
      <PlayerCard stats={stats} />
      <div style={{ padding: '4px 14px', opacity: 0.3 }}>
        <img src={new URL('../../assets/footer.png', import.meta.url).href}
          alt="" style={{ width: '100%', height: 'auto' }} />
      </div>
      <nav className="sidebar-nav">
        {navKeys.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
          >
            <NavIcon name={item.icon} />
            <span>{t(item.key)}</span>
          </NavLink>
        ))}
      </nav>
      <div style={{ padding: '4px 14px', opacity: 0.3 }}>
        <img src={new URL('../../assets/footer.png', import.meta.url).href}
          alt="" style={{ width: '100%', height: 'auto' }} />
      </div>
      <div className="sidebar-footer">
        {stats && stats.streak > 0 && (
          <div style={{ marginBottom: 6 }}>
            <span style={{ fontSize: '0.9rem' }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="#e67e22" style={{ verticalAlign: '-2px', marginRight: 4 }}>
                <path d="M7 1c-1 1.5-3.5 3.5-3.5 6a3.5 3.5 0 007 0c0-1-.5-1.8-1.3-2.6.4.8.4 1.7-.4 2.6-.9-.9-.9-2.6-1.8-3.5-.4 1.3-.9 2.2-.9 3a1.3 1.3 0 002.6 0c0-.4-.3-1.3-.9-2.2z"/>
              </svg>
              {stats.streak} {t('rpg.streak')}
            </span>
          </div>
        )}
        {authUser ? (
          <div style={{ marginBottom: 6 }}>
            <div style={{ fontSize: '0.75rem', opacity: 0.6, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {authUser.email}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="rpg-button" onClick={async () => {
                try {
                  const result = await syncPush(authUser.uid);
                  alert(result.success ? t('auth.synced') : `${t('auth.syncFailed')}: ${result.error}`);
                } catch (err) {
                  alert(t('auth.syncFailed'));
                }
              }} style={{ fontSize: '0.7rem', padding: '3px 8px', flex: 1 }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M1 6a5 5 0 019-2M11 6a5 5 0 01-9 2"/><path d="M10 1v3h-3M2 11V8h3"/>
                </svg>
                {' '}{t('auth.sync')}
              </button>
              <button className="rpg-button" onClick={async () => {
                await logout();
              }} style={{ fontSize: '0.7rem', padding: '3px 8px' }}>
                {t('auth.logout')}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 6 }}>
            <NavLink to="/login" className="rpg-button" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: '0.75rem', padding: '6px 10px', width: '100%', textDecoration: 'none' }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M7 1h4v10H7M1 6h7M6 3l3 3-3 3"/>
              </svg>
              {t('auth.loginForSync')}
            </NavLink>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '0.8rem', opacity: 0.5 }}>
            {t('app.version')}
          </div>
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

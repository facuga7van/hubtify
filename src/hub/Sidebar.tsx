import { NavLink } from 'react-router-dom';
import PlayerCard from './PlayerCard';
import type { PlayerStats } from '../../shared/types';
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
    default: return null;
  }
}

const navItems = [
  { path: '/', label: 'Home', icon: 'home' },
  { path: '/quests', label: 'Questify', icon: 'sword' },
  { path: '/nutrition', label: 'Nutrify', icon: 'goblet' },
  { path: '/finance', label: 'Coinify', icon: 'coins' },
  { path: '/character', label: 'Character', icon: 'shield' },
];

export default function Sidebar({ stats }: SidebarProps) {
  return (
    <aside className="sidebar">
      <PlayerCard stats={stats} />
      <div style={{ padding: '4px 14px', opacity: 0.3 }}>
        <img src={new URL('../../assets/footer.png', import.meta.url).href}
          alt="" style={{ width: '100%', height: 'auto' }} />
      </div>
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
          >
            <NavIcon name={item.icon} />
            <span>{item.label}</span>
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
              {stats.streak} day streak
            </span>
          </div>
        )}
        <div style={{ fontSize: '0.8rem', opacity: 0.5 }}>
          Hubtify v0.1.0
        </div>
      </div>
    </aside>
  );
}

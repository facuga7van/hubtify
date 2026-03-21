import { NavLink } from 'react-router-dom';
import PlayerCard from './PlayerCard';
import type { PlayerStats } from '../../shared/types';
import './styles/layout.css';

interface SidebarProps { stats: PlayerStats | null; }

const navItems = [
  { path: '/', label: 'Home', icon: '\u{1F3E0}' },
  { path: '/quests', label: 'Quests', icon: '\u2694' },
  { path: '/nutrition', label: 'Nutrition', icon: '\u{1F356}' },
  { path: '/finance', label: 'Finance', icon: '\u{1F4B0}' },
  { path: '/character', label: 'Character', icon: '\u{1F6E1}' },
];

export default function Sidebar({ stats }: SidebarProps) {
  return (
    <aside className="sidebar">
      <PlayerCard stats={stats} />
      <div className="sidebar-divider" />
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-divider" />
      <div className="sidebar-footer">
        {stats && stats.streak > 0 && (
          <div style={{ marginBottom: 6 }}>
            <span style={{ fontSize: '0.9rem' }}>🔥 {stats.streak} day streak</span>
          </div>
        )}
        <div style={{ fontSize: '0.8rem', opacity: 0.5 }}>
          Hubtify v0.1.0
        </div>
      </div>
    </aside>
  );
}

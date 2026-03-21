import { Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import TitleBar from '../shared/components/TitleBar';
import Sidebar from './Sidebar';
import type { PlayerStats } from '../../shared/types';
import './styles/layout.css';
import './styles/components.css';

export default function Layout() {
  const [stats, setStats] = useState<PlayerStats | null>(null);

  useEffect(() => {
    window.api.getRpgStats().then(setStats).catch(console.error);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <TitleBar />
      <div className="app-layout">
        <Sidebar stats={stats} />
        <main className="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

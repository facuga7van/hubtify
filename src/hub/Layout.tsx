import { Outlet, useLocation } from 'react-router-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TitleBar from '../shared/components/TitleBar';
import Sidebar from './Sidebar';
import type { PlayerStats } from '../../shared/types';
import { useAuthContext } from '../shared/AuthContext';
import { syncPush, syncPull } from '../shared/sync';
import './styles/layout.css';
import './styles/components.css';
import { playLevelUp } from '../shared/audio';
import { useKeyboardShortcuts } from '../shared/hooks/useKeyboardShortcuts';

export default function Layout() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [levelUp, setLevelUp] = useState<number | null>(null);
  const prevLevelRef = useRef<number>(0);
  const location = useLocation();

  const { user: authUser } = useAuthContext();

  useKeyboardShortcuts();

  const refreshStats = useCallback(() => {
    window.api.getRpgStats().then(setStats).catch(console.error);
  }, []);

  useEffect(() => {
    refreshStats();
  }, [location.pathname, refreshStats]);

  // Auto-sync every 5 minutes if logged in
  useEffect(() => {
    if (!authUser) return;
    const interval = setInterval(async () => {
      try {
        await syncPush(authUser.uid);
        console.log('[AutoSync] Pushed data to cloud');
      } catch {
        // Silent fail — auto-sync is best-effort
      }
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(interval);
  }, [authUser]);

  // Enable reminders if previously set
  useEffect(() => {
    if (localStorage.getItem('hubtify_reminders') === 'true') {
      window.api.notificationsSetReminders(true).catch(console.error);
    }
  }, []);

  // Initial sync on mount — pull latest data if logged in
  useEffect(() => {
    if (!authUser) return;
    (async () => {
      try {
        await syncPull(authUser.uid);
        refreshStats();
        console.log('[AutoSync] Initial pull complete');
      } catch {
        // Silent fail
      }
    })();
  }, [authUser, refreshStats]);

  useEffect(() => {
    if (stats && prevLevelRef.current > 0 && stats.level > prevLevelRef.current) {
      setLevelUp(stats.level);
      playLevelUp();
      setTimeout(() => setLevelUp(null), 3000);
    }
    if (stats) prevLevelRef.current = stats.level;
  }, [stats]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <TitleBar />
      <div className="app-layout" style={{ flex: 1, height: 0 }}>
        <Sidebar stats={stats} />
        <main className="main-content">
          <Outlet />
        </main>
      </div>

      {levelUp && (
        <div style={{
          position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(44, 24, 16, 0.7)', zIndex: 9999,
          animation: 'fadeIn 0.3s ease',
        }} onClick={() => setLevelUp(null)}>
          <div style={{
            textAlign: 'center', color: 'var(--rpg-gold-light)',
            animation: 'levelUpScale 0.5s ease',
          }}>
            <div style={{ fontSize: '3rem', marginBottom: 8 }}>⚔</div>
            <div style={{ fontFamily: 'Cinzel, serif', fontSize: '2rem', fontWeight: 'bold', textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}>
              {t('rpg.levelUp')}
            </div>
            <div style={{ fontFamily: 'Fira Code, monospace', fontSize: '1.5rem', marginTop: 8 }}>
              {t('rpg.level')} {levelUp}
            </div>
            <div style={{ fontSize: '0.9rem', opacity: 0.7, marginTop: 12 }}>
              {t('rpg.clickDismiss')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

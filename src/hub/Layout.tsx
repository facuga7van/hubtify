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
import QuickAdd from '../shared/components/QuickAdd';

export default function Layout() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [levelUp, setLevelUp] = useState<number | null>(null);
  const prevLevelRef = useRef<number>(0);
  const location = useLocation();

  const { user: authUser } = useAuthContext();

  useKeyboardShortcuts();

  const [showQuickAdd, setShowQuickAdd] = useState(false);

  // Ctrl+Q to open quick add
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'q') {
        e.preventDefault();
        setShowQuickAdd(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('hubtify_sidebar_collapsed') === 'true';
  });
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('hubtify_sidebar_collapsed', String(next));
      return next;
    });
  }, []);

  const refreshStats = useCallback(() => {
    window.api.getRpgStats().then(setStats).catch(console.error);
  }, []);

  useEffect(() => {
    refreshStats();
  }, [location.pathname, refreshStats]);

  // Listen for stats refresh requests from child components
  useEffect(() => {
    const handler = () => refreshStats();
    window.addEventListener('rpg:statsChanged', handler);
    return () => window.removeEventListener('rpg:statsChanged', handler);
  }, [refreshStats]);

  // Debounced push sync — triggers 30s after last data change
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedPush = useCallback(() => {
    if (!authUser) return;
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = setTimeout(async () => {
      try {
        await syncPush(authUser.uid);
      } catch { /* Silent fail */ }
    }, 30_000);
  }, [authUser]);

  // Cleanup sync timeout on unmount
  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, []);

  // Push on data changes (RPG stats or quest data)
  useEffect(() => {
    const handler = () => debouncedPush();
    window.addEventListener('rpg:statsChanged', handler);
    window.addEventListener('quests:dataChanged', handler);
    return () => {
      window.removeEventListener('rpg:statsChanged', handler);
      window.removeEventListener('quests:dataChanged', handler);
    };
  }, [debouncedPush]);

  // Push on blur (leaving app), pull on focus (coming back)
  useEffect(() => {
    if (!authUser) return;
    const onBlur = async () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      try {
        await syncPush(authUser.uid);
      } catch { /* Silent fail */ }
    };
    const onFocus = async () => {
      try {
        const result = await syncPull(authUser.uid);
        refreshStats();
        if (result.changed) {
          window.dispatchEvent(new Event('sync:questsUpdated'));
        }
      } catch { /* Silent fail */ }
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, [authUser, refreshStats]);

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
        const result = await syncPull(authUser.uid);
        refreshStats();
        if (result.changed) {
          window.dispatchEvent(new Event('sync:questsUpdated'));
        }
      } catch {
        // Silent fail
      }
    })();
  }, [authUser, refreshStats]);

  const levelUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (stats && prevLevelRef.current > 0 && stats.level > prevLevelRef.current) {
      setLevelUp(stats.level);
      playLevelUp();
      if (levelUpTimerRef.current) clearTimeout(levelUpTimerRef.current);
      levelUpTimerRef.current = setTimeout(() => setLevelUp(null), 3000);
    }
    if (stats) prevLevelRef.current = stats.level;
    return () => {
      if (levelUpTimerRef.current) clearTimeout(levelUpTimerRef.current);
    };
  }, [stats]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <TitleBar />
      <div className="app-layout" style={{ flex: 1, height: 0 }}>
        <Sidebar stats={stats} collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
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

      {showQuickAdd && <QuickAdd onClose={() => setShowQuickAdd(false)} />}
    </div>
  );
}

import { useLocation } from 'react-router-dom';
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
import ToastProvider from '../shared/components/ToastProvider';
import AnimatedOutlet, { AnimatedNavigateContext, type AnimatedOutletHandle } from '../shared/components/AnimatedOutlet';
import { gsap } from 'gsap';
import { levelUp as animateLevelUp } from '../shared/animations/epic';

export default function Layout() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [levelUp, setLevelUp] = useState<number | null>(null);
  const prevLevelRef = useRef<number>(0);
  const location = useLocation();

  const { user: authUser } = useAuthContext();
  const outletHandleRef = useRef<AnimatedOutletHandle>(null);
  const animatedNavigate = useCallback((to: string) => {
    outletHandleRef.current?.animatedNavigate(to)
  }, []);

  useKeyboardShortcuts();

  const [showQuickAdd, setShowQuickAdd] = useState(false);

  // Auto-updater
  const [syncError, setSyncError] = useState(false);

  const [updateAvailable, setUpdateAvailable] = useState<{ version: string } | null>(null);
  const [updateState, setUpdateState] = useState<'idle' | 'downloading'>('idle');
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    const c1 = window.api.onUpdateAvailable((info) => setUpdateAvailable(info));
    const c2 = window.api.onDownloadProgress((info) => setDownloadPercent(info.percent));
    const c3 = window.api.onUpdateError((info) => setUpdateError(info.message));

    // Also actively check on mount — the passive listener may have missed
    // the message if it was sent before React mounted
    window.api.updaterCheck?.().then((res: { available?: boolean; version?: string }) => {
      if (res?.available && res.version) {
        setUpdateAvailable({ version: res.version });
      }
    }).catch(() => { /* not available in dev */ });

    return () => { c1(); c2(); c3(); };
  }, []);

  const handleUpdate = async () => {
    setUpdateState('downloading');
    setUpdateError(null);
    try {
      await window.api.updaterDownload();
      // App will auto-quit and installer runs
    } catch { setUpdateState('idle'); }
  };

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
        // Update stats without triggering level-up (sync restore, not user action)
        const freshStats = await window.api.getRpgStats();
        if (freshStats) prevLevelRef.current = freshStats.level;
        setStats(freshStats);
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
  }, [authUser]);

  // Enable reminders if previously set
  useEffect(() => {
    if (localStorage.getItem('hubtify_reminders') === 'true') {
      window.api.notificationsSetReminders(true).catch(console.error);
    }
  }, []);

  const retrySyncPull = useCallback(async () => {
    if (!authUser) return;
    setSyncError(false);
    try {
      const lastUid = await window.api.syncGetCurrentUser();
      if (lastUid && lastUid !== authUser.uid) {
        await window.api.syncClearUserData();
      }
      await window.api.syncSetCurrentUser(authUser.uid);
      const result = await syncPull(authUser.uid);
      // Refresh stats after sync but skip level-up detection
      // (sync restores cloud data, not a real level-up action)
      const freshStats = await window.api.getRpgStats();
      if (freshStats) prevLevelRef.current = freshStats.level;
      setStats(freshStats);
      if (result.changed) {
        window.dispatchEvent(new Event('sync:questsUpdated'));
      }
    } catch {
      setSyncError(true);
    }
  }, [authUser]);

  useEffect(() => {
    retrySyncPull();
  }, [retrySyncPull]);

  const levelUpOverlayRef = useRef<HTMLDivElement>(null);
  const levelUpBookRef = useRef<HTMLDivElement>(null);
  const levelUpTextRef = useRef<HTMLDivElement>(null);
  const levelUpTimelineRef = useRef<gsap.core.Timeline | null>(null);

  useEffect(() => {
    if (stats && prevLevelRef.current > 0 && stats.level > prevLevelRef.current) {
      setLevelUp(stats.level);
    }
    if (stats) prevLevelRef.current = stats.level;
  }, [stats]);

  // Fire GSAP animation once the overlay is rendered (levelUp != null)
  useEffect(() => {
    if (!levelUp) return;
    if (!levelUpOverlayRef.current || !levelUpBookRef.current || !levelUpTextRef.current) return;

    // Kill any running timeline
    if (levelUpTimelineRef.current) {
      levelUpTimelineRef.current.kill();
      levelUpTimelineRef.current = null;
    }

    // Play sound at phase 3 (text reveal at 0.6s)
    const soundTimeout = setTimeout(() => playLevelUp(), 600);

    levelUpTimelineRef.current = animateLevelUp(
      levelUpOverlayRef.current,
      levelUpBookRef.current,
      levelUpTextRef.current,
      () => {
        clearTimeout(soundTimeout);
        setLevelUp(null);
      },
    );

    return () => {
      clearTimeout(soundTimeout);
    };
  }, [levelUp]);

  const handleDismissLevelUp = useCallback(() => {
    if (!levelUpOverlayRef.current) return;
    if (levelUpTimelineRef.current) {
      levelUpTimelineRef.current.kill();
      levelUpTimelineRef.current = null;
    }
    gsap.to(levelUpOverlayRef.current, {
      opacity: 0,
      duration: 0.3,
      onComplete: () => {
        if (levelUpOverlayRef.current) levelUpOverlayRef.current.style.display = 'none';
        setLevelUp(null);
      },
    });
  }, []);

  return (
    <AnimatedNavigateContext.Provider value={animatedNavigate}>
    <ToastProvider>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <TitleBar />
      <div className="app-layout" style={{ flex: 1, height: 0 }}>
        <div className="sidebar-wrapper">
          <Sidebar stats={stats} collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
          <button onClick={toggleSidebar} className={`sidebar-toggle ${sidebarCollapsed ? 'sidebar-toggle--collapsed' : ''}`}
            title={sidebarCollapsed ? 'Expand' : 'Collapse'}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
              style={{ transition: 'transform 0.25s ease', transform: sidebarCollapsed ? 'rotate(180deg)' : 'rotate(0deg)' }}>
              <path d="M9 2L4 7l5 5"/>
            </svg>
          </button>
        </div>
        <main className="main-content">
          {syncError && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
              padding: '10px 16px', background: 'rgba(248, 113, 113, 0.15)',
              border: '1px solid rgba(248, 113, 113, 0.3)', borderRadius: 'var(--rpg-radius)',
              margin: '8px 16px 0', color: '#f87171', fontSize: '0.85rem',
            }}>
              <span>{t('auth.syncPullFailed')}</span>
              <button className="rpg-button" onClick={retrySyncPull}
                style={{ padding: '4px 12px', fontSize: '0.8rem', flexShrink: 0 }}>
                {t('auth.syncRetry')}
              </button>
            </div>
          )}
          <AnimatedOutlet ref={outletHandleRef} />
        </main>
      </div>

      {/* Level-up epic overlay — always in DOM when levelUp != null, hidden via display:none until GSAP shows it */}
      {levelUp !== null && (
        <div
          ref={levelUpOverlayRef}
          onClick={handleDismissLevelUp}
          style={{
            position: 'fixed', inset: 0, display: 'none',
            alignItems: 'center', justifyContent: 'center',
            background: 'rgba(58, 35, 18, 0.88)',
            zIndex: 9999, cursor: 'pointer',
          }}
        >
          {/* Book container */}
          <div
            ref={levelUpBookRef}
            style={{
              position: 'relative',
              width: 240, height: 180,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {/* Left cover */}
            <div
              data-book="left"
              style={{
                position: 'absolute', left: 0, top: 0,
                width: '50%', height: '100%',
                background: 'linear-gradient(135deg, #c8a96e 0%, #a07840 50%, #7a5a28 100%)',
                border: '2px solid rgba(212,160,23,0.6)',
                borderRight: '1px solid rgba(212,160,23,0.3)',
                borderRadius: '4px 0 0 4px',
                transformOrigin: 'left center',
              }}
            />
            {/* Right cover */}
            <div
              data-book="right"
              style={{
                position: 'absolute', right: 0, top: 0,
                width: '50%', height: '100%',
                background: 'linear-gradient(225deg, #c8a96e 0%, #a07840 50%, #7a5a28 100%)',
                border: '2px solid rgba(212,160,23,0.6)',
                borderLeft: '1px solid rgba(212,160,23,0.3)',
                borderRadius: '0 4px 4px 0',
                transformOrigin: 'right center',
              }}
            />

            {/* Level text area */}
            <div
              ref={levelUpTextRef}
              style={{
                position: 'absolute', inset: 0,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                opacity: 0, pointerEvents: 'none',
                zIndex: 2,
              }}
            >
              {/* SVG path for stroke draw-in effect */}
              <svg width="200" height="60" viewBox="0 0 200 60" style={{ overflow: 'visible' }}>
                <path
                  d="M20 40 Q40 10 60 35 Q80 55 100 30 Q120 10 140 35 Q160 55 180 30"
                  fill="none"
                  stroke="rgba(212,160,23,0.6)"
                  strokeWidth="1.5"
                />
              </svg>
              <div style={{
                fontFamily: 'Cinzel, serif', fontSize: '1.5rem', fontWeight: 'bold',
                color: 'var(--rpg-gold-light)', textShadow: '0 2px 12px rgba(0,0,0,0.7)',
                marginTop: 8,
              }}>
                {t('rpg.levelUp')}
              </div>
              <div style={{
                fontFamily: 'Fira Code, monospace', fontSize: '1.1rem',
                color: 'var(--rpg-gold)', marginTop: 4,
              }}>
                {t('rpg.level')} {levelUp}
              </div>
              <div style={{ fontSize: '0.75rem', opacity: 0.5, marginTop: 10, color: 'var(--rpg-parchment)' }}>
                {t('rpg.clickDismiss')}
              </div>
            </div>
          </div>
        </div>
      )}

      {showQuickAdd && <QuickAdd onClose={() => setShowQuickAdd(false)} />}

      {/* Update popup */}
      {updateAvailable && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(44, 24, 16, 0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: 'linear-gradient(135deg, var(--rpg-wood) 0%, var(--rpg-leather) 100%)',
            border: '2px solid var(--rpg-gold-dark)',
            borderRadius: 'var(--rpg-radius)', padding: '24px', maxWidth: 360,
            textAlign: 'center', color: 'var(--rpg-parchment)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          }}>
            <h3 style={{ fontFamily: 'Cinzel, serif', marginBottom: 12, color: 'var(--rpg-gold-light)' }}>
              {t('settings.updateAvailable', { version: updateAvailable.version })}
            </h3>
            {updateState === 'downloading' && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 4, height: 8, overflow: 'hidden', marginBottom: 4 }}>
                  <div style={{ height: '100%', background: 'var(--rpg-xp-green)', width: `${downloadPercent}%`, transition: 'width 0.3s ease' }} />
                </div>
                <span style={{ fontSize: '0.8rem', opacity: 0.6 }}>{downloadPercent}%</span>
              </div>
            )}
            {updateError && (
              <p style={{ color: '#f87171', fontSize: '0.8rem', marginBottom: 8 }}>{updateError}</p>
            )}
            {updateState === 'idle' && (
              <>
                <button className="rpg-button" onClick={handleUpdate} style={{ width: '100%', marginBottom: 8 }}>
                  {t('settings.downloadUpdate')}
                </button>
                <button onClick={() => setUpdateAvailable(null)} className="rpg-button"
                  style={{ width: '100%', padding: '4px 8px', fontSize: '0.75rem', background: 'transparent', border: '1px solid var(--rpg-gold-dark)', color: 'var(--rpg-gold)' }}>
                  {t('nutrify.weightCheckin.later')}
                </button>
              </>
            )}
          </div>
        </div>
      )}

    </div>
    </ToastProvider>
    </AnimatedNavigateContext.Provider>
  );
}

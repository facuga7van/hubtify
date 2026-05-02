import { useLocation } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TitleBar from '../shared/components/TitleBar';
import Sidebar from './Sidebar';
import type { PlayerStats } from '../../shared/types';
import { useAuthContext } from '../shared/AuthContext';
import { syncPush, syncPull } from '../shared/sync';
import './styles/layout.css';
import './styles/components.css';
import { useKeyboardShortcuts } from '../shared/hooks/useKeyboardShortcuts';
import ShortcutModal from '../shared/components/ShortcutModal';
import QuickAdd from '../shared/components/QuickAdd';
import NotificationCenter from '../shared/components/NotificationCenter';
import ToastProvider from '../shared/components/ToastProvider';
import AnimatedOutlet, { AnimatedNavigateContext, type AnimatedOutletHandle } from '../shared/components/AnimatedOutlet';
import CauldronFloatingTimer from '../modules/cauldron/components/CauldronFloatingTimer';
import { TourProvider, TourOverlay } from '../shared/components/tour';
import '../shared/components/tour/tour.css';
import '../shared/styles/help-bubble.css';
import { gsap } from 'gsap';
import { levelUp as animateLevelUp } from '../shared/animations/epic';
import ChangelogModal from '../shared/components/ChangelogModal';
import { changelog } from '../shared/changelog';

function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

export default function Layout() {
  const { t, i18n } = useTranslation();
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [levelUp, setLevelUp] = useState<number | null>(null);
  const prevLevelRef = useRef<number>(0);
  const location = useLocation();

  const { user: authUser } = useAuthContext();
  const outletHandleRef = useRef<AnimatedOutletHandle>(null);
  const animatedNavigate = useCallback((to: string) => {
    outletHandleRef.current?.animatedNavigate(to)
  }, []);

  const { shortcutModalOpen, setShortcutModalOpen } = useKeyboardShortcuts();

  // Apply font scale from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('hubtify_font_scale');
    if (saved) document.documentElement.style.setProperty('--font-scale', saved);
  }, []);

  useEffect(() => {
    window.api.notificationsSetLocale?.(i18n.language);
  }, [i18n.language]);

  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

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

  // Patch notes — show on first launch after version update
  const [showPatchNotes, setShowPatchNotes] = useState(false);
  const [lastSeenVersion, setLastSeenVersion] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('hubtify_last_seen_version');
    if (!stored) {
      // First time user — just save current version, no patch notes
      localStorage.setItem('hubtify_last_seen_version', APP_VERSION);
    } else if (isNewerVersion(APP_VERSION, stored)) {
      setLastSeenVersion(stored);
      setShowPatchNotes(true);
      localStorage.setItem('hubtify_last_seen_version', APP_VERSION);
    }
  }, []);

  const patchEntries = useMemo(() => {
    let entries: typeof changelog;
    if (!lastSeenVersion) {
      entries = changelog.filter(e => e.version === APP_VERSION);
    } else {
      entries = changelog.filter(e => isNewerVersion(e.version, lastSeenVersion) && !isNewerVersion(e.version, APP_VERSION));
    }
    return entries.length > 0 ? entries : changelog.slice(0, 1);
  }, [lastSeenVersion]);

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

  // Cancel pending debounced push on account switch or explicit cancel
  // sync:cancelPush fires BEFORE push+clear sequence to prevent stale uid race
  useEffect(() => {
    const handler = () => {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
    window.addEventListener('account:switched', handler);
    window.addEventListener('sync:cancelPush', handler);
    return () => {
      window.removeEventListener('account:switched', handler);
      window.removeEventListener('sync:cancelPush', handler);
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    };
  }, []);

  // Push on data changes (RPG stats or quest data)
  useEffect(() => {
    const handler = () => debouncedPush();
    window.addEventListener('rpg:statsChanged', handler);
    window.addEventListener('quests:dataChanged', handler);
    window.addEventListener('finance:dataChanged', handler);
    window.addEventListener('nutrition:dataChanged', handler);
    window.addEventListener('cauldron:dataChanged', handler);
    return () => {
      window.removeEventListener('rpg:statsChanged', handler);
      window.removeEventListener('quests:dataChanged', handler);
      window.removeEventListener('finance:dataChanged', handler);
      window.removeEventListener('nutrition:dataChanged', handler);
      window.removeEventListener('cauldron:dataChanged', handler);
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
        // Push local changes FIRST so cloud has latest data before pulling
        if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
        await syncPush(authUser.uid);
        const result = await syncPull(authUser.uid);
        // Update stats without triggering level-up (sync restore, not user action)
        const freshStats = await window.api.getRpgStats();
        if (freshStats) prevLevelRef.current = freshStats.level;
        setStats(freshStats);
        if (result.changed) {
          window.dispatchEvent(new Event('sync:questsUpdated'));
          window.dispatchEvent(new Event('sync:nutritionUpdated'));
          window.dispatchEvent(new Event('sync:cauldronUpdated'));
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

  useEffect(() => {
    const enabled = localStorage.getItem('hubtify_notifications_system') !== 'false';
    window.api.notificationsSetSystemEnabled?.(enabled);
    for (const mod of ['quests', 'nutrition', 'finance']) {
      const modEnabled = localStorage.getItem(`hubtify_notifications_module_${mod}`) !== 'false';
      window.api.notificationsSetModuleEnabled?.(mod, modEnabled);
    }
    window.api.notificationsRunCheck?.();
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
        window.dispatchEvent(new Event('sync:nutritionUpdated'));
        window.dispatchEvent(new Event('sync:cauldronUpdated'));
      }
    } catch {
      setSyncError(true);
    }
  }, [authUser]);

  useEffect(() => {
    retrySyncPull();
  }, [retrySyncPull]);

  const levelUpOverlayRef = useRef<HTMLDivElement>(null);
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
    if (!levelUpOverlayRef.current) return;

    // Kill any running timeline
    if (levelUpTimelineRef.current) {
      levelUpTimelineRef.current.data?.particles?.stop();
      levelUpTimelineRef.current.kill();
      levelUpTimelineRef.current = null;
    }

    const mainContent = document.querySelector('.main-content') as HTMLElement;

    levelUpTimelineRef.current = animateLevelUp(
      levelUpOverlayRef.current,
      mainContent,
      levelUp,
      () => setLevelUp(null),
    );
  }, [levelUp]);

  const handleDismissLevelUp = useCallback(() => {
    if (!levelUpOverlayRef.current) return;
    if (levelUpTimelineRef.current) {
      levelUpTimelineRef.current.data?.particles?.stop();
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
    <TourProvider>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <TitleBar />
      <div className="app-layout" style={{ flex: 1, height: 0 }}>
        <div className={`sidebar-wrapper ${sidebarCollapsed ? 'sidebar-wrapper--collapsed' : ''}`}>
          <Sidebar stats={stats} collapsed={sidebarCollapsed} onToggle={toggleSidebar} onBellClick={() => setShowNotifications(true)} />
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
              border: '1px solid rgba(248, 113, 113, 0.3)', borderRadius: '6px',
              margin: '8px 16px 0', color: '#f87171', fontSize: 'var(--fs-label)',
            }}>
              <span>{t('auth.syncPullFailed')}</span>
              <button className="rpg-button" onClick={retrySyncPull}
                style={{ padding: '4px 12px', fontSize: 'var(--fs-label)', flexShrink: 0 }}>
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
          {/* Flash layer */}
          <div
            data-levelup="flash"
            style={{
              position: 'absolute', inset: 0,
              background: 'radial-gradient(circle at center, rgba(255,245,212,0.9) 0%, rgba(212,160,23,0.6) 40%, transparent 70%)',
              opacity: 0, pointerEvents: 'none',
            }}
          />
          {/* God rays */}
          <div
            data-levelup="rays"
            style={{
              position: 'absolute',
              width: '150vmax', height: '150vmax',
              left: '50%', top: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'conic-gradient(from 0deg, transparent 0deg, rgba(212,160,23,0.15) 10deg, transparent 20deg, transparent 40deg, rgba(212,160,23,0.1) 50deg, transparent 60deg, transparent 80deg, rgba(212,160,23,0.15) 90deg, transparent 100deg, transparent 120deg, rgba(212,160,23,0.1) 130deg, transparent 140deg, transparent 160deg, rgba(212,160,23,0.15) 170deg, transparent 180deg, transparent 200deg, rgba(212,160,23,0.1) 210deg, transparent 220deg, transparent 240deg, rgba(212,160,23,0.15) 250deg, transparent 260deg, transparent 280deg, rgba(212,160,23,0.1) 290deg, transparent 300deg, transparent 320deg, rgba(212,160,23,0.15) 330deg, transparent 340deg, transparent 360deg)',
              borderRadius: '50%',
              opacity: 0, pointerEvents: 'none',
            }}
          />
          {/* Shockwave */}
          <div
            data-levelup="shockwave"
            style={{
              position: 'absolute',
              width: '120vmax', height: '120vmax',
              left: '50%', top: '50%',
              transform: 'translate(-50%, -50%) scale(0)',
              borderRadius: '50%',
              border: '3px solid rgba(212,160,23,0.5)',
              opacity: 0, pointerEvents: 'none',
            }}
          />
          {/* Text container */}
          <div
            data-levelup="text-container"
            style={{
              position: 'relative', zIndex: 2,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              opacity: 0, pointerEvents: 'none',
            }}
          >
            <div data-levelup="title" style={{
              fontFamily: "'UnifrakturCook', cursive",
              fontSize: 'clamp(2rem, 5vw, 3.5rem)',
              fontWeight: 'bold',
              color: 'var(--gold-light)',
              textShadow: '0 0 30px rgba(212,160,23,0.6), 0 2px 12px rgba(0,0,0,0.7)',
              display: 'flex', gap: 2,
            }}>
              {t('rpg.levelUp').split('').map((char, i) => (
                <span key={i} style={{ display: 'inline-block', whiteSpace: char === ' ' ? 'pre' : undefined }}>
                  {char}
                </span>
              ))}
            </div>
            <div data-levelup="level" style={{
              fontFamily: 'Fira Code, monospace',
              fontSize: 'clamp(1.2rem, 3vw, 2rem)',
              color: 'var(--gold)', marginTop: 8,
              textShadow: '0 0 20px rgba(212,160,23,0.4)',
            }}>
              {t('rpg.level')} {levelUp}
            </div>
            <div data-levelup="dismiss" style={{
              fontSize: 'var(--fs-label)', opacity: 0,
              marginTop: 16, color: 'var(--parch-0)',
            }}>
              {t('rpg.clickDismiss')}
            </div>
          </div>
        </div>
      )}

      {showQuickAdd && <QuickAdd onClose={() => setShowQuickAdd(false)} />}
      <ShortcutModal open={shortcutModalOpen} onClose={() => setShortcutModalOpen(false)} />

      <CauldronFloatingTimer />

        <NotificationCenter
          open={showNotifications}
          onClose={() => setShowNotifications(false)}
          onNavigate={animatedNavigate}
        />

      {/* Patch notes — shown once after version update */}
      <ChangelogModal
        open={showPatchNotes && patchEntries.length > 0}
        onClose={() => setShowPatchNotes(false)}
        title={t('settings.patchNotes', 'Patch Notes')}
        entries={patchEntries}
      />

      {/* Update popup */}
      {updateAvailable && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(44, 24, 16, 0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: 'linear-gradient(135deg, var(--leather) 0%, var(--leather) 100%)',
            border: '2px solid var(--gold-dark)',
            borderRadius: '6px', padding: '24px', maxWidth: 360,
            textAlign: 'center', color: 'var(--parch-0)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          }}>
            <h3 style={{ fontFamily: "'UnifrakturCook', cursive", marginBottom: 12, color: 'var(--gold-light)' }}>
              {t('settings.updateAvailable', { version: updateAvailable.version })}
            </h3>
            {updateState === 'downloading' && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 4, height: 8, overflow: 'hidden', marginBottom: 4 }}>
                  <div style={{ height: '100%', background: 'var(--moss)', width: `${downloadPercent}%`, transition: 'width 0.3s ease' }} />
                </div>
                <span style={{ fontSize: 'var(--fs-label)', opacity: 0.75 }}>{downloadPercent}%</span>
              </div>
            )}
            {updateError && (
              <p style={{ color: '#f87171', fontSize: 'var(--fs-label)', marginBottom: 8 }}>{updateError}</p>
            )}
            {updateState === 'idle' && (
              <>
                <button className="rpg-button" onClick={handleUpdate} style={{ width: '100%', marginBottom: 8 }}>
                  {t('settings.downloadUpdate')}
                </button>
                <button onClick={() => setUpdateAvailable(null)} className="rpg-button"
                  style={{ width: '100%', padding: '4px 8px', fontSize: 'var(--fs-label)', background: 'transparent', border: '1px solid var(--gold-dark)', color: 'var(--gold)' }}>
                  {t('nutrify.weightCheckin.later')}
                </button>
              </>
            )}
          </div>
        </div>
      )}

    </div>
    <TourOverlay />
    </TourProvider>
    </ToastProvider>
    </AnimatedNavigateContext.Provider>
  );
}

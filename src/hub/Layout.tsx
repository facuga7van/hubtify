import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import DesktopShell from './DesktopShell';
import MobileShell from './MobileShell';
import { useShellKind } from './useShellKind';
import UpdateNotification from './UpdateNotification';
import UpdateBanner from './UpdateBanner';
import type { PlayerStats } from '../../shared/types';
import { useAuthContext } from '../shared/AuthContext';
import { syncPush, syncPull, SYNC_PUSH_FAILED_EVENT } from '../shared/sync';
import './styles/layout.css';
import './styles/components.css';
import './styles/shell.css';
import { useKeyboardShortcuts } from '../shared/hooks/useKeyboardShortcuts';
import ShortcutModal from '../shared/components/ShortcutModal';
import QuickAdd from '../shared/components/QuickAdd';
import NotificationCenter from '../shared/components/NotificationCenter';
import ToastProvider from '../shared/components/ToastProvider';
import AnimatedOutlet, { AnimatedNavigateContext, useAnimatedNavigate, type AnimatedOutletHandle } from '../shared/components/AnimatedOutlet';
import CauldronFloatingTimer from '../modules/cauldron/components/CauldronFloatingTimer';
import { TourProvider, TourOverlay } from '../shared/components/tour';
import '../shared/components/tour/tour.css';
import '../shared/styles/help-bubble.css';
import { gsap } from 'gsap';
import { levelUp as animateLevelUp } from '../shared/animations/epic';
import ChangelogModal from '../shared/components/ChangelogModal';
import { changelog } from '../shared/changelog';
import { useModalA11y } from '../shared/hooks/useModalA11y';
import { useToast } from '../shared/components/useToast';
import CodexSealModal from './codex/CodexSealModal';
import { humanise, titleKey } from './codex/achievementCatalog';
import {
  CODEX_OPEN_EVENT,
  type CodexOpenDetail,
  isCodexModalOpen,
  localDateISO,
  onAchievementUnlocked,
} from './codex/codexApi';
import { createParticleBurst } from '../shared/animations/particles';
import { isNewerVersion } from '../shared/semver';

/** Never pull+push more often than this on window focus (ms). */
const FOCUS_SYNC_MIN_INTERVAL_MS = 3 * 60_000;
const LAST_PULL_KEY = 'hubtify_last_pull_at';

/**
 * Plegado a `false` por `define` en el renderer de Electron. OJO: esbuild solo
 * elimina un `import()` cuando la condición es la comparación LITERAL en el
 * mismo sitio, no a través de este const — el `import('../mobile/AndroidUpdateBanner')`
 * de abajo repite la comparación entera a propósito. Este const es para los
 * usos que NO guardan un import dinámico (por ejemplo, elegir qué banner
 * renderizar más abajo).
 */
const IS_ANDROID_BUILD = typeof __HUBTIFY_PLATFORM__ !== 'undefined' && __HUBTIFY_PLATFORM__ === 'android';

/**
 * Update in-app de Android (AndroidUpdateBanner.tsx): autocontenido, baja el
 * APK con progreso y abre el instalador nativo en vez del flujo viejo de
 * abrir Chrome. El `lazy(() => import(...))` queda condicionado al literal
 * de arriba para que esbuild pueda eliminar todo el módulo — y con él
 * `@capacitor/filesystem` y el plugin `ApkInstaller` — del bundle desktop.
 */
const AndroidUpdateBanner = typeof __HUBTIFY_PLATFORM__ !== 'undefined' && __HUBTIFY_PLATFORM__ === 'android'
  ? lazy(() => import('../mobile/AndroidUpdateBanner'))
  : null;

/**
 * Sync push failures were completely silent: the data simply never left the
 * device and nobody was told. useToast() only works under <ToastProvider/>,
 * which Layout renders inside its own tree, hence the tiny child component.
 */
function SyncPushFailedWatcher() {
  const { t } = useTranslation();
  const { toast } = useToast();
  useEffect(() => {
    const handler = () => {
      toast({
        message: t('auth.syncPushFailed', 'No pudimos guardar tus cambios en la nube. Seguimos intentando.'),
        type: 'warning',
      });
    };
    window.addEventListener(SYNC_PUSH_FAILED_EVENT, handler);
    return () => window.removeEventListener(SYNC_PUSH_FAILED_EVENT, handler);
  }, [t, toast]);
  return null;
}

/**
 * Same pattern as SyncPushFailedWatcher: processRpgEvent is called from four
 * modules, so the main process broadcasts 'rpg:pardonUsed' once and this single
 * listener turns it into the one discreet toast. Inn transitions arrive as a
 * window event from the toggle handler below (Layout itself sits above the
 * ToastProvider and cannot toast).
 */
/**
 * A pull that changed local rows has to reach every data component. Quests,
 * nutrition and cauldron listen to their `sync:*Updated` events; Coinify's
 * components only ever listened to `finance:dataChanged` (their own mutation
 * event), so a transaction synced from another device stayed invisible until
 * the next manual action. That event also feeds the debounced push — a
 * redundant push right after pull+push, cheap and idempotent, accepted over
 * touching every finance component.
 */
function announcePulledData(): void {
  window.dispatchEvent(new Event('sync:questsUpdated'));
  window.dispatchEvent(new Event('sync:nutritionUpdated'));
  window.dispatchEvent(new Event('sync:cauldronUpdated'));
  window.dispatchEvent(new Event('finance:dataChanged'));
  window.dispatchEvent(new Event('finance:accountsChanged'));
}

function RpgMomentsWatcher() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const animatedNavigate = useAnimatedNavigate();
  /** Messages of achievement toasts still on screen, for click-to-navigate. */
  const achievementToastsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const offPardon = window.api.onRpgPardonUsed?.(() => {
      toast({
        message: t('rpg.pardonUsed', 'Se usó un indulto: tu racha sigue intacta.'),
        type: 'info',
      });
    });
    const innHandler = (e: Event) => {
      const on = (e as CustomEvent<{ on: boolean }>).detail?.on;
      toast({
        message: on
          ? t('rpg.innEntered', 'Descansás en la Posada. La racha te espera.')
          : t('rpg.innWelcomeBack', 'De vuelta a la aventura. La racha retoma donde estaba.'),
        type: on ? 'info' : 'success',
      });
    };
    window.addEventListener('rpg:innChanged', innHandler);
    return () => {
      offPardon?.();
      window.removeEventListener('rpg:innChanged', innHandler);
    };
  }, [t, toast]);

  /* ── achievement backfill ───────────────────────────
     One silent sweep of the whole catalog against rpg_events, on boot and on
     every account switch: history earned before the catalog existed (or on
     another machine, arriving via sync) gets its medallions without waiting
     for the lazy sweep to trip over them. Fire-and-forget — the shelf listens
     for the unlock broadcasts this may emit. */
  useEffect(() => {
    const sweep = () => { window.api.rpgBackfillAchievements?.().catch(() => {}); };
    sweep();
    window.addEventListener('account:switched', sweep);
    return () => window.removeEventListener('account:switched', sweep);
  }, []);

  /* ── achievement unlocks ────────────────────────────
     Suppressed entirely while the Codex modal is up: a seal that unlocks
     something shows it INSIDE its own ceremony, and a toast landing on top of
     that ceremony would announce the same thing twice. The flag lives on
     `window` (see codexApi.setCodexModalOpen) because this callback never
     re-renders and the modal is a sibling, not a descendant. */
  useEffect(() => {
    const off = onAchievementUnlocked((id) => {
      // Let the rest of the app know regardless — the shelf refreshes on it.
      window.dispatchEvent(new CustomEvent('rpg:achievementUnlocked', { detail: { id } }));
      if (isCodexModalOpen()) return;

      const title = t(titleKey(id), humanise(id));
      const message = t('rpg.achievements.unlockedToast', {
        title,
        defaultValue: 'Logro desbloqueado: {{title}}',
      });
      toast({ message, type: 'success' });

      const seen = achievementToastsRef.current;
      seen.add(message);
      setTimeout(() => seen.delete(message), 12_000);

      // A pinch of gold on the nav item it belongs to — cheap, and it points
      // at where the medallion just landed. Skipped under reduced motion.
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const anchor = document.querySelector<HTMLElement>('[data-codex-nav="achievements"] .sidebar-nav-item__ico');
        if (anchor) createParticleBurst({ parent: anchor, count: 10 }).start();
      }
    });
    return () => off();
  }, [t, toast]);

  /* ── achievements recognised from history ─────────
     The boot/account-switch backfill can unlock dozens of medallions at once
     (first run after an update). It pays nothing and sends ONE aggregated
     broadcast — one quiet toast here, plus the shelf-refresh event, instead
     of N toasts, N bursts and a phantom level-up. */
  useEffect(() => {
    const off = window.api.onRpgAchievementsBackfilled?.((ids) => {
      if (!ids.length) return;
      for (const id of ids) {
        window.dispatchEvent(new CustomEvent('rpg:achievementUnlocked', { detail: { id } }));
      }
      if (isCodexModalOpen()) return;
      toast({
        message: t('rpg.achievements.backfilledToast', { n: ids.length, defaultValue: '{{n}} logros reconocidos de tu historia' }),
        type: 'info',
      });
    });
    return () => off?.();
  }, [t, toast]);

  /* Toast.tsx hard-wires its own onClick to onDismiss and takes no action
     prop, and `src/shared/components/**` is outside this pass. So the "click
     the toast to see the shelf" behaviour is delegated from here: we remember
     the exact message we emitted and route when a click lands on a toast card
     carrying it. Unique per unlock, and it goes away the day Toast grows a
     real action prop. */
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (achievementToastsRef.current.size === 0) return;
      const target = e.target as HTMLElement | null;
      const card = target?.closest('.system-toast-container > div');
      if (!card) return;
      const text = card.textContent ?? '';
      const hit = [...achievementToastsRef.current].find((m) => text.includes(m));
      if (!hit) return;
      achievementToastsRef.current.delete(hit);
      animatedNavigate('/achievements');
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [animatedNavigate]);

  return null;
}

export default function Layout() {
  const { t, i18n } = useTranslation();
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [levelUp, setLevelUp] = useState<number | null>(null);
  const prevLevelRef = useRef<number>(0);

  const { user: authUser } = useAuthContext();
  const outletHandleRef = useRef<AnimatedOutletHandle>(null);
  const animatedNavigate = useCallback((to: string) => {
    outletHandleRef.current?.animatedNavigate(to)
  }, []);

  const { shortcutModalOpen, setShortcutModalOpen } = useKeyboardShortcuts();

  const shellKind = useShellKind();
  const Shell = shellKind === 'mobile' ? MobileShell : DesktopShell;

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

  /* The Cierre del Códice. Layout owns it so the sidebar invitation, the
     dashboard brief and the seal strip can all reach it with one window event
     instead of threading state through three components. */
  const [codexDate, setCodexDate] = useState<string | null>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<CodexOpenDetail>).detail;
      setCodexDate(detail?.date ?? localDateISO());
    };
    window.addEventListener(CODEX_OPEN_EVENT, handler);
    return () => window.removeEventListener(CODEX_OPEN_EVENT, handler);
  }, []);

  // Auto-updater
  const [syncError, setSyncError] = useState(false);

  const [updateAvailable, setUpdateAvailable] = useState<{ version: string } | null>(null);
  const [updateState, setUpdateState] = useState<'idle' | 'downloading' | 'ready'>('idle');
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [showUpdateDetails, setShowUpdateDetails] = useState(false);

  // Desktop-only: Android ya no pasa por acá — tiene su propio flujo
  // autocontenido en AndroidUpdateBanner.tsx (descarga in-app + instalador
  // nativo, en vez de abrir Chrome). Ver el render más abajo.
  const handleUpdate = useCallback(async () => {
    setUpdateState('downloading');
    setUpdateError(null);
    try {
      await window.api.updaterDownload?.();
      setUpdateState('ready'); // staged — user chooses when to restart
    } catch { setUpdateState('idle'); }
  }, []);

  const handleRestart = useCallback(() => {
    window.api.updaterRestart?.();
  }, []);

  // Dismiss the banner and remember this version so it isn't shown again until
  // a newer one ships.
  const handleDismissUpdate = useCallback(() => {
    setUpdateAvailable((cur) => {
      if (cur) localStorage.setItem('hubtify_update_dismissed_version', cur.version);
      return null;
    });
  }, []);

  // Decide whether to surface an update given the user's preference + snooze.
  // 'off' suppresses everything; a dismissed version stays hidden; 'auto' starts
  // the download right away so only the banner's 'ready' state is shown.
  // Desktop-only now (see handleUpdate comment above).
  const considerUpdate = useCallback((version: string) => {
    const mode = localStorage.getItem('hubtify_update_mode') || 'notify';
    if (mode === 'off') return;
    if (localStorage.getItem('hubtify_update_dismissed_version') === version) return;
    setUpdateAvailable({ version });
    if (mode === 'auto') handleUpdate();
  }, [handleUpdate]);

  useEffect(() => {
    const c1 = window.api.onUpdateAvailable((info) => considerUpdate(info.version));
    const c2 = window.api.onDownloadProgress((info) => setDownloadPercent(info.percent));
    const c3 = window.api.onUpdateError((info) => setUpdateError(info.message));
    const c4 = window.api.onUpdateDownloaded(() => setUpdateState('ready'));

    // Desktop-only: on Android `updaterCheck` doesn't exist on window.api and
    // this resolves to undefined right away, so it's a silent no-op there —
    // AndroidUpdateBanner runs its own check independently.
    const check = () => {
      window.api.updaterCheck?.().then((res: { available?: boolean; version?: string }) => {
        if (res?.available && res.version) considerUpdate(res.version);
      }).catch(() => { /* not available in dev */ });
    };

    // Check on mount (the passive listener may miss a message fired before React
    // mounted) and every 6 hours for long-running sessions.
    check();
    const interval = setInterval(check, 6 * 60 * 60 * 1000);

    return () => { c1(); c2(); c3(); c4(); clearInterval(interval); };
  }, [considerUpdate]);

  // Ctrl+K to open quick add. It was Ctrl+Q, which is Quit on macOS/Linux, and
  // it fired while typing — the INPUT/TEXTAREA guard is the same one
  // useKeyboardShortcuts already has.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.target as HTMLElement | null)?.isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
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

  const handleToggleInn = useCallback(async () => {
    const current = stats?.innSince ?? null;
    const res = await window.api.rpgSetInnMode(!current);
    window.dispatchEvent(new CustomEvent('rpg:innChanged', { detail: { on: !!res.innSince } }));
    window.dispatchEvent(new Event('rpg:statsChanged'));
  }, [stats?.innSince]);

  const refreshStats = useCallback(() => {
    window.api.getRpgStats().then(setStats).catch(() => { /* Stats refresh is non-critical */ });
  }, []);

  // Was [location.pathname, refreshStats]: every tab change inside Finance
  // re-read the stats. The 'rpg:statsChanged' listener below covers the real case.
  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  // Listen for stats refresh requests from child components
  useEffect(() => {
    const handler = () => refreshStats();
    window.addEventListener('rpg:statsChanged', handler);
    return () => window.removeEventListener('rpg:statsChanged', handler);
  }, [refreshStats]);

  // Debounced push sync — triggers 30s after last data change
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncGenRef = useRef(0);
  const debouncedPush = useCallback(() => {
    if (!authUser) return;
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    const gen = syncGenRef.current;
    syncTimeoutRef.current = setTimeout(async () => {
      if (syncGenRef.current !== gen) return;
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
      syncGenRef.current += 1;
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
      const gen = syncGenRef.current;
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      try {
        if (syncGenRef.current !== gen) return;
        await syncPush(authUser.uid);
      } catch { /* Silent fail */ }
    };
    const onFocus = async () => {
      const gen = syncGenRef.current;
      // Every alt-tab back used to fire a full pull AND a full push — dozens of
      // round-trips an hour. Throttle on the timestamp syncPull already writes.
      try {
        const last = localStorage.getItem(LAST_PULL_KEY);
        if (last) {
          const age = Date.now() - new Date(last).getTime();
          if (Number.isFinite(age) && age >= 0 && age < FOCUS_SYNC_MIN_INTERVAL_MS) return;
        }
      } catch { /* storage unavailable — sync anyway */ }
      try {
        if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
        if (syncGenRef.current !== gen) return;
        // Pull BEFORE push: external writes land locally first, then the
        // (per-record merged) push uploads the combined state
        const result = await syncPull(authUser.uid);
        if (syncGenRef.current !== gen) return;
        await syncPush(authUser.uid);
        if (syncGenRef.current !== gen) return;
        const freshStats = await window.api.getRpgStats();
        if (freshStats) prevLevelRef.current = freshStats.level;
        setStats(freshStats);
        if (result.changed) announcePulledData();
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
    for (const mod of ['quests', 'nutrition', 'finance', 'cauldron']) {
      const modEnabled = localStorage.getItem(`hubtify_notifications_module_${mod}`) !== 'false';
      window.api.notificationsSetModuleEnabled?.(mod, modEnabled);
    }
    window.api.notificationsRunCheck?.();
  }, []);

  const retrySyncPull = useCallback(async () => {
    if (!authUser) return;
    const gen = syncGenRef.current;
    setSyncError(false);
    try {
      const lastUid = await window.api.syncGetCurrentUser();
      if (syncGenRef.current !== gen) return;
      if (lastUid && lastUid !== authUser.uid) {
        await window.api.syncClearUserData();
      }
      if (syncGenRef.current !== gen) return;
      await window.api.syncSetCurrentUser(authUser.uid);
      const result = await syncPull(authUser.uid);
      if (syncGenRef.current !== gen) return;
      const freshStats = await window.api.getRpgStats();
      if (freshStats) prevLevelRef.current = freshStats.level;
      setStats(freshStats);
      if (result.changed) announcePulledData();
    } catch {
      if (syncGenRef.current !== gen) return;
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
    <SyncPushFailedWatcher />
    <RpgMomentsWatcher />
    <TourProvider>
    <div className="shell-frame">
      <Shell stats={stats} onBellClick={() => setShowNotifications(true)} onToggleInn={handleToggleInn}>
        {syncError && (
          <div role="alert" style={{
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
      </Shell>

      {/* Level-up epic overlay — always in DOM when levelUp != null, hidden via display:none until GSAP shows it */}
      {levelUp !== null && (
        <div
          ref={levelUpOverlayRef}
          onClick={handleDismissLevelUp}
          style={{
            position: 'fixed', inset: 0, display: 'none',
            alignItems: 'center', justifyContent: 'center',
            background: 'rgba(58, 35, 18, 0.88)',
            zIndex: 5000, cursor: 'pointer',
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

      {codexDate && (
        <CodexSealModal
          date={codexDate}
          onClose={() => setCodexDate(null)}
          onSelectDate={setCodexDate}
        />
      )}

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

      {/* Android: banner autocontenido (descarga in-app + instalador nativo).
          Desktop: banner discreto + modal de novedades de siempre. */}
      {IS_ANDROID_BUILD && AndroidUpdateBanner ? (
        <Suspense fallback={null}>
          <AndroidUpdateBanner />
        </Suspense>
      ) : (
        <>
          {updateAvailable && (
            <UpdateBanner
              version={updateAvailable.version}
              state={updateState}
              percent={downloadPercent}
              error={updateError}
              onViewDetails={() => setShowUpdateDetails(true)}
              onRestart={handleRestart}
              onDismiss={handleDismissUpdate}
            />
          )}
          {/* Full changelog modal — opened from the banner's "View what's new" */}
          {updateAvailable && showUpdateDetails && (
            <UpdateNotification
              version={updateAvailable.version}
              state={updateState}
              percent={downloadPercent}
              error={updateError}
              onDownload={() => { handleUpdate(); setShowUpdateDetails(false); }}
              onRestart={handleRestart}
              onDismiss={() => setShowUpdateDetails(false)}
            />
          )}
        </>
      )}

    </div>
    <TourOverlay />
    </TourProvider>
    </ToastProvider>
    </AnimatedNavigateContext.Provider>
  );
}

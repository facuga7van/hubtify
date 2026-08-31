import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PlayerCard from './PlayerCard';
import type { PlayerStats } from '../../shared/types';
import { TITLE_THRESHOLDS } from '../../shared/types';
import { xpThreshold } from '../../shared/rpg-engine';
import { useAnimatedNavigate } from '../shared/components/AnimatedOutlet';
import { Scroll, Shield, Sword, Bread, Coin, Cauldron, Chalice, MoonCrescent } from '../shared/components/icons';
import { SealRosette } from './codex/CodexSealIcons';
import { useSealInvite } from './codex/useSealInvite';
import { openCodex } from './codex/codexApi';
import Tooltip from '../shared/components/Tooltip';
import { useVisibleInterval } from '../shared/hooks/useVisibleInterval';
import './styles/layout.css';
import './styles/codex-seal.css';

const STREAK_BAR_SCALE = 3.3; // 30 days = ~100% width

interface SidebarProps { stats: PlayerStats | null; collapsed: boolean; onBellClick?: () => void; onToggleInn?: () => void; }

/** Badge counts for sidebar nav items */
interface SidebarBadges {
  questsOverdue: number;
  nutritionNoMeals: boolean;
}

/** Given current level, find the next title threshold and return info */
function getNextRank(level: number): { nextTitleKey: string; nextTitleFallback: string; levelsAway: number } | null {
  // TITLE_THRESHOLDS is sorted descending: [50, key, fallback], ...
  for (let i = TITLE_THRESHOLDS.length - 1; i >= 0; i--) {
    const [threshold, key, fallback] = TITLE_THRESHOLDS[i];
    if (threshold > level) {
      return { nextTitleKey: key, nextTitleFallback: fallback, levelsAway: threshold - level };
    }
  }
  return null; // Already at max rank
}

const NAV_ICONS: Record<string, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  scroll: Scroll,
  shield: Shield,
  sword: Sword,
  bread: Bread,
  coin: Coin,
  cauldron: Cauldron,
  chalice: Chalice,
};

function SettingsIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width={24} height={24} fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/>
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H10a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V10c.26.6.77 1.02 1.51 1.08H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
    </svg>
  );
}

/* `label` used to carry hardcoded Spanish strings ('TABLA', 'MISIONES', …) that
   no render ever read — every item goes through t(item.key). They are gone.
   'Logros' and 'Aldea' were `comingSoon: true`: rendered at opacity .4 on
   leather (~2:1 contrast) as focusable <button>s that did nothing on Enter, and
   they ate 2 of the 7 main-menu slots. Out until they exist. */
const navKeys: Array<{ path: string; key: string; icon: string }> = [
  { path: '/', key: 'nav.home', icon: 'scroll' },
  { path: '/quests', key: 'nav.questify', icon: 'sword' },
  { path: '/nutrition', key: 'nav.nutrify', icon: 'bread' },
  { path: '/finance', key: 'nav.coinify', icon: 'coin' },
  { path: '/cauldron', key: 'nav.cauldron', icon: 'cauldron' },
  /* 'Logros' was pulled from this list while it was vapour (a focusable button
     at opacity .4 that did nothing). The shelf exists now, so it is back —
     Chalice, because a footed cup already IS the trophy in this icon family. */
  { path: '/achievements', key: 'nav.achievements', icon: 'chalice' },
];

const bottomNavKeys: Array<{ path: string; key: string; icon: string }> = [
  { path: '/character', key: 'nav.character', icon: 'shield' },
];

export default function Sidebar({ stats, collapsed, onBellClick, onToggleInn }: SidebarProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const animatedNavigate = useAnimatedNavigate();
  const [badges, setBadges] = useState<SidebarBadges>({ questsOverdue: 0, nutritionNoMeals: false });
  const [cauldronHidden, setCauldronHidden] = useState(false);
  const { invite } = useSealInvite();

  // Listen for floating timer visibility changes
  useEffect(() => {
    const handler = (e: Event) => {
      const { hidden, active } = (e as CustomEvent).detail;
      setCauldronHidden(hidden && active);
    };
    window.addEventListener('cauldron:floating-visibility', handler);
    return () => window.removeEventListener('cauldron:floating-visibility', handler);
  }, []);

  const loadBadges = useCallback(() => {
    Promise.all([
      window.api.questsGetOverdueCount(),
      window.api.nutritionGetTodayMealsCount(),
    ]).then(([overdue, mealsCount]) => {
      setBadges({ questsOverdue: overdue, nutritionNoMeals: mealsCount === 0 });
    }).catch(() => { /* silent */ });
  }, []);

  // Load badges on mount + periodic refresh (30s), paused while the window is
  // hidden — see useVisibleInterval.
  useEffect(() => { loadBadges(); }, [loadBadges]);
  useVisibleInterval(loadBadges, 30_000);

  // Refresh on account switch + data changes that affect badges
  useEffect(() => {
    const handler = () => loadBadges();
    window.addEventListener('account:switched', handler);
    window.addEventListener('rpg:statsChanged', handler);
    return () => {
      window.removeEventListener('account:switched', handler);
      window.removeEventListener('rpg:statsChanged', handler);
    };
  }, [loadBadges]);

  const isActive = (path: string) =>
    location.pathname === path || (path !== '/' && location.pathname.startsWith(path));

  // H2: Next rank calculation
  const nextRank = stats ? getNextRank(stats.level) : null;

  return (
    <aside id="main-sidebar" className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      <div data-tour="player-card">
        <PlayerCard stats={stats} collapsed={collapsed} onBellClick={() => onBellClick?.()} />

        {/* Stat bars — visible only when expanded */}
        {stats && (() => {
          const xpCurrent = xpThreshold(stats.level);
          const xpNext = xpThreshold(stats.level + 1);
          const xpProgress = xpNext > xpCurrent
            ? Math.round(((stats.xp - xpCurrent) / (xpNext - xpCurrent)) * 100)
            : 100;

          return (
          <div className="sidebar-bars">
            <div className="sidebar-bar">
              <div className="sidebar-bar__row">
                <span className="sidebar-bar__label" title={t('rpg.vigorHint', 'Se recupera cada mañana. Es el estado del día, no una deuda.')}>{t('rpg.vigor', 'VIGOR')}</span>
                <span className="sidebar-bar__val">{stats.hp} / {stats.maxHp}</span>
              </div>
              <div className="sidebar-bar__track">
                <div className="sidebar-bar__fill sidebar-bar__fill--hp" style={{ width: `${Math.round((stats.hp / stats.maxHp) * 100)}%` }} />
              </div>
            </div>
            <div className="sidebar-bar">
              <div className="sidebar-bar__row">
                <span className="sidebar-bar__label">XP</span>
                <span className="sidebar-bar__val">{stats.xp} / {xpNext}</span>
              </div>
              <div className="sidebar-bar__track">
                <div className="sidebar-bar__fill sidebar-bar__fill--xp" style={{ width: `${xpProgress}%` }} />
              </div>
            </div>
            {nextRank && (
              <div className="sidebar-bar__next-rank">
                {nextRank.levelsAway} {nextRank.levelsAway === 1
                  ? t('sidebar.levelTo', 'nivel para')
                  : t('sidebar.levelsTo', 'niveles para')} <span className="sidebar-bar__next-rank-title">{t(nextRank.nextTitleKey, nextRank.nextTitleFallback)}</span>
              </div>
            )}
            {(stats.streak > 0 || stats.innSince) && (
              <div className={`sidebar-bar${stats.innSince ? ' sidebar-bar--resting' : ''}`}>
                <div className="sidebar-bar__row">
                  <span className="sidebar-bar__label">
                    {stats.innSince
                      ? t('rpg.innResting', 'EN LA POSADA')
                      : t('rpg.streak', 'RACHA').toUpperCase()}
                  </span>
                  <span className="sidebar-bar__val">
                    {stats.streak} {t('rpg.days', 'días')}
                    {stats.bestStreak > stats.streak && (
                      <span className="sidebar-streak__best" title={t('rpg.bestStreak', 'Mejor racha')}>
                        {' '}· {t('rpg.bestShort', 'récord')} {stats.bestStreak}
                      </span>
                    )}
                  </span>
                </div>
                <div className="sidebar-bar__track">
                  <div className="sidebar-bar__fill sidebar-bar__fill--gold" style={{ width: `${Math.min(stats.streak * STREAK_BAR_SCALE, 100)}%` }} />
                </div>
                <div className="sidebar-streak__meta">
                  <span
                    className="sidebar-streak__pardons"
                    title={t('rpg.pardonsHint', 'Indultos del mes: si te salteás un solo día, se usa uno solo y la racha sigue.')}
                  >
                    <Shield width={11} height={11} />
                    {' '}{stats.pardonsRemaining ?? 0}/2
                  </span>
                  <button
                    type="button"
                    className="sidebar-streak__inn tap-target"
                    onClick={() => onToggleInn?.()}
                    title={stats.innSince
                      ? t('rpg.innLeave', 'Salir de la Posada: la racha retoma donde estaba.')
                      : t('rpg.innHint', 'Vacaciones sin culpa: la racha no avanza ni se rompe hasta que vuelvas.')}
                    aria-pressed={!!stats.innSince}
                  >
                    <MoonCrescent width={12} height={12} />
                    <span>{stats.innSince ? t('rpg.innLeaveShort', 'Volver') : t('rpg.inn', 'Posada')}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
          );
        })()}

        {/* The invitation to close the day. It sits OUTSIDE .sidebar-bars on
            purpose: that block is capped at max-height 0 while the rail is
            collapsed, and the invitation has to survive a collapse (reduced to
            the wax alone, with a tooltip). Discreet by design — a warm offer
            under the streak, never a modal that interrupts. */}
        {invite && (() => {
          const headline = invite.which === 'yesterday'
            ? t('rpg.sealInviteYesterday', 'Te quedó ayer sin sellar')
            : t('rpg.sealInvite', 'Sellar el día');
          const btn = (
            <button
              type="button"
              className="sidebar-seal-invite tap-target"
              onClick={() => openCodex(invite.date)}
              title={headline}
            >
              <span className="sidebar-seal-invite__wax" aria-hidden="true">
                <SealRosette width={14} height={14} />
              </span>
              <span className="sidebar-seal-invite__text">
                <span>{headline}</span>
                <span className="sidebar-seal-invite__sub">
                  {t('rpg.sealInviteSub', { n: invite.eventsCount, defaultValue: '{{n}} hechos por cerrar' })}
                </span>
              </span>
            </button>
          );
          return (
            <div className="sidebar-seal-invite-slot">
              {collapsed ? <Tooltip text={headline}>{btn}</Tooltip> : btn}
            </div>
          );
        })()}
      </div>

      <div className="sidebar-divider" />

      {/* Nav */}
      <nav className="sidebar-nav" data-tour="sidebar" aria-label={t('hub.mainNavigation', 'Navegación principal')}>
        {navKeys.map((item) => {
          const IconComp = NAV_ICONS[item.icon];
          // H1: Badge logic per nav item
          let badgeCount = 0;
          let badgeDot = false;
          if (item.path === '/quests') badgeCount = badges.questsOverdue;
          if (item.path === '/nutrition') badgeDot = badges.nutritionNoMeals;

          const navItem = (
            <button
              key={item.path}
              className={`sidebar-nav-item ${isActive(item.path) ? 'active' : ''}`}
              aria-current={isActive(item.path) ? 'page' : undefined}
              /* anchor for the unlock spark fired from Layout's watcher */
              data-codex-nav={item.path === '/achievements' ? 'achievements' : undefined}
              onClick={() => animatedNavigate(item.path)}
            >
              <span className="sidebar-nav-item__ico">
                {IconComp && <IconComp width={18} height={18} />}
                {badgeCount > 0 && (
                  <span className="sidebar-badge sidebar-badge--count">{badgeCount > 9 ? '9+' : badgeCount}</span>
                )}
                {badgeDot && !badgeCount && (
                  <span className="sidebar-badge sidebar-badge--dot" />
                )}
              </span>
              <span className="sidebar-nav-item__label">{t(item.key)}</span>
            </button>
          );
          if (collapsed) {
            return <Tooltip key={item.path} text={t(item.key)}>{navItem}</Tooltip>;
          }
          return navItem;
        })}
      </nav>

      <div className="sidebar-divider" />

      {/* Bottom nav: Character + Settings */}
      <nav className="sidebar-settings-area" aria-label={t('hub.settingsNavigation', 'Configuración')}>
        {bottomNavKeys.map((item) => {
          const IconComp = NAV_ICONS[item.icon];
          const btn = (
            <button
              key={item.path}
              className={`sidebar-nav-item ${isActive(item.path) ? 'active' : ''}`}
              aria-current={isActive(item.path) ? 'page' : undefined}
              onClick={() => animatedNavigate(item.path)}
            >
              <span className="sidebar-nav-item__ico">
                {IconComp && <IconComp width={18} height={18} />}
              </span>
              <span className="sidebar-nav-item__label">{t(item.key)}</span>
            </button>
          );
          return collapsed
            ? <Tooltip key={item.path} text={t(item.key)}>{btn}</Tooltip>
            : btn;
        })}
        {(() => {
          const settingsBtn = (
            <button
              className={`sidebar-nav-item ${isActive('/settings') ? 'active' : ''}`}
              aria-current={isActive('/settings') ? 'page' : undefined}
              onClick={() => animatedNavigate('/settings')}
              data-tour="settings"
            >
              <span className="sidebar-nav-item__ico">
                <SettingsIcon width={18} height={18} />
              </span>
              <span className="sidebar-nav-item__label">{t('nav.settings')}</span>
            </button>
          );
          return collapsed
            ? <Tooltip text={t('nav.settings')}>{settingsBtn}</Tooltip>
            : settingsBtn;
        })()}
        {cauldronHidden && (() => {
          const showTimerBtn = (
            <button
              className="sidebar-nav-item sidebar-nav-item--cauldron-toggle"
              onClick={() => window.dispatchEvent(new Event('cauldron:show-floating'))}
            >
              <span className="sidebar-nav-item__ico">
                <Cauldron width={18} height={18} />
                <span className="sidebar-badge sidebar-badge--dot" />
              </span>
              <span className="sidebar-nav-item__label">{t('cauldron.showTimer', 'Mostrar temporizador')}</span>
            </button>
          );
          return collapsed
            ? <Tooltip text={t('cauldron.showTimer', 'Mostrar temporizador')}>{showTimerBtn}</Tooltip>
            : showTimerBtn;
        })()}
      </nav>

      {/* Footer — combo + language toggle */}
      <div className="sidebar-footer">
        {stats && stats.dailyCombo > 0 && (
          <div className="sidebar-footer__combo">
            <span className="sidebar-footer__combo-num">
              ×{[1.0, 1.25, 1.5, 1.75, 2.0][Math.min(Math.max(stats.dailyCombo - 1, 0), 4)]}
            </span>
            <span className="sidebar-footer__combo-txt">{t('rpg.todayCombo', 'Combo de Hoy')}</span>
          </div>
        )}
        {/* The ES/EN toggle that used to live here duplicated Settings > Apariencia
            and, collapsed, became invisible but still tabbable. Removed. */}
        <div className="sidebar-footer__bottom">
          {!collapsed && (
            <div style={{ fontSize: 'var(--fs-label)', fontFamily: "'Fira Code', monospace", opacity: 0.5, color: 'var(--parch-0)' }}>
              v{APP_VERSION}
            </div>
          )}
        </div>
      </div>

    </aside>
  );
}

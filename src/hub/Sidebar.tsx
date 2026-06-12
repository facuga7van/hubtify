import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PlayerCard from './PlayerCard';
import type { PlayerStats } from '../../shared/types';
import { TITLE_THRESHOLDS } from '../../shared/types';
import { xpThreshold } from '../../shared/rpg-engine';
import { useAnimatedNavigate } from '../shared/components/AnimatedOutlet';
import { Scroll, Shield, Sword, Bread, Coin, Crown, Tower, Cauldron } from '../shared/components/icons';
import Tooltip from '../shared/components/Tooltip';
import './styles/layout.css';

const STREAK_BAR_SCALE = 3.3; // 30 days = ~100% width

interface SidebarProps { stats: PlayerStats | null; collapsed: boolean; onToggle?: () => void; onBellClick?: () => void; }

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
  crown: Crown,
  tower: Tower,
};

function SettingsIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width={24} height={24} fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/>
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H10a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V10c.26.6.77 1.02 1.51 1.08H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
    </svg>
  );
}

const navKeys: Array<{ path: string; key: string; icon: string; label: string; comingSoon?: boolean }> = [
  { path: '/', key: 'nav.home', icon: 'scroll', label: 'TABLA' },
  { path: '/quests', key: 'nav.questify', icon: 'sword', label: 'MISIONES' },
  { path: '/nutrition', key: 'nav.nutrify', icon: 'bread', label: 'PROVISIONES' },
  { path: '/finance', key: 'nav.coinify', icon: 'coin', label: 'TESORO' },
  { path: '/cauldron', key: 'nav.cauldron', icon: 'cauldron', label: 'CALDERO' },
  { path: '/achievements', key: 'nav.achievements', icon: 'crown', label: 'LOGROS', comingSoon: true },
  { path: '/village', key: 'nav.village', icon: 'tower', label: 'ALDEA', comingSoon: true },
];

const bottomNavKeys: Array<{ path: string; key: string; icon: string; label: string }> = [
  { path: '/character', key: 'nav.character', icon: 'shield', label: 'HÉROE' },
];

export default function Sidebar({ stats, collapsed, onToggle, onBellClick }: SidebarProps) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const animatedNavigate = useAnimatedNavigate();
  const [badges, setBadges] = useState<SidebarBadges>({ questsOverdue: 0, nutritionNoMeals: false });
  const [cauldronHidden, setCauldronHidden] = useState(false);

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

  // Load badges on mount + periodic refresh (30s)
  useEffect(() => {
    loadBadges();
    const interval = setInterval(loadBadges, 30_000);
    return () => clearInterval(interval);
  }, [loadBadges]);

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
                <span className="sidebar-bar__label">VITA</span>
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
            {stats.streak > 0 && (
              <div className="sidebar-bar">
                <div className="sidebar-bar__row">
                  <span className="sidebar-bar__label">{t('rpg.streak', 'RACHA').toUpperCase()}</span>
                  <span className="sidebar-bar__val">{stats.streak} {t('rpg.days', 'días')}</span>
                </div>
                <div className="sidebar-bar__track">
                  <div className="sidebar-bar__fill sidebar-bar__fill--gold" style={{ width: `${Math.min(stats.streak * STREAK_BAR_SCALE, 100)}%` }} />
                </div>
              </div>
            )}
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
              className={`sidebar-nav-item ${isActive(item.path) ? 'active' : ''} ${item.comingSoon ? 'sidebar-nav-item--disabled' : ''}`}
              aria-current={isActive(item.path) ? 'page' : undefined}
              onClick={item.comingSoon ? undefined : () => animatedNavigate(item.path)}
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
          if (item.comingSoon) {
            return <Tooltip key={item.path} text={`${t(item.key)} (${t('common.comingSoon')})`}>{navItem}</Tooltip>;
          }
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
        <div className="sidebar-footer__bottom">
          {!collapsed && (
            <div style={{ fontSize: 'var(--fs-label)', fontFamily: "'Fira Code', monospace", opacity: 0.5, color: 'var(--parch-0)' }}>
              v{APP_VERSION}
            </div>
          )}
          <button onClick={() => {
            const newLang = i18n.language === 'es' ? 'en' : 'es';
            i18n.changeLanguage(newLang);
            localStorage.setItem('hubtify_lang', newLang);
          }} className="sidebar-footer__lang" aria-label={t('nav.switchLanguage', 'Cambiar idioma')}>
            {i18n.language === 'es' ? 'ES' : 'EN'}
          </button>
        </div>
      </div>

    </aside>
  );
}

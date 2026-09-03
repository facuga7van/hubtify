import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PlayerCard from './PlayerCard';
import type { PlayerStats } from '../../shared/types';
import { TITLE_THRESHOLDS } from '../../shared/types';
import { xpThreshold } from '../../shared/rpg-engine';
import { useAnimatedNavigate } from '../shared/components/AnimatedOutlet';
import { Scroll, Shield, Sword, Bread, Coin, Cauldron, Chalice, Bag, MoonCrescent } from '../shared/components/icons';
import { SealRosette } from './codex/CodexSealIcons';
import { useSealInvite } from './codex/useSealInvite';
import { openCodex } from './codex/codexApi';
import Tooltip from '../shared/components/Tooltip';
import HelpBubble from '../shared/components/HelpBubble';
import { useVisibleInterval } from '../shared/hooks/useVisibleInterval';
import './styles/layout.css';
import './styles/codex-seal.css';
/* El sello de ayuda del Vigor vive en el riel: la hoja tiene que viajar con
   el componente y no depender de que Layout la haya importado antes. */
import '../shared/styles/help-bubble.css';

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
  bag: Bag,
};

/* Respaldo por si una clave todavía no llegó al bundle de idioma: `t()` con
   fallback vacío devolvería la clave cruda («nav.homeDesc») como nombre
   accesible, que es peor que no tener descripción. */
const NAV_DESC_FALLBACKS: Record<string, string> = {
  'nav.homeDesc': 'Tu día de un vistazo — la Tabla del Aventurero',
  'nav.questifyDesc': 'Misiones y hábitos — el Libro de Misiones',
  'nav.nutrifyDesc': 'Comidas y calorías — el Diario de Provisiones',
  'nav.coinifyDesc': 'Gastos, ingresos y presupuesto — el Libro del Tesorero',
  'nav.cauldronDesc': 'Temporizador de enfoque, al estilo Pomodoro',
  'nav.achievementsDesc': 'Los logros que fuiste desbloqueando',
  'nav.rewardsDesc': 'Canjeá tus óbolos por premios que elegís vos',
  'nav.characterDesc': 'Tu ficha: nivel, virtudes y todo lo hecho',
  'nav.settingsDesc': 'Cuenta, apariencia, respaldo y sincronización',
};

/**
 * Nombre accesible de un ítem del menú: la palabra temática MÁS la función.
 * `badge` va adelante porque es donde estaba antes de que existiera el
 * `aria-label` (el <span> del contador se pinta antes del rótulo y el nombre
 * accesible se armaba solo del contenido): al fijar un `aria-label` el
 * contenido deja de leerse, y perder el contador sería una regresión.
 */
function navName(label: string, desc: string, badge = 0): string {
  const head = badge > 0 ? `${badge} ${label}` : label;
  return desc ? `${head} — ${desc}` : head;
}

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
/* Cada entrada lleva `desc`: la FUNCIÓN, no el sinónimo temático. Un ícono de
   caldero más la palabra «Caldero» no dicen «temporizador de enfoque», y el
   tooltip del riel colapsado repetía el mismo rótulo. La descripción viaja en
   tres canales: `aria-label` (nombre accesible), `title` (hover de escritorio)
   y el tooltip del riel angosto. En el cajón del teléfono —donde no hay
   hover y sí hay lugar— además se PINTA como segundo renglón.
   `desc` también es el puente entre el ítem del menú y el título de la página
   a la que lleva: «Inicio» abre «la Tabla del Aventurero». */
interface NavEntry { path: string; key: string; descKey: string; icon: string }

const navKeys: NavEntry[] = [
  { path: '/', key: 'nav.home', descKey: 'nav.homeDesc', icon: 'scroll' },
  { path: '/quests', key: 'nav.questify', descKey: 'nav.questifyDesc', icon: 'sword' },
  { path: '/nutrition', key: 'nav.nutrify', descKey: 'nav.nutrifyDesc', icon: 'bread' },
  { path: '/finance', key: 'nav.coinify', descKey: 'nav.coinifyDesc', icon: 'coin' },
  { path: '/cauldron', key: 'nav.cauldron', descKey: 'nav.cauldronDesc', icon: 'cauldron' },
  /* 'Logros' was pulled from this list while it was vapour (a focusable button
     at opacity .4 that did nothing). The shelf exists now, so it is back —
     Chalice, because a footed cup already IS the trophy in this icon family. */
  { path: '/achievements', key: 'nav.achievements', descKey: 'nav.achievementsDesc', icon: 'chalice' },
  /* The purse: obolos earned at the seal, spent on the user's own rewards. */
  { path: '/rewards', key: 'nav.rewards', descKey: 'nav.rewardsDesc', icon: 'bag' },
];

const bottomNavKeys: NavEntry[] = [
  { path: '/character', key: 'nav.character', descKey: 'nav.characterDesc', icon: 'shield' },
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
                {/* El rótulo alcanza por sí solo («Vigor» es palabra llana y
                    está pegado a la barra roja y a su 84/100); la REGLA —que se
                    recupera sola cada mañana— vivía únicamente en un `title=`,
                    invisible en touch. El sello de ayuda se abre con foco, así
                    que también se alcanza con un toque o con el teclado. */}
                <span className="sidebar-bar__label" title={t('rpg.vigorHint', 'El Vigor se recupera solo cada mañana')}>
                  {/* La palabra queda en su propio nodo hoja: el arnés visual
                      sólo mide contraste y tamaño en hojas de texto, y meter el
                      sello adentro del rótulo la habría sacado de la medición. */}
                  <span className="sidebar-bar__label-txt">{t('rpg.vigor', 'VIGOR')}</span>
                  <HelpBubble variant="inline" className="sidebar-bar__help" text={t('rpg.vigorHint', 'El Vigor se recupera solo cada mañana')} />
                </span>
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
                    {t('rpg.days', { count: stats.streak, defaultValue: '{{count}} días' })}
                  </span>
                </div>
                <div className="sidebar-bar__track">
                  <div className="sidebar-bar__fill sidebar-bar__fill--gold" style={{ width: `${Math.min(stats.streak * STREAK_BAR_SCALE, 100)}%` }} />
                </div>
                <div className="sidebar-streak__meta">
                  {/* Era un escudito con un número y NADA más: ni rótulo ni
                      unidad, con la palabra «indultos» sólo dentro de un
                      `title=`. Ahora el rótulo se ve, y la regla completa está
                      en la línea de abajo, que no depende de ningún hover. */}
                  <span
                    className="sidebar-streak__pardons"
                    title={t('rpg.pardonsHint', 'Perdonan un día perdido. Se recargan cada mes.')}
                  >
                    {/* No "/2": a shop-bought pardon extends the month's cap,
                        and "3/2" would read as a bug. The hint carries the rule. */}
                    <Shield width={11} height={11} />
                    {' '}{stats.pardonsRemaining ?? 0}{' '}
                    {t('rpg.pardonsShort', 'indultos')}
                  </span>
                  {/* El récord vivía pegado al valor de la racha: a 220 px de
                      riel «RACHA» y «9 días» se tocaban y «· récord 21» se
                      partía en dos renglones dejando el «21» huérfano. Acá
                      abajo hay una fila con lugar de sobra. */}
                  {stats.bestStreak > stats.streak && (
                    <span className="sidebar-streak__best" title={t('rpg.bestStreak', 'Mejor racha')}>
                      {t('rpg.bestShort', 'récord')} {stats.bestStreak}
                    </span>
                  )}
                  <button
                    type="button"
                    className="sidebar-streak__inn tap-target"
                    onClick={() => onToggleInn?.()}
                    title={stats.innSince
                      ? t('rpg.innLeave', 'Volver a la aventura')
                      : t('rpg.innHint', 'Pausa la racha sin perderla. El XP sigue contando.')}
                    aria-label={stats.innSince
                      ? `${t('rpg.innLeaveShort', 'Volver')} — ${t('rpg.innLeave', 'Volver a la aventura')}`
                      : `${t('rpg.inn', 'Posada')} — ${t('rpg.innHint', 'Pausa la racha sin perderla. El XP sigue contando.')}`}
                    aria-pressed={!!stats.innSince}
                  >
                    <MoonCrescent width={12} height={12} />
                    <span>{stats.innSince ? t('rpg.innLeaveShort', 'Volver') : t('rpg.inn', 'Posada')}</span>
                  </button>
                </div>
                {/* La regla de los dos controles de la racha, VISIBLE. Vivía
                    repartida en dos `title=`, y `title` no existe en un
                    teléfono — que es donde el cajón es la única navegación. */}
                <div className="sidebar-streak__rule">
                  {t('rpg.streakRule', 'Un día salteado gasta un indulto; la Posada la pausa.')}
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

          const label = t(item.key);
          const desc = t(item.descKey, NAV_DESC_FALLBACKS[item.descKey] ?? '');
          const navItem = (
            <button
              key={item.path}
              className={`sidebar-nav-item ${isActive(item.path) ? 'active' : ''}`}
              aria-current={isActive(item.path) ? 'page' : undefined}
              aria-label={navName(label, desc, badgeCount)}
              title={desc || undefined}
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
              <span className="sidebar-nav-item__label">{label}</span>
              {desc && <span className="sidebar-nav-item__desc">{desc}</span>}
            </button>
          );
          if (collapsed) {
            return <Tooltip key={item.path} text={navName(label, desc)}>{navItem}</Tooltip>;
          }
          return navItem;
        })}
      </nav>

      <div className="sidebar-divider" />

      {/* Bottom nav: Character + Settings */}
      <nav className="sidebar-settings-area" aria-label={t('hub.settingsNavigation', 'Configuración')}>
        {bottomNavKeys.map((item) => {
          const IconComp = NAV_ICONS[item.icon];
          const label = t(item.key);
          const desc = t(item.descKey, NAV_DESC_FALLBACKS[item.descKey] ?? '');
          const btn = (
            <button
              key={item.path}
              className={`sidebar-nav-item ${isActive(item.path) ? 'active' : ''}`}
              aria-current={isActive(item.path) ? 'page' : undefined}
              aria-label={navName(label, desc)}
              title={desc || undefined}
              onClick={() => animatedNavigate(item.path)}
            >
              <span className="sidebar-nav-item__ico">
                {IconComp && <IconComp width={18} height={18} />}
              </span>
              <span className="sidebar-nav-item__label">{label}</span>
              {desc && <span className="sidebar-nav-item__desc">{desc}</span>}
            </button>
          );
          return collapsed
            ? <Tooltip key={item.path} text={navName(label, desc)}>{btn}</Tooltip>
            : btn;
        })}
        {(() => {
          const label = t('nav.settings');
          const desc = t('nav.settingsDesc', NAV_DESC_FALLBACKS['nav.settingsDesc']);
          const settingsBtn = (
            <button
              className={`sidebar-nav-item ${isActive('/settings') ? 'active' : ''}`}
              aria-current={isActive('/settings') ? 'page' : undefined}
              aria-label={navName(label, desc)}
              title={desc || undefined}
              onClick={() => animatedNavigate('/settings')}
              data-tour="settings"
            >
              <span className="sidebar-nav-item__ico">
                <SettingsIcon width={18} height={18} />
              </span>
              <span className="sidebar-nav-item__label">{label}</span>
              {desc && <span className="sidebar-nav-item__desc">{desc}</span>}
            </button>
          );
          return collapsed
            ? <Tooltip text={navName(label, desc)}>{settingsBtn}</Tooltip>
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
          {/* El número de versión —lo primero que se pide en un reporte de
              bug— venía con `opacity: .5` inline: ~4:1 de contraste y un color
              que ningún medidor puede leer del estilo computado. Color propio,
              opacidad 1. */}
          {!collapsed && (
            <div style={{ fontSize: 'var(--fs-label)', fontFamily: "'Fira Code', monospace", color: 'var(--parch-3)' }}>
              v{APP_VERSION}
            </div>
          )}
        </div>
      </div>

    </aside>
  );
}

import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  BookPage,
  Cartouche,
  QBDividerSection,
  Section,
} from '../shared/components/codex';
import { Sword, Crown, Flame, Heart, Scroll, Quill, Cauldron, Sparkle, Dagger, FloralHeart, ArrowUpRight } from '../shared/components/icons';
import HelpBubble from '../shared/components/HelpBubble';
import Tooltip from '../shared/components/Tooltip';
import Skeleton from '../shared/components/Skeleton';
import ErrorState from '../shared/components/ErrorState';
import { WIDGET_DEFINITIONS, DashboardWidgetWrapper } from './widgets';
import { requestQuickCreate } from './widgets/quick-create';
import { buildReturnBrief } from './return-brief';
import { todayDateString } from '../../shared/date-utils';
import { useDashboardLayout } from './layouts/useDashboardLayout';
import { useDashboardDrag } from './layouts/useDashboardDrag';
import { useAnimatedNavigate } from '../shared/components/AnimatedOutlet';
import type { PlayerStats, RpgEventRecord } from '../../shared/types';
import { playSealPress } from '../shared/audio';
import { SealRosette } from './codex/CodexSealIcons';
import { useSealInvite } from './codex/useSealInvite';
import { humanise, titleKey } from './codex/achievementCatalog';
import { CODEX_SEALED_EVENT, getAchievements, openCodex } from './codex/codexApi';
import './styles/components.css';
import './styles/dashboard-layouts.css';
import './styles/codex-seal.css';

/* ── latin epigraphs ─────────────────────────────────────── */

const EPIGRAPHS: { quote: string; author: string }[] = [
  { quote: 'Non est ad astra mollis e terris via.', author: 'Séneca' },
  { quote: 'Audentes Fortuna iuvat!', author: 'Virgilio, Eneida X' },
  { quote: 'Per aspera ad astra.', author: 'Proverbio latino' },
  { quote: 'Dum spiro, spero.', author: 'Cicerón' },
  { quote: 'Carpe diem, quam minimum credula postero.', author: 'Horacio, Odas I' },
  { quote: 'Veni, vidi, vici.', author: 'Julio César' },
  { quote: 'Alea iacta est.', author: 'Julio César' },
  { quote: 'Memento mori, memento vivere.', author: 'Proverbio medieval' },
  { quote: 'Sapere aude.', author: 'Horacio, Epístolas I' },
  { quote: 'Labor omnia vincit improbus.', author: 'Virgilio, Geórgicas I' },
  { quote: 'Fortes fortuna adiuvat.', author: 'Terencio, Formión' },
  { quote: 'Ad maiora natus sum.', author: 'Séneca' },
];

/* ── helpers ──────────────────────────────────────────────── */


function eventIcon(moduleId: string): ReactNode {
  const size = 14;
  switch (moduleId) {
    case 'quests': return <Sword width={size} height={size} />;
    case 'nutrition': return <FloralHeart width={size} height={size} />;
    case 'finance': return <Dagger width={size} height={size} />;
    case 'cauldron': return <Cauldron width={size} height={size} />;
    default: return <Sparkle width={size} height={size} />;
  }
}

/**
 * Used to return the hardcoded Latin 'nunc' / 'heri', with 'heri' covering
 * EVERYTHING older than a day — yesterday and last week looked identical.
 */
function formatEventTime(createdAt: string, t: TFunction): string {
  const d = new Date(createdAt);
  const diffMins = Math.floor((Date.now() - d.getTime()) / 60000);

  if (diffMins < 1) return t('dashboard.timeNow', 'ahora');
  if (diffMins < 60) return t('dashboard.timeMinutes', { n: diffMins, defaultValue: 'hace {{n}} min' });
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return t('dashboard.timeHours', { n: diffHours, defaultValue: 'hace {{n}} h' });
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return t('dashboard.timeDays', { n: diffDays, defaultValue: 'hace {{n}} d' });
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 5) return t('dashboard.timeWeeks', { n: diffWeeks, defaultValue: 'hace {{n}} sem' });
  const diffMonths = Math.floor(diffDays / 30);
  return t('dashboard.timeMonths', { n: diffMonths, defaultValue: 'hace {{n}} mes' });
}

/* ── XP Ledger mini chart ─────────────────────────────────── */

/**
 * El eje de días vivía en un `<div>` con `justify-content: space-between` FUERA
 * del SVG: las barras se posicionan como fracción del viewBox (la última queda
 * al 87 % del ancho) mientras el último rótulo se pega al 100 %. A tarjeta
 * angosta casi coincidían; en ventana maximizada «HOY» terminaba a un bar de
 * distancia de su propia barra. Ahora los rótulos son `<text>` dentro del mismo
 * sistema de coordenadas que las barras: no se pueden desalinear.
 *
 * Además el `width: 100%` sin techo estiraba un dibujo de 280×120 hasta 255 px
 * de alto en pantalla completa. Tiene un `max-width` y las cifras van en
 * Fira Code (numérico), no en UnifrakturCook a tamaño etiqueta.
 */
function XpLedger({ data, t }: { data: Array<{ date: string; xp: number }>; t: TFunction }) {
  if (data.length === 0) return null;
  const maxXp = Math.max(...data.map((d) => d.xp), 1);
  const daysShort = t('dashboard.daysShort', { returnObjects: true, defaultValue: ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'] }) as string[];
  const dayLabels = data.map((d) => {
    const dt = new Date(d.date + 'T12:00:00');
    return daysShort[dt.getDay()];
  });
  if (dayLabels.length > 0) dayLabels[dayLabels.length - 1] = t('dashboard.today', 'HOY');

  const barCount = data.length;
  const w = 280;
  const chartH = 104;          // suelo de las barras
  const h = chartH + 22;       // + la franja de rótulos, DENTRO del svg
  const pad = 8;
  const slot = (w - pad * 2) / barCount;
  const barW = Math.min(26, slot - 8);

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={t('dashboard.xpLedgerHelp', 'XP ganada en los últimos 7 días, desglosada por módulo.')}
      style={{ width: '100%', maxWidth: 360, height: 'auto', display: 'block', margin: '0 auto' }}
    >
      <defs>
        <pattern id="hatch" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="4" stroke="var(--ink)" strokeWidth="0.7" />
        </pattern>
      </defs>
      {/* ruled baselines */}
      {[0, 26, 52, 78, chartH].map((y) => (
        <line key={y} x1="0" y1={y} x2={w} y2={y} stroke="rgba(74,55,32,.2)" strokeWidth="0.5" strokeDasharray="2 3" />
      ))}
      {data.map((d, i) => {
        const x = pad + i * slot + (slot - barW) / 2;
        const barH = Math.max(1.5, (d.xp / maxXp) * (chartH - 14));
        const cx = x + barW / 2;
        return (
          <g key={i}>
            <rect x={x} y={chartH - barH} width={barW} height={barH} fill="url(#hatch)" stroke="var(--ink)" strokeWidth="0.8" />
            <text x={cx} y={chartH - barH - 4} textAnchor="middle" fontSize="9" fontFamily="'Fira Code', monospace" fill="var(--ink)">
              {Math.round(d.xp)}
            </text>
            <text x={cx} y={h - 6} textAnchor="middle" fontSize="8.5" fontFamily="'IM Fell English SC', serif" fill="var(--ink-soft)">
              {dayLabels[i]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ── Interactive Seal (wax stamp press) ───────────────────── */

function SealButton({ level }: { level: number }) {
  const [pressed, setPressed] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleClick = () => {
    playSealPress();
    setPressed(true);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setPressed(false), 500);
  };

  return (
    <button
      type="button"
      className={`qb-seal qb-seal--btn${pressed ? ' qb-seal--pressed' : ''}`}
      onClick={handleClick}
      aria-label={`Level ${level}`}
    >
      <div style={{ textAlign: 'center', lineHeight: 1 }}>
        <div style={{ fontSize: 'var(--fs-label)', letterSpacing: '.1em', fontFamily: "'IM Fell English SC', serif" }}>
          LVL
        </div>
        <div style={{ fontSize: 'var(--fs-hero)' }}>{level}</div>
      </div>
    </button>
  );
}

/* ── Dashboard ────────────────────────────────────────────── */

export default function Dashboard() {
  const { t } = useTranslation();
  const animatedNavigate = useAnimatedNavigate();
  const { layout, cycleColSpan, cycleRowSpan, reorder, resetLayout, isCustomLayout } = useDashboardLayout();
  const { dragIndex, dropTargetIndex, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd } = useDashboardDrag(reorder);
  /** Counts the sidebar already computes; reused here to say what needs doing. */
  const [todo, setTodo] = useState<{ questsOverdue: number; mealsToday: number }>({ questsOverdue: 0, mealsToday: 0 });
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [dashStats, setDashStats] = useState<{
    xpToday: number;
    xpHistory: Array<{ date: string; xp: number }>;
    eventsToday: number;
  } | null>(null);
  const [recentEvents, setRecentEvents] = useState<RpgEventRecord[]>([]);
  /** Most recent achievement unlocked in the last 24 h — one brief line, no banner. */
  const [freshAchievementId, setFreshAchievementId] = useState<string | null>(null);
  const { available: codexAvailable, invite: sealInvite, todaySealed } = useSealInvite();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  /** The return brief steps aside as soon as the user acts on it. */
  const [returnDismissed, setReturnDismissed] = useState(false);
  const epigraph = useMemo(() => EPIGRAPHS[Math.floor(Math.random() * EPIGRAPHS.length)], []);

  const load = useCallback(() => {
    setLoadError(false);
    setLoading(true);
    Promise.all([
      window.api.getRpgStats(),
      window.api.rpgGetDashboardStats(),
      window.api.getRpgHistory(8),
    ])
      .then(([s, d, events]) => {
        setStats(s);
        setDashStats(d);
        setRecentEvents(events);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));

    Promise.all([
      window.api.questsGetOverdueCount(),
      window.api.nutritionGetTodayMealsCount(),
    ])
      .then(([questsOverdue, mealsToday]) => setTodo({ questsOverdue, mealsToday }))
      .catch(() => { /* the brief just stays generic */ });

    getAchievements().catch(() => null).then((list) => {
      if (!list) { setFreshAchievementId(null); return; }
      const cutoff = Date.now() - 24 * 60 * 60_000;
      const fresh = list
        .filter((a) => a.unlocked && a.unlockedAt && new Date(a.unlockedAt).getTime() >= cutoff)
        .sort((a, b) => new Date(b.unlockedAt as string).getTime() - new Date(a.unlockedAt as string).getTime())[0];
      setFreshAchievementId(fresh?.id ?? null);
    });
  }, []);

  /** Ctrl+↑ / Ctrl+↓ move the focused card — the reorder was drag-only. */
  const onWidgetMove = useCallback((index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0) return;
    reorder(index, target);
  }, [reorder]);

  useEffect(() => {
    load();
  }, [load]);

  // Reload data when account is switched
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('account:switched', handler);
    window.addEventListener(CODEX_SEALED_EVENT, handler);
    window.addEventListener('rpg:achievementUnlocked', handler);
    return () => {
      window.removeEventListener('account:switched', handler);
      window.removeEventListener(CODEX_SEALED_EVENT, handler);
      window.removeEventListener('rpg:achievementUnlocked', handler);
    };
  }, [load]);

  /* Era un esqueleto escrito en línea con `rgba(74,55,32,.1)` a mano y SIN
     animación: una grilla de manchas quietas que no se distinguía de un error
     de pintado. Ahora es la primitiva compartida, con el mismo shimmer que el
     resto de la app. */
  if (loading)
    return (
      <div style={{ padding: '32px 24px', maxWidth: 900, margin: '0 auto' }}>
        <Skeleton variant="line" width={220} />
        <div style={{ height: 8 }} />
        <Skeleton variant="line" width={340} />
        <div style={{ height: 24 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 20, marginBottom: 20 }}>
          <Skeleton variant="line" count={3} text />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Skeleton variant="card" width={72} height={72} />
          </div>
        </div>
        <div className="qb-cartouche-row">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} variant="block" height={64} />
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 14 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ gridColumn: 'span 2' }}><Skeleton variant="card" height={120} /></div>
          ))}
          <div style={{ gridColumn: '1 / -1' }}><Skeleton variant="card" height={120} /></div>
        </div>
      </div>
    );

  if (loadError)
    return <ErrorState message={t('common.somethingWentWrong')} onRetry={load} />;

  const level = stats?.level ?? 1;
  const hp = stats?.hp ?? 100;
  const streak = stats?.streak ?? 0;
  const xpToday = Math.round(dashStats?.xpToday ?? 0);
  const eventsToday = dashStats?.eventsToday ?? 0;

  /* ── What actually needs doing today ─────────────────────────
     This block replaces "Salve, noble …" plus a random Latin epigraph: two
     paragraphs that never once told you there were overdue quests. */
  const briefLines: Array<{ key: string; node: ReactNode }> = [];
  if (todo.questsOverdue > 0) {
    briefLines.push({
      key: 'overdue',
      node: t('dashboard.briefOverdue', {
        n: todo.questsOverdue,
        defaultValue: 'Tenés {{n}} misiones vencidas.',
      }),
    });
  }
  if (todo.mealsToday === 0) {
    briefLines.push({
      key: 'no-meals',
      node: t('dashboard.briefNoMeals', 'Todavía no registraste ninguna comida hoy.'),
    });
  }
  if (streak > 0 && eventsToday === 0) {
    briefLines.push({
      key: 'streak',
      node: t('dashboard.briefStreakAtRisk', {
        n: streak,
        defaultValue: 'Tu racha de {{n}} días está en riesgo: registrá algo hoy.',
      }),
    });
  }
  if (briefLines.length === 0) {
    briefLines.push({
      key: 'default',
      node: eventsToday > 0
        ? t('dashboard.briefAllGood', { n: eventsToday, defaultValue: 'Todo al día: {{n}} hechos registrados hoy.' })
        : t('dashboard.briefNothingPending', 'Nada pendiente. Buen momento para sumar algo.'),
    });
  }

  /* The loop closes here. One line in the brief, never a banner: past 21:00
     with an unsealed day (or yesterday still open), the invitation joins the
     things worth doing tonight. */
  if (sealInvite) {
    briefLines.push({
      key: 'seal',
      node: (
        <>
          {sealInvite.which === 'yesterday'
            ? t('dashboard.briefSealYesterday', 'Te quedó ayer sin sellar. ')
            : ''}
          <button
            type="button"
            className="dash-brief__seal"
            onClick={() => openCodex(sealInvite.date)}
          >
            {t('dashboard.briefSealDay', 'Sellá tu día')}
          </button>
        </>
      ),
    });
  }
  if (freshAchievementId) {
    briefLines.push({
      key: 'achievement',
      node: (
        <>
          {t('dashboard.briefNewAchievement', 'Nuevo logro: ')}
          <button
            type="button"
            className="dash-brief__seal"
            onClick={() => animatedNavigate('/achievements')}
          >
            {t(titleKey(freshAchievementId), humanise(freshAchievementId))}
          </button>
        </>
      ),
    });
  }

  /* ── El regreso ───────────────────────────────────────────
     El uso real no es diario: 14 días activos en cinco meses, con huecos de 6,
     9, 40 y 54 días. El brief decía exactamente lo mismo después de un día que
     después de cincuenta, y nadie explicaba dónde había quedado la racha.
     Informa, no reprocha — C10 es lo mejor que tiene la app. */
  const returnBrief = returnDismissed ? null : buildReturnBrief({
    lastEventDate: recentEvents[0]?.createdAt?.slice(0, 10) ?? null,
    today: todayDateString(),
    streak,
    overdueQuests: todo.questsOverdue,
  });

  /** A fresh install used to be a wall of zeroes with no call to action. */
  const isEmptyState = !!stats
    && stats.totalTasks === 0
    && stats.totalMeals === 0
    && stats.totalExpenses === 0
    && recentEvents.length === 0;

  return (
    <BookPage
      data-tour="welcome"
      eyebrow={<><Sparkle width={10} height={10} style={{ display: 'inline', verticalAlign: 'middle' }} /> {t('dashboard.eyebrowText', 'HUBTIFY')} <Sparkle width={10} height={10} style={{ display: 'inline', verticalAlign: 'middle' }} /> {'\u2014'} {t('dashboard.eyebrowSub', 'CÓDICE DEL AVENTURERO')}</>}
      title={t('dashboard.title', 'Tabla del Aventurero')}
      subtitle={t('dashboard.subtitle', 'Primer folio · do se escriben las nuevas del día y se registran los hechos del campeón')}
    >
      {/* ── row 1: today's brief + wax seal ──────────────── */}
      <div className="dash-row-brief">
        <div>
          {returnBrief && (
            <div className="dash-return" role="status">
              <div className="qb-small-caps dash-return__eyebrow">
                {t('dashboard.returnTitle', 'EL REGRESO')}
              </div>
              <p className="dash-return__lead">
                {t('dashboard.returnDaysAway', {
                  n: returnBrief.daysAway,
                  defaultValue: 'Pasaron {{n}} días desde la última anotación.',
                })}
              </p>
              <ul className="dash-return__list">
                <li>
                  {returnBrief.streak > 0
                    ? t('dashboard.returnStreakAlive', {
                      n: returnBrief.streak,
                      defaultValue: 'Tu racha de {{n}} días sigue en pie.',
                    })
                    : t('dashboard.returnStreakReset', 'La racha volvió a cero. No hay multa: se empieza de nuevo cuando quieras.')}
                </li>
                <li>
                  {returnBrief.overdueQuests > 0
                    ? t('dashboard.returnOverdue', {
                      n: returnBrief.overdueQuests,
                      defaultValue: 'Te esperan {{n}} misiones con la fecha pasada. Se posponen sin costo.',
                    })
                    : t('dashboard.returnNothingOverdue', 'No quedó nada vencido esperándote.')}
                </li>
              </ul>
              <button
                type="button"
                className="rpg-button dash-return__action"
                onClick={() => {
                  setReturnDismissed(true);
                  if (returnBrief.action === 'review-overdue') animatedNavigate('/quests');
                  else requestQuickCreate('quest');
                }}
              >
                {returnBrief.action === 'review-overdue'
                  ? t('dashboard.returnCtaReview', 'Mirá qué quedó pendiente')
                  : t('dashboard.returnCtaCreate', 'Anotá por dónde seguís')}
              </button>
            </div>
          )}

          <div className="dash-brief">
            <div className="qb-small-caps dash-brief__eyebrow">
              {t('dashboard.briefTitle', 'HOY')} {'·'}{' '}
              <span className="qb-hand">
                {new Date().toLocaleDateString(t('dashboard.locale', 'es-AR'), { day: 'numeric', month: 'long' })}
              </span>
            </div>
            <ul className="dash-brief__list">
              {briefLines.map((line) => (
                <li key={line.key} className="dash-brief__line">{line.node}</li>
              ))}
            </ul>
          </div>

          {isEmptyState && (
            <div className="dash-empty">
              <p className="dash-empty__text">
                {t('dashboard.emptyStateText', 'Todavía no hay nada registrado. Empezá por acá:')}
              </p>
              {/* These three used to only NAVIGATE, dropping the user on an
                  equally empty page with the form still hidden. Now each one
                  opens its widget's form right here, in the hub. */}
              <div className="dash-empty__actions">
                <button className="rpg-button" onClick={() => requestQuickCreate('quest')}>
                  {t('dashboard.emptyCtaQuest', 'Creá tu primera misión')}
                </button>
                <button className="rpg-button" onClick={() => requestQuickCreate('habit')}>
                  {t('dashboard.emptyCtaHabit', 'Creá tu primer hábito')}
                </button>
                <button className="rpg-button" onClick={() => requestQuickCreate('meal')}>
                  {t('dashboard.emptyCtaMeal', 'Registrá una comida')}
                </button>
                <button className="rpg-button" onClick={() => requestQuickCreate('expense')}>
                  {t('dashboard.emptyCtaExpense', 'Anotá un gasto')}
                </button>
              </div>
            </div>
          )}

          <div
            style={{
              marginTop: 12,
              // Sin techo de ancho, en ventana maximizada la cita quedaba a la
              // izquierda y el «— Séneca» (text-align: right) a 600 px de
              // distancia, como si no fueran la misma cosa.
              maxWidth: '46ch',
              fontFamily: "'Cormorant Garamond', serif",
              fontStyle: 'italic',
              fontSize: 'var(--fs-quote)',
              color: 'var(--ink-soft)',
            }}
          >
            {'«'} {epigraph.quote} {'»'}
            <span style={{ display: 'block', textAlign: 'right', marginTop: 2, fontSize: 'var(--fs-label)', color: 'var(--ink-faded)' }}>
              {'—'} {epigraph.author}
            </span>
          </div>
        </div>
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <SealButton level={level} />
          {/* The permanent way in. The evening invitation is an offer; this is
              always here, sealed or not, so the ritual is never something you
              can only reach when the app decides to ask. */}
          {codexAvailable && (
            <button
              type="button"
              className="codex-link"
              // Era `white-space: nowrap` dentro de una columna de 220 px: el
              // enlace medía 280 y se salía 30 px por CADA lado, pisando el
              // parte del día a su izquierda y el borde de la página a su
              // derecha. Que envuelva.
              style={{ maxWidth: '100%', textAlign: 'center' }}
              onClick={() => openCodex()}
            >
              <SealRosette width={12} height={12} />
              {todaySealed
                ? t('dashboard.codexOpenSealed', 'Ver la página de hoy')
                : t('dashboard.codexOpen', 'Abrir el códice del día')}
            </button>
          )}
          <div
            style={{
              position: 'absolute',
              top: -2,
              right: 4,
              fontFamily: "'Cormorant Garamond', serif",
              fontStyle: 'italic',
              fontSize: 'var(--fs-label)',
              color: 'var(--ink-faded)',
              transform: 'rotate(4deg)',
            }}
          >
            {t('dashboard.royalSeal', 'sigilo real')} <ArrowUpRight width={10} height={10} style={{ display: 'inline', verticalAlign: 'middle', transform: 'rotate(90deg)' }} />
          </div>
        </div>
      </div>

      {/* ── row 2: stat cartouches ────────────────────── */}
      <div className="qb-cartouche-row">
        <Tooltip text={t('dashboard.cartLevelTip', 'Nivel actual del héroe')}><Cartouche label={t('dashboard.cartLevel', 'NIVEL')} value={level} foot={stats?.title} icon={<Crown width={14} height={14} />} /></Tooltip>
        <Tooltip text={t('dashboard.cartXpTip', 'Experiencia ganada hoy')}><Cartouche label={t('dashboard.cartXp', 'XP HODIE')} value={xpToday >= 0 ? `+${xpToday}` : `${xpToday}`} foot={t('dashboard.cartXpFoot', 'ganados al sol')} icon={<Sword width={14} height={14} />} tone="sage" /></Tooltip>
        <Tooltip text={t('dashboard.cartStreakTip', 'Días consecutivos de actividad')}><Cartouche label={t('dashboard.cartStreak', 'RACHA')} value={streak} foot={t('dashboard.cartStreakFoot', 'días de gloria')} icon={<Flame width={14} height={14} />} /></Tooltip>
        <Tooltip text={t('dashboard.cartHpTip', 'Vigor actual del héroe')}><Cartouche label={t('dashboard.cartHp', 'VIGOR')} value={hp} foot={`${t('dashboard.cartHpFoot', 'de')} ${stats?.maxHp ?? 100} ${t('dashboard.cartHpUnit', 'puntos')}`} icon={<Heart width={14} height={14} />} tone="rubric" /></Tooltip>
      </div>

      <QBDividerSection />

      {/* ── row 3: customizable module grid ────────────── */}
      {isCustomLayout && (
        <div className="dashboard-grid-toolbar">
          <button className="rpg-btn-sm" onClick={resetLayout}>
            {t('dashboard.restoreLayout', 'Restaurar disposición')}
          </button>
        </div>
      )}
      <div className="dashboard-grid-4">
        {layout.widgets.map((w, index) => {
          const def = WIDGET_DEFINITIONS[w.id];
          if (!def) return null;
          const Widget = def.component;
          return (
            <DashboardWidgetWrapper
              key={w.id}
              widgetId={w.id}
              colSpan={w.colSpan}
              rowSpan={w.rowSpan ?? 1}
              index={index}
              isDragging={dragIndex === index}
              isDropTarget={dropTargetIndex === index}
              onCycleColSpan={cycleColSpan}
              onCycleRowSpan={cycleRowSpan}
              onMove={onWidgetMove}
              dragHandlers={{
                onDragStart: onDragStart(index),
                onDragOver: onDragOver(index),
                onDragLeave,
                onDrop: onDrop(index),
                onDragEnd,
              }}
              title={t(def.titleKey, def.titleFallback)}
              tome={def.tome}
              latin={def.latin}
              icon={<def.IconComponent width={18} height={18} />}
              navTo={def.navTo}
            >
              <Widget />
            </DashboardWidgetWrapper>
          );
        })}
      </div>

      {/* ── row 4: chronicle + xp ledger ──────────────── */}
      <div className="dash-row-chronicle">
        <Section
          title={t('dashboard.chronicle', 'CRÓNICA RECIENTE')}
          icon={<Scroll width={12} height={12} style={{ color: 'var(--rubric)' }} />}
        >
          <HelpBubble text={t('dashboard.chronicleHelp', 'Últimos eventos que otorgaron XP: misiones, nutrición, finanzas y logros.')} />
          {recentEvents.length > 0 ? (
            // El hecho es el dato primario de la fila: cuerpo de texto. XP y
            // hora quedan en --fs-label como meta. La pintura vive en
            // `dashboard-layouts.css` (.dash-chronicle*): en línea no había
            // manera de darle un puntillado guía ni de pisarla desde el móvil.
            <ul className="dash-chronicle">
              {recentEvents.map((ev) => {
                let description = '';
                try {
                  const p = JSON.parse(ev.payload);
                  description = p.description || p.name || p.taskName || '';
                } catch { /* no payload */ }
                if (!description) {
                  const translated = t(`events.${ev.eventType}`);
                  description = translated !== `events.${ev.eventType}` ? translated : ev.eventType;
                }

                return (
                  <li key={ev.id} className="dash-chronicle__row">
                    <span className="dash-chronicle__icon">{eventIcon(ev.moduleId)}</span>
                    <span className="dash-chronicle__fact">
                      <span className="dash-chronicle__text">{description}</span>
                      {/* El puntillado guía del índice de un libro: cose el
                          hecho con su cifra en vez de dejar 300 px de
                          pergamino en el medio (decisión abierta nº6). */}
                      <span className="dash-chronicle__leader" aria-hidden="true" />
                    </span>
                    <span className="dash-chronicle__xp">
                      +{Math.round(ev.xpGained)} xp
                    </span>
                    <span className="qb-hand dash-chronicle__time">
                      {formatEventTime(ev.createdAt, t)}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="qb-hand" style={{ color: 'var(--ink-faded)', fontSize: 'var(--fs-label)' }}>
              {t('dashboard.noChronicle', 'Ninguna crónica registrada aún.')}
            </p>
          )}
        </Section>

        <Section
          title={t('dashboard.xpLedger', 'BITÁCORA DE XP \u2014 VII DÍAS')}
          icon={<Quill width={12} height={12} style={{ color: 'var(--rubric)' }} />}
        >
          <HelpBubble text={t('dashboard.xpLedgerHelp', 'XP ganada en los últimos 7 días, desglosada por módulo.')} />
          {dashStats && dashStats.xpHistory.length > 0 ? (
            <XpLedger data={dashStats.xpHistory} t={t} />
          ) : (
            <p className="qb-hand" style={{ color: 'var(--ink-faded)', fontSize: 'var(--fs-label)' }}>
              {t('dashboard.noXpData', 'Sin datos de XP registrados.')}
            </p>
          )}
        </Section>
      </div>

      {/* marginal scribble */}
      <div style={{
        marginTop: 24,
        fontFamily: "'Cormorant Garamond', serif",
        fontStyle: 'italic',
        fontSize: 'var(--fs-label)',
        color: 'var(--ink-faded)',
        transform: 'rotate(-2deg)',
        textAlign: 'right',
      }}>
        {t('dashboard.marginNote', 'nota al margen')} {'\u2014'} {dashStats?.eventsToday ?? 0} {t('dashboard.eventsToday', 'hechos registrados hoy')} <ArrowUpRight width={10} height={10} style={{ display: 'inline', verticalAlign: 'middle' }} />
      </div>
    </BookPage>
  );
}

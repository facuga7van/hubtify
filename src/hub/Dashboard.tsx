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
import { WIDGET_DEFINITIONS, DashboardWidgetWrapper } from './widgets';
import { useDashboardLayout } from './layouts/useDashboardLayout';
import { useDashboardDrag } from './layouts/useDashboardDrag';
import { useAnimatedNavigate } from '../shared/components/AnimatedOutlet';
import type { PlayerStats, RpgEventRecord } from '../../shared/types';
import { playSealPress } from '../shared/audio';
import './styles/components.css';
import './styles/dashboard-layouts.css';

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
  const h = 120;

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto' }}>
        <defs>
          <pattern id="hatch" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="4" stroke="var(--ink)" strokeWidth="0.7" />
          </pattern>
        </defs>
        {/* ruled baselines */}
        {[0, 30, 60, 90, 120].map((y) => (
          <line key={y} x1="0" y1={y} x2={w} y2={y} stroke="rgba(74,55,32,.2)" strokeWidth="0.5" strokeDasharray="2 3" />
        ))}
        {/* bars */}
        {data.map((d, i) => {
          const barW = Math.min(24, (w - 20) / barCount - 14);
          const gap = (w - 20) / barCount;
          const x = 10 + i * gap;
          const barH = (d.xp / maxXp) * 100;
          return (
            <g key={i}>
              <rect x={x} y={h - barH} width={barW} height={barH} fill="url(#hatch)" stroke="var(--ink)" strokeWidth="0.8" />
              <text x={x + barW / 2} y={h - barH - 4} textAnchor="middle" fontSize="10" fontFamily="'UnifrakturCook',serif" fill="var(--ink)">
                {Math.round(d.xp)}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 'var(--fs-label)', color: 'var(--ink-faded)' }}>
        {dayLabels.map((label, i) => (
          <span key={i} className="qb-small-caps">{label}</span>
        ))}
      </div>
    </div>
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
        <div style={{ fontSize: 'var(--fs-label)', letterSpacing: '.1em', fontFamily: "'IM Fell English SC', serif", opacity: 0.85 }}>
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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
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
    return () => window.removeEventListener('account:switched', handler);
  }, [load]);

  if (loading)
    return (
      <div style={{ padding: '32px 24px', maxWidth: 900, margin: '0 auto' }}>
        {/* Skeleton: title area */}
        <div style={{ height: 18, width: 220, background: 'rgba(74,55,32,.1)', borderRadius: 4, marginBottom: 8 }} />
        <div style={{ height: 12, width: 340, background: 'rgba(74,55,32,.07)', borderRadius: 4, marginBottom: 24 }} />
        {/* Skeleton: salutation */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 20, marginBottom: 20 }}>
          <div>
            <div style={{ height: 12, background: 'rgba(74,55,32,.08)', marginBottom: 6, borderRadius: 3 }} />
            <div style={{ height: 12, background: 'rgba(74,55,32,.06)', width: '85%', marginBottom: 6, borderRadius: 3 }} />
            <div style={{ height: 12, background: 'rgba(74,55,32,.06)', width: '60%', borderRadius: 3 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(74,55,32,.1)' }} />
          </div>
        </div>
        {/* Skeleton: cartouches */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ height: 64, background: 'rgba(74,55,32,.07)', borderRadius: 6 }} />
          ))}
        </div>
        {/* Skeleton: module cards (4-column grid) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 14 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ height: 120, background: 'rgba(74,55,32,.06)', borderRadius: 6, gridColumn: 'span 2' }} />
          ))}
          <div style={{ height: 120, background: 'rgba(74,55,32,.06)', borderRadius: 6, gridColumn: '1 / -1' }} />
        </div>
      </div>
    );

  if (loadError)
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <p style={{ marginBottom: 12, color: 'var(--rubric)' }}>{t('common.somethingWentWrong')}</p>
        <button className="rpg-button" onClick={load}>
          {t('common.tryAgain')}
        </button>
      </div>
    );

  const level = stats?.level ?? 1;
  const hp = stats?.hp ?? 100;
  const streak = stats?.streak ?? 0;
  const xpToday = Math.round(dashStats?.xpToday ?? 0);
  const eventsToday = dashStats?.eventsToday ?? 0;

  /* ── What actually needs doing today ─────────────────────────
     This block replaces "Salve, noble …" plus a random Latin epigraph: two
     paragraphs that never once told you there were overdue quests. */
  const briefLines: string[] = [];
  if (todo.questsOverdue > 0) {
    briefLines.push(t('dashboard.briefOverdue', {
      n: todo.questsOverdue,
      defaultValue: 'Tenés {{n}} misiones vencidas.',
    }));
  }
  if (todo.mealsToday === 0) {
    briefLines.push(t('dashboard.briefNoMeals', 'Todavía no registraste ninguna comida hoy.'));
  }
  if (streak > 0 && eventsToday === 0) {
    briefLines.push(t('dashboard.briefStreakAtRisk', {
      n: streak,
      defaultValue: 'Tu racha de {{n}} días está en riesgo: registrá algo hoy.',
    }));
  }
  if (briefLines.length === 0) {
    briefLines.push(
      eventsToday > 0
        ? t('dashboard.briefAllGood', { n: eventsToday, defaultValue: 'Todo al día: {{n}} hechos registrados hoy.' })
        : t('dashboard.briefNothingPending', 'Nada pendiente. Buen momento para sumar algo.')
    );
  }

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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 20, marginBottom: 16 }}>
        <div>
          <div className="dash-brief">
            <div className="qb-small-caps dash-brief__eyebrow">
              {t('dashboard.briefTitle', 'HOY')} {'·'}{' '}
              <span className="qb-hand">
                {new Date().toLocaleDateString(t('dashboard.locale', 'es-AR'), { day: 'numeric', month: 'long' })}
              </span>
            </div>
            <ul className="dash-brief__list">
              {briefLines.map((line) => (
                <li key={line} className="dash-brief__line">{line}</li>
              ))}
            </ul>
          </div>

          {isEmptyState && (
            <div className="dash-empty">
              <p className="dash-empty__text">
                {t('dashboard.emptyStateText', 'Todavía no hay nada registrado. Empezá por acá:')}
              </p>
              <div className="dash-empty__actions">
                <button className="rpg-button" onClick={() => animatedNavigate('/quests')}>
                  {t('dashboard.emptyCtaQuest', 'Creá tu primera misión')}
                </button>
                <button className="rpg-button" onClick={() => animatedNavigate('/nutrition')}>
                  {t('dashboard.emptyCtaMeal', 'Registrá una comida')}
                </button>
                <button className="rpg-button" onClick={() => animatedNavigate('/finance')}>
                  {t('dashboard.emptyCtaExpense', 'Anotá un gasto')}
                </button>
              </div>
            </div>
          )}

          <div
            style={{
              marginTop: 12,
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
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <SealButton level={level} />
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
        <Tooltip text={t('dashboard.cartLevelTip', 'Nivel actual del héroe')}><Cartouche label={t('dashboard.cartLevel', 'NIVEL')} value={level} foot={stats?.title} icon={<Crown width={14} height={14} />} /></Tooltip>
        <Tooltip text={t('dashboard.cartXpTip', 'Experiencia ganada hoy')}><Cartouche label={t('dashboard.cartXp', 'XP HODIE')} value={xpToday >= 0 ? `+${xpToday}` : `${xpToday}`} foot={t('dashboard.cartXpFoot', 'ganados al sol')} icon={<Sword width={14} height={14} />} tone="sage" /></Tooltip>
        <Tooltip text={t('dashboard.cartStreakTip', 'Días consecutivos de actividad')}><Cartouche label={t('dashboard.cartStreak', 'RACHA')} value={streak} foot={t('dashboard.cartStreakFoot', 'días de gloria')} icon={<Flame width={14} height={14} />} /></Tooltip>
        <Tooltip text={t('dashboard.cartHpTip', 'Salud actual del héroe')}><Cartouche label={t('dashboard.cartHp', 'VITA')} value={hp} foot={`${t('dashboard.cartHpFoot', 'de')} ${stats?.maxHp ?? 100} ${t('dashboard.cartHpUnit', 'puntos')}`} icon={<Heart width={14} height={14} />} tone="rubric" /></Tooltip>
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
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16 }}>
        <Section
          title={t('dashboard.chronicle', 'CRÓNICA RECIENTE')}
          icon={<Scroll width={12} height={12} style={{ color: 'var(--rubric)' }} />}
        >
          <HelpBubble text={t('dashboard.chronicleHelp', 'Últimos eventos que otorgaron XP: misiones, nutrición, finanzas y logros.')} />
          {recentEvents.length > 0 ? (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 'var(--fs-label)', fontFamily: "'IM Fell English', serif" }}>
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
                  <li
                    key={ev.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '18px 1fr auto auto',
                      gap: 8,
                      alignItems: 'baseline',
                      padding: '5px 0',
                      borderBottom: '1px dotted rgba(74,55,32,.3)',
                    }}
                  >
                    <span style={{ color: 'var(--rubric)', fontSize: 'var(--fs-quote)', textAlign: 'center' }}>
                      {eventIcon(ev.moduleId)}
                    </span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {description}
                    </span>
                    <span className="qb-numeral" style={{ color: 'var(--moss)', fontSize: 'var(--fs-label)' }}>
                      +{Math.round(ev.xpGained)} xp
                    </span>
                    <span className="qb-hand" style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-faded)' }}>
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

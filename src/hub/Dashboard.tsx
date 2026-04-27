import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  BookPage,
  Cartouche,
  QBDividerSection,
  ModuleCard,
  Section,
} from '../shared/components/codex';
import { Sword, Bread, Coin, Cauldron, Crown, Flame, Heart, Scroll, Quill } from '../shared/components/icons';
import HelpBubble from '../shared/components/HelpBubble';
import QuestsDashboardWidget from '../modules/quests/components/QuestsDashboardWidget';
import NutritionDashboardWidget from '../modules/nutrition/components/NutritionDashboardWidget';
import FinanceDashboardWidget from '../modules/finance/components/DashboardWidget';
import CauldronDashboardWidget from '../modules/cauldron/components/CauldronDashboardWidget';
import type { PlayerStats, RpgEventRecord } from '../../shared/types';
import './styles/components.css';

interface QuickStats {
  tasksDueToday: number;
  mealsToday: number;
  transactionsToday: number;
}

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


function eventIcon(moduleId: string): string {
  switch (moduleId) {
    case 'quests': return '\u2694'; // swords
    case 'nutrition': return '\u2766'; // floral heart
    case 'finance': return '\u2020'; // dagger
    case 'cauldron': return '\u2697'; // alembic
    default: return '\u2726'; // star
  }
}

function formatEventTime(createdAt: string): string {
  const d = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'nunc';
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  return 'heri';
}

/* ── XP Ledger mini chart ─────────────────────────────────── */

function XpLedger({ data, t }: { data: Array<{ date: string; xp: number }>; t: (...args: any[]) => any }) {
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

/* ── Dashboard ────────────────────────────────────────────── */

export default function Dashboard() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [dashStats, setDashStats] = useState<{
    xpToday: number;
    xpHistory: Array<{ date: string; xp: number }>;
    eventsToday: number;
  } | null>(null);
  const [recentEvents, setRecentEvents] = useState<RpgEventRecord[]>([]);
  const [quickStats, setQuickStats] = useState<QuickStats>({ tasksDueToday: 0, mealsToday: 0, transactionsToday: 0 });
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
      window.api.questsGetDueTodayCount(),
      window.api.nutritionGetTodayMealsCount(),
      window.api.financeGetTodayTransactionsCount(),
    ])
      .then(([s, d, events, dueToday, meals, txToday]) => {
        setStats(s);
        setDashStats(d);
        setRecentEvents(events);
        setQuickStats({ tasksDueToday: dueToday, mealsToday: meals, transactionsToday: txToday });
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

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
        {/* Skeleton: module cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ height: 120, background: 'rgba(74,55,32,.06)', borderRadius: 6 }} />
          ))}
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

  const playerName = stats?.title ?? t('app.welcome');
  const level = stats?.level ?? 1;
  const hp = stats?.hp ?? 100;
  const streak = stats?.streak ?? 0;
  const xpToday = Math.round(dashStats?.xpToday ?? 0);

  return (
    <BookPage
      data-tour="welcome"
      eyebrow={t('dashboard.eyebrow', '\u2723 HUBTIFY \u2723  \u2014  CÓDICE DEL AVENTURERO')}
      title={t('dashboard.title', 'Tabla del Aventurero')}
      subtitle={t('dashboard.subtitle', 'Primer folio · do se escriben las nuevas del día y se registran los hechos del campeón')}
    >
      {/* ── row 1: salutation + wax seal ──────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 20, marginBottom: 16 }}>
        <div>
          <p
            className="qb-dropcap"
            style={{
              fontFamily: "'IM Fell English', serif",
              fontSize: 'var(--fs-quote)',
              lineHeight: 1.55,
              color: 'var(--ink)',
              textAlign: 'justify',
            }}
          >
            {t('dashboard.salutation1', 'Salve, noble')}{' '}
            <span style={{ color: 'var(--rubric)', fontWeight: 600 }}>{playerName}</span>.{' '}
            {t('dashboard.salutation2', 'El alba del')}{' '}
            <span className="qb-hand">{new Date().toLocaleDateString(t('dashboard.locale', 'es-AR'), { day: 'numeric', month: 'long' })}</span>{' '}
            {t('dashboard.salutation3', 'ha despuntado sobre el reino;')} {dashStats?.eventsToday ?? 0} {t('dashboard.salutation4', 'hechos registrados al sol, la racha se mantiene en')} {streak} {t('dashboard.salutation5', 'días de gloria. Proseguid con brío \u2014 la fortuna favorece al constante.')}
          </p>
          <div
            style={{
              marginTop: 12,
              fontFamily: "'Cormorant Garamond', serif",
              fontStyle: 'italic',
              fontSize: 'var(--fs-quote)',
              color: 'var(--ink-soft)',
            }}
          >
            {'\u00ab'} {epigraph.quote} {'\u00bb'}
            <span style={{ display: 'block', textAlign: 'right', marginTop: 2, fontSize: 'var(--fs-label)', color: 'var(--ink-faded)' }}>
              {'\u2014'} {epigraph.author}
            </span>
          </div>
        </div>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="qb-seal">
            <div style={{ textAlign: 'center', lineHeight: 1 }}>
              <div style={{ fontSize: 'var(--fs-label)', letterSpacing: '.1em', fontFamily: "'IM Fell English SC', serif", opacity: 0.85 }}>
                LVL
              </div>
              <div style={{ fontSize: 'var(--fs-hero)' }}>{level}</div>
            </div>
          </div>
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
            {t('dashboard.royalSeal', 'sigilo real')} {'\u2198'}
          </div>
        </div>
      </div>

      {/* ── row 2: stat cartouches ────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
        <Cartouche label={t('dashboard.cartLevel', 'NIVEL')} value={level} foot={stats?.title} icon={<Crown width={14} height={14} />} />
        <Cartouche label={t('dashboard.cartXp', 'XP HODIE')} value={`+${xpToday}`} foot={t('dashboard.cartXpFoot', 'ganados al sol')} icon={<Sword width={14} height={14} />} tone="sage" />
        <Cartouche label={t('dashboard.cartStreak', 'RACHA')} value={streak} foot={t('dashboard.cartStreakFoot', 'días de gloria')} icon={<Flame width={14} height={14} />} />
        <Cartouche label={t('dashboard.cartHp', 'VITA')} value={hp} foot={`${t('dashboard.cartHpFoot', 'de')} ${stats?.maxHp ?? 100} ${t('dashboard.cartHpUnit', 'puntos')}`} icon={<Heart width={14} height={14} />} tone="rubric" />
      </div>

      {/* ── row 2b: quick module stats (H3) ────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
        <Cartouche label={t('dashboard.cartDueToday', 'MISIONES HOY')} value={quickStats.tasksDueToday} foot={t('dashboard.cartDueTodayFoot', 'pendientes al sol')} icon={<Sword width={14} height={14} />} />
        <Cartouche label={t('dashboard.cartMeals', 'PROVISIONES')} value={quickStats.mealsToday} foot={t('dashboard.cartMealsFoot', 'registradas hoy')} icon={<Bread width={14} height={14} />} tone="sage" />
        <Cartouche label={t('dashboard.cartTransactions', 'TRANSACCIONES')} value={quickStats.transactionsToday} foot={t('dashboard.cartTransactionsFoot', 'movimientos del día')} icon={<Coin width={14} height={14} />} tone="gold" />
      </div>

      <QBDividerSection />

      {/* ── row 3: four module folios ─────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <Link to="/quests" style={{ textDecoration: 'none', color: 'inherit' }}>
          <ModuleCard
            tome="Tomus I"
            title={t('dashboard.moduleQuests', 'Libro de Misiones')}
            latin="Acta Heroum"
            icon={<Sword width={18} height={18} />}
          >
            <QuestsDashboardWidget />
          </ModuleCard>
        </Link>

        <Link to="/nutrition" style={{ textDecoration: 'none', color: 'inherit' }}>
          <ModuleCard
            tome="Tomus II"
            title={t('dashboard.moduleNutrition', 'Diario de Provisiones')}
            latin="De Cibo et Salute"
            icon={<Bread width={18} height={18} />}
          >
            <NutritionDashboardWidget />
          </ModuleCard>
        </Link>

        <Link to="/finance" style={{ textDecoration: 'none', color: 'inherit' }}>
          <ModuleCard
            tome="Tomus III"
            title={t('dashboard.moduleFinance', 'Libro del Tesorero')}
            latin="De Rebus Aeris"
            icon={<Coin width={18} height={18} />}
          >
            <FinanceDashboardWidget />
          </ModuleCard>
        </Link>

        <Link to="/cauldron" style={{ textDecoration: 'none', color: 'inherit' }}>
          <ModuleCard
            tome="Tomus IV"
            title={t('dashboard.moduleCauldron', 'Cámara del Caldero')}
            latin="Decoctio Magna"
            icon={<Cauldron width={18} height={18} />}
          >
            <CauldronDashboardWidget />
          </ModuleCard>
        </Link>
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
                      {formatEventTime(ev.createdAt)}
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
        {t('dashboard.marginNote', 'nota al margen')} {'\u2014'} {dashStats?.eventsToday ?? 0} {t('dashboard.eventsToday', 'hechos registrados hoy')} {'\u2197'}
      </div>
    </BookPage>
  );
}

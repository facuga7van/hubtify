import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { todayDateString, formatDateString } from '../../../../shared/date-utils';
import { smoothWeightSeries, weightTrendSummary } from '../../../../shared/weight-trend';
import {
  CastleBarChart,
  TreasureLineChart,
  HeatmapCalendar,
} from '../../../shared/components/charts';
import type { BarDatum, PointDatum, CellLevel } from '../../../shared/components/charts';
import { Rune } from '../../../shared/components/codex/CodexPrimitives';
import HelpBubble from '../../../shared/components/HelpBubble';
import { Flame, Book, Tower, Map as MapIcon, Scroll, Scale, HelpSeal, Cauldron, Quill } from '../../../shared/components/icons';
import { normalizeStreak, nutritionToday, DEFAULT_DAY_CUTOFF_HOUR } from '../nutrition-day';
import { getEventDays } from '../event-api';
import type { StreakInfo } from '../nutrition-day';
import type { NutritionProfile, DailySummary, MacroTargets } from '../types';
import { MacroHistory } from './MacroHistory';
import WeeklyScroll from './WeeklyScroll';

interface WeightEntry {
  date: string;
  weightKg: number;
}

type Range = '7d' | '30d' | '90d' | 'year';

const RANGE_DAYS: Record<Range, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  year: 365,
};

/** i18n keys for the range tabs - all four go through t(), no mixed languages. */
const RANGE_LABEL_KEYS: Record<Range, string> = {
  '7d': 'nutrify.range7d',
  '30d': 'nutrify.range30d',
  '90d': 'nutrify.range90d',
  year: 'nutrify.range365d',
};

const RANGE_LABEL_FALLBACKS: Record<Range, string> = {
  '7d': '7 d',
  '30d': '30 d',
  '90d': '90 d',
  year: '365 d',
};

/** Day abbreviation from date string (YYYY-MM-DD) */
function dayAbbr(dateStr: string, locale: string = 'es'): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString(locale, { weekday: 'short' }).slice(0, 3);
}

/** Short date label: DD/MM */
function shortDate(dateStr: string): string {
  return dateStr.slice(8) + '/' + dateStr.slice(5, 7);
}

/** Generate all date strings between start and end (inclusive) */
function dateRange(startStr: string, endStr: string): string[] {
  const dates: string[] = [];
  const cur = new Date(startStr + 'T12:00:00');
  const end = new Date(endStr + 'T12:00:00');
  while (cur <= end) {
    dates.push(formatDateString(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

export default function NutritionCharts() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  const [range, setRange] = useState<Range>('30d');
  const [summaries, setSummaries] = useState<DailySummary[]>([]);
  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const [streakInfo, setStreakInfo] = useState<StreakInfo>({ streak: 0, todayPending: false });
  // Días con evento (asado, cumple): el heatmap los marca como presentes.
  // Feature-detect: sin bridge llega [] y el calendario simplemente no distingue.
  const [eventDays, setEventDays] = useState<string[]>([]);
  const [profile, setProfile] = useState<NutritionProfile | null>(null);
  const [macroTargets, setMacroTargets] = useState<MacroTargets | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoadError(false);
    setLoading(true);
    const end = todayDateString();
    const start = new Date();
    start.setDate(start.getDate() - RANGE_DAYS[range]);
    const startStr = formatDateString(start);

    Promise.all([
      window.api.nutritionGetSummaryRange(startStr, end),
      window.api.nutritionGetWeights(),
      window.api.nutritionGetStreak(),
      window.api.nutritionGetProfile(),
      window.api.nutritionGetMacroTargets(),
      getEventDays(startStr, end),
    ])
      .then(([sums, wts, str, prof, macros, events]) => {
        setSummaries(sums as DailySummary[]);
        setWeights(wts as WeightEntry[]);
        setStreakInfo(normalizeStreak(str));
        setProfile(prof as NutritionProfile | null);
        setMacroTargets(macros as MacroTargets | null);
        setEventDays(events);
        setLoading(false);
      })
      .catch(() => {
        setLoadError(true);
        setLoading(false);
      });
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  // Reload data when account is switched
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [load]);

  // ── Derived data ───────────────────────────────────────────

  // Nutritional today (profile cutoff), so the heatmap's "today" cell is the same
  // day the backend is writing logs to. Falls back to the calendar day until the
  // profile lands.
  const today = profile ? nutritionToday(profile.dayCutoffHour ?? DEFAULT_DAY_CUTOFF_HOUR) : todayDateString();

  // Filter weights by range
  const filteredWeights = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RANGE_DAYS[range]);
    const cutoffStr = formatDateString(cutoff);
    return weights.filter((w) => w.date >= cutoffStr);
  }, [weights, range]);

  // Daily calorie target from profile (tdee - deficit)
  const dailyTarget = useMemo(() => {
    if (!profile || summaries.length === 0) return null;
    const avgTdee =
      summaries.reduce((s, d) => s + d.tdee, 0) / summaries.length;
    return Math.round(avgTdee - (profile.deficitTargetKcal ?? 0));
  }, [profile, summaries]);

  // ── KPI calculations ──────────────────────────────────────

  const kpis = useMemo(() => {
    const daysWithData = summaries.filter((s) => s.totalCaloriesIn > 0);
    let precision = 0;
    if (daysWithData.length > 0 && dailyTarget && dailyTarget > 0) {
      const pctSum = daysWithData.reduce((sum, s) => {
        const ratio = s.totalCaloriesIn / dailyTarget;
        const pct = Math.max(0, 100 - Math.abs(100 - ratio * 100));
        return sum + pct;
      }, 0);
      precision = Math.round(pctSum / daysWithData.length);
    }

    const latestWeight =
      filteredWeights.length > 0
        ? filteredWeights[filteredWeights.length - 1].weightKg
        : null;

    const daysLogged = daysWithData.length;

    return { precision, latestWeight, streak: streakInfo.streak, daysLogged };
  }, [summaries, filteredWeights, dailyTarget, streakInfo.streak]);

  // ── Smoothed weight trend ──────────────────────────────────
  // Raw weigh-ins are noisy (water/sodium/glycogen). We surface an EMA-smoothed
  // trend line + direction instead of reacting to the last raw point.

  const smoothedWeights = useMemo(
    () => smoothWeightSeries(filteredWeights),
    [filteredWeights],
  );

  const trendSummary = useMemo(
    () => weightTrendSummary(filteredWeights),
    [filteredWeights],
  );

  // ── Bar chart data ─────────────────────────────────────────

  const barData: BarDatum[] = useMemo(() => {
    if (summaries.length === 0 || !dailyTarget) return [];

    return summaries.map((s) => {
      let status: 'ok' | 'under' | 'over' = 'ok';
      if (s.totalCaloriesIn > 0) {
        const ratio = s.totalCaloriesIn / dailyTarget;
        if (ratio < 0.9) status = 'under';
        else if (ratio > 1.1) status = 'over';
      }
      return {
        label: range === '7d' ? dayAbbr(s.date, i18n.language) : shortDate(s.date),
        value: s.totalCaloriesIn,
        status,
      };
    });
  }, [summaries, dailyTarget, range, i18n.language]);

  // ── Line chart data (weight) ───────────────────────────────

  const lineData: PointDatum[] = useMemo(
    () =>
      filteredWeights.map((w, i) => ({
        x: i,
        y: w.weightKg,
        label: `${w.weightKg} kg`,
      })),
    [filteredWeights],
  );

  // Smoothed trend overlay — same x-indices as the raw points so they align.
  const trendLineData: PointDatum[] = useMemo(
    () =>
      smoothedWeights.map((w, i) => ({
        x: i,
        y: w.trend,
        label: `${Math.round(w.trend * 10) / 10} kg`,
      })),
    [smoothedWeights],
  );

  const weightXLabels = useMemo(
    () => filteredWeights.map((w) => shortDate(w.date)),
    [filteredWeights],
  );

  // ── Heatmap data ───────────────────────────────────────────

  const heatmapStart = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RANGE_DAYS[range]);
    return formatDateString(cutoff);
  }, [range]);

  const heatmapData: CellLevel[] = useMemo(() => {
    const allDates = dateRange(heatmapStart, today);

    const summaryMap = new Map(summaries.map((s) => [s.date, s]));
    const eventSet = new Set(eventDays);

    return allDates.map((date) => {
      if (date === today) return 'today';
      // The bridged day gets its own first-class tone (dashed gold): neither
      // achieved nor missed - 'miss' would punish exactly what the grace forgave.
      if (date === streakInfo.graceUsedOn) return 'grace';
      // Día con evento: registrar el asado ES presentarse, así que el domingo
      // pinta con intensidad plena (l4, con su ornamento) en vez de quedar como
      // el hueco de siempre. El tooltip cuenta el porqué.
      if (eventSet.has(date)) return 'l4';
      const s = summaryMap.get(date);
      if (!s || s.totalCaloriesIn === 0) return 'miss';

      if (!dailyTarget || dailyTarget <= 0) return 'l2';
      const ratio = s.totalCaloriesIn / dailyTarget;
      const pct = Math.max(0, 100 - Math.abs(100 - ratio * 100));

      if (pct < 20) return 'l0';
      if (pct < 40) return 'l1';
      if (pct < 60) return 'l2';
      if (pct < 80) return 'l3';
      return 'l4';
    });
  }, [summaries, dailyTarget, heatmapStart, today, streakInfo.graceUsedOn, eventDays]);

  const heatmapTooltips = useMemo(() => {
    const allDates = dateRange(heatmapStart, today);
    const summaryMap = new Map(summaries.map((s) => [s.date, s]));
    const eventSet = new Set(eventDays);
    const target = dailyTarget ? Math.round(dailyTarget) : null;

    return allDates.map((date) => {
      const s = summaryMap.get(date);
      const cal = s ? Math.round(s.totalCaloriesIn) : 0;
      const label = date === today ? `${date} (${t('nutrify.today', 'hoy')})` : date;
      // The bridged day reads as a hole in the grid; the tooltip is where it says
      // it did not cost the streak.
      const grace = date === streakInfo.graceUsedOn
        ? `\n${t('nutrify.streakGraceCell', 'Día de gracia: no cortó la racha')}`
        : '';
      const event = eventSet.has(date)
        ? `\n${t('nutrify.eventHeatmapCell', 'Día de evento: registrarlo contó como presentarse')}`
        : '';
      if (!cal) return `${label}\n${t('nutrify.noRecord', 'Sin registro')}${grace}${event}`;
      return (target
        ? `${label}\n${cal.toLocaleString()} / ${target.toLocaleString()} kcal`
        : `${label}\n${cal.toLocaleString()} kcal`) + grace + event;
    });
  }, [summaries, dailyTarget, heatmapStart, today, t, streakInfo.graceUsedOn, eventDays]);

  // ── Render ─────────────────────────────────────────────────

  const rangeTabs = (
    <div className="nutri-range-tabs">
      {(Object.keys(RANGE_DAYS) as Range[]).map((r) => (
        <button
          key={r}
          className={`nutri-range-tab${range === r ? ' active' : ''}`}
          onClick={() => setRange(r)}
        >
          {t(RANGE_LABEL_KEYS[r], RANGE_LABEL_FALLBACKS[r])}
        </button>
      ))}
    </div>
  );

  if (loading) {
    return (
      <div className="nutri-page">
        <div className="nutri-page-head">
          <div>
            <h1 className="nutri-page-title">
            <span className="nutri-title-ico"><Quill width={18} height={18} /></span>{' '}
              {t('nutrify.chronicleTitle', "ALCHEMIST'S CHRONICLE")}
            </h1>
          </div>
          <div className="nutri-head-actions">
            {rangeTabs}
            <button
              className="nutri-btn nutri-btn-ghost"
              onClick={() => navigate('/nutrition')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M19 12H5M5 12l6-6M5 12l6 6"/></svg>{' '}
              {t('common.back', 'Back')}
            </button>
          </div>
        </div>
        <div className="nutri-kpi-strip">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="nutri-skeleton nutri-skeleton--card" />
          ))}
        </div>
        <div className="nutri-card medieval" style={{ marginBottom: 16 }}>
          <div className="nutri-skeleton nutri-skeleton--chart" />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="nutri-page">
        <div className="nutri-page-head">
          <div>
            <h1 className="nutri-page-title">
            <span className="nutri-title-ico"><Quill width={18} height={18} /></span>{' '}
              {t('nutrify.chronicleTitle', "ALCHEMIST'S CHRONICLE")}
            </h1>
          </div>
          <div className="nutri-head-actions">
            <button
              className="nutri-btn nutri-btn-ghost"
              onClick={() => navigate('/nutrition')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M19 12H5M5 12l6-6M5 12l6 6"/></svg>{' '}
              {t('common.back', 'Back')}
            </button>
          </div>
        </div>
        <div className="nutri-card medieval" style={{ textAlign: 'center', padding: 24 }}>
          <p style={{ marginBottom: 12, color: 'var(--rubric)' }}>
            {t('common.somethingWentWrong', 'Something went wrong')}
          </p>
          <button className="nutri-btn" onClick={load}>
            {t('common.tryAgain', 'Try again')}
          </button>
        </div>
      </div>
    );
  }

  const hasData = summaries.some((s) => s.totalCaloriesIn > 0);

  return (
    <div className="nutri-page">
      {/* Page head */}
      <div className="nutri-page-head">
        <div>
          <h1 className="nutri-page-title">
            <span className="nutri-title-ico"><Quill width={18} height={18} /></span>{' '}
            {t('nutrify.chronicleTitle', "ALCHEMIST'S CHRONICLE")}
          </h1>
          <div className="nutri-page-sub">
            {t('nutrify.chronicleSub', 'Sustenance recorded in the parchment')}
            <HelpBubble variant="inline" text={t('nutrify.kpiHelp', 'Indicadores del período: precisión calórica, peso actual, racha de registro y días logueados.')} />
          </div>
        </div>
        <div className="nutri-head-actions">
          {rangeTabs}
          <button
            className="nutri-btn nutri-btn-ghost"
            onClick={() => navigate('/nutrition')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M19 12H5M5 12l6-6M5 12l6 6"/></svg>{' '}
            {t('common.back', 'Back')}
          </button>
        </div>
      </div>

      {/* Pergamino semanal -- ritual de cierre, arriba de todo lo demás */}
      <WeeklyScroll />

      {/* KPI strip */}
      <div className="nutri-kpi-strip">
        <div className="nutri-kpi scroll-kpi">
          <div className="nutri-kpi-icon seal-icon"><HelpSeal width={18} height={18} /></div>
          <div className="nutri-kpi-body">
            <div className="nutri-kpi-label">
              {t('nutrify.precision', 'Precision')}
            </div>
            <div className="nutri-kpi-val">{kpis.precision}%</div>
          </div>
        </div>

        <div className="nutri-kpi scroll-kpi">
          <div className="nutri-kpi-icon seal-icon"><Scale width={18} height={18} /></div>
          <div className="nutri-kpi-body">
            <div className="nutri-kpi-label">
              {t('nutrify.weight', 'Weight')}
            </div>
            <div className="nutri-kpi-val">
              {kpis.latestWeight != null ? (
                <>
                  {kpis.latestWeight}
                  <span
                    style={{
                      fontSize: 'var(--fs-label)',
                      color: 'var(--ink-faded)',
                      marginLeft: 2,
                    }}
                  >
                    kg
                  </span>
                </>
              ) : (
                '\u2014'
              )}
            </div>
            {trendSummary != null && (() => {
              const delta = trendSummary.deltaKg;
              const dir = trendSummary.direction;
              const isDeficit = (profile?.deficitTargetKcal ?? 0) > 0;
              const isSurplus = (profile?.deficitTargetKcal ?? 0) < 0;
              // Tone is goal-aware but never punitive: weight change is informative.
              const isGood = isDeficit ? dir === 'falling' : isSurplus ? dir === 'rising' : false;
              const isBad = isDeficit ? dir === 'rising' : isSurplus ? dir === 'falling' : false;
              const colorClass = isGood ? ' up' : isBad ? ' down' : '';
              const dirWord =
                dir === 'rising'
                  ? t('nutrify.trendRising', 'subiendo')
                  : dir === 'falling'
                    ? t('nutrify.trendFalling', 'bajando')
                    : t('nutrify.trendStable', 'estable');
              return (
                <div className={`nutri-kpi-delta${colorClass}`}>
                  {dir === 'rising' ? (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true"><path d="M5 2l4 6H1z"/></svg>
                  ) : dir === 'falling' ? (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true"><path d="M5 8L1 2h8z"/></svg>
                  ) : (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true"><rect x="1" y="4" width="8" height="2"/></svg>
                  )}{' '}
                  {Math.abs(delta)} kg
                  <span style={{ marginLeft: 4, fontStyle: 'italic', color: 'var(--ink-faded)' }}>
                    {dirWord}
                  </span>
                </div>
              );
            })()}
          </div>
        </div>

        <div className="nutri-kpi scroll-kpi">
          <div className="nutri-kpi-icon seal-icon"><Flame width={18} height={18} /></div>
          <div className="nutri-kpi-body">
            <div className="nutri-kpi-label">
              {t('nutrify.streak', 'Streak')}
            </div>
            <div className="nutri-kpi-val">
              {kpis.streak}
              <span
                style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-faded)', marginLeft: 4 }}
              >
                {t('nutrify.days', 'days')}
              </span>
            </div>
            {/* Pending is not broken: the streak stands, today is still in play. */}
            {streakInfo.todayPending && kpis.streak > 0 && (
              <div className="nutri-streak-note nutri-streak-note--pending">
                {t('nutrify.streakTodayPending', 'En juego hoy')}
              </div>
            )}
            {streakInfo.graceUsedOn && (
              <div className="nutri-streak-note nutri-streak-note--grace"
                title={t('nutrify.streakGraceHelp', 'Un día por semana no te corta la racha.')}>
                {t('nutrify.streakGraceUsed', 'Día de gracia usado ({{date}})', { date: streakInfo.graceUsedOn })}
              </div>
            )}
          </div>
        </div>

        <div className="nutri-kpi scroll-kpi">
          <div className="nutri-kpi-icon seal-icon"><Book width={18} height={18} /></div>
          <div className="nutri-kpi-body">
            <div className="nutri-kpi-label">
              {t('nutrify.daysLogged', 'Days Logged')}
            </div>
            <div className="nutri-kpi-val">
              {kpis.daysLogged}
              <span
                style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-faded)', marginLeft: 4 }}
              >
                / {RANGE_DAYS[range]}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      {hasData ? (
        <>
          <div className="nutri-charts-grid">
            {/* Castle bar chart -- calorie intake */}
            <div className="nutri-card medieval nutri-chart-card">
              <HelpBubble text={t('nutrify.towersHelp', 'Calorías diarias vs tu objetivo. Las barras muestran el consumo real de cada día del período.')} />
              <h3 className="nutri-card-title">
                <span className="t-ico"><Tower width={18} height={18} /></span>{' '}
                {t('nutrify.towersSustenance', 'Towers of Sustenance')}
              </h3>
              <CastleBarChart
                data={barData}
                goalLine={dailyTarget ?? undefined}
                goalLabel={
                  dailyTarget
                    ? `${dailyTarget.toLocaleString()}`
                    : undefined
                }
                themed
                height={220}
                legend={{
                  under: t('nutrify.legendUnder', 'Under target'),
                  ok: t('nutrify.legendOk', 'On target'),
                  over: t('nutrify.legendOver', 'Over target'),
                }}
              />
            </div>

            {/* Treasure line chart -- weight trend */}
            <div className="nutri-card medieval nutri-chart-card">
              <HelpBubble text={t('nutrify.weightHelp', 'Evolución de tu peso con tendencia suavizada. La velocidad muestra el cambio semanal promedio.')} />
              <h3 className="nutri-card-title">
                <span className="t-ico"><MapIcon width={18} height={18} /></span>{' '}
                {t('nutrify.weightJourney', 'Weight Journey')}
                {trendSummary != null && (
                  <Rune tone={trendSummary.direction === 'rising' ? 'rubric' : 'sage'}>
                    {trendSummary.kgPerWeek > 0 ? '+' : ''}{trendSummary.kgPerWeek} {t('nutrify.kgPerWeek', 'kg/sem')}
                  </Rune>
                )}
              </h3>
              {lineData.length >= 2 ? (
                <TreasureLineChart
                  data={lineData}
                  trendData={trendLineData}
                  themed
                  showArea
                  height={200}
                  xLabels={weightXLabels}
                  todayIndex={lineData.length - 1}
                />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
                  <p style={{ opacity: 0.65, fontStyle: 'italic', textAlign: 'center', fontFamily: "'IM Fell English', serif", color: 'var(--ink-faded)' }}>
                    {t('nutrify.needMoreWeights', 'Registrá al menos 2 pesos para ver la tendencia')}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Heatmap -- full width */}
          <div className="nutri-card medieval nutri-chart-card">
            <HelpBubble text={t('nutrify.consistencyHelp', 'Calendario de consistencia: los colores más intensos indican días con registro más completo.')} />
            <h3 className="nutri-card-title">
              <span className="t-ico"><Scroll width={18} height={18} /></span>{' '}
              {t('nutrify.consistencyCalendar', 'Consistency Calendar')}
            </h3>
            {/* TODO: Add onCellClick to HeatmapCalendar for touch tooltip support */}
            <HeatmapCalendar data={heatmapData} startDate={heatmapStart} tooltips={heatmapTooltips} themed legend />
          </div>

          {/* Macro balance -- average daily macros over the range vs target */}
          <div className="nutri-card medieval nutri-chart-card">
            <HelpBubble text={t('nutrify.macroBalanceHelp', 'Promedio diario de proteína, carbohidratos y grasa del período comparado con tus objetivos. Solo cuenta los días con macros registrados.')} />
            <h3 className="nutri-card-title">
              <span className="t-ico"><Cauldron width={18} height={18} /></span>{' '}
              {t('nutrify.macroBalance', 'Balance of Nutrients')}
            </h3>
            <MacroHistory summaries={summaries} targets={macroTargets} t={t} />
          </div>
        </>
      ) : (
        <div className="nutri-card medieval" style={{ textAlign: 'center', padding: '32px 24px' }}>
          <p style={{ color: 'var(--ink-faded)', fontStyle: 'italic', marginBottom: 16 }}>
            {t('nutrify.noChartData', 'Logueá tu primer día para ver los gráficos')}
          </p>
          <button className="rpg-button" onClick={() => navigate('/nutrition')}>
            {t('nutrify.goToToday', 'Ir a hoy')}
          </button>
        </div>
      )}
    </div>
  );
}

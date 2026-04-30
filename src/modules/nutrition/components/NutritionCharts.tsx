import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { todayDateString, formatDateString } from '../../../../shared/date-utils';
import {
  CastleBarChart,
  TreasureLineChart,
  HeatmapCalendar,
} from '../../../shared/components/charts';
import type { BarDatum, PointDatum, CellLevel } from '../../../shared/components/charts';
import { Rune } from '../../../shared/components/codex/CodexPrimitives';
import HelpBubble from '../../../shared/components/HelpBubble';
import { Flame, Book, Tower, Map as MapIcon, Scroll } from '../../../shared/components/icons';
import type { NutritionProfile, DailySummary } from '../types';

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

const RANGE_LABELS: Record<Range, string> = {
  '7d': '7d',
  '30d': '30d',
  '90d': '90d',
  year: 'Year',
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
  const [streak, setStreak] = useState(0);
  const [profile, setProfile] = useState<NutritionProfile | null>(null);
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
    ])
      .then(([sums, wts, str, prof]) => {
        setSummaries(sums as DailySummary[]);
        setWeights(wts as WeightEntry[]);
        setStreak(str);
        setProfile(prof as NutritionProfile | null);
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

  const today = todayDateString();

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
    const firstWeight =
      filteredWeights.length > 1 ? filteredWeights[0].weightKg : null;
    const weightDelta =
      latestWeight != null && firstWeight != null
        ? +(latestWeight - firstWeight).toFixed(1)
        : null;

    const daysLogged = daysWithData.length;

    // Weight velocity: delta kg per week from filtered weights
    let weightVelocity: number | null = null;
    if (filteredWeights.length >= 2) {
      const first = filteredWeights[0];
      const last = filteredWeights[filteredWeights.length - 1];
      const daysBetween = Math.max(1,
        (new Date(last.date + 'T12:00:00').getTime() - new Date(first.date + 'T12:00:00').getTime()) / (1000 * 60 * 60 * 24)
      );
      const weeks = daysBetween / 7;
      if (weeks > 0) {
        weightVelocity = +((last.weightKg - first.weightKg) / weeks).toFixed(2);
      }
    }

    return { precision, latestWeight, weightDelta, streak, daysLogged, weightVelocity };
  }, [summaries, filteredWeights, dailyTarget, streak]);

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

    return allDates.map((date) => {
      if (date === today) return 'today';
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
  }, [summaries, dailyTarget, heatmapStart, today]);

  const heatmapTooltips = useMemo(() => {
    const allDates = dateRange(heatmapStart, today);
    const summaryMap = new Map(summaries.map((s) => [s.date, s]));
    const target = dailyTarget ? Math.round(dailyTarget) : null;

    return allDates.map((date) => {
      const s = summaryMap.get(date);
      const cal = s ? Math.round(s.totalCaloriesIn) : 0;
      const label = date === today ? `${date} (${t('nutrify.today', 'hoy')})` : date;
      if (!cal) return `${label}\n${t('nutrify.noRecord', 'Sin registro')}`;
      return target
        ? `${label}\n${cal.toLocaleString()} / ${target.toLocaleString()} kcal`
        : `${label}\n${cal.toLocaleString()} kcal`;
    });
  }, [summaries, dailyTarget, heatmapStart, today, t]);

  // ── Render ─────────────────────────────────────────────────

  const rangeTabs = (
    <div className="nutri-range-tabs">
      {(Object.keys(RANGE_DAYS) as Range[]).map((r) => (
        <button
          key={r}
          className={`nutri-range-tab${range === r ? ' active' : ''}`}
          onClick={() => setRange(r)}
        >
          {r === 'year'
            ? t('nutrify.year', 'Yr')
            : RANGE_LABELS[r]}
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
              <span className="nutri-title-ico">{'\u2694'}</span>{' '}
              {t('nutrify.chronicleTitle', "ALCHEMIST'S CHRONICLE")}
            </h1>
          </div>
          <div className="nutri-head-actions">
            {rangeTabs}
            <button
              className="nutri-btn nutri-btn-ghost"
              onClick={() => navigate('/nutrition')}
            >
              {'\u2190'} {t('common.back', 'Back')}
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
              <span className="nutri-title-ico">{'\u2694'}</span>{' '}
              {t('nutrify.chronicleTitle', "ALCHEMIST'S CHRONICLE")}
            </h1>
          </div>
          <div className="nutri-head-actions">
            <button
              className="nutri-btn nutri-btn-ghost"
              onClick={() => navigate('/nutrition')}
            >
              {'\u2190'} {t('common.back', 'Back')}
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
            <span className="nutri-title-ico">{'\u2694'}</span>{' '}
            {t('nutrify.chronicleTitle', "ALCHEMIST'S CHRONICLE")}
          </h1>
          <div className="nutri-page-sub">
            {t('nutrify.chronicleSub', 'Sustenance recorded in the parchment')}
          </div>
        </div>
        <div className="nutri-head-actions">
          {rangeTabs}
          <button
            className="nutri-btn nutri-btn-ghost"
            onClick={() => navigate('/nutrition')}
          >
            {'\u2190'} {t('common.back', 'Back')}
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="nutri-kpi-strip">
        <HelpBubble text={t('nutrify.kpiHelp', 'Indicadores del período: precisión calórica, peso actual, racha de registro y días logueados.')} />
        <div className="nutri-kpi scroll-kpi">
          <div className="nutri-kpi-icon seal-icon">{'\u2720'}</div>
          <div className="nutri-kpi-body">
            <div className="nutri-kpi-label">
              {t('nutrify.precision', 'Precision')}
            </div>
            <div className="nutri-kpi-val">{kpis.precision}%</div>
          </div>
        </div>

        <div className="nutri-kpi scroll-kpi">
          <div className="nutri-kpi-icon seal-icon">{'\u2696'}</div>
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
            {kpis.weightDelta != null && (() => {
              const isDeficit = (profile?.deficitTargetKcal ?? 0) > 0;
              const isSurplus = (profile?.deficitTargetKcal ?? 0) < 0;
              const isGood = isDeficit ? kpis.weightDelta! < 0 : isSurplus ? kpis.weightDelta! > 0 : false;
              const isBad = isDeficit ? kpis.weightDelta! > 0 : isSurplus ? kpis.weightDelta! < 0 : false;
              const colorClass = isGood ? ' up' : isBad ? ' down' : '';
              return (
                <div className={`nutri-kpi-delta${colorClass}`}>
                  {kpis.weightDelta! > 0 ? '\u25B2' : '\u25BC'}{' '}
                  {Math.abs(kpis.weightDelta!)} kg
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
                {kpis.weightVelocity != null && (
                  <Rune tone={kpis.weightVelocity <= 0 ? 'sage' : 'rubric'}>
                    {kpis.weightVelocity > 0 ? '+' : ''}{kpis.weightVelocity} {t('nutrify.kgPerWeek', 'kg/sem')}
                  </Rune>
                )}
              </h3>
              {lineData.length >= 2 ? (
                <TreasureLineChart
                  data={lineData}
                  themed
                  showArea
                  height={200}
                  xLabels={weightXLabels}
                  todayIndex={lineData.length - 1}
                />
              ) : (
                <p
                  style={{
                    opacity: 0.65,
                    fontStyle: 'italic',
                    textAlign: 'center',
                    padding: 24,
                    fontFamily: "'IM Fell English', serif",
                    color: 'var(--ink-faded)',
                  }}
                >
                  {t(
                    'nutrify.needMoreWeights',
                    'Log at least 2 weight entries to see the trend',
                  )}
                </p>
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
            <HeatmapCalendar data={heatmapData} startDate={heatmapStart} tooltips={heatmapTooltips} themed legend />
          </div>
        </>
      ) : (
        <div className="nutri-card medieval">
          <p
            style={{
              opacity: 0.65,
              fontStyle: 'italic',
              textAlign: 'center',
              padding: 24,
              fontFamily: "'IM Fell English', serif",
              color: 'var(--ink-faded)',
            }}
          >
            {t(
              'nutrify.startLogging',
              'Start logging food to see charts here',
            )}
          </p>
        </div>
      )}
    </div>
  );
}

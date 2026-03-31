import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../../shared/components/PageHeader';
import { CoinStatCard } from '../../finance/components/shared/CoinStatCard';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { todayDateString, formatDateString } from '../../../../shared/date-utils';

interface DailySummary { date: string; totalCaloriesIn: number; bmr: number; tdee: number; balance: number; }
interface WeightEntry { date: string; weightKg: number; }

const fireIcon = (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 1c0 4-4 6-4 9a5 5 0 0010 0c0-3-4-5-4-9z" />
  </svg>
);
const scaleIcon = (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 5l7-3 7 3M3 5l3 8h8l3-8M10 2v16" />
  </svg>
);
const chartIcon = (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 17V9M8 17V5M13 17V10M18 17V3" />
  </svg>
);
const calendarIcon = (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="16" height="14" rx="2" /><path d="M6 2v4M14 2v4M2 9h16" />
  </svg>
);

export default function NutritionCharts() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [summaries, setSummaries] = useState<DailySummary[]>([]);
  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const [streak, setStreak] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoadError(false);
    const end = todayDateString();
    const start = new Date();
    start.setDate(start.getDate() - 30);
    const startStr = formatDateString(start);

    Promise.all([
      window.api.nutritionGetSummaryRange(startStr, end),
      window.api.nutritionGetWeights(),
      window.api.nutritionGetStreak(),
    ]).then(([sums, wts, str]) => {
      setSummaries(sums as DailySummary[]);
      setWeights(wts as WeightEntry[]);
      setStreak(str);
      setLoading(false);
    }).catch(() => setLoadError(true));
  };

  useEffect(() => { load(); }, []);

  const chartData = summaries.map((s) => ({
    date: s.date.slice(5), // MM-DD
    consumed: s.totalCaloriesIn,
    tdee: s.tdee,
  }));

  // Weekly balance: sum of (tdee - consumed) for last 7 logged days
  const last7 = summaries.slice(-7);
  const weeklyBalance = last7.reduce((s, d) => s + d.balance, 0);

  const avgCalories = summaries.length > 0
    ? Math.round(summaries.reduce((sum, s) => sum + s.totalCaloriesIn, 0) / summaries.length)
    : 0;
  const daysLogged = summaries.filter(s => s.totalCaloriesIn > 0).length;

  const backButton = (
    <button className="rpg-button" onClick={() => navigate('/nutrition')}
      style={{ fontSize: '0.75rem', padding: '4px 12px' }}>
      {t('common.back')}
    </button>
  );

  if (loading) return (
    <div>
      <PageHeader title={t('nutrify.dashboard')} subtitle={t('nutrify.dashboardSub')} actions={backButton} />
      <div className="nutri-stats-grid">
        {[1,2,3,4].map(i => (
          <div key={i} className="nutri-skeleton nutri-skeleton--card" />
        ))}
      </div>
      <div className="rpg-card" style={{ marginBottom: 16 }}>
        <div className="nutri-skeleton nutri-skeleton--chart" />
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader title={t('nutrify.dashboard')} subtitle={t('nutrify.dashboardSub')} actions={backButton} />

      {/* Stats row */}
      <div className="nutri-section nutri-stagger-1">
        <div className="nutri-stats-grid">
          <CoinStatCard icon={fireIcon} label={t('nutrify.dayStreak')} value={streak} color="gold" prefix="" />
          <CoinStatCard
            icon={scaleIcon}
            label={t('nutrify.weeklyBalance')}
            value={weeklyBalance}
            color={weeklyBalance >= 0 ? 'green' : 'red'}
            prefix={weeklyBalance > 0 ? '+' : ''}
          />
          <CoinStatCard icon={chartIcon} label={t('nutrify.avgDailyKcal')} value={avgCalories} color="gold" prefix="" />
          <CoinStatCard icon={calendarIcon} label={t('nutrify.daysLogged')} value={daysLogged} color="gold" prefix="" />
        </div>
      </div>

      {/* Calories chart */}
      <div className="nutri-section nutri-stagger-2">
        {chartData.length > 0 && (
          <div className="rpg-card" style={{ marginBottom: 16 }}>
            <div className="rpg-card-title">{t('nutrify.calories30')}</div>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--rpg-parchment-dark)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="consumed" stroke="var(--rpg-hp-red)" name="Consumed" dot={false} />
                <Line type="monotone" dataKey="tdee" stroke="var(--rpg-xp-green)" name="TDEE" dot={false} strokeDasharray="5 5" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Weight chart */}
      <div className="nutri-section nutri-stagger-3">
        {weights.length >= 1 && (
          <div className="rpg-card">
            <div className="rpg-card-title">{t('nutrify.weightTrend')}</div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={weights.map((w) => ({ date: w.date.slice(5), weight: w.weightKg }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--rpg-parchment-dark)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis domain={['dataMin - 2', 'dataMax + 2']} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="weight" stroke="var(--rpg-gold)" name={t('nutrify.weight') + ' (kg)'}
                  dot={{ r: 4, fill: 'var(--rpg-gold)' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {loadError && (
        <div className="rpg-card" style={{ textAlign: 'center', padding: 24 }}>
          <p style={{ marginBottom: 12, color: 'var(--rpg-hp-red)' }}>{t('common.somethingWentWrong')}</p>
          <button className="rpg-button" onClick={load}>{t('common.tryAgain')}</button>
        </div>
      )}

      {!loadError && chartData.length === 0 && (
        <div className="rpg-card">
          <p style={{ opacity: 0.5, fontStyle: 'italic', textAlign: 'center', padding: 24 }}>
            {t('nutrify.startLogging')}
          </p>
        </div>
      )}
    </div>
  );
}

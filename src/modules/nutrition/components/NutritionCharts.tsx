import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../../shared/components/PageHeader';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { todayDateString, formatDateString } from '../../../../shared/date-utils';

interface DailySummary { date: string; totalCaloriesIn: number; bmr: number; tdee: number; balance: number; }
interface WeightEntry { date: string; weightKg: number; }

export default function NutritionCharts() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [summaries, setSummaries] = useState<DailySummary[]>([]);
  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const [streak, setStreak] = useState(0);

  useEffect(() => {
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
    });
  }, []);

  const chartData = summaries.map((s) => ({
    date: s.date.slice(5), // MM-DD
    consumed: s.totalCaloriesIn,
    tdee: s.tdee,
  }));

  return (
    <div>
      <PageHeader title={t('nutrify.dashboard')} subtitle={t('nutrify.dashboardSub')}
        actions={
          <button className="rpg-button" onClick={() => navigate('/nutrition')}
            style={{ fontSize: '0.75rem', padding: '4px 12px' }}>
            ← {t('common.back')}
          </button>
        }
      />

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <div className="rpg-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontFamily: 'Fira Code, monospace', color: 'var(--rpg-wood)' }}>
            {streak}
          </div>
          <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>{t('nutrify.dayStreak')}</div>
        </div>
        <div className="rpg-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontFamily: 'Fira Code, monospace', color: 'var(--rpg-wood)' }}>
            {summaries.length > 0
              ? Math.round(summaries.reduce((s, d) => s + d.totalCaloriesIn, 0) / summaries.length)
              : 0}
          </div>
          <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>{t('nutrify.avgDailyKcal')}</div>
        </div>
        <div className="rpg-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontFamily: 'Fira Code, monospace', color: 'var(--rpg-wood)' }}>
            {summaries.length}
          </div>
          <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>{t('nutrify.daysLogged')}</div>
        </div>
      </div>

      {/* Calories chart */}
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

      {/* Weight chart */}
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

      {chartData.length === 0 && (
        <div className="rpg-card">
          <p style={{ opacity: 0.5, fontStyle: 'italic', textAlign: 'center', padding: 24 }}>
            {t('nutrify.startLogging')}
          </p>
        </div>
      )}
    </div>
  );
}

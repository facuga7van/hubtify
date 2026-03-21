import { useState, useEffect } from 'react';
import PageHeader from '../../../shared/components/PageHeader';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface DailySummary { date: string; totalCaloriesIn: number; bmr: number; tdee: number; balance: number; }
interface WeightEntry { date: string; weightKg: number; }

export default function NutritionCharts() {
  const [summaries, setSummaries] = useState<DailySummary[]>([]);
  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    const end = new Date().toLocaleDateString('en-CA');
    const start = new Date();
    start.setDate(start.getDate() - 30);
    const startStr = start.toLocaleDateString('en-CA');

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
      <PageHeader title="Nutrition Dashboard" subtitle="Last 30 days overview" />

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <div className="rpg-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontFamily: 'Fira Code, monospace', color: 'var(--rpg-wood)' }}>
            {streak}
          </div>
          <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>Day Streak</div>
        </div>
        <div className="rpg-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontFamily: 'Fira Code, monospace', color: 'var(--rpg-wood)' }}>
            {summaries.length > 0
              ? Math.round(summaries.reduce((s, d) => s + d.totalCaloriesIn, 0) / summaries.length)
              : 0}
          </div>
          <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>Avg Daily kcal</div>
        </div>
        <div className="rpg-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontFamily: 'Fira Code, monospace', color: 'var(--rpg-wood)' }}>
            {summaries.length}
          </div>
          <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>Days Logged</div>
        </div>
      </div>

      {/* Calories chart */}
      {chartData.length > 0 && (
        <div className="rpg-card" style={{ marginBottom: 16 }}>
          <div className="rpg-card-title">Calories (Last 30 Days)</div>
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
      {weights.length > 1 && (
        <div className="rpg-card">
          <div className="rpg-card-title">Weight Trend</div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={weights.map((w) => ({ date: w.date.slice(5), weight: w.weightKg }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--rpg-parchment-dark)" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="weight" stroke="var(--rpg-gold)" name="Weight (kg)" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {chartData.length === 0 && (
        <div className="rpg-card">
          <p style={{ opacity: 0.5, fontStyle: 'italic', textAlign: 'center', padding: 24 }}>
            Start logging food to see charts here
          </p>
        </div>
      )}
    </div>
  );
}

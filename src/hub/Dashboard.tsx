import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import PageHeader from '../shared/components/PageHeader';
import Loading from '../shared/components/Loading';
import QuestsDashboardWidget from '../modules/quests/components/QuestsDashboardWidget';
import NutritionDashboardWidget from '../modules/nutrition/components/NutritionDashboardWidget';
import FinanceDashboardWidget from '../modules/finance/components/DashboardWidget';
import type { PlayerStats } from '../../shared/types';
import './styles/components.css';

export default function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [dashStats, setDashStats] = useState<{ xpToday: number; xpHistory: Array<{ date: string; xp: number }>; eventsToday: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = () => {
    setLoadError(false);
    setLoading(true);
    Promise.all([
      window.api.getRpgStats(),
      window.api.rpgGetDashboardStats(),
    ]).then(([s, d]) => {
      setStats(s);
      setDashStats(d);
    }).catch(() => setLoadError(true)).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  if (loading) return <Loading />;

  if (loadError) return (
    <div style={{ padding: 24, textAlign: 'center' }}>
      <p style={{ marginBottom: 12, color: 'var(--rpg-hp-red)' }}>{t('common.somethingWentWrong')}</p>
      <button className="rpg-button" onClick={load}>{t('common.tryAgain')}</button>
    </div>
  );

  const chartData = dashStats?.xpHistory.map((d) => ({
    date: d.date.slice(5), // MM-DD
    xp: Math.round(d.xp),
  })) ?? [];

  return (
    <div>
      <PageHeader title={t('app.welcome')} subtitle={t('app.welcomeSub')} />

      {/* Stats row */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
          <div className="rpg-card rpg-stat-card">
            <div className="rpg-stat-number">{stats.level}</div>
            <div className="rpg-stat-label">{t('rpg.level')}</div>
          </div>
          <div className="rpg-card rpg-stat-card">
            <div className="rpg-stat-number" style={{ color: 'var(--rpg-xp-green)' }}>
              +{Math.round(dashStats?.xpToday ?? 0)}
            </div>
            <div className="rpg-stat-label">XP {t('questify.doneToday').split(' ')[0]}</div>
          </div>
          <div className="rpg-card rpg-stat-card">
            <div className="rpg-stat-number">{stats.streak}</div>
            <div className="rpg-stat-label">{t('rpg.streak')}</div>
          </div>
          <div className="rpg-card rpg-stat-card">
            <div className="rpg-stat-number" style={{
              color: stats.hp > 75 ? 'var(--rpg-xp-green)' : stats.hp > 25 ? 'var(--rpg-gold)' : 'var(--rpg-hp-red)',
            }}>
              {stats.hp}
            </div>
            <div className="rpg-stat-label">HP</div>
          </div>
        </div>
      )}

      {/* XP History chart */}
      {chartData.length > 0 && (
        <div className="rpg-card" style={{ marginBottom: 16 }}>
          <div className="rpg-card-title">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.3" strokeLinecap="round">
              <rect x="1" y="8" width="3" height="6"/><rect x="6" y="4" width="3" height="10"/><rect x="11" y="1" width="3" height="13"/>
            </svg>
            XP — {t('nutrify.daysLogged').replace(/\d+/, '7')}
          </div>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={chartData}>
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={40} />
              <Tooltip />
              <Bar dataKey="xp" fill="var(--rpg-xp-green)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Module widgets */}
      <div className="dashboard-grid">
        <div className="rpg-card dashboard-widget" onClick={() => navigate('/quests')}>
          <div className="rpg-card-title">
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2l-8 8M6 10l-2 2 2 2 2-2M10.5 5.5l2 2M14 2l2 2-3 3"/>
            </svg>
            Questify
          </div>
          <QuestsDashboardWidget />
        </div>

        <div className="rpg-card dashboard-widget" onClick={() => navigate('/nutrition')}>
          <div className="rpg-card-title">
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3h6v4c0 2-1.5 3-3 3s-3-1-3-3V3z"/><path d="M9 10v3M6 13h6"/>
            </svg>
            Nutrify
          </div>
          <NutritionDashboardWidget />
        </div>

        <div className="rpg-card dashboard-widget" onClick={() => navigate('/finance')}>
          <div className="rpg-card-title">
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="7" cy="10" rx="5" ry="3"/><path d="M2 10v2c0 1.7 2.2 3 5 3s5-1.3 5-3v-2"/>
            </svg>
            Coinify
          </div>
          <FinanceDashboardWidget />
        </div>

        <div className="rpg-card dashboard-widget" onClick={() => navigate('/character')}>
          <div className="rpg-card-title">
            <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 2L3 5v4c0 4 3 6 6 7 3-1 6-3 6-7V5L9 2z"/><path d="M7 9l2 2 3-4"/>
            </svg>
            {t('nav.character')}
          </div>
          {stats && (
            <div>
              <p className="rpg-stat-number" style={{ fontSize: '1.2rem' }}>
                {t('common.levelPrefix')}{stats.level} — {stats.title}
              </p>
              <p className="rpg-stat-label" style={{ marginTop: 4 }}>
                {dashStats?.eventsToday ?? 0} {t('questify.doneToday')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import PageHeader from '../shared/components/PageHeader';
import HpBar from '../shared/components/HpBar';
import XpBar from '../shared/components/XpBar';
import Character from './Character';
import { xpThreshold } from '../../shared/rpg-engine';
import type { PlayerStats, RpgEventRecord } from '../../shared/types';

export default function CharacterPage() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [history, setHistory] = useState<RpgEventRecord[]>([]);

  useEffect(() => {
    window.api.getRpgStats().then(setStats).catch(console.error);
    window.api.getRpgHistory(20).then(setHistory).catch(console.error);
  }, []);

  if (!stats) return <div style={{ padding: 24, opacity: 0.5 }}>Loading...</div>;

  const hpState = stats.hp <= 25 ? t('character.injured') : stats.hp <= 50 ? t('character.tired') : stats.hp <= 75 ? t('character.healthy') : t('character.radiant');
  const hpColor = stats.hp <= 25 ? 'var(--rpg-hp-red)' : stats.hp <= 50 ? '#e67e22' : stats.hp <= 75 ? 'var(--rpg-xp-green)' : 'var(--rpg-gold)';

  return (
    <div>
      <PageHeader title={t('character.title')} subtitle={t('character.subtitle')} />

      {/* Main character card */}
      <div className="rpg-card" style={{ marginBottom: 16, textAlign: 'center' }}>
        <Character size={128} canCustomize />
        <h3 style={{ fontSize: '1.3rem', color: 'var(--rpg-gold)', marginBottom: 4 }}>
          {t('rpg.level')} {stats.level}
        </h3>
        <p style={{ fontSize: '1rem', opacity: 0.8, marginBottom: 16 }}>{stats.title}</p>

        <div style={{ maxWidth: 300, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <HpBar hp={stats.hp} maxHp={stats.maxHp} />
          <XpBar xp={stats.xp} xpToNextLevel={stats.xpToNextLevel} level={stats.level} />
        </div>

        <p style={{ fontSize: '0.85rem', color: hpColor, marginTop: 8 }}>
          {t('character.status')}: {hpState}
        </p>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <div className="rpg-card rpg-stat-card">
          <div className="rpg-stat-number">{stats.xp}</div>
          <div className="rpg-stat-label">{t('character.totalXp')}</div>
        </div>
        <div className="rpg-card rpg-stat-card">
          <div className="rpg-stat-number">{stats.streak}</div>
          <div className="rpg-stat-label">{t('character.dayStreak')}</div>
        </div>
        <div className="rpg-card rpg-stat-card">
          <div className="rpg-stat-number">{stats.dailyCombo}</div>
          <div className="rpg-stat-label">{t('character.todayCombo')}</div>
        </div>
      </div>

      {/* Module stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <div className="rpg-card rpg-stat-card">
          <div className="rpg-stat-number">{stats.totalTasks}</div>
          <div className="rpg-stat-label">{t('character.questifyCompleted')}</div>
        </div>
        <div className="rpg-card rpg-stat-card">
          <div className="rpg-stat-number">{stats.totalMeals}</div>
          <div className="rpg-stat-label">{t('character.nutrifylLogged')}</div>
        </div>
        <div className="rpg-card rpg-stat-card">
          <div className="rpg-stat-number">{stats.totalExpenses}</div>
          <div className="rpg-stat-label">{t('character.coinifyTracked')}</div>
        </div>
      </div>

      {/* Level progress */}
      <div className="rpg-card" style={{ marginBottom: 16 }}>
        <div className="rpg-card-title">{t('character.levelProgress')}</div>
        <p style={{ fontSize: '0.9rem' }}>
          {t('character.xpToLevel', { level: stats.level + 1 })} — {stats.xpToNextLevel}
          {' '}{t('character.xpNeeded', { xp: xpThreshold(stats.level + 1) })}
        </p>
        <p style={{ fontSize: '0.85rem', opacity: 0.6, marginTop: 4 }}>
          {t('character.nextTitle')}: {getNextTitle(stats.level)}
        </p>
      </div>

      {/* Recent activity */}
      <div className="rpg-card">
        <div className="rpg-card-title">{t('character.recentActivity')}</div>
        {history.length === 0 && <p style={{ opacity: 0.5, fontStyle: 'italic' }}>{t('character.noActivity')}</p>}
        {history.map((event) => (
          <div key={event.id} style={{
            display: 'flex', justifyContent: 'space-between', padding: '4px 0',
            borderBottom: '1px solid var(--rpg-parchment-dark)', fontSize: '0.85rem',
          }}>
            <span>{formatEventType(event.eventType)}</span>
            <span style={{ fontFamily: 'Fira Code, monospace' }}>
              {event.xpGained > 0 ? '+' : ''}{Math.round(event.xpGained)} XP
              {event.hpChange !== 0 && ` | ${event.hpChange > 0 ? '+' : ''}${Math.round(event.hpChange)} HP`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function getNextTitle(currentLevel: number): string {
  const thresholds: [number, string][] = [[50,'Leyenda'],[40,'Hero'],[30,'Champion'],[20,'Caballero'],[10,'Guerrero'],[5,'Escudero']];
  for (const [level, title] of thresholds) {
    if (currentLevel < level) return `${title} (Lv.${level})`;
  }
  return 'Max level reached!';
}

function formatEventType(type: string): string {
  const map: Record<string, string> = {
    TASK_COMPLETED: '⚔ Quest completed',
    TASK_UNCOMPLETED: '⚔ Quest uncompleted',
    SUBTASK_COMPLETED: '⚔ Subtask completed',
    MEAL_LOGGED: '🍖 Meal logged',
    EXPENSE_TRACKED: '💰 Expense tracked',
    LOAN_SETTLED: '💰 Loan settled',
  };
  return map[type] ?? type;
}

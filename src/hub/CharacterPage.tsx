import { useState, useEffect } from 'react';
import HpBar from '../shared/components/HpBar';
import XpBar from '../shared/components/XpBar';
import { xpThreshold } from '../../shared/rpg-engine';
import type { PlayerStats, RpgEventRecord } from '../../shared/types';

export default function CharacterPage() {
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [history, setHistory] = useState<RpgEventRecord[]>([]);

  useEffect(() => {
    window.api.getRpgStats().then(setStats);
    window.api.getRpgHistory(20).then(setHistory);
  }, []);

  if (!stats) return <div style={{ padding: 24, opacity: 0.5 }}>Loading...</div>;

  const hpState = stats.hp <= 25 ? 'Injured' : stats.hp <= 50 ? 'Tired' : stats.hp <= 75 ? 'Healthy' : 'Radiant';
  const hpColor = stats.hp <= 25 ? 'var(--rpg-hp-red)' : stats.hp <= 50 ? '#e67e22' : stats.hp <= 75 ? 'var(--rpg-xp-green)' : 'var(--rpg-gold)';

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>Character</h2>

      {/* Main character card */}
      <div className="rpg-card" style={{ marginBottom: 16, textAlign: 'center' }}>
        <div style={{
          width: 96, height: 96, borderRadius: '50%',
          background: 'var(--rpg-parchment-dark)', border: '3px solid var(--rpg-gold)',
          margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '2.5rem',
        }}>⚔</div>
        <h3 style={{ fontSize: '1.3rem', color: 'var(--rpg-gold)', marginBottom: 4 }}>
          Level {stats.level}
        </h3>
        <p style={{ fontSize: '1rem', opacity: 0.8, marginBottom: 16 }}>{stats.title}</p>

        <div style={{ maxWidth: 300, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <HpBar hp={stats.hp} maxHp={stats.maxHp} />
          <XpBar xp={stats.xp} xpToNextLevel={stats.xpToNextLevel} level={stats.level} />
        </div>

        <p style={{ fontSize: '0.85rem', color: hpColor, marginTop: 8 }}>
          Status: {hpState}
        </p>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <div className="rpg-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontFamily: 'Fira Code, monospace', color: 'var(--rpg-wood)' }}>
            {stats.xp}
          </div>
          <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>Total XP</div>
        </div>
        <div className="rpg-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontFamily: 'Fira Code, monospace', color: 'var(--rpg-wood)' }}>
            {stats.streak}
          </div>
          <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>Day Streak 🔥</div>
        </div>
        <div className="rpg-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontFamily: 'Fira Code, monospace', color: 'var(--rpg-wood)' }}>
            {stats.dailyCombo}
          </div>
          <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>Today's Combo</div>
        </div>
      </div>

      {/* Module stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <div className="rpg-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.2rem', fontFamily: 'Fira Code, monospace' }}>{stats.totalTasks}</div>
          <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>Quests Completed</div>
        </div>
        <div className="rpg-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.2rem', fontFamily: 'Fira Code, monospace' }}>{stats.totalMeals}</div>
          <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>Meals Logged</div>
        </div>
        <div className="rpg-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.2rem', fontFamily: 'Fira Code, monospace' }}>{stats.totalExpenses}</div>
          <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>Expenses Tracked</div>
        </div>
      </div>

      {/* Level progress */}
      <div className="rpg-card" style={{ marginBottom: 16 }}>
        <div className="rpg-card-title">Level Progress</div>
        <p style={{ fontSize: '0.9rem' }}>
          {stats.xpToNextLevel} XP to level {stats.level + 1}
          {' '}({xpThreshold(stats.level + 1)} XP total needed)
        </p>
        <p style={{ fontSize: '0.85rem', opacity: 0.6, marginTop: 4 }}>
          Next title: {getNextTitle(stats.level)}
        </p>
      </div>

      {/* Recent activity */}
      <div className="rpg-card">
        <div className="rpg-card-title">Recent Activity</div>
        {history.length === 0 && <p style={{ opacity: 0.5, fontStyle: 'italic' }}>No activity yet</p>}
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

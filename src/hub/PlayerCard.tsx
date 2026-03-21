import HpBar from '../shared/components/HpBar';
import XpBar from '../shared/components/XpBar';
import type { PlayerStats } from '../../shared/types';

interface PlayerCardProps { stats: PlayerStats | null; }

export default function PlayerCard({ stats }: PlayerCardProps) {
  if (!stats) {
    return <div style={{ padding: '16px', textAlign: 'center', opacity: 0.6 }}>Loading...</div>;
  }

  const hpGlow = stats.hp > 75
    ? '0 0 12px rgba(201, 168, 76, 0.4)'
    : stats.hp > 50
    ? '0 0 8px rgba(45, 90, 39, 0.3)'
    : stats.hp > 25
    ? '0 0 8px rgba(230, 126, 34, 0.3)'
    : '0 0 8px rgba(139, 32, 32, 0.4)';

  return (
    <div style={{ padding: '12px 14px' }}>
      {/* Avatar */}
      <div style={{
        width: 72, height: 72, margin: '0 auto 8px',
        borderRadius: '50%',
        background: 'linear-gradient(135deg, rgba(201,168,76,0.15) 0%, rgba(92,58,30,0.1) 100%)',
        border: '2px solid var(--rpg-gold-dark)',
        boxShadow: `${hpGlow}, inset 0 1px 3px rgba(0,0,0,0.2)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
      }}>
        {/* Outer ring */}
        <div style={{
          position: 'absolute', inset: -4,
          borderRadius: '50%',
          border: '1px solid rgba(201,168,76,0.3)',
        }} />
        <svg width="28" height="28" viewBox="0 0 16 16" fill="none"
          stroke="var(--rpg-gold)" strokeWidth="1.2" strokeLinecap="round">
          <path d="M8 2L5 8l3 2 3-2L8 2z"/>
          <path d="M5 8l-2 4h10l-2-4"/>
          <path d="M8 10v4"/>
        </svg>
      </div>

      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <div style={{ fontFamily: 'Cinzel, serif', fontSize: '0.9rem', color: 'var(--rpg-gold-light)' }}>
          Lv.{stats.level}
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--rpg-parchment)', opacity: 0.8 }}>
          {stats.title}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <HpBar hp={stats.hp} maxHp={stats.maxHp} />
        <XpBar xp={stats.xp} xpToNextLevel={stats.xpToNextLevel} level={stats.level} />
      </div>

      {stats.dailyCombo > 0 && (
        <div style={{
          marginTop: 6, textAlign: 'center', fontSize: '0.75rem',
          color: 'var(--rpg-gold-light)', fontFamily: 'Fira Code, monospace',
        }}>
          Combo x{[1.0, 1.25, 1.5, 1.75, 2.0][Math.min(stats.dailyCombo, 4)]} ({stats.dailyCombo})
        </div>
      )}
    </div>
  );
}

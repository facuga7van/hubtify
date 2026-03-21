import HpBar from '../shared/components/HpBar';
import XpBar from '../shared/components/XpBar';
import Character from './Character';
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
      <div style={{ margin: '0 auto 8px', boxShadow: hpGlow, borderRadius: '50%', width: 72, height: 72 }}>
        <Character size={72} />
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

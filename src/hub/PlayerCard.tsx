import HpBar from '../shared/components/HpBar';
import XpBar from '../shared/components/XpBar';
import type { PlayerStats } from '../../shared/types';

interface PlayerCardProps { stats: PlayerStats | null; }

export default function PlayerCard({ stats }: PlayerCardProps) {
  if (!stats) {
    return <div style={{ padding: '16px', textAlign: 'center', opacity: 0.6 }}>Loading...</div>;
  }

  return (
    <div style={{ padding: '12px 14px' }}>
      <div style={{
        width: 64, height: 64, borderRadius: '50%',
        background: 'rgba(244,228,193,0.2)', border: '2px solid rgba(212,160,23,0.5)',
        margin: '0 auto 8px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.5rem',
      }}>&#x2694;</div>

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
    </div>
  );
}

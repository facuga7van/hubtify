import HpBar from '../shared/components/HpBar';
import XpBar from '../shared/components/XpBar';
import Loading from '../shared/components/Loading';
import Character from './Character';
import type { PlayerStats } from '../../shared/types';

interface PlayerCardProps { stats: PlayerStats | null; collapsed?: boolean; }

export default function PlayerCard({ stats, collapsed }: PlayerCardProps) {
  if (!stats) {
    return <Loading />;
  }

  const hpGlow = stats.hp > 75
    ? '0 0 12px rgba(201, 168, 76, 0.4)'
    : stats.hp > 50
    ? '0 0 8px rgba(45, 90, 39, 0.3)'
    : stats.hp > 25
    ? '0 0 8px rgba(230, 126, 34, 0.3)'
    : '0 0 8px rgba(139, 32, 32, 0.4)';

  const avatarSize = collapsed ? 36 : 72;

  return (
    <div style={{ padding: collapsed ? '8px 6px' : '12px 14px' }}>
      {/* Avatar */}
      <div style={{ position: 'relative', width: avatarSize, height: avatarSize, margin: '0 auto 8px' }}>
        <div style={{ boxShadow: hpGlow, borderRadius: '50%', width: avatarSize, height: avatarSize }}>
          <Character size={avatarSize} />
        </div>
        {stats.streak > 0 && (
          <div style={{
            position: 'absolute', bottom: -2, right: collapsed ? -6 : -8,
            display: 'flex', alignItems: 'center', gap: 1,
            fontSize: '0.6rem', color: '#e67e22', fontFamily: 'Fira Code, monospace',
            lineHeight: 1, whiteSpace: 'nowrap',
          }}>
            <svg width={collapsed ? 9 : 12} height={collapsed ? 9 : 12} viewBox="0 0 14 14" fill="#e67e22" style={{ flexShrink: 0 }}>
              <path d="M7 1c-1 1.5-3.5 3.5-3.5 6a3.5 3.5 0 007 0c0-1-.5-1.8-1.3-2.6.4.8.4 1.7-.4 2.6-.9-.9-.9-2.6-1.8-3.5-.4 1.3-.9 2.2-.9 3a1.3 1.3 0 002.6 0c0-.4-.3-1.3-.9-2.2z"/>
            </svg>
            {!collapsed && <>x{stats.streak}</>}
          </div>
        )}
      </div>

      {/* Level & title — collapsed: just level */}
      <div style={{ textAlign: 'center', marginBottom: collapsed ? 4 : 12 }}>
        <div style={{ fontFamily: 'Cinzel, serif', fontSize: collapsed ? '0.65rem' : '0.9rem', color: 'var(--rpg-gold-light)' }}>
          Lv.{stats.level}
        </div>
        {!collapsed && (
          <div style={{ fontSize: '0.8rem', color: 'var(--rpg-parchment)', opacity: 0.8 }}>
            {stats.title}
          </div>
        )}
      </div>

      {/* Bars — hidden when collapsed */}
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <HpBar hp={stats.hp} maxHp={stats.maxHp} />
          <XpBar xp={stats.xp} xpToNextLevel={stats.xpToNextLevel} level={stats.level} />
        </div>
      )}

      {!collapsed && stats.dailyCombo > 0 && (
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

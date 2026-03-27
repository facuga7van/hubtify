import { useTranslation } from 'react-i18next';
import HpBar from '../shared/components/HpBar';
import XpBar from '../shared/components/XpBar';
import Loading from '../shared/components/Loading';
import Character from './Character';
import type { PlayerStats } from '../../shared/types';

interface PlayerCardProps { stats: PlayerStats | null; collapsed?: boolean; }

export default function PlayerCard({ stats, collapsed }: PlayerCardProps) {
  const { t } = useTranslation();
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

  return (
    <div className={`player-card ${collapsed ? 'player-card--collapsed' : ''}`}>
      {/* Avatar — fixed size canvas, scaled with CSS transform */}
      <div className="player-card__avatar-wrap">
        <div className="player-card__avatar-glow" style={{ boxShadow: hpGlow }}>
          <Character size={72} />
        </div>
        {stats.streak > 0 && (
          <div className="player-card__streak">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="#e67e22" style={{ flexShrink: 0 }}>
              <path d="M7 1c-1 1.5-3.5 3.5-3.5 6a3.5 3.5 0 007 0c0-1-.5-1.8-1.3-2.6.4.8.4 1.7-.4 2.6-.9-.9-.9-2.6-1.8-3.5-.4 1.3-.9 2.2-.9 3a1.3 1.3 0 002.6 0c0-.4-.3-1.3-.9-2.2z"/>
            </svg>
            <span className="player-card__streak-text">x{stats.streak}</span>
          </div>
        )}
      </div>

      {/* Level & title */}
      <div className="player-card__info">
        <div className="player-card__level">{t('common.levelPrefix')}{stats.level}</div>
        <div className="player-card__title">{stats.title}</div>
      </div>

      {/* Bars */}
      <div className="player-card__bars">
        <HpBar hp={stats.hp} maxHp={stats.maxHp} />
        <XpBar xp={stats.xp} xpToNextLevel={stats.xpToNextLevel} level={stats.level} />
      </div>

      {stats.dailyCombo > 0 && (
        <div className="player-card__combo">
          {t('common.combo')}{[1.0, 1.25, 1.5, 1.75, 2.0][Math.min(stats.dailyCombo, 4)]} ({stats.dailyCombo})
        </div>
      )}
    </div>
  );
}

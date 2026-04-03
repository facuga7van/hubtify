import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import HpBar from '../shared/components/HpBar';
import XpBar from '../shared/components/XpBar';
import Loading from '../shared/components/Loading';
import Character from './Character';
import AccountDropdown from './AccountDropdown';
import type { PlayerStats } from '../../shared/types';
import type { AuthUser } from '../shared/hooks/useAuth';
import { useAuthContext } from '../shared/AuthContext';
import { streakAchieved } from '../shared/animations/epic';

interface PlayerCardProps {
  stats: PlayerStats | null;
  collapsed?: boolean;
}

const STREAK_MILESTONES = [3, 7, 14, 30];

export default function PlayerCard({ stats, collapsed }: PlayerCardProps) {
  const { t } = useTranslation();
  const { user: authUser, logout, switching, switchAccount, getCachedAccounts } = useAuthContext();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const streakRef = useRef<HTMLDivElement>(null);
  const prevStreakRef = useRef<number>(0);

  useEffect(() => {
    if (!stats) return;
    const prev = prevStreakRef.current;
    const curr = stats.streak;
    prevStreakRef.current = curr;
    if (prev > 0 && STREAK_MILESTONES.includes(curr) && curr > prev && streakRef.current) {
      streakAchieved(streakRef.current, curr);
    }
  }, [stats?.streak]);

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
    <div className={`player-card ${collapsed ? 'player-card--collapsed' : ''}`} style={{ position: 'relative' }}>
      {/* Avatar — fixed size canvas, scaled with CSS transform */}
      <div className="player-card__avatar-wrap">
        <div className="player-card__avatar-glow" style={{ boxShadow: hpGlow }}>
          <Character size={72} />
        </div>
        {stats.streak > 0 && (
          <div ref={streakRef} className="player-card__streak">
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
        {!collapsed ? (
          <div style={{ position: 'relative' }}>
            <button
              className="player-card__title player-card__title--clickable"
              onClick={() => setDropdownOpen(!dropdownOpen)}
            >
              {stats.title}
              <svg
                width="10" height="10" viewBox="0 0 10 10" fill="none"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                style={{ marginLeft: 4, transition: 'transform 0.2s', transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
              >
                <path d="M3 4l2 2 2-2"/>
              </svg>
            </button>
            {dropdownOpen && authUser && !switching && (
              <AccountDropdown
                activeUser={authUser}
                cachedAccounts={getCachedAccounts()}
                onSwitch={switchAccount}
                onLogout={logout}
                onClose={() => setDropdownOpen(false)}
              />
            )}
          </div>
        ) : (
          <div className="player-card__title">{stats.title}</div>
        )}
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

      {/* Switching overlay */}
      {switching && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 'inherit', zIndex: 99,
        }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--rpg-gold)' }}>{t('common.loading')}</span>
        </div>
      )}

    </div>
  );
}

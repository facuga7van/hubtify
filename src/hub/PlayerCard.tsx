import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Loading from '../shared/components/Loading';
import Character from './Character';
import AccountDropdown from './AccountDropdown';
import type { PlayerStats } from '../../shared/types';
import { useAuthContext } from '../shared/AuthContext';
import { getTitleKey } from '../../shared/rpg-engine';
import NotificationBell from '../shared/components/NotificationBell';

interface PlayerCardProps {
  stats: PlayerStats | null;
  collapsed?: boolean;
  onBellClick?: () => void;
}

export default function PlayerCard({ stats, collapsed, onBellClick }: PlayerCardProps) {
  const { t } = useTranslation();
  const { user: authUser, logout, switching, switchAccount, getCachedAccounts } = useAuthContext();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const nameRef = useRef<HTMLButtonElement>(null);
  const [characterName, setCharacterName] = useState<string>('');
  const [notifInApp, setNotifInApp] = useState(() =>
    localStorage.getItem('hubtify_notifications_inapp') !== 'false'
  );

  // Load character name on mount
  useEffect(() => {
    window.api.characterGetName().then(name => setCharacterName(name || ''));
  }, []);

  // Reload character name when account switches or name changes
  useEffect(() => {
    const handler = () => {
      window.api.characterGetName().then(name => setCharacterName(name || ''));
    };
    window.addEventListener('account:switched', handler);
    window.addEventListener('character:nameChanged', handler);
    return () => {
      window.removeEventListener('account:switched', handler);
      window.removeEventListener('character:nameChanged', handler);
    };
  }, []);

  useEffect(() => {
    const handler = () => setNotifInApp(
      localStorage.getItem('hubtify_notifications_inapp') !== 'false'
    );
    window.addEventListener('notifications:settingsChanged', handler);
    return () => window.removeEventListener('notifications:settingsChanged', handler);
  }, []);

  if (!stats) {
    return <Loading />;
  }

  const translatedTitle = t(getTitleKey(stats.level), stats.title);

  return (
    <div className={`player-card ${collapsed ? 'player-card--collapsed' : ''}`} style={{ position: 'relative' }}>
      {/* Profile block */}
      <div className="player-card__profile">
        {/* Avatar with gold border */}
        <div className="player-card__avatar-wrap">
          <div className="player-card__avatar-ring">
            <Character size={72} />
          </div>
          {/* Level badge */}
          <div className="player-card__level-badge">{stats.level}</div>
        </div>

        {/* Identity text — fades in on expand */}
        <div className="player-card__ident">
          <div className="player-card__eyebrow">
            {t('common.levelPrefix')}{stats.level} · {translatedTitle}
          </div>
          <div className="player-card__name-row">
            {notifInApp && onBellClick && (
              <div className="player-card__bell">
                <NotificationBell onClick={onBellClick} />
              </div>
            )}
            <button
              ref={nameRef}
              className="player-card__name player-card__name--clickable"
              onClick={() => setDropdownOpen(!dropdownOpen)}
            >
              {characterName || authUser?.displayName || authUser?.email?.split('@')[0] || translatedTitle}
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
                anchorRef={nameRef}
              />
            )}
          </div>
        </div>
      </div>


      {/* Switching overlay */}
      {switching && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 'inherit', zIndex: 99,
        }}>
          <span style={{ fontSize: 'var(--fs-label)', color: 'var(--gold)' }}>{t('common.loading')}</span>
        </div>
      )}
    </div>
  );
}

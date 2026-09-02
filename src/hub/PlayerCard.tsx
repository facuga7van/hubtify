import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Loading from '../shared/components/Loading';
import Character from './Character';
import AccountDropdown from './AccountDropdown';
import type { PlayerStats } from '../../shared/types';
import { useAuthContext } from '../shared/AuthContext';
import { getTitleKey } from '../../shared/rpg-engine';
import NotificationBell from '../shared/components/NotificationBell';
import { useConfirm } from '../shared/components/ConfirmDialog';
import { useToast } from '../shared/components/useToast';

interface PlayerCardProps {
  stats: PlayerStats | null;
  collapsed?: boolean;
  onBellClick?: () => void;
}

export default function PlayerCard({ stats, collapsed, onBellClick }: PlayerCardProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const { toast } = useToast();
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

  /**
   * `logout()` refuses to wipe the local database when the pre-logout sync push
   * failed (offline / Firestore down) and answers `{ pushFailed: true }` having
   * changed nothing. Without this handler, signing out offline did absolutely
   * nothing and said nothing.
   */
  const handleLogout = async () => {
    const result = await logout();
    if (result?.pushFailed) {
      const ok = await confirm({
        title: t('auth.logoutPushFailedTitle', 'No pudimos guardar en la nube'),
        message: t('auth.logoutPushFailed', 'No pudimos guardar tus cambios en la nube. ¿Salir igual y perderlos?'),
        confirmText: t('auth.logoutAnyway', 'Salir igual'),
        danger: true,
      });
      if (ok) await logout(true);
    }
  };

  const handleSwitchAccount = async (appName: string) => {
    const result = await switchAccount(appName) as
      { success: boolean; expired?: boolean; pushFailed?: boolean } | undefined;
    if (result?.pushFailed) {
      // Nothing was cleared — the account switch was aborted, not half-done.
      toast({ message: t('auth.switchPushFailed', 'No pudimos guardar tus cambios en la nube. No cambiamos de cuenta para no perderlos.'), type: 'warning' });
    }
    return result;
  };

  if (!stats) {
    return <Loading />;
  }

  const translatedTitle = t(getTitleKey(stats.level), stats.title);

  const displayName = characterName || authUser?.displayName || authUser?.email?.split('@')[0] || translatedTitle;
  /**
   * El renglón de identidad decía «Nv.12 · Guerrero» y lo que se cortaba era
   * SIEMPRE el final: «Nv.6 · Es…». Justo el título — que es el premio de subir
   * de nivel, no un adorno — pagaba el prefijo.
   *
   * El número de nivel ya está acuñado en el medallón del avatar, a dos
   * centímetros de acá: repetirlo en texto costaba ~55 px de los ~126 que tiene
   * la columna en el riel angosto. Sale del renglón; el título se queda con la
   * línea entera y entra completo incluso con «Campesino» —el más largo del
   * catálogo (ver TITLE_THRESHOLDS)— y con el preset de fuente más grande.
   * El nivel en palabras sigue disponible en el `title` de las dos piezas.
   */
  const rankHint = `${t('common.levelPrefix')}${stats.level} · ${translatedTitle}`;

  return (
    <div className={`player-card ${collapsed ? 'player-card--collapsed' : ''}`} style={{ position: 'relative' }}>
      {/* Profile block */}
      <div className="player-card__profile">
        {/* Avatar with gold border */}
        <div className="player-card__avatar-wrap">
          <div className="player-card__avatar-ring">
            <Character size={72} />
          </div>
          {/* El medallón ES el nivel: ahora carga también el rango, porque un
              lector de pantalla leía «12» a secas. */}
          <div className="player-card__level-badge" title={rankHint} aria-label={rankHint}>
            {stats.level}
          </div>
        </div>

        {/* Identity text — fades in on expand */}
        <div className="player-card__ident">
          <div className="player-card__eyebrow" title={rankHint}>
            {translatedTitle}
          </div>
          <div className="player-card__name" title={displayName}>
            {displayName}
          </div>
          {authUser?.email && (
            // Two accounts with the same hero name were indistinguishable
            // without opening the dropdown.
            <div className="player-card__email" title={authUser.email}>
              {authUser.email}
            </div>
          )}
        </div>

        {/* Bell + account menu live OUTSIDE __ident on purpose: __ident collapses
            to width:0 and they used to disappear with it, so collapsing the
            sidebar silently removed notifications and account switching. */}
        <div className="player-card__actions">
          {notifInApp && onBellClick && (
            <div className="player-card__bell">
              <NotificationBell onClick={onBellClick} />
            </div>
          )}
          <button
            ref={nameRef}
            className="player-card__account-btn tap-target"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            aria-expanded={dropdownOpen}
            aria-haspopup="true"
            aria-label={t('account.menu', 'Menú de cuenta')}
            title={authUser?.email || displayName}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="8" cy="5.5" r="2.75" />
              <path d="M2.75 13.5c0-2.35 2.35-3.85 5.25-3.85s5.25 1.5 5.25 3.85" />
            </svg>
            <svg
              className="player-card__account-caret"
              width="9" height="9" viewBox="0 0 10 10" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
              aria-hidden="true"
              style={{ transition: 'transform 0.2s', transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
            >
              <path d="M3 4l2 2 2-2"/>
            </svg>
          </button>
          {dropdownOpen && authUser && !switching && (
            <AccountDropdown
              activeUser={authUser}
              cachedAccounts={getCachedAccounts()}
              onSwitch={handleSwitchAccount}
              onLogout={handleLogout}
              onClose={() => setDropdownOpen(false)}
              anchorRef={nameRef}
            />
          )}
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

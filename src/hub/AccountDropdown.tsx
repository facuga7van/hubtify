import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { CachedAccount } from '../shared/accountStore';
import type { AuthUser } from '../shared/hooks/useAuth';
import { useAnchoredPopup } from '../shared/hooks/useAnchoredPopup';

interface Props {
  activeUser: AuthUser;
  cachedAccounts: CachedAccount[];
  onSwitch: (appName: string) => Promise<{ success: boolean; expired?: boolean } | undefined>;
  onLogout: () => void;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
}

export default function AccountDropdown({ activeUser, cachedAccounts, onSwitch, onLogout, onClose, anchorRef }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [expiredEmail, setExpiredEmail] = useState<string | null>(null);

  /* Posicionado con el mismo hook que los demás popovers anclados: lo anota
     como popover abierto para el botón atrás de Android y lo sujeta al
     viewport. */
  const { popupRef, pos } = useAnchoredPopup<HTMLElement, HTMLDivElement>(true, 4, { onClose, anchorRef });

  // Return focus to trigger on close
  useEffect(() => {
    return () => { anchorRef?.current?.focus(); };
  }, [anchorRef]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, popupRef]);

  /* Del menú sólo se salía con el mouse: Escape no hacía nada, así que con el
     teclado quedabas adentro (y el foco vuelve al disparador en el cleanup). */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const otherAccounts = cachedAccounts.filter(a => a.uid !== activeUser.uid);

  const handleSwitch = async (account: CachedAccount) => {
    const result = await onSwitch(account.firebaseAppName);
    if (result?.expired) {
      setExpiredEmail(account.email);
      setTimeout(() => setExpiredEmail(null), 4000);
    } else {
      onClose();
    }
  };

  return createPortal(
    <div
      ref={popupRef}
      className="account-dropdown"
      role="menu"
      style={{ top: pos.top, left: pos.left }}
    >
      {/* Expired session toast */}
      {expiredEmail && (
        <div className="account-dropdown__item" style={{ color: '#e74c3c', fontSize: 'var(--fs-label)' }}>
          {t('auth.sessionExpired', { email: expiredEmail })}
        </div>
      )}

      {/* Active account */}
      <div className="account-dropdown__item account-dropdown__item--active">
        <div className="account-dropdown__dot" />
        <div className="account-dropdown__info">
          {activeUser.displayName && (
            <span className="account-dropdown__username">{activeUser.displayName}</span>
          )}
          <span className="account-dropdown__email" title={activeUser.email ?? undefined}>{activeUser.email}</span>
        </div>
      </div>

      {/* Cached accounts */}
      {otherAccounts.map((account) => (
        <button
          key={account.uid}
          className="account-dropdown__item account-dropdown__item--switch"
          role="menuitem"
          onClick={() => handleSwitch(account)}
        >
          <div className="account-dropdown__avatar">
            {(account.username || account.email || '?').charAt(0).toUpperCase()}
          </div>
          <div className="account-dropdown__info">
            {account.username && (
              <span className="account-dropdown__username">
                {account.username}
              </span>
            )}
            <span className="account-dropdown__email" title={account.email}>{account.email}</span>
          </div>
        </button>
      ))}

      {/* Add account */}
      <button
        className="account-dropdown__item account-dropdown__item--add"
        role="menuitem"
        onClick={() => { navigate('/login/add'); onClose(); }}
      >
        <span className="account-dropdown__plus">+</span>
        <span>{t('account.addAccount')}</span>
      </button>

      {/* Sign out */}
      <button
        className="account-dropdown__item account-dropdown__item--logout"
        role="menuitem"
        onClick={() => { onLogout(); onClose(); }}
      >
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M5 1H2v10h3M8 3l3 3-3 3M4 6h7"/>
        </svg>
        <span>{t('account.signOut')}</span>
      </button>
    </div>,
    document.body,
  );
}

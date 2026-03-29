import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { CachedAccount } from '../shared/accountStore';
import type { AuthUser } from '../shared/hooks/useAuth';

interface Props {
  activeUser: AuthUser;
  cachedAccounts: CachedAccount[];
  onSwitch: (appName: string) => Promise<{ success: boolean; expired?: boolean } | undefined>;
  onLogout: () => void;
  onClose: () => void;
}

export default function AccountDropdown({ activeUser, cachedAccounts, onSwitch, onLogout, onClose }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [expiredEmail, setExpiredEmail] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
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

  return (
    <div ref={ref} className="account-dropdown">
      {/* Expired session toast */}
      {expiredEmail && (
        <div className="account-dropdown__item" style={{ color: '#e74c3c', fontSize: '0.65rem' }}>
          {t('auth.sessionExpired', { email: expiredEmail })}
        </div>
      )}

      {/* Active account */}
      <div className="account-dropdown__item account-dropdown__item--active">
        <div className="account-dropdown__dot" />
        <span className="account-dropdown__email">{activeUser.email}</span>
      </div>

      {/* Cached accounts */}
      {otherAccounts.map((account) => (
        <button
          key={account.uid}
          className="account-dropdown__item account-dropdown__item--switch"
          onClick={() => handleSwitch(account)}
        >
          <div className="account-dropdown__avatar">
            {account.email.charAt(0).toUpperCase()}
          </div>
          <span className="account-dropdown__email">{account.email}</span>
        </button>
      ))}

      {/* Add account */}
      <button
        className="account-dropdown__item account-dropdown__item--add"
        onClick={() => { navigate('/login/add'); onClose(); }}
      >
        <span className="account-dropdown__plus">+</span>
        <span>{t('account.addAccount')}</span>
      </button>

      {/* Sign out */}
      <button
        className="account-dropdown__item account-dropdown__item--logout"
        onClick={() => { onLogout(); onClose(); }}
      >
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M5 1H2v10h3M8 3l3 3-3 3M4 6h7"/>
        </svg>
        <span>{t('account.signOut')}</span>
      </button>
    </div>
  );
}

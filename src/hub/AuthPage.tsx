import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthContext } from '../shared/AuthContext';

interface Props {
  onAuth: () => void;
  mode?: 'default' | 'addAccount';
  onBack?: () => void;
}

export default function AuthPage({ onAuth, mode = 'default', onBack }: Props) {
  const { t } = useTranslation();
  const { login, register, addAccount } = useAuthContext();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setError('');
    setLoading(true);

    try {
      if (mode === 'addAccount') {
        const result = await addAccount(email, password);
        if (result.success) {
          onAuth();
        } else {
          setError(t(result.error ?? 'auth.errors.generic'));
        }
      } else {
        const result = isLogin
          ? await login(email, password)
          : await register(email, password);
        if (result.success) {
          onAuth();
        } else {
          setError(t(result.error ?? 'auth.errors.generic'));
        }
      }
    } catch {
      setError(t('auth.errors.networkError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: 'var(--rpg-parchment)',
      backgroundImage: `url(${new URL('../assets/bg.jpg', import.meta.url).href})`,
      backgroundSize: '600px', backgroundRepeat: 'repeat',
    }}>
      <div className="rpg-card" style={{ width: 360, padding: 32 }}>
        <h2 style={{ textAlign: 'center', marginBottom: 4, fontSize: '1.6rem' }}>{t('app.title')}</h2>
        <p style={{ textAlign: 'center', opacity: 0.6, marginBottom: 24, fontSize: '0.9rem' }}>
          {mode === 'addAccount'
            ? t('auth.addAccountDesc')
            : isLogin ? t('auth.welcomeBack') : t('auth.beginAdventure')}
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            type="email"
            placeholder={t('auth.email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rpg-input"
            style={{ width: '100%' }}
            autoFocus
          />
          <input
            type="password"
            placeholder={t('auth.password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rpg-input"
            style={{ width: '100%' }}
          />

          {error && (
            <p style={{ color: 'var(--rpg-hp-red)', fontSize: '0.85rem', margin: 0 }}>{error}</p>
          )}

          <button className="rpg-button" type="submit" disabled={loading}
            style={{ width: '100%', padding: '10px', fontSize: '0.9rem', marginTop: 4 }}>
            {loading
              ? t('common.loading')
              : mode === 'addAccount'
                ? t('auth.addAccount')
                : isLogin ? t('auth.enterRealm') : t('auth.createAccount')}
          </button>
        </form>

        {mode !== 'addAccount' && (
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <button
              onClick={() => { setIsLogin(!isLogin); setError(''); }}
              style={{
                background: 'none', border: 'none', color: 'var(--rpg-gold-dark)',
                cursor: 'pointer', fontSize: '0.85rem', textDecoration: 'underline',
              }}
            >
              {isLogin ? t('auth.noAccount') : t('auth.hasAccount')}
            </button>
          </div>
        )}

        {mode === 'addAccount' && onBack && (
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <button
              onClick={onBack}
              style={{
                background: 'none', border: 'none', color: 'var(--rpg-ink-light)',
                cursor: 'pointer', fontSize: '0.85rem',
              }}
            >
              {t('common.back')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  onAuth: () => void;
}

export default function AuthPage({ onAuth }: Props) {
  const { t } = useTranslation();
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
      const result = isLogin
        ? await window.api.authLogin(email, password)
        : await window.api.authRegister(email, password);

      if (result.success) {
        onAuth();
      } else {
        setError(result.error ?? 'Something went wrong');
      }
    } catch (err) {
      setError('Connection error');
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
          {isLogin ? t('auth.welcomeBack') : t('auth.beginAdventure')}
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
            {loading ? t('common.loading') : isLogin ? t('auth.enterRealm') : t('auth.createAccount')}
          </button>
        </form>

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

        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button
            onClick={onAuth}
            style={{
              background: 'none', border: 'none', color: 'var(--rpg-ink-light)',
              cursor: 'pointer', fontSize: '0.8rem', opacity: 0.5,
            }}
          >
            {t('auth.continueOffline')}
          </button>
        </div>
      </div>
    </div>
  );
}

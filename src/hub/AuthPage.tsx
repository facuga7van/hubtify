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
  const { login, register, addAccount, forgotPassword } = useAuthContext();
  const [isLogin, setIsLogin] = useState(true);
  const [isForgot, setIsForgot] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isForgot) {
      if (!email.trim()) return;
      setError('');
      setLoading(true);
      try {
        const result = await forgotPassword(email);
        if (result.success) {
          setResetSent(true);
        } else {
          setError(t(result.error ?? 'auth.errors.generic'));
        }
      } catch {
        setError(t('auth.errors.networkError'));
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!email.trim() || !password.trim()) return;
    if (!isLogin && mode !== 'addAccount' && !username.trim()) return;
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
          : await register(email, password, username.trim() || undefined);
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

  const enterForgotMode = () => {
    setIsForgot(true);
    setResetSent(false);
    setError('');
    setPassword('');
    setUsername('');
  };

  const exitForgotMode = () => {
    setIsForgot(false);
    setResetSent(false);
    setError('');
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        {/* Decorative top ornament */}
        <div className="auth-card__ornament" />

        <h1 className="auth-card__title">{t('app.title')}</h1>
        <p className="auth-card__subtitle">
          {isForgot
            ? t('auth.forgotPasswordTitle', 'Recuperá tu cuenta')
            : mode === 'addAccount'
              ? t('auth.addAccountDesc')
              : isLogin ? t('auth.welcomeBack') : t('auth.beginAdventure')}
        </p>

        {isForgot && resetSent ? (
          <div className="auth-card__form">
            <p className="auth-card__success">{t('auth.resetEmailSent', 'Te enviamos un enlace para restablecer tu contraseña. Revisá tu correo.')}</p>
            <button onClick={exitForgotMode} className="auth-card__toggle">
              {t('auth.backToLogin', 'Volver al inicio de sesión')}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="auth-card__form">
            {!isLogin && !isForgot && mode !== 'addAccount' && (
              <input
                type="text"
                placeholder={t('auth.username', 'Nombre de usuario')}
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                className="rpg-input auth-card__input"
                maxLength={20}
                autoFocus
              />
            )}
            <input
              type={isForgot ? 'email' : isLogin || mode === 'addAccount' ? 'text' : 'email'}
              placeholder={isForgot
                ? t('auth.enterEmail', 'Ingresá tu correo electrónico')
                : isLogin || mode === 'addAccount'
                  ? t('auth.emailOrUsername', 'Email o nombre de usuario')
                  : t('auth.email')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rpg-input auth-card__input"
              autoFocus={isForgot || isLogin || mode === 'addAccount'}
            />
            {!isForgot && (
              <input
                type="password"
                placeholder={t('auth.password')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rpg-input auth-card__input"
              />
            )}

            {error && (
              <p className="auth-card__error">{error}</p>
            )}

            <button className="rpg-button auth-card__submit" type="submit" disabled={loading}>
              {loading
                ? t('common.loading')
                : isForgot
                  ? t('auth.sendResetLink', 'Enviar enlace')
                  : mode === 'addAccount'
                    ? t('auth.addAccount')
                    : isLogin ? t('auth.enterRealm') : t('auth.createAccount')}
            </button>
          </form>
        )}

        {isForgot && !resetSent && (
          <div className="auth-card__toggle-wrap">
            <button onClick={exitForgotMode} className="auth-card__toggle">
              {t('auth.backToLogin', 'Volver al inicio de sesión')}
            </button>
          </div>
        )}

        {!isForgot && mode !== 'addAccount' && (
          <div className="auth-card__toggle-wrap">
            <button
              onClick={() => { setIsLogin(!isLogin); setError(''); setUsername(''); }}
              className="auth-card__toggle"
            >
              {isLogin ? t('auth.noAccount') : t('auth.hasAccount')}
            </button>
            {isLogin && (
              <button onClick={enterForgotMode} className="auth-card__toggle">
                {t('auth.forgotPassword', '¿Olvidaste tu contraseña?')}
              </button>
            )}
          </div>
        )}

        {mode === 'addAccount' && onBack && (
          <div className="auth-card__toggle-wrap">
            <button onClick={onBack} className="auth-card__back">
              {t('common.back')}
            </button>
          </div>
        )}

        {/* Decorative bottom ornament */}
        <div className="auth-card__ornament" />
      </div>
    </div>
  );
}

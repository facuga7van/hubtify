import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import TitleBar from '../shared/components/TitleBar';
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
  const [passwordTooShort, setPasswordTooShort] = useState(false);

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
    if (!isLogin && mode !== 'addAccount' && !username.trim()) {
      // Used to be a silent `return` — the user pressed the button and nothing
      // happened, with the error string already sitting unused in the catalog.
      setError(t('auth.errors.usernameRequired'));
      return;
    }
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

  /** Registration is the only flow with password rules of its own. */
  const isRegistering = !isLogin && !isForgot && mode !== 'addAccount';

  const exitForgotMode = () => {
    setIsForgot(false);
    setResetSent(false);
    setError('');
  };

  return (
    // The window is frameless (`frame:false`), and this page renders OUTSIDE
    // <Layout/>, which is where the custom title bar lives — so without this the
    // login screen had no minimize/maximize/close and no drag region at all.
    <div className="auth-shell">
      <TitleBar />
      <div className="auth-page">
      <div className="auth-card">
        {/* Decorative top ornament */}
        <div className="auth-card__ornament" />

        <h1 id="auth-card-title" className="auth-card__title">{t('app.title')}</h1>
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
          <form onSubmit={handleSubmit} className="auth-card__form" role="form" aria-labelledby="auth-card-title">
            {!isLogin && !isForgot && mode !== 'addAccount' && (
              <input
                type="text"
                placeholder={t('auth.username', 'Nombre de usuario')}
                aria-label={t('auth.username', 'Nombre de usuario')}
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
              aria-label={isForgot
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
              <>
                <input
                  type="password"
                  placeholder={t('auth.password')}
                  aria-label={t('auth.password')}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setPasswordTooShort(false); }}
                  /* Only registration has a 6-char rule. Scolding someone who is
                     signing in to an existing account is just wrong. */
                  onBlur={() => { if (isRegistering && password.length > 0 && password.length < 6) setPasswordTooShort(true); }}
                  className="rpg-input auth-card__input"
                  minLength={isRegistering ? 6 : undefined}
                />
                {passwordTooShort && (
                  <p className="auth-card__error">{t('auth.passwordTooShort', 'La contraseña debe tener al menos 6 caracteres')}</p>
                )}
              </>
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
    </div>
  );
}

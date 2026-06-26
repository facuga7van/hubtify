import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthContext } from '../shared/AuthContext';
import { Eye, EyeOff } from '../shared/components/icons';

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
  const [showPassword, setShowPassword] = useState(false);
  const [usernameSanitized, setUsernameSanitized] = useState(false);

  // Identifies the current view so React remounts the form on mode change,
  // re-triggering the entry animation and a fresh autoFocus.
  const formKey = isForgot ? 'forgot' : isLogin ? 'login' : 'register';
  const isSignup = !isLogin && mode !== 'addAccount';

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
    if (isSignup && !username.trim()) return;
    if (isSignup && password.length < 6) { setPasswordTooShort(true); return; }
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

  const handleUsernameChange = (raw: string) => {
    const clean = raw.replace(/[^a-zA-Z0-9_]/g, '');
    setUsername(clean);
    setUsernameSanitized(clean !== raw);
  };

  const toggleAuthMode = () => {
    setIsLogin(!isLogin);
    setError('');
    setUsername('');
    setPassword('');
    setPasswordTooShort(false);
    setShowPassword(false);
    setUsernameSanitized(false);
  };

  const enterForgotMode = () => {
    setIsForgot(true);
    setResetSent(false);
    setError('');
    setPassword('');
    setUsername('');
    setShowPassword(false);
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

        <h1 id="auth-card-title" className="auth-card__title">{t('app.title')}</h1>
        <p className="auth-card__subtitle">
          {isForgot
            ? t('auth.forgotPasswordTitle', 'Recuperá tu cuenta')
            : mode === 'addAccount'
              ? t('auth.addAccountDesc')
              : isLogin ? t('auth.welcomeBack') : t('auth.beginAdventure')}
        </p>

        {isForgot && resetSent ? (
          <div className="auth-card__form auth-card__form--enter">
            <p className="auth-card__success" role="status">{t('auth.resetEmailSent', 'Te enviamos un enlace para restablecer tu contraseña. Revisá tu correo.')}</p>
            <button onClick={exitForgotMode} className="auth-card__toggle">
              {t('auth.backToLogin', 'Volver al inicio de sesión')}
            </button>
          </div>
        ) : (
          <form key={formKey} onSubmit={handleSubmit} className="auth-card__form auth-card__form--enter" role="form" aria-labelledby="auth-card-title" noValidate>
            {isSignup && !isForgot && (
              <div className="auth-card__field">
                <input
                  type="text"
                  name="username"
                  autoComplete="username"
                  placeholder={t('auth.username', 'Nombre de usuario')}
                  aria-label={t('auth.username', 'Nombre de usuario')}
                  value={username}
                  onChange={(e) => handleUsernameChange(e.target.value)}
                  className="rpg-input auth-card__input"
                  maxLength={20}
                  autoFocus
                />
                {usernameSanitized && (
                  <p className="auth-card__hint" role="status">
                    {t('auth.usernameHint', 'Solo letras, números y guion bajo (_)')}
                  </p>
                )}
              </div>
            )}
            <div className="auth-card__field">
              <input
                type={isForgot ? 'email' : isLogin || mode === 'addAccount' ? 'text' : 'email'}
                name="email"
                autoComplete={isSignup ? 'email' : isForgot ? 'email' : 'username'}
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
            </div>
            {!isForgot && (
              <div className="auth-card__field">
                <div className="auth-card__password-wrap">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    autoComplete={isSignup ? 'new-password' : 'current-password'}
                    placeholder={t('auth.password')}
                    aria-label={t('auth.password')}
                    aria-invalid={passwordTooShort}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setPasswordTooShort(false); }}
                    onBlur={() => { if (password.length > 0 && password.length < 6) setPasswordTooShort(true); }}
                    className="rpg-input auth-card__input auth-card__input--password"
                  />
                  <button
                    type="button"
                    className="auth-card__password-toggle"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword
                      ? t('auth.hidePassword', 'Ocultar contraseña')
                      : t('auth.showPassword', 'Mostrar contraseña')}
                    title={showPassword
                      ? t('auth.hidePassword', 'Ocultar contraseña')
                      : t('auth.showPassword', 'Mostrar contraseña')}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff width={18} height={18} /> : <Eye width={18} height={18} />}
                  </button>
                </div>
                {passwordTooShort && (
                  <p className="auth-card__error" role="alert">{t('auth.passwordTooShort', 'La contraseña debe tener al menos 6 caracteres')}</p>
                )}
              </div>
            )}

            {error && (
              <p className="auth-card__error auth-card__error--submit" role="alert">{error}</p>
            )}

            <button className="rpg-button auth-card__submit" type="submit" disabled={loading}>
              {loading ? (
                <span className="auth-card__loading">
                  <span className="auth-card__spinner" aria-hidden="true" />
                  {t('common.loading')}
                </span>
              ) : isForgot
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
              onClick={toggleAuthMode}
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

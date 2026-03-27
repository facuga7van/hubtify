import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Character from './Character';
import TitleBar from '../shared/components/TitleBar';
import { useAuthContext } from '../shared/AuthContext';

interface Props {
  onComplete: () => void;
}

export default function Onboarding({ onComplete }: Props) {
  const { t, i18n } = useTranslation();
  const { login, register } = useAuthContext();
  const [step, setStep] = useState(0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [animDir, setAnimDir] = useState<'forward' | 'back'>('forward');

  const finishOnboarding = () => {
    localStorage.setItem('hubtify_onboarded', 'true');
    onComplete();
  };

  const goStep = (target: number) => {
    setAnimDir(target > step ? 'forward' : 'back');
    setStep(target);
  };

  const setLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('hubtify_lang', lang);
  };

  const handleAuth = async () => {
    if (!email.trim() || !password.trim()) return;
    if (password.length < 6) {
      setAuthError(t('onboarding.passwordMin'));
      return;
    }
    setAuthError('');
    setAuthLoading(true);
    try {
      const result = isLogin
        ? await login(email, password)
        : await register(email, password);
      if (result.success) {
        finishOnboarding();
      } else {
        setAuthError(result.error ?? 'Error');
      }
    } catch {
      setAuthError(t('onboarding.connectionError'));
    } finally {
      setAuthLoading(false);
    }
  };

  const animClass = animDir === 'forward' ? 'onboarding-step-forward' : 'onboarding-step-back';

  const stepContent = () => {
    switch (step) {
      case 0:
        return (
          <div key="welcome" className={animClass} style={{ textAlign: 'center' }}>
            <svg width="48" height="48" viewBox="0 0 18 18" fill="none" stroke="var(--rpg-gold)" strokeWidth="1.2" strokeLinecap="round" style={{ marginBottom: 16 }}>
              <path d="M9 2L3 5v4c0 4 3 6 6 7 3-1 6-3 6-7V5L9 2z"/>
              <path d="M7 9l2 2 3-4"/>
            </svg>
            <h2 style={{ fontSize: '1.8rem', marginBottom: 8 }}>Hubtify</h2>
            <p style={{ fontSize: '1rem', opacity: 0.7, marginBottom: 24 }}>
              {t('onboarding.tagline')}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 24 }}>
              <button className="rpg-button"
                onClick={() => setLanguage('es')}
                style={{ opacity: i18n.language === 'es' ? 1 : 0.5 }}>
                {t('settings.languageEs')}
              </button>
              <button className="rpg-button"
                onClick={() => setLanguage('en')}
                style={{ opacity: i18n.language === 'en' ? 1 : 0.5 }}>
                {t('settings.languageEn')}
              </button>
            </div>
            <button className="rpg-button" onClick={() => goStep(1)}
              style={{ padding: '10px 32px', fontSize: '1rem' }}>
              {t('onboarding.startAdventure')}
            </button>
          </div>
        );

      case 1:
        return (
          <div key="character" className={animClass} style={{ textAlign: 'center' }}>
            <h2 style={{ marginBottom: 16 }}>{t('onboarding.createCharacter')}</h2>
            <Character size={128} canCustomize />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 24 }}>
              <button className="rpg-button" onClick={() => goStep(0)}
                style={{ padding: '8px 20px', opacity: 0.7 }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M7 1L3 5l4 4"/></svg>
              </button>
              <button className="rpg-button" onClick={() => goStep(2)}
                style={{ padding: '10px 32px', fontSize: '1rem' }}>
                {t('onboarding.continue')}
              </button>
            </div>
          </div>
        );

      case 2:
        return (
          <div key="modules" className={animClass} style={{ textAlign: 'center' }}>
            <h2 style={{ marginBottom: 16 }}>{t('onboarding.yourModules')}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24, textAlign: 'left' }}>
              {[
                { name: 'Questify', desc: t('onboarding.questifyDesc'), icon: <path d="M14 2l-8 8M6 10l-2 2 2 2 2-2M10.5 5.5l2 2M14 2l2 2-3 3"/> },
                { name: 'Nutrify', desc: t('onboarding.nutriftyDesc'), icon: <><path d="M6 3h6v4c0 2-1.5 3-3 3s-3-1-3-3V3z"/><path d="M9 10v3M6 13h6"/></> },
                { name: 'Coinify', desc: t('onboarding.coinifyDesc'), icon: <><ellipse cx="7" cy="10" rx="5" ry="3"/><path d="M2 10v2c0 1.7 2.2 3 5 3s5-1.3 5-3v-2"/></> },
              ].map((mod) => (
                <div key={mod.name} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 14px', borderRadius: 'var(--rpg-radius)',
                  border: '1px solid var(--rpg-gold-dark)', background: 'rgba(201,168,76,0.06)',
                }}>
                  <svg width="22" height="22" viewBox="0 0 18 18" fill="none" stroke="var(--rpg-gold)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    {mod.icon}
                  </svg>
                  <div>
                    <div style={{ fontFamily: 'Cinzel, serif', fontSize: '0.9rem', fontWeight: 700, color: 'var(--rpg-wood)' }}>{mod.name}</div>
                    <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>{mod.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button className="rpg-button" onClick={() => goStep(1)}
                style={{ padding: '8px 20px', opacity: 0.7 }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M7 1L3 5l4 4"/></svg>
              </button>
              <button className="rpg-button" onClick={() => goStep(3)}
                style={{ padding: '10px 32px', fontSize: '1rem' }}>
                {t('onboarding.continue')}
              </button>
            </div>
          </div>
        );

      case 3:
        return (
          <div key="auth" className={animClass} style={{ textAlign: 'center' }}>
            <h2 style={{ marginBottom: 8 }}>
              {isLogin ? t('onboarding.loginTitle') : t('onboarding.registerTitle')}
            </h2>
            <p style={{ fontSize: '0.85rem', opacity: 0.6, marginBottom: 20 }}>
              {t('onboarding.syncDesc')}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 280, margin: '0 auto' }}>
              <input type="email" placeholder={t('auth.email')} value={email}
                onChange={(e) => setEmail(e.target.value)} className="rpg-input" style={{ width: '100%' }} />
              <input type="password" placeholder={t('auth.password')} value={password}
                onChange={(e) => setPassword(e.target.value)} className="rpg-input" style={{ width: '100%' }}
                onKeyDown={(e) => e.key === 'Enter' && handleAuth()} />

              {authError && (
                <p style={{ color: 'var(--rpg-hp-red)', fontSize: '0.85rem', margin: 0 }}>{authError}</p>
              )}

              <button className="rpg-button" onClick={handleAuth} disabled={authLoading}
                style={{ width: '100%', padding: '10px', fontSize: '0.95rem' }}>
                {authLoading ? t('common.loading') : isLogin ? t('onboarding.login') : t('onboarding.register')}
              </button>

              <button onClick={() => { setIsLogin(!isLogin); setAuthError(''); }}
                style={{ background: 'none', border: 'none', color: 'var(--rpg-gold-dark)', cursor: 'pointer', fontSize: '0.8rem' }}>
                {isLogin ? t('onboarding.noAccount') : t('onboarding.hasAccount')}
              </button>
            </div>

            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--rpg-parchment-dark)' }}>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
                <button className="rpg-button" onClick={() => goStep(2)}
                  style={{ padding: '8px 20px', opacity: 0.7 }}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M7 1L3 5l4 4"/></svg>
                </button>
                <button onClick={finishOnboarding}
                  style={{ background: 'none', border: 'none', color: 'var(--rpg-ink-light)', cursor: 'pointer', fontSize: '0.85rem' }}>
                  {t('onboarding.continueOffline')} →
                </button>
              </div>
              <p style={{ fontSize: '0.75rem', opacity: 0.4, marginTop: 6 }}>
                {t('onboarding.offlineWarning')}
              </p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <TitleBar />
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--rpg-parchment)',
        backgroundImage: `url(${new URL('../assets/bg.jpg', import.meta.url).href})`,
        backgroundSize: '600px', backgroundRepeat: 'repeat',
      }}>
        <div className="rpg-card" style={{ maxWidth: 500, padding: 32, width: '90%', overflow: 'hidden' }}>
          {stepContent()}

          {/* Step indicators */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{
                width: 8, height: 8, borderRadius: '50%',
                background: i === step ? 'var(--rpg-gold)' : i < step ? 'var(--rpg-gold-dark)' : 'var(--rpg-parchment-dark)',
                border: '1px solid var(--rpg-gold-dark)',
                transition: 'background 0.3s',
              }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Character from './Character';

interface Props {
  onComplete: () => void;
}

export default function Onboarding({ onComplete }: Props) {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState(0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const finishOnboarding = () => {
    localStorage.setItem('hubtify_onboarded', 'true');
    onComplete();
  };

  const handleAuth = async () => {
    if (!email.trim() || !password.trim()) return;
    setAuthError('');
    setAuthLoading(true);
    try {
      const result = isLogin
        ? await window.api.authLogin(email, password)
        : await window.api.authRegister(email, password);
      if (result.success) {
        finishOnboarding();
      } else {
        setAuthError(result.error ?? 'Error');
      }
    } catch {
      setAuthError('Connection error');
    } finally {
      setAuthLoading(false);
    }
  };

  const steps = [
    // Step 0: Welcome
    <div key="welcome" style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '3rem', marginBottom: 16 }}>&#x2694;</div>
      <h2 style={{ fontSize: '1.8rem', marginBottom: 8 }}>Hubtify</h2>
      <p style={{ fontSize: '1rem', opacity: 0.7, marginBottom: 24 }}>
        Tu hub gamificado de productividad, nutricion y finanzas
      </p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 24 }}>
        <button className={`rpg-button`}
          onClick={() => i18n.changeLanguage('es')}
          style={{ opacity: i18n.language === 'es' ? 1 : 0.5 }}>
          Espanol
        </button>
        <button className={`rpg-button`}
          onClick={() => i18n.changeLanguage('en')}
          style={{ opacity: i18n.language === 'en' ? 1 : 0.5 }}>
          English
        </button>
      </div>
      <button className="rpg-button" onClick={() => setStep(1)}
        style={{ padding: '10px 32px', fontSize: '1rem' }}>
        Comenzar Aventura
      </button>
    </div>,

    // Step 1: Create your character
    <div key="character" style={{ textAlign: 'center' }}>
      <h2 style={{ marginBottom: 16 }}>Crea tu Personaje</h2>
      <Character size={128} canCustomize />
      <div style={{ marginTop: 24 }}>
        <button className="rpg-button" onClick={() => setStep(2)}
          style={{ padding: '10px 32px', fontSize: '1rem' }}>
          Continuar
        </button>
      </div>
    </div>,

    // Step 2: Modules overview
    <div key="modules" style={{ textAlign: 'center' }}>
      <h2 style={{ marginBottom: 16 }}>Tus Modulos</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24, textAlign: 'center' }}>
        <div className="rpg-card">
          <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>
            <svg width="24" height="24" viewBox="0 0 18 18" fill="none" stroke="var(--rpg-gold)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2l-8 8M6 10l-2 2 2 2 2-2M10.5 5.5l2 2M14 2l2 2-3 3"/>
            </svg>
          </div>
          <h4 style={{ fontSize: '0.9rem' }}>Questify</h4>
          <p style={{ fontSize: '0.8rem', opacity: 0.6 }}>Tareas y productividad</p>
        </div>
        <div className="rpg-card">
          <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>
            <svg width="24" height="24" viewBox="0 0 18 18" fill="none" stroke="var(--rpg-gold)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3h6v4c0 2-1.5 3-3 3s-3-1-3-3V3z"/><path d="M9 10v3M6 13h6"/>
            </svg>
          </div>
          <h4 style={{ fontSize: '0.9rem' }}>Nutrify</h4>
          <p style={{ fontSize: '0.8rem', opacity: 0.6 }}>Nutricion y calorias</p>
        </div>
        <div className="rpg-card">
          <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>
            <svg width="24" height="24" viewBox="0 0 18 18" fill="none" stroke="var(--rpg-gold)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="7" cy="10" rx="5" ry="3"/><path d="M2 10v2c0 1.7 2.2 3 5 3s5-1.3 5-3v-2"/>
            </svg>
          </div>
          <h4 style={{ fontSize: '0.9rem' }}>Coinify</h4>
          <p style={{ fontSize: '0.8rem', opacity: 0.6 }}>Finanzas personales</p>
        </div>
      </div>
      <button className="rpg-button" onClick={() => setStep(3)}
        style={{ padding: '10px 32px', fontSize: '1rem' }}>
        Continuar
      </button>
    </div>,

    // Step 3: Account
    <div key="auth" style={{ textAlign: 'center' }}>
      <h2 style={{ marginBottom: 8 }}>
        {isLogin ? 'Iniciar Sesion' : 'Crear Cuenta'}
      </h2>
      <p style={{ fontSize: '0.85rem', opacity: 0.6, marginBottom: 20 }}>
        Sincroniza tu progreso entre dispositivos
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 280, margin: '0 auto' }}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rpg-input"
          style={{ width: '100%' }}
        />
        <input
          type="password"
          placeholder="Contrasena"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rpg-input"
          style={{ width: '100%' }}
          onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
        />

        {authError && (
          <p style={{ color: 'var(--rpg-hp-red)', fontSize: '0.85rem', margin: 0 }}>{authError}</p>
        )}

        <button className="rpg-button" onClick={handleAuth} disabled={authLoading}
          style={{ width: '100%', padding: '10px', fontSize: '0.95rem' }}>
          {authLoading ? 'Cargando...' : isLogin ? 'Entrar' : 'Crear Cuenta'}
        </button>

        <button onClick={() => { setIsLogin(!isLogin); setAuthError(''); }}
          style={{ background: 'none', border: 'none', color: 'var(--rpg-gold-dark)', cursor: 'pointer', fontSize: '0.8rem' }}>
          {isLogin ? 'No tenes cuenta? Registrate' : 'Ya tenes cuenta? Inicia sesion'}
        </button>
      </div>

      <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--rpg-parchment-dark)' }}>
        <button onClick={finishOnboarding}
          style={{ background: 'none', border: 'none', color: 'var(--rpg-ink-light)', cursor: 'pointer', fontSize: '0.85rem' }}>
          Continuar sin cuenta →
        </button>
        <p style={{ fontSize: '0.75rem', opacity: 0.4, marginTop: 6 }}>
          Tus datos se guardaran solo en este dispositivo
        </p>
      </div>
    </div>,
  ];

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: 'var(--rpg-parchment)',
      backgroundImage: `url(${new URL('../assets/bg.jpg', import.meta.url).href})`,
      backgroundSize: '600px', backgroundRepeat: 'repeat',
    }}>
      <div className="rpg-card" style={{ maxWidth: 480, padding: 32, width: '90%' }}>
        {steps[step]}

        {/* Step indicators */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20 }}>
          {steps.map((_, i) => (
            <div key={i} style={{
              width: 8, height: 8, borderRadius: '50%',
              background: i === step ? 'var(--rpg-gold)' : 'var(--rpg-parchment-dark)',
              border: '1px solid var(--rpg-gold-dark)',
            }} />
          ))}
        </div>
      </div>
    </div>
  );
}

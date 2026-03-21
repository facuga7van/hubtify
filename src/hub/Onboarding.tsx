import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Character from './Character';

interface Props {
  onComplete: () => void;
}

export default function Onboarding({ onComplete }: Props) {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState(0);

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
      <button className="rpg-button" onClick={() => {
        localStorage.setItem('hubtify_onboarded', 'true');
        onComplete();
      }} style={{ padding: '10px 32px', fontSize: '1rem' }}>
        Comenzar!
      </button>
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

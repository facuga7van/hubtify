import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Character from './Character';
import TitleBar from '../shared/components/TitleBar';

interface Props {
  onComplete: () => void;
}

export default function Onboarding({ onComplete }: Props) {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState(0);
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

  const animClass = animDir === 'forward' ? 'onboarding-step-forward' : 'onboarding-step-back';

  const stepContent = () => {
    switch (step) {
      case 0:
        return (
          <div key="welcome" className={animClass} style={{ textAlign: 'center' }}>
            <svg width="48" height="48" viewBox="0 0 18 18" fill="none" stroke="var(--gold)" strokeWidth="1.2" strokeLinecap="round" style={{ marginBottom: 16 }}>
              <path d="M9 2L3 5v4c0 4 3 6 6 7 3-1 6-3 6-7V5L9 2z"/>
              <path d="M7 9l2 2 3-4"/>
            </svg>
            <h1 className="onboarding__title">Hubtify</h1>
            <p className="onboarding__tagline">
              {t('onboarding.tagline')}
            </p>
            <div className="onboarding__lang-row">
              <button className={`rpg-button${i18n.language === 'es' ? '' : ' onboarding__btn-dim'}`}
                onClick={() => setLanguage('es')}>
                {t('settings.languageEs')}
              </button>
              <button className={`rpg-button${i18n.language === 'en' ? '' : ' onboarding__btn-dim'}`}
                onClick={() => setLanguage('en')}>
                {t('settings.languageEn')}
              </button>
            </div>
            <button className="rpg-button onboarding__primary-btn" onClick={() => goStep(1)}>
              {t('onboarding.startAdventure')}
            </button>
          </div>
        );

      case 1:
        return (
          <div key="character" className={animClass} style={{ textAlign: 'center' }}>
            <h2 className="onboarding__step-title">{t('onboarding.createCharacter')}</h2>
            <Character size={128} canCustomize />
            <div className="onboarding__nav-row" style={{ marginTop: 24 }}>
              <button className="rpg-button onboarding__back-btn" onClick={() => goStep(0)}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M7 1L3 5l4 4"/></svg>
              </button>
              <button className="rpg-button onboarding__primary-btn" onClick={finishOnboarding}>
                {t('onboarding.continue')}
              </button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="onboarding-shell">
      <TitleBar />
      <div className="onboarding-page">
        <div className="onboarding-card rpg-card">
          {stepContent()}

          {/* Step indicators — wax seal dots */}
          <div className="onboarding__steps">
            {[0, 1].map((i) => (
              <div key={i} className={
                `onboarding__dot${i === step ? ' onboarding__dot--active' : ''}${i < step ? ' onboarding__dot--done' : ''}`
              } />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

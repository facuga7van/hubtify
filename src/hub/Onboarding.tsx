import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Character from './Character';
import TitleBar from '../shared/components/TitleBar';
import RpgDatePicker from '../shared/components/RpgDatePicker';
import { isSoundEnabled, setSoundEnabled as setGlobalSound } from '../shared/audio';
import './styles/shell.css';
import { getAgeFromDob } from '../../shared/date-utils';
import { DEFAULT_MEAL_SCHEDULE } from '../../shared/meal-utils';

interface Props {
  onComplete: () => void;
}

const ACTIVITY_MULTIPLIERS: Record<string, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
};

type Goal = 'deficit' | 'maintain' | 'surplus';

const FONT_OPTIONS = [
  { value: '0.85', key: 'onboarding.fontCompact' },
  { value: '1', key: 'onboarding.fontNormal' },
  { value: '1.15', key: 'onboarding.fontLarge' },
  { value: '1.3', key: 'onboarding.fontXLarge' },
] as const;

const TOTAL_STEPS = 4;

export default function Onboarding({ onComplete }: Props) {
  const { t, i18n } = useTranslation();
  const [step, setStep] = useState(0);
  const [animDir, setAnimDir] = useState<'forward' | 'back'>('forward');

  // Step 0 — Preferences
  const [fontScale, setFontScale] = useState(() => localStorage.getItem('hubtify_font_scale') || '1');
  const [soundEnabled, setSoundEnabled] = useState(() => isSoundEnabled());
  const [helpBubbles, setHelpBubbles] = useState(() => localStorage.getItem('hubtify_help_bubbles') !== 'false');
  const [notifications, setNotifications] = useState(() => localStorage.getItem('hubtify_notifications_inapp') !== 'false');

  // Step 1 — Character
  const [heroName, setHeroName] = useState('');

  // Step 2 — Nutrition
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [sex, setSex] = useState<'M' | 'F'>('M');
  const [height, setHeight] = useState(170);
  const [weight, setWeight] = useState(70);
  const [activity, setActivity] = useState('moderate');
  const [goal, setGoal] = useState<Goal>('deficit');
  const [goalAmount, setGoalAmount] = useState(500);
  const [nutriErrors, setNutriErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const goStep = (target: number) => {
    setAnimDir(target > step ? 'forward' : 'back');
    setStep(target);
  };

  // ── Step 0 handlers ──
  const setLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('hubtify_lang', lang);
  };

  const applyFontScale = (value: string) => {
    setFontScale(value);
    localStorage.setItem('hubtify_font_scale', value);
    document.documentElement.style.setProperty('--font-scale', value);
  };

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    setGlobalSound(next);
  };

  const toggleHelpBubbles = () => {
    const next = !helpBubbles;
    setHelpBubbles(next);
    localStorage.setItem('hubtify_help_bubbles', next ? 'true' : 'false');
    window.dispatchEvent(new Event('helpBubbles:changed'));
  };

  const toggleNotifications = () => {
    const next = !notifications;
    setNotifications(next);
    localStorage.setItem('hubtify_notifications_inapp', next ? 'true' : 'false');
    window.dispatchEvent(new Event('notifications:settingsChanged'));
  };

  // ── Step 1 handler ──
  const saveCharacterAndAdvance = async () => {
    if (heroName.trim()) {
      await window.api.characterSetName(heroName.trim());
      window.dispatchEvent(new Event('character:nameChanged'));
    }
    goStep(2);
  };

  // ── Step 2 — TDEE calculation ──
  const age = dateOfBirth ? getAgeFromDob(dateOfBirth) : 0;
  const { tdee, dailyTarget } = useMemo(() => {
    if (!age || !weight || !height) return { tdee: 0, dailyTarget: 0 };
    const base = 10 * weight + 6.25 * height - 5 * age;
    const bmr = Math.max(800, Math.min(3500, sex === 'M' ? base + 5 : base - 161));
    const mult = ACTIVITY_MULTIPLIERS[activity] ?? 1.55;
    const computedTdee = bmr * mult;
    const adjustment = goal === 'deficit' ? -goalAmount : goal === 'surplus' ? goalAmount : 0;
    return { tdee: Math.round(computedTdee), dailyTarget: Math.round(computedTdee + adjustment) };
  }, [age, weight, height, sex, activity, goal, goalAmount]);

  const validateNutri = (): boolean => {
    const errs: Record<string, string> = {};
    if (!dateOfBirth) errs.dateOfBirth = t('nutrify.validation.dobRequired', 'Enter your date of birth');
    if (height < 100 || height > 250) errs.height = t('nutrify.validation.heightRange', 'Height must be 100-250 cm');
    if (weight < 30 || weight > 300) errs.weight = t('nutrify.validation.weightRange', 'Weight must be 30-300 kg');
    setNutriErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const saveNutriAndAdvance = async () => {
    if (!validateNutri()) return;
    setSubmitting(true);
    try {
      const deficitTargetKcal = goal === 'deficit' ? goalAmount : goal === 'surplus' ? -goalAmount : 0;
      await window.api.nutritionSaveProfile({
        dateOfBirth, sex, heightCm: height, initialWeightKg: weight,
        activityLevel: activity, deficitTargetKcal,
        mealSchedule: DEFAULT_MEAL_SCHEDULE,
      });
    } catch { /* ignore, user can configure later */ }
    setSubmitting(false);
    goStep(3);
  };

  const finishOnboarding = () => {
    localStorage.setItem('hubtify_onboarded', 'true');
    onComplete();
  };

  const animClass = animDir === 'forward' ? 'onboarding-step-forward' : 'onboarding-step-back';

  // Was a <div role="switch" tabIndex={0}> with a hand-rolled key handler.
  const Toggle = ({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) => (
    <button type="button" className={`onboarding__toggle${on ? ' onboarding__toggle--on' : ''}`}
      onClick={onToggle} role="switch" aria-checked={on} aria-label={label}>
      <div className="onboarding__toggle-knob" />
    </button>
  );

  const BackBtn = ({ target }: { target: number }) => (
    <button className="rpg-button onboarding__back-btn" onClick={() => goStep(target)}
      aria-label={t('common.back', 'Atrás')}>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M7 1L3 5l4 4"/></svg>
      <span className="onboarding__back-btn-text">{t('common.back', 'Atrás')}</span>
    </button>
  );

  const stepContent = () => {
    switch (step) {
      /* ──────────── STEP 0: Welcome + Preferences ──────────── */
      case 0:
        return (
          <div key="welcome" className={animClass} style={{ textAlign: 'center' }}>
            <svg width="48" height="48" viewBox="0 0 18 18" fill="none" stroke="var(--gold)" strokeWidth="1.2" strokeLinecap="round" style={{ marginBottom: 16 }}>
              <path d="M9 2L3 5v4c0 4 3 6 6 7 3-1 6-3 6-7V5L9 2z"/>
              <path d="M7 9l2 2 3-4"/>
            </svg>
            <h1 className="onboarding__title">Hubtify</h1>
            <p className="onboarding__tagline">{t('onboarding.tagline')}</p>

            {/* Language */}
            <div className="onboarding__lang-row">
              <button className={`rpg-button${i18n.language === 'es' ? '' : ' onboarding__btn-dim'}`}
                onClick={() => setLanguage('es')}>{t('settings.languageEs')}</button>
              <button className={`rpg-button${i18n.language === 'en' ? '' : ' onboarding__btn-dim'}`}
                onClick={() => setLanguage('en')}>{t('settings.languageEn')}</button>
            </div>

            {/* Preferences */}
            <div style={{ textAlign: 'left' }}>
              <div className="onboarding__section-label">{t('onboarding.preferences')}</div>

              {/* Font scale */}
              <div className="onboarding__pref-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <span className="onboarding__pref-label">{t('onboarding.fontScale')}</span>
                <div className="onboarding__font-options">
                  {FONT_OPTIONS.map(({ value, key }) => (
                    <button key={value}
                      className={`onboarding__font-btn${fontScale === value ? ' onboarding__font-btn--active' : ''}`}
                      onClick={() => applyFontScale(value)}>
                      {t(key)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Toggles */}
              <div className="onboarding__pref-row">
                <span className="onboarding__pref-label">{t('onboarding.sounds')}</span>
                <Toggle on={soundEnabled} onToggle={toggleSound} label={t('onboarding.sounds')} />
              </div>
              <div className="onboarding__pref-row">
                <span className="onboarding__pref-label">{t('onboarding.helpBubbles')}</span>
                <Toggle on={helpBubbles} onToggle={toggleHelpBubbles} label={t('onboarding.helpBubbles')} />
              </div>
              <div className="onboarding__pref-row">
                <span className="onboarding__pref-label">{t('onboarding.notifications')}</span>
                <Toggle on={notifications} onToggle={toggleNotifications} label={t('onboarding.notifications')} />
              </div>
            </div>

            <div className="onboarding__nav-row" style={{ marginTop: 20 }}>
              <button className="rpg-button onboarding__primary-btn" onClick={() => goStep(1)}>
                {t('onboarding.startAdventure')}
              </button>
            </div>
            <button type="button" className="onboarding__skip-all" onClick={finishOnboarding}>
              {t('onboarding.skipSetup', 'Saltar configuración')}
            </button>
          </div>
        );

      /* ──────────── STEP 1: Character ──────────── */
      case 1:
        return (
          <div key="character" className={animClass} style={{ textAlign: 'center' }}>
            <h2 className="onboarding__step-title">{t('onboarding.createCharacter')}</h2>
            <input
              className="onboarding__name-input"
              value={heroName}
              onChange={(e) => setHeroName(e.target.value)}
              placeholder={t('onboarding.heroNamePlaceholder')}
              maxLength={24}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') saveCharacterAndAdvance(); }}
            />
            <Character size={128} canCustomize />
            <p className="onboarding__name-hint">{t('onboarding.heroNameHint')}</p>
            <div className="onboarding__nav-row" style={{ marginTop: 20 }}>
              <BackBtn target={0} />
              <button className="rpg-button onboarding__primary-btn" onClick={saveCharacterAndAdvance}>
                {t('onboarding.continue')}
              </button>
            </div>
          </div>
        );

      /* ──────────── STEP 2: Nutrition Setup ──────────── */
      case 2:
        return (
          <div key="nutrition" className={animClass}>
            <h2 className="onboarding__step-title" style={{ textAlign: 'center' }}>{t('onboarding.nutriSetup')}</h2>
            <p className="onboarding__tagline" style={{ textAlign: 'center', marginBottom: 16 }}>{t('onboarding.nutriSetupDesc')}</p>

            <div className="onboarding__nutri-grid">
              {/* Left column — body info */}
              <div className="onboarding__nutri-col">
                <div className="onboarding__section-label" style={{ marginTop: 0 }}>{t('onboarding.bodyInfo')}</div>

                <div className="onboarding__field">
                  <span className="onboarding__field-label">{t('nutrify.dateOfBirth')}</span>
                  <RpgDatePicker value={dateOfBirth} onChange={(val) => {
                    setDateOfBirth(val);
                    setNutriErrors(prev => { const { dateOfBirth: _, ...rest } = prev; return rest; });
                  }} min="1900-01-01" max={new Date().toISOString().split('T')[0]} />
                  {nutriErrors.dateOfBirth && <span className="onboarding__field-error">{nutriErrors.dateOfBirth}</span>}
                </div>

                <div className="onboarding__field">
                  <span className="onboarding__field-label">{t('nutrify.sex')}</span>
                  <select value={sex} onChange={(e) => setSex(e.target.value as 'M' | 'F')} className="rpg-select">
                    <option value="M">{t('nutrify.male')}</option>
                    <option value="F">{t('nutrify.female')}</option>
                  </select>
                </div>

                <div className="onboarding__field">
                  <span className="onboarding__field-label">{t('nutrify.height')}</span>
                  <input type="number" value={height} onChange={(e) => {
                    setHeight(+e.target.value);
                    setNutriErrors(prev => { const { height: _, ...rest } = prev; return rest; });
                  }} min={100} max={250} className="rpg-input" />
                  {nutriErrors.height && <span className="onboarding__field-error">{nutriErrors.height}</span>}
                </div>

                <div className="onboarding__field">
                  <span className="onboarding__field-label">{t('nutrify.weight')}</span>
                  <input type="number" value={weight} onChange={(e) => {
                    setWeight(+e.target.value);
                    setNutriErrors(prev => { const { weight: _, ...rest } = prev; return rest; });
                  }} min={30} max={300} className="rpg-input" />
                  {nutriErrors.weight && <span className="onboarding__field-error">{nutriErrors.weight}</span>}
                </div>

                <div className="onboarding__field">
                  <span className="onboarding__field-label">{t('nutrify.activityLevel')}</span>
                  <select value={activity} onChange={(e) => setActivity(e.target.value)} className="rpg-select">
                    <option value="sedentary">{t('nutrify.sedentary')}</option>
                    <option value="light">{t('nutrify.light')}</option>
                    <option value="moderate">{t('nutrify.moderate')}</option>
                    <option value="active">{t('nutrify.active')}</option>
                  </select>
                </div>
              </div>

              {/* Right column — goal + preview */}
              <div className="onboarding__nutri-col">
                <div className="onboarding__section-label" style={{ marginTop: 0 }}>{t('onboarding.goal')}</div>

                <div className="onboarding__goal-btns">
                  {(['deficit', 'maintain', 'surplus'] as Goal[]).map((g) => (
                    <button key={g}
                      className={`rpg-button onboarding__goal-btn${goal === g ? ' onboarding__goal-btn--active' : ''}`}
                      onClick={() => setGoal(g)}>
                      {t(`nutrify.goal_${g}`)}
                    </button>
                  ))}
                </div>

                {goal !== 'maintain' && (
                  <div className="onboarding__field">
                    <span className="onboarding__field-label">{t('nutrify.goalAmount')} (kcal)</span>
                    <input type="number" value={goalAmount} onChange={(e) => setGoalAmount(+e.target.value)}
                      min={100} max={1500} step={50} className="rpg-input" />
                    <span style={{ fontSize: 'var(--fs-label)', opacity: 0.65 }}>
                      {goal === 'deficit' ? t('nutrify.goalAmountDeficitHint') : t('nutrify.goalAmountSurplusHint')}
                    </span>
                  </div>
                )}

                {tdee > 0 && (
                  <div className="onboarding__tdee-box">
                    <div>{t('onboarding.tdeeLabel')}: <strong>{tdee} kcal</strong></div>
                    <div style={{ marginTop: 4 }}>{t('onboarding.dailyTargetLabel')}: <strong>{dailyTarget} kcal</strong></div>
                  </div>
                )}
              </div>
            </div>

            <div className="onboarding__nav-row" style={{ marginTop: 20 }}>
              <BackBtn target={1} />
              <button className="rpg-button onboarding__back-btn" onClick={() => goStep(3)}>
                {t('onboarding.skipStep')}
              </button>
              <button className="rpg-button onboarding__primary-btn" onClick={saveNutriAndAdvance} disabled={submitting}>
                {submitting ? '...' : t('onboarding.continue')}
              </button>
            </div>
          </div>
        );

      /* ──────────── STEP 3: Ready ──────────── */
      case 3:
        return (
          <div key="ready" className={animClass} style={{ textAlign: 'center' }}>
            <svg className="onboarding__ready-icon" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L3 7v5c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V7l-9-5z"/>
              <path d="M9 12l2 2 4-4" strokeWidth="2"/>
            </svg>
            <h2 className="onboarding__step-title">{t('onboarding.ready')}</h2>
            <p className="onboarding__ready-desc">{t('onboarding.readyDesc')}</p>
            <button className="rpg-button onboarding__primary-btn" onClick={finishOnboarding}>
              {t('onboarding.startExploring')}
            </button>
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
          <div className="onboarding__steps" role="group" aria-label={t('onboarding.stepProgress', { current: step + 1, total: TOTAL_STEPS })}>
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <div key={i} className={
                `onboarding__dot${i === step ? ' onboarding__dot--active' : ''}${i < step ? ' onboarding__dot--done' : ''}`
              } aria-current={i === step ? 'step' : undefined} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

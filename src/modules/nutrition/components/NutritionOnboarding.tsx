import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getAgeFromDob } from '../../../../shared/date-utils';
import RpgDatePicker from '../../../shared/components/RpgDatePicker';
import { DEFAULT_MEAL_SCHEDULE } from '../../../../shared/meal-utils';
import { notifyNutritionChanged } from '../notify';

const ACTIVITY_MULTIPLIERS: Record<string, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
};

interface Props {
  onComplete: () => void;
  /** "Not now" — hand the user back to wherever they came from. */
  onSkip?: () => void;
}

type Goal = 'deficit' | 'maintain' | 'surplus';

export default function NutritionOnboarding({ onComplete, onSkip }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);

  // Body
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [sex, setSex] = useState<'M' | 'F'>('M');
  const [height, setHeight] = useState(170);
  const [weight, setWeight] = useState(70);
  const [activity, setActivity] = useState('moderate');

  // Goal
  const [goal, setGoal] = useState<Goal>('deficit');
  const [goalAmount, setGoalAmount] = useState(500);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateStep1 = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!dateOfBirth) newErrors.dateOfBirth = t('nutrify.validation.dobRequired', 'Enter your date of birth');
    if (height < 100 || height > 250) newErrors.height = t('nutrify.validation.heightRange', 'Height must be 100-250 cm');
    if (weight < 30 || weight > 300) newErrors.weight = t('nutrify.validation.weightRange', 'Weight must be 30-300 kg');
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const deficitTargetKcal = goal === 'deficit' ? goalAmount
        : goal === 'surplus' ? -goalAmount
        : 0;

      await window.api.nutritionSaveProfile({
        dateOfBirth, sex, heightCm: height, initialWeightKg: weight,
        activityLevel: activity, deficitTargetKcal,
        // Meal times are an expert setting a brand-new user cannot judge —
        // ship sensible defaults and let them tune it later in Settings.
        mealSchedule: { ...DEFAULT_MEAL_SCHEDULE },
      });
      notifyNutritionChanged();
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.somethingWentWrong'));
    } finally {
      setSubmitting(false);
    }
  };

  // BMR / TDEE live preview (Mifflin-St Jeor)
  const age = dateOfBirth ? getAgeFromDob(dateOfBirth) : 0;
  const { tdee, dailyTarget } = useMemo(() => {
    if (!age || !weight || !height) return { tdee: 0, dailyTarget: 0 };
    const base = 10 * weight + 6.25 * height - 5 * age;
    const bmr = Math.max(800, Math.min(3500, sex === 'M' ? base + 5 : base - 161));
    const mult = ACTIVITY_MULTIPLIERS[activity] ?? 1.55;
    const computedTdee = bmr * mult;
    const adjustment = goal === 'deficit' ? -goalAmount
      : goal === 'surplus' ? goalAmount
      : 0;
    return { tdee: Math.round(computedTdee), dailyTarget: Math.round(computedTdee + adjustment) };
  }, [age, weight, height, sex, activity, goal, goalAmount]);

  const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 'var(--fs-quote)' };

  return (
    <div className="nutri-card" style={{ maxWidth: 450, margin: '40px auto', padding: 24, position: 'relative' }}>
      {onSkip && (
        <button
          className="nutri-popup-close tap-target"
          onClick={onSkip}
          aria-label={t('nutrify.onboardingSkip', 'Después')}
          title={t('nutrify.onboardingSkip', 'Después')}
        >
          <svg width="12" height="12" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" aria-hidden="true">
            <line x1="2" y1="2" x2="8" y2="8" /><line x1="8" y1="2" x2="2" y2="8" />
          </svg>
        </button>
      )}
      <h3 style={{ marginBottom: 4, textAlign: 'center' }}>{t('nutrify.nutritionSetup')}</h3>
      <p style={{ textAlign: 'center', fontSize: 'var(--fs-label)', color: 'var(--ink-soft)', marginBottom: 16 }}>
        {step === 0 ? t('nutrify.setupStep1') : t('nutrify.setupStep2')}
      </p>

      {step === 0 ? (
        /* Step 0: Body info */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={labelStyle}>
            {t('nutrify.dateOfBirth')}
            <RpgDatePicker value={dateOfBirth} onChange={(val) => {
              setDateOfBirth(val);
              setErrors(prev => { const { dateOfBirth: _, ...rest } = prev; return rest; });
            }}
              min="1900-01-01" max={new Date().toISOString().split('T')[0]} />
            {errors.dateOfBirth && (
              <span className="nutri-field-error">{errors.dateOfBirth}</span>
            )}
          </label>
          <label style={labelStyle}>
            {t('nutrify.sex')}
            <select value={sex} onChange={(e) => setSex(e.target.value as 'M' | 'F')} className="rpg-select">
              <option value="M">{t('nutrify.male')}</option>
              <option value="F">{t('nutrify.female')}</option>
            </select>
          </label>
          <label style={labelStyle}>
            {t('nutrify.height')}
            <input type="number" value={height} onChange={(e) => {
              setHeight(+e.target.value);
              setErrors(prev => { const { height: _, ...rest } = prev; return rest; });
            }}
              min={100} max={250} className="rpg-input" />
            {errors.height && (
              <span className="nutri-field-error">{errors.height}</span>
            )}
          </label>
          <label style={labelStyle}>
            {t('nutrify.weight')}
            <input type="number" value={weight} onChange={(e) => {
              setWeight(+e.target.value);
              setErrors(prev => { const { weight: _, ...rest } = prev; return rest; });
            }}
              min={30} max={300} className="rpg-input" />
            {errors.weight && (
              <span className="nutri-field-error">{errors.weight}</span>
            )}
          </label>
          <label style={labelStyle}>
            {t('nutrify.activityLevel')}
            <select value={activity} onChange={(e) => setActivity(e.target.value)} className="rpg-select">
              <option value="sedentary">{t('nutrify.sedentary')}</option>
              <option value="light">{t('nutrify.light')}</option>
              <option value="moderate">{t('nutrify.moderate')}</option>
              <option value="active">{t('nutrify.active')}</option>
            </select>
          </label>
          <button className="rpg-button" onClick={() => {
            if (validateStep1()) setStep(1);
          }} style={{ marginTop: 8 }}>
            {t('onboarding.continue')}
          </button>
          {onSkip && (
            <button className="nutri-btn nutri-btn-ghost" onClick={onSkip} style={{ justifyContent: 'center' }}>
              {t('nutrify.onboardingSkip', 'Después')}
            </button>
          )}
        </div>
      ) : (
        /* Step 1: Goal */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={labelStyle}>
            {t('nutrify.goal')}
            <div style={{ display: 'flex', gap: 6 }}>
              {(['deficit', 'maintain', 'surplus'] as Goal[]).map((g) => (
                <button key={g} className="rpg-button" onClick={() => setGoal(g)}
                  style={{ flex: 1, opacity: goal === g ? 1 : 0.5, padding: '8px 4px', fontSize: 'var(--fs-label)' }}>
                  {t(`nutrify.goal_${g}`)}
                </button>
              ))}
            </div>
          </label>

          {goal !== 'maintain' && (
            <label style={labelStyle}>
              {t('nutrify.goalAmount')} (kcal)
              <input type="number" value={goalAmount} onChange={(e) => setGoalAmount(+e.target.value)}
                min={100} max={1500} step={50} className="rpg-input" />
              <span style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-soft)' }}>
                {goal === 'deficit' ? t('nutrify.goalAmountDeficitHint') : t('nutrify.goalAmountSurplusHint')}
              </span>
            </label>
          )}

          {tdee > 0 && (
            <div className="nutri-tdee-preview">
              <p>{t('nutrify.tdeeEstimateLabel', 'Estimación inicial (TDEE)')}: <strong>{tdee} kcal/{t('nutrify.perDay', 'day')}</strong></p>
              <p>{t('nutrify.dailyTarget', 'Objetivo diario')}: <strong>{dailyTarget} kcal/{t('nutrify.perDay', 'día')}</strong></p>
              <p style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-soft)', margin: '4px 0 0' }}>
                {t('nutrify.tdeeEstimateNote', 'Es sólo una estimación de arranque: el objetivo real se ajusta con tu actividad de los últimos 14 días.')}
              </p>
            </div>
          )}

          {error && (
            <p style={{ color: 'var(--rubric)', fontSize: 'var(--fs-label)', margin: 0 }}>{error}</p>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="rpg-button" onClick={() => setStep(0)} style={{ opacity: 0.7 }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M7 1L3 5l4 4"/></svg>
              {' '}{t('common.back', 'Atrás')}
            </button>
            <button className="rpg-button" onClick={handleSubmit} disabled={submitting} style={{ flex: 1 }}>
              {submitting ? t('common.loading') : t('nutrify.startTracking')}
            </button>
          </div>
          {onSkip && (
            <button className="nutri-btn nutri-btn-ghost" onClick={onSkip} style={{ justifyContent: 'center' }}>
              {t('nutrify.onboardingSkip', 'Después')}
            </button>
          )}
        </div>
      )}

      {/* Step dots */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 16 }}>
        {[0, 1].map((i) => (
          <div key={i} style={{
            width: 6, height: 6, borderRadius: '50%',
            background: i === step ? 'var(--gold)' : 'var(--parch-1)',
            border: '1px solid var(--gold-dark)',
          }} />
        ))}
      </div>
    </div>
  );
}

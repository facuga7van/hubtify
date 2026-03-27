import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import RpgDatePicker from '../../../shared/components/RpgDatePicker';

interface Props { onComplete: () => void; }

type Goal = 'deficit' | 'maintain' | 'surplus';

export default function NutritionOnboarding({ onComplete }: Props) {
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
  const [gymCalories, setGymCalories] = useState(300);
  const [stepFactor, setStepFactor] = useState(0.04);

  const handleSubmit = async () => {
    const deficitTargetKcal = goal === 'deficit' ? goalAmount
      : goal === 'surplus' ? -goalAmount
      : 0;

    await window.api.nutritionSaveProfile({
      dateOfBirth, sex, heightCm: height, initialWeightKg: weight,
      activityLevel: activity, deficitTargetKcal, gymCalories, stepCaloriesFactor: stepFactor,
    });
    onComplete();
  };

  const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.9rem' };

  return (
    <div className="rpg-card" style={{ maxWidth: 450, margin: '40px auto', padding: 24 }}>
      <h3 style={{ marginBottom: 4, textAlign: 'center' }}>{t('nutrify.nutritionSetup')}</h3>
      <p style={{ textAlign: 'center', fontSize: '0.85rem', opacity: 0.6, marginBottom: 16 }}>
        {step === 0 ? t('nutrify.setupStep1') : t('nutrify.setupStep2')}
      </p>

      {step === 0 ? (
        /* Step 1: Body info */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={labelStyle}>
            {t('nutrify.dateOfBirth')}
            <RpgDatePicker value={dateOfBirth} onChange={setDateOfBirth}
              min="1900-01-01" max={new Date().toISOString().split('T')[0]} />
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
            <input type="number" value={height} onChange={(e) => setHeight(+e.target.value)}
              min={100} max={250} className="rpg-input" />
          </label>
          <label style={labelStyle}>
            {t('nutrify.weight')}
            <input type="number" value={weight} onChange={(e) => setWeight(+e.target.value)}
              min={30} max={300} className="rpg-input" />
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
            if (!dateOfBirth || height < 100 || height > 250 || weight < 30 || weight > 300) return;
            setStep(1);
          }} style={{ marginTop: 8 }}>
            {t('onboarding.continue')}
          </button>
        </div>
      ) : (
        /* Step 2: Goal */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={labelStyle}>
            {t('nutrify.goal')}
            <div style={{ display: 'flex', gap: 6 }}>
              {(['deficit', 'maintain', 'surplus'] as Goal[]).map((g) => (
                <button key={g} className="rpg-button" onClick={() => setGoal(g)}
                  style={{ flex: 1, opacity: goal === g ? 1 : 0.5, padding: '8px 4px', fontSize: '0.8rem' }}>
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
              <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>
                {goal === 'deficit' ? t('nutrify.goalAmountDeficitHint') : t('nutrify.goalAmountSurplusHint')}
              </span>
            </label>
          )}

          <label style={labelStyle}>
            {t('nutrify.gymCalories')} (kcal)
            <input type="number" value={gymCalories} onChange={(e) => setGymCalories(+e.target.value)}
              min={0} max={1000} step={50} className="rpg-input" />
            <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>{t('nutrify.gymCaloriesHint')}</span>
          </label>

          <label style={labelStyle}>
            {t('nutrify.stepFactor')}
            <input type="number" value={stepFactor} onChange={(e) => setStepFactor(+e.target.value)}
              min={0} max={0.2} step={0.01} className="rpg-input" />
            <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>{t('nutrify.stepFactorHint')}</span>
          </label>

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="rpg-button" onClick={() => setStep(0)} style={{ opacity: 0.7 }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M7 1L3 5l4 4"/></svg>
            </button>
            <button className="rpg-button" onClick={handleSubmit} style={{ flex: 1 }}>
              {t('nutrify.startTracking')}
            </button>
          </div>
        </div>
      )}

      {/* Step dots */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 16 }}>
        {[0, 1].map((i) => (
          <div key={i} style={{
            width: 6, height: 6, borderRadius: '50%',
            background: i === step ? 'var(--rpg-gold)' : 'var(--rpg-parchment-dark)',
            border: '1px solid var(--rpg-gold-dark)',
          }} />
        ))}
      </div>
    </div>
  );
}

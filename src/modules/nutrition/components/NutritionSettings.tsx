import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../../shared/components/PageHeader';
import { getAgeFromDob } from '../../../../shared/date-utils';
import RpgDatePicker from '../../../shared/components/RpgDatePicker';
import RpgNumberInput from '../../../shared/components/RpgNumberInput';
import type { NutritionProfile } from '../types';

type Goal = 'deficit' | 'maintain' | 'surplus';

export default function NutritionSettings() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current); };
  }, []);

  const [dateOfBirth, setDateOfBirth] = useState('');
  const [weightCheckDay, setWeightCheckDay] = useState(1);
  const [sex, setSex] = useState<'M' | 'F'>('M');
  const [height, setHeight] = useState(170);
  const [weight, setWeight] = useState(70);
  const [activity, setActivity] = useState('moderate');
  const [goal, setGoal] = useState<Goal>('deficit');
  const [goalAmount, setGoalAmount] = useState(500);
  const [gymCalories, setGymCalories] = useState(300);
  const [stepFactor, setStepFactor] = useState(0.04);

  useEffect(() => {
    window.api.nutritionGetProfile().then((prof) => {
      if (prof) {
        const p = prof as NutritionProfile;
        setDateOfBirth(p.dateOfBirth || '');
        setWeightCheckDay(p.weightCheckDay || 1);
        setSex(p.sex);
        setHeight(p.heightCm);
        setWeight(p.initialWeightKg);
        setActivity(p.activityLevel);
        setGymCalories(p.gymCalories);
        setStepFactor(p.stepCaloriesFactor);

        const deficit = p.deficitTargetKcal;
        if (deficit > 0) { setGoal('deficit'); setGoalAmount(deficit); }
        else if (deficit < 0) { setGoal('surplus'); setGoalAmount(Math.abs(deficit)); }
        else { setGoal('maintain'); setGoalAmount(0); }
      }
    }).catch(() => setLoadError(true)).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    const deficitTargetKcal = goal === 'deficit' ? goalAmount
      : goal === 'surplus' ? -goalAmount
      : 0;

    await window.api.nutritionSaveProfile({
      dateOfBirth, weightCheckDay, sex, heightCm: height, initialWeightKg: weight,
      activityLevel: activity, deficitTargetKcal, gymCalories, stepCaloriesFactor: stepFactor,
    });
    setSaved(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
    window.dispatchEvent(new Event('nutrition:settingsChanged'));
  };

  if (loading) return <div style={{ padding: 24, opacity: 0.5 }}>{t('common.loading')}</div>;

  if (loadError) return (
    <div style={{ padding: 24, textAlign: 'center' }}>
      <p style={{ marginBottom: 12, color: 'var(--rpg-hp-red)' }}>{t('common.somethingWentWrong')}</p>
      <button className="rpg-button" onClick={() => window.location.reload()}>{t('common.tryAgain')}</button>
    </div>
  );

  const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.9rem', marginBottom: 4 };

  return (
    <div>
      <PageHeader
        title={t('nutrify.profileSettings')}
        subtitle={t('nutrify.profileSettingsSub')}
        actions={
          <button className="rpg-button" onClick={() => navigate('/nutrition')}
            style={{ fontSize: '0.75rem', padding: '4px 12px' }}>
            ← {t('common.back')}
          </button>
        }
      />

      {/* Body */}
      <div className="rpg-card" style={{ marginBottom: 16 }}>
        <div className="rpg-card-title">{t('nutrify.bodyInfo')}</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <label style={{ ...labelStyle, flex: '2 1 0' }}>
            {t('nutrify.dateOfBirth')}
            <RpgDatePicker value={dateOfBirth} onChange={setDateOfBirth}
              min="1900-01-01" max={new Date().toISOString().split('T')[0]} />
            {dateOfBirth && (
              <span style={{ fontSize: '0.7rem', opacity: 0.6, marginTop: 2 }}>
                {t('nutrify.calculatedAge', { age: getAgeFromDob(dateOfBirth) })}
              </span>
            )}
          </label>
          <label style={{ ...labelStyle, flex: '1 1 0' }}>
            {t('nutrify.sex')}
            <select value={sex} onChange={(e) => setSex(e.target.value as 'M' | 'F')} className="rpg-select" style={{ width: '100%' }}>
              <option value="M">{t('nutrify.male')}</option>
              <option value="F">{t('nutrify.female')}</option>
            </select>
          </label>
          <label style={{ ...labelStyle, flex: '1 1 0' }}>
            {t('nutrify.height')}
            <RpgNumberInput value={String(height)} onChange={(v) => setHeight(+v)} step={1} min={100} max={250} suffix="cm" />
          </label>
          <label style={{ ...labelStyle, flex: '1 1 0' }}>
            {t('nutrify.weight')}
            <RpgNumberInput value={String(weight)} onChange={(v) => setWeight(+v)} step={0.1} min={30} max={300} suffix="kg" />
          </label>
          <label style={{ ...labelStyle, flex: '1.5 1 0' }}>
            {t('nutrify.activityLevel')}
            <select value={activity} onChange={(e) => setActivity(e.target.value)} className="rpg-select" style={{ width: '100%' }}>
              <option value="sedentary">{t('nutrify.sedentary')}</option>
              <option value="light">{t('nutrify.light')}</option>
              <option value="moderate">{t('nutrify.moderate')}</option>
              <option value="active">{t('nutrify.active')}</option>
            </select>
          </label>
        </div>
      </div>

      {/* Goal */}
      <div className="rpg-card" style={{ marginBottom: 16 }}>
        <div className="rpg-card-title">{t('nutrify.goal')}</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {(['deficit', 'maintain', 'surplus'] as Goal[]).map((g) => (
            <button key={g} className="rpg-button" onClick={() => setGoal(g)}
              style={{ flex: 1, opacity: goal === g ? 1 : 0.5 }}>
              {t(`nutrify.goal_${g}`)}
            </button>
          ))}
        </div>

        {goal !== 'maintain' && (
          <label style={labelStyle}>
            {t('nutrify.goalAmount')} (kcal)
            <input type="number" value={goalAmount} onChange={(e) => setGoalAmount(+e.target.value)}
              className="rpg-input" min={100} max={1500} step={50} />
            <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>
              {goal === 'deficit' ? t('nutrify.goalAmountDeficitHint') : t('nutrify.goalAmountSurplusHint')}
            </span>
          </label>
        )}
      </div>

      {/* Weight check-in day */}
      <div className="rpg-card" style={{ marginBottom: 16 }}>
        <label style={labelStyle}>
          {t('nutrify.weightCheckDay')}
          <select value={weightCheckDay} onChange={(e) => setWeightCheckDay(+e.target.value)} className="rpg-input">
            {[1, 2, 3, 4, 5, 6, 7].map(d => (
              <option key={d} value={d}>{t(`nutrify.weekdays.${d}`)}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Save */}
      <button className="rpg-button" onClick={handleSave} style={{ width: '100%', padding: '10px', fontSize: '1rem' }}>
        {saved ? '✓ ' + t('nutrify.saved') : t('nutrify.saveProfile')}
      </button>
    </div>
  );
}

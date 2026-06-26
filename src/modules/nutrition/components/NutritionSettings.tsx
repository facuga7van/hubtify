import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { getAgeFromDob } from '../../../../shared/date-utils';
import RpgDatePicker from '../../../shared/components/RpgDatePicker';
import RpgNumberInput from '../../../shared/components/RpgNumberInput';
import MealScheduleEditor from './shared/MealScheduleEditor';
import HelpBubble from '../../../shared/components/HelpBubble';
import { Gear, Shield, Compass, Chalice, Scale, Meat } from '../../../shared/components/icons';
import { DEFAULT_MEAL_SCHEDULE } from '../../../../shared/meal-utils';
import { calcAutoMacroTargets } from '../../../../shared/macro-utils';
import type { MealSchedule } from '../../../../shared/meal-utils';
import type { NutritionProfile } from '../types';

type Goal = 'deficit' | 'maintain' | 'surplus';

const ACTIVITY_MULTIPLIERS: Record<string, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
};

const GOAL_ICONS: Record<Goal, string> = { deficit: '\u2193', maintain: '=', surplus: '\u2191' };

export default function NutritionSettings() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current); };
  }, []);

  const [dateOfBirth, setDateOfBirth] = useState('');
  const [weightCheckDay, setWeightCheckDay] = useState(1);
  const [weightPopupEnabled, setWeightPopupEnabled] = useState(true);
  const [sex, setSex] = useState<'M' | 'F'>('M');
  const [height, setHeight] = useState(170);
  const [weight, setWeight] = useState(70);
  const [activity, setActivity] = useState('moderate');
  const [goal, setGoal] = useState<Goal>('deficit');
  const [goalAmount, setGoalAmount] = useState(500);
  const [mealSchedule, setMealSchedule] = useState<MealSchedule>({ ...DEFAULT_MEAL_SCHEDULE });
  // Macro target overrides (empty string = use auto calculation)
  const [proteinTarget, setProteinTarget] = useState('');
  const [carbsTarget, setCarbsTarget] = useState('');
  const [fatTarget, setFatTarget] = useState('');
  const [macroError, setMacroError] = useState('');

  const loadProfile = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    Promise.all([
      window.api.nutritionGetProfile(),
      window.api.nutritionGetWeights(),
    ]).then(([prof, weights]) => {
      if (prof) {
        const p = prof as NutritionProfile;
        setDateOfBirth(p.dateOfBirth || '');
        setWeightCheckDay(p.weightCheckDay || 1);
        setWeightPopupEnabled(p.weightPopupEnabled !== 0);
        setSex(p.sex);
        setHeight(p.heightCm);

        // Use latest logged weight if available, otherwise initial
        const weightList = weights as Array<{ weightKg: number }>;
        const latestWeight = weightList.length > 0 ? weightList[weightList.length - 1].weightKg : null;
        setWeight(latestWeight ?? p.initialWeightKg);

        setActivity(p.activityLevel);

        const deficit = p.deficitTargetKcal;
        if (deficit > 0) { setGoal('deficit'); setGoalAmount(deficit); }
        else if (deficit < 0) { setGoal('surplus'); setGoalAmount(Math.abs(deficit)); }
        else { setGoal('maintain'); setGoalAmount(0); }

        if (p.mealSchedule) setMealSchedule(p.mealSchedule);

        // Macro overrides: only treated as set when all three are present (todo-o-nada)
        if (p.proteinTargetG != null && p.carbsTargetG != null && p.fatTargetG != null) {
          setProteinTarget(String(p.proteinTargetG));
          setCarbsTarget(String(p.carbsTargetG));
          setFatTarget(String(p.fatTargetG));
        } else {
          setProteinTarget('');
          setCarbsTarget('');
          setFatTarget('');
        }
      }
    }).catch(() => setLoadError(true)).finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  // Reload profile when account is switched
  useEffect(() => {
    const handler = () => loadProfile();
    window.addEventListener('account:switched', handler);
    return () => window.removeEventListener('account:switched', handler);
  }, [loadProfile]);

  const handleSave = async () => {
    if (saving) return;

    // Resolve macro overrides: all-or-nothing. Empty all three = use auto.
    const macroStrings = [proteinTarget, carbsTarget, fatTarget];
    const filled = macroStrings.filter((v) => v.trim() !== '');
    let proteinTargetG: number | null = null;
    let carbsTargetG: number | null = null;
    let fatTargetG: number | null = null;
    if (filled.length > 0) {
      if (filled.length < 3) {
        setMacroError(t('nutrify.macroTargetsPartial', 'Completá los tres macros o dejá los tres vacíos para usar el cálculo automático.'));
        return;
      }
      const parsed = macroStrings.map((v) => parseFloat(v));
      if (parsed.some((n) => !Number.isFinite(n) || n < 0 || n > 2000)) {
        setMacroError(t('nutrify.macroTargetsRange', 'Cada macro debe estar entre 0 y 2000 g.'));
        return;
      }
      [proteinTargetG, carbsTargetG, fatTargetG] = parsed;
    }
    setMacroError('');

    setSaving(true);
    setSaveError('');
    try {
      const deficitTargetKcal = goal === 'deficit' ? goalAmount
        : goal === 'surplus' ? -goalAmount
        : 0;

      await window.api.nutritionSaveProfile({
        dateOfBirth, weightCheckDay, weightPopupEnabled, sex, heightCm: height, initialWeightKg: weight,
        activityLevel: activity, deficitTargetKcal, mealSchedule,
        proteinTargetG, carbsTargetG, fatTargetG,
      });
      setSaved(true);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
      window.dispatchEvent(new Event('nutrition:settingsChanged'));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t('common.somethingWentWrong'));
    } finally {
      setSaving(false);
    }
  };

  // BMR / TDEE calculation (Mifflin-St Jeor, same formula as backend)
  const age = dateOfBirth ? getAgeFromDob(dateOfBirth) : 0;
  const { bmr, tdee, multiplier } = useMemo(() => {
    if (!age || !weight || !height) return { bmr: 0, tdee: 0, multiplier: 0 };
    const base = 10 * weight + 6.25 * height - 5 * age;
    const rawBmr = Math.max(800, Math.min(3500, sex === 'M' ? base + 5 : base - 161));
    const mult = ACTIVITY_MULTIPLIERS[activity] ?? 1.55;
    return { bmr: Math.round(rawBmr), tdee: Math.round(rawBmr * mult), multiplier: mult };
  }, [age, weight, height, sex, activity]);

  // Auto macro targets (shown as placeholders / suggestions when no override is set)
  const autoMacros = useMemo(() => {
    const deficit = goal === 'deficit' ? goalAmount : goal === 'surplus' ? -goalAmount : 0;
    return calcAutoMacroTargets(tdee - deficit, weight, deficit);
  }, [tdee, weight, goal, goalAmount]);

  const hasMacroOverride = [proteinTarget, carbsTarget, fatTarget].some((v) => v.trim() !== '');

  const handleResetMacros = () => {
    setProteinTarget('');
    setCarbsTarget('');
    setFatTarget('');
    setMacroError('');
  };

  if (loading) return <div style={{ padding: 24, fontFamily: "'IM Fell English', serif", color: 'var(--ink-faded)' }}>{t('common.loading')}</div>;

  if (loadError) return (
    <div style={{ padding: 24, textAlign: 'center' }}>
      <p style={{ marginBottom: 12, color: 'var(--rubric)' }}>{t('common.somethingWentWrong')}</p>
      <button className="nutri-btn" onClick={() => { setLoadError(false); setLoading(true); loadProfile(); }}>{t('common.tryAgain')}</button>
    </div>
  );

  return (
    <div className="nutri-page">
      {/* ── Page Head ── */}
      <div className="nutri-page-head">
        <div>
          <h1 className="nutri-page-title">
            <span className="nutri-title-ico"><Gear width={18} height={18} /></span> {t('nutrify.profileSettings', 'Configuración Nutrify')}
          </h1>
          <div className="nutri-page-sub">{t('nutrify.profileSettingsSub', 'Ajustá tus datos corporales y objetivo calórico')}</div>
        </div>
        <div className="nutri-head-actions">
          <button className="nutri-btn nutri-btn-ghost" onClick={() => navigate('/nutrition')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M19 12H5M5 12l6-6M5 12l6 6"/></svg>{' '}
            {t('common.back', 'Volver')}
          </button>
        </div>
      </div>

      {/* ── Body Data ── */}
      <div className="nutri-card">
        <HelpBubble text={t('nutrify.bodyDataHelp', 'Tus datos físicos calculan el BMR (metabolismo basal) con Mifflin-St Jeor y el TDEE según tu actividad.')} />
        <h3 className="nutri-card-title">
          <span className="nutri-t-ico"><Shield width={14} height={14} /></span> {t('nutrify.bodyInfo', 'Datos Corporales')}
        </h3>

        <div className="nutri-config-grid">
          <div className="nutri-field span-2">
            <label className="nutri-label">{t('nutrify.dateOfBirth', 'Fecha de nacimiento')}</label>
            <RpgDatePicker value={dateOfBirth} onChange={setDateOfBirth}
              min="1900-01-01" max={new Date().toISOString().split('T')[0]} />
            {dateOfBirth && (
              <span className="nutri-field-hint">
                {t('nutrify.calculatedAge', { age })}
              </span>
            )}
          </div>

          <div className="nutri-field">
            <label className="nutri-label">{t('nutrify.sex', 'Sexo')}</label>
            <select value={sex} onChange={(e) => setSex(e.target.value as 'M' | 'F')} className="nutri-select">
              <option value="M">{t('nutrify.male', 'Masculino')}</option>
              <option value="F">{t('nutrify.female', 'Femenino')}</option>
            </select>
          </div>

          <div className="nutri-field">
            <label className="nutri-label">{t('nutrify.height', 'Altura')}</label>
            <RpgNumberInput value={String(height)} onChange={(v) => setHeight(+v)} step={1} min={100} max={250} suffix="cm" />
          </div>

          <div className="nutri-field">
            <label className="nutri-label">{t('nutrify.weight', 'Peso')}</label>
            <RpgNumberInput value={String(weight)} onChange={(v) => setWeight(+v)} step={0.1} min={30} max={300} suffix="kg" />
          </div>

          <div className="nutri-field">
            <label className="nutri-label">{t('nutrify.activityLevel', 'Actividad')}</label>
            <select value={activity} onChange={(e) => setActivity(e.target.value)} className="nutri-select">
              <option value="sedentary">{t('nutrify.sedentary', 'Sedentario')}</option>
              <option value="light">{t('nutrify.light', 'Ligero')}</option>
              <option value="moderate">{t('nutrify.moderate', 'Moderado')}</option>
              <option value="active">{t('nutrify.active', 'Activo')}</option>
            </select>
          </div>
        </div>

        {/* TDEE display */}
        {bmr > 0 && (
          <div className="nutri-tdee-display">
            <div>
              <div className="tdee-label">{t('nutrify.tdeeCalculated', 'TDEE calculado')}</div>
              <span className="nutri-field-hint">{t('nutrify.tdeeDesc', 'Energía total diaria según tu nivel de actividad')}</span>
            </div>
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <span className="tdee-val">{tdee.toLocaleString()}</span>{' '}
              <span className="tdee-unit">kcal/{t('nutrify.perDay', 'día')}</span>
              <div className="nutri-field-hint">
                BMR {bmr.toLocaleString()} {'\u00d7'}{multiplier} {t('nutrify.activityLevel', 'actividad').toLowerCase()}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Goal ── */}
      <div className="nutri-card">
        <HelpBubble text={t('nutrify.goalHelp', 'Déficit: menos que TDEE para bajar. Mantenimiento: igual. Superávit: más para ganar masa.')} />
        <h3 className="nutri-card-title">
          <span className="nutri-t-ico"><Compass width={14} height={14} /></span> {t('nutrify.goal', 'Objetivo')}
        </h3>

        <div className="nutri-goal-toggle">
          {(['deficit', 'maintain', 'surplus'] as Goal[]).map((g) => (
            <button key={g} className={`nutri-goal-opt${goal === g ? ' active' : ''}`} onClick={() => setGoal(g)}>
              <span className="opt-ico">{GOAL_ICONS[g]}</span> {t(`nutrify.goal_${g}`)}
            </button>
          ))}
        </div>
        <p className="nutri-goal-desc">{t(`nutrify.goalDesc_${goal}`)}</p>

        {goal !== 'maintain' && (
          <div style={{ marginTop: 14 }}>
            <div className="nutri-field">
              <label className="nutri-label">{t('nutrify.goalAmount', 'Cantidad')} (kcal)</label>
              <RpgNumberInput value={String(goalAmount)} onChange={(v) => setGoalAmount(+v || 0)} min={100} max={1500} step={50} suffix="kcal" />
              <span className="nutri-field-hint">
                {goal === 'deficit' ? t('nutrify.goalAmountDeficitHint') : t('nutrify.goalAmountSurplusHint')}
              </span>
            </div>
          </div>
        )}

        {tdee > 0 && (
          <div className="nutri-daily-target-preview">
            {t('nutrify.dailyTarget', 'Daily target')}:{' '}
            <strong>{Math.round(tdee + (goal === 'deficit' ? -goalAmount : goal === 'surplus' ? goalAmount : 0))} kcal</strong>
            <span className="nutri-target-breakdown">
              (TDEE {tdee} {goal === 'deficit' ? '-' : goal === 'surplus' ? '+' : '\u00b1'} {goal === 'maintain' ? 0 : goalAmount})
            </span>
          </div>
        )}
      </div>

      {/* ── Macro Targets ── */}
      <div className="nutri-card">
        <HelpBubble text={t('nutrify.macroTargetsHelp', 'Objetivos de gramos de proteína, carbohidratos y grasa. Por defecto se calculan automáticamente según tu objetivo; podés sobrescribir los tres a la vez.')} />
        <h3 className="nutri-card-title">
          <span className="nutri-t-ico"><Meat width={14} height={14} /></span> {t('nutrify.macroTargets', 'Objetivos de macros')}
          <span className="nutri-card-subtitle">{t('nutrify.macroTargetsSub', 'Dejá vacío para usar el cálculo automático')}</span>
        </h3>

        <div className="nutri-config-grid">
          <div className="nutri-field">
            <label className="nutri-label">{t('nutrify.protein', 'Proteína')}</label>
            <RpgNumberInput value={proteinTarget} onChange={setProteinTarget} step={5} min={0} max={2000}
              suffix="g" placeholder={String(autoMacros.proteinG)} />
          </div>
          <div className="nutri-field">
            <label className="nutri-label">{t('nutrify.carbs', 'Carbohidratos')}</label>
            <RpgNumberInput value={carbsTarget} onChange={setCarbsTarget} step={5} min={0} max={2000}
              suffix="g" placeholder={String(autoMacros.carbsG)} />
          </div>
          <div className="nutri-field">
            <label className="nutri-label">{t('nutrify.fat', 'Grasa')}</label>
            <RpgNumberInput value={fatTarget} onChange={setFatTarget} step={5} min={0} max={2000}
              suffix="g" placeholder={String(autoMacros.fatG)} />
          </div>
        </div>

        {macroError && (
          <p className="nutri-field-hint" style={{ color: 'var(--rubric)', marginTop: 8 }}>{macroError}</p>
        )}

        <div className="nutri-macro-targets-foot">
          <span className="nutri-field-hint">
            {hasMacroOverride
              ? t('nutrify.macroTargetsOverride', 'Usando objetivos personalizados')
              : t('nutrify.macroTargetsAuto', 'Usando cálculo automático según tu objetivo')}
          </span>
          {hasMacroOverride && (
            <button type="button" className="nutri-btn nutri-btn-ghost nutri-btn-sm" onClick={handleResetMacros}>
              {t('nutrify.resetToAuto', 'Volver a automático')}
            </button>
          )}
        </div>
      </div>

      {/* ── Meal Schedule ── */}
      <div className="nutri-card">
        <HelpBubble text={t('nutrify.mealScheduleHelp', 'Horarios de cada comida. Al registrar un alimento, el sistema asigna el momento según la hora actual.')} />
        <h3 className="nutri-card-title">
          <span className="nutri-t-ico"><Chalice width={14} height={14} /></span> {t('nutrify.mealSchedule', 'Horario de comidas')}
          <span className="nutri-card-subtitle">{t('nutrify.mealScheduleDesc', 'Configurá los horarios de cada comida')}</span>
        </h3>
        <MealScheduleEditor schedule={mealSchedule} onChange={setMealSchedule} />
      </div>

      {/* ── Weight Reminder ── */}
      <div className="nutri-card">
        <HelpBubble text={t('nutrify.weightReminderHelp', 'Te recuerda pesarte el día configurado. Pesarte regularmente mejora la precisión del TDEE.')} />
        <h3 className="nutri-card-title">
          <span className="nutri-t-ico"><Scale width={14} height={14} /></span> {t('nutrify.weightReminderTitle', 'Recordatorio de Pesaje')}
        </h3>

        <div
          className={`nutri-check${weightPopupEnabled ? ' active' : ''}`}
          onClick={() => setWeightPopupEnabled(!weightPopupEnabled)}
          role="checkbox"
          aria-checked={weightPopupEnabled}
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setWeightPopupEnabled(!weightPopupEnabled); } }}
        >
          <div className="nutri-check-box">{weightPopupEnabled ? <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M2 6l3 3 5-5"/></svg> : null}</div>
          <div className="nutri-check-label">{t('nutrify.enableWeeklyReminder', 'Activar recordatorio semanal')}</div>
        </div>

        {weightPopupEnabled && (
          <div className="nutri-field" style={{ marginTop: 12 }}>
            <label className="nutri-label">{t('nutrify.weightCheckDay', 'Día de pesaje semanal')}</label>
            <select value={weightCheckDay} onChange={(e) => setWeightCheckDay(+e.target.value)} className="nutri-select">
              {[1, 2, 3, 4, 5, 6, 7].map(d => (
                <option key={d} value={d}>{t(`nutrify.weekdays.${d}`)}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* ── Save ── */}
      {saveError && (
        <p style={{ color: 'var(--rubric)', fontSize: 'var(--fs-label)', marginBottom: 8 }}>{saveError}</p>
      )}
      <button className="nutri-action-bar" onClick={handleSave} disabled={saving}>
        {saving ? t('common.loading') : saved ? <><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M2 6l3 3 5-5"/></svg>{' '}{t('nutrify.saved')}</> : t('nutrify.saveProfile')}
      </button>
    </div>
  );
}

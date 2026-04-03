import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../../shared/components/useToast';
import PageHeader from '../../../shared/components/PageHeader';
import CalorieProgressBar from './CalorieProgressBar';
import FoodLogItem from './FoodLogItem';
import NutritionOnboarding from './NutritionOnboarding';
import { todayDateString, formatDateString } from '../../../../shared/date-utils';
import RpgNumberInput from '../../../shared/components/RpgNumberInput';
import Checkbox from '../../../shared/components/Checkbox';
import { estimateNutrition } from '../estimate-service';
import { AnimatedNumber } from '../../finance/components/shared/AnimatedNumber';
import type { NutritionProfile } from '../types';

interface FoodEntry {
  id: number; date: string; time: string; description: string;
  calories: number; source: string; frequentFoodId: number | null;
}

interface FrequentFood { id: number; name: string; calories: number; timesUsed: number; }
interface DailySummary { date: string; totalCaloriesIn: number; bmr: number; tdee: number; balance: number; activityLevel?: string; }
interface DailyMetrics { date: string; steps: number | null; gym: boolean; }

interface EstimationResult {
  totalCalories: number;
  items: Array<{ name: string; calories: number }>;
  aiError?: string;
}

export default function Today() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [date, setDate] = useState(() => todayDateString());
  const [foods, setFoods] = useState<FoodEntry[]>([]);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [metrics, setMetrics] = useState<DailyMetrics>({ date: '', steps: null, gym: false });
  const [frequentFoods, setFrequentFoods] = useState<FrequentFood[]>([]);
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [target, setTarget] = useState(0);
  const [deficitTargetKcal, setDeficitTargetKcal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Close Day
  const [dayClosed, setDayClosed] = useState<{
    xpPrecision: number; xpSteps: number; xpGym: number; xpWeight: number;
    xpTotal: number; hpChange: number; consumed: number; target: number;
  } | null>(null);
  const [closeResult, setCloseResult] = useState<typeof dayClosed | null>(null);

  // Weight check-in popup
  const [weightPopup, setWeightPopup] = useState<{ show: boolean; lastWeight?: number }>({ show: false });
  const [weightInput, setWeightInput] = useState('');
  const [closeDayPopup, setCloseDayPopup] = useState(false);
  const [popupSteps, setPopupSteps] = useState('');
  const [popupGym, setPopupGym] = useState(false);

  // Unified food input
  const [foodInput, setFoodInput] = useState('');
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState('');
  const [estimation, setEstimation] = useState<EstimationResult | null>(null);
  const [editCalories, setEditCalories] = useState('');
  const [frequentSearch, setFrequentSearch] = useState('');
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [lastAddedId, setLastAddedId] = useState<number | null>(null);
  const { toast } = useToast();

  const loadData = useCallback(async (d: string) => {
    const [foodList, sum, met, freq, prof, tgt] = await Promise.all([
      window.api.nutritionGetFoodByDate(d),
      window.api.nutritionGetSummary(d),
      window.api.nutritionGetDailyMetrics(d),
      window.api.nutritionGetFrequentFoods(),
      window.api.nutritionGetProfile(),
      window.api.nutritionGetTodayTarget(),
    ]);
    setFoods(foodList as FoodEntry[]);
    setSummary(sum as DailySummary | null);
    setMetrics(met as DailyMetrics);
    setFrequentFoods(freq as FrequentFood[]);
    setHasProfile(!!prof);
    setTarget(tgt as number ?? 0);
    setDeficitTargetKcal((prof as NutritionProfile | null)?.deficitTargetKcal ?? 0);
    setCloseResult(null);
    setLoading(false);
    window.api.nutritionIsDayClosed(d).then((r) => setDayClosed(r as typeof dayClosed)).catch(console.error);
  }, []);

  useEffect(() => { loadData(date); }, [date, loadData]);

  // Auto-close past days that have food but weren't closed
  useEffect(() => {
    (async () => {
      const today = todayDateString();
      for (let i = 1; i <= 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const pastDate = formatDateString(d);
        if (pastDate >= today) continue;
        const closed = await window.api.nutritionIsDayClosed(pastDate);
        if (closed) continue;
        const foods = await window.api.nutritionGetFoodByDate(pastDate);
        if ((foods as unknown[]).length === 0) continue;
        // Auto-close this day
        const result = await window.api.nutritionCloseDay(pastDate);
        if (result.success && result.breakdown) {
          const b = result.breakdown as { xpTotal: number; hpChange: number };
          await window.api.processRpgEvent({
            type: 'DAY_SUMMARY', moduleId: 'nutrition',
            payload: { xp: b.xpTotal, hp: b.hpChange },
            timestamp: Date.now(),
          });
          window.dispatchEvent(new Event('rpg:statsChanged'));
        }
      }
    })();
  // Intentionally runs once on mount: auto-closes unclosed past days (up to 7 days back).
  // No reactive deps needed — uses only date arithmetic and IPC calls.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload when settings change or sync completes
  useEffect(() => {
    const handler = () => loadData(date);
    window.addEventListener('nutrition:settingsChanged', handler);
    window.addEventListener('sync:questsUpdated', handler);
    window.addEventListener('account:switched', handler);
    return () => {
      window.removeEventListener('nutrition:settingsChanged', handler);
      window.removeEventListener('sync:questsUpdated', handler);
      window.removeEventListener('account:switched', handler);
    };
  }, [date, loadData]);

  const goDay = (offset: number) => {
    const [y, m, d] = date.split('-').map(Number);
    const newDate = new Date(y, m - 1, d + offset);
    setDate(formatDateString(newDate));
  };

  // ── Unified estimation flow ──────────────────────
  const handleEstimate = async () => {
    if (!foodInput.trim() || estimating) return;
    setEstimating(true);
    setEstimation(null);
    setEstimateError('');
    try {
      const result = await estimateNutrition(foodInput.trim());
      setEstimation({ totalCalories: result.calories, items: result.items });
      setEditCalories(String(result.calories));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI estimation failed';
      setEstimateError(msg);
      console.error('[Nutrition]', err);
    } finally {
      setEstimating(false);
    }
  };

  const handleConfirmEstimation = async () => {
    if (!estimation) return;
    const calories = parseInt(editCalories) || estimation.totalCalories;

    await window.api.nutritionLogFood({
      date,
      description: foodInput.trim(),
      calories,
      source: 'ai_estimate',
    });

    await window.api.processRpgEvent({
      type: 'MEAL_LOGGED', moduleId: 'nutrition',
      payload: { xp: 10, hp: 0 }, timestamp: Date.now(),
    });

    toast({ type: 'nutri', message: `+${calories} kcal` });
    setFoodInput('');
    setEstimation(null);
    setEditCalories('');
    const updatedFoods = await window.api.nutritionGetFoodByDate(date) as FoodEntry[];
    if (updatedFoods.length > 0) setLastAddedId(Math.max(...updatedFoods.map(f => f.id)));
    loadData(date);
    window.dispatchEvent(new Event('rpg:statsChanged'));
  };

  // ── Quick log (frequent food) ────────────────────
  const handleLogFrequent = async (food: FrequentFood) => {
    await window.api.nutritionLogFood({
      date, description: food.name, calories: food.calories, source: 'frequent',
      frequentFoodId: food.id,
    });
    await window.api.nutritionIncrementFrequentUsage(food.id);
    await window.api.processRpgEvent({
      type: 'MEAL_LOGGED', moduleId: 'nutrition',
      payload: { xp: 10, hp: 0 }, timestamp: Date.now(),
    });
    toast({ type: 'nutri', message: `+${food.calories} kcal` });
    const updatedFoods = await window.api.nutritionGetFoodByDate(date) as FoodEntry[];
    if (updatedFoods.length > 0) setLastAddedId(Math.max(...updatedFoods.map(f => f.id)));
    loadData(date);
    window.dispatchEvent(new Event('rpg:statsChanged'));
  };

  const handleDelete = (id: number) => {
    setRemovingId(id);
    setTimeout(async () => {
      await window.api.nutritionDeleteFood(id);
      loadData(date);
      setRemovingId(null);
    }, 300);
  };

  const handleMetrics = async (field: string, value: unknown) => {
    const updated = { ...metrics, [field]: value, date };
    await window.api.nutritionSaveDailyMetrics(updated);
    loadData(date);
  };

  // Weight check-in: only when viewing today, re-check after sync restores profile
  useEffect(() => {
    if (!hasProfile || date !== todayDateString()) return;
    const dismissed = localStorage.getItem('hubtify_weight_dismiss_date');
    if (dismissed === todayDateString()) return;
    window.api.nutritionShouldAskWeight().then(result => {
      if (result.shouldAsk) {
        setWeightPopup({ show: true, lastWeight: result.lastWeight });
        if (result.lastWeight) setWeightInput(String(result.lastWeight));
      }
    }).catch(console.error);
  }, [date, hasProfile]);

  const [weightError, setWeightError] = useState('');
  const handleWeightSave = async () => {
    const kg = parseFloat(weightInput);
    if (!isFinite(kg) || kg < 30 || kg > 300) {
      setWeightError(t('nutrify.weightCheckin.invalid'));
      return;
    }
    setWeightError('');
    await window.api.nutritionSaveWeeklyMetrics({ weightKg: kg });
    setWeightPopup({ show: false });
  };

  const handleWeightDismiss = () => {
    localStorage.setItem('hubtify_weight_dismiss_date', todayDateString());
    setWeightPopup({ show: false });
  };

  const handleCloseDayConfirm = async () => {
    // Save metrics from popup before closing the day
    const stepsVal = popupSteps ? parseInt(popupSteps) : null;
    await window.api.nutritionSaveDailyMetrics({ ...metrics, steps: stepsVal, gym: popupGym, date });
    setCloseDayPopup(false);
    // Now close the day
    await doCloseDay();
  };

  const doCloseDay = async () => {
    const result = await window.api.nutritionCloseDay(date);
    if (result.success && result.breakdown) {
      const b = result.breakdown as typeof dayClosed;
      setCloseResult(b);
      const xp = b?.xpTotal ?? 0;
      const hp = b?.hpChange ?? 0;
      await window.api.processRpgEvent({
        type: 'DAY_SUMMARY', moduleId: 'nutrition',
        payload: { xp, hp },
        timestamp: Date.now(),
      });
      toast({ type: 'info', message: `+${xp} XP` });
      window.dispatchEvent(new Event('rpg:statsChanged'));
    } else if (result.alreadyClosed) {
      const closed = await window.api.nutritionIsDayClosed(date);
      setDayClosed(closed as typeof dayClosed);
    }
  };

  const consumed = summary?.totalCaloriesIn ?? foods.reduce((s, f) => s + f.calories, 0);
  const filteredFrequent = useMemo(() =>
    frequentFoods.filter((f) =>
      !frequentSearch || f.name.toLowerCase().includes(frequentSearch.toLowerCase())
    ), [frequentFoods, frequentSearch]);

  if (loading) return (
    <div>
      <PageHeader
        title={t('nutrify.title')}
        subtitle={t('nutrify.subtitle')}
        actions={
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="rpg-button" style={{ fontSize: '0.8rem', padding: '4px 10px' }} disabled>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H10a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V10c.26.6.77 1.02 1.51 1.08H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
              </svg>
            </button>
            <button className="rpg-button" style={{ fontSize: '0.8rem', padding: '4px 12px' }} disabled>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <rect x="1" y="7" width="3" height="6"/><rect x="5.5" y="4" width="3" height="9"/><rect x="10" y="1" width="3" height="12"/>
              </svg>
              {' '}{t('nutrify.charts')}
            </button>
          </div>
        }
      />
      {/* Date nav placeholder */}
      <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
        <div className="nutri-skeleton nutri-skeleton--text" style={{ width: 120 }} />
      </div>
      {/* Progress bar skeleton */}
      <div style={{ marginBottom: 16 }}>
        <div className="nutri-skeleton nutri-skeleton--text" style={{ marginBottom: 6 }} />
        <div className="nutri-skeleton nutri-skeleton--bar" />
      </div>
      {/* Food input skeleton */}
      <div className="rpg-card" style={{ marginBottom: 16 }}>
        <div className="nutri-skeleton nutri-skeleton--text" style={{ width: '40%', marginBottom: 12 }} />
        <div className="nutri-skeleton nutri-skeleton--bar" />
      </div>
      {/* Food log skeleton */}
      <div className="rpg-card">
        <div className="nutri-skeleton nutri-skeleton--text" style={{ width: '40%', marginBottom: 12 }} />
        {[1,2,3].map(i => (
          <div key={i} className="nutri-skeleton nutri-skeleton--text" style={{ marginBottom: 8 }} />
        ))}
      </div>
    </div>
  );
  if (hasProfile === null) return null;
  if (!hasProfile) return <NutritionOnboarding onComplete={() => loadData(date)} />;

  return (
    <div>
      <PageHeader
        title={t('nutrify.title')}
        subtitle={t('nutrify.subtitle')}
        actions={
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="rpg-button" onClick={() => navigate('/nutrition/settings')}
              style={{ fontSize: '0.8rem', padding: '4px 10px' }}
              aria-label={t('nutrify.profileSettings')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H10a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V10c.26.6.77 1.02 1.51 1.08H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
              </svg>
            </button>
            <button className="rpg-button" onClick={() => navigate('/nutrition/dashboard')}
              style={{ fontSize: '0.8rem', padding: '4px 12px' }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <rect x="1" y="7" width="3" height="6"/><rect x="5.5" y="4" width="3" height="9"/><rect x="10" y="1" width="3" height="12"/>
              </svg>
              {' '}{t('nutrify.charts')}
            </button>
          </div>
        }
      />

      {/* Date navigation */}
      <div data-anim="stagger-child" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <button className="rpg-button" onClick={() => goDay(-1)} style={{ padding: '6px 10px' }}
          aria-label="Previous day">
          <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 1L1 6l5 5M1 6h14"/>
          </svg>
        </button>
        <button className="rpg-button" onClick={() => setDate(todayDateString())}
          style={{ padding: '4px 8px', fontSize: '0.75rem', opacity: date === todayDateString() ? 0.5 : 1 }}>
          {t('nutrify.today')}
        </button>
        <h3 style={{ flex: 1, textAlign: 'center' }}>{date}</h3>
        <button className="rpg-button" onClick={() => goDay(1)}
          disabled={date >= todayDateString()}
          style={{ padding: '6px 10px', opacity: date >= todayDateString() ? 0.3 : 1 }}
          aria-label="Next day">
          <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 1l5 5-5 5M15 6H1"/>
          </svg>
        </button>
      </div>

      <div data-anim="stagger-child">
        <CalorieProgressBar consumed={consumed} tdee={summary?.tdee ?? 0} deficitTargetKcal={deficitTargetKcal} />
      </div>

      {/* ── Food input ──────────────────────────────── */}
      {!dayClosed && (
      <div data-anim="stagger-child">
      <div className="rpg-card" style={{ marginBottom: 16 }}>
        <div className="rpg-card-title" style={{ marginBottom: 6 }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.3" strokeLinecap="round">
            <path d="M8 1c-1 2-4 4-4 7a4 4 0 008 0c0-3-3-5-4-7z"/>
          </svg>
          {t('nutrify.logFood')}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            placeholder={t('nutrify.foodInputPlaceholder')}
            value={foodInput}
            onChange={(e) => setFoodInput(e.target.value)}
            className="rpg-input"
            style={{ flex: 1 }}
            onKeyDown={(e) => e.key === 'Enter' && !estimating && handleEstimate()}
          />
          <button className="rpg-button" onClick={handleEstimate}
            disabled={estimating || !foodInput.trim()}>
            {estimating ? t('common.loading') : t('nutrify.estimate')}
          </button>
        </div>

        {/* Error message */}
        {estimateError && (
          <div style={{ marginTop: 8, fontSize: '0.8rem', color: 'var(--rpg-hp-red)' }}>
            {estimateError}
          </div>
        )}

        {/* Estimation result */}
        {estimation && (
          <div style={{ marginTop: 12, padding: 12, border: '1px dashed var(--rpg-gold-dark)', borderRadius: 'var(--rpg-radius)', background: 'rgba(201,168,76,0.05)' }}>
            {estimation.items.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                {estimation.items.map((item, i) => (
                  <div key={i} style={{ fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid var(--rpg-parchment-dark)' }}>
                    <span>{item.name}</span>
                    <span style={{ fontFamily: 'Fira Code, monospace' }}><AnimatedNumber value={item.calories} prefix="" locale="es-AR" duration={400} /> kcal</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.9rem' }}>{t('nutrify.totalCalories')}:</span>
              <input
                type="number"
                value={editCalories}
                onChange={(e) => setEditCalories(e.target.value)}
                className="rpg-input"
                style={{ width: 80, fontFamily: 'Fira Code, monospace', fontWeight: 'bold', fontSize: '1rem', textAlign: 'center' }}
              />
              <span style={{ fontSize: '0.8rem', opacity: 0.5 }}>kcal</span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="rpg-button" onClick={handleConfirmEstimation} style={{ flex: 1 }}>
                {t('nutrify.confirmLog')}
              </button>
              <button className="rpg-button" onClick={() => { setEstimation(null); setEditCalories(''); }}
                style={{ opacity: 0.6 }}>
                {t('questify.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
      </div>
      )}

      {/* Food log */}
      <div>
      <div className="rpg-card" style={{ marginBottom: 16 }}>
        <div className="rpg-card-title">{t('nutrify.foodLog')}</div>
        {foods.length === 0 && <p style={{ opacity: 0.5, fontStyle: 'italic' }}>{t('nutrify.noFood')}</p>}
        {foods.map((f) => <FoodLogItem key={f.id} entry={f} isNew={lastAddedId === f.id} className="" readOnly={!!dayClosed} onDelete={handleDelete} onUpdate={async (id, fields) => {
          await window.api.nutritionUpdateFood(id, fields);
          loadData(date);
        }} />)}
      </div>
      </div>

      {/* Frequent foods */}
      {frequentFoods.length > 0 && (
        <div>
        <div className="rpg-card" style={{ marginBottom: 16 }}>
          <div className="rpg-card-title">{t('nutrify.frequentFoods')}</div>
          <input type="text" placeholder={t('common.search')} value={frequentSearch}
            onChange={(e) => setFrequentSearch(e.target.value)} className="rpg-input" style={{ width: '100%', marginBottom: 8 }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {filteredFrequent.slice(0, 12).map((f) => (
              <button key={f.id} className="rpg-button" onClick={() => handleLogFrequent(f)}
                style={{ fontSize: '0.8rem', padding: '4px 8px' }}>
                {f.name} ({f.calories})
              </button>
            ))}
          </div>
        </div>
        </div>
      )}


      {/* Close Day */}
      <div>
      <div className="rpg-card">
        <div className="rpg-card-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--rpg-gold-dark)" strokeWidth="1.3" strokeLinecap="round">
            <circle cx="8" cy="8" r="6"/><path d="M8 4v4l3 2"/>
          </svg>
          {t('nutrify.closeDay')}
        </div>

        {dayClosed ? (
          <div>
            <p style={{ fontSize: '0.85rem', opacity: 0.7, marginBottom: 10 }}>{t('nutrify.dayClosed')}</p>
            <DayBreakdown data={dayClosed} t={t} />
          </div>
        ) : closeResult ? (
          <div>
            <p style={{ fontSize: '0.9rem', color: 'var(--rpg-xp-green)', marginBottom: 10, fontWeight: 'bold' }}>
              {t('nutrify.dayClosedSuccess')}
            </p>
            <DayBreakdown data={closeResult} t={t} />
          </div>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '0.85rem', opacity: 0.6, marginBottom: 10 }}>
              {t('nutrify.closeDayDesc')}
            </p>
            <button className="rpg-button" onClick={() => setCloseDayPopup(true)}
              disabled={consumed === 0}
              style={{ padding: '8px 24px' }}>
              {t('nutrify.closeDayButton')}
            </button>
          </div>
        )}
      </div>
      </div>

      {/* Weight check-in popup */}
      {weightPopup.show && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(44, 24, 16, 0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: 'linear-gradient(135deg, var(--rpg-wood) 0%, var(--rpg-leather) 100%)',
            border: '2px solid var(--rpg-gold-dark)',
            borderRadius: 'var(--rpg-radius)', padding: '24px', maxWidth: 340,
            textAlign: 'center', color: 'var(--rpg-parchment)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          }}>
            <h3 style={{ fontFamily: 'Cinzel, serif', marginBottom: 12, color: 'var(--rpg-gold-light)' }}>
              {t('nutrify.weightCheckin.title')}
            </h3>
            {weightPopup.lastWeight && (
              <p style={{ fontSize: '0.8rem', opacity: 0.6, marginBottom: 12 }}>
                {t('nutrify.weightCheckin.lastWeight', { weight: weightPopup.lastWeight })}
              </p>
            )}
            <RpgNumberInput
              value={weightInput}
              onChange={setWeightInput}
              step={0.1} min={30} max={300}
              suffix="kg"
              fontSize="1.2rem"
              autoFocus
              style={{ marginBottom: 16 }}
            />
            {weightError && (
              <p style={{ color: 'var(--rpg-hp-red)', fontSize: '0.8rem', marginBottom: 8 }}>{weightError}</p>
            )}
            <button className="rpg-button" onClick={handleWeightSave} style={{ width: '100%', marginBottom: 8 }}>
              {t('nutrify.weightCheckin.save')}
            </button>
            <button onClick={handleWeightDismiss} className="rpg-button"
              style={{ width: '100%', padding: '4px 8px', fontSize: '0.75rem', background: 'transparent', border: '1px solid var(--rpg-gold-dark)', color: 'var(--rpg-gold)' }}>
              {t('nutrify.weightCheckin.later')}
            </button>
          </div>
        </div>
      )}

      {/* Close day popup */}
      {closeDayPopup && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(44, 24, 16, 0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: 'linear-gradient(135deg, var(--rpg-wood) 0%, var(--rpg-leather) 100%)',
            border: '2px solid var(--rpg-gold-dark)',
            borderRadius: 'var(--rpg-radius)', padding: '24px', maxWidth: 340,
            textAlign: 'center', color: 'var(--rpg-parchment)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          }}>
            <h3 style={{ fontFamily: 'Cinzel, serif', marginBottom: 16, color: 'var(--rpg-gold-light)' }}>
              {t('nutrify.closeDay')}
            </h3>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginBottom: 12, fontSize: '0.9rem' }}>
              <span>{t('nutrify.steps')}</span>
              <RpgNumberInput
                value={popupSteps}
                onChange={setPopupSteps}
                step={100} min={0} max={99999}
                style={{ width: 120 }}
                autoFocus
              />
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginBottom: 20, fontSize: '0.9rem', cursor: 'pointer' }}
              onClick={() => setPopupGym(!popupGym)}>
              <Checkbox checked={popupGym} onChange={() => setPopupGym(!popupGym)} />
              <span>{t('nutrify.gym')}</span>
            </div>
            <button className="rpg-button" onClick={handleCloseDayConfirm} style={{ width: '100%', marginBottom: 8 }}>
              {t('nutrify.closeDayButton')}
            </button>
            <button onClick={() => setCloseDayPopup(false)} className="rpg-button"
              style={{ width: '100%', padding: '4px 8px', fontSize: '0.75rem', background: 'transparent', border: '1px solid var(--rpg-gold-dark)', color: 'var(--rpg-gold)' }}>
              {t('questify.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DayBreakdown({ data, t }: { data: { xpPrecision: number; xpSteps: number; xpGym: number; xpWeight: number; xpTotal: number; hpChange: number; consumed: number; target: number }; t: (key: string) => string }) {
  const rows = [
    { label: t('nutrify.xpPrecision'), value: data.xpPrecision, desc: `${data.consumed} / ${data.target} kcal` },
    { label: t('nutrify.xpSteps'), value: data.xpSteps },
    { label: t('nutrify.xpGym'), value: data.xpGym },
    { label: t('nutrify.xpWeight'), value: data.xpWeight },
  ];

  return (
    <div>
      {rows.map((row) => (
        <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--rpg-parchment-dark)', fontSize: '0.85rem' }}>
          <span>
            {row.label}
            {row.desc && <span style={{ opacity: 0.5, marginLeft: 6, fontSize: '0.8rem' }}>({row.desc})</span>}
          </span>
          <span style={{ fontFamily: 'Fira Code, monospace', color: row.value > 0 ? 'var(--rpg-xp-green)' : 'var(--rpg-ink-light)' }}>
            +{row.value} XP
          </span>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '0.9rem', fontWeight: 'bold', marginTop: 4 }}>
        <span>Total</span>
        <span style={{ fontFamily: 'Fira Code, monospace' }}>
          <span style={{ color: 'var(--rpg-xp-green)' }}>+{data.xpTotal} XP</span>
          {data.hpChange !== 0 && (
            <span style={{ color: data.hpChange > 0 ? 'var(--rpg-xp-green)' : 'var(--rpg-hp-red)', marginLeft: 8 }}>
              {data.hpChange > 0 ? '+' : ''}{data.hpChange} HP
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

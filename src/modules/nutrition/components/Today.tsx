import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../../shared/components/useToast';
import { useConfirm } from '../../../shared/components/ConfirmDialog';
import { CircularProgress } from '../../../shared/components/charts';
import FoodLogItem from './FoodLogItem';
import NutritionOnboarding from './NutritionOnboarding';
import { todayDateString, formatDateString } from '../../../../shared/date-utils';
import RpgNumberInput from '../../../shared/components/RpgNumberInput';
import Checkbox from '../../../shared/components/Checkbox';
import { estimateNutrition } from '../estimate-service';
import { AnimatedNumber } from '../../finance/components/shared/AnimatedNumber';
import HelpBubble from '../../../shared/components/HelpBubble';
import { DawnSun, NoonSun, MoonCrescent, Herb, Heart, Quill, Scroll, Platter } from '../../../shared/components/icons';
import { resolveMealType, MEAL_ORDER as SHARED_MEAL_ORDER, DEFAULT_MEAL_SCHEDULE } from '../../../../shared/meal-utils';
import type { MealSchedule, MealType } from '../../../../shared/meal-utils';
import type { TFunction } from 'i18next';
import type { NutritionProfile } from '../types';

type Goal = 'deficit' | 'maintain' | 'surplus';

function getGoal(deficitTargetKcal: number): Goal {
  if (deficitTargetKcal > 0) return 'deficit';
  if (deficitTargetKcal < 0) return 'surplus';
  return 'maintain';
}

function getStatusMessage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: TFunction<any, any>,
  goal: Goal,
  consumed: number,
  target: number,
  tdee: number,
): { text: string; tone: 'good' | 'warn' | 'bad' | 'muted' } {
  const pct = target > 0 ? consumed / target : 0;

  // Over TDEE — always bad regardless of goal
  if (tdee > 0 && consumed > tdee && goal !== 'surplus') {
    return { text: t(`nutrify.status.${goal}.over`), tone: 'bad' };
  }

  if (goal === 'deficit') {
    if (consumed > target) return { text: t('nutrify.status.deficit.warning'), tone: 'warn' };
    if (pct >= 0.85) return { text: t('nutrify.status.deficit.close'), tone: 'muted' };
    if (pct >= 0.5) return { text: t('nutrify.status.deficit.good'), tone: 'good' };
    return { text: t('nutrify.status.deficit.early'), tone: 'muted' };
  }

  if (goal === 'surplus') {
    if (consumed > target) return { text: t('nutrify.status.surplus.over'), tone: 'bad' };
    if (pct >= 0.85) return { text: t('nutrify.status.surplus.close'), tone: 'good' };
    if (pct >= 0.5) return { text: t('nutrify.status.surplus.good'), tone: 'muted' };
    return { text: t('nutrify.status.surplus.early'), tone: 'muted' };
  }

  // maintain
  if (consumed > target) return { text: t('nutrify.status.maintain.over'), tone: 'bad' };
  if (pct >= 0.85) return { text: t('nutrify.status.maintain.good'), tone: 'good' };
  if (pct >= 0.5) return { text: t('nutrify.status.maintain.onTrack'), tone: 'muted' };
  return { text: t('nutrify.status.maintain.early'), tone: 'muted' };
}

interface FoodEntry {
  id: number; date: string; time: string; description: string;
  calories: number; source: string; frequentFoodId: number | null;
  aiBreakdown?: string | null;
  meal?: string | null;
}

interface FavoriteFood { id: string; description: string; calories: number; source: string; aiBreakdown?: string; createdAt: string; updatedAt?: string; }
interface FrequentFood { id: number; name: string; calories: number; timesUsed: number; }
interface DailySummary { date: string; totalCaloriesIn: number; bmr: number; tdee: number; balance: number; activityLevel?: string; }
interface DailyMetrics { date: string; steps: number | null; gym: boolean; }

const MEAL_ICON: Record<MealType, React.ReactNode> = {
  breakfast: <DawnSun width={18} height={18} />,
  lunch: <NoonSun width={18} height={18} />,
  dinner: <MoonCrescent width={18} height={18} />,
  snack: <Herb width={18} height={18} />,
};

interface EstimationResult {
  totalCalories: number;
  items: Array<{ name: string; calories: number }>;
  aiError?: string;
}

export default function Today() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
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
    xpBonus: number; xpTotal: number; hpChange: number; consumed: number; target: number;
  } | null>(null);
  const [closeResult, setCloseResult] = useState<typeof dayClosed | null>(null);

  // Weight check-in popup
  const [weightPopup, setWeightPopup] = useState<{ show: boolean; lastWeight?: number }>({ show: false });
  const [weightInput, setWeightInput] = useState('');
  const [closeDayPopup, setCloseDayPopup] = useState(false);
  const [popupSteps, setPopupSteps] = useState('');
  const [popupGym, setPopupGym] = useState(false);
  const [pendingDays, setPendingDays] = useState<string[]>([]);

  // Unified food input
  const [foodInput, setFoodInput] = useState('');
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState('');
  const [estimation, setEstimation] = useState<EstimationResult | null>(null);
  const [editCalories, setEditCalories] = useState('');
  const [favoriteFoods, setFavoriteFoods] = useState<FavoriteFood[]>([]);
  const [showFavorites, setShowFavorites] = useState(false);
  const [frequentSearch, setFrequentSearch] = useState('');
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [lastAddedId, setLastAddedId] = useState<number | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualCalories, setManualCalories] = useState('');
  const [mealSchedule, setMealSchedule] = useState<MealSchedule>(DEFAULT_MEAL_SCHEDULE);
  const { toast } = useToast();
  const confirm = useConfirm();

  const loadData = useCallback(async (d: string) => {
    const [foodList, sum, met, freq, prof, tgt, closedDay, favorites, schedule] = await Promise.all([
      window.api.nutritionGetFoodByDate(d),
      window.api.nutritionGetSummary(d),
      window.api.nutritionGetDailyMetrics(d),
      window.api.nutritionGetFrequentFoods(),
      window.api.nutritionGetProfile(),
      window.api.nutritionGetTodayTarget(),
      window.api.nutritionIsDayClosed(d),
      window.api.nutritionGetFavoriteFoods(),
      window.api.nutritionGetMealSchedule(),
    ]);
    setFoods(foodList as FoodEntry[]);
    setSummary(sum as DailySummary | null);
    setMetrics(met as DailyMetrics);
    setFrequentFoods(freq as FrequentFood[]);
    setFavoriteFoods(favorites as FavoriteFood[]);
    setMealSchedule((schedule as MealSchedule) ?? DEFAULT_MEAL_SCHEDULE);
    setHasProfile(!!prof);
    setDeficitTargetKcal((prof as NutritionProfile | null)?.deficitTargetKcal ?? 0);
    setCloseResult(null);

    const closed = closedDay as typeof dayClosed;
    setDayClosed(closed);

    const isPastDate = d < todayDateString();
    const deficitKcal = (prof as NutritionProfile | null)?.deficitTargetKcal ?? 0;
    if (isPastDate && closed?.target) {
      setTarget(closed.target);
    } else if (isPastDate && (sum as DailySummary | null)?.tdee) {
      setTarget((sum as DailySummary).tdee - deficitKcal);
    } else {
      setTarget(tgt as number ?? 0);
    }

    setLoading(false);
  }, []);

  useEffect(() => { loadData(date); }, [date, loadData]);

  useEffect(() => {
    setCloseDayPopup(false);
  }, [date]);

  const loadPendingDays = useCallback(async () => {
    const days = await window.api.nutritionGetPendingDays();
    setPendingDays(days);
  }, []);

  useEffect(() => {
    loadPendingDays();
  }, [date, loadPendingDays]);

  // Reload when settings change or sync completes
  useEffect(() => {
    const handler = () => {
      loadData(date);
      loadPendingDays();
    };
    window.addEventListener('nutrition:settingsChanged', handler);
    window.addEventListener('sync:nutritionUpdated', handler);
    window.addEventListener('account:switched', handler);
    return () => {
      window.removeEventListener('nutrition:settingsChanged', handler);
      window.removeEventListener('sync:nutritionUpdated', handler);
      window.removeEventListener('account:switched', handler);
    };
  }, [date, loadData, loadPendingDays]);

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
      toast({ type: 'warning', message: t('nutrify.estimateFailed', 'Estimation failed. Try manual entry.') });
      setManualMode(true);
    } finally {
      setEstimating(false);
    }
  };

  const handleConfirmEstimation = async () => {
    if (!estimation) return;
    const calories = parseInt(editCalories) || estimation.totalCalories;
    if (calories <= 0) {
      toast({ type: 'warning', message: t('nutrify.invalidCalories', 'Las calorías deben ser mayores a 0') });
      return;
    }

    try {
      const resolved = resolveMealType(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), mealSchedule);
      await window.api.nutritionLogFood({
        date,
        description: foodInput.trim(),
        calories,
        source: 'ai_estimate',
        aiBreakdown: estimation.items.length > 1 ? JSON.stringify(estimation.items) : undefined,
        meal: resolved.ambiguous.length === 0 ? resolved.meal : undefined,
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
    } catch (err) {
      console.error('[Nutrition] confirmEstimation error:', err);
      toast({ type: 'warning', message: t('nutrify.logError', 'Error al registrar comida') });
    }
  };

  // ── Manual calorie entry ────────────────────────
  const handleManualAdd = async () => {
    const cal = parseInt(manualCalories);
    if (!foodInput.trim() || isNaN(cal) || cal <= 0) return;
    try {
      const resolved = resolveMealType(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), mealSchedule);
      await window.api.nutritionLogFood({
        date,
        description: foodInput.trim(),
        calories: cal,
        source: 'manual',
        meal: resolved.ambiguous.length === 0 ? resolved.meal : undefined,
      });

      await window.api.processRpgEvent({
        type: 'MEAL_LOGGED', moduleId: 'nutrition',
        payload: { xp: 10, hp: 0 }, timestamp: Date.now(),
      });

      toast({ type: 'nutri', message: `+${cal} kcal` });
      setFoodInput('');
      setManualCalories('');
      const updatedFoods = await window.api.nutritionGetFoodByDate(date) as FoodEntry[];
      if (updatedFoods.length > 0) setLastAddedId(Math.max(...updatedFoods.map(f => f.id)));
      loadData(date);
      window.dispatchEvent(new Event('rpg:statsChanged'));
    } catch (err) {
      console.error('[Nutrition] manualAdd error:', err);
      toast({ type: 'warning', message: t('nutrify.logError', 'Error al registrar comida') });
    }
  };

  // ── Quick log (frequent food) ────────────────────
  const handleLogFrequent = async (food: FrequentFood) => {
    try {
      const resolved = resolveMealType(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), mealSchedule);
      await window.api.nutritionLogFood({
        date, description: food.name, calories: food.calories, source: 'frequent',
        frequentFoodId: food.id,
        meal: resolved.ambiguous.length === 0 ? resolved.meal : undefined,
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
    } catch (err) {
      console.error('[Nutrition] logFrequent error:', err);
      toast({ type: 'warning', message: t('nutrify.logError', 'Error al registrar comida') });
    }
  };

  const handleLogFavorite = async (food: FavoriteFood) => {
    try {
      const resolved = resolveMealType(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), mealSchedule);
      await window.api.nutritionLogFood({
        date, description: food.description, calories: food.calories, source: 'favorite',
        aiBreakdown: food.aiBreakdown || undefined,
        meal: resolved.ambiguous.length === 0 ? resolved.meal : undefined,
      });
      await window.api.processRpgEvent({
        type: 'MEAL_LOGGED', moduleId: 'nutrition',
        payload: { xp: 10, hp: 0 }, timestamp: Date.now(),
      });
      toast({ type: 'nutri', message: `+${food.calories} kcal` });
      const updatedFoods = await window.api.nutritionGetFoodByDate(date) as FoodEntry[];
      if (updatedFoods.length > 0) setLastAddedId(Math.max(...updatedFoods.map(f => f.id)));
      loadData(date);
      window.dispatchEvent(new Event('rpg:statsChanged'));
    } catch (err) {
      console.error('[Nutrition] logFavorite error:', err);
      toast({ type: 'warning', message: t('nutrify.logError', 'Error al registrar comida') });
    }
  };

  const handleAddFavorite = async (description: string, calories: number, source?: string, aiBreakdown?: string) => {
    try {
      await window.api.nutritionAddFavoriteFood({ description, calories, source, aiBreakdown });
      toast({ type: 'nutri', message: t('nutrify.favoriteSaved', 'Guardado en favoritos') });
      const favorites = await window.api.nutritionGetFavoriteFoods();
      setFavoriteFoods(favorites as FavoriteFood[]);
    } catch (err) {
      console.error('[Nutrition] addFavorite error:', err);
      toast({ type: 'warning', message: t('nutrify.logError', 'Error al registrar comida') });
    }
  };

  const handleRemoveFavorite = async (id: string) => {
    try {
      await window.api.nutritionRemoveFavoriteFood(id);
      toast({ type: 'info', message: t('nutrify.favoriteRemoved', 'Favorito eliminado') });
      const favorites = await window.api.nutritionGetFavoriteFoods();
      setFavoriteFoods(favorites as FavoriteFood[]);
    } catch (err) {
      console.error('[Nutrition] removeFavorite error:', err);
      toast({ type: 'warning', message: t('nutrify.logError', 'Error al registrar comida') });
    }
  };

  const handleMealChange = async (id: number, meal: string) => {
    try {
      await window.api.nutritionUpdateFood(id, { meal });
      loadData(date);
    } catch (err) {
      console.error('[Nutrify] meal change failed', err);
    }
  };

  const handleDelete = (id: number) => {
    setRemovingId(id);
    setTimeout(async () => {
      try {
        await window.api.nutritionDeleteFood(id);
        loadData(date);
      } catch (err) {
        console.error('[Nutrify] delete failed', err);
      } finally {
        setRemovingId(null);
      }
    }, 300);
  };

  const handleDeleteDay = async () => {
    const ok = await confirm({
      message: t('nutrify.deleteDayConfirm', '¿Eliminar todas las comidas de este día?'),
      confirmText: t('nutrify.deleteDayButton', 'Eliminar día'),
      danger: true,
    });
    if (!ok) return;
    try {
      await window.api.nutritionDeleteByDate(date);
      toast({ type: 'info', message: t('nutrify.deleteDaySuccess', 'Comidas del día eliminadas') });
      loadData(date);
    } catch (err) {
      console.error('[Nutrition] deleteDay error:', err);
      toast({ type: 'warning', message: t('nutrify.deleteDayError', 'Error al eliminar comidas') });
    }
  };

  const handleMetrics = async (field: string, value: unknown) => {
    const updated = { ...metrics, [field]: value, date };
    await window.api.nutritionSaveDailyMetrics(updated);
    loadData(date);
  };

  // Weight check-in: only when viewing today, re-check after sync restores profile
  useEffect(() => {
    if (!hasProfile || date !== todayDateString()) return;
    if (localStorage.getItem('hubtify_notifications_module_nutrition') === 'false') return;
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
    try {
      await window.api.nutritionSaveWeeklyMetrics({ weightKg: kg });
      setWeightPopup({ show: false });
    } catch (err) {
      console.error('[Nutrify] weight save failed', err);
      setWeightError(t('nutrify.weightCheckin.saveFailed', 'Error saving weight'));
    }
  };

  const handleWeightDismiss = () => {
    localStorage.setItem('hubtify_weight_dismiss_date', todayDateString());
    setWeightPopup({ show: false });
  };

  const handleCloseDayConfirm = async () => {
    try {
      const stepsVal = popupSteps ? parseInt(popupSteps) : null;
      await window.api.nutritionSaveDailyMetrics({ ...metrics, steps: stepsVal, gym: popupGym, date });
      setCloseDayPopup(false);
      await doCloseDay();
      loadPendingDays();
    } catch {
      toast({ type: 'warning', message: t('nutrify.closeDayError', 'Error al confirmar el día') });
    }
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

  const mealGroups = useMemo(() => {
    const groups: Record<MealType, { foods: FoodEntry[]; calories: number }> = {
      breakfast: { foods: [], calories: 0 },
      lunch: { foods: [], calories: 0 },
      dinner: { foods: [], calories: 0 },
      snack: { foods: [], calories: 0 },
    };
    for (const f of foods) {
      const meal = (f.meal as MealType) ?? resolveMealType(f.time, mealSchedule).meal;
      groups[meal].foods.push(f);
      groups[meal].calories += f.calories;
    }
    return SHARED_MEAL_ORDER
      .filter(m => mealSchedule[m].enabled || groups[m].foods.length > 0)
      .filter(m => groups[m].foods.length > 0)
      .map(m => ({ type: m, ...groups[m] }));
  }, [foods, mealSchedule]);

  const mealI18n: Record<MealType, string> = {
    breakfast: t('nutrify.mealBreakfast', 'Desayuno'),
    lunch: t('nutrify.mealLunch', 'Almuerzo'),
    dinner: t('nutrify.mealDinner', 'Cena'),
    snack: t('nutrify.mealSnack', 'Snack'),
  };

  const pendingBeforeCount = pendingDays.filter(d => d < date).length;
  const isToday = date === todayDateString();
  const isPending = pendingDays.includes(date);

  const toleranceLow = Math.round(target * 0.95);
  const toleranceHigh = Math.round(target * 1.05);
  const inRange = consumed >= toleranceLow && consumed <= toleranceHigh;

  const remaining = target - consumed;
  const progressPct = target > 0 ? Math.min(100, Math.round((consumed / target) * 100)) : 0;

  // Day name for date pill
  const dateDayName = useMemo(() => {
    const [y, m, d] = date.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    return dateObj.toLocaleDateString(i18n.language === 'en' ? 'en-US' : 'es-AR', { weekday: 'long' });
  }, [date, i18n.language]);

  if (loading) return (
    <div className="nutri-page">
      <div className="nutri-page-head">
        <div>
          <h1 className="nutri-page-title">
            <span className="nutri-title-ico"><Herb width={16} height={16} /></span> NUTRIFY
          </h1>
        </div>
        <div className="nutri-head-actions">
          <button className="nutri-btn nutri-icon-only" disabled>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H10a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V10c.26.6.77 1.02 1.51 1.08H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
            </svg>
          </button>
          <button className="nutri-btn" disabled>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <rect x="1" y="7" width="3" height="6"/><rect x="5.5" y="4" width="3" height="9"/><rect x="10" y="1" width="3" height="12"/>
            </svg>
            {' '}{t('nutrify.charts', 'Gráficos')}
          </button>
        </div>
      </div>
      {/* Skeleton placeholders */}
      <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
        <div className="nutri-skeleton nutri-skeleton--text" style={{ width: 120 }} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <div className="nutri-skeleton nutri-skeleton--text" style={{ marginBottom: 6 }} />
        <div className="nutri-skeleton nutri-skeleton--bar" />
      </div>
      <div className="nutri-card" style={{ marginBottom: 16 }}>
        <div className="nutri-skeleton nutri-skeleton--text" style={{ width: '40%', marginBottom: 12 }} />
        <div className="nutri-skeleton nutri-skeleton--bar" />
      </div>
      <div className="nutri-card">
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
    <div className="nutri-page" data-tour="nutrition">
      {/* ── Page Header ─────────────────────────────── */}
      <div className="nutri-page-head">
        <div>
          <h1 className="nutri-page-title">
            <span className="nutri-title-ico"><Herb width={16} height={16} /></span> NUTRIFY
          </h1>
          <div className="nutri-page-sub">{t('nutrify.subtitle', 'Rastrea tu consumo diario')}</div>
        </div>
        <div className="nutri-head-actions">
          <button className="nutri-btn nutri-icon-only" onClick={() => navigate('/nutrition/settings')}
            aria-label={t('nutrify.profileSettings', 'Configuración')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H10a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V10c.26.6.77 1.02 1.51 1.08H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
            </svg>
          </button>
          <button className="nutri-btn" onClick={() => navigate('/nutrition/dashboard')}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <rect x="1" y="7" width="3" height="6"/><rect x="5.5" y="4" width="3" height="9"/><rect x="10" y="1" width="3" height="12"/>
            </svg>
            {' '}{t('nutrify.charts', 'Gráficos')}
          </button>
        </div>
      </div>

      {/* ── Hero: Daily Calories ────────────────────── */}
      <div className="nutri-hero">
        <div className="nutri-hero-card">
          <HelpBubble text={t('nutrify.todayHelp', 'Tu balance nutricional del día: calorías consumidas vs objetivo y desglose de macros.')} />
          {/* Date bar */}
          <div className="nutri-date-bar">
            <button className="nutri-day-btn" onClick={() => goDay(-1)}
              aria-label={`${t('nutrify.prevDay', 'Día anterior')}${pendingBeforeCount > 0 ? `, ${pendingBeforeCount} ${t('nutrify.pendingConfirmation', 'pendientes')}` : ''}`}>
              {'\u2039'}
              {pendingBeforeCount > 0 && (
                <span className="nutri-pending-badge">{pendingBeforeCount}</span>
              )}
            </button>
            <button
              className={`nutri-date-pill${dayClosed ? ' nutri-date-pill--closed' : ''}`}
              onClick={() => !isToday && setDate(todayDateString())}
              disabled={isToday}
            >
              {dayClosed && (
                <svg className="nutri-closed-ico" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="8" width="10" height="7" rx="1"/><path d="M5 8V5a3 3 0 0 1 6 0v3"/>
                </svg>
              )}
              {isToday ? t('nutrify.today', 'Hoy') : `${date} \u00B7 ${dateDayName}`}
            </button>
            <button className="nutri-day-btn" onClick={() => goDay(1)}
              disabled={date >= todayDateString()}
              style={{ opacity: date >= todayDateString() ? 0.3 : 1 }}
              aria-label={t('nutrify.nextDay', 'Día siguiente')}>
              {'\u203A'}
            </button>
          </div>

          {isPending && (
            <div className="nutri-pending-banner">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="8" cy="8" r="7"/><path d="M8 5v3"/><circle cx="8" cy="11" r="0.5" fill="currentColor"/>
              </svg>
              {t('nutrify.pendingConfirmation', 'Pendiente de confirmar')}
            </div>
          )}

          {/* Calorie main: ring + details */}
          <div className="nutri-cal-main">
            <div className="nutri-cal-ring">
              <CircularProgress
                value={consumed}
                max={target}
                radius={58}
                strokeWidth={10}
                gradientStart={consumed > toleranceHigh ? '#a43030' : inRange ? '#5a7a3a' : '#c4a84e'}
                gradientEnd={consumed > toleranceHigh ? '#7a1e1e' : inRange ? '#3a5a2a' : '#8a7030'}
              >
                <div className="nutri-ring-center">
                  <div className="nutri-ring-val"><AnimatedNumber value={consumed} prefix="" locale={i18n.language === 'en' ? 'en-US' : 'es-AR'} duration={400} /></div>
                  <div className="nutri-ring-unit">kcal</div>
                  <div className="nutri-ring-sub">{toleranceLow} – {toleranceHigh}</div>
                </div>
              </CircularProgress>
            </div>

            <div className="nutri-cal-details">
              <div className="nutri-cal-row">
                <span className="nutri-cal-label">{t('nutrify.remaining', 'Restantes')}</span>
                <span className={`nutri-cal-val ${inRange ? 'nutri-green' : remaining >= 0 ? '' : 'nutri-red'}`}>
                  {remaining >= 0 ? remaining : `+${Math.abs(remaining)}`} kcal
                </span>
              </div>
              <div className="nutri-cal-row">
                <span className="nutri-cal-label">{t('nutrify.target', 'Objetivo')}<HelpBubble text={t('nutrify.targetHelp', 'Tu objetivo se ajusta según tu nivel de actividad base y tu actividad reciente (gym, pasos) de los últimos 14 días.')} /></span>
                <span className="nutri-cal-val">
                  {toleranceLow} – {toleranceHigh} kcal
                  {deficitTargetKcal !== 0 && (
                    <span className="nutri-cal-hint">
                      {' '}{'\u00B7'} {deficitTargetKcal > 0 ? `${t('nutrify.goal_deficit', 'déficit').toLowerCase()} -${deficitTargetKcal}` : `${t('nutrify.goal_surplus', 'superávit').toLowerCase()} +${Math.abs(deficitTargetKcal)}`}
                    </span>
                  )}
                </span>
              </div>
              <div className="nutri-cal-row">
                <span className="nutri-cal-label">{t('nutrify.progress', 'Progreso')}</span>
                <span className="nutri-cal-val nutri-cal-pct">{progressPct}%</span>
              </div>
            </div>
          </div>

          {/* Status message */}
          {(() => {
            const goal = getGoal(deficitTargetKcal);
            const tdee = summary?.tdee ?? 0;
            const status = getStatusMessage(t, goal, consumed, target, tdee);
            return (
              <p className={`nutri-status-message nutri-status--${status.tone}`}>
                {status.text}
              </p>
            );
          })()}
        </div>
      </div>

      {/* ── Food input ──────────────────────────────── */}
      {!dayClosed && (
        <div className="nutri-card">
          <HelpBubble text={t('nutrify.logFoodHelp', 'Describí lo que comiste en lenguaje natural y la IA estimará las calorías. Podés editar antes de confirmar.')} />
          <h3 className="nutri-card-title">
            <span className="nutri-t-ico"><Quill width={14} height={14} /></span>
            {t('nutrify.logFood', 'Registrar Comida')}
          </h3>

          <div className="nutri-input-mode-toggle">
            <button
              type="button"
              className={`nutri-mode-btn ${!manualMode ? 'active' : ''}`}
              onClick={() => setManualMode(false)}
            >
              {t('nutrify.aiMode', 'Estimación IA')}
            </button>
            <button
              type="button"
              className={`nutri-mode-btn ${manualMode ? 'active' : ''}`}
              onClick={() => setManualMode(true)}
            >
              {t('nutrify.manualMode', 'Manual')}
            </button>
          </div>

          {manualMode ? (
            <div className="nutri-manual-inputs">
              <input
                className="nutri-text-input"
                type="text"
                placeholder={t('nutrify.foodInputPlaceholder', '¿Qué comiste? ej: milanesa con papas fritas')}
                value={foodInput}
                onChange={(e) => setFoodInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && foodInput.trim() && manualCalories && handleManualAdd()}
              />
              <RpgNumberInput
                value={manualCalories}
                onChange={setManualCalories}
                step={10} min={0} max={9999}
                placeholder={t('nutrify.calories', 'Calorías')}
                onKeyDown={(e) => e.key === 'Enter' && foodInput.trim() && manualCalories && handleManualAdd()}
                style={{ width: 130, flexShrink: 0 }}
              />
              <button
                className="nutri-btn"
                onClick={handleManualAdd}
                disabled={!foodInput.trim() || !manualCalories}
              >
                {t('nutrify.add', 'Agregar')}
              </button>
            </div>
          ) : (
            <>
              <div className="nutri-food-input-row">
                <input
                  type="text"
                  placeholder={t('nutrify.foodInputPlaceholder', '¿Qué comiste? ej: milanesa con papas fritas')}
                  value={foodInput}
                  onChange={(e) => setFoodInput(e.target.value)}
                  className="nutri-text-input"
                  onKeyDown={(e) => e.key === 'Enter' && !estimating && handleEstimate()}
                />
                <button className="nutri-btn" onClick={handleEstimate}
                  disabled={estimating || !foodInput.trim()}>
                  {estimating ? t('common.loading', 'Cargando...') : t('nutrify.estimate', 'Estimar')}
                </button>
              </div>

              {/* Error message */}
              {estimateError && (
                <div className="nutri-estimate-error">{estimateError}</div>
              )}

              {/* Estimation result */}
              {estimation && (
                <div className="nutri-estimation">
                  {estimation.items.length > 0 && (
                    <div className="nutri-est-items">
                      {estimation.items.map((item, i) => (
                        <div key={i} className="nutri-est-item">
                          <span className="nutri-food-name">{item.name}</span>
                          <span className="nutri-food-kcal"><AnimatedNumber value={item.calories} prefix="" locale={i18n.language === 'en' ? 'en-US' : 'es-AR'} duration={400} /> kcal</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="nutri-est-total">
                    <span className="nutri-est-total-label">{t('nutrify.totalCalories', 'Total')}:</span>
                    <div className="nutri-est-total-input">
                      <input
                        type="number"
                        value={editCalories}
                        onChange={(e) => setEditCalories(e.target.value)}
                        className="nutri-total-input"
                      />
                      <span className="nutri-est-unit">kcal</span>
                    </div>
                  </div>
                  <div className="nutri-est-actions">
                    <button className="nutri-btn nutri-btn-primary" onClick={handleConfirmEstimation}>
                      {t('nutrify.confirmLog', 'Confirmar y registrar')}
                    </button>
                    <button className="nutri-btn nutri-btn-ghost" onClick={() => handleAddFavorite(
                      foodInput.trim(),
                      parseInt(editCalories) || estimation.totalCalories,
                      'ai_estimate',
                      estimation.items.length > 1 ? JSON.stringify(estimation.items) : undefined,
                    )}>
                      <Heart width={14} height={14} /> {t('nutrify.saveToFavorites', 'Guardar en favoritos')}
                    </button>
                    <button className="nutri-btn nutri-btn-ghost" onClick={() => { setEstimation(null); setEditCalories(''); }}>
                      {t('common.cancel', 'Cancelar')}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Favorite Foods ─────────────────────────── */}
      {!dayClosed && favoriteFoods.length > 0 && (
        <div className="nutri-card">
          <h3
            className="nutri-card-title"
            style={{ cursor: 'pointer', userSelect: 'none' }}
            onClick={() => setShowFavorites(v => !v)}
          >
            <span className="nutri-t-ico"><Heart width={14} height={14} /></span>
            {t('nutrify.favoriteFoods', 'Comidas Favoritas')}
            <HelpBubble variant="inline" text={t('nutrify.favoriteFoodsHelp', 'Tus comidas guardadas para loguear rápido')} />
            <span className="nutri-card-meta" style={{ fontSize: 'var(--fs-label)' }}>
              {showFavorites ? '\u25B4' : '\u25BE'}
            </span>
          </h3>
          {showFavorites && (
            <>
              <div className="nutri-frequent-pills">
                {favoriteFoods.map((f) => (
                  <button
                    key={f.id}
                    className="nutri-btn nutri-pill"
                    onClick={() => handleLogFavorite(f)}
                    onContextMenu={(e) => { e.preventDefault(); handleRemoveFavorite(f.id); }}
                  >
                    {f.description} ({f.calories})
                  </button>
                ))}
              </div>
              <p className="nutri-hint" style={{ fontSize: 'var(--fs-label)', opacity: 0.5, marginTop: 4 }}>
                {t('nutrify.favoriteClickHint', 'Click para loguear, click derecho para eliminar')}
              </p>
            </>
          )}
        </div>
      )}

      {/* ── Food log (grouped by meal) ────────────── */}
      <div className="nutri-card" data-tour="nutrition-log">
        <h3 className="nutri-card-title">
          <span className="nutri-t-ico"><Scroll width={14} height={14} /></span>
          {t('nutrify.foodLog', 'Registro de Comidas')}
          <HelpBubble variant="inline" text={t('nutrify.foodLogHelp', 'Comidas del día agrupadas por momento. Tocá el ícono para cambiar categoría. Podés editar o eliminar.')} />
          {foods.length > 0 && (
            <span className="nutri-card-meta">
              {foods.length} {t('nutrify.meals', 'comidas')} {'\u00B7'} {consumed} kcal
            </span>
          )}
          {foods.length > 0 && !dayClosed && (
            <button className="nutri-btn nutri-btn-danger nutri-btn-sm" onClick={handleDeleteDay}>
              {t('nutrify.deleteDayButton', 'Eliminar día')}
            </button>
          )}
        </h3>
        {foods.length === 0 && !dayClosed && (
          <div className="nutri-empty">
            <Platter width={32} height={32} />
            <p>{t('nutrify.noFoodToday', 'No hay comidas registradas. Describí lo que comiste arriba o usá un favorito.')}</p>
          </div>
        )}
        {mealGroups.map((group) => (
          <div key={group.type} className="nutri-meal-group">
            <div className="nutri-meal-group-header">
              <span className="nutri-meal-group-emoji">{MEAL_ICON[group.type]}</span>
              <span className="nutri-meal-group-name">{mealI18n[group.type]}</span>
              <span className="nutri-meal-group-kcal">{group.calories} kcal</span>
            </div>
            {group.foods.map((f) => (
              <FoodLogItem key={f.id} entry={f} isNew={lastAddedId === f.id} className="" readOnly={!!dayClosed} onDelete={handleDelete} onMealChange={handleMealChange} mealSchedule={mealSchedule} onFavorite={() => handleAddFavorite(f.description, f.calories, f.source || undefined, f.aiBreakdown || undefined)} onUpdate={async (id, fields) => {
                await window.api.nutritionUpdateFood(id, fields);
                loadData(date);
              }} />
            ))}
          </div>
        ))}
      </div>

      {/* ── Frequent foods ──────────────────────────── */}
      {!dayClosed && frequentFoods.length > 0 && (
        <div className="nutri-card">
          <h3 className="nutri-card-title">
            {t('nutrify.frequentFoods', 'Comidas Frecuentes')}
            <HelpBubble variant="inline" text={t('nutrify.frequentFoodsHelp', 'Alimentos que usás seguido, ordenados por frecuencia. Se aprenden de tus registros anteriores.')} />
          </h3>
          <input type="text" placeholder={t('common.search', 'Buscar')} value={frequentSearch}
            onChange={(e) => setFrequentSearch(e.target.value)} className="nutri-text-input" style={{ width: '100%', marginBottom: 8 }} />
          <div className="nutri-frequent-pills">
            {filteredFrequent.slice(0, 12).map((f) => (
              <button key={f.id} className="nutri-btn nutri-pill" onClick={() => handleLogFrequent(f)}>
                {f.name} ({f.calories})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Close Day ───────────────────────────────── */}
      <div className="nutri-card" style={{ marginBottom: 26 }}>
        <HelpBubble text={t('nutrify.closeDayHelp', 'Cerrá el día para calcular XP y HP. Se evalúa precisión calórica, pasos, gym y pesaje semanal.')} />
        <h3 className="nutri-card-title">
          <span className="nutri-t-ico">{'\u25F7'}</span>
          {isPending ? t('nutrify.confirmDay', 'Confirmar Día') : t('nutrify.closeDay', 'Cierre del Día')}
          <span className="nutri-card-subtitle">
            {t('nutrify.closeDayDesc', 'Cerrá el día para calcular tu XP y HP según precisión calórica, pasos, gym y peso')}
          </span>
        </h3>

        {dayClosed ? (
          <div>
            <p className="nutri-day-status">{t('nutrify.dayClosed', 'Día cerrado')}</p>
            <div className="nutri-close-day">
              <CloseDayStats consumed={dayClosed.consumed} target={dayClosed.target} />
              <DayBreakdown data={dayClosed} t={t} />
            </div>
          </div>
        ) : closeResult ? (
          <div>
            <p className="nutri-day-status nutri-day-success">{t('nutrify.dayClosedSuccess', '¡Día cerrado exitosamente!')}</p>
            <div className="nutri-close-day">
              <CloseDayStats consumed={closeResult.consumed} target={closeResult.target} />
              <DayBreakdown data={closeResult} t={t} />
            </div>
          </div>
        ) : (
          <div className="nutri-close-day">
            <CloseDayStats consumed={consumed} target={target} />
            <div className="nutri-reward-card">
              <button
                className="nutri-btn nutri-btn-ghost"
                style={{ width: '100%', marginBottom: 8 }}
                onClick={() => setWeightPopup({ show: true, lastWeight: weightPopup.lastWeight })}
              >
                {t('nutrify.logWeight', 'Registrar peso')}
              </button>
              <button className="nutri-btn nutri-btn-primary" onClick={() => {
                setPopupSteps(metrics.steps != null ? String(metrics.steps) : '');
                setPopupGym(!!metrics.gym);
                setCloseDayPopup(true);
              }}
                disabled={consumed === 0}
                style={{ width: '100%', justifyContent: 'center' }}>
                {isPending ? t('nutrify.confirmDay', 'Confirmar Día') : t('nutrify.closeDayButton', 'Cerrar el Día')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Weight check-in popup ───────────────────── */}
      {weightPopup.show && (
        <div className="nutri-popup-overlay" onClick={handleWeightDismiss} onKeyDown={(e) => e.key === 'Escape' && handleWeightDismiss()}>
          <div className="nutri-popup" onClick={(e) => e.stopPropagation()}>
            <h3 className="nutri-popup-title">
              {t('nutrify.weightCheckin.title', 'Registro semanal de peso')}
            </h3>
            {weightPopup.lastWeight && (
              <p className="nutri-popup-hint">
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
              <p className="nutri-popup-error">{weightError}</p>
            )}
            <button className="nutri-btn nutri-btn-primary" onClick={handleWeightSave} style={{ width: '100%', marginBottom: 8 }}>
              {t('nutrify.weightCheckin.save', 'Guardar')}
            </button>
            <button onClick={handleWeightDismiss} className="nutri-btn nutri-btn-ghost"
              style={{ width: '100%' }}>
              {t('nutrify.weightCheckin.later', 'Después')}
            </button>
          </div>
        </div>
      )}

      {/* ── Close day popup ─────────────────────────── */}
      {closeDayPopup && (
        <div className="nutri-popup-overlay" onClick={() => setCloseDayPopup(false)} onKeyDown={(e) => e.key === 'Escape' && setCloseDayPopup(false)}>
          <div className="nutri-popup" onClick={(e) => e.stopPropagation()}>
            <h3 className="nutri-popup-title">
              {isPending ? t('nutrify.confirmDaySummary', 'Resumen del día') : t('nutrify.closeDay', 'Cierre del Día')}
            </h3>

            {isPending && (
              <div className="nutri-popup-summary">
                <div className="nutri-popup-row">
                  <span className="nutri-popup-label">{t('nutrify.caloriesConsumed', 'Calorías consumidas')}</span>
                  <span className="nutri-popup-val">{consumed} kcal</span>
                </div>
                <div className="nutri-popup-row">
                  <span className="nutri-popup-label">{t('nutrify.confirmTargetLabel', 'Objetivo calórico')}</span>
                  <span className="nutri-popup-val">{target} kcal</span>
                </div>
                <div className="nutri-popup-row nutri-popup-row--border">
                  <span className="nutri-popup-label">{t('nutrify.balance', 'Balance')}</span>
                  <span className={`nutri-popup-val ${(target - consumed) >= 0 ? 'nutri-green' : 'nutri-red'}`}>
                    {target - consumed >= 0 ? '+' : ''}{target - consumed} kcal
                  </span>
                </div>
                <p className="nutri-popup-prompt">
                  {t('nutrify.confirmDayPrompt', '¿Confirmar este día y recibir experiencia?')}
                </p>
              </div>
            )}

            <label className="nutri-popup-field">
              <span>{t('nutrify.steps', 'Pasos')}</span>
              <RpgNumberInput
                value={popupSteps}
                onChange={setPopupSteps}
                step={100} min={0} max={99999}
                style={{ width: 120 }}
                autoFocus
              />
            </label>
            <div className="nutri-popup-checkbox" onClick={() => setPopupGym(!popupGym)}>
              <Checkbox checked={popupGym} onChange={() => setPopupGym(!popupGym)} />
              <span>{t('nutrify.gym', 'Gimnasio')}</span>
            </div>
            <button className="nutri-btn nutri-btn-primary" onClick={handleCloseDayConfirm} style={{ width: '100%', marginBottom: 8 }}>
              {isPending ? t('nutrify.confirmDay', 'Confirmar Día') : t('nutrify.closeDayButton', 'Cerrar el Día')}
            </button>
            <button onClick={() => setCloseDayPopup(false)} className="nutri-btn nutri-btn-ghost"
              style={{ width: '100%' }}>
              {t('common.cancel', 'Cancelar')}
            </button>
          </div>
        </div>
      )}

      {!dayClosed && !closeResult && foods.length > 0 && (
        <div className="nutri-sticky-footer">
          <button className="rpg-button nutri-close-day-btn" onClick={() => {
            setPopupSteps(metrics.steps != null ? String(metrics.steps) : '');
            setPopupGym(!!metrics.gym);
            setCloseDayPopup(true);
          }}>
            {isPending ? t('nutrify.confirmDay', 'Confirmar Día') : t('nutrify.closeDayButton', 'Cerrar el Día')}
          </button>
        </div>
      )}
    </div>
  );
}

function CloseDayStats({ consumed, target }: { consumed: number; target: number }) {
  const { t } = useTranslation();
  const diff = target - consumed;
  const pct = target > 0 ? Math.min(100, Math.round((consumed / target) * 100)) : 0;

  return (
    <div className="nutri-close-stats">
      <div className="nutri-close-stat">
        <span className="nutri-cs-label">{t('nutrify.caloriesConsumed', 'Calorías consumidas')}</span>
        <span className="nutri-cs-val">{consumed}</span>
        <span className="nutri-cs-sub">kcal</span>
      </div>
      <div className="nutri-close-stat">
        <span className="nutri-cs-label">{t('nutrify.target', 'Objetivo')}</span>
        <span className="nutri-cs-val">{target}</span>
        <span className="nutri-cs-sub">kcal</span>
      </div>
      <div className="nutri-close-stat">
        <span className="nutri-cs-label">{t('nutrify.difference', 'Diferencia')}</span>
        <span className={`nutri-cs-val ${diff >= 0 ? 'nutri-green' : 'nutri-red'}`}>
          {diff >= 0 ? `+${diff}` : diff}
        </span>
        <span className="nutri-cs-sub">kcal</span>
      </div>
      <div className="nutri-close-stat">
        <span className="nutri-cs-label">{t('nutrify.progress', 'Progreso')}</span>
        <span className="nutri-cs-val nutri-cs-pct">{pct}%</span>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DayBreakdown({ data, t }: { data: { xpPrecision: number; xpSteps: number; xpGym: number; xpWeight: number; xpBonus?: number; xpTotal: number; hpChange: number; consumed: number; target: number }; t: (...args: any[]) => any }) {
  const rows = [
    { label: t('nutrify.xpPrecision'), value: data.xpPrecision, desc: `${data.consumed} / ${data.target} kcal` },
    { label: t('nutrify.xpBonus', 'Bonus precisión'), value: data.xpBonus ?? 0 },
    { label: t('nutrify.xpSteps'), value: data.xpSteps },
    { label: t('nutrify.xpGym'), value: data.xpGym },
    { label: t('nutrify.xpWeight'), value: data.xpWeight },
  ];

  return (
    <div className="nutri-reward-card">
      <div className="nutri-reward-label">{t('nutrify.reward', 'Recompensa')}</div>
      {rows.map((row) => (
        <div key={row.label} className="nutri-reward-row">
          <span>
            {row.label}
            {row.desc && <span className="nutri-reward-desc">({row.desc})</span>}
          </span>
          <span className={`nutri-reward-xp ${row.value > 0 ? 'nutri-green' : ''}`}>
            +{row.value} XP
          </span>
        </div>
      ))}
      <div className="nutri-reward-total">
        <span>{t('common.total', 'Total')}</span>
        <span className="nutri-reward-xp-total">
          <span className="nutri-green">+{data.xpTotal} XP</span>
          {data.hpChange !== 0 && (
            <span className={data.hpChange > 0 ? 'nutri-green' : 'nutri-red'} style={{ marginLeft: 8 }}>
              {data.hpChange > 0 ? '+' : ''}{data.hpChange} HP
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

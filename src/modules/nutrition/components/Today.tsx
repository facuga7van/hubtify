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
import { rescaleItem, sumBreakdown, scalePortion } from '../breakdown-utils';
import type { BreakdownItem, BreakdownTotals } from '../breakdown-utils';
import { AnimatedNumber } from '../../finance/components/shared/AnimatedNumber';
import HelpBubble from '../../../shared/components/HelpBubble';
import { DawnSun, NoonSun, MoonCrescent, Herb, Heart, Quill, Scroll, Platter } from '../../../shared/components/icons';
import { resolveMealType, MEAL_ORDER as SHARED_MEAL_ORDER, DEFAULT_MEAL_SCHEDULE } from '../../../../shared/meal-utils';
import type { MealSchedule, MealType } from '../../../../shared/meal-utils';
import type { TFunction } from 'i18next';
import type { NutritionProfile, MacroTargets } from '../types';

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

interface FavoriteFood { id: string; description: string; calories: number; source: string; aiBreakdown?: string; proteinG?: number | null; carbsG?: number | null; fatG?: number | null; createdAt: string; updatedAt?: string; }
interface FrequentFood { id: number; name: string; calories: number; timesUsed: number; proteinG?: number | null; carbsG?: number | null; fatG?: number | null; }
interface RecentLoggedDay { date: string; meals: number; calories: number; }

// Food selected for portion adjustment (favorite or frequent), normalized.
interface PortionTarget {
  kind: 'favorite' | 'frequent';
  name: string;
  calories: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  source: string;
  frequentFoodId?: number;
}
interface DailySummary { date: string; totalCaloriesIn: number; bmr: number; tdee: number; balance: number; activityLevel?: string; proteinG?: number | null; carbsG?: number | null; fatG?: number | null; }
interface DailyMetrics { date: string; steps: number | null; gym: boolean; }

const MEAL_ICON: Record<MealType, React.ReactNode> = {
  breakfast: <DawnSun width={18} height={18} />,
  lunch: <NoonSun width={18} height={18} />,
  dinner: <MoonCrescent width={18} height={18} />,
  snack: <Herb width={18} height={18} />,
};

interface EstimationResult {
  totalCalories: number;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  items: BreakdownItem[];
  aiError?: string;
}

export default function Today() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [date, setDate] = useState(() => todayDateString());
  const [foods, setFoods] = useState<FoodEntry[]>([]);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [macroTargets, setMacroTargets] = useState<MacroTargets | null>(null);
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
  const [retrying, setRetrying] = useState(false);
  const [estimateNotice, setEstimateNotice] = useState('');
  const [estimation, setEstimation] = useState<EstimationResult | null>(null);
  const [editCalories, setEditCalories] = useState('');
  // Editable ingredient breakdown — calorie input string + removed flag per original item index.
  const [itemCals, setItemCals] = useState<string[]>([]);
  const [removedItems, setRemovedItems] = useState<boolean[]>([]);
  const [favoriteFoods, setFavoriteFoods] = useState<FavoriteFood[]>([]);
  const [showFavorites, setShowFavorites] = useState(false);
  const [frequentSearch, setFrequentSearch] = useState('');
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [lastAddedId, setLastAddedId] = useState<number | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualCalories, setManualCalories] = useState('');
  const [mealSchedule, setMealSchedule] = useState<MealSchedule>(DEFAULT_MEAL_SCHEDULE);
  // Repeat-day picker
  const [repeatPickerOpen, setRepeatPickerOpen] = useState(false);
  const [recentDays, setRecentDays] = useState<RecentLoggedDay[]>([]);
  // Portion multiplier picker
  const [portionFood, setPortionFood] = useState<PortionTarget | null>(null);
  const [portionFactor, setPortionFactor] = useState(1);
  const { toast } = useToast();
  const confirm = useConfirm();

  const loadData = useCallback(async (d: string) => {
    const [foodList, sum, met, freq, prof, tgt, closedDay, favorites, schedule, macros] = await Promise.all([
      window.api.nutritionGetFoodByDate(d),
      window.api.nutritionGetSummary(d),
      window.api.nutritionGetDailyMetrics(d),
      window.api.nutritionGetFrequentFoods(),
      window.api.nutritionGetProfile(),
      window.api.nutritionGetTodayTarget(),
      window.api.nutritionIsDayClosed(d),
      window.api.nutritionGetFavoriteFoods(),
      window.api.nutritionGetMealSchedule(),
      window.api.nutritionGetMacroTargets(d),
    ]);
    setFoods(foodList as FoodEntry[]);
    setSummary(sum as DailySummary | null);
    setMacroTargets(macros as MacroTargets | null);
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
    setRetrying(false);
    setEstimation(null);
    setEstimateNotice('');
    try {
      const result = await estimateNutrition(foodInput.trim(), { onRetry: () => setRetrying(true) });
      setEstimation({
        totalCalories: result.calories,
        proteinG: result.proteinG,
        carbsG: result.carbsG,
        fatG: result.fatG,
        items: result.items,
      });
      setItemCals(result.items.map((it) => String(it.calories)));
      setRemovedItems(result.items.map(() => false));
      setEditCalories(String(result.calories));
    } catch (err) {
      // Degrade gracefully: keep the typed food, switch to manual entry and show a
      // calm, informative notice instead of an alarming red error.
      console.error('[Nutrition]', err);
      setManualMode(true);
      setEstimateNotice(t('nutrify.aiUnavailable', 'No pudimos estimar las calorías ahora (sin conexión o servicio ocupado). Ingresá las calorías manualmente.'));
      toast({ type: 'info', message: t('nutrify.aiUnavailableShort', 'Estimación IA no disponible — ingresá manual') });
    } finally {
      setEstimating(false);
      setRetrying(false);
    }
  };

  // ── Editable breakdown: recompute live items + totals from edits ──
  const liveBreakdown = useMemo(() => {
    const empty = {
      entries: [] as Array<{ orig: BreakdownItem; index: number; calorieInput: string }>,
      items: [] as BreakdownItem[],
      totals: { calories: 0, proteinG: null, carbsG: null, fatG: null } as BreakdownTotals,
    };
    if (!estimation) return empty;
    const entries: Array<{ orig: BreakdownItem; index: number; calorieInput: string }> = [];
    const items: BreakdownItem[] = [];
    estimation.items.forEach((orig, i) => {
      if (removedItems[i]) return;
      const input = itemCals[i] ?? '';
      const parsed = parseInt(input);
      const cal = Number.isFinite(parsed) ? parsed : 0;
      entries.push({ orig, index: i, calorieInput: input });
      items.push(rescaleItem(orig, cal));
    });
    return { entries, items, totals: sumBreakdown(items) };
  }, [estimation, itemCals, removedItems]);

  const handleEditItemCalories = (localIndex: number, value: string) => {
    const origIndex = liveBreakdown.entries[localIndex]?.index;
    if (origIndex == null) return;
    setItemCals((prev) => {
      const next = [...prev];
      next[origIndex] = value;
      return next;
    });
  };

  const handleRemoveItem = (localIndex: number) => {
    const origIndex = liveBreakdown.entries[localIndex]?.index;
    if (origIndex == null) return;
    setRemovedItems((prev) => {
      const next = [...prev];
      next[origIndex] = true;
      return next;
    });
  };

  const resetEstimation = () => {
    setEstimation(null);
    setEditCalories('');
    setItemCals([]);
    setRemovedItems([]);
  };

  const handleConfirmEstimation = async () => {
    if (!estimation) return;
    const hasItems = estimation.items.length > 0;
    const liveItems = liveBreakdown.items;
    // Principal path: total recalculated from the (edited) ingredients.
    // Fallback: AI returned no breakdown — keep the direct editable total.
    const calories = hasItems
      ? liveBreakdown.totals.calories
      : (parseInt(editCalories) || estimation.totalCalories);
    if (calories <= 0) {
      toast({ type: 'warning', message: t('nutrify.invalidCalories', 'Las calorías deben ser mayores a 0') });
      return;
    }
    const macros: BreakdownTotals = hasItems
      ? liveBreakdown.totals
      : { calories, proteinG: estimation.proteinG, carbsG: estimation.carbsG, fatG: estimation.fatG };

    try {
      const resolved = resolveMealType(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), mealSchedule);
      await window.api.nutritionLogFood({
        date,
        description: foodInput.trim(),
        calories,
        source: 'ai_estimate',
        aiBreakdown: liveItems.length > 1 ? JSON.stringify(liveItems) : undefined,
        proteinG: macros.proteinG,
        carbsG: macros.carbsG,
        fatG: macros.fatG,
        meal: resolved.ambiguous.length === 0 ? resolved.meal : undefined,
      });

      await window.api.processRpgEvent({
        type: 'MEAL_LOGGED', moduleId: 'nutrition',
        payload: { xp: 10, hp: 0 }, timestamp: Date.now(),
      });

      toast({ type: 'nutri', message: `+${calories} kcal` });
      setFoodInput('');
      resetEstimation();
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
        proteinG: food.proteinG ?? null, carbsG: food.carbsG ?? null, fatG: food.fatG ?? null,
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
        proteinG: food.proteinG ?? null, carbsG: food.carbsG ?? null, fatG: food.fatG ?? null,
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

  // ── Repeat a previous day ────────────────────────
  const openRepeatPicker = async () => {
    try {
      const days = await window.api.nutritionGetRecentLoggedDays(date, 14);
      setRecentDays(days as RecentLoggedDay[]);
      setRepeatPickerOpen(true);
    } catch (err) {
      console.error('[Nutrition] openRepeatPicker error:', err);
      toast({ type: 'warning', message: t('nutrify.repeatDayError', 'Error al repetir el día') });
    }
  };

  const handleRepeatDay = async (fromDate: string) => {
    // If the day already has meals, confirm before stacking another day on top.
    if (foods.length > 0) {
      const ok = await confirm({
        message: t('nutrify.repeatDayConfirm', 'Este día ya tiene comidas. ¿Sumar las del día elegido igual?'),
        confirmText: t('nutrify.repeatDayButton', 'Repetir día'),
      });
      if (!ok) return;
    }
    try {
      const { copied } = await window.api.nutritionRepeatDay(fromDate, date);
      setRepeatPickerOpen(false);
      if (copied > 0) {
        // Emit one meal event per copied dish, mirroring logging them one by one.
        for (let i = 0; i < copied; i++) {
          await window.api.processRpgEvent({
            type: 'MEAL_LOGGED', moduleId: 'nutrition',
            payload: { xp: 10, hp: 0 }, timestamp: Date.now(),
          });
        }
        toast({ type: 'nutri', message: t('nutrify.repeatDaySuccess', { count: copied, defaultValue: 'Se repitieron {{count}} comidas' }) });
        const updatedFoods = await window.api.nutritionGetFoodByDate(date) as FoodEntry[];
        if (updatedFoods.length > 0) setLastAddedId(Math.max(...updatedFoods.map(f => f.id)));
        loadData(date);
        window.dispatchEvent(new Event('rpg:statsChanged'));
      } else {
        toast({ type: 'info', message: t('nutrify.repeatDayEmpty', 'Ese día no tiene comidas para repetir') });
      }
    } catch (err) {
      console.error('[Nutrition] repeatDay error:', err);
      toast({ type: 'warning', message: t('nutrify.repeatDayError', 'Error al repetir el día') });
    }
  };

  // ── Portion multiplier (favorites / frequent) ────
  const openPortionFavorite = (f: FavoriteFood) => {
    setPortionFood({
      kind: 'favorite', name: f.description, calories: f.calories,
      proteinG: f.proteinG ?? null, carbsG: f.carbsG ?? null, fatG: f.fatG ?? null,
      source: f.source || 'favorite',
    });
    setPortionFactor(1);
  };

  const openPortionFrequent = (f: FrequentFood) => {
    setPortionFood({
      kind: 'frequent', name: f.name, calories: f.calories,
      proteinG: f.proteinG ?? null, carbsG: f.carbsG ?? null, fatG: f.fatG ?? null,
      source: 'frequent', frequentFoodId: f.id,
    });
    setPortionFactor(1);
  };

  const handleConfirmPortion = async () => {
    if (!portionFood) return;
    const scaled = scalePortion(
      { calories: portionFood.calories, proteinG: portionFood.proteinG, carbsG: portionFood.carbsG, fatG: portionFood.fatG },
      portionFactor,
    );
    if (scaled.calories <= 0) {
      toast({ type: 'warning', message: t('nutrify.invalidCalories', 'Las calorías deben ser mayores a 0') });
      return;
    }
    const label = portionFactor !== 1
      ? `${portionFood.name} (x${Number(portionFactor.toFixed(2))})`
      : portionFood.name;
    try {
      const resolved = resolveMealType(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), mealSchedule);
      await window.api.nutritionLogFood({
        date, description: label, calories: scaled.calories, source: portionFood.source,
        frequentFoodId: portionFood.kind === 'frequent' ? portionFood.frequentFoodId : undefined,
        proteinG: scaled.proteinG, carbsG: scaled.carbsG, fatG: scaled.fatG,
        meal: resolved.ambiguous.length === 0 ? resolved.meal : undefined,
      });
      if (portionFood.kind === 'frequent' && portionFood.frequentFoodId != null) {
        await window.api.nutritionIncrementFrequentUsage(portionFood.frequentFoodId);
      }
      await window.api.processRpgEvent({
        type: 'MEAL_LOGGED', moduleId: 'nutrition',
        payload: { xp: 10, hp: 0 }, timestamp: Date.now(),
      });
      toast({ type: 'nutri', message: `+${scaled.calories} kcal` });
      setPortionFood(null);
      const updatedFoods = await window.api.nutritionGetFoodByDate(date) as FoodEntry[];
      if (updatedFoods.length > 0) setLastAddedId(Math.max(...updatedFoods.map(f => f.id)));
      loadData(date);
      window.dispatchEvent(new Event('rpg:statsChanged'));
    } catch (err) {
      console.error('[Nutrition] confirmPortion error:', err);
      toast({ type: 'warning', message: t('nutrify.logError', 'Error al registrar comida') });
    }
  };

  const handleAddFavorite = async (
    description: string,
    calories: number,
    source?: string,
    aiBreakdown?: string,
    macros?: { proteinG: number | null; carbsG: number | null; fatG: number | null },
  ) => {
    try {
      await window.api.nutritionAddFavoriteFood({
        description, calories, source, aiBreakdown,
        proteinG: macros?.proteinG ?? null,
        carbsG: macros?.carbsG ?? null,
        fatG: macros?.fatG ?? null,
      });
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
        // `date` lets a later DAY_REOPENED find and revert this exact close.
        payload: { xp, hp, date },
        timestamp: Date.now(),
      });
      toast({ type: 'info', message: `+${xp} XP` });
      window.dispatchEvent(new Event('rpg:statsChanged'));
    } else if (result.alreadyClosed) {
      const closed = await window.api.nutritionIsDayClosed(date);
      setDayClosed(closed as typeof dayClosed);
    }
  };

  const handleReopenDay = async () => {
    const ok = await confirm({
      message: t('nutrify.reopenDayWarning', 'Reabrir la jornada revertirá el XP y HP que ganaste al cerrarla. Vas a poder editar las comidas y volver a cerrarla.'),
      confirmText: t('nutrify.reopenDay', 'Reabrir la jornada'),
      danger: true,
    });
    if (!ok) return;
    try {
      const result = await window.api.nutritionReopenDay(date);
      if (result.success) {
        // Revert the granted XP/HP through the RPG engine's undo path
        // (mirrors Questify's TASK_UNCOMPLETED — reverses the exact close event).
        await window.api.processRpgEvent({
          type: 'DAY_REOPENED', moduleId: 'nutrition',
          payload: { xp: -(result.xpTotal ?? 0), hp: -(result.hpChange ?? 0), date },
          timestamp: Date.now(),
        });
        window.dispatchEvent(new Event('rpg:statsChanged'));
        toast({ type: 'info', message: t('nutrify.dayReopened', 'Jornada reabierta') });
      }
      await loadData(date);
      loadPendingDays();
    } catch {
      toast({ type: 'warning', message: t('nutrify.reopenDayError', 'Error al reabrir la jornada') });
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

          {/* Macro attribute bars */}
          <MacroBars summary={summary} targets={macroTargets} t={t} />
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
              onClick={() => { setManualMode(false); setEstimateNotice(''); }}
            >
              {t('nutrify.aiMode', 'Estimación IA')}
            </button>
            <button
              type="button"
              className={`nutri-mode-btn ${manualMode ? 'active' : ''}`}
              onClick={() => { setManualMode(true); setEstimateNotice(''); }}
            >
              {t('nutrify.manualMode', 'Manual')}
            </button>
          </div>

          {estimateNotice && (
            <div className="nutri-estimate-notice">{estimateNotice}</div>
          )}

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
                  {retrying
                    ? t('nutrify.retrying', 'Reintentando...')
                    : estimating
                      ? t('common.loading', 'Cargando...')
                      : t('nutrify.estimate', 'Estimar')}
                </button>
              </div>

              {/* Estimation result */}
              {estimation && (
                <div className="nutri-estimation">
                  {estimation.items.length > 0 ? (
                    <EstimationBreakdown
                      items={liveBreakdown.items.map((it, li) => ({
                        ...it,
                        calorieInput: liveBreakdown.entries[li].calorieInput,
                      }))}
                      totals={liveBreakdown.totals}
                      onEditCalories={handleEditItemCalories}
                      onRemove={handleRemoveItem}
                      t={t}
                      locale={i18n.language === 'en' ? 'en-US' : 'es-AR'}
                    />
                  ) : (
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
                  )}
                  <div className="nutri-est-actions">
                    <button
                      className="nutri-btn nutri-btn-primary"
                      onClick={handleConfirmEstimation}
                      disabled={estimation.items.length > 0 && liveBreakdown.items.length === 0}
                    >
                      {t('nutrify.confirmLog', 'Confirmar y registrar')}
                    </button>
                    <button className="nutri-btn nutri-btn-ghost" onClick={() => {
                      const hasItems = estimation.items.length > 0;
                      const cal = hasItems ? liveBreakdown.totals.calories : (parseInt(editCalories) || estimation.totalCalories);
                      const macros = hasItems
                        ? { proteinG: liveBreakdown.totals.proteinG, carbsG: liveBreakdown.totals.carbsG, fatG: liveBreakdown.totals.fatG }
                        : { proteinG: estimation.proteinG, carbsG: estimation.carbsG, fatG: estimation.fatG };
                      handleAddFavorite(
                        foodInput.trim(),
                        cal,
                        'ai_estimate',
                        liveBreakdown.items.length > 1 ? JSON.stringify(liveBreakdown.items) : undefined,
                        macros,
                      );
                    }}>
                      <Heart width={14} height={14} /> {t('nutrify.saveToFavorites', 'Guardar en favoritos')}
                    </button>
                    <button className="nutri-btn nutri-btn-ghost" onClick={resetEstimation}>
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
                  <span key={f.id} className="nutri-pill-wrap">
                    <button
                      className="nutri-btn nutri-pill"
                      onClick={() => handleLogFavorite(f)}
                      onContextMenu={(e) => { e.preventDefault(); handleRemoveFavorite(f.id); }}
                    >
                      {f.description} ({f.calories})
                    </button>
                    <button
                      type="button"
                      className="nutri-pill-portion"
                      onClick={() => openPortionFavorite(f)}
                      title={t('nutrify.adjustPortion', 'Ajustar porción')}
                      aria-label={t('nutrify.adjustPortion', 'Ajustar porción')}
                    >
                      <PortionGlyph />
                    </button>
                  </span>
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
            <button className="nutri-btn nutri-btn-ghost nutri-btn-sm" onClick={openRepeatPicker}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 8a6 6 0 0 1 10-4.5L14 5" /><path d="M14 2v3h-3" />
                <path d="M14 8a6 6 0 0 1-10 4.5L2 11" /><path d="M2 14v-3h3" />
              </svg>
              {' '}{t('nutrify.repeatDayShort', 'Repetir día')}
            </button>
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
            <button className="nutri-btn nutri-btn-ghost" onClick={openRepeatPicker} style={{ marginTop: 4 }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 8a6 6 0 0 1 10-4.5L14 5" /><path d="M14 2v3h-3" />
                <path d="M14 8a6 6 0 0 1-10 4.5L2 11" /><path d="M2 14v-3h3" />
              </svg>
              {' '}{t('nutrify.repeatPreviousDay', 'Repetir día anterior')}
            </button>
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
              <span key={f.id} className="nutri-pill-wrap">
                <button className="nutri-btn nutri-pill" onClick={() => handleLogFrequent(f)}>
                  {f.name} ({f.calories})
                </button>
                <button
                  type="button"
                  className="nutri-pill-portion"
                  onClick={() => openPortionFrequent(f)}
                  title={t('nutrify.adjustPortion', 'Ajustar porción')}
                  aria-label={t('nutrify.adjustPortion', 'Ajustar porción')}
                >
                  <PortionGlyph />
                </button>
              </span>
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
            <button
              className="nutri-btn nutri-btn-ghost"
              style={{ width: '100%', marginTop: 12 }}
              onClick={handleReopenDay}
            >
              {t('nutrify.reopenDay', 'Reabrir la jornada')}
            </button>
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

      {/* ── Repeat a day picker ─────────────────────── */}
      {repeatPickerOpen && (
        <RepeatDayPicker
          days={recentDays}
          onPick={handleRepeatDay}
          onClose={() => setRepeatPickerOpen(false)}
          locale={i18n.language === 'en' ? 'en-US' : 'es-AR'}
          t={t}
        />
      )}

      {/* ── Portion multiplier picker ───────────────── */}
      {portionFood && (
        <PortionPicker
          name={portionFood.name}
          baseCalories={portionFood.calories}
          baseProteinG={portionFood.proteinG}
          baseCarbsG={portionFood.carbsG}
          baseFatG={portionFood.fatG}
          factor={portionFactor}
          onFactor={setPortionFactor}
          onConfirm={handleConfirmPortion}
          onClose={() => setPortionFood(null)}
          t={t}
        />
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

// Small "multiply" glyph for the portion-adjust pill button (no emoji).
function PortionGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <line x1="2.5" y1="2.5" x2="9.5" y2="9.5" /><line x1="9.5" y1="2.5" x2="2.5" y2="9.5" />
    </svg>
  );
}

// Presentational picker listing recent logged days to repeat. Fully prop-driven
// so it can be visual-tested in isolation (same pattern as MacroBars).
export function RepeatDayPicker({
  days,
  onPick,
  onClose,
  locale,
  t,
}: {
  days: Array<{ date: string; meals: number; calories: number }>;
  onPick: (date: string) => void;
  onClose: () => void;
  locale: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: TFunction<any, any>;
}) {
  const dayLabel = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const obj = new Date(y, m - 1, d);
    return obj.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'short' });
  };
  return (
    <div className="nutri-popup-overlay" onClick={onClose} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="nutri-popup" onClick={(e) => e.stopPropagation()}>
        <h3 className="nutri-popup-title">{t('nutrify.repeatDayTitle', 'Repetir el festín de…')}</h3>
        {days.length === 0 ? (
          <p className="nutri-popup-hint">{t('nutrify.repeatDayNoneRecent', 'No hay días recientes con comidas para repetir.')}</p>
        ) : (
          <>
            <p className="nutri-popup-hint">{t('nutrify.repeatDayHint', 'Elegí un día y sumamos sus comidas a hoy.')}</p>
            <div className="nutri-repeat-list">
              {days.map((day) => (
                <button key={day.date} type="button" className="nutri-repeat-day" onClick={() => onPick(day.date)}>
                  <span className="nutri-repeat-day-name">{dayLabel(day.date)}</span>
                  <span className="nutri-repeat-day-meta">
                    {day.meals} {t('nutrify.meals', 'comidas')} {'·'} {day.calories.toLocaleString(locale)} kcal
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
        <button onClick={onClose} className="nutri-btn nutri-btn-ghost" style={{ width: '100%', marginTop: 8 }}>
          {t('common.cancel', 'Cancelar')}
        </button>
      </div>
    </div>
  );
}

const PORTION_PRESETS = [0.5, 1, 1.5, 2];

// Presentational portion-multiplier picker. Pure preview math via scalePortion,
// prop-driven so it can be visual-tested in isolation.
export function PortionPicker({
  name,
  baseCalories,
  baseProteinG,
  baseCarbsG,
  baseFatG,
  factor,
  onFactor,
  onConfirm,
  onClose,
  t,
}: {
  name: string;
  baseCalories: number;
  baseProteinG: number | null;
  baseCarbsG: number | null;
  baseFatG: number | null;
  factor: number;
  onFactor: (f: number) => void;
  onConfirm: () => void;
  onClose: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: TFunction<any, any>;
}) {
  const scaled = scalePortion(
    { calories: baseCalories, proteinG: baseProteinG, carbsG: baseCarbsG, fatG: baseFatG },
    factor,
  );
  const hasMacros = scaled.proteinG != null || scaled.carbsG != null || scaled.fatG != null;
  return (
    <div className="nutri-popup-overlay" onClick={onClose} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="nutri-popup" onClick={(e) => e.stopPropagation()}>
        <h3 className="nutri-popup-title">{t('nutrify.portionTitle', 'Ajustar porción')}</h3>
        <p className="nutri-popup-hint">{name}</p>

        <div className="nutri-portion-presets">
          {PORTION_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={`nutri-btn nutri-portion-preset${factor === p ? ' active' : ''}`}
              onClick={() => onFactor(p)}
            >
              x{p}
            </button>
          ))}
        </div>

        <label className="nutri-popup-field">
          <span>{t('nutrify.portionFactor', 'Porciones')}</span>
          <RpgNumberInput
            value={String(factor)}
            onChange={(v) => onFactor(parseFloat(v) || 0)}
            step={0.5} min={0} max={20}
            style={{ width: 120 }}
          />
        </label>

        <div className="nutri-popup-summary">
          <div className="nutri-popup-row">
            <span className="nutri-popup-label">{t('nutrify.calories', 'Calorías')}</span>
            <span className="nutri-popup-val">{scaled.calories} kcal</span>
          </div>
          {hasMacros && (
            <div className="nutri-popup-row nutri-popup-row--border">
              <span className="nutri-popup-label">{t('nutrify.macros', 'Macros')}</span>
              <span className="nutri-popup-val">
                {t('nutrify.protein', 'Proteína').charAt(0)} {scaled.proteinG ?? '–'}g {'·'}{' '}
                {t('nutrify.carbs', 'Carbohidratos').charAt(0)} {scaled.carbsG ?? '–'}g {'·'}{' '}
                {t('nutrify.fat', 'Grasa').charAt(0)} {scaled.fatG ?? '–'}g
              </span>
            </div>
          )}
        </div>

        <button className="nutri-btn nutri-btn-primary" onClick={onConfirm} disabled={scaled.calories <= 0}
          style={{ width: '100%', marginBottom: 8 }}>
          {t('nutrify.portionConfirm', 'Registrar porción')}
        </button>
        <button onClick={onClose} className="nutri-btn nutri-btn-ghost" style={{ width: '100%' }}>
          {t('common.cancel', 'Cancelar')}
        </button>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function MacroBars({ summary, targets, t }: { summary: DailySummary | null; targets: MacroTargets | null; t: TFunction<any, any> }) {
  if (!targets) return null;

  const rows: Array<{ key: string; label: string; consumed: number; target: number }> = [
    { key: 'protein', label: t('nutrify.protein', 'Proteína'), consumed: Math.round(summary?.proteinG ?? 0), target: targets.proteinG },
    { key: 'carbs', label: t('nutrify.carbs', 'Carbohidratos'), consumed: Math.round(summary?.carbsG ?? 0), target: targets.carbsG },
    { key: 'fat', label: t('nutrify.fat', 'Grasa'), consumed: Math.round(summary?.fatG ?? 0), target: targets.fatG },
  ];

  return (
    <div className="nutri-macros">
      <div className="nutri-macros-head">
        <span className="nutri-macros-title">{t('nutrify.macros', 'Macros')}</span>
        {targets.auto && (
          <span className="nutri-macros-auto">{t('nutrify.autoSuggested', 'Sugerido automáticamente')}</span>
        )}
      </div>
      {rows.map((row) => {
        const pct = row.target > 0 ? Math.round((row.consumed / row.target) * 100) : 0;
        const fill = Math.min(100, pct);
        const over = pct > 100;
        return (
          <div key={row.key} className={`nutri-macro${over ? ' is-over' : ''}`}>
            <div className="nutri-macro-info">
              <span className="nutri-macro-label">{row.label}</span>
              <span className="nutri-macro-val">
                {row.consumed} / {row.target} g
                <span className="nutri-macro-pct">{' '}{'·'} {pct}%</span>
              </span>
            </div>
            <div className={`nutri-macro-bar nutri-macro-bar--${row.key}${over ? ' is-over' : ''}`}>
              <div className="nutri-macro-fill" style={{ width: `${fill}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Editable AI ingredient breakdown — presentational, fully driven by props so it
// can be unit/visual-tested in isolation (same pattern as MacroBars).
export function EstimationBreakdown({
  items,
  totals,
  onEditCalories,
  onRemove,
  t,
  locale,
}: {
  items: Array<BreakdownItem & { calorieInput: string }>;
  totals: BreakdownTotals;
  onEditCalories: (index: number, value: string) => void;
  onRemove: (index: number) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: TFunction<any, any>;
  locale: string;
}) {
  const initials = {
    p: t('nutrify.protein', 'Proteína').charAt(0).toUpperCase(),
    c: t('nutrify.carbs', 'Carbohidratos').charAt(0).toUpperCase(),
    f: t('nutrify.fat', 'Grasa').charAt(0).toUpperCase(),
  };
  const macroLine = (p: number | null, c: number | null, f: number | null): string | null => {
    const parts = [
      p != null ? `${initials.p} ${p}g` : null,
      c != null ? `${initials.c} ${c}g` : null,
      f != null ? `${initials.f} ${f}g` : null,
    ].filter(Boolean);
    return parts.length ? parts.join('  ·  ') : null;
  };
  const totalMacros = macroLine(totals.proteinG, totals.carbsG, totals.fatG);

  return (
    <div className="nutri-est-breakdown">
      <p className="nutri-est-hint">
        {t('nutrify.breakdownHint', 'Ajustá las calorías de cada ingrediente o quitá lo que no comiste.')}
      </p>
      <div className="nutri-est-items">
        {items.map((it, i) => {
          const macros = macroLine(it.proteinG, it.carbsG, it.fatG);
          return (
            <div key={i} className="nutri-est-item nutri-est-item--edit">
              <div className="nutri-est-item-main">
                <span className="nutri-food-name">{it.name}</span>
                {macros && <span className="nutri-est-item-macros">{macros}</span>}
              </div>
              <div className="nutri-est-item-cal">
                <input
                  type="number"
                  className="nutri-est-cal-input"
                  value={it.calorieInput}
                  onChange={(e) => onEditCalories(i, e.target.value)}
                  aria-label={t('nutrify.itemCaloriesLabel', { name: it.name, defaultValue: 'Calorías de {{name}}' })}
                />
                <span className="nutri-est-unit">{t('nutrify.kcalUnit', 'kcal')}</span>
                <button
                  type="button"
                  className="nutri-est-remove"
                  onClick={() => onRemove(i)}
                  title={t('nutrify.removeIngredient', 'Quitar ingrediente')}
                  aria-label={t('nutrify.removeIngredient', 'Quitar ingrediente')}
                >
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {items.length === 0 ? (
        <p className="nutri-est-empty">
          {t('nutrify.breakdownEmpty', 'Quitaste todos los ingredientes. Volvé a estimar o agregá uno manualmente.')}
        </p>
      ) : (
        <div className="nutri-est-total">
          <span className="nutri-est-total-label">{t('nutrify.totalCalories', 'Total')}:</span>
          <div className="nutri-est-total-recalc">
            {totalMacros && <span className="nutri-est-total-macros">{totalMacros}</span>}
            <span className="nutri-est-total-val">{totals.calories.toLocaleString(locale)} {t('nutrify.kcalUnit', 'kcal')}</span>
          </div>
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
            <>
              <span className={data.hpChange >= 0 ? 'nutri-green' : 'nutri-red'} style={{ marginLeft: 8 }}>
                {data.hpChange >= 0 ? '+' : ''}{data.hpChange} HP
              </span>
              <HelpBubble text={t('nutrify.hpExplanation', 'HP según cercanía al objetivo: dentro del rango = +HP, fuera del rango = -HP')} />
            </>
          )}
        </span>
      </div>
    </div>
  );
}

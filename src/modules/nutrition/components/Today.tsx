import { useState, useEffect, useCallback, useMemo, useLayoutEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../../shared/components/useToast';
import { useConfirm } from '../../../shared/components/ConfirmDialog';
import { CircularProgress } from '../../../shared/components/charts';
import FoodLogItem from './FoodLogItem';
import NutritionOnboarding from './NutritionOnboarding';
import { todayDateString, formatDateString } from '../../../../shared/date-utils';
import RpgNumberInput from '../../../shared/components/RpgNumberInput';
// resolveEstimate = the SQLite estimate cache in front of estimateNutrition
// (retry + timeout live inside it). breakdown-utils = upstream's editable
// per-ingredient breakdown and portion scaling. Both survive.
import { resolveEstimate } from '../estimate-with-cache';
import { isNoSessionError } from '../estimate-service';
import { rescaleItem, sumBreakdown, scalePortion } from '../breakdown-utils';
import type { BreakdownItem, BreakdownTotals } from '../breakdown-utils';
import { AnimatedNumber } from '../../finance/components/shared/AnimatedNumber';
import HelpBubble from '../../../shared/components/HelpBubble';
import { useModalA11y } from '../../../shared/hooks/useModalA11y';
import { DawnSun, NoonSun, MoonCrescent, Herb, Heart, Quill, Scroll, Platter, CrossMark, Chalice, Meat, Scale } from '../../../shared/components/icons';
import { resolveMealType, MEAL_ORDER as SHARED_MEAL_ORDER, DEFAULT_MEAL_SCHEDULE, scoreNutritionDay } from '../../../../shared/meal-utils';
import type { MealSchedule, MealType } from '../../../../shared/meal-utils';
import { nutritionToday, DEFAULT_DAY_CUTOFF_HOUR } from '../nutrition-day';
import { useAnchoredPopup } from '../../../shared/hooks/useAnchoredPopup';
import { usePopoverRegistration } from '../../../shared/hooks/usePopoverRegistration';
import { useFoodSuggestions } from '../useFoodSuggestions';
import { cacheEstimate } from '../history-api';
import { notifyNutritionChanged, NUTRITION_DAY_CLOSED_EVENT } from '../notify';
import { openCodex } from '../../../hub/codex/codexApi';
import FoodSuggestionList from './FoodSuggestionList';
import type { HistorySuggestion } from '../history-search';
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
  proteinG?: number | null;
  /** 1 = registro de evento (asado): calories es el punto medio de la banda. */
  isEvent?: number;
  eventKcalMin?: number | null;
  eventKcalMax?: number | null;
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

const MEAL_ICON: Record<MealType, React.ReactNode> = {
  breakfast: <DawnSun width={18} height={18} />,
  lunch: <NoonSun width={18} height={18} />,
  merienda: <Chalice width={18} height={18} />,
  dinner: <MoonCrescent width={18} height={18} />,
  snack: <Herb width={18} height={18} />,
};

const FAVORITES_OPEN_KEY = 'hubtify_nutri_favorites_open';

interface EstimationResult {
  totalCalories: number;
  /** Full macros in grams, or null when the source does not know them. */
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  items: BreakdownItem[];
  aiError?: string;
}

/** Bandas predefinidas para el modo evento, en kcal. */
const EVENT_BANDS: Array<{ key: string; min: number; max: number }> = [
  { key: 'light', min: 800, max: 1200 },
  { key: 'classic', min: 1200, max: 1600 },
  { key: 'feast', min: 1600, max: 2200 },
];

export default function Today() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  // Starts on the CALENDAR day; the profile's cutoff arrives with loadData and,
  // as long as the user has not navigated, snaps this to the nutritional day.
  const [date, setDate] = useState(() => todayDateString());
  const [dayCutoffHour, setDayCutoffHour] = useState(0);
  const [userPickedDate, setUserPickedDate] = useState(false);
  const [foods, setFoods] = useState<FoodEntry[]>([]);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [macroTargets, setMacroTargets] = useState<MacroTargets | null>(null);
  const [frequentFoods, setFrequentFoods] = useState<FrequentFood[]>([]);
  const [frequentSearch, setFrequentSearch] = useState('');
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [target, setTarget] = useState(0);
  const [deficitTargetKcal, setDeficitTargetKcal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Close Day
  const [dayClosed, setDayClosed] = useState<{
    xpPrecision: number; xpSteps: number; xpGym: number; xpWeight: number;
    xpBonus: number; xpTotal: number; hpChange: number; consumed: number; target: number;
  } | null>(null);
  /** El día se cerró en ESTA sesión (desde el Códice): se festeja una vez. */
  const [justClosed, setJustClosed] = useState(false);

  // Weight check-in popup
  const [weightPopup, setWeightPopup] = useState<{ show: boolean; lastWeight?: number }>({ show: false });
  const [weightInput, setWeightInput] = useState('');
  const [pendingDays, setPendingDays] = useState<string[]>([]);
  /** Semanas con al menos un día cerrado y sin sellar — señal del pergamino del Códice. */
  const [pendingWeeks, setPendingWeeks] = useState<string[]>([]);

  // Unified food input
  const [foodInput, setFoodInput] = useState('');
  const [estimating, setEstimating] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [estimateNotice, setEstimateNotice] = useState('');
  const [estimation, setEstimation] = useState<EstimationResult | null>(null);
  // True when the estimate on screen came out of the local cache instead of the
  // Cloud Function — the UI says so, because "instant" and "the AI thought about
  // it" are different claims and the user deserves to know which one they got.
  const [estimationCached, setEstimationCached] = useState(false);
  const [editCalories, setEditCalories] = useState('');
  // Editable ingredient breakdown — calorie input string + removed flag per original item index.
  const [itemCals, setItemCals] = useState<string[]>([]);
  const [removedItems, setRemovedItems] = useState<boolean[]>([]);
  const [favoriteFoods, setFavoriteFoods] = useState<FavoriteFood[]>([]);
  // Favourites are the fastest path to "log my usual lunch" — open by default,
  // and remember whatever the user chose across sessions.
  const [showFavorites, setShowFavorites] = useState(() => {
    try { return localStorage.getItem(FAVORITES_OPEN_KEY) !== 'false'; } catch { return true; }
  });
  const [logMenuOpen, setLogMenuOpen] = useState(false);
  // No usa useAnchoredPopup (vive en flujo, no en portal): se anota a mano
  // para que el botón atrás de Android lo cierre en vez de navegar.
  const closeLogMenu = useCallback(() => setLogMenuOpen(false), []);
  usePopoverRegistration(logMenuOpen, closeLogMenu);
  const [reopening, setReopening] = useState(false);
  const [lastAddedId, setLastAddedId] = useState<number | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualCalories, setManualCalories] = useState('');
  const [manualProtein, setManualProtein] = useState('');
  // ── Modo evento (el asado) ───────────────────────
  // Un mini-form: nombre + banda honesta en kcal; se registra el punto medio
  // como UNA sola comida marcada. Registrar el evento ES presentarse.
  const [eventOpen, setEventOpen] = useState(false);
  const [eventName, setEventName] = useState('');
  const [eventMin, setEventMin] = useState('1200');
  const [eventMax, setEventMax] = useState('1600');
  const [eventEstimating, setEventEstimating] = useState(false);
  const [eventSaving, setEventSaving] = useState(false);
  const [mealSchedule, setMealSchedule] = useState<MealSchedule>(DEFAULT_MEAL_SCHEDULE);
  // Repeat-day picker
  const [repeatPickerOpen, setRepeatPickerOpen] = useState(false);
  const [recentDays, setRecentDays] = useState<RecentLoggedDay[]>([]);
  // Portion multiplier picker
  const [portionFood, setPortionFood] = useState<PortionTarget | null>(null);
  const [portionFactor, setPortionFactor] = useState(1);
  const { toast } = useToast();
  const confirm = useConfirm();

  // ── One log at a time ────────────────────────────
  // Every path that writes a meal (confirm, manual, favourite pill, history
  // suggestion, repeat yesterday) shares this guard: a double click used to
  // insert two rows and pay MEAL_LOGGED twice. The ref answers synchronously
  // (state lags a render); the state disables the buttons.
  const loggingRef = useRef(false);
  const [logging, setLogging] = useState(false);
  const withLogGuard = async (run: () => Promise<void>) => {
    if (loggingRef.current) return;
    loggingRef.current = true;
    setLogging(true);
    try {
      await run();
    } finally {
      loggingRef.current = false;
      setLogging(false);
    }
  };

  // ── History autocomplete ─────────────────────────
  // The fast lane: with a few weeks of log behind you, most meals are already in
  // there, and picking one skips the model entirely — no wait, no cost, works
  // offline. Only the AI-mode input offers it; Manual already asks for a number.
  const suggest = useFoodSuggestions(foodInput, !dayClosed && !manualMode);
  const { anchorRef: suggestAnchorRef, popupRef: suggestPopupRef, pos: suggestPos } =
    useAnchoredPopup<HTMLDivElement, HTMLDivElement>(suggest.open, 2, { onClose: suggest.close });
  const [suggestWidth, setSuggestWidth] = useState(0);

  // Match the dropdown to the input row so the two read as one control.
  useLayoutEffect(() => {
    if (!suggest.open) return;
    const el = suggestAnchorRef.current;
    if (el) setSuggestWidth(el.getBoundingClientRect().width);
  }, [suggest.open, suggest.suggestions.length, suggestAnchorRef]);

  const loadData = useCallback(async (d: string) => {
    const [foodList, sum, freq, prof, tgt, closedDay, favorites, schedule, macros] = await Promise.all([
      window.api.nutritionGetFoodByDate(d),
      window.api.nutritionGetSummary(d),
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
    setFrequentFoods(freq as FrequentFood[]);
    setFavoriteFoods(favorites as FavoriteFood[]);
    setMealSchedule((schedule as MealSchedule) ?? DEFAULT_MEAL_SCHEDULE);
    setHasProfile(!!prof);
    setDeficitTargetKcal((prof as NutritionProfile | null)?.deficitTargetKcal ?? 0);

    const closed = closedDay as typeof dayClosed;
    setDayClosed(closed);

    const cutoff = (prof as NutritionProfile | null)?.dayCutoffHour ?? DEFAULT_DAY_CUTOFF_HOUR;
    setDayCutoffHour(cutoff);

    const isPastDate = d < nutritionToday(cutoff);
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

  // La celebración es del día que se cerró, no del que se mira después.
  useEffect(() => { setJustClosed(false); }, [date]);

  // Once the cutoff is known, "today" may be yesterday's calendar date. Only
  // move the view while the user is still on the auto-selected day.
  useEffect(() => {
    if (userPickedDate) return;
    setDate(nutritionToday(dayCutoffHour));
  }, [dayCutoffHour, userPickedDate]);

  useEffect(() => {
    try { localStorage.setItem(FAVORITES_OPEN_KEY, String(showFavorites)); } catch { /* private mode */ }
  }, [showFavorites]);

  const loadPendingDays = useCallback(async () => {
    const days = await window.api.nutritionGetPendingDays();
    setPendingDays(days);
  }, []);

  const loadPendingWeeks = useCallback(async () => {
    const weeks = await window.api.nutritionGetPendingWeeks();
    setPendingWeeks(weeks);
  }, []);

  useEffect(() => {
    loadPendingDays();
  }, [date, loadPendingDays]);

  useEffect(() => {
    loadPendingWeeks();
  }, [date, loadPendingWeeks]);

  // Reload when settings change or sync completes
  useEffect(() => {
    const handler = () => {
      loadData(date);
      loadPendingDays();
      loadPendingWeeks();
    };
    const closedHandler = () => { setJustClosed(true); handler(); };
    window.addEventListener('nutrition:settingsChanged', handler);
    window.addEventListener('sync:nutritionUpdated', handler);
    window.addEventListener('account:switched', handler);
    // El cierre de la jornada ahora ocurre en el Códice. Sin esto la página
    // quedaba editable con el día ya cerrado y cada edicion fallaba con
    // "Cannot modify a closed day" hasta recargar — el bug NUT-02, de vuelta.
    window.addEventListener(NUTRITION_DAY_CLOSED_EVENT, closedHandler);
    return () => {
      window.removeEventListener('nutrition:settingsChanged', handler);
      window.removeEventListener('sync:nutritionUpdated', handler);
      window.removeEventListener('account:switched', handler);
      window.removeEventListener(NUTRITION_DAY_CLOSED_EVENT, closedHandler);
    };
  }, [date, loadData, loadPendingDays, loadPendingWeeks]);

  /** Nutritional today — the same day the backend writes logs to. */
  const nutriToday = nutritionToday(dayCutoffHour);

  const goDay = (offset: number) => {
    const [y, m, d] = date.split('-').map(Number);
    const newDate = new Date(y, m - 1, d + offset);
    setUserPickedDate(true);
    setDate(formatDateString(newDate));
  };

  // ── Unified estimation flow ──────────────────────
  /**
   * @param skipCache `true` only for an explicit "estimate again" — the point of
   *   that button is to get a FRESH opinion, so it goes past the cache and then
   *   refreshes it.
   */
  const handleEstimate = async (skipCache = false) => {
    if (!foodInput.trim() || estimating) return;
    const description = foodInput.trim();
    // Enter with nothing highlighted: the dropdown (fixed, 320px tall) used to
    // stay open right on top of the estimate the user now has to read and edit.
    suggest.close();
    setEstimating(true);
    setRetrying(false);
    setEstimation(null);
    setEstimateNotice('');
    try {
      // The model does not get asked twice for the same plate of food: the cache
      // answers first, and `onRetry` only fires on the network path behind it.
      const result = await resolveEstimate(description, {
        skipCache,
        onRetry: () => setRetrying(true),
      });
      setEstimation({
        totalCalories: result.totalCalories,
        proteinG: result.proteinG,
        carbsG: result.carbsG,
        fatG: result.fatG,
        items: result.items,
      });
      setItemCals(result.items.map((it) => String(it.calories)));
      setRemovedItems(result.items.map(() => false));
      setEditCalories(String(result.totalCalories));
      setEstimationCached(result.origin === 'cache');
    } catch (err) {
      // One inline signal the user can act on — no toast stacked on top of it,
      // and no silent jump to Manual mode: the user decides. (Upstream forced
      // Manual and toasted; the notice keeps its calmer wording, the forcing goes.)
      //
      // La excepción es el modo invitado: ahí «probá de nuevo» es mentira — no
      // hay sesión y no la va a haber hasta que vincule una cuenta. Ese caso SÍ
      // pasa a Manual, que es el único camino que puede terminar bien.
      console.error('[Nutrition]', err);
      if (isNoSessionError(err)) {
        setManualMode(true);
        setEstimateNotice(t('nutrify.aiUnavailableShort', 'Estimación IA no disponible — ingresá manual'));
      } else {
        setEstimateNotice(t('nutrify.aiUnavailable', 'La IA tardó demasiado o no está disponible. Probá de nuevo o cargá las calorías a mano.'));
      }
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
    setEstimationCached(false);
    setEditCalories('');
    setItemCals([]);
    setRemovedItems([]);
  };

  // withLogGuard: one write at a time. A double click used to insert two rows
  // and pay MEAL_LOGGED twice.
  const handleConfirmEstimation = () => withLogGuard(async () => {
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

    const description = foodInput.trim();
    // Did the human overrule the machine? That decides what the cache keeps.
    const corrected = calories !== estimation.totalCalories;

    try {
      const resolved = resolveMealType(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), mealSchedule, dayCutoffHour);
      await window.api.nutritionLogFood({
        date,
        description,
        calories,
        source: 'ai_estimate',
        aiBreakdown: liveItems.length > 1 ? JSON.stringify(liveItems) : undefined,
        // Los macros sobreviven una corrección de calorías: `macros` ya viene
        // reescalado por rescaleItem sobre las calorías que el usuario dejó, así
        // que corregir el total no tira el dato que la estimación trajo.
        proteinG: macros.proteinG,
        carbsG: macros.carbsG,
        fatG: macros.fatG,
        meal: resolved.ambiguous.length === 0 ? resolved.meal : undefined,
      });

      // Confirmation is the only moment we know the number is good enough for
      // the user, so it is the only moment worth remembering. A corrected value
      // overwrites the model's — a human who typed 700 over 980 is the better
      // source, and the breakdown is dropped with it since it no longer adds up.
      await cacheEstimate({
        description,
        calories,
        aiBreakdown: liveItems.length > 1 ? JSON.stringify(liveItems) : null,
        proteinG: macros.proteinG,
        carbsG: macros.carbsG,
        fatG: macros.fatG,
        corrected,
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
      notifyNutritionChanged();
    } catch (err) {
      console.error('[Nutrition] confirmEstimation error:', err);
      toast({ type: 'warning', message: t('nutrify.logError', 'Error al registrar comida') });
    }
  });

  // ── Manual calorie entry ────────────────────────
  const handleManualAdd = () => withLogGuard(async () => {
    const cal = parseInt(manualCalories);
    if (!foodInput.trim() || isNaN(cal) || cal <= 0) return;
    // Proteína opcional en la carga manual: vacío = sin dato, nunca 0 implícito.
    const prot = parseFloat(manualProtein);
    try {
      const resolved = resolveMealType(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), mealSchedule, dayCutoffHour);
      await window.api.nutritionLogFood({
        date,
        description: foodInput.trim(),
        calories: cal,
        source: 'manual',
        proteinG: isFinite(prot) && prot > 0 ? prot : undefined,
        meal: resolved.ambiguous.length === 0 ? resolved.meal : undefined,
      });

      await window.api.processRpgEvent({
        type: 'MEAL_LOGGED', moduleId: 'nutrition',
        payload: { xp: 10, hp: 0 }, timestamp: Date.now(),
      });

      toast({ type: 'nutri', message: `+${cal} kcal` });
      setFoodInput('');
      setManualCalories('');
      setManualProtein('');
      const updatedFoods = await window.api.nutritionGetFoodByDate(date) as FoodEntry[];
      if (updatedFoods.length > 0) setLastAddedId(Math.max(...updatedFoods.map(f => f.id)));
      loadData(date);
      window.dispatchEvent(new Event('rpg:statsChanged'));
      notifyNutritionChanged();
    } catch (err) {
      console.error('[Nutrition] manualAdd error:', err);
      toast({ type: 'warning', message: t('nutrify.logError', 'Error al registrar comida') });
    }
  });

  // ── Quick log (frequent food) ────────────────────
  const handleLogFrequent = (food: FrequentFood) => withLogGuard(async () => {
    try {
      const resolved = resolveMealType(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), mealSchedule, dayCutoffHour);
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
      notifyNutritionChanged();
    } catch (err) {
      console.error('[Nutrition] logFrequent error:', err);
      toast({ type: 'warning', message: t('nutrify.logError', 'Error al registrar comida') });
    }
  });

  // ── Modo evento ──────────────────────────────────
  /**
   * Pide a la IA una estimación del evento y la convierte en banda honesta:
   * ±15 % alrededor del número. Un asado no se estima al gramo — la banda dice
   * la verdad sobre la incertidumbre y el punto medio es lo que se registra.
   */
  const handleEventEstimate = async () => {
    const name = eventName.trim() || t('nutrify.eventDefaultName', 'Asado familiar');
    if (eventEstimating) return;
    setEventEstimating(true);
    try {
      const result = await resolveEstimate(name);
      setEventMin(String(Math.max(1, Math.round(result.totalCalories * 0.85))));
      setEventMax(String(Math.round(result.totalCalories * 1.15)));
    } catch (err) {
      console.error('[Nutrition] event estimate error:', err);
      toast({
        type: 'info',
        // Sin sesión no hay conexión que revisar: la banda se tipea a mano.
        message: isNoSessionError(err)
          ? t('nutrify.aiUnavailableShort', 'Estimación IA no disponible — ingresá manual')
          : t('nutrify.estimateUnavailable', 'No se pudo estimar. Revisá tu conexión o cargá las calorías en modo Manual.'),
      });
    } finally {
      setEventEstimating(false);
    }
  };

  /**
   * Registra el evento como UNA sola comida marcada, con el punto medio de la
   * banda. Paga el MEAL_LOGGED de siempre — el XP premia REGISTRAR, y registrar
   * el asado es exactamente eso: presentarse.
   */
  const handleLogEvent = async () => {
    if (eventSaving) return;
    const name = eventName.trim() || t('nutrify.eventDefaultName', 'Asado familiar');
    const min = parseInt(eventMin);
    const max = parseInt(eventMax);
    if (!isFinite(min) || !isFinite(max) || min <= 0 || max < min) {
      toast({ type: 'warning', message: t('nutrify.eventInvalidBand', 'La banda tiene que ser mín > 0 y máx ≥ mín.') });
      return;
    }
    const midpoint = Math.round((min + max) / 2);
    setEventSaving(true);
    try {
      const resolved = resolveMealType(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), mealSchedule, dayCutoffHour);
      await window.api.nutritionLogFood({
        date,
        description: name,
        calories: midpoint,
        source: 'manual',
        isEvent: true,
        eventKcalMin: min,
        eventKcalMax: max,
        meal: resolved.ambiguous.length === 0 ? resolved.meal : undefined,
      });
      // El mismo evento RPG que cualquier registro: ni más ni menos. No se
      // inventa un tipo nuevo ni se paga dos veces.
      await window.api.processRpgEvent({
        type: 'MEAL_LOGGED', moduleId: 'nutrition',
        payload: { xp: 10, hp: 0 }, timestamp: Date.now(),
      });
      toast({ type: 'nutri', message: t('nutrify.eventLogged', 'Evento registrado: {{name}} (~{{kcal}} kcal)', { name, kcal: midpoint }) });
      setEventOpen(false);
      setEventName('');
      const updatedFoods = await window.api.nutritionGetFoodByDate(date) as FoodEntry[];
      if (updatedFoods.length > 0) setLastAddedId(Math.max(...updatedFoods.map(f => f.id)));
      loadData(date);
      window.dispatchEvent(new Event('rpg:statsChanged'));
      notifyNutritionChanged();
    } catch (err) {
      console.error('[Nutrition] logEvent error:', err);
      toast({ type: 'warning', message: t('nutrify.logError', 'Error al registrar comida') });
    } finally {
      setEventSaving(false);
    }
  };

  /** Copia las comidas de ayer al dia de hoy, sin retipear ni volver a llamar a la IA. */
  const handleRepeatYesterday = async () => {
    const ok = await confirm({
      message: t('nutrify.repeatYesterdayConfirm', 'Se van a copiar las comidas de ayer al día de hoy.'),
    });
    if (!ok) return;
    await withLogGuard(async () => {
      try {
        const res = await window.api.nutritionCopyDay({ to: date });
        if (!res?.success) {
          toast({
            type: 'info',
            message: res?.reason === 'day_closed'
              ? t('nutrify.dayClosedBanner', 'Este día está cerrado.')
              : t('nutrify.repeatYesterdayEmpty', 'Ayer no registraste ninguna comida.'),
          });
          return;
        }
        // Un solo MEAL_LOGGED por la accion, no uno por comida copiada: cuatro
        // eventos de un click inflarian el combo igual que cuatro registros
        // manuales sin el esfuerzo. El camino comodo paga, pero paga una vez.
        await window.api.processRpgEvent({
          type: 'MEAL_LOGGED', moduleId: 'nutrition',
          payload: { xp: 10, hp: 0, source: 'copy_day', copied: res.copied },
          timestamp: Date.now(),
        });
        toast({ type: 'nutri', message: t('nutrify.repeatYesterdayDone', 'Comidas de ayer copiadas') });
        await loadData(date);
        window.dispatchEvent(new Event('rpg:statsChanged'));
        notifyNutritionChanged();
      } catch (err) {
        console.error('[Nutrition] copyDay error:', err);
        toast({ type: 'warning', message: t('nutrify.logError', 'Error al registrar comida') });
      }
    });
  };

  /**
   * Logs a history suggestion as-is — the whole point of phase 2.
   *
   * No estimate call, no confirmation step, no network: the calories are the
   * ones this meal already had the last time it was logged. It still pays the
   * usual MEAL_LOGGED XP, because the user recorded a meal; the reward is for
   * keeping the log honest, not for waiting on a model.
   */
  const handleLogSuggestion = (s: HistorySuggestion) => withLogGuard(async () => {
    // As-is: the calories this meal already had. Scaling a portion is the
    // PortionPicker's job (favourites / frequent), which previews the macros.
    const calories = s.calories;
    const description = s.description;
    try {
      const resolved = resolveMealType(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), mealSchedule, dayCutoffHour);
      await window.api.nutritionLogFood({
        date,
        description,
        calories,
        // 'history' is mapped to the existing 'frequent' source by the handler;
        // see normalizeFoodSource in nutrition.ipc.ts.
        source: s.source === 'favorite' ? 'favorite' : 'history',
        // La proteína que el cache conoce viaja con la sugerencia; carbos y
        // grasas no viven en el ranking (ver searchHistory).
        proteinG: s.proteinG ?? undefined,
        meal: resolved.ambiguous.length === 0 ? resolved.meal : undefined,
      });
      await window.api.processRpgEvent({
        type: 'MEAL_LOGGED', moduleId: 'nutrition',
        payload: { xp: 10, hp: 0 }, timestamp: Date.now(),
      });
      toast({ type: 'nutri', message: `+${calories} kcal` });
      setFoodInput('');
      resetEstimation();
      setEstimateNotice('');
      suggest.close();
      const updatedFoods = await window.api.nutritionGetFoodByDate(date) as FoodEntry[];
      if (updatedFoods.length > 0) setLastAddedId(Math.max(...updatedFoods.map(f => f.id)));
      loadData(date);
      window.dispatchEvent(new Event('rpg:statsChanged'));
      notifyNutritionChanged();
    } catch (err) {
      console.error('[Nutrition] logSuggestion error:', err);
      toast({ type: 'warning', message: t('nutrify.logError', 'Error al registrar comida') });
    }
  });

  /** Tab on a suggestion: take the text, leave the logging — they want to edit it. */
  const handleCompleteSuggestion = (s: HistorySuggestion) => {
    setFoodInput(s.description);
  };

  // One click = one x1 portion. Anything else goes through the PortionPicker,
  // which previews the scaled macros before writing.
  const handleLogFavorite = (food: FavoriteFood) => withLogGuard(async () => {
    const calories = food.calories;
    const description = food.description;
    try {
      const resolved = resolveMealType(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), mealSchedule, dayCutoffHour);
      await window.api.nutritionLogFood({
        date, description, calories, source: 'favorite',
        aiBreakdown: food.aiBreakdown || undefined,
        proteinG: food.proteinG ?? null, carbsG: food.carbsG ?? null, fatG: food.fatG ?? null,
        meal: resolved.ambiguous.length === 0 ? resolved.meal : undefined,
      });
      await window.api.processRpgEvent({
        type: 'MEAL_LOGGED', moduleId: 'nutrition',
        payload: { xp: 10, hp: 0 }, timestamp: Date.now(),
      });
      toast({ type: 'nutri', message: `+${calories} kcal` });
      const updatedFoods = await window.api.nutritionGetFoodByDate(date) as FoodEntry[];
      if (updatedFoods.length > 0) setLastAddedId(Math.max(...updatedFoods.map(f => f.id)));
      loadData(date);
      window.dispatchEvent(new Event('rpg:statsChanged'));
      notifyNutritionChanged();
    } catch (err) {
      console.error('[Nutrition] logFavorite error:', err);
      toast({ type: 'warning', message: t('nutrify.logError', 'Error al registrar comida') });
    }
  });

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

  const handleRepeatDay = (fromDate: string) => withLogGuard(async () => {
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
      notifyNutritionChanged();
    } catch (err) {
      console.error('[Nutrition] repeatDay error:', err);
      toast({ type: 'warning', message: t('nutrify.repeatDayError', 'Error al repetir el día') });
    }
  });

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

  const handleConfirmPortion = () => withLogGuard(async () => {
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
      const resolved = resolveMealType(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), mealSchedule, dayCutoffHour);
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
      notifyNutritionChanged();
    } catch (err) {
      console.error('[Nutrition] confirmPortion error:', err);
      toast({ type: 'warning', message: t('nutrify.logError', 'Error al registrar comida') });
    }
  });

  const handleAddFavorite = async (
    description: string,
    calories: number,
    source?: string,
    aiBreakdown?: string,
    macros?: { proteinG: number | null; carbsG: number | null; fatG: number | null },
  ) => {
    try {
      const res = await window.api.nutritionAddFavoriteFood({
        description, calories, source, aiBreakdown,
        proteinG: macros?.proteinG ?? null,
        carbsG: macros?.carbsG ?? null,
        fatG: macros?.fatG ?? null,
      });
      // addFavoriteFood upserts on the UNIQUE description: it used to INSERT OR
      // IGNORE and still hand back a fresh uuid that existed nowhere, while the
      // toast said "saved". `created` tells the truth about what happened.
      toast({
        type: 'nutri',
        message: res.created
          ? t('nutrify.favoriteSaved', 'Guardado en favoritos')
          : t('nutrify.favoriteUpdated', 'Favorito actualizado'),
      });
      const favorites = await window.api.nutritionGetFavoriteFoods();
      setFavoriteFoods(favorites as FavoriteFood[]);
      notifyNutritionChanged();
    } catch (err) {
      console.error('[Nutrition] addFavorite error:', err);
      toast({ type: 'warning', message: t('nutrify.logError', 'Error al registrar comida') });
    }
  };

  const handleRemoveFavorite = async (id: string, description: string) => {
    const ok = await confirm({
      message: t('nutrify.favoriteRemoveConfirm', '¿Quitar "{{name}}" de favoritos?', { name: description }),
      confirmText: t('common.delete', 'Eliminar'),
      danger: true,
    });
    if (!ok) return;
    try {
      await window.api.nutritionRemoveFavoriteFood(id);
      toast({ type: 'info', message: t('nutrify.favoriteRemoved', 'Favorito eliminado') });
      const favorites = await window.api.nutritionGetFavoriteFoods();
      setFavoriteFoods(favorites as FavoriteFood[]);
      notifyNutritionChanged();
    } catch (err) {
      console.error('[Nutrition] removeFavorite error:', err);
      toast({ type: 'warning', message: t('nutrify.logError', 'Error al registrar comida') });
    }
  };

  const handleMealChange = async (id: number, meal: string) => {
    try {
      await window.api.nutritionUpdateFood(id, { meal });
      loadData(date);
      notifyNutritionChanged();
    } catch (err) {
      // El ícono del momento volvía solo al valor viejo, sin explicación: se
      // leía como «no me registró el click», no como «el backend lo rechazó».
      console.error('[Nutrify] meal change failed', err);
      toast({ type: 'warning', message: t('nutrify.mealChangeError', 'No se pudo cambiar el momento de la comida') });
    }
  };

  const handleDelete = (id: number) => {
    setTimeout(async () => {
      try {
        await window.api.nutritionDeleteFood(id);
        loadData(date);
        notifyNutritionChanged();
      } catch (err) {
        // El peor de todos: la fila ya salió de pantalla por la animación de
        // salida, así que el usuario CREE que borró. Se avisa y se recarga el
        // día, que trae la comida de vuelta a la lista.
        console.error('[Nutrify] delete failed', err);
        toast({ type: 'warning', message: t('nutrify.deleteEntryError', 'No se pudo eliminar la comida') });
        loadData(date);
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
      notifyNutritionChanged();
    } catch (err) {
      console.error('[Nutrition] deleteDay error:', err);
      toast({ type: 'warning', message: t('nutrify.deleteDayError', 'Error al eliminar comidas') });
    }
  };

  // Weight check-in: only when viewing today, re-check after sync restores profile
  useEffect(() => {
    if (!hasProfile || date !== nutriToday) return;
    if (localStorage.getItem('hubtify_notifications_module_nutrition') === 'false') return;
    const dismissed = localStorage.getItem('hubtify_weight_dismiss_date');
    if (dismissed === nutriToday) return;
    window.api.nutritionShouldAskWeight().then(result => {
      if (result.shouldAsk) {
        setWeightPopup({ show: true, lastWeight: result.lastWeight });
        if (result.lastWeight) setWeightInput(String(result.lastWeight));
      }
    }).catch(console.error);
  }, [date, hasProfile, nutriToday]);

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
      notifyNutritionChanged();
    } catch (err) {
      console.error('[Nutrify] weight save failed', err);
      setWeightError(t('nutrify.weightCheckin.saveFailed', 'Error saving weight'));
    }
  };

  /** Explicit "Later": stop asking until tomorrow. Only the button does this. */
  const handleWeightDismiss = () => {
    localStorage.setItem('hubtify_weight_dismiss_date', nutriToday);
    setWeightPopup({ show: false });
  };

  /** Backdrop / Escape / X: close without burning today's reminder. */
  const handleWeightClose = () => {
    setWeightError('');
    setWeightPopup({ show: false });
  };

  const handleReopenDay = async () => {
    if (reopening) return;
    const ok = await confirm({
      title: t('nutrify.reopenDay', 'Reabrir día'),
      message: t(
        'nutrify.reopenDayConfirm',
        'Se revierten el XP y el HP que ganaste al cerrar este día. Vas a poder registrar comidas de nuevo y cerrarlo otra vez.',
      ),
      confirmText: t('nutrify.reopenDay', 'Reabrir día'),
      danger: true,
    });
    if (!ok) return;
    setReopening(true);
    try {
      const result = await window.api.nutritionReopenDay(date);
      if (!result.success) {
        toast({ type: 'warning', message: result.error || t('nutrify.reopenDayError', 'No se pudo reabrir el día') });
        return;
      }
      setJustClosed(false);
      setDayClosed(null);
      // The ENGINE reverts the close: rpg-handlers treats DAY_REOPENED as a
      // generic undo of the DAY_SUMMARY carrying the same `$.date`, refunding
      // the exact multiplied XP, deleting the event row, giving back the combo
      // tick and reversing the mastery bump. Nothing is recomputed here — which
      // is also why the ' ' < 'T' timestamp bug cannot come back: no timestamp
      // is compared any more, only the date of the closed day.
      await window.api.processRpgEvent({
        type: 'DAY_REOPENED', moduleId: 'nutrition',
        payload: { date }, timestamp: Date.now(),
      });
      toast({
        type: 'info',
        message: result.eventFound
          ? t('nutrify.reopenDaySuccess', 'Día reabierto ({{xp}} XP y {{hp}} HP revertidos)', {
              xp: result.xpReverted ?? 0,
              hp: result.hpReverted ?? 0,
            })
          : t('nutrify.reopenDaySuccessNoEvent', 'Día reabierto'),
      });
      await loadData(date);
      loadPendingDays();
      window.dispatchEvent(new Event('rpg:statsChanged'));
      notifyNutritionChanged();
    } catch (err) {
      console.error('[Nutrition] reopenDay error:', err);
      toast({ type: 'warning', message: t('nutrify.reopenDayError', 'No se pudo reabrir el día') });
    } finally {
      setReopening(false);
    }
  };

  const consumed = summary?.totalCaloriesIn ?? foods.reduce((s, f) => s + f.calories, 0);
  const filteredFrequent = useMemo(() =>
    frequentFoods.filter((f) =>
      !frequentSearch || f.name.toLowerCase().includes(frequentSearch.toLowerCase())
    ), [frequentFoods, frequentSearch]);
  /** El día tiene un evento registrado: pasarse del objetivo no daña el vigor. */
  const dayHasEvent = foods.some(f => !!f.isEvent);

  const mealGroups = useMemo(() => {
    const groups: Record<MealType, { foods: FoodEntry[]; calories: number }> = {
      breakfast: { foods: [], calories: 0 },
      lunch: { foods: [], calories: 0 },
      merienda: { foods: [], calories: 0 },
      dinner: { foods: [], calories: 0 },
      snack: { foods: [], calories: 0 },
    };
    for (const f of foods) {
      const stored = f.meal as MealType | null | undefined;
      // A meal value we don't know (a future type, or a corrupted sync row) must
      // not crash the log — it falls back to the schedule, then to snack.
      const meal = stored && groups[stored]
        ? stored
        : resolveMealType(f.time, mealSchedule, dayCutoffHour).meal;
      groups[meal].foods.push(f);
      groups[meal].calories += f.calories;
    }
    return SHARED_MEAL_ORDER
      .filter(m => mealSchedule[m]?.enabled || groups[m].foods.length > 0)
      .filter(m => groups[m].foods.length > 0)
      .map(m => ({ type: m, ...groups[m] }));
  }, [foods, mealSchedule, dayCutoffHour]);

  const mealI18n: Record<MealType, string> = {
    breakfast: t('nutrify.mealBreakfast', 'Desayuno'),
    lunch: t('nutrify.mealLunch', 'Almuerzo'),
    merienda: t('nutrify.mealMerienda', 'Merienda'),
    dinner: t('nutrify.mealDinner', 'Cena'),
    snack: t('nutrify.mealSnack', 'Snack'),
  };

  const pendingBeforeCount = pendingDays.filter(d => d < date).length;
  const isToday = date === nutriToday;
  const isPending = pendingDays.includes(date);

  const toleranceLow = Math.round(target * 0.95);
  const toleranceHigh = Math.round(target * 1.05);

  // Single source of truth: the same scoring the backend uses for XP and HP.
  // The ring is green exactly when the day would pay out, never on a different band.
  const dayScore = useMemo(
    () => scoreNutritionDay(consumed, target, deficitTargetKcal),
    [consumed, target, deficitTargetKcal],
  );
  const inRange = dayScore.compliant;

  const remaining = target - consumed;
  const over = remaining < 0;
  // The arc caps at 100 %, so the NUMBER has to tell the truth: 143 % stays 143 %.
  const progressPct = target > 0 ? Math.round((consumed / target) * 100) : 0;
  const overflow = target > 0 ? Math.max(0, consumed - target) : 0;

  // Day name for date pill
  const dateDayName = useMemo(() => {
    const [y, m, d] = date.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    return dateObj.toLocaleDateString(i18n.language === 'en' ? 'en-US' : 'es-AR', { weekday: 'long' });
  }, [date, i18n.language]);

  // Focus trap + window-level Escape for both popups. The weight popup closes
  // WITHOUT marking the reminder dismissed — only the "Later" button does that.
  const weightModal = useModalA11y({ onClose: handleWeightClose, active: weightPopup.show });
  const eventModal = useModalA11y({ onClose: () => setEventOpen(false), active: eventOpen });

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
  if (!hasProfile) return (
    <NutritionOnboarding
      onComplete={() => loadData(date)}
      onSkip={() => navigate('/')}
    />
  );

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
              onClick={() => { if (!isToday) { setUserPickedDate(false); setDate(nutriToday); } }}
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
              disabled={date >= nutriToday}
              style={{ opacity: date >= nutriToday ? 0.3 : 1 }}
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

          {/* Quien vive en la vista diaria no ve el Códice: sin esto, el
              pergamino semanal podía esperar sellado indefinidamente sin que
              nadie se enterase de que estaba ahí. */}
          {pendingWeeks.length > 0 && (
            <button
              type="button"
              className="nutri-pending-banner nutri-pending-banner--week"
              onClick={() => navigate('/nutrition/dashboard')}
            >
              <Scroll width={14} height={14} />
              {t('nutrify.weeklyPendingBanner', 'Tu pergamino semanal espera en el Códice')}
            </button>
          )}

          {/* Calorie main: ring + details */}
          <div className="nutri-cal-main">
            <div className="nutri-cal-ring">
              <CircularProgress
                value={consumed}
                max={target}
                radius={58}
                strokeWidth={10}
                gradientStart={inRange ? '#5a7a3a' : over ? '#a43030' : '#c4a84e'}
                gradientEnd={inRange ? '#3a5a2a' : over ? '#7a1e1e' : '#8a7030'}
              >
                <div className="nutri-ring-center">
                  <div className="nutri-ring-val"><AnimatedNumber value={consumed} prefix="" locale={i18n.language === 'en' ? 'en-US' : 'es-AR'} duration={400} /></div>
                  <div className="nutri-ring-unit">kcal</div>
                  <div className={`nutri-ring-sub${progressPct > 100 ? ' nutri-red' : ''}`}>{progressPct}%</div>
                </div>
              </CircularProgress>
              {/* Second arc drawn over the full one: how far past target you went. */}
              {overflow > 0 && (
                <div
                  className="nutri-ring-overflow"
                  aria-hidden="true"
                  title={t('nutrify.exceededBy', 'Excedido por {{kcal}} kcal', { kcal: overflow })}
                >
                  <CircularProgress
                    value={overflow}
                    max={target}
                    radius={48}
                    strokeWidth={5}
                    trackColor="transparent"
                    gradientStart="#c25353"
                    gradientEnd="#7a1e1e"
                  />
                </div>
              )}
            </div>

            {/* El anillo de proteína que vivía acá se retiró: las MacroBars de
                abajo muestran proteína, carbohidratos y grasa contra su objetivo,
                y dos widgets para el mismo dato competían por la misma mirada. */}

            <div className="nutri-cal-details">
              <div className="nutri-cal-row">
                <span className="nutri-cal-label">
                  {over ? t('nutrify.exceeded', 'Excedido') : t('nutrify.remaining', 'Restantes')}
                </span>
                <span className={`nutri-cal-val ${inRange ? 'nutri-green' : over ? 'nutri-red' : ''}`}>
                  {over ? `-${Math.abs(remaining)}` : remaining} kcal
                </span>
              </div>
              <div className="nutri-cal-row">
                <span className="nutri-cal-label">
                  {t('nutrify.target', 'Objetivo')}
                  <HelpBubble variant="inline" text={t('nutrify.targetHelp', 'Tu objetivo se ajusta según tu nivel de actividad base y tu actividad reciente (gym, pasos) de los últimos 14 días.')} />
                </span>
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
                <span className={`nutri-cal-val nutri-cal-pct${progressPct > 100 ? ' nutri-red' : inRange ? ' nutri-green' : ''}`}>
                  {progressPct}%
                </span>
              </div>
            </div>
          </div>

          {/* Status message */}
          {(() => {
            const goal = getGoal(deficitTargetKcal);
            const tdee = summary?.tdee ?? 0;
            let status = getStatusMessage(t, goal, consumed, target, tdee);
            // Día con evento: la app acompaña, no juzga. Si el tono iba a ser
            // "bad" por pasarse, lo reemplaza el mensaje de evento — el vigor
            // no sufre y el registro ya cuenta como presentarse.
            if (dayHasEvent && status.tone === 'bad') {
              status = { text: t('nutrify.eventDayStatus', 'Día de evento: te presentaste igual y tu vigor no sufre.'), tone: 'muted' };
            }
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
      {dayClosed && (
        <div className="nutri-closed-banner">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <rect x="3" y="8" width="10" height="7" rx="1"/><path d="M5 8V5a3 3 0 0 1 6 0v3"/>
          </svg>
          <span className="nutri-closed-banner-text">
            {t('nutrify.dayClosedBanner', 'Este día está cerrado: no se pueden agregar ni editar comidas.')}
          </span>
          <button className="nutri-btn" onClick={handleReopenDay} disabled={reopening}>
            {reopening ? t('common.loading', 'Cargando...') : t('nutrify.reopenDay', 'Reabrir día')}
          </button>
        </div>
      )}

      {!dayClosed && (
        <div className="nutri-card">
          <HelpBubble text={t('nutrify.logFoodHelp', 'Describí lo que comiste en lenguaje natural y la IA estimará las calorías. Podés editar antes de confirmar.')} />
          <h3 className="nutri-card-title">
            <span className="nutri-t-ico"><Quill width={14} height={14} /></span>
            {t('nutrify.logFood', 'Registrar Comida')}
          </h3>

          <div className="nutri-input-mode-row">
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
            {/* El asado del domingo entra por acá: una sola entrada con banda
                honesta, sin culpa y sin romper la racha. */}
            <button
              type="button"
              className="nutri-btn nutri-btn-ghost nutri-event-btn"
              onClick={() => setEventOpen(true)}
              title={t('nutrify.eventButtonHint', 'Registrá un asado, cumple o salida como una sola entrada con banda estimada.')}
            >
              <Meat width={14} height={14} /> {t('nutrify.eventButton', 'Evento')}
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
                aria-label={t('nutrify.calories', 'Calorías')}
                onKeyDown={(e) => e.key === 'Enter' && foodInput.trim() && manualCalories && handleManualAdd()}
                style={{ width: 140, flexShrink: 0 }}
              />
              <RpgNumberInput
                value={manualProtein}
                onChange={setManualProtein}
                step={1} min={0} max={500}
                placeholder={t('nutrify.proteinManualPlaceholder', 'Prot. (g)')}
                aria-label={t('nutrify.proteinManualPlaceholder', 'Prot. (g)')}
                onKeyDown={(e) => e.key === 'Enter' && foodInput.trim() && manualCalories && handleManualAdd()}
                style={{ width: 120, flexShrink: 0 }}
              />
              <button
                className="nutri-btn"
                onClick={handleManualAdd}
                disabled={logging || !foodInput.trim() || !manualCalories}
              >
                {t('nutrify.add', 'Agregar')}
              </button>
            </div>
          ) : (
            <>
              <div className="nutri-food-input-row" ref={suggestAnchorRef}>
                <input
                  type="text"
                  placeholder={t('nutrify.foodInputPlaceholder', '¿Qué comiste? ej: milanesa con papas fritas')}
                  value={foodInput}
                  onChange={(e) => setFoodInput(e.target.value)}
                  className="nutri-text-input"
                  role="combobox"
                  aria-expanded={suggest.open}
                  aria-autocomplete="list"
                  aria-controls="nutri-suggest-popup"
                  onFocus={() => suggest.setFocused(true)}
                  onBlur={() => suggest.setFocused(false)}
                  onKeyDown={(e) => suggest.handleKeyDown(e, {
                    onChoose: handleLogSuggestion,
                    onComplete: handleCompleteSuggestion,
                    // Enter with nothing highlighted keeps meaning what it always
                    // meant. The list never steals the key by preselecting a row.
                    onSubmit: () => { if (!estimating) handleEstimate(); },
                  })}
                />
                <button className="nutri-btn" onClick={() => handleEstimate()}
                  disabled={estimating || !foodInput.trim()}>
                  {retrying
                    ? t('nutrify.retrying', 'Reintentando...')
                    : estimating
                      ? t('common.loading', 'Cargando...')
                      : t('nutrify.estimate', 'Estimar')}
                </button>
              </div>

              {suggest.open && (
                <FoodSuggestionList
                  suggestions={suggest.suggestions}
                  activeIndex={suggest.activeIndex}
                  mode={suggest.mode}
                  portion={1}
                  onHover={suggest.setActiveIndex}
                  onChoose={handleLogSuggestion}
                  popupRef={suggestPopupRef}
                  pos={suggestPos}
                  width={suggestWidth}
                />
              )}

              {/* Estimation result */}
              {estimation && (
                <div className="nutri-estimation">
                  {estimationCached && (
                    // A pergamino, not the AI sparkles: this number came out of
                    // your own confirmed history, not out of a model just now.
                    <div className="nutri-est-cached" title={t('nutrify.historyCachedHint', 'Ya habías registrado esto: reusamos el valor que confirmaste, sin llamar a la IA.')}>
                      <Scroll width={12} height={12} />
                      {t('nutrify.historyCached', 'Al instante')}
                    </div>
                  )}
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
                      disabled={logging || (estimation.items.length > 0 && liveBreakdown.items.length === 0)}
                    >
                      {logging ? t('common.loading', 'Cargando...') : t('nutrify.confirmLog', 'Confirmar y registrar')}
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
                    {estimationCached && (
                      // Escape hatch from the cache: the same "re-estimate" the
                      // food log offers, skipping the stored value and refreshing it.
                      <button className="nutri-btn nutri-btn-ghost" onClick={() => handleEstimate(true)} disabled={estimating}>
                        {t('nutrify.reEstimate', 'Re-estimar con IA')}
                      </button>
                    )}
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

      {/* «Repetir ayer» vivía DENTRO de la tarjeta de favoritos, que sólo se
          renderiza cuando ya hay un favorito guardado: el atajo para no tipear
          estaba escondido detrás de haber usado otro atajo. Ahora vive solo. */}
      {!dayClosed && (
        <div className="nutri-card nutri-repeat-card">
          <button
            type="button"
            className="nutri-btn nutri-btn-sm"
            onClick={handleRepeatYesterday}
            disabled={logging}
            title={t('nutrify.repeatYesterdayConfirm', 'Se van a copiar las comidas de ayer al día de hoy.')}
          >
            {t('nutrify.repeatYesterday', 'Repetir ayer')}
          </button>
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
                  <span key={f.id} className="nutri-fav-pill">
                    <button
                      className="nutri-btn nutri-pill"
                      onClick={() => handleLogFavorite(f)}
                      disabled={logging}
                      title={t('nutrify.favoriteLogTitle', 'Registrar {{name}} ({{kcal}} kcal)', {
                        name: f.description,
                        kcal: f.calories,
                      })}
                    >
                      {f.description} ({f.calories})
                    </button>
                    {/* Portion is per CLICK and macro-aware: the picker previews
                        what x1.5 does to protein/carbs/fat before anything is
                        logged. The staged chips this replaced leaked their
                        multiplier onto the NEXT pill you touched. */}
                    <button
                      type="button"
                      className="nutri-pill-portion"
                      onClick={() => openPortionFavorite(f)}
                      title={t('nutrify.adjustPortion', 'Ajustar porción')}
                      aria-label={t('nutrify.adjustPortion', 'Ajustar porción')}
                    >
                      <PortionGlyph />
                    </button>
                    <button
                      className="nutri-fav-remove tap-target"
                      onClick={() => handleRemoveFavorite(f.id, f.description)}
                      title={t('nutrify.favoriteRemove', 'Quitar de favoritos')}
                      aria-label={t('nutrify.favoriteRemove', 'Quitar de favoritos')}
                    >
                      <CrossMark width={10} height={10} />
                    </button>
                  </span>
                ))}
              </div>
              <p className="nutri-hint" style={{ fontSize: 'var(--fs-label)', marginTop: 6 }}>
                {t('nutrify.favoriteClickHint2', 'Click para registrar. La × quita el favorito.')}
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
              {t('nutrify.meals', { count: foods.length, defaultValue: '{{count}} comidas' })} {'\u00B7'} {consumed} kcal
            </span>
          )}
          {foods.length > 0 && !dayClosed && (
            <span className="nutri-card-menu">
              <button
                className="nutri-card-menu-btn tap-target"
                onClick={() => setLogMenuOpen(v => !v)}
                onBlur={() => setTimeout(() => setLogMenuOpen(false), 120)}
                aria-haspopup="menu"
                aria-expanded={logMenuOpen}
                aria-label={t('nutrify.logActions', 'Acciones del registro')}
                title={t('nutrify.logActions', 'Acciones del registro')}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
                  <circle cx="7" cy="2.5" r="1.3"/><circle cx="7" cy="7" r="1.3"/><circle cx="7" cy="11.5" r="1.3"/>
                </svg>
              </button>
              {logMenuOpen && (
                <div className="nutri-card-menu-list" role="menu">
                  <button
                    className="nutri-card-menu-item"
                    role="menuitem"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setLogMenuOpen(false); openRepeatPicker(); }}
                  >
                    {t('nutrify.repeatDayShort', 'Repetir día')}
                  </button>
                  <button
                    className="nutri-card-menu-item nutri-card-menu-item--danger"
                    role="menuitem"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setLogMenuOpen(false); handleDeleteDay(); }}
                  >
                    {t('nutrify.deleteDayButton', 'Eliminar día')}
                  </button>
                </div>
              )}
            </span>
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
              <FoodLogItem key={f.id} entry={f} isNew={lastAddedId === f.id} className="" readOnly={!!dayClosed} onDelete={handleDelete} onMealChange={handleMealChange} mealSchedule={mealSchedule} dayCutoffHour={dayCutoffHour} onFavorite={() => handleAddFavorite(f.description, f.calories, f.source || undefined, f.aiBreakdown || undefined)} onUpdate={async (id, fields) => {
                await window.api.nutritionUpdateFood(id, fields);
                loadData(date);
                notifyNutritionChanged();
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
          <span className="nutri-t-ico"><Scale width={14} height={14} /></span>
          {isPending ? t('nutrify.confirmDay', 'Confirmar Día') : t('nutrify.closeDay', 'Cierre del Día')}
        </h3>

        {dayClosed ? (
          <div>
            {/* Just closed in this session: keep the celebration, not the plain label. */}
            {justClosed
              ? <p className="nutri-day-status nutri-day-success">{t('nutrify.dayClosedSuccess', '¡Día cerrado exitosamente!')}</p>
              : <p className="nutri-day-status">{t('nutrify.dayClosed', 'Día cerrado')}</p>}
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
        ) : (
          <div className="nutri-close-day">
            <CloseDayStats consumed={consumed} target={target} showTarget={false} />
            <div className="nutri-reward-card">
              <button
                className="nutri-btn nutri-btn-ghost"
                style={{ width: '100%' }}
                onClick={() => setWeightPopup({ show: true, lastWeight: weightPopup.lastWeight })}
              >
                {t('nutrify.logWeight', 'Registrar peso')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Weight check-in popup ───────────────────── */}
      {weightPopup.show && (
        <div className="nutri-popup-overlay" onClick={handleWeightClose}>
          <div
            {...weightModal.dialogProps}
            className="nutri-popup"
            aria-label={t('nutrify.weightCheckin.title', 'Registro semanal de peso')}
            onClick={weightModal.stopPropagation}
          >
            <button
              className="nutri-popup-close tap-target"
              onClick={handleWeightClose}
              aria-label={t('common.close', 'Cerrar')}
              title={t('common.close', 'Cerrar')}
            >
              <CrossMark width={12} height={12} />
            </button>
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

      {/* ── Event popup (el asado) ──────────────────── */}
      {eventOpen && (
        <div className="nutri-popup-overlay" onClick={() => setEventOpen(false)}>
          <div
            {...eventModal.dialogProps}
            className="nutri-popup"
            aria-label={t('nutrify.eventFormTitle', 'Registrar evento')}
            onClick={eventModal.stopPropagation}
          >
            <button
              className="nutri-popup-close tap-target"
              onClick={() => setEventOpen(false)}
              aria-label={t('common.close', 'Cerrar')}
              title={t('common.close', 'Cerrar')}
            >
              <CrossMark width={12} height={12} />
            </button>
            <h3 className="nutri-popup-title">
              <Meat width={16} height={16} /> {t('nutrify.eventFormTitle', 'Registrar evento')}
            </h3>
            <p className="nutri-popup-hint">
              {t('nutrify.eventFormHint', 'Un asado no se cuenta al gramo. Elegí una banda honesta: se registra el punto medio como una sola comida, la racha sigue y tu vigor no sufre.')}
            </p>
            <label className="nutri-popup-field nutri-event-name-field">
              <span>{t('nutrify.eventNameLabel', 'Nombre')}</span>
              <input
                className="nutri-text-input"
                type="text"
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                placeholder={t('nutrify.eventDefaultName', 'Asado familiar')}
                autoFocus
              />
            </label>
            <div className="nutri-event-presets">
              {EVENT_BANDS.map((band) => {
                const active = eventMin === String(band.min) && eventMax === String(band.max);
                return (
                  <button
                    key={band.key}
                    type="button"
                    className={`nutri-portion-chip${active ? ' active' : ''}`}
                    aria-pressed={active}
                    onClick={() => { setEventMin(String(band.min)); setEventMax(String(band.max)); }}
                  >
                    {t(`nutrify.eventBand_${band.key}`, `${band.min}–${band.max}`)}
                  </button>
                );
              })}
            </div>
            <div className="nutri-event-band-row">
              <label className="nutri-popup-field">
                <span>{t('nutrify.eventKcalMin', 'Mín')}</span>
                <RpgNumberInput value={eventMin} onChange={setEventMin} step={100} min={1} max={9999} style={{ width: 110 }} />
              </label>
              <label className="nutri-popup-field">
                <span>{t('nutrify.eventKcalMax', 'Máx')}</span>
                <RpgNumberInput value={eventMax} onChange={setEventMax} step={100} min={1} max={9999} style={{ width: 110 }} />
              </label>
            </div>
            {(() => {
              const min = parseInt(eventMin); const max = parseInt(eventMax);
              const valid = isFinite(min) && isFinite(max) && min > 0 && max >= min;
              return valid ? (
                <p className="nutri-popup-hint nutri-event-midpoint">
                  {t('nutrify.eventMidpoint', 'Se registran ~{{kcal}} kcal (punto medio de {{min}}–{{max}}).', {
                    kcal: Math.round((min + max) / 2), min, max,
                  })}
                </p>
              ) : (
                <p className="nutri-popup-error">{t('nutrify.eventInvalidBand', 'La banda tiene que ser mín > 0 y máx ≥ mín.')}</p>
              );
            })()}
            <button
              className="nutri-btn nutri-btn-ghost"
              onClick={handleEventEstimate}
              disabled={eventEstimating}
              style={{ width: '100%', marginBottom: 8 }}
            >
              {eventEstimating ? t('common.loading', 'Cargando...') : t('nutrify.eventEstimateBand', 'Estimar banda con IA')}
            </button>
            <button
              className="nutri-btn nutri-btn-primary"
              onClick={handleLogEvent}
              disabled={eventSaving}
              style={{ width: '100%', marginBottom: 8 }}
            >
              {eventSaving ? t('common.loading', 'Cargando...') : t('nutrify.eventLogButton', 'Registrar evento')}
            </button>
            <button onClick={() => setEventOpen(false)} className="nutri-btn nutri-btn-ghost" style={{ width: '100%' }}>
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

      {/* Un solo cierre de día. Este footer abría un segundo ritual que pagaba
          XP por su cuenta y no se anunciaba en ningún lado (base real: 6
          cierres de Nutrify contra 1 sello del Códice). Ahora lleva al mismo
          Códice, que incluye el paso de nutrición cuando el día tiene comidas
          sin cerrar. Nada se paga dos veces: los dos backends ya rebotan un
          día ya cerrado / ya sellado. */}
      {!dayClosed && foods.length > 0 && (
        <div className="nutri-sticky-footer">
          <button
            className="rpg-button nutri-close-day-btn"
            disabled={consumed === 0}
            title={consumed === 0
              ? t('nutrify.closeDayDisabled', 'Registrá al menos una comida para poder cerrar el día')
              : t('nutrify.closeDayTitleCodex', 'Cerrá el día en el Códice, el diario de tus días: comidas y sello en un solo paso')}
            onClick={() => openCodex(date)}
          >
            {t('nutrify.closeDayInCodex', 'Cerrar el día en el Códice')}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Glifo de «ajustar porción»: un círculo con una porción separada. Antes era
 * una × idéntica a la de «quitar favorito», que vive pegada al lado — dos
 * botones con el mismo dibujo y sentidos opuestos.
 */
function PortionGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor"
      strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 1.2a4.8 4.8 0 1 0 0 9.6" />
      <path d="M7.4 1.5l3.3 3.3-3.3 3.3z" />
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
  // Los otros popups del módulo tienen trampa de foco, Escape a nivel ventana y
  // × de cerrar; éste no tenía ninguna de las tres. El `onKeyDown` del overlay
  // no se dispara nunca hasta que algo de adentro toma el foco.
  const modal = useModalA11y({ onClose });
  const dayLabel = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const obj = new Date(y, m - 1, d);
    return obj.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'short' });
  };
  return (
    <div className="nutri-popup-overlay" onClick={onClose}>
      <div
        {...modal.dialogProps}
        className="nutri-popup"
        aria-label={t('nutrify.repeatDayTitle', 'Repetir el festín de…')}
        onClick={modal.stopPropagation}
      >
        <button
          className="nutri-popup-close tap-target"
          onClick={onClose}
          aria-label={t('common.close', 'Cerrar')}
          title={t('common.close', 'Cerrar')}
        >
          <CrossMark width={12} height={12} />
        </button>
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
                    {t('nutrify.meals', { count: day.meals, defaultValue: '{{count}} comidas' })} {'·'} {day.calories.toLocaleString(locale)} kcal
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
  const modal = useModalA11y({ onClose });
  const scaled = scalePortion(
    { calories: baseCalories, proteinG: baseProteinG, carbsG: baseCarbsG, fatG: baseFatG },
    factor,
  );
  const hasMacros = scaled.proteinG != null || scaled.carbsG != null || scaled.fatG != null;
  return (
    <div className="nutri-popup-overlay" onClick={onClose}>
      <div
        {...modal.dialogProps}
        className="nutri-popup"
        aria-label={t('nutrify.portionTitle', 'Ajustar porción')}
        onClick={modal.stopPropagation}
      >
        <button
          className="nutri-popup-close tap-target"
          onClick={onClose}
          aria-label={t('common.close', 'Cerrar')}
          title={t('common.close', 'Cerrar')}
        >
          <CrossMark width={12} height={12} />
        </button>
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
            aria-label={t('nutrify.portionFactor', 'Porciones')}
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

function CloseDayStats({ consumed, target, showTarget = true }: { consumed: number; target: number; showTarget?: boolean }) {
  const { t } = useTranslation();
  const diff = target - consumed;
  // Never clamp: the number is the only place the overshoot is visible.
  const pct = target > 0 ? Math.round((consumed / target) * 100) : 0;

  return (
    <div className="nutri-close-stats">
      <div className="nutri-close-stat">
        <span className="nutri-cs-label">{t('nutrify.caloriesConsumed', 'Calorías consumidas')}</span>
        <span className="nutri-cs-val">{consumed}</span>
        <span className="nutri-cs-sub">kcal</span>
      </div>
      {showTarget && (
        <div className="nutri-close-stat">
          <span className="nutri-cs-label">{t('nutrify.target', 'Objetivo')}</span>
          <span className="nutri-cs-val">{target}</span>
          <span className="nutri-cs-sub">kcal</span>
        </div>
      )}
      <div className="nutri-close-stat">
        <span className="nutri-cs-label">{t('nutrify.difference', 'Diferencia')}</span>
        <span className={`nutri-cs-val ${diff >= 0 ? 'nutri-green' : 'nutri-red'}`}>
          {diff >= 0 ? `+${diff}` : diff}
        </span>
        <span className="nutri-cs-sub">kcal</span>
      </div>
      <div className="nutri-close-stat">
        <span className="nutri-cs-label">{t('nutrify.progress', 'Progreso')}</span>
        <span className={`nutri-cs-val nutri-cs-pct${pct > 100 ? ' nutri-red' : ''}`}>{pct}%</span>
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
                {/* Rótulo de estadística, no la sigla del par «XP y HP»: acá el
                    número va solo y el sello de ayuda de al lado ya dice «Vigor».
                    Mismo criterio que hpExplanation, scoringBands y dayStatus.over. */}
                {data.hpChange >= 0 ? '+' : ''}{data.hpChange} {t('rpg.vigor', 'Vigor')}
              </span>
              <HelpBubble variant="inline" text={t('nutrify.hpExplanation', 'Vigor según cercanía al objetivo: dentro del rango = +Vigor, fuera del rango = -Vigor')} />
            </>
          )}
        </span>
      </div>
    </div>
  );
}

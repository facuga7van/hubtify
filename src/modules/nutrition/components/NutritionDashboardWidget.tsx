import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { RingGauge, Rune } from '../../../shared/components/codex';
import { SparklineChart } from '../../../shared/components/charts';
import { useToast } from '../../../shared/components/useToast';
// resolveEstimate = the SQLite estimate cache in front of estimateNutrition.
// The widget used to call the model directly, so a dish logged from the
// dashboard neither benefited from a correction nor left one behind.
import { resolveEstimate } from '../estimate-with-cache';
import { cacheEstimate } from '../history-api';
import { resolveMealType } from '../../../../shared/meal-utils';
import type { MealSchedule } from '../../../../shared/meal-utils';
import { nutritionToday, DEFAULT_DAY_CUTOFF_HOUR } from '../nutrition-day';
import { notifyNutritionChanged } from '../notify';
import type { NutritionProfile } from '../types';
import { subscribeQuickCreate, revealWidget } from '../../../hub/widgets/quick-create';
import { pickQuickMeals, type QuickMealSource, type FavoriteLike, type FrequentLike } from '../quick-meals';

export default function NutritionDashboardWidget() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const [calories, setCalories] = useState(0);
  const [target, setTarget] = useState<number | null>(null);
  const [weekCalories, setWeekCalories] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Quick-estimate states
  const [showQuickLog, setShowQuickLog] = useState(false);
  const [foodInput, setFoodInput] = useState('');
  const [estimating, setEstimating] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [estimation, setEstimation] = useState<{
    totalCalories: number;
    items: Array<{ name: string; calories: number }>;
    proteinG: number | null; carbsG: number | null; fatG: number | null;
  } | null>(null);
  const [showManualFallback, setShowManualFallback] = useState(false);
  const [manualCalories, setManualCalories] = useState('');
  const [mealSchedule, setMealSchedule] = useState<MealSchedule | null>(null);
  // Cached with the profile the widget already loads: the widget must write its
  // logs to the SAME day the backend counts them on (see nutrition-day.ts).
  const [dayCutoffHour, setDayCutoffHour] = useState(0);
  /** Favoritos + frecuentes, ya fusionados y deduplicados. */
  const [quickMeals, setQuickMeals] = useState<QuickMealSource[]>([]);
  const [repeating, setRepeating] = useState(false);

  /** Same meal resolution the full page uses, so widget entries are not orphaned with a "?". */
  const resolveNowMeal = useCallback(() => {
    const now = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const resolved = resolveMealType(now, mealSchedule, dayCutoffHour);
    return resolved.ambiguous.length === 0 ? resolved.meal : undefined;
  }, [mealSchedule, dayCutoffHour]);

  const loadData = useCallback(() => {
    Promise.all([
      window.api.nutritionGetTodayCalories(),
      window.api.nutritionGetTodayTarget(),
      window.api.nutritionGetWeekCalories(),
      window.api.nutritionGetMealSchedule(),
      window.api.nutritionGetProfile(),
      // Los atajos vivían sólo dentro de /nutrition: desde el hub, hasta el
      // café de todos los días pagaba un viaje a la Cloud Function.
      window.api.nutritionGetFavoriteFoods().catch(() => []),
      window.api.nutritionGetFrequentFoods().catch(() => []),
    ]).then(([c, t, wk, schedule, prof, favs, freqs]) => {
      setCalories(c);
      setTarget(t);
      setWeekCalories(wk);
      setMealSchedule(schedule ?? null);
      setDayCutoffHour((prof as NutritionProfile | null)?.dayCutoffHour ?? DEFAULT_DAY_CUTOFF_HOUR);
      setQuickMeals(pickQuickMeals(favs as FavoriteLike[], freqs as FrequentLike[]));
      setLoading(false);
    }).catch(() => { setLoadError(true); setLoading(false); });
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Reload on account switch, settings change and sync - the page does all three.
  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener('account:switched', handler);
    window.addEventListener('nutrition:settingsChanged', handler);
    window.addEventListener('sync:nutritionUpdated', handler);
    return () => {
      window.removeEventListener('account:switched', handler);
      window.removeEventListener('nutrition:settingsChanged', handler);
      window.removeEventListener('sync:nutritionUpdated', handler);
    };
  }, [loadData]);

  // The dashboard's "Registrá una comida" now opens this form instead of
  // dropping the user on /nutrition, where a profile gate was waiting.
  useEffect(() => subscribeQuickCreate('meal', () => {
    setShowQuickLog(true);
    revealWidget(rootRef.current);
  }), []);

  // ── Quick-estimate handlers ──────────────────────
  const handleEstimate = async () => {
    if (!foodInput.trim() || estimating) return;
    setEstimating(true);
    setRetrying(false);
    setEstimation(null);
    setShowManualFallback(false);
    try {
      const result = await resolveEstimate(foodInput.trim(), { onRetry: () => setRetrying(true) });
      setEstimation({
        totalCalories: result.totalCalories,
        items: result.items,
        proteinG: result.proteinG,
        carbsG: result.carbsG,
        fatG: result.fatG,
      });
      // A later success has to close the fallback, otherwise it stays open forever.
      setShowManualFallback(false);
    } catch {
      setEstimation(null);
      setShowManualFallback(true);
    } finally {
      setEstimating(false);
      setRetrying(false);
    }
  };

  // One write at a time: a double click on Confirmar logged the meal twice
  // (two rows, two MEAL_LOGGED). The ref answers before React re-renders.
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

  /** The one backend refusal worth naming: the nutritional day is already sealed. */
  const logErrorMessage = (err: unknown) =>
    /closed day/i.test(err instanceof Error ? err.message : String(err))
      ? t('nutrify.dayClosedBanner', 'Este día está cerrado: no se pueden agregar ni editar comidas.')
      : t('nutrify.logError', 'Error al registrar');

  const handleConfirm = () => withLogGuard(async () => {
    if (!estimation) return;
    try {
      await window.api.nutritionLogFood({
        // Local date, never UTC: past 21:00 in UTC-3 the UTC slice is tomorrow.
        date: nutritionToday(dayCutoffHour),
        description: foodInput.trim(),
        calories: estimation.totalCalories,
        source: 'ai_estimate',
        aiBreakdown: estimation.items.length > 1 ? JSON.stringify(estimation.items) : undefined,
        proteinG: estimation.proteinG,
        carbsG: estimation.carbsG,
        fatG: estimation.fatG,
        meal: resolveNowMeal(),
      });
      // Same rule as Today: what the user confirmed is worth remembering. The
      // widget has no per-item editing, so the number is never a correction.
      await cacheEstimate({
        description: foodInput.trim(),
        calories: estimation.totalCalories,
        aiBreakdown: estimation.items.length > 1 ? JSON.stringify(estimation.items) : null,
        proteinG: estimation.proteinG,
        carbsG: estimation.carbsG,
        fatG: estimation.fatG,
        corrected: false,
      });
      await window.api.processRpgEvent({
        type: 'MEAL_LOGGED',
        moduleId: 'nutrition',
        payload: { xp: 10, hp: 0 },
        timestamp: Date.now(),
      });
      toast({ type: 'nutri', message: `+${estimation.totalCalories} kcal` });
      setFoodInput('');
      setEstimation(null);
      setShowQuickLog(false);
      loadData();
      window.dispatchEvent(new Event('rpg:statsChanged'));
      notifyNutritionChanged();
    } catch (err) {
      toast({ type: 'warning', message: logErrorMessage(err) });
    }
  });

  /** Un toque, cero red: la comida ya está descrita y contada. */
  const handleQuickMeal = (meal: QuickMealSource) => withLogGuard(async () => {
    try {
      await window.api.nutritionLogFood({
        date: nutritionToday(dayCutoffHour),
        description: meal.description,
        calories: meal.calories,
        source: meal.kind === 'favorite' ? 'favorite' : 'frequent',
        aiBreakdown: meal.aiBreakdown ?? undefined,
        proteinG: meal.proteinG ?? null,
        carbsG: meal.carbsG ?? null,
        fatG: meal.fatG ?? null,
        meal: resolveNowMeal(),
      });
      if (meal.frequentId != null) {
        await window.api.nutritionIncrementFrequentUsage(meal.frequentId).catch(() => undefined);
      }
      await window.api.processRpgEvent({
        type: 'MEAL_LOGGED', moduleId: 'nutrition',
        payload: { xp: 10, hp: 0 }, timestamp: Date.now(),
      });
      toast({ type: 'nutri', message: `+${meal.calories} kcal` });
      loadData();
      window.dispatchEvent(new Event('rpg:statsChanged'));
      notifyNutritionChanged();
    } catch (err) {
      toast({ type: 'warning', message: logErrorMessage(err) });
    }
  });

  /** El día entero de ayer, copiado. El atajo más barato que existe. */
  const handleRepeatYesterday = async () => {
    if (repeating) return;
    setRepeating(true);
    try {
      const res = await window.api.nutritionCopyDay({ to: nutritionToday(dayCutoffHour) });
      if (!res?.success) {
        toast({
          type: 'info',
          message: t('nutrify.repeatYesterdayEmpty', 'Ayer no registraste ninguna comida.'),
        });
        return;
      }
      // Un solo evento por la copia entera, igual que en /nutrition: copiar un
      // día no vale un MEAL_LOGGED por plato.
      await window.api.processRpgEvent({
        type: 'MEAL_LOGGED', moduleId: 'nutrition',
        payload: { xp: 10, hp: 0, source: 'copy_day', copied: res.copied },
        timestamp: Date.now(),
      });
      toast({
        type: 'nutri',
        message: t('nutrify.repeatYesterdayDone', 'Comidas de ayer copiadas'),
      });
      loadData();
      window.dispatchEvent(new Event('rpg:statsChanged'));
      notifyNutritionChanged();
    } catch (err) {
      toast({ type: 'warning', message: logErrorMessage(err) });
    } finally {
      setRepeating(false);
    }
  };

  const handleDismiss = () => {
    setEstimation(null);
    setFoodInput('');
    setShowQuickLog(false);
  };

  if (loading)
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '6px 0 10px' }}>
        <div style={{ width: 68, height: 68, borderRadius: '50%', background: 'rgba(74,55,32,.1)' }} />
        <div style={{ flex: 1 }}>
          <div style={{ height: 10, background: 'rgba(74,55,32,.1)', marginBottom: 4 }} />
          <div style={{ height: 10, background: 'rgba(74,55,32,.08)', width: '70%' }} />
        </div>
      </div>
    );

  if (loadError)
    return (
      <p style={{ fontSize: 'var(--fs-label)', color: 'var(--rubric)' }}>
        {t('common.somethingWentWrong', 'Something went wrong')}
      </p>
    );

  const effectiveTarget = target && target > 0 ? target : 2000;
  const pct = Math.round((calories / effectiveTarget) * 100);
  const isSetup = target && target > 0;

  return (
    <div ref={rootRef}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '6px 0 10px' }}>
        {/* A ring filled against a target the user never set is a lie with a
            progress bar. Without a target we just show what was logged. */}
        {isSetup ? (
          <RingGauge value={calories} max={effectiveTarget} size={68} label="kcal" />
        ) : (
          <div className="nutri-dash-plain-total" aria-label={`${calories} kcal`}>
            <span className="qb-numeral">{calories}</span>
            <span className="qb-hand">kcal</span>
          </div>
        )}
        <div style={{ flex: 1 }}>
          {isSetup ? (
            <>
              <div style={{ fontSize: 'var(--fs-label)', color: 'var(--ink)' }}>
                <span className="qb-numeral" style={{ fontSize: 'var(--fs-nav)' }}>{calories}</span>
                <span className="qb-hand" style={{ marginLeft: 4 }}>{t('nutrify.ofTarget', 'de')} {effectiveTarget} kcal</span>
              </div>
              <div className="qb-hand" style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-faded)', marginTop: 2 }}>
                {pct}% {t('nutrify.ofDailyTarget', 'del objetivo diario')}
              </div>
            </>
          ) : (
            /* The old notice said "Configuración requerida" — untrue: logging
               works without a profile, and the gauge silently used a made-up
               2000 kcal. Now it names what is missing and goes to fix it. */
            <div className="nutri-empty nutri-dash-setup">
              <p className="nutri-dash-setup__text">
                {t('nutrify.targetNotSet', 'Todavía no fijaste tu meta diaria. Podés registrar igual: el anillo se llena cuando la definas.')}
              </p>
              <button
                type="button"
                className="widget-empty-cta"
                onClick={() => navigate('/nutrition')}
              >
                {t('nutrify.targetNotSetCta', 'Calculá tu meta')}
              </button>
            </div>
          )}
        </div>
        {weekCalories.length >= 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <SparklineChart data={weekCalories} width={80} height={24} color="var(--rpg-hp-red)" showArea />
            <span className="qb-hand" style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-soft)' }}>
              {t('nutrify.weekTrend', '7d trend')}
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 8,
          paddingTop: 6,
          borderTop: '1px solid rgba(74,55,32,.2)',
          fontSize: 'var(--fs-label)',
        }}
      >
        <span className="qb-hand">
          {calories > 0 ? `${calories} ${t('nutrify.kcalLogged', 'kcal registradas')}` : t('nutrify.noFood', 'Sin comidas registradas')}
        </span>
        {isSetup && (
          <Rune tone={pct >= 80 && pct <= 120 ? 'sage' : pct > 120 ? 'rubric' : undefined}>
            {pct >= 80 && pct <= 120
              ? t('nutrify.balanceFavorable', 'balance favorable')
              : pct > 120
                ? t('nutrify.excess', 'exceso')
                : t('nutrify.inProgress', 'en curso')}
          </Rune>
        )}
      </div>

      {/* Atajos de repetición: un toque, cero red. Vivían sólo dentro de
          /nutrition, así que desde el hub hasta el café de todos los días
          pagaba un viaje a la Cloud Function (35 s de timeout). */}
      {(quickMeals.length > 0 || calories === 0) && (
        <div className="nutri-dash-repeat">
          {quickMeals.map((meal) => (
            <button
              key={meal.key}
              type="button"
              className="nutri-btn nutri-pill nutri-dash-repeat__pill"
              disabled={logging}
              onClick={() => handleQuickMeal(meal)}
              title={t('nutrify.favoriteLogTitle', 'Registrar {{name}} ({{kcal}} kcal)', {
                name: meal.description, kcal: meal.calories,
              })}
            >
              <span className="nutri-dash-repeat__name">{meal.description}</span>
              <span className="nutri-dash-repeat__kcal qb-numeral">{meal.calories}</span>
            </button>
          ))}
          <button
            type="button"
            className="nutri-btn nutri-btn-sm nutri-dash-repeat__yesterday"
            disabled={repeating || logging}
            onClick={handleRepeatYesterday}
            title={t('nutrify.repeatYesterdayConfirm', 'Se van a copiar las comidas de ayer al día de hoy.')}
          >
            {t('nutrify.repeatYesterday', 'Repetir ayer')}
          </button>
        </div>
      )}

      {/* Quick-estimate toggle */}
      <div className="nutri-dash-quick-toggle">
        <button
          className="rpg-button nutri-dash-quick-btn"
          onClick={() => { setShowQuickLog(prev => !prev); if (showQuickLog) { setEstimation(null); setFoodInput(''); } }}
        >
          {showQuickLog ? t('nutrify.closeEstimate', 'Cerrar') : t('nutrify.estimate', 'Estimar')}
        </button>
      </div>

      {/* Quick-estimate form */}
      {showQuickLog && (
        <div className="nutri-dash-quick-form">
          <div className="nutri-dash-quick-input-row">
            <input
              className="rpg-input nutri-dash-quick-input"
              type="text"
              placeholder={t('nutrify.estimatePlaceholder', 'milanesa con pure...')}
              value={foodInput}
              onChange={e => setFoodInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleEstimate(); }}
              disabled={estimating}
            />
            <button
              className="rpg-button nutri-dash-quick-submit"
              onClick={handleEstimate}
              disabled={estimating || !foodInput.trim()}
            >
              {retrying
                ? t('nutrify.retrying', 'Reintentando...')
                : estimating
                  ? t('nutrify.estimating', 'Estimando...')
                  : t('nutrify.estimate', 'Estimar')}
            </button>
          </div>

          {/* Estimation result */}
          {estimation && (
            <div className="nutri-dash-quick-result">
              {estimation.items.length > 1 && (
                <ul className="nutri-dash-quick-items">
                  {estimation.items.map((item, i) => (
                    <li key={i} className="nutri-dash-quick-item">
                      <span className="qb-hand">{item.name}</span>
                      <span className="qb-numeral">{item.calories} kcal</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="nutri-dash-quick-total">
                <span className="qb-hand">{t('nutrify.total', 'Total')}</span>
                <span className="qb-numeral">{estimation.totalCalories} kcal</span>
              </div>
              <div className="nutri-dash-quick-actions">
                <button className="rpg-button nutri-dash-quick-confirm" onClick={handleConfirm} disabled={logging}>
                  {t('nutrify.confirm', 'Confirmar')}
                </button>
                <button className="nutri-dash-quick-cancel" onClick={handleDismiss}>
                  {t('common.cancel', 'Cancelar')}
                </button>
              </div>
            </div>
          )}

          {/* Manual fallback on AI error */}
          {showManualFallback && (
            <>
            <p className="qb-hand" style={{ fontSize: 'var(--fs-label)', color: 'var(--ink-faded)', fontStyle: 'italic', margin: '8px 0 0' }}>
              {t('nutrify.aiUnavailableShort', 'Estimación IA no disponible — ingresá manual')}
            </p>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <input
                className="rpg-input"
                type="number"
                placeholder="kcal"
                value={manualCalories}
                onChange={(e) => setManualCalories(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                className="rpg-button"
                disabled={logging || !manualCalories || Number(manualCalories) <= 0}
                onClick={() => withLogGuard(async () => {
                  const cal = Number(manualCalories);
                  // With the day closed, `nutrition:logFood` throws — this used
                  // to be an unhandled rejection with the number stuck in the input.
                  try {
                    await window.api.nutritionLogFood({
                      date: nutritionToday(dayCutoffHour),
                      description: foodInput.trim() || t('nutrify.manualEntry', 'Entrada manual'),
                      calories: cal,
                      source: 'manual',
                      meal: resolveNowMeal(),
                    });
                    const rpgResult = await window.api.processRpgEvent({
                      type: 'MEAL_LOGGED',
                      moduleId: 'nutrition',
                      // Same reward as logging from the Nutrify page - the entry is identical.
                      payload: { xp: 10, hp: 0, calories: cal },
                      timestamp: Date.now(),
                    });
                    toast({ type: 'xp', message: `+${rpgResult.xpGained} XP` });
                    window.dispatchEvent(new Event('rpg:statsChanged'));
                    notifyNutritionChanged();
                    setShowManualFallback(false);
                    setManualCalories('');
                    setFoodInput('');
                    loadData();
                  } catch (err) {
                    toast({ type: 'warning', message: logErrorMessage(err) });
                  }
                })}
              >
                {t('nutrify.confirm', 'Confirmar')}
              </button>
            </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

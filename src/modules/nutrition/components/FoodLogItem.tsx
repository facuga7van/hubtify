import { useState, memo, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../../shared/components/useToast';
import { registerFood } from '../../../shared/animations/feedback';
import { DawnSun, NoonSun, MoonCrescent, Herb, Platter, Heart, Chalice, Meat } from '../../../shared/components/icons';
import { resolveMealType, MEAL_ORDER } from '../../../../shared/meal-utils';
import type { MealType, MealSchedule } from '../../../../shared/meal-utils';
import { estimateNutrition } from '../estimate-service';
import { cacheEstimate } from '../history-api';
import { usePopoverRegistration } from '../../../shared/hooks/usePopoverRegistration';

interface BreakdownItem {
  name: string;
  calories: number;
}

interface FoodEntry {
  id: number; time: string; description: string; calories: number;
  source: string; aiBreakdown?: string | null;
  meal?: string | null;
  proteinG?: number | null;
  /** 1 = evento (asado): calories es el punto medio de la banda min-max. */
  isEvent?: number;
  eventKcalMin?: number | null;
  eventKcalMax?: number | null;
}

interface Props {
  entry: FoodEntry;
  onDelete: (id: number) => void;
  onUpdate: (id: number, fields: { description?: string; calories?: number; aiBreakdown?: string; source?: string }) => void;
  onMealChange?: (id: number, meal: string) => void;
  onFavorite?: () => void;
  mealSchedule?: MealSchedule | null;
  /** Profile cutoff hour, so a 01:00 entry reads as last night's dinner. */
  dayCutoffHour?: number;
  readOnly?: boolean;
  className?: string;
  isNew?: boolean;
}

const MEAL_ICON_MAP: Record<MealType, React.ReactNode> = {
  breakfast: <DawnSun width={16} height={16} />,
  lunch: <NoonSun width={16} height={16} />,
  merienda: <Chalice width={16} height={16} />,
  dinner: <MoonCrescent width={16} height={16} />,
  snack: <Herb width={16} height={16} />,
};

function getMealLabel(meal: MealType, t: ReturnType<typeof useTranslation>['t']): string {
  const key = `nutrify.meal${meal.charAt(0).toUpperCase() + meal.slice(1)}`;
  const fallback: Record<MealType, string> = {
    breakfast: 'Desayuno', lunch: 'Almuerzo', merienda: 'Merienda', dinner: 'Cena', snack: 'Snack',
  };
  return t(key, fallback[meal]);
}

function getMealForEntry(entry: FoodEntry, schedule?: MealSchedule | null, cutoffHour = 0): MealType {
  if (entry.meal) return entry.meal as MealType;
  return resolveMealType(entry.time, schedule, cutoffHour).meal;
}

export default memo(function FoodLogItem({ entry, onDelete, onUpdate, onMealChange, onFavorite, mealSchedule, dayCutoffHour = 0, readOnly, className, isNew }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editCals, setEditCals] = useState(String(entry.calories));
  const [editDesc, setEditDesc] = useState(entry.description);
  const [expanded, setExpanded] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [mealDropdown, setMealDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  // Mirrors of state the blur handler must read synchronously: a blur can fire
  // in the same tick that closes the row (Enter, Cancel) or while the model is
  // still answering, and neither of those may turn into a second save.
  const editClosedRef = useRef(false);
  const estimatingRef = useRef(false);

  const currentMeal = getMealForEntry(entry, mealSchedule, dayCutoffHour);

  const breakdownItems = useMemo<BreakdownItem[]>(() => {
    if (!entry.aiBreakdown) return [];
    try {
      const parsed = JSON.parse(entry.aiBreakdown);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].name && typeof parsed[0].calories === 'number') {
        return parsed;
      }
    } catch { /* invalid JSON */ }
    return [];
  }, [entry.aiBreakdown]);
  const hasBreakdown = breakdownItems.length > 1;

  useEffect(() => {
    if (isNew && rowRef.current) {
      registerFood(rowRef.current);
    }
  // Only fire on mount when isNew is true
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close meal dropdown on click outside
  useEffect(() => {
    if (!mealDropdown) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMealDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [mealDropdown]);

  const openEdit = () => {
    setEditCals(String(entry.calories));
    setEditDesc(entry.description);
    editClosedRef.current = false;
    setEditing(true);
  };

  const cancelEdit = () => {
    editClosedRef.current = true;
    setEditing(false);
  };

  // A row in edit mode is "something open": the Android back button cancels
  // it (the draft is discarded, openEdit reseeds from the entry) instead of
  // leaving the page (NUT-01 d, QA 0.9.1).
  usePopoverRegistration(editing, cancelEdit);

  const handleSave = () => {
    if (editClosedRef.current) return;
    const newCals = parseInt(editCals);
    if (isNaN(newCals) || newCals <= 0) return;
    const desc = editDesc.trim() || entry.description;
    editClosedRef.current = true;
    onUpdate(entry.id, { description: desc, calories: newCals });
    // A hand-typed correction is the best number this description will ever
    // have — better than the estimate it replaces — so the cache takes it
    // instead of being invalidated. The AI breakdown goes, since it no longer
    // sums to the total the user just chose.
    if (newCals !== entry.calories || desc !== entry.description) {
      cacheEstimate({ description: desc, calories: newCals, corrected: true });
    }
    setEditing(false);
  };

  /** Enter on EITHER input saves; Escape cancels. IME composition is left alone. */
  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
  };

  /**
   * Focus leaving the row (tap outside, Tab away) SAVES — on a phone that is
   * the natural "done" gesture, and losing a typed correction to a stray tap
   * is worse than keeping it. Moving between the row's own controls is not a
   * leave. The action buttons cancel the focus change on pointerdown, so
   * Cancel is never pre-empted by a blur-save; an invalid kcal value keeps the
   * row open (handleSave refuses it) with Cancel still at hand.
   */
  const handleRowBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (editClosedRef.current || estimatingRef.current) return;
    const next = e.relatedTarget as Node | null;
    if (next && rowRef.current?.contains(next)) return;
    handleSave();
  };

  /**
   * Deliberately goes STRAIGHT to the model, past the estimate cache — asking
   * again is the entire purpose of the button, and answering it from the cache
   * would return the very number the user is rejecting. The fresh answer then
   * REFRESHES the cache, so the next person to type this description gets the
   * corrected value instantly instead of the stale one.
   */
  const handleReEstimate = async () => {
    const desc = editDesc.trim();
    if (!desc) return;
    setEstimating(true);
    estimatingRef.current = true;
    try {
      const result = await estimateNutrition(desc);
      setEditCals(String(result.calories));
      onUpdate(entry.id, {
        description: desc,
        calories: result.calories,
        aiBreakdown: JSON.stringify(result.items),
        source: 'ai_estimate',
      });
      await cacheEstimate({
        description: desc,
        calories: result.calories,
        aiBreakdown: JSON.stringify(result.items),
      });
      editClosedRef.current = true;
      setEditing(false);
    } catch {
      toast({ type: 'warning', message: t('nutrify.estimationFailed', 'Estimation failed — edit manually') });
    } finally {
      setEstimating(false);
      estimatingRef.current = false;
    }
  };

  if (editing) {
    return (
      <div ref={rowRef} className={`nutri-meal-row nutri-meal-row--edit nutri-pulse-gold ${className || ''}`} onBlur={handleRowBlur}>
        <div className="nutri-meal-ico">{MEAL_ICON_MAP[currentMeal] ?? <Platter width={16} height={16} />}</div>
        <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)}
          aria-label={t('nutrify.editDescriptionLabel', 'Descripción de la comida')}
          className="nutri-text-input nutri-meal-edit-input" onKeyDown={handleEditKeyDown} />
        <input type="number" inputMode="numeric" value={editCals} onChange={(e) => setEditCals(e.target.value)}
          aria-label={t('nutrify.calories', 'Calorías')}
          className="nutri-text-input nutri-meal-edit-input" onKeyDown={handleEditKeyDown} />
        {/* pointerdown is cancelled so the inputs keep focus: no blur-save races the button's own click. */}
        <div className="nutri-meal-edit-actions" onPointerDown={(e) => e.preventDefault()}>
          <button type="button" className="nutri-btn" onClick={handleSave} disabled={estimating}>
            {t('common.save', 'Guardar')}
          </button>
          <button type="button" className="nutri-btn nutri-btn-ghost" onClick={cancelEdit} disabled={estimating}>
            {t('common.cancel', 'Cancelar')}
          </button>
          <button type="button" className="nutri-btn nutri-btn-ghost nutri-meal-edit-ai" onClick={handleReEstimate}
            disabled={estimating || !editDesc.trim()}
            aria-label={t('nutrify.reEstimate', 'Re-estimar con IA')} title={t('nutrify.reEstimate', 'Re-estimar con IA')}>
            {estimating ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true">
                <circle cx="7" cy="7" r="5.5" opacity="0.3"/><path d="M7 1.5a5.5 5.5 0 0 1 4.76 2.75" strokeWidth="1.5"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" stroke="none" aria-hidden="true">
                <path d="M7 0l.9 2.8h2.9l-2.4 1.7.9 2.8L7 5.6 4.7 7.3l.9-2.8L3.2 2.8h2.9z"/>
                <path d="M11.5 5l.5 1.6h1.7l-1.4 1 .5 1.6-1.3-1-1.4 1 .5-1.6-1.3-1h1.7z" opacity="0.7"/>
                <path d="M2.5 8l.4 1.2h1.3l-1 .8.4 1.2-1.1-.8-1 .8.4-1.2-1.1-.8h1.3z" opacity="0.5"/>
              </svg>
            )}
            <span>{t('nutrify.reEstimateShort', 'IA')}</span>
          </button>
        </div>
      </div>
    );
  }

  const isEvent = !!entry.isEvent;
  const hasBand = isEvent && entry.eventKcalMin != null && entry.eventKcalMax != null;

  return (
    <div ref={rowRef} className={`nutri-meal-item-wrap ${className || ''}`} style={mealDropdown ? { position: 'relative', zIndex: 'var(--z-dropdown-top)' } : undefined}>
      <div className={`nutri-meal-row${isEvent ? ' nutri-meal-row--event' : ''}`}>
        <div className="nutri-meal-ico" ref={dropdownRef} style={{ position: 'relative' }}>
          <button
            type="button"
            className="nutri-meal-ico-btn"
            onClick={() => { if (!readOnly && onMealChange) setMealDropdown(v => !v); }}
            disabled={readOnly || !onMealChange}
            aria-haspopup={onMealChange ? 'menu' : undefined}
            aria-expanded={onMealChange ? mealDropdown : undefined}
            aria-label={t('nutrify.changeMealLabel', 'Momento: {{meal}}. Cambiar', { meal: getMealLabel(currentMeal, t) })}
            title={getMealLabel(currentMeal, t)}
          >
            {MEAL_ICON_MAP[currentMeal] ?? <Platter width={16} height={16} />}
          </button>
          {!entry.meal && !readOnly && onMealChange && (
            <button
              type="button"
              className="nutri-meal-unresolved"
              title={t('nutrify.pickMeal', 'Elegí la comida')}
              aria-label={t('nutrify.pickMeal', 'Elegí la comida')}
              onClick={() => setMealDropdown(v => !v)}
            >?</button>
          )}
          {mealDropdown && (
            <div className="nutri-meal-picker">
              {MEAL_ORDER.map(m => (
                <button
                  key={m}
                  className={`nutri-meal-picker-opt${m === currentMeal ? ' active' : ''}`}
                  onClick={() => {
                    if (m !== currentMeal && onMealChange) onMealChange(entry.id, m);
                    setMealDropdown(false);
                  }}
                >
                  {MEAL_ICON_MAP[m]}
                  <span>{getMealLabel(m, t)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="nutri-meal-name" title={entry.description}>
          {entry.description}
          {isEvent && (
            <span
              className="nutri-event-badge"
              title={hasBand
                ? t('nutrify.eventBadgeBand', 'Evento: banda estimada {{min}}–{{max}} kcal, se registró el punto medio.', {
                    min: Math.round(entry.eventKcalMin as number), max: Math.round(entry.eventKcalMax as number),
                  })
                : t('nutrify.eventBadgeHint', 'Evento: registrado como una sola entrada. No daña tu vigor.')}
            >
              <Meat width={10} height={10} /> {t('nutrify.eventBadge', 'Evento')}
            </span>
          )}
          {hasBreakdown && (
            <button
              className="nutri-breakdown-toggle"
              onClick={() => setExpanded(v => !v)}
              title={t('nutrify.aiBreakdown', 'AI breakdown')}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 150ms ease' }}>
                <polyline points="2,3.5 5,6.5 8,3.5" />
              </svg>
            </button>
          )}
        </div>
        <div className="nutri-meal-time">{entry.time}</div>
        <div className="nutri-meal-kcal">
          {hasBand
            ? `${Math.round(entry.eventKcalMin as number)}–${Math.round(entry.eventKcalMax as number)} ${t('nutrify.kcalUnit', 'kcal')}`
            : `${entry.calories} ${t('nutrify.kcalUnit', 'kcal')}`}
          {entry.proteinG != null && entry.proteinG > 0 && (
            <span className="nutri-meal-prot">
              {t('nutrify.proteinPerMeal', '{{grams}} g prot.', { grams: Math.round(entry.proteinG) })}
            </span>
          )}
        </div>
        {!readOnly ? (
          confirmDelete ? (
            <div className="nutri-meal-del-confirm">
              <span className="nutri-meal-del-confirm-text">
                {t('nutrify.deleteConfirm', 'Delete this entry?')}
              </span>
              {/* Grouped so that on a phone they wrap together, under the text (NUT-04). */}
              <div className="nutri-meal-del-confirm-actions">
                <button type="button" className="nutri-btn nutri-meal-del-confirm-yes" onClick={() => onDelete(entry.id)}>
                  {t('common.delete', 'Eliminar')}
                </button>
                <button type="button" className="nutri-btn nutri-btn-ghost" onClick={() => setConfirmDelete(false)}>
                  {t('common.cancel', 'Cancelar')}
                </button>
              </div>
            </div>
          ) : (
            <div className="nutri-meal-del">
              {onFavorite && (
                <button type="button" className="nutri-food-action" onClick={onFavorite}
                  aria-label={t('nutrify.favoriteEntryLabel', 'Guardar «{{name}}» en favoritos', { name: entry.description })}
                  title={t('nutrify.saveToFavorites', 'Guardar en favoritos')}>
                  <Heart width={14} height={14} stroke="var(--rubric)" />
                </button>
              )}
              <button type="button" className="nutri-food-action" onClick={openEdit}
                aria-label={t('nutrify.editEntryLabel', 'Editar «{{name}}»', { name: entry.description })}
                title={t('nutrify.editEntry', 'Editar')}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"
                  stroke="var(--gold-dark)" strokeWidth="1.2" strokeLinecap="round">
                  <path d="M8.5 1.5l2 2M3 7l5.5-5.5 2 2L5 9H3V7z"/>
                </svg>
              </button>
              <button type="button" className="nutri-food-action" onClick={() => setConfirmDelete(true)}
                aria-label={t('nutrify.deleteEntryLabel', 'Eliminar «{{name}}»', { name: entry.description })}
                title={t('common.delete', 'Eliminar')}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"
                  stroke="var(--rubric)" strokeWidth="1.5" strokeLinecap="round">
                  <line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/>
                </svg>
              </button>
            </div>
          )
        ) : <div />}
      </div>

      {hasBreakdown && expanded && (
        <div className="nutri-breakdown">
          {breakdownItems.map((item, i) => (
            <div key={i} className="nutri-breakdown-item">
              <span className="nutri-breakdown-name">{item.name}</span>
              <span className="nutri-breakdown-kcal">{item.calories} kcal</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

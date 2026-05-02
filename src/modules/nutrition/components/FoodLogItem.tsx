import { useState, memo, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../../shared/components/useToast';
import { registerFood } from '../../../shared/animations/feedback';
import { DawnSun, NoonSun, MoonCrescent, Herb, Platter, Heart } from '../../../shared/components/icons';
import { resolveMealType, MEAL_ORDER } from '../../../../shared/meal-utils';
import type { MealType, MealSchedule } from '../../../../shared/meal-utils';
import { estimateNutrition } from '../estimate-service';

interface BreakdownItem {
  name: string;
  calories: number;
}

interface FoodEntry {
  id: number; time: string; description: string; calories: number;
  source: string; aiBreakdown?: string | null;
  meal?: string | null;
}

interface Props {
  entry: FoodEntry;
  onDelete: (id: number) => void;
  onUpdate: (id: number, fields: { description?: string; calories?: number; aiBreakdown?: string; source?: string }) => void;
  onMealChange?: (id: number, meal: string) => void;
  onFavorite?: () => void;
  mealSchedule?: MealSchedule | null;
  readOnly?: boolean;
  className?: string;
  isNew?: boolean;
}

const MEAL_ICON_MAP: Record<MealType, React.ReactNode> = {
  breakfast: <DawnSun width={16} height={16} />,
  lunch: <NoonSun width={16} height={16} />,
  dinner: <MoonCrescent width={16} height={16} />,
  snack: <Herb width={16} height={16} />,
};

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: 'Desayuno',
  lunch: 'Almuerzo',
  dinner: 'Cena',
  snack: 'Snack',
};

function getMealForEntry(entry: FoodEntry, schedule?: MealSchedule | null): MealType {
  if (entry.meal) return entry.meal as MealType;
  return resolveMealType(entry.time, schedule).meal;
}

export default memo(function FoodLogItem({ entry, onDelete, onUpdate, onMealChange, onFavorite, mealSchedule, readOnly, className, isNew }: Props) {
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

  const currentMeal = getMealForEntry(entry, mealSchedule);

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

  const handleSave = () => {
    const newCals = parseInt(editCals);
    if (isNaN(newCals) || newCals <= 0) return;
    onUpdate(entry.id, { description: editDesc.trim() || entry.description, calories: newCals });
    setEditing(false);
  };

  const handleReEstimate = async () => {
    const desc = editDesc.trim();
    if (!desc) return;
    setEstimating(true);
    try {
      const result = await estimateNutrition(desc);
      setEditCals(String(result.calories));
      onUpdate(entry.id, {
        description: desc,
        calories: result.calories,
        aiBreakdown: JSON.stringify(result.items),
        source: 'ai_estimate',
      });
      setEditing(false);
    } catch {
      toast({ type: 'warning', message: t('nutrify.estimationFailed', 'Estimation failed — edit manually') });
    } finally {
      setEstimating(false);
    }
  };

  if (editing) {
    return (
      <div ref={rowRef} className={`nutri-meal-row nutri-pulse-gold ${className || ''}`}>
        <div className="nutri-meal-ico">{MEAL_ICON_MAP[currentMeal] ?? <Platter width={16} height={16} />}</div>
        <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)}
          className="nutri-text-input" style={{ padding: '4px 6px', fontSize: 'var(--fs-label)' }} />
        <input type="number" value={editCals} onChange={(e) => setEditCals(e.target.value)}
          className="nutri-text-input" style={{ width: 60, padding: '4px 6px', fontSize: 'var(--fs-label)' }}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()} />
        <button className="nutri-btn" onClick={handleReEstimate} disabled={estimating || !editDesc.trim()} title={t('nutrify.reEstimate', 'Re-estimar con IA')}
          style={{ padding: '4px 10px', fontSize: 'var(--fs-body)', opacity: estimating ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          {estimating ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
              <circle cx="7" cy="7" r="5.5" opacity="0.3"/><path d="M7 1.5a5.5 5.5 0 0 1 4.76 2.75" strokeWidth="1.5"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" stroke="none">
              <path d="M7 0l.9 2.8h2.9l-2.4 1.7.9 2.8L7 5.6 4.7 7.3l.9-2.8L3.2 2.8h2.9z"/>
              <path d="M11.5 5l.5 1.6h1.7l-1.4 1 .5 1.6-1.3-1-1.4 1 .5-1.6-1.3-1h1.7z" opacity="0.7"/>
              <path d="M2.5 8l.4 1.2h1.3l-1 .8.4 1.2-1.1-.8-1 .8.4-1.2-1.1-.8h1.3z" opacity="0.5"/>
            </svg>
          )}
        </button>
        <button className="nutri-btn nutri-btn-ghost" onClick={() => setEditing(false)} disabled={estimating} style={{ padding: '3px 8px', fontSize: 'var(--fs-label)' }}>
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none"><line x1="2" y1="2" x2="8" y2="8"/><line x1="8" y1="2" x2="2" y2="8"/></svg>
        </button>
      </div>
    );
  }

  return (
    <div ref={rowRef} className={`nutri-meal-item-wrap ${className || ''}`} style={mealDropdown ? { position: 'relative', zIndex: 'var(--z-dropdown-top)' } : undefined}>
      <div className="nutri-meal-row">
        <div className="nutri-meal-ico" ref={dropdownRef} style={{ position: 'relative' }}>
          <span
            onClick={() => { if (!readOnly && onMealChange) setMealDropdown(v => !v); }}
            style={{ cursor: readOnly ? 'default' : 'pointer' }}
            title={t(`nutrify.meal${currentMeal.charAt(0).toUpperCase() + currentMeal.slice(1)}`, MEAL_LABELS[currentMeal])}
          >
            {MEAL_ICON_MAP[currentMeal] ?? <Platter width={16} height={16} />}
          </span>
          {!entry.meal && !readOnly && onMealChange && (
            <span
              className="nutri-meal-unresolved"
              title={t('nutrify.pickMeal', 'Elegí la comida')}
              onClick={() => setMealDropdown(v => !v)}
            >?</span>
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
                  <span>{t(`nutrify.meal${m.charAt(0).toUpperCase() + m.slice(1)}`, MEAL_LABELS[m])}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="nutri-meal-name">
          {entry.description}
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
        <div className="nutri-meal-kcal">{entry.calories} {t('nutrify.kcalUnit', 'kcal')}</div>
        {!readOnly ? (
          confirmDelete ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              gridColumn: '1 / -1',
              padding: '4px 10px', background: 'rgba(122,30,30,0.08)',
              border: '1px solid var(--rubric)', borderRadius: '3px',
            }}>
              <span style={{ fontSize: 'var(--fs-label)', color: 'var(--rubric)', whiteSpace: 'nowrap' }}>
                {t('nutrify.deleteConfirm', 'Delete this entry?')}
              </span>
              <button className="nutri-btn" onClick={() => onDelete(entry.id)}
                style={{ background: 'var(--rubric)', borderColor: 'var(--rubric)', padding: '3px 10px', fontSize: 'var(--fs-label)' }}>
                {t('common.delete', 'Eliminar')}
              </button>
              <button className="nutri-btn nutri-btn-ghost" onClick={() => setConfirmDelete(false)}
                style={{ padding: '3px 10px', fontSize: 'var(--fs-label)' }}>
                {t('common.cancel', 'Cancelar')}
              </button>
            </div>
          ) : (
            <div className="nutri-meal-del">
              {onFavorite && (
                <span className="nutri-food-action" onClick={onFavorite}
                  title={t('nutrify.saveToFavorites', 'Guardar en favoritos')}>
                  <Heart width={14} height={14} stroke="var(--rpg-hp-red)" />
                </span>
              )}
              <span className="nutri-food-action" onClick={() => setEditing(true)}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                  stroke="var(--gold-dark)" strokeWidth="1.2" strokeLinecap="round">
                  <path d="M8.5 1.5l2 2M3 7l5.5-5.5 2 2L5 9H3V7z"/>
                </svg>
              </span>
              <span className="nutri-food-action" onClick={() => setConfirmDelete(true)}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                  stroke="var(--rubric)" strokeWidth="1.5" strokeLinecap="round">
                  <line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/>
                </svg>
              </span>
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

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { DawnSun, NoonSun, MoonCrescent, Herb, Chalice } from '../../../../shared/components/icons';
import { MEAL_ORDER, DEFAULT_MEAL_SCHEDULE, ensureMerienda } from '../../../../../shared/meal-utils';
import type { MealType, MealSchedule } from '../../../../../shared/meal-utils';

interface Props {
  schedule: MealSchedule;
  onChange: (schedule: MealSchedule) => void;
  showDefaults?: boolean;
  /**
   * Reports whether the schedule is usable. Overlapping ranges make
   * `resolveMealType` ambiguous, which lands every logged meal with a "?" the
   * user has to classify by hand — so callers must BLOCK on `false`, not warn.
   */
  onValidityChange?: (valid: boolean) => void;
}

const MEAL_ICONS: Record<MealType, React.ReactNode> = {
  breakfast: <DawnSun width={16} height={16} />,
  lunch: <NoonSun width={16} height={16} />,
  merienda: <Chalice width={16} height={16} />,
  dinner: <MoonCrescent width={16} height={16} />,
  snack: <Herb width={16} height={16} />,
};

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function toTimeStr(h: number, m: number): string {
  return `${pad(h)}:${pad(m)}`;
}

function fromTimeStr(str: string): { hour: number; minute: number } {
  const [h, m] = str.split(':').map(Number);
  return { hour: h || 0, minute: m || 0 };
}

/** Check if two enabled meals overlap */
function hasOverlap(schedule: MealSchedule): boolean {
  const ranges = MEAL_ORDER
    .filter(m => m !== 'snack' && schedule[m]?.enabled)
    .map(m => {
      const r = schedule[m];
      return { start: r.startHour * 60 + r.startMinute, end: r.endHour * 60 + r.endMinute };
    });

  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      if (ranges[i].start < ranges[j].end && ranges[j].start < ranges[i].end) {
        return true;
      }
    }
  }
  return false;
}

export default function MealScheduleEditor({ schedule: rawSchedule, onChange, showDefaults, onValidityChange }: Props) {
  const { t } = useTranslation();
  // A schedule saved before merienda existed has no `merienda` key at all —
  // graft it on (disabled if it would collide) rather than rendering undefined.
  const schedule = ensureMerienda(rawSchedule);
  const overlap = hasOverlap(schedule);

  useEffect(() => { onValidityChange?.(!overlap); }, [overlap, onValidityChange]);

  const updateMeal = (meal: MealType, patch: Partial<typeof schedule.breakfast>) => {
    onChange({ ...schedule, [meal]: { ...schedule[meal], ...patch } });
  };

  const handleTimeChange = (meal: MealType, field: 'start' | 'end', value: string) => {
    const { hour, minute } = fromTimeStr(value);
    if (field === 'start') {
      updateMeal(meal, { startHour: hour, startMinute: minute });
    } else {
      updateMeal(meal, { endHour: hour, endMinute: minute });
    }
  };

  return (
    <div className="nutri-meal-schedule">
      {MEAL_ORDER.map(meal => {
        const r = schedule[meal];
        const isSnack = meal === 'snack';
        const i18nKey = `nutrify.meal${meal.charAt(0).toUpperCase() + meal.slice(1)}`;
        return (
          <div key={meal} className={`nutri-meal-schedule-row${!r.enabled ? ' disabled' : ''}`}>
            <div
              className={`nutri-meal-schedule-toggle${r.enabled ? ' active' : ''}`}
              onClick={() => updateMeal(meal, { enabled: !r.enabled })}
              role="checkbox"
              aria-checked={r.enabled}
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); updateMeal(meal, { enabled: !r.enabled }); } }}
            >
              <div className="nutri-check-box">{r.enabled ? <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M2 6l3 3 5-5"/></svg> : null}</div>
            </div>
            <span className="nutri-meal-schedule-icon">{MEAL_ICONS[meal]}</span>
            <span className="nutri-meal-schedule-name">{t(i18nKey, meal)}</span>
            {!isSnack && r.enabled ? (
              <div className="nutri-meal-schedule-times">
                <input
                  type="time"
                  className="nutri-meal-schedule-time"
                  value={toTimeStr(r.startHour, r.startMinute)}
                  onChange={(e) => handleTimeChange(meal, 'start', e.target.value)}
                />
                <span className="nutri-meal-schedule-sep">-</span>
                <input
                  type="time"
                  className="nutri-meal-schedule-time"
                  value={toTimeStr(r.endHour, r.endMinute)}
                  onChange={(e) => handleTimeChange(meal, 'end', e.target.value)}
                />
              </div>
            ) : isSnack ? (
              <span className="nutri-meal-schedule-catch">{t('nutrify.mealCatchAll', 'catch-all')}</span>
            ) : null}
          </div>
        );
      })}
      {overlap && (
        <p className="nutri-meal-overlap-warn" role="alert">
          {t('nutrify.mealOverlapBlocking', 'Los horarios se superponen. Corregilos: si no, cada comida queda sin clasificar.')}
        </p>
      )}
      {showDefaults && (
        <button
          className="nutri-btn nutri-btn-ghost"
          style={{ marginTop: 8, fontSize: 'var(--fs-label)' }}
          onClick={() => onChange({ ...DEFAULT_MEAL_SCHEDULE })}
        >
          {t('nutrify.mealUseDefaults', 'Usar predeterminados')}
        </button>
      )}
    </div>
  );
}

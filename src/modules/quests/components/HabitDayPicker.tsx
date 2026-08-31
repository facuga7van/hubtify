import { useTranslation } from 'react-i18next';
import { WEEKDAYS } from '../types';

/** Spanish weekday initials, Monday first. Overridable per locale via i18n. */
const DEFAULT_LETTERS: Record<number, string> = {
  1: 'L', 2: 'M', 3: 'X', 4: 'J', 5: 'V', 6: 'S', 7: 'D',
};

export function weekdayLetter(t: (key: string, fallback: string) => string, day: number): string {
  return t(`questify.dayLetters.${day}`, DEFAULT_LETTERS[day] ?? '?');
}

interface Props {
  value: number[];
  onChange: (days: number[]) => void;
}

/**
 * Seven toggles for "Monday, Wednesday and Friday".
 *
 * "3 times a week" congratulates you on Sunday for a Saturday-Sunday-Sunday
 * week; naming the actual days is what makes a gym habit a gym habit.
 */
export default function HabitDayPicker({ value, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <div className="quest-habit-days" role="group" aria-label={t('questify.chooseDays', 'Elegir días')}>
      {WEEKDAYS.map((day) => {
        const on = value.includes(day);
        return (
          <button
            key={day}
            type="button"
            className={`quest-habit-day${on ? ' quest-habit-day--on' : ''}`}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((d) => d !== day) : [...value, day].sort((a, b) => a - b))}
          >
            {weekdayLetter(t, day)}
          </button>
        );
      })}
    </div>
  );
}

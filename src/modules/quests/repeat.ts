import { WEEKDAYS } from './types';

/**
 * Renderer-side mirror of the `tasks.repeat_rule` contract (quests migration
 * v13). Kept separate from `electron/modules/quests.ipc.ts` on purpose: the
 * main-process module drags Electron/better-sqlite3 into any bundle that
 * imports it, so the renderer carries its own copy of this tiny parser.
 *
 * Stored format: NULL = never; else compact JSON
 *   {"freq":"daily"|"weekly"|"monthly"|"days","days":[0-6]?}
 * where `days` uses JS Date.getDay() numbering (0 = Sunday … 6 = Saturday).
 */

export type RepeatFreq = 'daily' | 'weekly' | 'monthly' | 'days';

export interface RepeatRule {
  freq: RepeatFreq;
  days?: number[];
}

/** Anything that isn't a well-formed rule reads as "never repeats". */
export function parseRepeatRule(raw: string | null | undefined): RepeatRule | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { freq?: unknown; days?: unknown };
    if (parsed.freq === 'daily' || parsed.freq === 'weekly' || parsed.freq === 'monthly') {
      return { freq: parsed.freq };
    }
    if (parsed.freq === 'days' && Array.isArray(parsed.days)) {
      const days = [...new Set(parsed.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))]
        .sort((a, b) => a - b);
      if (days.length > 0) return { freq: 'days', days };
    }
  } catch { /* malformed → no rule */ }
  return null;
}

/**
 * Serializes the form's state into the stored string, or null for "never" (or
 * a day-specific rule with no days chosen — that is not a rule either).
 * `isoDays` comes from the HabitDayPicker (ISO 1 = Monday … 7 = Sunday) and is
 * converted to the stored JS numbering here.
 */
export function buildRepeatRule(freq: RepeatFreq | 'never', isoDays: number[]): string | null {
  if (freq === 'never') return null;
  if (freq !== 'days') return JSON.stringify({ freq });
  const days = [...new Set(isoDays.map(isoToJsDay))].sort((a, b) => a - b);
  if (days.length === 0) return null;
  return JSON.stringify({ freq: 'days', days });
}

/** ISO weekday (1 = Monday … 7 = Sunday) → JS Date.getDay() (0 = Sunday … 6). */
export function isoToJsDay(iso: number): number {
  return iso === 7 ? 0 : iso;
}

/** JS Date.getDay() (0 = Sunday … 6) → ISO weekday (1 = Monday … 7 = Sunday). */
export function jsToIsoDay(js: number): number {
  return js === 0 ? 7 : js;
}

type Translate = (key: string, fallback: string, opts?: Record<string, unknown>) => string;

/**
 * Human line for tooltips: "Se repite cada semana", "Se repite: L, X, V".
 * Day letters reuse the habit picker's `questify.dayLetters.*` vocabulary,
 * listed Monday-first like every other weekday strip in the module.
 */
export function describeRepeatRule(rule: RepeatRule, t: Translate): string {
  if (rule.freq === 'daily') return t('questify.repeatEveryDay', 'Se repite cada día');
  if (rule.freq === 'weekly') return t('questify.repeatEveryWeek', 'Se repite cada semana');
  if (rule.freq === 'monthly') return t('questify.repeatEveryMonth', 'Se repite cada mes');
  const letters: Record<number, string> = { 1: 'L', 2: 'M', 3: 'X', 4: 'J', 5: 'V', 6: 'S', 7: 'D' };
  const chosen = new Set(rule.days ?? []);
  const list = WEEKDAYS
    .filter((iso) => chosen.has(isoToJsDay(iso)))
    .map((iso) => t(`questify.dayLetters.${iso}`, letters[iso]))
    .join(', ');
  return t('questify.repeatOnDays', 'Se repite: {{days}}', { days: list });
}

import { WEEKDAYS } from './types';

/**
 * Renderer-side mirror of the `tasks.repeat_rule` / `tasks.repeat_anchor`
 * contract (quests migrations v13 and v14). Kept separate from
 * `shared-logic/modules/quests.ipc.ts` on purpose: the main-process module
 * drags the DB layer into any bundle that imports it, so the renderer carries
 * its own copy of this tiny parser.
 *
 * Stored format: NULL = never; else compact JSON
 *   {"freq":"daily"|"weekly"|"monthly"|"days","days":[0-6]?,"interval":1-30?}
 * where `days` uses JS Date.getDay() numbering (0 = Sunday … 6 = Saturday).
 *
 * `interval` is OPTIONAL and ABSENT means 1: every rule written before v14
 * keeps its exact meaning, and interval 1 is serialized without the key so new
 * clients keep emitting byte-identical old rules.
 */

export type RepeatFreq = 'daily' | 'weekly' | 'monthly' | 'days';

/** Where the next due date is measured from (`tasks.repeat_anchor`). */
export type RepeatAnchor = 'due' | 'completion';

export interface RepeatRule {
  freq: RepeatFreq;
  days?: number[];
  /** 1..30. Omitted when 1 — see above. */
  interval?: number;
}

/** Upper bound for the interval. Above this a "cadence" is really a one-off. */
export const MAX_REPEAT_INTERVAL = 30;

/** Anything that isn't a whole number in 1..30 clamps into range (1 on junk). */
export function clampRepeatInterval(raw: unknown): number {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_REPEAT_INTERVAL);
}

/**
 * `tasks.repeat_anchor` → the mode. NULL and any unknown value mean 'due', the
 * v13 fixed-date behaviour: a column an older build never writes must never
 * change what a chain does.
 */
export function parseRepeatAnchor(raw: string | null | undefined): RepeatAnchor {
  return raw === 'completion' ? 'completion' : 'due';
}

/**
 * The value to STORE for an anchor: only 'completion' is persisted, else null
 * (so a chain that goes back to fixed dates leaves no trace behind).
 */
export function serializeRepeatAnchor(anchor: RepeatAnchor): string | null {
  return anchor === 'completion' ? 'completion' : null;
}

/**
 * Anything that isn't a well-formed rule reads as "never repeats".
 *
 * DECISION — no interval on freq 'days': "every 2 weeks on Mon and Thu" needs a
 * notion of which weeks are "on" and nothing in this model anchors week parity
 * (see the note in quests migration v14). The key is dropped here and the form
 * hides the control for 'days'.
 */
export function parseRepeatRule(raw: string | null | undefined): RepeatRule | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { freq?: unknown; days?: unknown; interval?: unknown };
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.freq === 'daily' || parsed.freq === 'weekly' || parsed.freq === 'monthly') {
      const interval = 'interval' in parsed ? clampRepeatInterval(parsed.interval) : 1;
      return interval > 1 ? { freq: parsed.freq, interval } : { freq: parsed.freq };
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
 *
 * `interval` 1 is left OUT of the JSON: that is what keeps a rule written by
 * this build indistinguishable from a pre-v14 one for any older client.
 */
export function buildRepeatRule(
  freq: RepeatFreq | 'never',
  isoDays: number[],
  interval: number = 1,
): string | null {
  if (freq === 'never') return null;
  if (freq === 'days') {
    const days = [...new Set(isoDays.map(isoToJsDay))].sort((a, b) => a - b);
    if (days.length === 0) return null;
    return JSON.stringify({ freq: 'days', days });
  }
  const step = clampRepeatInterval(interval);
  return step > 1 ? JSON.stringify({ freq, interval: step }) : JSON.stringify({ freq });
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
 * Human line for tooltips: "Se repite cada semana", "Se repite cada 3 días",
 * "Se repite: L, X, V".
 *
 * The three cadence keys go through i18next's `count` plural, so the singular
 * ("cada día") and the plural ("cada 3 días") are two catalog entries per
 * language instead of a Spanish-shaped string glued together in code — the
 * plural of "mes" is not "mess" and the plural of "month" is not "mois".
 *
 * `anchor` appends the "counted from when I complete it" clause; 'due' (the
 * default) says nothing, because measuring from the due date is the norm and a
 * tooltip that explains the default on every quest is noise.
 */
export function describeRepeatRule(rule: RepeatRule, t: Translate, anchor: RepeatAnchor = 'due'): string {
  const count = rule.interval ?? 1;
  let line: string;
  if (rule.freq === 'daily') {
    line = t('questify.repeatEveryNDays', 'Se repite cada día', { count });
  } else if (rule.freq === 'weekly') {
    line = t('questify.repeatEveryNWeeks', 'Se repite cada semana', { count });
  } else if (rule.freq === 'monthly') {
    line = t('questify.repeatEveryNMonths', 'Se repite cada mes', { count });
  } else {
    const letters: Record<number, string> = { 1: 'L', 2: 'M', 3: 'X', 4: 'J', 5: 'V', 6: 'S', 7: 'D' };
    const chosen = new Set(rule.days ?? []);
    const list = WEEKDAYS
      .filter((iso) => chosen.has(isoToJsDay(iso)))
      .map((iso) => t(`questify.dayLetters.${iso}`, letters[iso]))
      .join(', ');
    line = t('questify.repeatOnDays', 'Se repite: {{days}}', { days: list });
  }
  if (anchor !== 'completion') return line;
  return `${line} · ${t('questify.repeatAnchorCompletion', 'contando desde que la completo')}`;
}

/** The unit word that follows the interval box in the form ("2 semanas"). */
export function repeatUnitLabel(freq: RepeatFreq | 'never', interval: number, t: Translate): string {
  const count = clampRepeatInterval(interval);
  if (freq === 'weekly') return t('questify.repeatUnitWeeks', 'semana', { count });
  if (freq === 'monthly') return t('questify.repeatUnitMonths', 'mes', { count });
  return t('questify.repeatUnitDays', 'día', { count });
}

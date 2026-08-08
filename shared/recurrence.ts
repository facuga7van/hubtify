import { formatDateString, todayDateString } from './date-utils';

/**
 * Task recurrence — pure logic for the template + instances model.
 * Lives in shared/ so both the main process (IPC, advancing the template on
 * completion) and the renderer (form/list UI) use the exact same rules.
 *
 * A recurring task is a TEMPLATE (recurrence_rule != null, recurrence_parent_id null)
 * that always holds the next pending due_date. Completing it spawns a historical
 * INSTANCE (a normal completed task pointing back via recurrence_parent_id) and
 * advances the template to the next occurrence.
 *
 * Rules use a minimal RRULE-compatible subset so we can grow into full iCal later:
 *   FREQ=DAILY|WEEKLY|MONTHLY[;INTERVAL=n]
 */
export type RecurrenceFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY';
export type RecurrenceAnchor = 'fixed' | 'completion';

export interface ParsedRule {
  freq: RecurrenceFreq;
  interval: number;
}

export function buildRecurrenceRule(freq: RecurrenceFreq, interval = 1): string {
  return interval > 1 ? `FREQ=${freq};INTERVAL=${interval}` : `FREQ=${freq}`;
}

export function parseRecurrenceRule(rule: string | null | undefined): ParsedRule | null {
  if (!rule) return null;
  const parts = Object.fromEntries(
    rule.split(';').map((p) => {
      const [k, v] = p.split('=');
      return [k.trim().toUpperCase(), (v ?? '').trim().toUpperCase()];
    }),
  );
  const freq = parts.FREQ as RecurrenceFreq;
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY') return null;
  const interval = Math.max(1, parseInt(parts.INTERVAL ?? '1', 10) || 1);
  return { freq, interval };
}

const pad = (n: number) => String(n).padStart(2, '0');

function addDaysStr(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return formatDateString(d);
}

/** Add months clamping the day to the last valid day (31 Jan + 1 month → 28/29 Feb). */
function addMonthsStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = (m - 1) + n;
  const ty = y + Math.floor(target / 12);
  const tm = ((target % 12) + 12) % 12;
  const lastDay = new Date(ty, tm + 1, 0).getDate();
  return `${ty}-${pad(tm + 1)}-${pad(Math.min(d, lastDay))}`;
}

function advance(dateStr: string, rule: ParsedRule): string {
  switch (rule.freq) {
    case 'DAILY': return addDaysStr(dateStr, rule.interval);
    case 'WEEKLY': return addDaysStr(dateStr, rule.interval * 7);
    case 'MONTHLY': return addMonthsStr(dateStr, rule.interval);
  }
}

/**
 * Computes the next due date for a recurring task.
 * - 'completion': next = completionDate advanced by one interval (always future-relative).
 * - 'fixed': next = currentDue advanced by one interval, then skipped forward past `today`
 *   so a task completed late doesn't pile up missed occurrences in the past.
 * Returns null if the rule is invalid.
 */
export function computeNextDue(
  rule: string | null | undefined,
  anchor: RecurrenceAnchor,
  currentDue: string | null,
  completionDate: string,
  today: string = todayDateString(),
): string | null {
  const parsed = parseRecurrenceRule(rule);
  if (!parsed) return null;

  if (anchor === 'completion') {
    return advance(completionDate, parsed);
  }

  // fixed: anchor on the original due date (fall back to completion if none)
  let next = advance(currentDue ?? completionDate, parsed);
  let guard = 0;
  while (next <= today && guard < 1000) {
    next = advance(next, parsed);
    guard++;
  }
  return next;
}

/** Deterministic id for a completed occurrence, so two devices completing the same
 *  occurrence offline produce the same row and INSERT OR IGNORE collapses the duplicate. */
export function instanceId(parentId: string, dueDate: string): string {
  return `${parentId}::${dueDate}`;
}

const FREQ_LABEL: Record<RecurrenceFreq, [string, string]> = {
  DAILY: ['día', 'días'],
  WEEKLY: ['semana', 'semanas'],
  MONTHLY: ['mes', 'meses'],
};

/** Human label for the UI, e.g. "Cada día", "Cada 2 semanas". */
export function recurrenceLabel(rule: string | null | undefined): string | null {
  const parsed = parseRecurrenceRule(rule);
  if (!parsed) return null;
  const [singular, plural] = FREQ_LABEL[parsed.freq];
  return parsed.interval === 1 ? `Cada ${singular}` : `Cada ${parsed.interval} ${plural}`;
}

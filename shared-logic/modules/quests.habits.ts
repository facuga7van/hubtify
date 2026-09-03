import type { SqlDatabase } from '../db';
import { genId } from '../ids';
import { formatDateString } from '../../shared/date-utils';

/** A row in `habit_checks` is one of these. Legacy rows are all 'check'. */
export type HabitCheckKind = 'check' | 'skip' | 'shield';

/** Streak shields never stack past this. */
export const MAX_SHIELDS = 3;

/** A shield is earned every time the streak crosses a multiple of this. */
export const SHIELD_MILESTONE = 7;

export interface HabitWithStreakRow {
  id: string;
  name: string;
  frequency: string;
  timesPerWeek: number;
  createdAt: string;
  /** ISO weekday numbers (1 = Monday … 7 = Sunday), or null for "N times a week". */
  specificDays: number[] | null;
  streak: number;
  /** Consecutive fully-met weeks. Only meaningful for weekly habits. */
  weekStreak: number;
  checkedToday: boolean;
  checkedYesterday: boolean;
  /** Today carries an explicit 'skip' row: the habit is excused, not pending. */
  skippedToday: boolean;
  checksThisPeriod: number;
  targetThisPeriod: number;
  /** True when the habit still wants a check TODAY (respects specific days + skips). */
  pendingToday: boolean;
  /** Shields still available AFTER this computation's consumption. */
  shieldCount: number;
  /** A shield is currently holding this streak together (UI shows a discreet mark). */
  shieldUsed: boolean;
  /** Highest streak milestone already paid out. Reconciliation detail. */
  lastShieldStreak: number;
  /**
   * Days a shield WOULD be spent on, but that are not persisted yet.
   * `computeHabits` stays read-only; `reconcileHabitShields` writes them.
   */
  pendingShieldDates: string[];
}

/**
 * A weekly habit must be checked between 1 and 7 times a week. The local UI can't
 * produce anything else, but the sync path accepts whatever the remote sends.
 */
export function weeklyTarget(timesPerWeek: unknown): number {
  const n = typeof timesPerWeek === 'number' && Number.isFinite(timesPerWeek) ? Math.round(timesPerWeek) : 1;
  return Math.max(1, Math.min(7, n || 1));
}

/**
 * Parses the `specific_days` column ('1,3,5') into sorted unique ISO weekday
 * numbers. Anything unusable — empty string, garbage, out-of-range numbers,
 * a remote writer sending nonsense — degrades to `null`, i.e. the legacy
 * count-based behaviour. Never throws.
 */
export function parseSpecificDays(raw: unknown): number[] | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const days = [...new Set(
    raw.split(',')
      .map((p) => Number.parseInt(p.trim(), 10))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7),
  )].sort((a, b) => a - b);
  return days.length > 0 ? days : null;
}

/** Inverse of parseSpecificDays. An empty/invalid list stores NULL. */
export function serializeSpecificDays(days: unknown): string | null {
  if (!Array.isArray(days)) return null;
  const clean = [...new Set(
    days.map((d) => Number.parseInt(String(d), 10)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7),
  )].sort((a, b) => a - b);
  return clean.length > 0 ? clean.join(',') : null;
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a 'YYYY-MM-DD' string. */
export function isoWeekday(dateStr: string): number {
  const d = new Date(dateStr + 'T12:00:00');
  return d.getDay() === 0 ? 7 : d.getDay();
}

/** Monday of the week containing `date`, as 'YYYY-MM-DD'. */
function mondayOf(date: Date): string {
  const dow = date.getDay() || 7;
  const monday = new Date(date);
  monday.setDate(date.getDate() - dow + 1);
  return formatDateString(monday);
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return formatDateString(d);
}

interface DayStreakResult {
  streak: number;
  shieldsLeft: number;
  shieldUsed: boolean;
  /** Gap days a shield was spent on during THIS walk (not yet persisted). */
  consumed: string[];
}

/**
 * Walks backwards day by day over the days this habit actually cares about and
 * counts the streak, forgiving gaps.
 *
 * Rules, in the order they are applied to each relevant day:
 *   'check'   → +1 to the streak.
 *   'skip'    → bridged. Doesn't count, doesn't break — the user excused it.
 *   'shield'  → bridged, and flags `shieldUsed` (a shield already paid for it).
 *   missing   → today is never a break (the day isn't over). Any other missing
 *               day is a gap: if the PREVIOUS relevant day also has nothing, the
 *               gap is 2+ days and the streak falls — shields deliberately do
 *               not stack to cover long absences. Otherwise, if a shield is
 *               available, spend exactly one and keep walking.
 */
function walkDayStreak(
  kinds: Map<string, HabitCheckKind>,
  todayStr: string,
  createdDay: string,
  isRelevant: (dateStr: string) => boolean,
  shields: number,
): DayStreakResult {
  // Build the descending list of relevant days first: the "previous relevant
  // day" lookup a gap needs is then just the next array slot, whatever the
  // frequency. Bounded so a corrupt created_at can never spin forever.
  const seq: string[] = [];
  let cursor = todayStr;
  for (let guard = 0; guard < 1100 && seq.length < 400; guard++) {
    if (cursor < createdDay) break;
    if (isRelevant(cursor)) seq.push(cursor);
    cursor = addDays(cursor, -1);
  }

  let streak = 0;
  let shieldsLeft = shields;
  let shieldUsed = false;
  const consumed: string[] = [];

  for (let i = 0; i < seq.length; i++) {
    const kind = kinds.get(seq[i]);
    if (kind === 'check') { streak++; continue; }
    if (kind === 'skip') continue;
    if (kind === 'shield') { shieldUsed = true; continue; }

    // Nothing recorded for this day.
    if (i === 0) continue; // today is still in play
    const previous = kinds.get(seq[i + 1]);
    if (!previous) break;          // 2+ day hole (or the habit starts here)
    if (shieldsLeft <= 0) break;   // nothing left to spend
    shieldsLeft--;
    shieldUsed = true;
    consumed.push(seq[i]);
  }

  return { streak, shieldsLeft, shieldUsed, consumed };
}

/**
 * Consecutive weeks in which every chosen day was satisfied, walking back from
 * the current week (or the previous one if this week is still open). A 'skip'
 * or 'shield' on a chosen day satisfies it — the day was excused or paid for.
 */
function walkWeekStreak(
  kinds: Map<string, HabitCheckKind>,
  todayStr: string,
  createdDay: string,
  days: number[],
  currentMet: boolean,
): number {
  const chosen = new Set(days);
  let weekStart = mondayOf(new Date(todayStr + 'T12:00:00'));
  if (!currentMet) weekStart = addDays(weekStart, -7);

  let streak = 0;
  for (let guard = 0; guard < 520; guard++) {
    const weekEnd = addDays(weekStart, 6);
    if (weekEnd < createdDay) break;
    let required = 0;
    let met = 0;
    for (let offset = 0; offset < 7; offset++) {
      const day = addDays(weekStart, offset);
      if (!chosen.has(isoWeekday(day))) continue;
      if (day < createdDay || day > todayStr) continue; // outside the habit's life
      required++;
      const kind = kinds.get(day);
      if (kind === 'check' || kind === 'skip' || kind === 'shield') met++;
    }
    if (required === 0 || met < required) break;
    streak++;
    weekStart = addDays(weekStart, -7);
  }
  return streak;
}

/**
 * Computes habits with their streak/period stats for a given "today" date.
 *
 * Extracted from the `quests:getHabits` handler so the exact same derivation
 * (weekly Monday-based periods, monthly periods, streak counting) is reused by
 * both the UI handler and the Syl snapshot builder — never duplicated.
 *
 * `today` is injected (not `new Date()`) so callers stay deterministic/testable.
 *
 * READ-ONLY on purpose. Shield consumption/awarding is decided here but only
 * *reported* (`pendingShieldDates`, `shieldCount`, `lastShieldStreak`);
 * `reconcileHabitShields` is the single writer. That keeps the Syl snapshot and
 * the UI handler agreeing on the numbers without the snapshot mutating state.
 */
export function computeHabits(db: SqlDatabase, today: Date): HabitWithStreakRow[] {
  const todayStr = formatDateString(today);
  const yesterdayStr = addDays(todayStr, -1);

  const habits = db.prepare(`
    SELECT id, name, frequency, times_per_week AS timesPerWeek, created_at AS createdAt,
           specific_days AS specificDays, shield_count AS shieldCount,
           last_shield_streak AS lastShieldStreak
    FROM habits WHERE deleted_at IS NULL ORDER BY created_at ASC
  `).all() as Array<{
    id: string; name: string; frequency: string; timesPerWeek: number; createdAt: string;
    specificDays: string | null; shieldCount: number; lastShieldStreak: number;
  }>;

  // Batch-load ALL checks in one query, group by habit_id
  const allChecks = db.prepare(
    'SELECT habit_id, date, kind FROM habit_checks WHERE deleted_at IS NULL ORDER BY date DESC'
  ).all() as Array<{ habit_id: string; date: string; kind: string | null }>;

  const kindsByHabit = new Map<string, Map<string, HabitCheckKind>>();
  for (const check of allChecks) {
    let map = kindsByHabit.get(check.habit_id);
    if (!map) { map = new Map(); kindsByHabit.set(check.habit_id, map); }
    // A row written before migration v12 (or by an old remote) has no kind.
    const kind: HabitCheckKind = check.kind === 'skip' || check.kind === 'shield' ? check.kind : 'check';
    map.set(check.date, kind);
  }

  return habits.map((h) => {
    const kinds = kindsByHabit.get(h.id) ?? new Map<string, HabitCheckKind>();
    const specificDays = h.frequency === 'weekly' ? parseSpecificDays(h.specificDays) : null;
    // Floor for the backwards walks: a habit can't have a streak before it
    // existed. One day of slack absorbs the created_at (UTC ISO) vs todayStr
    // (local) skew, which otherwise blanks the streak on creation day for
    // anyone west of UTC. An unparseable/future created_at drops the floor
    // entirely — the walks are bounded by their own guards anyway.
    const rawCreated = (h.createdAt || '').slice(0, 10);
    const createdDay = /^\d{4}-\d{2}-\d{2}$/.test(rawCreated) && rawCreated <= todayStr
      ? addDays(rawCreated, -1)
      : '0001-01-01';
    const storedShields = Math.max(0, Math.min(MAX_SHIELDS, h.shieldCount ?? 0));

    const checkedToday = kinds.get(todayStr) === 'check';
    const checkedYesterday = kinds.get(yesterdayStr) === 'check';
    const skippedToday = kinds.get(todayStr) === 'skip';

    let checksThisPeriod = 0;
    let targetThisPeriod = 1;
    let streak = 0;
    let weekStreak = 0;
    let shieldsLeft = storedShields;
    let shieldUsed = false;
    let pendingShieldDates: string[] = [];
    let pendingToday: boolean;

    const countKind = (from: string, to: string, kind: HabitCheckKind, onlyDays?: Set<number>) => {
      let n = 0;
      for (const [date, k] of kinds) {
        if (date < from || date > to || k !== kind) continue;
        if (onlyDays && !onlyDays.has(isoWeekday(date))) continue;
        n++;
      }
      return n;
    };

    if (h.frequency === 'daily') {
      // A skipped day is excused, so it lowers the bar instead of nagging.
      targetThisPeriod = skippedToday ? 0 : 1;
      checksThisPeriod = checkedToday ? 1 : 0;
      pendingToday = !checkedToday && !skippedToday;

      const walk = walkDayStreak(kinds, todayStr, createdDay, () => true, storedShields);
      streak = walk.streak;
      weekStreak = 0;
      shieldsLeft = walk.shieldsLeft;
      shieldUsed = walk.shieldUsed;
      pendingShieldDates = walk.consumed;
    } else if (h.frequency === 'weekly' && specificDays) {
      const chosen = new Set(specificDays);
      const monday = mondayOf(new Date(todayStr + 'T12:00:00'));
      const sunday = addDays(monday, 6);
      const skippedThisWeek = countKind(monday, todayStr, 'skip', chosen);
      // The week's bar is the chosen days minus the ones explicitly excused.
      targetThisPeriod = Math.max(0, specificDays.length - skippedThisWeek);
      checksThisPeriod = countKind(monday, todayStr, 'check', chosen);
      pendingToday = chosen.has(isoWeekday(todayStr)) && !checkedToday && !skippedToday;

      // Visible streak = consecutive CHOSEN days completed. Tuesdays simply are
      // not part of the walk for a Mon/Wed/Fri habit, so they can never break it.
      const walk = walkDayStreak(kinds, todayStr, createdDay, (d) => chosen.has(isoWeekday(d)), storedShields);
      streak = walk.streak;
      shieldsLeft = walk.shieldsLeft;
      shieldUsed = walk.shieldUsed;
      pendingShieldDates = walk.consumed;

      const remainingChosen = specificDays.filter((d) => {
        const date = addDays(monday, d - 1);
        return date <= sunday && date > todayStr;
      }).length;
      const currentWeekMet = remainingChosen === 0 && checksThisPeriod >= targetThisPeriod;
      weekStreak = walkWeekStreak(kinds, todayStr, createdDay, specificDays, currentWeekMet);
    } else if (h.frequency === 'weekly') {
      // Legacy "N times a week": unchanged, except skips no longer count as checks.
      const monday = mondayOf(new Date(todayStr + 'T12:00:00'));
      checksThisPeriod = countKind(monday, todayStr, 'check');
      // `target` is clamped: a habit with times_per_week = 0 (only reachable via the
      // sync path / an external writer like Syl) makes `count < target` never true,
      // and this loop would spin forever, hanging the whole main process.
      const target = weeklyTarget(h.timesPerWeek);
      targetThisPeriod = target;
      // La meta es SEMANAL, pero `pendingToday` responde por HOY, y
      // `habit_checks` es UNIQUE(habit_id, date): un hábito ya marcado hoy no
      // puede recibir otro check hoy, vaya la semana 2/3 o 0/3. Mirar solo el
      // progreso del período dejaba al gimnasio de los miércoles listado como
      // pendiente y sin tildar en el Hub y en «Hoy» el mismo día que se marcó,
      // mientras la lista de Hábitos (que lee `checkedToday`) lo daba por hecho.
      // Las ramas `daily` y "días elegidos" ya descontaban hoy; esta no.
      pendingToday = checksThisPeriod < target && !checkedToday && !skippedToday;

      const currentMet = checksThisPeriod >= target;
      let weekStart = monday;
      if (!currentMet) weekStart = addDays(weekStart, -7);
      for (let guard = 0; guard < 520; guard++) {
        const weekEnd = addDays(weekStart, 6);
        const count = countKind(weekStart, weekEnd, 'check');
        // Second guard: an empty week always terminates the walk, regardless of target.
        if (count === 0 || count < target) break;
        streak++;
        weekStart = addDays(weekStart, -7);
      }
      weekStreak = streak;
    } else {
      // monthly
      const monthStart = todayStr.slice(0, 7) + '-01';
      checksThisPeriod = countKind(monthStart, todayStr, 'check');
      targetThisPeriod = 1;
      pendingToday = checksThisPeriod < 1;

      const currentMet = checksThisPeriod >= 1;
      let year = today.getFullYear();
      let month = today.getMonth(); // 0-indexed
      if (!currentMet) { month--; if (month < 0) { month = 11; year--; } }
      for (let guard = 0; guard < 1200; guard++) {
        const mStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
        const mEnd = `${year}-${String(month + 1).padStart(2, '0')}-31`;
        if (countKind(mStart, mEnd, 'check') < 1) break;
        streak++;
        month--; if (month < 0) { month = 11; year--; }
      }
    }

    // ── Shield awarding ──
    // One shield per multiple-of-7 milestone, never re-awarded while the streak
    // merely wobbles below it. A streak that dies completely re-arms the ladder.
    let lastShieldStreak = h.lastShieldStreak ?? 0;
    if (streak === 0) lastShieldStreak = 0;
    const milestone = Math.floor(streak / SHIELD_MILESTONE) * SHIELD_MILESTONE;
    let shieldCount = shieldsLeft;
    if (milestone > lastShieldStreak) {
      shieldCount = Math.min(MAX_SHIELDS, shieldCount + 1);
      lastShieldStreak = milestone;
    }

    return {
      id: h.id,
      name: h.name,
      frequency: h.frequency,
      timesPerWeek: h.timesPerWeek,
      createdAt: h.createdAt,
      specificDays,
      streak,
      weekStreak,
      checkedToday,
      checkedYesterday,
      skippedToday,
      checksThisPeriod,
      targetThisPeriod,
      pendingToday,
      shieldCount,
      shieldUsed,
      lastShieldStreak,
      pendingShieldDates,
    };
  });
}

/**
 * `computeHabits` + the writes it implies.
 *
 * Spending a shield has to be recorded or the next recompute would spend
 * another one for the same hole (and the one after that, until the habit ran
 * dry). The record is a `habit_checks` row with `kind = 'shield'` on the gap
 * day: it rides the existing UNIQUE(habit_id, date) upsert, it syncs with every
 * other check, and on the next pass the walk sees it and bridges for free.
 *
 * Every write moves `updated_at` — the merge is last-write-wins on it, and a
 * row that leaves it stale is silently rejected on the other device.
 */
export function reconcileHabitShields(db: SqlDatabase, today: Date): HabitWithStreakRow[] {
  const rows = computeHabits(db, today);

  const stored = new Map<string, { shield_count: number; last_shield_streak: number }>();
  for (const r of db.prepare('SELECT id, shield_count, last_shield_streak FROM habits WHERE deleted_at IS NULL').all() as Array<{
    id: string; shield_count: number; last_shield_streak: number;
  }>) {
    stored.set(r.id, r);
  }

  const dirty = rows.filter((r) => {
    const s = stored.get(r.id);
    if (!s) return false;
    return r.pendingShieldDates.length > 0
      || s.shield_count !== r.shieldCount
      || s.last_shield_streak !== r.lastShieldStreak;
  });
  if (dirty.length === 0) return rows;

  const now = new Date().toISOString();
  const insertShield = db.prepare(`
    INSERT INTO habit_checks (id, habit_id, date, kind, created_at, updated_at)
    VALUES (?, ?, ?, 'shield', ?, ?)
    ON CONFLICT(habit_id, date) DO UPDATE SET
      kind = 'shield', deleted_at = NULL, updated_at = excluded.updated_at
  `);
  const updateHabit = db.prepare(
    'UPDATE habits SET shield_count = ?, last_shield_streak = ?, updated_at = ? WHERE id = ?'
  );

  db.transaction(() => {
    for (const r of dirty) {
      for (const date of r.pendingShieldDates) {
        insertShield.run(genId(), r.id, date, now, now);
      }
      updateHabit.run(r.shieldCount, r.lastShieldStreak, now, r.id);
    }
  })();

  // The consumption is persisted now; nothing is pending any more.
  for (const r of dirty) r.pendingShieldDates = [];
  return rows;
}

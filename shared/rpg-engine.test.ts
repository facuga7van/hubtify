import { describe, it, expect } from 'vitest';
import {
  xpThreshold,
  getLevel,
  getTitle,
  getComboMultiplier,
  rollRandomBonus,
  calculateXpGain,
  vigorBonus,
  getStreakMilestoneBonus,
  clampHp,
  xpToNextLevel,
  daysDiff,
  getLocalDateString,
  monthKey,
  pardonsRemaining,
  PARDONS_PER_MONTH,
  sealXp,
  sealWindowStatus,
  SEAL_BASE_XP,
  SEAL_EVENT_CAP,
} from './rpg-engine';
import {
  ACHIEVEMENTS,
  ACHIEVEMENTS_BY_ID,
  EVENT_MODULES,
  isFullMoon,
  type AchievementContext,
  type AchievementEventContext,
} from './achievements';

/** A context where nothing has happened. Override only the field under test. */
function blankContext(overrides: Partial<AchievementContext>): AchievementContext {
  return {
    event: null,
    stats: { level: 1, xp: 0, hp: 100, streak: 0, bestStreak: 0, innSince: null },
    today: '2026-03-21',
    totalEvents: 0,
    countByType: {},
    countByModule: {},
    eventsToday: 0,
    countByTypeToday: {},
    modulesToday: [],
    typesToday: [],
    epicsToday: 0,
    xpToday: 0,
    maxComboToday: 0,
    daysSinceLastActivity: 0,
    distinctHabits: 0,
    sealsCount: 0,
    hasCharacterName: false,
    bestiaryCategories: 0,
    budgetsActive: 0,
    statementImportMonths: 0,
    loansSettledAged: 0,
    financeActiveMonths: 0,
    statementsPaid: 0,
    financeMovementsToday: [],
    daysSinceLastInModule: 0,
    firstEventDateInModule: null,
    sealsWithFinance: 0,
    sealsWithAllModules: 0,
    checksPerHabit: [],
    epicTasksTotal: 0,
    repeatedTasksTotal: 0,
    overdueClosedTotal: 0,
    habitShieldsSpent: 0,
    pendingTasks: 0,
    daysSinceThisHabit: 0,
    pomodoroDays: 0,
    pomodoroHoursToday: [],
    daysSinceLastPomodoro: 0,
    pomodorosWithTask: 0,
    firstHourToday: null,
    lastHourToday: null,
    gapBeforeToday: 0,
    daysSinceFirstEvent: 0,
    mealSlotsToday: [],
    rewardsRedeemed: 0,
    obolosSpent: 0,
    obolosBalance: 0,
    innNightsLastStay: 0,
    ...overrides,
  };
}

function blankEvent(overrides: Partial<AchievementEventContext> = {}): AchievementEventContext {
  return {
    type: 'TASK_COMPLETED',
    moduleId: 'quests',
    payload: {},
    hour: 12,
    date: '2026-03-21',
    weekday: 6,
    comboMultiplier: 1.0,
    bonusMultiplier: 1.0,
    xpGained: 15,
    pardonUsed: false,
    ...overrides,
  };
}

describe('xpThreshold', () => {
  it('level 1 is 0', () => { expect(xpThreshold(1)).toBe(0); });
  it('level 2 is 339', () => { expect(xpThreshold(2)).toBe(339); });
  it('level 10 is 3795', () => { expect(xpThreshold(10)).toBe(3795); });
});

describe('getLevel', () => {
  it('0 xp is level 1', () => { expect(getLevel(0)).toBe(1); });
  it('338 xp is still level 1', () => { expect(getLevel(338)).toBe(1); });
  it('339 xp is level 2', () => { expect(getLevel(339)).toBe(2); });
  it('3795 xp is level 10', () => { expect(getLevel(3795)).toBe(10); });
});

describe('getTitle', () => {
  it('level 1 is Campesino', () => { expect(getTitle(1)).toBe('Campesino'); });
  it('level 10 is Guerrero', () => { expect(getTitle(10)).toBe('Guerrero'); });
  it('level 50 is Leyenda', () => { expect(getTitle(50)).toBe('Leyenda'); });
});

describe('getComboMultiplier', () => {
  it('first action is x1.0', () => { expect(getComboMultiplier(0)).toBe(1.0); });
  it('fifth+ action is x2.0 (cap)', () => {
    expect(getComboMultiplier(4)).toBe(2.0);
    expect(getComboMultiplier(10)).toBe(2.0);
  });
});

describe('rollRandomBonus', () => {
  it('returns a valid multiplier', () => {
    const result = rollRandomBonus();
    expect([1.0, 1.5, 2.0, 3.0]).toContain(result);
  });
});

describe('calculateXpGain', () => {
  it('calculates base x combo x bonus', () => {
    expect(calculateXpGain(15, 1.25, 1.0)).toBeCloseTo(18.75);
  });
  // Replaces the two former hp-penalty cases. `calculateHpPenalty` is GONE: it
  // halved every reward at hp = 0 with no way to heal, which is accumulated-debt
  // punishment. HP is now the day's Vigor and never touches XP.
  it('is unaffected by HP — there is no penalty term left', () => {
    expect(calculateXpGain(15, 1.0, 1.0)).toBeCloseTo(15);
    expect(calculateXpGain.length).toBe(3);
  });
});

describe('vigorBonus', () => {
  it('never punishes — the floor is 1.0', () => {
    expect(vigorBonus(0)).toBe(1.0);
    expect(vigorBonus(69)).toBe(1.0);
  });
  it('rewards a healthy day', () => {
    expect(vigorBonus(70)).toBe(1.05);
    expect(vigorBonus(89)).toBe(1.05);
    expect(vigorBonus(90)).toBe(1.1);
    expect(vigorBonus(100)).toBe(1.1);
  });
});

describe('monthKey / pardonsRemaining', () => {
  it('buckets a date into its YYYY-MM month', () => {
    expect(monthKey('2026-08-31')).toBe('2026-08');
  });
  it('gives a full allowance when the stored month is stale or missing', () => {
    expect(pardonsRemaining(null, 0, '2026-08')).toBe(PARDONS_PER_MONTH);
    expect(pardonsRemaining('2026-07', 2, '2026-08')).toBe(PARDONS_PER_MONTH);
  });
  it('subtracts the pardons used inside the current month', () => {
    expect(pardonsRemaining('2026-08', 1, '2026-08')).toBe(1);
    expect(pardonsRemaining('2026-08', 2, '2026-08')).toBe(0);
    expect(pardonsRemaining('2026-08', 9, '2026-08')).toBe(0);
  });
});

describe('getStreakMilestoneBonus', () => {
  it('returns 0 for non-milestone days', () => {
    expect(getStreakMilestoneBonus(1)).toBe(0);
    expect(getStreakMilestoneBonus(2)).toBe(0);
    expect(getStreakMilestoneBonus(5)).toBe(0);
  });
  it('returns correct bonus for milestones', () => {
    expect(getStreakMilestoneBonus(3)).toBe(25);
    expect(getStreakMilestoneBonus(7)).toBe(50);
    expect(getStreakMilestoneBonus(14)).toBe(100);
    expect(getStreakMilestoneBonus(30)).toBe(250);
    expect(getStreakMilestoneBonus(100)).toBe(1000);
  });
});

describe('clampHp', () => {
  it('clamps to 0 when negative', () => {
    expect(clampHp(-10)).toBe(0);
  });
  it('clamps to 100 when over max', () => {
    expect(clampHp(150)).toBe(100);
  });
  it('rounds to nearest integer', () => {
    expect(clampHp(50.7)).toBe(51);
  });
  it('keeps valid values', () => {
    expect(clampHp(50)).toBe(50);
  });
});

describe('xpToNextLevel', () => {
  it('at level 1 with 0 xp needs 339', () => {
    expect(xpToNextLevel(0)).toBe(339);
  });
  it('at level 2 with 339 xp', () => {
    // level 2 threshold is 339, level 3 threshold is round(120 * 3^1.5) = 624
    const result = xpToNextLevel(339);
    expect(result).toBe(624 - 339);
  });
});

describe('daysDiff', () => {
  it('same day is 0', () => {
    expect(daysDiff('2026-03-21', '2026-03-21')).toBe(0);
  });
  it('one day apart is 1', () => {
    expect(daysDiff('2026-03-20', '2026-03-21')).toBe(1);
  });
  it('negative diff', () => {
    expect(daysDiff('2026-03-21', '2026-03-20')).toBe(-1);
  });
});

describe('getLocalDateString', () => {
  it('returns YYYY-MM-DD format', () => {
    const result = getLocalDateString();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── Phase 2: Cierre del Códice ─────────────────────────────────────────────

describe('sealXp', () => {
  it('pays the floor for a one-event day at neutral vigor', () => {
    // (10 + 2*1) * 1.0
    expect(sealXp(1, 50)).toBe(12);
  });

  it('caps the event term at SEAL_EVENT_CAP so a busy day is not a farm', () => {
    expect(sealXp(SEAL_EVENT_CAP, 50)).toBe(50);
    expect(sealXp(500, 50)).toBe(sealXp(SEAL_EVENT_CAP, 50));
  });

  it('applies vigorBonus once, never a penalty', () => {
    expect(sealXp(20, 100)).toBe(Math.round(50 * 1.1)); // 55
    expect(sealXp(20, 75)).toBe(Math.round(50 * 1.05)); // 53
    expect(sealXp(20, 10)).toBe(50);                    // 1.0 floor, never below
  });

  it('never returns less than the base, whatever the vigor', () => {
    for (const hp of [0, 25, 50, 69, 70, 89, 90, 100]) {
      expect(sealXp(0, hp)).toBeGreaterThanOrEqual(SEAL_BASE_XP);
    }
  });
});

describe('sealWindowStatus', () => {
  it('accepts today and yesterday (the grace window)', () => {
    expect(sealWindowStatus('2026-03-21', '2026-03-21')).toBe('ok');
    expect(sealWindowStatus('2026-03-20', '2026-03-21')).toBe('ok');
  });
  it('refuses anything older', () => {
    expect(sealWindowStatus('2026-03-19', '2026-03-21')).toBe('too_old');
  });
  it('refuses the future', () => {
    expect(sealWindowStatus('2026-03-22', '2026-03-21')).toBe('future');
  });
});

// ── Phase 2: achievement catalogue calibration ─────────────────────────────

/**
 * Everything at once, with NO event: the backfill sweep over an account that
 * has done it all. Rule 6 says only tier I and identity states may light up.
 */
function maxedOutSweep(): AchievementContext {
  const thousand = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, 1000]));
  const TYPES = [
    'TASK_COMPLETED', 'SUBTASK_COMPLETED', 'HABIT_CHECKED', 'HABIT_SKIPPED', 'TASK_UNCOMPLETED',
    'TASK_CREATED', 'MEAL_LOGGED', 'DAY_SUMMARY', 'WEEK_SUMMARY', 'DAY_REOPENED', 'EXPENSE_LOGGED',
    'INCOME_LOGGED', 'LOAN_SETTLED', 'BUDGET_MONTH_MET', 'STATEMENT_IMPORTED', 'POMODORO_COMPLETED',
    'POMODORO_ABANDONED', 'CAULDRON_LAP_COMPLETED', 'POMODORO_EXTENDED', 'DAY_SEALED', 'ACHIEVEMENT_UNLOCKED',
  ];
  return blankContext({
    stats: { level: 99, xp: 1e6, hp: 100, streak: 999, bestStreak: 999, innSince: '2026-01-01' },
    totalEvents: 5000,
    countByType: thousand(TYPES),
    countByModule: thousand([...EVENT_MODULES]),
    eventsToday: 50,
    countByTypeToday: thousand(TYPES),
    modulesToday: [...EVENT_MODULES],
    typesToday: TYPES,
    epicsToday: 9,
    xpToday: 999,
    maxComboToday: 2.0,
    distinctHabits: 50,
    sealsCount: 1000,
    hasCharacterName: true,
    bestiaryCategories: 50,
    budgetsActive: 10,
    statementImportMonths: 60,
    loansSettledAged: 50,
    financeActiveMonths: 60,
    statementsPaid: 50,
    financeMovementsToday: [{ type: 'expense', amount: 1221 }, { type: 'income', amount: 1221 }],
    sealsWithFinance: 100,
    sealsWithAllModules: 100,
    checksPerHabit: Array(20).fill(100),
    epicTasksTotal: 50,
    repeatedTasksTotal: 50,
    overdueClosedTotal: 50,
    habitShieldsSpent: 5,
    pomodoroDays: 500,
    pomodoroHoursToday: [8, 10, 22, 22, 23, 23],
    pomodorosWithTask: 50,
    firstHourToday: 5,
    lastHourToday: 23,
    gapBeforeToday: 20,
    daysSinceFirstEvent: 365,
    mealSlotsToday: ['breakfast', 'lunch', 'snack', 'dinner'],
    rewardsRedeemed: 10,
    obolosSpent: 9000,
    obolosBalance: 9000,
    innNightsLastStay: 5,
  });
}

/** Tier I and identity-state entries: the ONLY ids a sweep may recognise. */
const SWEEP_ALLOWED = [
  'first_step', 'awakening', 'first_quest', 'first_habit', 'first_meal', 'first_coin', 'first_brew', 'first_seal',
  'debt_free', 'ledger_closed', 'scribe_of_accounts',
  'iron_bank_i', 'lannister_i', 'winter_i', 'bestiary_i', 'path_i',
  'fighters_guild_i', 'endless_stair_i', 'nine_divines_i', 'rewritten', 'marginalia', 'raised_shield', 'day_off',
  'isengard_i', 'beacons_i', 'broken_flask', 'full_circle',
  'first_scroll', 'second_chance', 'ferrymans_coin', 'deserved_rest', 'long_rest', 'chronicler_i',
  'squire', 'knight_errant', 'dragonborn', 'steadfast', 'monthly_vow', 'centenary_vow', 'lord_of_cinder',
];

describe('achievement catalogue', () => {
  it('has 184 entries with unique ids', () => {
    expect(ACHIEVEMENTS.length).toBe(184);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(184);
  });

  it('hides the coincidence tail: 87 hidden, roughly half the catalogue', () => {
    const hidden = ACHIEVEMENTS.filter((a) => a.hidden).length;
    expect(hidden).toBe(87);
    expect(hidden / ACHIEVEMENTS.length).toBeCloseTo(0.47, 1);
  });

  it('no two entries share a predicate outcome on the same day-count (no duplicate medals)', () => {
    // deep_work (6 pomodoros) and isengard_i must NOT pop on the same event.
    const six = blankContext({ countByTypeToday: { POMODORO_COMPLETED: 6 }, event: blankEvent() });
    expect(ACHIEVEMENTS_BY_ID.get('deep_work')!.check(six)).toBe(true);
    expect(ACHIEVEMENTS_BY_ID.get('isengard_i')!.check(six)).toBe(false);
    const seven = blankContext({ countByTypeToday: { POMODORO_COMPLETED: 7 }, event: blankEvent() });
    expect(ACHIEVEMENTS_BY_ID.get('isengard_i')!.check(seven)).toBe(true);
  });

  it('the backfill recognises only tier I and identity states (rule 6)', () => {
    const hits = ACHIEVEMENTS.filter((a) => a.check(maxedOutSweep())).map((a) => a.id).sort();
    expect(hits).toEqual([...SWEEP_ALLOWED].sort());
  });

  it('every entry above tier I lights up once the same account has an event', () => {
    const ctx = { ...maxedOutSweep(), event: blankEvent() };
    const hits = new Set(ACHIEVEMENTS.filter((a) => a.check(ctx)).map((a) => a.id));
    for (const id of [
      'iron_bank_iii', 'lannister_iii', 'winter_iii', 'bestiary_iii', 'path_iii', 'master_of_coin',
      'fighters_guild_iii', 'endless_stair_iii', 'nine_divines_iii', 'the_company', 'isengard_iii',
      'beacons_iii', 'library_unending', 'thirty_nights_at_table', 'tome_of_clear_thought', 'oghma_infinium', 'horn_of_valhalla',
      'chronicler_iii', 'fellowship', 'dawn_to_dusk', 'sun_to_sun', 'midnight_oil', 'long_table',
      'sealed_with_gold', 'seal_of_four_hands', 'labelled_potion',
    ]) {
      expect(hits.has(id), id).toBe(true);
    }
    // The ledger pair eggs additionally need the event itself to be a movement.
    const onMovement = { ...maxedOutSweep(), event: blankEvent({ type: 'INCOME_LOGGED', moduleId: 'finance' }) };
    expect(ACHIEVEMENTS_BY_ID.get('the_mirror')!.check(onMovement)).toBe(true);
    expect(ACHIEVEMENTS_BY_ID.get('lead_into_gold')!.check(onMovement)).toBe(true);
    expect(ACHIEVEMENTS_BY_ID.get('the_mirror')!.check(ctx)).toBe(false);
  });

  it('derives every i18nKey from the id', () => {
    for (const a of ACHIEVEMENTS) {
      expect(a.i18nKey).toBe(`rpg.achievements.${a.id}`);
    }
  });

  it('carries the roadmap-mandated entries', () => {
    const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
    for (const required of [
      'early_bird', 'night_owl', 'three_epics', 'perfect_day', 'hero_return',
      'chronicler_i', 'chronicler_ii', 'chronicler_iii',
      'steady_hand', 'ledger_closed', 'cauldron_master',
    ]) {
      expect(ids.has(required)).toBe(true);
    }
  });

  it('unlocks first_step on the very first event of a new account', () => {
    const ctx = blankContext({ totalEvents: 1 });
    expect(ACHIEVEMENTS_BY_ID.get('first_step')!.check(ctx)).toBe(true);
  });

  it('does not mistake a brand new account for a returning hero', () => {
    const ctx = blankContext({
      totalEvents: 1,
      daysSinceLastActivity: 0,
      event: blankEvent(),
    });
    expect(ACHIEVEMENTS_BY_ID.get('hero_return')!.check(ctx)).toBe(false);
  });

  it('needs all four event-emitting modules for Día Perfecto', () => {
    expect(ACHIEVEMENTS_BY_ID.get('perfect_day')!.check(
      blankContext({ modulesToday: ['quests', 'nutrition', 'finance'], event: blankEvent() }),
    )).toBe(false);
    expect(ACHIEVEMENTS_BY_ID.get('perfect_day')!.check(
      blankContext({ modulesToday: [...EVENT_MODULES, 'rpg'], event: blankEvent() }),
    )).toBe(true);
    // A day-scoped conjunction is earned in the act, never by the sweep.
    expect(ACHIEVEMENTS_BY_ID.get('perfect_day')!.check(
      blankContext({ modulesToday: [...EVENT_MODULES] }),
    )).toBe(false);
  });

  it('never asks for more than 2000 of anything (no grind)', () => {
    // The Cronista family is the single sanctioned counting ladder.
    const counting = ACHIEVEMENTS.filter((a) => a.id.startsWith('chronicler_'));
    expect(counting).toHaveLength(3);
    const live = (totalEvents: number) => blankContext({ totalEvents, event: blankEvent() });
    expect(ACHIEVEMENTS_BY_ID.get('chronicler_iii')!.check(live(1999))).toBe(false);
    expect(ACHIEVEMENTS_BY_ID.get('chronicler_iii')!.check(live(2000))).toBe(true);
    // Cronista II and III are earned in the act, never handed out by the sweep.
    expect(ACHIEVEMENTS_BY_ID.get('chronicler_iii')!.check(blankContext({ totalEvents: 2000 }))).toBe(false);
  });

  it('floors the XP before comparing (two decimals in storage)', () => {
    const beast = ACHIEVEMENTS_BY_ID.get('the_number')!;
    expect(beast.check(blankContext({ xpToday: 666.37, event: blankEvent() }))).toBe(true);
    expect(beast.check(blankContext({ xpToday: 665.99, event: blankEvent() }))).toBe(false);
    expect(beast.check(blankContext({ xpToday: 666 }))).toBe(false);
  });

  it('reads the ledger eggs off the movement payload', () => {
    const move = (amount: number, extra: Partial<AchievementEventContext> = {}) => blankContext({
      event: blankEvent({ type: 'EXPENSE_LOGGED', moduleId: 'finance', payload: { amount }, ...extra }),
    });
    expect(ACHIEVEMENTS_BY_ID.get('capicua')!.check(move(1221))).toBe(true);
    expect(ACHIEVEMENTS_BY_ID.get('capicua')!.check(move(121))).toBe(false);
    expect(ACHIEVEMENTS_BY_ID.get('perfect_figure')!.check(move(7777))).toBe(true);
    expect(ACHIEVEMENTS_BY_ID.get('perfect_figure')!.check(move(7778))).toBe(false);
    expect(ACHIEVEMENTS_BY_ID.get('a_single_coin')!.check(move(1))).toBe(true);
    // 2026-03-21 → DDMM = 2103.
    expect(ACHIEVEMENTS_BY_ID.get('the_date_in_the_sum')!.check(move(2103))).toBe(true);
    expect(ACHIEVEMENTS_BY_ID.get('the_date_in_the_sum')!.check(move(321))).toBe(false);
    // A task is never a movement, whatever its payload says.
    expect(ACHIEVEMENTS_BY_ID.get('a_single_coin')!.check(
      blankContext({ event: blankEvent({ payload: { amount: 1 } }) }),
    )).toBe(false);
  });

  it('the moon helper knows a full moon from a new one', () => {
    expect(isFullMoon('2026-03-03')).toBe(true);   // full moon 2026-03-03 11:38 UTC
    expect(isFullMoon('2000-01-21')).toBe(true);   // full moon 2000-01-21 04:40 UTC
    expect(isFullMoon('2026-02-17')).toBe(false);  // new moon
    expect(isFullMoon('2026-03-10')).toBe(false);  // last quarter
    // About two nights per synodic month.
    let nights = 0;
    for (let d = 1; d <= 30; d++) if (isFullMoon(`2026-04-${String(d).padStart(2, '0')}`)) nights++;
    expect(nights).toBeGreaterThanOrEqual(1);
    expect(nights).toBeLessThanOrEqual(3);
  });

  it('survives an empty context without throwing', () => {
    const ctx = blankContext({});
    for (const a of ACHIEVEMENTS) {
      expect(() => a.check(ctx)).not.toThrow();
    }
  });

  it('unlocks exactly the two backfill entries on a used-but-unmigrated account', () => {
    // What every existing install already satisfies: some history, a named
    // character, and nothing else. The shelf must read 2 / N.
    const ctx = blankContext({ totalEvents: 12, hasCharacterName: true });
    const hits = ACHIEVEMENTS.filter((a) => a.check(ctx)).map((a) => a.id);
    expect(hits.sort()).toEqual(['awakening', 'first_step']);
  });
});

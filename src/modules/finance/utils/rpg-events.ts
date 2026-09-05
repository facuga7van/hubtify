/**
 * Coinify's connection to the RPG bus.
 *
 * `src/modules/finance/index.ts` has declared `EXPENSE_LOGGED` / `INCOME_LOGGED`
 * handlers for months, and the engine has accepted them for just as long — but
 * nothing ever emitted them, so the only module about money paid zero XP. Games
 * reward you for showing up; most finance apps only tally what you did wrong.
 * This file is the "showing up" half.
 *
 * ── WHAT EMITS ─────────────────────────────────────────────────────────────
 *  · The manual quick-add on the hub dashboard widget.
 *  · The manual add on the ledger (`Transactions`), instalment plans included —
 *    ONE event for the plan, not one per instalment.
 *
 * ── WHAT DELIBERATELY DOES NOT EMIT (and why) ──────────────────────────────
 *  · **Statement / CSV import.** A single PDF is 60 rows; paying per row would
 *    make importing a bank summary the most XP-efficient action in the whole
 *    app. Pure farming, zero effort. (`STATEMENT_IMPORTED` exists as a handler
 *    but stays unemitted for now — one import, one reward, is a phase-3 call.)
 *  · **Automatic recurring generation.** The app writes those rows on its own
 *    when a month opens. Nobody showed up; nobody gets paid.
 *  · **Card statement payments.** The purchases were already logged when they
 *    happened; the `Pago Tarjeta` row is bookkeeping, and rewarding it would pay
 *    twice for one act — exactly the double-count the expense aggregation goes
 *    out of its way to avoid.
 *  · **Edits.** Fixing a typo is not an act of tracking. Paying for it would
 *    turn "edit, undo, edit" into an XP faucet.
 *  · **Deletes** do not PAY — they take back. Deleting a movement that earned
 *    XP emits `MOVEMENT_DELETED` with the same `transactionId` the alta
 *    carried, so the engine can find the original event by `ref_id` and
 *    reverse it, exactly like `TASK_UNCOMPLETED` reverses `TASK_COMPLETED`.
 *    Without it, "add $1, delete, repeat" was an unlimited faucet of XP, daily
 *    combo and finance mastery.
 *  · **Transfers between own accounts.** `finance:transferBetweenAccounts`
 *    writes two rows (expense + income under the reserved `Transferencia`
 *    category), but moving your own money from Mercado Pago to the bank is not
 *    an economic movement — nothing was earned, nothing was spent. Paying XP
 *    here would make "transfer back and forth" the cheapest farm in the app,
 *    twice over (two rows per gesture). The transfer UI simply never calls
 *    `emitMovementLogged`; keep it that way.
 *  · **The instalment-plan form on the Installments screen.** Same reasoning as
 *    the ledger add would suggest the opposite, but that screen is plan
 *    *management* (a plan created there is usually a purchase already logged
 *    elsewhere), so it stays quiet until phase 3 decides.
 *
 * The rule underneath all of it: pay for the human act of registering a
 * movement, once, and never for the machine doing bookkeeping.
 */

/** XP for logging one movement by hand — the values `index.ts` has always declared. */
export const MANUAL_MOVEMENT_XP = 5;

export interface FinanceRpgResult {
  /** XP actually awarded, after combo and random bonus. */
  xpGained: number;
}

/**
 * What the movement WAS, for the achievement matcher (`the_mirror`,
 * `lead_into_gold`, the instalment eggs). `amount` is always positive;
 * `installments` travels only when the alta is an instalment plan.
 */
export interface MovementDetails {
  amount: number;
  currency: string;
  installments?: number;
}

/**
 * Emits `EXPENSE_LOGGED` / `INCOME_LOGGED` for a movement the user typed by hand
 * and returns the XP the engine actually granted (combo + bonus applied), so the
 * caller can put the real number in its toast instead of the base 5.
 *
 * `transactionId` is the row (or instalment-plan group) that was written; it
 * travels in the payload so the engine can persist it as `ref_id` and a later
 * {@link emitMovementDeleted} can reverse exactly this event.
 *
 * Also fires `rpg:statsChanged` so the player card updates, exactly like the
 * quests and nutrition modules do.
 *
 * Never throws: a failed RPG event must not turn a saved transaction into an
 * error message. It returns `null` and the caller shows its normal toast.
 */
export async function emitMovementLogged(
  type: 'expense' | 'income',
  transactionId?: string,
  details?: MovementDetails,
): Promise<FinanceRpgResult | null> {
  try {
    const result = await window.api.processRpgEvent({
      type: type === 'income' ? 'INCOME_LOGGED' : 'EXPENSE_LOGGED',
      moduleId: 'finance',
      payload: {
        xp: MANUAL_MOVEMENT_XP, hp: 0, movementType: type,
        ...(transactionId ? { transactionId } : {}),
        ...(details ? { amount: Math.abs(details.amount), currency: details.currency } : {}),
        ...(details?.installments && details.installments > 1 ? { installments: details.installments } : {}),
      },
      timestamp: Date.now(),
    });
    window.dispatchEvent(new Event('rpg:statsChanged'));
    return { xpGained: result.xpGained };
  } catch (err) {
    console.error('[finance] processRpgEvent failed:', err);
    return null;
  }
}

/**
 * The undo of {@link emitMovementLogged}: the movement (or plan) `transactionId`
 * was deleted, so whatever XP its alta paid must come back — same contract as
 * `TASK_UNCOMPLETED` (`xp` already negative, the entity id in the payload, the
 * engine looks the original event up by `ref_id` and reverses its exact XP).
 *
 * `movementType` tells the engine which of the two alta types to look for.
 * Never throws; the delete already happened and must not fail on a bookkeeping
 * hiccup.
 */
export async function emitMovementDeleted(
  transactionId: string,
  movementType: 'expense' | 'income',
): Promise<FinanceRpgResult | null> {
  try {
    const result = await window.api.processRpgEvent({
      type: 'MOVEMENT_DELETED',
      moduleId: 'finance',
      payload: { xp: -MANUAL_MOVEMENT_XP, hp: 0, movementType, transactionId },
      timestamp: Date.now(),
    });
    window.dispatchEvent(new Event('rpg:statsChanged'));
    return { xpGained: result.xpGained };
  } catch (err) {
    console.error('[finance] processRpgEvent(MOVEMENT_DELETED) failed:', err);
    return null;
  }
}

/** XP for closing a month inside every budget the user set. */
export const BUDGET_MONTH_XP = 100;

/**
 * Emits `BUDGET_MONTH_MET` for a month that closed inside every limit.
 *
 * The engine de-duplicates on `ref_id = month`, so a second emission for the same
 * month is harmless; the renderer guards with localStorage anyway so the
 * celebration toast only ever fires once.
 */
export async function emitBudgetMonthMet(month: string): Promise<FinanceRpgResult | null> {
  try {
    const result = await window.api.processRpgEvent({
      type: 'BUDGET_MONTH_MET',
      moduleId: 'finance',
      payload: { month, xp: BUDGET_MONTH_XP, hp: 0 },
      timestamp: Date.now(),
    });
    window.dispatchEvent(new Event('rpg:statsChanged'));
    return { xpGained: result.xpGained };
  } catch (err) {
    console.error('[finance] processRpgEvent(BUDGET_MONTH_MET) failed:', err);
    return null;
  }
}

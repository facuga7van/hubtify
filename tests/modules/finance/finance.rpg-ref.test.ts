/**
 * Review RPG 08-2026, finding #3 (high): "add $1 → +5..30 XP → delete → repeat"
 * was an unlimited faucet. The alta carried no `transactionId`, so nothing could
 * ever be reversed. Now the alta rides with its ref and the delete emits the
 * undo, same contract as TASK_COMPLETED / TASK_UNCOMPLETED.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const processRpgEvent = vi.fn(async () => ({ xpGained: 7 }));
const dispatchEvent = vi.fn();

// The helpers only touch `window` inside the functions, so a bare stub is enough.
(globalThis as unknown as { window: unknown }).window = {
  api: { processRpgEvent },
  dispatchEvent,
};

const { emitMovementLogged, emitMovementDeleted, MANUAL_MOVEMENT_XP } = await import('@modules/finance/utils/rpg-events');

beforeEach(() => {
  processRpgEvent.mockClear();
  dispatchEvent.mockClear();
});

describe('emitMovementLogged', () => {
  it('sends the transaction id as the event ref', async () => {
    const result = await emitMovementLogged('expense', 'tx-1');
    expect(result).toEqual({ xpGained: 7 });
    expect(processRpgEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'EXPENSE_LOGGED',
      moduleId: 'finance',
      payload: { xp: MANUAL_MOVEMENT_XP, hp: 0, movementType: 'expense', transactionId: 'tx-1' },
    }));
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('income maps to INCOME_LOGGED, and an alta without an id still works', async () => {
    await emitMovementLogged('income');
    const event = processRpgEvent.mock.calls[0][0] as unknown as { type: string; payload: Record<string, unknown> };
    expect(event.type).toBe('INCOME_LOGGED');
    expect(event.payload).not.toHaveProperty('transactionId');
    // Sin detalles no se inventan: el matcher distingue "no sé" de "cero".
    expect(event.payload).not.toHaveProperty('amount');
    expect(event.payload).not.toHaveProperty('installments');
  });

  // Logros v2: `the_mirror` / `lead_into_gold` leen monto y moneda del payload;
  // las cuotas solo viajan cuando el alta ES un plan.
  it('carries amount (always positive) and currency for the achievement matcher', async () => {
    await emitMovementLogged('expense', 'tx-1', { amount: -1234.5, currency: 'USD' });
    const event = processRpgEvent.mock.calls[0][0] as unknown as { payload: Record<string, unknown> };
    expect(event.payload).toMatchObject({ amount: 1234.5, currency: 'USD' });
    expect(event.payload).not.toHaveProperty('installments');
  });

  it('an instalment plan travels as ONE event with its instalment count', async () => {
    await emitMovementLogged('expense', 'grp-1', { amount: 60000, currency: 'ARS', installments: 6 });
    const event = processRpgEvent.mock.calls[0][0] as unknown as { payload: Record<string, unknown> };
    expect(event.payload).toMatchObject({ amount: 60000, currency: 'ARS', installments: 6 });
  });

  it('a single-instalment purchase is not a plan: no `installments` key', async () => {
    await emitMovementLogged('expense', 'tx-2', { amount: 100, currency: 'ARS', installments: 1 });
    const event = processRpgEvent.mock.calls[0][0] as unknown as { payload: Record<string, unknown> };
    expect(event.payload).not.toHaveProperty('installments');
  });
});

describe('emitMovementDeleted', () => {
  it('emits the undo with the same ref and an already-negative xp (quests convention)', async () => {
    await emitMovementDeleted('tx-1', 'expense');
    expect(processRpgEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'MOVEMENT_DELETED',
      moduleId: 'finance',
      payload: { xp: -MANUAL_MOVEMENT_XP, hp: 0, movementType: 'expense', transactionId: 'tx-1' },
    }));
  });

  it('never throws when the engine fails — the delete already happened', async () => {
    processRpgEvent.mockRejectedValueOnce(new Error('engine down'));
    await expect(emitMovementDeleted('tx-2', 'income')).resolves.toBeNull();
  });
});

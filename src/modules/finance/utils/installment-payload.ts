/**
 * La misma compra en cuotas se carga desde tres pantallas (libro mayor, pestaña
 * Cuotas, Préstamos) y las tres armaban el payload a mano. Dos consecuencias:
 *
 * 1. El libro mayor no mandaba `paymentMethod`, así que
 *    `finance:createInstallmentGroup` evaluaba `isCreditCard` en `false` aunque
 *    el usuario hubiera elegido tarjeta: el plan quedaba con `credit_card_id`
 *    NULL, descontaba del saldo y no entraba en ningún resumen.
 * 2. Cada pantalla decidía por su cuenta si lo tipeado era el monto de la cuota
 *    o el total financiado.
 *
 * Acá viven las dos decisiones, una sola vez.
 */
import type { Currency, PaymentMethod } from '../types';
import { splitTotalIntoInstallments, installmentAmountsFromTotal } from './split-total';

/** Qué número escribió la persona: el precio de la cuota, o el total financiado. */
export type AmountMode = 'installment' | 'total';

export interface ResolvedInstallmentAmounts {
  /** Lo que sale cada cuota (la primera, si el reparto no es exacto). */
  installmentAmount: number;
  /** El total del plan. */
  totalAmount: number;
  /** La lista completa, solo cuando el redondeo obliga a que la última difiera. */
  installmentAmounts?: number[];
}

/**
 * Traduce «lo tipeado» al par (monto de cuota, total) que espera el backend.
 * `null` cuando los números no arman un plan, para que la UI no mande basura.
 */
export function resolveInstallmentAmounts(
  typedAmount: number,
  installmentCount: number,
  mode: AmountMode,
): ResolvedInstallmentAmounts | null {
  if (!Number.isFinite(typedAmount) || typedAmount <= 0) return null;
  if (!Number.isInteger(installmentCount) || installmentCount < 1) return null;

  if (mode !== 'total') {
    return {
      installmentAmount: typedAmount,
      totalAmount: Math.round(typedAmount * installmentCount * 100) / 100,
    };
  }

  const split = splitTotalIntoInstallments(typedAmount, installmentCount);
  if (!split) return null;

  // Reparto exacto: no hace falta mandar la lista, todas las cuotas son iguales.
  if (split.per === split.last) {
    return { installmentAmount: split.per, totalAmount: typedAmount };
  }

  return {
    installmentAmount: split.per,
    totalAmount: typedAmount,
    installmentAmounts: installmentAmountsFromTotal(typedAmount, installmentCount) ?? undefined,
  };
}

export interface InstallmentGroupInput {
  description: string;
  category: string;
  currency: Currency;
  date: string;
  paymentMethod: PaymentMethod;
  creditCardId?: string;
  installments: number;
  /** El número tipeado, interpretado según `amountMode`. */
  amount: number;
  amountMode: AmountMode;
}

export interface InstallmentGroupPayload {
  description: string;
  totalAmount: number;
  installmentCount: number;
  installmentAmount: number;
  installmentAmounts?: number[];
  currency: Currency;
  category: string;
  startDate: string;
  /** SIN esto el handler trata cualquier plan como si no fuera con tarjeta. */
  paymentMethod: PaymentMethod;
  creditCardId?: string;
}

/** El payload de `finance:createInstallmentGroup`, con el medio de pago incluido. */
export function buildInstallmentGroupPayload(input: InstallmentGroupInput): InstallmentGroupPayload {
  const amounts = resolveInstallmentAmounts(input.amount, input.installments, input.amountMode)
    ?? { installmentAmount: input.amount, totalAmount: input.amount * input.installments };

  return {
    description: input.description || input.category,
    totalAmount: amounts.totalAmount,
    installmentCount: input.installments,
    installmentAmount: amounts.installmentAmount,
    installmentAmounts: amounts.installmentAmounts,
    currency: input.currency,
    category: input.category,
    startDate: input.date,
    paymentMethod: input.paymentMethod,
    creditCardId: input.paymentMethod === 'credit_card' ? input.creditCardId : undefined,
  };
}

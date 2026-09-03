// src/modules/finance/types.ts

export type TransactionType = 'expense' | 'income';
export type PaymentMethod = 'cash' | 'debit' | 'transfer' | 'credit_card';
export type TransactionSource = 'manual' | 'recurring' | 'import';
export type LoanDirection = 'lent' | 'borrowed';
export type LoanType = 'single' | 'installments';
export type Currency = 'ARS' | 'USD';

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  currency: Currency;
  category: string;
  description?: string;
  date: string;
  paymentMethod: PaymentMethod;
  installments?: number;
  installmentGroupId?: string;
  forThirdParty?: string;
  source: TransactionSource;
  recurringId?: string;
  importBatchId?: string;
  creditCardId?: string;
  impactsBalance?: number;
  /** Cuenta a la que impacta el movimiento. `null` = sin cuenta asignada. */
  accountId?: string | null;
  /** Las dos patas de una transferencia entre cuentas comparten este id. */
  transferGroupId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AccountKind = 'cash' | 'bank' | 'wallet';

/**
 * Id determinístico de la cuenta «Efectivo» sembrada por la migración v17.
 * Mirrors `DEFAULT_CASH_ACCOUNT_ID` en `electron/modules/finance.balance.ts`.
 */
export const DEFAULT_CASH_ACCOUNT_ID = 'account-cash-default';

export interface FinanceAccount {
  id: string;
  name: string;
  kind: AccountKind;
  currency: Currency;
  initialBalance: number;
  accountOrder: number;
  /** initial_balance + ingresos − egresos vivos que impactan balance. */
  balance: number;
  /**
   * Movimientos vivos que apuntan a esta cuenta. Cero = nunca se usó, que no es
   * lo mismo que una cuenta usada que quedó en cero: el cofre esconde la
   * primera. Opcional porque un main viejo no la manda.
   */
  movements?: number;
}

export interface InstallmentGroup {
  id: string;
  description: string;
  totalAmount: number;
  installmentCount: number;
  installmentAmount: number;
  currency: Currency;
  startDate: string;
  category: string;
  paymentMethod: 'credit_card';
  forThirdParty?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Loan {
  id: string;
  personName: string;
  direction: LoanDirection;
  type: LoanType;
  amount: number;
  currency: Currency;
  date: string;
  description?: string;
  settled: boolean;
  settledDate?: string;
  installmentGroupId?: string;
  createdAt: string;
}

export interface LoanPayment {
  id: string;
  loanId: string;
  amount: number;
  installmentNumber?: number;
  date: string;
  note?: string;
  createdAt: string;
}

export interface RecurringAmountHistory {
  id: string;
  recurringId: string;
  previousAmount: number;
  newAmount: number;
  changedAt: string;
}

/**
 * A row parsed out of a card PDF. Extends the bridge's `ParsedRow` with the
 * importer's tax flag, which `shared/types.ts` does not declare yet.
 */
export interface ImportParsedRow {
  date: string;
  merchant: string;
  installmentCurrent?: number;
  installmentTotal?: number;
  amountARS?: number;
  amountUSD?: number;
  isExcluded: boolean;
  suggestedCategory: string;
  /** Tax / perception / financing-interest line — included, but flagged. */
  isTax?: boolean;
}

export interface CategoryMapping {
  id: string;
  merchantPattern: string;
  category: string;
  createdAt: string;
}

export interface CreditCard {
  id: string;
  name: string;
  closingDay: number;
  /** Día de vencimiento del resumen. `null` = sin agenda de vencimiento. */
  dueDay?: number | null;
  /** Últimos 4, impresos en el resumen: identifican a qué tarjeta pertenece un PDF. */
  last4?: string | null;
  /** Con qué parser se leyó su resumen (`galicia_visa`). */
  issuer?: string | null;
  createdAt: string;
}

export interface CreditCardStatement {
  id: string;
  creditCardId: string;
  creditCardName?: string;
  periodMonth: string;
  calculatedAmount: number;
  /** USD side of the statement (cards can bill both currencies in one period). */
  calculatedAmountUsd?: number;
  paidAmount: number | null;
  paidAmountUsd?: number | null;
  status: 'pending' | 'paid';
  // ── Los números DEL PAPEL (v19) ────────────────────────────────
  // Conviven con los calculados y no los pisan: que difieran ES el dato.
  /** Fecha exacta de cierre impresa, no el día del mes derivado. */
  closingDate?: string | null;
  dueDate?: string | null;
  /** «TOTAL A PAGAR» del banco. */
  statementTotalArs?: number | null;
  statementTotalUsd?: number | null;
  minimumPaymentArs?: number | null;
  previousBalanceArs?: number | null;
  previousBalanceUsd?: number | null;
  /** «SU PAGO»: lo que se pagó durante el período. */
  priorPaymentArs?: number | null;
  priorPaymentUsd?: number | null;
  /** 1 cerró · 0 no cerró · null sin checksum (distinto de «cerró»). */
  reconciled?: number | null;
  /** Foto del bloque «Cuotas a vencer», tal cual lo imprimió el banco. */
  forecastJson?: string | null;
  paidDate: string | null;
  transactionId: string | null;
  transactionIdUsd?: string | null;
  createdAt: string;
}

/**
 * Category the auto-generated "pay the card statement" transaction is filed
 * under. Mirrors `CARD_PAYMENT_CATEGORY` in `electron/modules/finance.balance.ts`.
 */
export const CARD_PAYMENT_CATEGORY = 'Pago Tarjeta';

/**
 * Category the PDF importer files card taxes, perceptions and financing
 * interest under. Mirrors `CARD_TAX_CATEGORY` in
 * `electron/modules/finance.balance.ts` — `finance.tax-category.test.ts` fails
 * if the two drift apart.
 */
export const CARD_TAX_CATEGORY = 'Impuestos de tarjeta';

/**
 * Category shared by the two legs of an inter-account transfer. Excluded from
 * every income/expense aggregation (a transfer is not an economic event) while
 * still moving each account's balance. Mirrors `TRANSFER_CATEGORY` in
 * `electron/modules/finance.balance.ts` — the guard test fails on drift.
 */
export const TRANSFER_CATEGORY = 'Transferencia';

/**
 * Categories the app writes on its own. They show up in reports and in the
 * category wheel, but a manual transaction must never be filed under one, so
 * every category picker hides them.
 */
export const RESERVED_CATEGORIES: readonly string[] = [CARD_PAYMENT_CATEGORY, CARD_TAX_CATEGORY, TRANSFER_CATEGORY];

export const CATEGORIES = [
  'Entretenimiento',
  'Delivery',
  'Servicios',
  'Suscripciones',
  'Transporte',
  'Compras',
  'Supermercado',
  'Salud',
  'Educacion',
  'Inversiones',
  'Otros',
] as const;

export type Category = (typeof CATEGORIES)[number];

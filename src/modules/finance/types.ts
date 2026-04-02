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
  impactsBalance?: boolean;
  createdAt: string;
  updatedAt: string;
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
  createdAt: string;
}

export interface CreditCardStatement {
  id: string;
  creditCardId: string;
  creditCardName?: string;
  periodMonth: string;
  calculatedAmount: number;
  paidAmount: number | null;
  status: 'pending' | 'paid';
  paidDate: string | null;
  transactionId: string | null;
  createdAt: string;
}

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

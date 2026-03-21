export interface Transaction {
  id: string;
  type: 'expense' | 'income';
  amount: number;
  currency: string;
  category: string;
  description: string;
  date: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface Loan {
  id: string;
  personName: string;
  type: 'lent' | 'borrowed';
  amount: number;
  currency: string;
  date: string;
  description: string;
  settled: boolean;
  settledDate: string | null;
  createdAt: string;
}

export interface IncomeSource {
  id: string;
  name: string;
  estimatedAmount: number;
  frequency: string;
  isVariable: boolean;
  active: boolean;
  createdAt: string;
}

export const CATEGORIES = [
  'Entretenimiento', 'Delivery', 'Servicios', 'Suscripciones',
  'Transporte', 'Compras', 'Supermercado', 'Salud', 'Educacion', 'Otros',
];

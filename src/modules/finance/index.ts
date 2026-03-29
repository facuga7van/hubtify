import type { ModuleDefinition } from '../../core/module-registry';
import { financeMigrations } from './finance.schema';
import FinanceDashboard from './components/FinanceDashboard';
import FinanceDashboardWidget from './components/FinanceDashboardWidget';

export const financeModule: ModuleDefinition = {
  id: 'finance',
  name: 'Coinify',
  icon: () => null,
  routes: [
    { path: '/finance', component: FinanceDashboard },
  ],
  dashboardWidget: FinanceDashboardWidget,
  migrations: financeMigrations,
  rpgEventHandlers: {
    EXPENSE_LOGGED: () => ({ xp: 5, hp: 0 }),
    INCOME_LOGGED: () => ({ xp: 5, hp: 0 }),
    LOAN_SETTLED: () => ({ xp: 10, hp: 0 }),
    STATEMENT_IMPORTED: () => ({ xp: 15, hp: 0 }),
    RECURRING_UPDATED: () => ({ xp: 3, hp: 0 }),
  },
};

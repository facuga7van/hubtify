import type { ModuleDefinition } from '../../core/module-registry';
import { financeMigrations } from './finance.schema';
import FinanceDashboard from './components/FinanceDashboard';
import FinanceDashboardWidget from './components/FinanceDashboardWidget';

export const financeModule: ModuleDefinition = {
  id: 'finance',
  name: 'Finance',
  icon: () => null,
  routes: [
    { path: '/finance', component: FinanceDashboard },
  ],
  dashboardWidget: FinanceDashboardWidget,
  migrations: financeMigrations,
  rpgEventHandlers: {
    EXPENSE_LOGGED: (payload: unknown) => {
      const p = payload as { xp?: number; hp?: number };
      return { xp: p.xp ?? 5, hp: p.hp ?? 0 };
    },
  },
};

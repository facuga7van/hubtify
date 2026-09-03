import type { ComponentType } from 'react';
import TasksDashboardWidget from '../../modules/quests/components/TasksDashboardWidget';
import HabitsDashboardWidget from '../../modules/quests/components/HabitsDashboardWidget';
import NutritionDashboardWidget from '../../modules/nutrition/components/NutritionDashboardWidget';
import FinanceDashboardWidget from '../../modules/finance/components/DashboardWidget';
import CauldronDashboardWidget from '../../modules/cauldron/components/CauldronDashboardWidget';
import { Sword, Flame, Bread, Coin, Cauldron } from '../../shared/components/icons/CodexIcons';

/* ── Types ──────────────────────────────────────── */

export type ColSpan = 2 | 4;
export type RowSpan = 1 | 2;

export interface WidgetLayout {
  id: string;
  colSpan: ColSpan;
  rowSpan: RowSpan;
}

export interface DashboardLayoutState {
  version: 1;
  widgets: WidgetLayout[];
}

export interface WidgetDefinition {
  component: ComponentType<{ colSpan?: number }>;
  defaultColSpan: ColSpan;
  titleKey: string;
  titleFallback: string;
  tome: string;
  latin: string;
  IconComponent: ComponentType<React.SVGProps<SVGSVGElement>>;
  navTo: string;
}

/* ── Registry ───────────────────────────────────── */

export const WIDGET_DEFINITIONS: Record<string, WidgetDefinition> = {
  tasks: {
    component: TasksDashboardWidget as ComponentType<{ colSpan?: number }>,
    defaultColSpan: 2,
    titleKey: 'dashboard.moduleTasks',
    titleFallback: 'Libro de Misiones',
    tome: 'Tomus I',
    latin: 'Acta Heroum',
    IconComponent: Sword,
    navTo: '/quests',
  },
  habits: {
    component: HabitsDashboardWidget as ComponentType<{ colSpan?: number }>,
    defaultColSpan: 2,
    titleKey: 'dashboard.moduleHabits',
    titleFallback: 'Hábitos Diarios',
    tome: 'Tomus I-B',
    latin: 'De Ritibus Quotidianis',
    IconComponent: Flame,
    navTo: '/quests',
  },
  nutrition: {
    component: NutritionDashboardWidget as ComponentType<{ colSpan?: number }>,
    defaultColSpan: 2,
    titleKey: 'dashboard.moduleNutrition',
    titleFallback: 'Diario de Provisiones',
    tome: 'Tomus II',
    latin: 'De Cibo et Salute',
    IconComponent: Bread,
    navTo: '/nutrition',
  },
  finance: {
    component: FinanceDashboardWidget as ComponentType<{ colSpan?: number }>,
    defaultColSpan: 2,
    titleKey: 'dashboard.moduleFinance',
    titleFallback: 'Libro del Tesorero',
    tome: 'Tomus III',
    latin: 'De Rebus Aeris',
    IconComponent: Coin,
    navTo: '/finance',
  },
  cauldron: {
    component: CauldronDashboardWidget as ComponentType<{ colSpan?: number }>,
    defaultColSpan: 4,
    titleKey: 'dashboard.moduleCauldron',
    titleFallback: 'Cámara del Caldero',
    tome: 'Tomus IV',
    latin: 'Decoctio Magna',
    IconComponent: Cauldron,
    navTo: '/cauldron',
  },
};

/* ── Default Layout ─────────────────────────────── */

export const DEFAULT_LAYOUT: DashboardLayoutState = {
  version: 1,
  widgets: [
    { id: 'tasks', colSpan: 2, rowSpan: 1 },
    { id: 'habits', colSpan: 2, rowSpan: 1 },
    { id: 'nutrition', colSpan: 2, rowSpan: 1 },
    { id: 'finance', colSpan: 2, rowSpan: 1 },
    { id: 'cauldron', colSpan: 4, rowSpan: 1 },
  ],
};

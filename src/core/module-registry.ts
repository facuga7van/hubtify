import type { ComponentType } from 'react';
import type { Migration } from '../../shared/types';

/**
 * Type-only module contract.
 *
 * NOTE: the runtime `ModuleRegistry` class that used to live here was removed —
 * it was never wired up. Nothing dispatches through a registry today:
 *   - migrations run directly from `electron/main.ts`
 *   - dashboard widgets are imported directly by `src/hub/widgets/widget-registry.ts`
 *   - routes are hardcoded in `src/App.tsx` JSX
 *
 * The interface stays because `src/modules/{quests,nutrition,finance,cauldron}/index.ts`
 * still use it to shape their `*Module` export. If those exports are ever removed
 * (they are currently imported but unused in `App.tsx`), this file can go too.
 */

export interface RouteDefinition {
  path: string;
  component: ComponentType;
}

export type RpgEventHandler = (payload: unknown) => { xp: number; hp: number };

export interface ModuleDefinition {
  id: string;
  name: string;
  icon: ComponentType;
  routes: RouteDefinition[];
  dashboardWidget: ComponentType;
  migrations: Migration[];
  rpgEventHandlers: Record<string, RpgEventHandler>;
  onInit?: () => Promise<void>;
  onDestroy?: () => Promise<void>;
}

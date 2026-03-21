// ── RPG Types ──────────────────────────────────────────────

export interface PlayerStats {
  userId: string;
  level: number;
  xp: number;
  xpToNextLevel: number;
  hp: number;
  maxHp: number;
  title: string;
  streak: number;
  dailyCombo: number;
  comboDate: string | null;
  streakLastDate: string | null;
  totalTasks: number;
  totalMeals: number;
  totalExpenses: number;
}

export interface RpgEvent {
  type: string;
  moduleId: string;
  payload: unknown;
  timestamp: number;
}

export interface RpgEventRecord {
  id: number;
  moduleId: string;
  eventType: string;
  xpGained: number;
  hpChange: number;
  comboMultiplier: number;
  bonusMultiplier: number;
  payload: string;
  createdAt: string;
}

// ── Module Types ───────────────────────────────────────────

export interface Migration {
  namespace: string;
  version: number;
  up: string;
}

// ── API Types ──────────────────────────────────────────────

export interface HubtifyApi {
  getRpgStats: () => Promise<PlayerStats>;
  processRpgEvent: (event: RpgEvent) => Promise<{ xpGained: number; hpChange: number; leveledUp: boolean; newTitle: string | null }>;
  getRpgHistory: (limit: number) => Promise<RpgEventRecord[]>;
  runMigrations: (migrations: Migration[]) => Promise<void>;
  windowMinimize: () => void;
  windowMaximize: () => void;
  windowClose: () => void;
}

// ── RPG Constants ──────────────────────────────────────────

export const XP_TIERS = { quick: 5, normal: 15, epic: 40 } as const;

export const COMBO_MULTIPLIERS = [1.0, 1.25, 1.5, 1.75, 2.0] as const;

export const RANDOM_BONUS_TABLE = [
  { weight: 70, multiplier: 1.0 },
  { weight: 20, multiplier: 1.5 },
  { weight: 8, multiplier: 2.0 },
  { weight: 2, multiplier: 3.0 },
] as const;

export const STREAK_MILESTONES: Record<number, number> = {
  3: 25, 7: 50, 14: 100, 30: 250, 60: 500, 100: 1000,
};

export const TITLE_THRESHOLDS: [number, string][] = [
  [50, 'Leyenda'], [40, 'Hero'], [30, 'Champion'],
  [20, 'Caballero'], [10, 'Guerrero'], [5, 'Escudero'], [1, 'Campesino'],
];

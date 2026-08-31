export const TASK_TIER = { QUICK: 1, NORMAL: 2, EPIC: 3 } as const;
export type TaskTier = 1 | 2 | 3;

export const XP_MAP: Record<TaskTier, number> = {
  [TASK_TIER.QUICK]: 5,
  [TASK_TIER.NORMAL]: 15,
  [TASK_TIER.EPIC]: 40,
};

export const MAX_SUBTASKS = 30;

export interface Project {
  id: string;
  name: string;
  color: string;
  order: number;
  createdAt: string;
}

export type HabitFrequency = 'daily' | 'weekly' | 'monthly';

/** Cap enforced by the backend; the row renders at most this many shield pips. */
export const MAX_HABIT_SHIELDS = 3;

/** ISO weekday numbers, Monday first — the order the day toggles are drawn in. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export interface Habit {
  id: string;
  name: string;
  frequency: HabitFrequency;
  timesPerWeek: number;
  createdAt: string;
  /** ISO weekdays (1 = Monday … 7 = Sunday), or null for "N times a week". */
  specificDays: number[] | null;
}

export interface HabitWithStreak extends Habit {
  streak: number;
  /** Consecutive fully-met weeks. Only meaningful for weekly habits. */
  weekStreak: number;
  checkedToday: boolean;
  checkedYesterday: boolean;
  /** Today is explicitly excused: not done, but not owed either. */
  skippedToday: boolean;
  checksThisPeriod: number;
  targetThisPeriod: number;
  /** Whether the habit still wants a check TODAY (respects chosen days + skips). */
  pendingToday: boolean;
  /** Streak shields in the bank (0..MAX_HABIT_SHIELDS). */
  shieldCount: number;
  /** A shield is currently holding this streak together. */
  shieldUsed: boolean;
}

export const PROJECT_COLORS = [
  '#8b7355', // tierra
  '#6b7c5e', // verde musgo
  '#7c6b6b', // borravino
  '#5e6b7c', // azul pizarra
  '#7c7254', // dorado oscuro
  '#6b5e7c', // violeta
  '#7c5e5e', // cobre
  '#5e7c72', // verde agua
] as const;

export interface Task {
  id: string;
  name: string;
  description: string;
  status: boolean;
  tier: TaskTier;
  category: string;
  projectId: string | null;
  dueDate: string | null;
  order: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Subtask {
  id: string;
  taskId: string;
  name: string;
  description: string;
  tier: TaskTier;
  status: boolean;
  order: number;
  completedAt: string | null;
}

export type BonusTier = 'normal' | 'good' | 'critical' | 'legendary';

export interface XpToastData {
  xp: number;
  bonusTier?: BonusTier;
  comboMultiplier: number;
  streakMilestone?: number | null;
}

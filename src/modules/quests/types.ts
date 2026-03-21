export const TASK_TIER = { QUICK: 1, NORMAL: 2, EPIC: 3 } as const;
export type TaskTier = 1 | 2 | 3;

export const XP_MAP: Record<TaskTier, number> = {
  [TASK_TIER.QUICK]: 5,
  [TASK_TIER.NORMAL]: 15,
  [TASK_TIER.EPIC]: 40,
};

export const MAX_SUBTASKS = 30;

export interface Task {
  id: string;
  name: string;
  description: string;
  status: boolean;
  tier: TaskTier;
  category: string;
  dueDate: string | null;
  order: number;
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

export interface BonusRoll {
  tier: BonusTier;
  multiplier: number;
}

export interface XpToastData {
  xp: number;
  bonusTier: BonusTier;
  comboMultiplier: number;
  streakMilestone?: number | null;
}

export function migrateOldDifficulty(oldDiff: number): TaskTier {
  if (oldDiff <= 3) return TASK_TIER.QUICK;
  if (oldDiff <= 7) return TASK_TIER.NORMAL;
  return TASK_TIER.EPIC;
}

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
  processRpgEvent: (event: RpgEvent) => Promise<{ xpGained: number; hpChange: number; leveledUp: boolean; newTitle: string | null; milestoneXp?: number }>;
  getRpgHistory: (limit: number) => Promise<RpgEventRecord[]>;
  rpgGetDashboardStats: () => Promise<{ xpToday: number; xpHistory: Array<{ date: string; xp: number }>; eventsToday: number }>;
  runMigrations: (migrations: Migration[]) => Promise<void>;
  windowMinimize: () => void;
  windowMaximize: () => void;
  windowClose: () => void;

  // Quests
  questsGetTasks: (projectId?: string | null) => Promise<unknown[]>;
  questsUpsertTask: (task: Record<string, unknown>) => Promise<string>;
  questsDeleteTasks: (ids: string[]) => Promise<void>;
  questsSetTaskStatus: (taskId: string, status: boolean) => Promise<void>;
  questsSyncTaskOrders: (orders: Array<{ id: string; order: number }>) => Promise<void>;
  questsGetSubtasks: (taskId: string) => Promise<unknown[]>;
  questsAddSubtask: (taskId: string, subtask: Record<string, unknown>) => Promise<string>;
  questsUpdateSubtask: (subtaskId: string, changes: Record<string, unknown>) => Promise<void>;
  questsDeleteSubtask: (subtaskId: string) => Promise<void>;
  questsSetSubtaskStatus: (subtaskId: string, status: boolean, completedAt?: string) => Promise<void>;
  questsSyncSubtaskOrders: (taskId: string, orderedIds: string[]) => Promise<void>;
  questsGetCategories: (projectId?: string | null) => Promise<string[]>;
  questsEnsureCategory: (name: string, projectId?: string | null) => Promise<void>;
  questsGetHabits: () => Promise<unknown[]>;
  questsAddHabit: (habit: { name: string; frequency: string; timesPerWeek: number }) => Promise<string>;
  questsDeleteHabit: (id: string) => Promise<void>;
  questsCheckHabit: (habitId: string) => Promise<{ checked: boolean }>;
  questsGetDrawings: (taskId: string) => Promise<unknown[]>;
  questsGetDrawingCount: (taskId: string) => Promise<number>;
  questsGetAllDrawingCounts: () => Promise<Array<{ task_id: string; count: number }>>;
  questsSaveDrawing: (drawing: Record<string, unknown>) => Promise<string>;
  questsDeleteDrawing: (id: string) => Promise<void>;
  questsGetProjects: () => Promise<unknown[]>;
  questsUpsertProject: (project: Record<string, unknown>) => Promise<string>;
  questsDeleteProject: (id: string) => Promise<void>;
  questsSyncProjectOrders: (orders: Array<{ id: string; order: number }>) => Promise<void>;
  questsCountCompletedToday: () => Promise<number>;
  questsGetPendingCount: () => Promise<number>;
  questsGetCompletedTodayCount: () => Promise<number>;

  // Nutrition
  nutritionGetProfile: () => Promise<unknown>;
  nutritionSaveProfile: (profile: Record<string, unknown>) => Promise<void>;
  nutritionLogFood: (entry: Record<string, unknown>) => Promise<void>;
  nutritionGetFoodByDate: (date: string) => Promise<unknown[]>;
  nutritionDeleteFood: (id: number) => Promise<void>;
  nutritionUpdateFood: (id: number, fields: Record<string, unknown>) => Promise<void>;
  nutritionGetFrequentFoods: () => Promise<unknown[]>;
  nutritionCreateFrequentFood: (food: Record<string, unknown>) => Promise<void>;
  nutritionDeleteFrequentFood: (id: number) => Promise<void>;
  nutritionIncrementFrequentUsage: (id: number) => Promise<void>;
  nutritionGetDailyMetrics: (date: string) => Promise<unknown>;
  nutritionSaveDailyMetrics: (metrics: Record<string, unknown>) => Promise<void>;
  nutritionGetWeeklyMetrics: (date: string) => Promise<unknown>;
  nutritionSaveWeeklyMetrics: (metrics: Record<string, unknown>) => Promise<void>;
  nutritionGetSummary: (date: string) => Promise<unknown>;
  nutritionGetSummaryRange: (start: string, end: string) => Promise<unknown[]>;
  nutritionGetWeights: () => Promise<unknown[]>;
  nutritionGetStreak: () => Promise<number>;
  nutritionGetTodayCalories: () => Promise<number>;
  nutritionGetTodayTarget: () => Promise<number | null>;
  nutritionEstimate: (description: string) => Promise<EstimationResult>;
  nutritionGetAiStatus: () => Promise<OllamaStatus>;
  nutritionIsOllamaAvailable: () => Promise<boolean>;

  nutritionLearnFood: (entry: Record<string, unknown>) => Promise<void>;
  nutritionCloseDay: (date: string) => Promise<{ success: boolean; alreadyClosed?: boolean; error?: string; breakdown?: unknown }>;
  nutritionIsDayClosed: (date: string) => Promise<unknown>;
  nutritionShouldAskWeight: () => Promise<{ shouldAsk: boolean; lastWeight?: number }>;
  onEstimateProgress: (callback: (stage: string) => void) => () => void;

  // Sync
  syncRestoreStats: (stats: Record<string, unknown>) => Promise<{ success: boolean }>;
  syncGetAllQuestData: () => Promise<Record<string, unknown[]>>;
  syncMergeQuestData: (data: Record<string, unknown>) => Promise<{ changed: boolean }>;

  // Backup
  backupExport: () => Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }>;
  backupImport: () => Promise<{ success: boolean; canceled?: boolean; error?: string }>;

  // Character
  characterSave: (data: Record<string, unknown>) => Promise<void>;
  characterLoad: () => Promise<unknown>;

  // Notifications
  notificationsSetReminders: (enabled: boolean) => Promise<{ success: boolean }>;
  notificationsSend: (title: string, body: string) => Promise<boolean>;

  // Dollar
  dollarGetRates: () => Promise<{ success: boolean; rates?: unknown[]; cached?: boolean; cachedAt?: string; error?: string }>;

  // Finance
  financeGetTransactions: (month: string) => Promise<unknown[]>;
  financeAddTransaction: (tx: Record<string, unknown>) => Promise<string>;
  financeDeleteTransaction: (id: string) => Promise<void>;
  financeGetLoans: () => Promise<unknown[]>;
  financeAddLoan: (loan: Record<string, unknown>) => Promise<string>;
  financeSettleLoan: (id: string) => Promise<void>;
  financeGetIncomeSources: () => Promise<unknown[]>;
  financeAddIncomeSource: (src: Record<string, unknown>) => Promise<string>;
  financeToggleIncomeSource: (id: string) => Promise<void>;
  financeGetCategories: () => Promise<string[]>;
  financeGetMonthlyTotal: () => Promise<number>;
  financeGetActiveLoansCount: () => Promise<number>;
  financeGetMonthlyBalance: (month?: string) => Promise<{ expenses: number; income: number; balance: number }>;
  financeGetCategoryBreakdown: (month?: string) => Promise<Array<{ category: string; total: number }>>;
  financeUpdateTransaction: (id: string, fields: Record<string, unknown>) => Promise<void>;

  // Updater
  updaterCheck: () => Promise<{ available: boolean; version?: string }>;
  updaterDownload: () => Promise<void>;
  updaterInstall: () => void;
  onUpdateAvailable: (callback: (info: { version: string }) => void) => () => void;
  onUpdateDownloaded: (callback: () => void) => () => void;
  onDownloadProgress: (callback: (info: { percent: number }) => void) => () => void;
}

// ── Nutrition AI Types ──────────────────────────────────────

export interface FoodDbEntry {
  id: number;
  name: string;
  keywords: string;
  calories: number;
  serving_size: string;
  category: string;
}

export interface EstimationMatch {
  name: string;
  calories: number;
  source: 'ai';
}

export interface EstimationResult {
  totalCalories: number;
  matches: EstimationMatch[];
  breakdown: string;
  ollamaMissing: boolean;
  aiError?: string;
}

export type OllamaStatus = 'stopped' | 'starting' | 'running' | 'error';

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

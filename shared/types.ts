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

// ── Notification Types ────────────────────────────────────

export interface AppNotification {
  id: string;
  type: string;
  module: string;
  title: string;
  body: string;
  actionRoute: string;
  status: 'active' | 'snoozed' | 'resolved' | 'dismissed';
  snoozedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  deletedAt: string | null;
  refId: string | null;
}

// ── Finance Import Types ────────────────────────────────────

export interface ParsedRow {
  date: string;
  merchant: string;
  installmentCurrent?: number;
  installmentTotal?: number;
  amountARS?: number;
  amountUSD?: number;
  isExcluded: boolean;
  suggestedCategory: string;
}

// ── Cauldron Types ────────────────────────────────────────

export type CauldronTimerStatus = 'idle' | 'work' | 'work_paused' | 'on_break' | 'break_paused' | 'awaiting_next';

export interface CauldronTimerState {
  status: CauldronTimerStatus;
  remainingMs: number;
  totalMs: number;
  currentCycle: number;
  totalCycles: number;
  sessionType: 'work' | 'break' | 'long_break';
  presetId: string | null;
  presetName: string | null;
  extensionMinutes: number;
}

export interface CauldronPreset {
  id: string;
  name: string;
  workMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  cyclesBeforeLong: number;
  extensionMinutes: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CauldronSession {
  id: string;
  presetId: string | null;
  type: 'work' | 'break' | 'long_break';
  durationMinutes: number;
  completed: boolean;
  startedAt: string;
  completedAt: string | null;
}

export interface CauldronStats {
  today: number;
  week: number;
  total: number;
  streak: number;
}

export interface CauldronSessionEndResult {
  sessionType: 'work' | 'break' | 'long_break';
  completed: boolean;
  nextType: 'work' | 'break' | 'long_break' | null;
}

export interface CauldronSessionsPage {
  sessions: CauldronSession[];
  hasMore: boolean;
}

export interface CauldronWeeklyFocusDay {
  label: string;
  value: number;
}

// ── API Types ──────────────────────────────────────────────

export interface HubtifyApi {
  getRpgStats: () => Promise<PlayerStats>;
  processRpgEvent: (event: RpgEvent) => Promise<{ xpGained: number; hpChange: number; leveledUp: boolean; newTitle: string | null; milestoneXp?: number; comboMultiplier: number; bonusMultiplier: number }>;
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
  questsGetHabitHeatmap: (days?: number) => Promise<{ days: Array<{ date: string; count: number }>; totalHabits: number }>;
  questsGetHabits: () => Promise<unknown[]>;
  questsAddHabit: (habit: { name: string; frequency: string; timesPerWeek: number }) => Promise<string>;
  questsUpdateHabit: (id: string, updates: { name?: string; frequency?: string; timesPerWeek?: number }) => Promise<void>;
  questsDeleteHabit: (id: string) => Promise<void>;
  questsCheckHabit: (habitId: string) => Promise<{ checked: boolean }>;
  questsCheckHabitForDate: (habitId: string, date: string) => Promise<{ checked: boolean }>;
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
  questsGetOverdueCount: () => Promise<number>;

  // Nutrition
  nutritionGetProfile: () => Promise<unknown>;
  nutritionSaveProfile: (profile: Record<string, unknown>) => Promise<void>;
  nutritionLogFood: (entry: Record<string, unknown>) => Promise<void>;
  nutritionGetFoodByDate: (date: string) => Promise<unknown[]>;
  nutritionDeleteFood: (id: number) => Promise<void>;
  nutritionDeleteByDate: (date: string) => Promise<void>;
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
  nutritionGetWeekCalories: () => Promise<number[]>;
  nutritionGetTodayCalories: () => Promise<number>;
  nutritionGetTodayMealsCount: () => Promise<number>;
  nutritionGetTodayTarget: () => Promise<number | null>;
  nutritionCloseDay: (date: string) => Promise<{ success: boolean; alreadyClosed?: boolean; error?: string; breakdown?: unknown }>;
  nutritionIsDayClosed: (date: string) => Promise<unknown>;
  nutritionShouldAskWeight: () => Promise<{ shouldAsk: boolean; lastWeight?: number }>;
  nutritionGetFavoriteFoods: () => Promise<FavoriteFood[]>;
  nutritionAddFavoriteFood: (food: Record<string, unknown>) => Promise<{ id: string }>;
  nutritionRemoveFavoriteFood: (id: string) => Promise<void>;
  nutritionGetPendingDays: () => Promise<string[]>;
  nutritionGetMealSchedule: () => Promise<import('./meal-utils').MealSchedule>;

  // Sync
  syncRestoreStats: (stats: Record<string, unknown>) => Promise<{ success: boolean }>;
  syncGetAllQuestData: () => Promise<Record<string, unknown[]>>;
  syncMergeQuestData: (data: Record<string, unknown>) => Promise<{ changed: boolean }>;
  syncGetAllNutritionData: () => Promise<Record<string, unknown>>;
  syncMergeNutritionData: (data: Record<string, unknown>) => Promise<{ changed: boolean }>;
  syncGetAllFinanceData: () => Promise<Record<string, unknown[]>>;
  syncMergeFinanceData: (data: Record<string, unknown[]>) => Promise<{ success: boolean; changed: boolean }>;
  syncClearUserData: () => Promise<{ success: boolean }>;
  syncSetCurrentUser: (uid: string) => Promise<void>;
  syncGetCurrentUser: () => Promise<string | null>;
  syncGetAllNotificationData: () => Promise<Record<string, unknown>[]>;
  syncMergeNotificationData: (data: Record<string, unknown>[]) => Promise<{ changed: boolean }>;
  syncGetAllCauldronData: () => Promise<Record<string, unknown>>;
  syncMergeCauldronData: (data: Record<string, unknown>) => Promise<{ changed: boolean }>;

  // Backup
  backupExport: () => Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }>;
  backupImport: () => Promise<{ success: boolean; canceled?: boolean; error?: string }>;

  // Character
  characterSave: (data: Record<string, unknown>) => Promise<void>;
  characterLoad: () => Promise<unknown>;
  characterGetName: () => Promise<string | null>;
  characterSetName: (name: string) => Promise<void>;
  characterGetUsername: () => Promise<string | null>;
  characterSetUsername: (username: string) => Promise<void>;

  // Notifications
  notificationsSend: (title: string, body: string) => Promise<boolean>;
  notificationsGetAll: () => Promise<AppNotification[]>;
  notificationsDismiss: (id: string) => Promise<void>;
  notificationsSnooze: (id: string) => Promise<void>;
  notificationsRunCheck: () => Promise<number>;
  notificationsGetCount: () => Promise<number>;
  notificationsSetSystemEnabled: (enabled: boolean) => Promise<void>;
  notificationsSetLocale: (locale: string) => Promise<void>;
  notificationsSetModuleEnabled: (module: string, enabled: boolean) => Promise<void>;
  onNotificationsUpdated: (callback: () => void) => () => void;

  // Dollar
  dollarGetRates: () => Promise<{ success: boolean; rates: unknown[]; cached?: boolean; cachedAt?: string; error?: string }>;
  dollarGetVisibleTypes: () => Promise<string[]>;
  dollarSetVisibleTypes: (types: string[]) => Promise<void>;

  // Crypto
  cryptoGetRates: () => Promise<{ success: boolean; rates: unknown[]; cached?: boolean; cachedAt?: string; error?: string }>;
  cryptoGetVisibleTypes: () => Promise<string[]>;
  cryptoSetVisibleTypes: (types: string[]) => Promise<void>;

  // Finance - Transactions
  financeGetTransactions: (filters: Record<string, unknown>) => Promise<unknown[]>;
  financeAddTransaction: (tx: Record<string, unknown>) => Promise<string>;
  financeUpdateTransaction: (id: string, fields: Record<string, unknown>) => Promise<void>;
  financeDeleteTransaction: (id: string) => Promise<void>;

  // Finance - Installments
  financeGetInstallmentGroups: () => Promise<unknown[]>;
  financeGetInstallmentsForMonth: (month: string) => Promise<unknown[]>;
  financeGetInstallmentProjection: (months: number) => Promise<Array<{ month: string; total: number }>>;
  financeCreateInstallmentGroup: (group: Record<string, unknown>) => Promise<string>;
  financeDeleteInstallmentGroup: (id: string) => Promise<void>;
  financeUpdateInstallmentAmount: (txId: string, newAmount: number) => Promise<void>;

  // Finance - Loans
  financeGetLoans: (filter?: Record<string, unknown>) => Promise<unknown[]>;
  financeGetLoansByPerson: (name: string) => Promise<unknown[]>;
  financeAddLoan: (loan: Record<string, unknown>) => Promise<string>;
  financeSettleLoan: (id: string) => Promise<void>;
  financeAddLoanPayment: (loanId: string, payment: Record<string, unknown>) => Promise<string>;
  financeGetLoanPayments: (loanId: string) => Promise<unknown[]>;
  financeCreateThirdPartyPurchase: (data: Record<string, unknown>) => Promise<string>;
  financeGetActiveLoanSummary: () => Promise<unknown>;

  // Finance - Recurring
  financeGetRecurring: () => Promise<unknown[]>;
  financeAddRecurring: (rec: Record<string, unknown>) => Promise<string>;
  financeUpdateRecurringAmount: (id: string, newAmount: number) => Promise<void>;
  financeUpdateRecurring: (id: string, fields: Record<string, unknown>) => Promise<void>;
  financeToggleRecurring: (id: string) => Promise<void>;
  financeDeleteRecurring: (id: string) => Promise<void>;
  financeGenerateRecurringForMonth: (month: string) => Promise<void>;
  financeGetRecurringAmountHistory: (id: string) => Promise<unknown[]>;

  // Finance - Import
  financeImportSelectAndParsePDF: () => Promise<{ rows: ParsedRow[]; fileName: string; skippedLines: string[] } | null>;
  financeImportConfirm: (rows: unknown[], statementMonth: string, fileName: string) => Promise<{ batchId: string; count: number; duplicateCount: number }>;
  financeGetCategoryMappings: () => Promise<unknown[]>;
  financeUpdateCategoryMapping: (pattern: string, category: string) => Promise<void>;

  // Finance - Dashboard
  financeGetMonthlyBalance: (month?: string) => Promise<unknown>;
  financeGetCategoryBreakdown: (month?: string) => Promise<unknown[]>;
  financeGetBalanceForRange: (startMonth: string, endMonth: string) => Promise<{ ARS: { income: number; expenses: number; balance: number }; USD: { income: number; expenses: number; balance: number } }>;
  financeGetCategoryBreakdownForRange: (startMonth: string, endMonth: string) => Promise<Array<{ category: string; ARS: number; USD: number }>>;
  financeGetProjection: (months: number) => Promise<unknown[]>;

  // Finance - Export
  financeExportCsv: (month?: string) => Promise<{ success: boolean; canceled?: boolean; path?: string; count?: number; error?: string }>;

  // Finance - Dashboard (new)
  financeGetMonthlyExpenses: () => Promise<number[]>;
  financeGetCategoryAverages: () => Promise<Record<string, number>>;
  financeGetPreviousMonthSummary: () => Promise<{ income: number; expenses: number; month: string }>;

  // Finance - Backward compat
  financeGetCategories: () => Promise<string[]>;
  financeAddCategory: (name: string) => Promise<void>;
  financeDeleteCategory: (name: string) => Promise<void>;
  financeGetMonthlyTotal: () => Promise<number>;
  financeGetActiveLoansCount: () => Promise<number>;
  financeGetTodayTransactionsCount: () => Promise<number>;

  // Finance - Credit Cards
  financeGetCreditCards: () => Promise<unknown[]>;
  financeAddCreditCard: (card: Record<string, unknown>) => Promise<string>;
  financeUpdateCreditCard: (id: string, fields: Record<string, unknown>) => Promise<void>;
  financeDeleteCreditCard: (id: string) => Promise<void>;
  financeGetCreditCardStatements: (filters?: Record<string, unknown>) => Promise<unknown[]>;
  financeGetStatementDetail: (id: string) => Promise<unknown>;
  financeGenerateStatement: (cardId: string, periodMonth: string) => Promise<string | null>;
  financePayStatement: (id: string, paidAmount: number) => Promise<void>;

  // Cauldron
  cauldronGetPresets: () => Promise<CauldronPreset[]>;
  cauldronUpsertPreset: (preset: Record<string, unknown>) => Promise<string>;
  cauldronDeletePreset: (id: string) => Promise<void>;
  cauldronStart: (presetId: string) => Promise<CauldronTimerState>;
  cauldronPause: () => Promise<CauldronTimerState>;
  cauldronResume: () => Promise<CauldronTimerState>;
  cauldronSkip: () => Promise<CauldronTimerState>;
  cauldronConfirmNext: () => Promise<CauldronTimerState>;
  cauldronExtend: (minutes?: number) => Promise<CauldronTimerState>;
  cauldronStop: () => Promise<void>;
  cauldronGetState: () => Promise<CauldronTimerState>;
  cauldronGetStats: () => Promise<CauldronStats>;
  cauldronGetSessions: (offset?: number, limit?: number) => Promise<CauldronSessionsPage>;
  cauldronGetWeeklyFocusTime: () => Promise<CauldronWeeklyFocusDay[]>;
  onCauldronTick: (callback: (state: CauldronTimerState) => void) => () => void;
  onCauldronSessionEnd: (callback: (result: CauldronSessionEndResult) => void) => () => void;
  cauldronOpenWindow: () => Promise<void>;
  cauldronCloseWindow: () => Promise<void>;
  onCauldronWindowOpened: (callback: () => void) => () => void;
  onCauldronWindowClosed: (callback: () => void) => () => void;

  // Feedback
  feedbackSend: (data: { type: string; description: string; email?: string }) => Promise<{ success: boolean }>;

  // Updater
  updaterCheck: () => Promise<{ available: boolean; version?: string }>;
  updaterDownload: () => Promise<string>;
  onUpdateAvailable: (callback: (info: { version: string }) => void) => () => void;
  onUpdateDownloaded: (callback: () => void) => () => void;
  onDownloadProgress: (callback: (info: { percent: number }) => void) => () => void;
  onUpdateError: (callback: (info: { message: string }) => void) => () => void;
}

// ── Nutrition Types ─────────────────────────────────────────

export interface FavoriteFood {
  id: string;
  description: string;
  calories: number;
  source: string;
  aiBreakdown?: string;
  createdAt: string;
  updatedAt?: string;
}

// ── Nutrition AI Types ──────────────────────────────────────

interface EstimationItem {
  name: string;
  calories: number;
}

export interface EstimationResult {
  totalCalories: number;
  items: EstimationItem[];
  aiError?: string;
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

/** [level_threshold, i18n_key, fallback_name] — sorted descending by level */
export const TITLE_THRESHOLDS: [number, string, string][] = [
  [50, 'rpg.titles.legend', 'Leyenda'],
  [40, 'rpg.titles.hero', 'Hero'],
  [30, 'rpg.titles.champion', 'Champion'],
  [20, 'rpg.titles.knight', 'Caballero'],
  [10, 'rpg.titles.warrior', 'Guerrero'],
  [5, 'rpg.titles.squire', 'Escudero'],
  [1, 'rpg.titles.peasant', 'Campesino'],
];

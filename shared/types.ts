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
  /** Dia local al que pertenece `hp`. El Vigor se resetea a 100 cada manana. */
  hpDate: string | null;
  /** Mes (YYYY-MM) de la cuota de indultos vigente. */
  pardonsMonth: string | null;
  pardonsUsed: number;
  /** Derivado, ya mes-rolado: cuantos indultos quedan este mes. */
  pardonsRemaining: number;
  /** Record de racha. Nunca se resetea. */
  bestStreak: number;
  /** Fecha local de check-in en la Posada, o null si esta apagada. */
  innSince: string | null;
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

// ── Códice & Achievements (Fase 2) ────────────────────────

export interface AchievementState { id: string; hidden: boolean; unlocked: boolean; unlockedAt?: string }

export interface DaySummaryEvent {
  id: number; moduleId: string; eventType: string;
  xpGained: number; hpChange: number; comboMultiplier: number; bonusMultiplier: number;
  payload: string | null; createdAt: string; time: string;
}
export interface DaySummaryModule { moduleId: string; count: number; xp: number; events: DaySummaryEvent[] }
export interface DaySeal {
  date: string; sealedAt: string; xpAwarded: number; vigor: number;
  eventsCount: number; modules: string[];
}
export type SealBlockedReason = 'already_sealed' | 'too_old' | 'future' | 'empty_day';
export interface DaySummary {
  date: string; isToday: boolean;
  events: DaySummaryEvent[];
  byModule: DaySummaryModule[];
  eventsCount: number; totalXp: number; maxCombo: number; modules: string[];
  vigor: number; streak: number;
  sealed: boolean; seal: DaySeal | null;
  canSeal: boolean; sealBlockedReason: SealBlockedReason | null;
}
export type SealResult =
  | { ok: true; date: string; xpAwarded: number; vigor: number; eventsCount: number;
      modules: string[]; achievementIds: string[] }
  | { ok: false; reason: SealBlockedReason };

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
  /** Linea de impuestos/cargos del resumen (sellos, IVA, percepciones). */
  isTax?: boolean;
}

/** One confirmed PDF/CSV import, so the user can review and undo it. */
export interface FinanceImportBatch {
  id: string;
  source: string;
  filename: string;
  rowCount: number;
  createdAt: string;
  /** Rows from this batch that are still live (not soft-deleted). */
  liveCount: number;
}

/**
 * Named answer to "how much did I spend?", so the UI never has to guess which
 * of the three historical definitions a number came from.
 * Mirrors `ExpenseBreakdown` in `electron/modules/finance.balance.ts`.
 */
export interface ExpenseBreakdown {
  /** Every live expense in the range except the card-statement payment. */
  total: number;
  /** Cash/debit/transfer: hits the balance now, not part of an instalment plan. */
  direct: number;
  /** Instalment plan rows that hit the balance in this range. */
  installments: number;
  /** Card purchases still waiting for their statement (`impacts_balance = 0`). */
  pendingCard: number;
  /** Auto-generated "Pago Tarjeta" transactions (excluded from `total`). */
  cardPayments: number;
}

export type ExpenseBreakdownByCurrency = Record<'ARS' | 'USD', ExpenseBreakdown>;

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
  /** Epoch ms en que el siguiente segmento arranca solo (gracia de 5 s), o null. */
  autoStartAt: number | null;
  /** Vuelta del bucle continuo (1 = primera ronda de ciclos). */
  round: number;
  /** Misión de Questify vinculada a la sesión en curso, o null. */
  taskId: string | null;
  taskName: string | null;
  taskProjectId: string | null;
  taskProjectColor: string | null;
}

export interface CauldronPreset {
  id: string;
  name: string;
  workMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  cyclesBeforeLong: number;
  extensionMinutes: number;
  autoStartBreak: boolean;
  autoStartWork: boolean;
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
  abandoned?: boolean;
  elapsedMinutes?: number | null;
  taskId?: string | null;
  taskName?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  projectColor?: string | null;
}

export interface CauldronWeekTaskRow {
  taskId: string | null;
  taskName: string | null;
  projectId: string | null;
  projectColor: string | null;
  minutes: number;
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
  /**
   * True when the segment that just ended was an `cauldron:extend` extension of an
   * already-rewarded cycle. The renderer MUST NOT award pomodoro XP for these —
   * they are excluded from every backend statistic for the same reason.
   */
  isExtension?: boolean;
  /** True en el segmento que cierra una vuelta completa de ciclos. */
  cycleComplete?: boolean;
  /** El work fue abandonado con >5 min: deja frasco roto, jamás castigo numérico. */
  abandoned?: boolean;
  elapsedMinutes?: number;
  taskId?: string | null;
  taskName?: string | null;
}

/** A session that was running when the app closed and can be resumed. */
export interface CauldronInterruptedSession {
  id: string;
  presetId: string | null;
  presetName: string | null;
  type: string;
  durationMinutes: number;
  startedAt: string;
  remainingMs: number;
  totalMs: number;
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

// ── Syl read-projection snapshot (docs/syl-integration-contract.md) ─────────

export interface SylSnapshotHabit {
  id: string;
  name: string;
  frequency: string;          // 'daily' | 'weekly' | 'monthly'
  timesPerWeek: number;
  checkedToday: boolean;
  checksThisPeriod: number;
  targetThisPeriod: number;
  streak: number;
  pendingToday: boolean;      // checksThisPeriod < targetThisPeriod
}

export interface SylSnapshotSubtask {
  id: string;
  name: string;
  tier: number;
  status: boolean;
}

export interface SylSnapshotTask {
  id: string;
  name: string;
  tier: number;
  category: string;
  projectId: string | null;
  dueDate: string | null;
  createdAt: string;
  subtaskProgress: { done: number; total: number };
  subtasks: SylSnapshotSubtask[];
}

export interface SylSnapshotOverdueQuest {
  id: string;
  name: string;
  tier: number;
  dueDate: string;
  daysOverdue: number;
}

export interface SylSnapshot {
  schemaVersion: 1;
  computedAt: string;         // ISO-8601 UTC
  computedForDate: string;    // YYYY-MM-DD (local day used for "today")
  appVersion: string;

  player: {
    level: number;
    xp: number;
    xpToNextLevel: number;
    hp: number;
    maxHp: number;
    title: string;
    streak: number;
    totalTasks: number;
    totalMeals: number;
    totalExpenses: number;
  };

  questify: {
    habits: SylSnapshotHabit[];
    habitsPendingToday: Array<{ id: string; name: string; frequency: string; remaining: number }>;
    tasksActive: SylSnapshotTask[];
    questsOverdue: SylSnapshotOverdueQuest[];
    counts: {
      habitsTotal: number;
      habitsPending: number;
      tasksActive: number;
      tasksOverdue: number;
    };
  };

  nutrify: {
    todayCalories: number;
    todayTarget: number | null;   // tdee - deficitTargetKcal
    todayBalance: number | null;  // negative = deficit
    recentFoodLog: Array<{ date: string; time: string; description: string; calories: number; meal: string | null }>;
    profileSummary: { sex: string; activityLevel: string; deficitTargetKcal: number } | null;
  };

  coinify: {
    todaySpend: { ARS: number; USD: number };
    monthSpend: { ARS: number; USD: number };
    monthBalance: { ARS: number; USD: number };  // income - expense for the current month (matches finance:getMonthlyBalance)
    recentTransactions: Array<{
      id: string; type: string; amount: number; currency: string;
      category: string; description: string; date: string;
    }>;
  };
}

export interface HubtifyApi {
  getRpgStats: () => Promise<PlayerStats>;
  rpgSetInnMode: (on: boolean) => Promise<{ innSince: string | null }>;
  onRpgPardonUsed: (callback: () => void) => () => void;
  rpgGetAchievements: () => Promise<AchievementState[]>;
  rpgBackfillAchievements: () => Promise<{ unlocked: string[]; total: number }>;
  rpgGetDaySummary: (date?: string | null) => Promise<DaySummary>;
  rpgSealDay: (date?: string | null) => Promise<SealResult>;
  rpgGetSeals: (fromDate: string, toDate: string) => Promise<DaySeal[]>;
  onRpgAchievementUnlocked: (callback: (id: string) => void) => () => void;
  onRpgDaySealed: (callback: (info: { date: string; xpAwarded: number }) => void) => () => void;
  processRpgEvent: (event: RpgEvent) => Promise<{ xpGained: number; hpChange: number; leveledUp: boolean; newTitle: string | null; milestoneXp?: number; comboMultiplier: number; bonusMultiplier: number; pardonUsed?: boolean; achievementIds?: string[] }>;
  getRpgHistory: (limit: number) => Promise<RpgEventRecord[]>;
  rpgGetDashboardStats: () => Promise<{ xpToday: number; xpHistory: Array<{ date: string; xp: number }>; eventsToday: number }>;
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
  questsGetHabitHeatmap: (days?: number) => Promise<{ days: Array<{ date: string; count: number; skipCount: number }>; totalHabits: number }>;
  questsGetHabits: () => Promise<unknown[]>;
  questsAddHabit: (habit: { name: string; frequency: string; timesPerWeek: number; specificDays?: number[] | null }) => Promise<string>;
  questsUpdateHabit: (id: string, updates: { name?: string; frequency?: string; timesPerWeek?: number; specificDays?: number[] | null }) => Promise<void>;
  questsPostponeTasks: (ids: string[], target: string) => Promise<{ moved: number }>;
  questsSkipHabit: (habitId: string, date?: string) => Promise<{ skipped: boolean }>;
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
  nutritionSearchHistory: (query?: string, limit?: number) => Promise<Array<{
    description: string; calories: number; timesLogged: number;
    lastLogged: string | null; source: 'history' | 'favorite'; proteinG?: number;
  }>>;
  nutritionGetCachedEstimate: (description: string) => Promise<{
    calories: number; aiBreakdown: string | null; proteinG: number | null; hits: number;
  } | null>;
  nutritionCacheEstimate: (entry: Record<string, unknown>) => Promise<{ cached: boolean }>;
  nutritionCopyDay: (opts?: { from?: string; to?: string }) => Promise<{ success: boolean; reason?: string; copied: number; from?: string; to?: string }>;
  nutritionDeleteFood: (id: number) => Promise<void>;
  nutritionDeleteByDate: (date: string) => Promise<void>;
  nutritionUpdateFood: (id: number, fields: Record<string, unknown>) => Promise<void>;
  nutritionGetFrequentFoods: () => Promise<unknown[]>;
  nutritionCreateFrequentFood: (food: Record<string, unknown>) => Promise<{ id: number; created: boolean }>;
  nutritionDeleteFrequentFood: (id: number) => Promise<void>;
  nutritionIncrementFrequentUsage: (id: number) => Promise<void>;
  nutritionGetDailyMetrics: (date: string) => Promise<unknown>;
  nutritionSaveDailyMetrics: (metrics: Record<string, unknown>) => Promise<void>;
  nutritionGetWeeklyMetrics: (date: string) => Promise<unknown>;
  nutritionSaveWeeklyMetrics: (metrics: Record<string, unknown>) => Promise<void>;
  nutritionGetSummary: (date: string) => Promise<unknown>;
  nutritionGetSummaryRange: (start: string, end: string) => Promise<unknown[]>;
  nutritionGetWeights: () => Promise<unknown[]>;
  nutritionGetStreak: () => Promise<{ streak: number; todayPending: boolean; graceUsedOn?: string }>;
  nutritionGetWeekCalories: () => Promise<number[]>;
  nutritionGetTodayCalories: () => Promise<number>;
  nutritionGetTodayMealsCount: () => Promise<number>;
  nutritionGetTodayTarget: () => Promise<number | null>;
  nutritionCloseDay: (date: string) => Promise<{ success: boolean; alreadyClosed?: boolean; error?: string; breakdown?: unknown }>;
  nutritionIsDayClosed: (date: string) => Promise<unknown>;
  nutritionReopenDay: (date: string) => Promise<{ success: boolean; error?: string; xpReverted?: number; hpReverted?: number; eventFound?: boolean }>;
  nutritionShouldAskWeight: () => Promise<{ shouldAsk: boolean; lastWeight?: number }>;
  nutritionGetFavoriteFoods: () => Promise<FavoriteFood[]>;
  nutritionAddFavoriteFood: (food: Record<string, unknown>) => Promise<{ id: string; created: boolean }>;
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
  backupPickImportFile: () => Promise<{ canceled: boolean; path?: string; name?: string }>;
  backupImport: (filePath?: string) => Promise<{ success: boolean; canceled?: boolean; error?: string }>;

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
  notificationsSetHabitReminder: (enabled: boolean, time: string) => Promise<void>;
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
  financeGetInstallmentGroups: (month?: string) => Promise<unknown[]>;
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
  financeAddLoanPayment: (loanId: string, payment: Record<string, unknown>) => Promise<string | { ok: false; reason: string }>;
  financeGetLoanPayments: (loanId: string) => Promise<unknown[]>;
  financeDeleteLoanPayment: (id: string) => Promise<void>;
  financeCreateThirdPartyPurchase: (data: Record<string, unknown>) => Promise<string>;
  financeGetActiveLoanSummary: (asOfMonth?: string) => Promise<unknown>;

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
  financeImportConfirm: (rows: unknown[], statementMonth: string, fileName: string, creditCardId?: string | null) => Promise<{ batchId: string; count: number; duplicateCount: number; creditCardId?: string | null } | { ok: false; reason: string }>;
  financeUndoImportBatch: (batchId: string) => Promise<{ ok: boolean; reason?: string; deleted?: number }>;
  financeGetImportBatches: () => Promise<FinanceImportBatch[]>;
  financeGetBudgets: () => Promise<Array<{ category: string; monthlyLimit: number; createdAt: string; updatedAt: string }>>;
  financeSetBudget: (category: string, limit: number | null) => Promise<{ ok: true; category: string; monthlyLimit: number | null } | { ok: false; reason: string }>;
  financeGetBudgetStatus: (month?: string) => Promise<{
    month: string;
    categories: Array<{ category: string; limit: number; spent: number; pct: number }>;
    totalLimit: number; totalSpent: number;
  }>;
  financeGetCategoryMappings: () => Promise<unknown[]>;
  financeUpdateCategoryMapping: (pattern: string, category: string) => Promise<void>;

  // Finance - Dashboard
  financeGetMonthlyBalance: (month?: string) => Promise<unknown>;
  financeGetCategoryBreakdown: (month?: string) => Promise<unknown[]>;
  financeGetBalanceForRange: (startMonth: string, endMonth: string) => Promise<{ ARS: { income: number; expenses: number; balance: number }; USD: { income: number; expenses: number; balance: number } }>;
  financeGetCategoryBreakdownForRange: (startMonth: string, endMonth: string) => Promise<Array<{ category: string; ARS: number; USD: number }>>;
  financeGetProjection: (months: number, fromMonth?: string) => Promise<unknown[]>;

  // Finance - Export
  financeExportCsv: (month?: string) => Promise<{ success: boolean; canceled?: boolean; path?: string; count?: number; error?: string }>;

  // Finance - Dashboard (new)
  financeGetMonthlyExpenses: (endMonth?: string) => Promise<number[]>;
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
  financePayStatement: (id: string, paidAmount: number, paidAmountUsd?: number) => Promise<void>;
  financeGetExpenseBreakdown: (month?: string) => Promise<ExpenseBreakdownByCurrency>;
  financeGetExpenseBreakdownForRange: (startMonth: string, endMonth: string) => Promise<ExpenseBreakdownByCurrency | null>;

  // Cauldron
  cauldronGetPresets: () => Promise<CauldronPreset[]>;
  cauldronUpsertPreset: (preset: Record<string, unknown>) => Promise<string>;
  cauldronDeletePreset: (id: string) => Promise<void>;
  cauldronStart: (presetId: string, taskId?: string | null) => Promise<CauldronTimerState>;
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
  /** The session that was running when the app last closed, or null. */
  cauldronGetInterruptedSession: () => Promise<CauldronInterruptedSession | null>;
  cauldronResumeInterruptedSession: () => Promise<{ success: boolean; reason?: string; state?: CauldronTimerState }>;
  cauldronDiscardInterruptedSession: () => Promise<{ success: boolean }>;
  cauldronCancelAutoStart: () => Promise<CauldronTimerState>;
  cauldronSetSessionTask: (taskId: string | null) => Promise<CauldronTimerState>;
  cauldronGetWeekByProject: () => Promise<CauldronWeekTaskRow[]>;
  /** Pushes already-translated OS-notification texts to the main process. */
  cauldronSetLabels: (labels: Record<string, string>) => Promise<void>;
  onCauldronTick: (callback: (state: CauldronTimerState) => void) => () => void;
  onCauldronSessionEnd: (callback: (result: CauldronSessionEndResult) => void) => () => void;
  cauldronOpenWindow: () => Promise<void>;
  cauldronCloseWindow: () => Promise<void>;
  onCauldronWindowOpened: (callback: () => void) => () => void;
  onCauldronWindowClosed: (callback: () => void) => () => void;

  // Feedback
  feedbackSend: (data: { type: string; description: string; email?: string }) => Promise<{ success: boolean }>;

  // Syl (read-projection snapshot)
  sylBuildSnapshot: () => Promise<SylSnapshot>;

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

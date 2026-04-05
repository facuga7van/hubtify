import { contextBridge, ipcRenderer } from 'electron';
import type { RpgEvent, Migration } from '../shared/types';

const api = {
  getRpgStats: () => ipcRenderer.invoke('rpg:getStats'),
  processRpgEvent: (event: RpgEvent) => ipcRenderer.invoke('rpg:processEvent', event),
  getRpgHistory: (limit: number) => ipcRenderer.invoke('rpg:getHistory', limit),
  rpgGetDashboardStats: () => ipcRenderer.invoke('rpg:getDashboardStats'),
  runMigrations: (migrations: Migration[]) => ipcRenderer.invoke('db:runMigrations', migrations),
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximize: () => ipcRenderer.send('window:maximize'),
  windowClose: () => ipcRenderer.send('window:close'),

  // Quests
  questsGetTasks: (projectId?: string | null) => ipcRenderer.invoke('quests:getTasks', projectId),
  questsUpsertTask: (task: Record<string, unknown>) => ipcRenderer.invoke('quests:upsertTask', task),
  questsDeleteTasks: (ids: string[]) => ipcRenderer.invoke('quests:deleteTasks', ids),
  questsSetTaskStatus: (taskId: string, status: boolean) => ipcRenderer.invoke('quests:setTaskStatus', taskId, status),
  questsSyncTaskOrders: (orders: Array<{ id: string; order: number }>) => ipcRenderer.invoke('quests:syncTaskOrders', orders),
  questsGetSubtasks: (taskId: string) => ipcRenderer.invoke('quests:getSubtasks', taskId),
  questsAddSubtask: (taskId: string, subtask: Record<string, unknown>) => ipcRenderer.invoke('quests:addSubtask', taskId, subtask),
  questsUpdateSubtask: (subtaskId: string, changes: Record<string, unknown>) => ipcRenderer.invoke('quests:updateSubtask', subtaskId, changes),
  questsDeleteSubtask: (subtaskId: string) => ipcRenderer.invoke('quests:deleteSubtask', subtaskId),
  questsSetSubtaskStatus: (subtaskId: string, status: boolean, completedAt?: string) => ipcRenderer.invoke('quests:setSubtaskStatus', subtaskId, status, completedAt),
  questsSyncSubtaskOrders: (taskId: string, orderedIds: string[]) => ipcRenderer.invoke('quests:syncSubtaskOrders', taskId, orderedIds),
  questsGetCategories: (projectId?: string | null) => ipcRenderer.invoke('quests:getCategories', projectId),
  questsEnsureCategory: (name: string, projectId?: string | null) => ipcRenderer.invoke('quests:ensureCategory', name, projectId),
  questsGetDrawings: (taskId: string) => ipcRenderer.invoke('quests:getDrawings', taskId),
  questsGetDrawingCount: (taskId: string) => ipcRenderer.invoke('quests:getDrawingCount', taskId),
  questsGetAllDrawingCounts: () => ipcRenderer.invoke('quests:getAllDrawingCounts'),
  questsSaveDrawing: (drawing: Record<string, unknown>) => ipcRenderer.invoke('quests:saveDrawing', drawing),
  questsDeleteDrawing: (id: string) => ipcRenderer.invoke('quests:deleteDrawing', id),
  questsGetHabits: () => ipcRenderer.invoke('quests:getHabits'),
  questsAddHabit: (habit: { name: string; frequency: string; timesPerWeek: number }) => ipcRenderer.invoke('quests:addHabit', habit),
  questsUpdateHabit: (id: string, updates: { name?: string; frequency?: string; timesPerWeek?: number }) => ipcRenderer.invoke('quests:updateHabit', id, updates),
  questsDeleteHabit: (id: string) => ipcRenderer.invoke('quests:deleteHabit', id),
  questsCheckHabit: (habitId: string) => ipcRenderer.invoke('quests:checkHabit', habitId),
  questsGetProjects: () => ipcRenderer.invoke('quests:getProjects'),
  questsUpsertProject: (project: Record<string, unknown>) => ipcRenderer.invoke('quests:upsertProject', project),
  questsDeleteProject: (id: string) => ipcRenderer.invoke('quests:deleteProject', id),
  questsSyncProjectOrders: (orders: Array<{ id: string; order: number }>) => ipcRenderer.invoke('quests:syncProjectOrders', orders),
  questsCountCompletedToday: () => ipcRenderer.invoke('quests:countCompletedToday'),
  questsGetPendingCount: () => ipcRenderer.invoke('quests:getPendingCount'),
  questsGetCompletedTodayCount: () => ipcRenderer.invoke('quests:getCompletedTodayCount'),

  // Nutrition
  nutritionGetProfile: () => ipcRenderer.invoke('nutrition:getProfile'),
  nutritionSaveProfile: (profile: Record<string, unknown>) => ipcRenderer.invoke('nutrition:saveProfile', profile),
  nutritionLogFood: (entry: Record<string, unknown>) => ipcRenderer.invoke('nutrition:logFood', entry),
  nutritionGetFoodByDate: (date: string) => ipcRenderer.invoke('nutrition:getFoodByDate', date),
  nutritionDeleteFood: (id: number) => ipcRenderer.invoke('nutrition:deleteFood', id),
  nutritionUpdateFood: (id: number, fields: Record<string, unknown>) => ipcRenderer.invoke('nutrition:updateFood', id, fields),
  nutritionGetFrequentFoods: () => ipcRenderer.invoke('nutrition:getFrequentFoods'),
  nutritionCreateFrequentFood: (food: Record<string, unknown>) => ipcRenderer.invoke('nutrition:createFrequentFood', food),
  nutritionDeleteFrequentFood: (id: number) => ipcRenderer.invoke('nutrition:deleteFrequentFood', id),
  nutritionIncrementFrequentUsage: (id: number) => ipcRenderer.invoke('nutrition:incrementFrequentUsage', id),
  nutritionGetDailyMetrics: (date: string) => ipcRenderer.invoke('nutrition:getDailyMetrics', date),
  nutritionSaveDailyMetrics: (metrics: Record<string, unknown>) => ipcRenderer.invoke('nutrition:saveDailyMetrics', metrics),
  nutritionGetWeeklyMetrics: (date: string) => ipcRenderer.invoke('nutrition:getWeeklyMetrics', date),
  nutritionSaveWeeklyMetrics: (metrics: Record<string, unknown>) => ipcRenderer.invoke('nutrition:saveWeeklyMetrics', metrics),
  nutritionGetSummary: (date: string) => ipcRenderer.invoke('nutrition:getSummary', date),
  nutritionGetSummaryRange: (start: string, end: string) => ipcRenderer.invoke('nutrition:getSummaryRange', start, end),
  nutritionGetWeights: () => ipcRenderer.invoke('nutrition:getWeights'),
  nutritionGetStreak: () => ipcRenderer.invoke('nutrition:getStreak'),
  nutritionGetTodayCalories: () => ipcRenderer.invoke('nutrition:getTodayCalories'),
  nutritionGetTodayTarget: () => ipcRenderer.invoke('nutrition:getTodayTarget'),
  nutritionCloseDay: (date: string) => ipcRenderer.invoke('nutrition:closeDay', date),
  nutritionIsDayClosed: (date: string) => ipcRenderer.invoke('nutrition:isDayClosed', date),
  nutritionShouldAskWeight: () => ipcRenderer.invoke('nutrition:shouldAskWeight'),
  // Character
  characterSave: (data: Record<string, unknown>) => ipcRenderer.invoke('character:save', data),
  characterLoad: () => ipcRenderer.invoke('character:load'),

  // Sync
  syncRestoreStats: (stats: Record<string, unknown>) => ipcRenderer.invoke('sync:restoreStats', stats),
  syncGetAllQuestData: () => ipcRenderer.invoke('sync:getAllQuestData'),
  syncMergeQuestData: (data: Record<string, unknown>) => ipcRenderer.invoke('sync:mergeQuestData', data),
  syncGetAllNutritionData: () => ipcRenderer.invoke('sync:getAllNutritionData'),
  syncMergeNutritionData: (data: Record<string, unknown>) => ipcRenderer.invoke('sync:mergeNutritionData', data),
  syncGetAllFinanceData: () => ipcRenderer.invoke('sync:getAllFinanceData'),
  syncMergeFinanceData: (data: Record<string, unknown[]>) => ipcRenderer.invoke('sync:mergeFinanceData', data),
  syncClearUserData: () => ipcRenderer.invoke('sync:clearUserData'),
  syncSetCurrentUser: (uid: string) => ipcRenderer.invoke('sync:setCurrentUser', uid),
  syncGetCurrentUser: () => ipcRenderer.invoke('sync:getCurrentUser'),

  // Backup
  backupExport: () => ipcRenderer.invoke('backup:export'),
  backupImport: () => ipcRenderer.invoke('backup:import'),

  // Notifications
  notificationsSetReminders: (enabled: boolean) => ipcRenderer.invoke('notifications:setReminders', enabled),
  notificationsSend: (title: string, body: string) => ipcRenderer.invoke('notifications:send', title, body),

  // Dollar
  dollarGetRates: () => ipcRenderer.invoke('dollar:getRates'),

  // Finance - Transactions
  financeGetTransactions: (filters: Record<string, unknown>) => ipcRenderer.invoke('finance:getTransactions', filters),
  financeAddTransaction: (tx: Record<string, unknown>) => ipcRenderer.invoke('finance:addTransaction', tx),
  financeUpdateTransaction: (id: string, fields: Record<string, unknown>) => ipcRenderer.invoke('finance:updateTransaction', id, fields),
  financeDeleteTransaction: (id: string) => ipcRenderer.invoke('finance:deleteTransaction', id),

  // Finance - Installments
  financeGetInstallmentGroups: () => ipcRenderer.invoke('finance:getInstallmentGroups'),
  financeGetInstallmentsForMonth: (month: string) => ipcRenderer.invoke('finance:getInstallmentsForMonth', month),
  financeGetInstallmentProjection: (months: number) => ipcRenderer.invoke('finance:getInstallmentProjection', months),
  financeCreateInstallmentGroup: (group: Record<string, unknown>) => ipcRenderer.invoke('finance:createInstallmentGroup', group),
  financeDeleteInstallmentGroup: (id: string) => ipcRenderer.invoke('finance:deleteInstallmentGroup', id),
  financeUpdateInstallmentAmount: (txId: string, newAmount: number) => ipcRenderer.invoke('finance:updateInstallmentAmount', txId, newAmount),

  // Finance - Loans
  financeGetLoans: (filter?: Record<string, unknown>) => ipcRenderer.invoke('finance:getLoans', filter),
  financeGetLoansByPerson: (name: string) => ipcRenderer.invoke('finance:getLoansByPerson', name),
  financeAddLoan: (loan: Record<string, unknown>) => ipcRenderer.invoke('finance:addLoan', loan),
  financeSettleLoan: (id: string) => ipcRenderer.invoke('finance:settleLoan', id),
  financeAddLoanPayment: (loanId: string, payment: Record<string, unknown>) => ipcRenderer.invoke('finance:addLoanPayment', loanId, payment),
  financeGetLoanPayments: (loanId: string) => ipcRenderer.invoke('finance:getLoanPayments', loanId),
  financeCreateThirdPartyPurchase: (data: Record<string, unknown>) => ipcRenderer.invoke('finance:createThirdPartyPurchase', data),
  financeGetActiveLoanSummary: () => ipcRenderer.invoke('finance:getActiveLoanSummary'),

  // Finance - Recurring
  financeGetRecurring: () => ipcRenderer.invoke('finance:getRecurring'),
  financeAddRecurring: (rec: Record<string, unknown>) => ipcRenderer.invoke('finance:addRecurring', rec),
  financeUpdateRecurringAmount: (id: string, newAmount: number) => ipcRenderer.invoke('finance:updateRecurringAmount', id, newAmount),
  financeUpdateRecurring: (id: string, fields: Record<string, unknown>) => ipcRenderer.invoke('finance:updateRecurring', id, fields),
  financeToggleRecurring: (id: string) => ipcRenderer.invoke('finance:toggleRecurring', id),
  financeDeleteRecurring: (id: string) => ipcRenderer.invoke('finance:deleteRecurring', id),
  financeGenerateRecurringForMonth: (month: string) => ipcRenderer.invoke('finance:generateRecurringForMonth', month),
  financeGetRecurringAmountHistory: (id: string) => ipcRenderer.invoke('finance:getRecurringAmountHistory', id),

  // Finance - Import
  financeImportSelectAndParsePDF: () => ipcRenderer.invoke('finance:importSelectAndParsePDF'),
  financeImportConfirm: (rows: unknown[], statementMonth: string, fileName: string) => ipcRenderer.invoke('finance:importConfirm', rows, statementMonth, fileName),
  financeGetCategoryMappings: () => ipcRenderer.invoke('finance:getCategoryMappings'),
  financeUpdateCategoryMapping: (pattern: string, category: string) => ipcRenderer.invoke('finance:updateCategoryMapping', pattern, category),

  // Finance - Dashboard
  financeGetMonthlyBalance: (month?: string) => ipcRenderer.invoke('finance:getMonthlyBalance', month),
  financeGetCategoryBreakdown: (month?: string) => ipcRenderer.invoke('finance:getCategoryBreakdown', month),
  financeGetBalanceForRange: (startMonth: string, endMonth: string) => ipcRenderer.invoke('finance:getBalanceForRange', startMonth, endMonth),
  financeGetCategoryBreakdownForRange: (startMonth: string, endMonth: string) => ipcRenderer.invoke('finance:getCategoryBreakdownForRange', startMonth, endMonth),
  financeGetProjection: (months: number) => ipcRenderer.invoke('finance:getProjection', months),

  // Finance - Backward compat
  financeGetMonthlyTotal: () => ipcRenderer.invoke('finance:getMonthlyTotal'),
  financeGetActiveLoansCount: () => ipcRenderer.invoke('finance:getActiveLoansCount'),
  financeGetCategories: () => ipcRenderer.invoke('finance:getCategories'),
  financeAddCategory: (name: string) => ipcRenderer.invoke('finance:addCategory', name),
  financeDeleteCategory: (name: string) => ipcRenderer.invoke('finance:deleteCategory', name),

  // Finance - Credit Cards
  financeGetCreditCards: () => ipcRenderer.invoke('finance:getCreditCards'),
  financeAddCreditCard: (card: Record<string, unknown>) => ipcRenderer.invoke('finance:addCreditCard', card),
  financeUpdateCreditCard: (id: string, fields: Record<string, unknown>) => ipcRenderer.invoke('finance:updateCreditCard', id, fields),
  financeDeleteCreditCard: (id: string) => ipcRenderer.invoke('finance:deleteCreditCard', id),
  financeGetCreditCardStatements: (filters?: Record<string, unknown>) => ipcRenderer.invoke('finance:getCreditCardStatements', filters),
  financeGetStatementDetail: (id: string) => ipcRenderer.invoke('finance:getStatementDetail', id),
  financeGenerateStatement: (cardId: string, periodMonth: string) => ipcRenderer.invoke('finance:generateStatement', cardId, periodMonth),
  financePayStatement: (id: string, paidAmount: number) => ipcRenderer.invoke('finance:payStatement', id, paidAmount),

  // Updater
  updaterCheck: () => ipcRenderer.invoke('updater:check'),
  updaterDownload: () => ipcRenderer.invoke('updater:download') as Promise<string>,
  onUpdateAvailable: (callback: (info: { version: string }) => void) => {
    const handler = (_e: unknown, info: { version: string }) => callback(info);
    ipcRenderer.on('updater:update-available', handler);
    return () => ipcRenderer.removeListener('updater:update-available', handler);
  },
  onUpdateDownloaded: (callback: () => void) => {
    ipcRenderer.on('updater:update-downloaded', callback);
    return () => ipcRenderer.removeListener('updater:update-downloaded', callback);
  },
  onDownloadProgress: (callback: (info: { percent: number }) => void) => {
    const handler = (_e: unknown, info: { percent: number }) => callback(info);
    ipcRenderer.on('updater:download-progress', handler);
    return () => ipcRenderer.removeListener('updater:download-progress', handler);
  },
  onUpdateError: (callback: (info: { message: string }) => void) => {
    const handler = (_e: unknown, info: { message: string }) => callback(info);
    ipcRenderer.on('updater:error', handler);
    return () => ipcRenderer.removeListener('updater:error', handler);
  },
};

export type Api = typeof api;
contextBridge.exposeInMainWorld('api', api);

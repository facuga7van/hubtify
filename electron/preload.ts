import { contextBridge, ipcRenderer } from 'electron';
import type { RpgEvent } from '../shared/types';

const api = {
  getRpgStats: () => ipcRenderer.invoke('rpg:getStats'),
  processRpgEvent: (event: RpgEvent) => ipcRenderer.invoke('rpg:processEvent', event),
  rpgSetInnMode: (on: boolean) => ipcRenderer.invoke('rpg:setInnMode', on),
  getRpgHistory: (limit: number) => ipcRenderer.invoke('rpg:getHistory', limit),
  rpgGetDashboardStats: () => ipcRenderer.invoke('rpg:getDashboardStats'),
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximize: () => ipcRenderer.send('window:maximize'),
  windowClose: () => ipcRenderer.send('window:close'),

  // Quests
  questsGetTasks: (projectId?: string | null) => ipcRenderer.invoke('quests:getTasks', projectId),
  questsUpsertTask: (task: Record<string, unknown>) => ipcRenderer.invoke('quests:upsertTask', task),
  questsDeleteTasks: (ids: string[]) => ipcRenderer.invoke('quests:deleteTasks', ids),
  questsSetTaskStatus: (taskId: string, status: boolean) => ipcRenderer.invoke('quests:setTaskStatus', taskId, status),
  questsSyncTaskOrders: (orders: Array<{ id: string; order: number }>) => ipcRenderer.invoke('quests:syncTaskOrders', orders),
  questsPostponeTasks: (ids: string[], target: string) => ipcRenderer.invoke('quests:postponeTasks', ids, target),
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
  questsGetHabitHeatmap: (days?: number) => ipcRenderer.invoke('quests:getHabitHeatmap', days),
  questsGetHabits: () => ipcRenderer.invoke('quests:getHabits'),
  questsAddHabit: (habit: { name: string; frequency: string; timesPerWeek: number }) => ipcRenderer.invoke('quests:addHabit', habit),
  questsUpdateHabit: (id: string, updates: { name?: string; frequency?: string; timesPerWeek?: number }) => ipcRenderer.invoke('quests:updateHabit', id, updates),
  questsDeleteHabit: (id: string) => ipcRenderer.invoke('quests:deleteHabit', id),
  questsCheckHabit: (habitId: string) => ipcRenderer.invoke('quests:checkHabit', habitId),
  questsSkipHabit: (habitId: string, date?: string) => ipcRenderer.invoke('quests:skipHabit', habitId, date),
  questsCheckHabitForDate: (habitId: string, date: string) => ipcRenderer.invoke('quests:checkHabitForDate', habitId, date),
  questsGetProjects: () => ipcRenderer.invoke('quests:getProjects'),
  questsUpsertProject: (project: Record<string, unknown>) => ipcRenderer.invoke('quests:upsertProject', project),
  questsDeleteProject: (id: string) => ipcRenderer.invoke('quests:deleteProject', id),
  questsSyncProjectOrders: (orders: Array<{ id: string; order: number }>) => ipcRenderer.invoke('quests:syncProjectOrders', orders),
  questsCountCompletedToday: () => ipcRenderer.invoke('quests:countCompletedToday'),
  questsGetPendingCount: () => ipcRenderer.invoke('quests:getPendingCount'),
  questsGetCompletedTodayCount: () => ipcRenderer.invoke('quests:getCompletedTodayCount'),
  questsGetOverdueCount: () => ipcRenderer.invoke('quests:getOverdueCount'),

  // Nutrition
  nutritionGetProfile: () => ipcRenderer.invoke('nutrition:getProfile'),
  nutritionSaveProfile: (profile: Record<string, unknown>) => ipcRenderer.invoke('nutrition:saveProfile', profile),
  nutritionLogFood: (entry: Record<string, unknown>) => ipcRenderer.invoke('nutrition:logFood', entry),
  nutritionGetFoodByDate: (date: string) => ipcRenderer.invoke('nutrition:getFoodByDate', date),
  nutritionCopyDay: (opts?: { from?: string; to?: string }) => ipcRenderer.invoke('nutrition:copyDay', opts),
  nutritionDeleteFood: (id: number) => ipcRenderer.invoke('nutrition:deleteFood', id),
  nutritionDeleteByDate: (date: string) => ipcRenderer.invoke('nutrition:deleteByDate', date),
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
  nutritionGetWeekCalories: () => ipcRenderer.invoke('nutrition:getWeekCalories'),
  nutritionGetTodayCalories: () => ipcRenderer.invoke('nutrition:getTodayCalories'),
  nutritionGetTodayMealsCount: () => ipcRenderer.invoke('nutrition:getTodayMealsCount'),
  nutritionGetTodayTarget: () => ipcRenderer.invoke('nutrition:getTodayTarget'),
  nutritionCloseDay: (date: string) => ipcRenderer.invoke('nutrition:closeDay', date),
  nutritionIsDayClosed: (date: string) => ipcRenderer.invoke('nutrition:isDayClosed', date),
  nutritionReopenDay: (date: string) => ipcRenderer.invoke('nutrition:reopenDay', date),
  nutritionShouldAskWeight: () => ipcRenderer.invoke('nutrition:shouldAskWeight'),
  nutritionGetFavoriteFoods: () => ipcRenderer.invoke('nutrition:getFavoriteFoods'),
  nutritionAddFavoriteFood: (food: Record<string, unknown>) => ipcRenderer.invoke('nutrition:addFavoriteFood', food),
  nutritionRemoveFavoriteFood: (id: string) => ipcRenderer.invoke('nutrition:removeFavoriteFood', id),
  nutritionGetPendingDays: () => ipcRenderer.invoke('nutrition:getPendingDays'),
  nutritionGetMealSchedule: () => ipcRenderer.invoke('nutrition:getMealSchedule'),
  // Character
  characterSave: (data: Record<string, unknown>) => ipcRenderer.invoke('character:save', data),
  characterLoad: () => ipcRenderer.invoke('character:load'),
  characterGetName: () => ipcRenderer.invoke('character:getName'),
  characterSetName: (name: string) => ipcRenderer.invoke('character:setName', name),
  characterGetUsername: () => ipcRenderer.invoke('character:getUsername'),
  characterSetUsername: (username: string) => ipcRenderer.invoke('character:setUsername', username),

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
  syncGetAllNotificationData: () => ipcRenderer.invoke('sync:getAllNotificationData'),
  syncMergeNotificationData: (data: Record<string, unknown>[]) => ipcRenderer.invoke('sync:mergeNotificationData', data),
  syncGetAllCauldronData: () => ipcRenderer.invoke('sync:getAllCauldronData'),
  syncMergeCauldronData: (data: Record<string, unknown>) => ipcRenderer.invoke('sync:mergeCauldronData', data),

  // Backup
  backupExport: () => ipcRenderer.invoke('backup:export'),
  backupPickImportFile: () => ipcRenderer.invoke('backup:pickImportFile'),
  backupImport: (filePath?: string) => ipcRenderer.invoke('backup:import', filePath),

  // Notifications
  notificationsSend: (title: string, body: string) => ipcRenderer.invoke('notifications:send', title, body),
  notificationsGetAll: () => ipcRenderer.invoke('notifications:getAll'),
  notificationsDismiss: (id: string) => ipcRenderer.invoke('notifications:dismiss', id),
  notificationsSnooze: (id: string) => ipcRenderer.invoke('notifications:snooze', id),
  notificationsRunCheck: () => ipcRenderer.invoke('notifications:runCheck'),
  notificationsGetCount: () => ipcRenderer.invoke('notifications:getCount'),
  notificationsSetSystemEnabled: (enabled: boolean) => ipcRenderer.invoke('notifications:setSystemEnabled', enabled),
  notificationsSetLocale: (locale: string) => ipcRenderer.invoke('notifications:setLocale', locale),
  notificationsSetModuleEnabled: (module: string, enabled: boolean) => ipcRenderer.invoke('notifications:setModuleEnabled', module, enabled),
  notificationsSetHabitReminder: (enabled: boolean, time: string) => ipcRenderer.invoke('notifications:setHabitReminder', enabled, time),
  onRpgPardonUsed: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('rpg:pardonUsed', handler);
    return () => { ipcRenderer.removeListener('rpg:pardonUsed', handler); };
  },
  onNotificationsUpdated: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('notifications:updated', handler);
    return () => { ipcRenderer.removeListener('notifications:updated', handler); };
  },

  // Cauldron
  cauldronGetPresets: () => ipcRenderer.invoke('cauldron:getPresets'),
  cauldronUpsertPreset: (preset: Record<string, unknown>) => ipcRenderer.invoke('cauldron:upsertPreset', preset),
  cauldronDeletePreset: (id: string) => ipcRenderer.invoke('cauldron:deletePreset', id),
  cauldronStart: (presetId: string) => ipcRenderer.invoke('cauldron:start', presetId),
  cauldronPause: () => ipcRenderer.invoke('cauldron:pause'),
  cauldronResume: () => ipcRenderer.invoke('cauldron:resume'),
  cauldronSkip: () => ipcRenderer.invoke('cauldron:skip'),
  cauldronConfirmNext: () => ipcRenderer.invoke('cauldron:confirmNext'),
  cauldronExtend: (minutes?: number) => ipcRenderer.invoke('cauldron:extend', minutes),
  cauldronStop: () => ipcRenderer.invoke('cauldron:stop'),
  cauldronGetState: () => ipcRenderer.invoke('cauldron:getState'),
  cauldronGetStats: () => ipcRenderer.invoke('cauldron:getStats'),
  cauldronGetSessions: (offset?: number, limit?: number) => ipcRenderer.invoke('cauldron:getSessions', offset, limit),
  cauldronGetWeeklyFocusTime: () => ipcRenderer.invoke('cauldron:getWeeklyFocusTime'),
  cauldronGetInterruptedSession: () => ipcRenderer.invoke('cauldron:getInterruptedSession'),
  cauldronResumeInterruptedSession: () => ipcRenderer.invoke('cauldron:resumeInterruptedSession'),
  cauldronDiscardInterruptedSession: () => ipcRenderer.invoke('cauldron:discardInterruptedSession'),
  cauldronCancelAutoStart: () => ipcRenderer.invoke('cauldron:cancelAutoStart'),
  cauldronSetLabels: (labels: Record<string, string>) => ipcRenderer.invoke('cauldron:setLabels', labels),
  onCauldronTick: (callback: (state: unknown) => void) => {
    const handler = (_e: unknown, state: unknown) => callback(state);
    ipcRenderer.on('cauldron:tick', handler);
    return () => { ipcRenderer.removeListener('cauldron:tick', handler); };
  },
  onCauldronSessionEnd: (callback: (result: unknown) => void) => {
    const handler = (_e: unknown, result: unknown) => callback(result);
    ipcRenderer.on('cauldron:sessionEnd', handler);
    return () => { ipcRenderer.removeListener('cauldron:sessionEnd', handler); };
  },
  cauldronOpenWindow: () => ipcRenderer.invoke('cauldron:openWindow'),
  cauldronCloseWindow: () => ipcRenderer.invoke('cauldron:closeWindow'),
  onCauldronWindowOpened: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('cauldron:windowOpened', handler);
    return () => { ipcRenderer.removeListener('cauldron:windowOpened', handler); };
  },
  onCauldronWindowClosed: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('cauldron:windowClosed', handler);
    return () => { ipcRenderer.removeListener('cauldron:windowClosed', handler); };
  },

  // Dollar
  dollarGetRates: () => ipcRenderer.invoke('dollar:getRates'),
  dollarGetVisibleTypes: () => ipcRenderer.invoke('dollar:getVisibleTypes'),
  dollarSetVisibleTypes: (types: string[]) => ipcRenderer.invoke('dollar:setVisibleTypes', types),

  // Crypto
  cryptoGetRates: () => ipcRenderer.invoke('crypto:getRates'),
  cryptoGetVisibleTypes: () => ipcRenderer.invoke('crypto:getVisibleTypes'),
  cryptoSetVisibleTypes: (types: string[]) => ipcRenderer.invoke('crypto:setVisibleTypes', types),

  // Finance - Transactions
  financeGetTransactions: (filters: Record<string, unknown>) => ipcRenderer.invoke('finance:getTransactions', filters),
  financeAddTransaction: (tx: Record<string, unknown>) => ipcRenderer.invoke('finance:addTransaction', tx),
  financeUpdateTransaction: (id: string, fields: Record<string, unknown>) => ipcRenderer.invoke('finance:updateTransaction', id, fields),
  financeDeleteTransaction: (id: string) => ipcRenderer.invoke('finance:deleteTransaction', id),

  // Finance - Installments
  financeGetInstallmentGroups: (month?: string) => ipcRenderer.invoke('finance:getInstallmentGroups', month),
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
  financeDeleteLoanPayment: (id: string) => ipcRenderer.invoke('finance:deleteLoanPayment', id),
  financeCreateThirdPartyPurchase: (data: Record<string, unknown>) => ipcRenderer.invoke('finance:createThirdPartyPurchase', data),
  financeGetActiveLoanSummary: (asOfMonth?: string) => ipcRenderer.invoke('finance:getActiveLoanSummary', asOfMonth),

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
  financeImportConfirm: (rows: unknown[], statementMonth: string, fileName: string, creditCardId?: string | null) => ipcRenderer.invoke('finance:importConfirm', rows, statementMonth, fileName, creditCardId),
  financeUndoImportBatch: (batchId: string) => ipcRenderer.invoke('finance:undoImportBatch', batchId),
  financeGetImportBatches: () => ipcRenderer.invoke('finance:getImportBatches'),
  financeGetCategoryMappings: () => ipcRenderer.invoke('finance:getCategoryMappings'),
  financeUpdateCategoryMapping: (pattern: string, category: string) => ipcRenderer.invoke('finance:updateCategoryMapping', pattern, category),

  // Finance - Dashboard
  financeGetMonthlyBalance: (month?: string) => ipcRenderer.invoke('finance:getMonthlyBalance', month),
  financeGetCategoryBreakdown: (month?: string) => ipcRenderer.invoke('finance:getCategoryBreakdown', month),
  financeGetBalanceForRange: (startMonth: string, endMonth: string) => ipcRenderer.invoke('finance:getBalanceForRange', startMonth, endMonth),
  financeGetCategoryBreakdownForRange: (startMonth: string, endMonth: string) => ipcRenderer.invoke('finance:getCategoryBreakdownForRange', startMonth, endMonth),
  financeGetProjection: (months: number, fromMonth?: string) => ipcRenderer.invoke('finance:getProjection', months, fromMonth),

  // Finance - Export
  financeExportCsv: (month?: string) => ipcRenderer.invoke('finance:exportCsv', month),

  // Finance - Dashboard (new)
  financeGetMonthlyExpenses: (endMonth?: string) => ipcRenderer.invoke('finance:getMonthlyExpenses', endMonth),
  financeGetCategoryAverages: () => ipcRenderer.invoke('finance:getCategoryAverages'),
  financeGetPreviousMonthSummary: () => ipcRenderer.invoke('finance:getPreviousMonthSummary'),

  // Finance - Backward compat
  financeGetMonthlyTotal: () => ipcRenderer.invoke('finance:getMonthlyTotal'),
  financeGetActiveLoansCount: () => ipcRenderer.invoke('finance:getActiveLoansCount'),
  financeGetTodayTransactionsCount: () => ipcRenderer.invoke('finance:getTodayTransactionsCount'),
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
  financePayStatement: (id: string, paidAmount: number, paidAmountUsd?: number) => ipcRenderer.invoke('finance:payStatement', id, paidAmount, paidAmountUsd),
  financeGetExpenseBreakdown: (month?: string) => ipcRenderer.invoke('finance:getExpenseBreakdown', month),
  financeGetExpenseBreakdownForRange: (startMonth: string, endMonth: string) => ipcRenderer.invoke('finance:getExpenseBreakdownForRange', startMonth, endMonth),

  // Feedback
  feedbackSend: (data: { type: string; description: string; email?: string }) => ipcRenderer.invoke('feedback:send', data),

  // Syl (read-projection snapshot)
  sylBuildSnapshot: () => ipcRenderer.invoke('syl:buildSnapshot') as Promise<Record<string, unknown>>,

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

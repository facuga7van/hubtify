import { contextBridge, ipcRenderer } from 'electron';
import type { RpgEvent, Migration } from '../shared/types';

const api = {
  getRpgStats: () => ipcRenderer.invoke('rpg:getStats'),
  processRpgEvent: (event: RpgEvent) => ipcRenderer.invoke('rpg:processEvent', event),
  getRpgHistory: (limit: number) => ipcRenderer.invoke('rpg:getHistory', limit),
  runMigrations: (migrations: Migration[]) => ipcRenderer.invoke('db:runMigrations', migrations),
  windowMinimize: () => ipcRenderer.send('window:minimize'),
  windowMaximize: () => ipcRenderer.send('window:maximize'),
  windowClose: () => ipcRenderer.send('window:close'),

  // Quests
  questsGetTasks: () => ipcRenderer.invoke('quests:getTasks'),
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
  questsGetCategories: () => ipcRenderer.invoke('quests:getCategories'),
  questsEnsureCategory: (name: string) => ipcRenderer.invoke('quests:ensureCategory', name),
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
  nutritionEstimate: (description: string) => ipcRenderer.invoke('nutrition:estimate', description),
  nutritionGetAiStatus: () => ipcRenderer.invoke('nutrition:getAiStatus'),
  nutritionIsOllamaAvailable: () => ipcRenderer.invoke('nutrition:isOllamaAvailable'),
  nutritionSearchFoodDb: (query: string) => ipcRenderer.invoke('nutrition:searchFoodDb', query),
  nutritionLearnFood: (entry: Record<string, unknown>) => ipcRenderer.invoke('nutrition:learnFood', entry),
  onEstimateProgress: (callback: (stage: string) => void) => {
    const handler = (_e: unknown, stage: string) => callback(stage);
    ipcRenderer.on('nutrition:estimate-progress', handler);
    return () => ipcRenderer.removeListener('nutrition:estimate-progress', handler);
  },

  // Character
  characterSave: (data: Record<string, unknown>) => ipcRenderer.invoke('character:save', data),
  characterLoad: () => ipcRenderer.invoke('character:load'),

  // Auth
  authLogin: (email: string, password: string) => ipcRenderer.invoke('auth:login', email, password),
  authRegister: (email: string, password: string) => ipcRenderer.invoke('auth:register', email, password),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  authGetUser: () => ipcRenderer.invoke('auth:getUser'),
  onAuthStateChanged: (callback: (user: unknown) => void) => {
    const handler = (_e: unknown, user: unknown) => callback(user);
    ipcRenderer.on('auth:stateChanged', handler);
    return () => ipcRenderer.removeListener('auth:stateChanged', handler);
  },

  // Sync
  syncPush: (uid: string) => ipcRenderer.invoke('sync:push', uid),
  syncPull: (uid: string) => ipcRenderer.invoke('sync:pull', uid),

  // Backup
  backupExport: () => ipcRenderer.invoke('backup:export'),
  backupImport: () => ipcRenderer.invoke('backup:import'),

  // Finance
  financeGetTransactions: (month: string) => ipcRenderer.invoke('finance:getTransactions', month),
  financeAddTransaction: (tx: Record<string, unknown>) => ipcRenderer.invoke('finance:addTransaction', tx),
  financeDeleteTransaction: (id: string) => ipcRenderer.invoke('finance:deleteTransaction', id),
  financeGetLoans: () => ipcRenderer.invoke('finance:getLoans'),
  financeAddLoan: (loan: Record<string, unknown>) => ipcRenderer.invoke('finance:addLoan', loan),
  financeSettleLoan: (id: string) => ipcRenderer.invoke('finance:settleLoan', id),
  financeGetIncomeSources: () => ipcRenderer.invoke('finance:getIncomeSources'),
  financeAddIncomeSource: (src: Record<string, unknown>) => ipcRenderer.invoke('finance:addIncomeSource', src),
  financeToggleIncomeSource: (id: string) => ipcRenderer.invoke('finance:toggleIncomeSource', id),
  financeGetCategories: () => ipcRenderer.invoke('finance:getCategories'),
  financeGetMonthlyTotal: () => ipcRenderer.invoke('finance:getMonthlyTotal'),
  financeGetActiveLoansCount: () => ipcRenderer.invoke('finance:getActiveLoansCount'),
};

export type Api = typeof api;
contextBridge.exposeInMainWorld('api', api);

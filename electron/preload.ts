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
};

export type Api = typeof api;
contextBridge.exposeInMainWorld('api', api);

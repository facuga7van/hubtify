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
};

export type Api = typeof api;
contextBridge.exposeInMainWorld('api', api);

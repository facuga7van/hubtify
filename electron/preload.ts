import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { buildApi, type EventHandler, type Transport } from '../shared/build-api';

/**
 * window.api is generated from shared/api-channels.ts — add a method there
 * (and its type in HubtifyApi), never here. Listeners are wrapped so the
 * renderer callback receives the payload only (no IpcRendererEvent), which is
 * what every hand-written wrapper here used to do.
 */
const listeners = new WeakMap<EventHandler, (event: IpcRendererEvent, payload: unknown) => void>();

const transport: Transport = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on: (channel, handler) => {
    const listener = (_event: IpcRendererEvent, payload: unknown) => handler(payload);
    listeners.set(handler, listener);
    ipcRenderer.on(channel, listener);
  },
  off: (channel, handler) => {
    const listener = listeners.get(handler);
    if (!listener) return;
    ipcRenderer.removeListener(channel, listener);
    listeners.delete(handler);
  },
};

contextBridge.exposeInMainWorld('api', buildApi(transport, 'desktop'));

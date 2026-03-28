import type { HubtifyApi } from '../shared/types';

declare global {
  const APP_VERSION: string;
  interface Window {
    api: HubtifyApi;
  }
}

export {};

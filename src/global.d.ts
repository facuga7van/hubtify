import type { HubtifyApi } from '../shared/types';

declare global {
  interface Window {
    api: HubtifyApi;
  }
}

export {};

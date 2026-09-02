import type { HubtifyApi } from '../shared/types';

declare global {
  const APP_VERSION: string;
  /** Inyectada por `define` en vite.renderer.config.ts ('desktop') y vite.mobile.config.ts ('android'). */
  const __HUBTIFY_PLATFORM__: 'desktop' | 'android' | undefined;
  interface Window {
    api: HubtifyApi;
  }
}

export {};

import type { HubtifyApi } from '../../../shared/types';

export function useApi(): HubtifyApi {
  return window.api;
}

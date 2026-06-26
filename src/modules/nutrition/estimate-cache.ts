import type { AiResult } from './estimate-core';

/**
 * Local cache for AI nutrition estimations.
 *
 * Why localStorage: estimations are small, user-scoped JSON blobs that are cheap
 * to re-fetch but expensive (latency + Cloud Function cost) when repeated. They
 * do NOT need to sync across devices and do NOT belong in SQLite/Firestore — a
 * cache miss simply triggers a fresh estimate. localStorage is synchronous,
 * survives reloads, and keeps this concern fully in the renderer.
 *
 * The pure map helpers (getCached/putCached) are storage-agnostic so they can be
 * unit-tested without a DOM, while loadCacheMap/saveCacheMap are the only pieces
 * that touch localStorage (guarded against SSR/test environments).
 */

const CACHE_KEY = 'hubtify_nutri_estimate_cache';
/** Keep the cache bounded; evict the oldest entries past this many. */
export const MAX_ENTRIES = 100;
/** Entries older than this are treated as misses (food/portion data drifts). */
export const TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export type CacheEntry = { result: AiResult; ts: number };
export type CacheMap = Record<string, CacheEntry>;

/** Normalize a free-text description so equivalent inputs share one cache key. */
export function normalizeDescription(description: string): string {
  return description.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Read a cached result by normalized key, honouring TTL. Pure. */
export function getCached(
  map: CacheMap,
  normalizedKey: string,
  now: number,
  ttlMs: number = TTL_MS,
): AiResult | null {
  const entry = map[normalizedKey];
  if (!entry) return null;
  if (now - entry.ts > ttlMs) return null; // expired
  return entry.result;
}

/** Return a new map with the entry stored and the oldest entries evicted. Pure. */
export function putCached(
  map: CacheMap,
  normalizedKey: string,
  result: AiResult,
  now: number,
  maxEntries: number = MAX_ENTRIES,
): CacheMap {
  const next: CacheMap = { ...map, [normalizedKey]: { result, ts: now } };
  const keys = Object.keys(next);
  if (keys.length > maxEntries) {
    keys.sort((a, b) => next[a].ts - next[b].ts); // oldest first
    for (const k of keys.slice(0, keys.length - maxEntries)) delete next[k];
  }
  return next;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadCacheMap(storage: Storage | null = safeStorage()): CacheMap {
  if (!storage) return {};
  try {
    const raw = storage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as CacheMap) : {};
  } catch {
    return {};
  }
}

export function saveCacheMap(map: CacheMap, storage: Storage | null = safeStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(CACHE_KEY, JSON.stringify(map));
  } catch {
    // Ignore quota / serialization errors — the cache is best-effort.
  }
}

/** Read a cached estimation for a raw description (handles normalization + TTL). */
export function readEstimateCache(description: string): AiResult | null {
  return getCached(loadCacheMap(), normalizeDescription(description), Date.now());
}

/** Persist an estimation for a raw description (handles normalization + eviction). */
export function writeEstimateCache(description: string, result: AiResult): void {
  const map = putCached(loadCacheMap(), normalizeDescription(description), result, Date.now());
  saveCacheMap(map);
}

import { cacheCounts as rawCacheCounts, clearCache as rawClearCache } from './messages';
import type { CacheCounts, ClearCacheTarget } from '$types/messages';

/**
 * Cache wrappers — thin layer over messages.ts that surfaces just the data
 * components need (the counts dict, the success flag).
 */

export async function getCounts(): Promise<CacheCounts | null> {
  try {
    const res = await rawCacheCounts();
    return res.ok && res.counts ? res.counts : null;
  } catch (err) {
    console.warn('[lws] cache.ts: getCounts failed:', err);
    return null;
  }
}

export async function clear(target: ClearCacheTarget): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await rawClearCache(target);
    return { ok: !!res.ok, error: res.error };
  } catch (err) {
    return { ok: false, error: (err as Error).message || String(err) };
  }
}

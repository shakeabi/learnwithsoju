/**
 * Two-tier lookup cache for KRDict / OpenDict responses.
 *
 *   L1: in-memory LRU Map (hot path; service worker resets when SW is killed).
 *   L2: persistent storage backend (chrome.storage.local in production,
 *       a plain Map in tests).
 *
 * The persistent layer is namespaced with a `lookup:` key prefix so it can
 * coexist with other extension-managed entries in the same storage area.
 *
 * The factory accepts a storage adapter so tests can inject a mock without
 * pulling chrome APIs into Node. The adapter shape mirrors a small subset
 * of chrome.storage.StorageArea:
 *
 *   storage.get(key)      → Promise<{ [k: string]: any }>
 *   storage.set(obj)      → Promise<void>
 *   storage.remove(keys)  → Promise<void>   (string | string[])
 *   storage.getKeys?()    → Promise<string[]>  (optional; used by clear()
 *                           when present so we only delete our namespace)
 *   storage.clear()       → Promise<void>     (fallback when getKeys absent)
 */

const PREFIX = 'lookup:';
const DEFAULT_L1_LIMIT = 500;

/**
 * @param {object} storage - chrome.storage.local-like adapter
 * @param {{ l1Limit?: number, namespace?: string }} [opts]
 */
export function createCache(storage, opts = {}) {
  if (!storage) throw new Error('createCache: storage adapter required');
  const l1Limit = opts.l1Limit ?? DEFAULT_L1_LIMIT;
  const prefix = opts.namespace ? `${opts.namespace}:` : PREFIX;
  const l1 = new Map();

  function namespaced(key) {
    return prefix + key;
  }

  function l1Get(key) {
    if (!l1.has(key)) return undefined;
    const value = l1.get(key);
    l1.delete(key);
    l1.set(key, value);
    return value;
  }

  function l1Set(key, value) {
    if (l1.has(key)) l1.delete(key);
    l1.set(key, value);
    while (l1.size > l1Limit) {
      const oldest = l1.keys().next().value;
      l1.delete(oldest);
    }
  }

  async function get(key) {
    const hit = l1Get(key);
    if (hit !== undefined) return hit;
    const ns = namespaced(key);
    const result = await storage.get(ns);
    const stored = result && result[ns];
    if (stored === undefined) return undefined;
    l1Set(key, stored);
    return stored;
  }

  async function set(key, value) {
    l1Set(key, value);
    await storage.set({ [namespaced(key)]: value });
  }

  async function clear() {
    l1.clear();
    if (typeof storage.getKeys === 'function') {
      const keys = await storage.getKeys();
      const ours = keys.filter((k) => k.startsWith(prefix));
      if (ours.length) await storage.remove(ours);
    } else if (typeof storage.clear === 'function') {
      await storage.clear();
    }
  }

  async function count() {
    try {
      const all = await storage.get(null);
      let n = 0;
      for (const k of Object.keys(all)) {
        if (k.startsWith(prefix)) n++;
      }
      return n;
    } catch (err) {
      console.warn('[lws] cache.count failed:', prefix, err);
      return null;
    }
  }

  function l1Size() {
    return l1.size;
  }

  return { get, set, clear, count, l1Size };
}

/**
 * Adapter that wraps a chrome.storage.StorageArea (which uses callbacks in
 * MV2 and Promises in MV3). Detects which it is and normalizes to Promise.
 *
 * @param {chrome.storage.StorageArea} area
 */
export function chromeStorageAdapter(area) {
  return {
    get(key) {
      const result = area.get(key);
      if (result && typeof result.then === 'function') return result;
      return new Promise((resolve, reject) => {
        area.get(key, (data) => {
          const err = chromeRuntimeLastError();
          if (err) reject(err); else resolve(data || {});
        });
      });
    },
    set(obj) {
      const result = area.set(obj);
      if (result && typeof result.then === 'function') return result;
      return new Promise((resolve, reject) => {
        area.set(obj, () => {
          const err = chromeRuntimeLastError();
          if (err) reject(err); else resolve();
        });
      });
    },
    remove(keys) {
      const result = area.remove(keys);
      if (result && typeof result.then === 'function') return result;
      return new Promise((resolve, reject) => {
        area.remove(keys, () => {
          const err = chromeRuntimeLastError();
          if (err) reject(err); else resolve();
        });
      });
    },
    getKeys: typeof area.getKeys === 'function' ? () => {
      const result = area.getKeys();
      if (result && typeof result.then === 'function') return result;
      return new Promise((resolve, reject) => {
        area.getKeys((keys) => {
          const err = chromeRuntimeLastError();
          if (err) reject(err); else resolve(keys || []);
        });
      });
    } : undefined,
    clear() {
      const result = area.clear();
      if (result && typeof result.then === 'function') return result;
      return new Promise((resolve, reject) => {
        area.clear(() => {
          const err = chromeRuntimeLastError();
          if (err) reject(err); else resolve();
        });
      });
    },
  };
}

function chromeRuntimeLastError() {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
    return new Error(chrome.runtime.lastError.message || 'chrome.runtime.lastError');
  }
  return null;
}

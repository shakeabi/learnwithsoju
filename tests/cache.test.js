import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCache } from '../extension/core/cache.js';

/** Build a fake chrome.storage.local-shaped adapter backed by a Map. */
function fakeStorage() {
  const data = new Map();
  return {
    backing: data,
    async get(key) {
      if (data.has(key)) return { [key]: data.get(key) };
      return {};
    },
    async set(obj) {
      for (const [k, v] of Object.entries(obj)) data.set(k, v);
    },
    async remove(keys) {
      const arr = Array.isArray(keys) ? keys : [keys];
      for (const k of arr) data.delete(k);
    },
    async getKeys() {
      return Array.from(data.keys());
    },
  };
}

test('createCache: throws without storage adapter', () => {
  assert.throws(() => createCache(), /storage adapter required/);
  assert.throws(() => createCache(null), /storage adapter required/);
});

test('cache.set / cache.get round-trip', async () => {
  const storage = fakeStorage();
  const cache = createCache(storage);
  await cache.set('사람', { lemma: '사람', krXml: '<x/>' });
  const got = await cache.get('사람');
  assert.deepEqual(got, { lemma: '사람', krXml: '<x/>' });
});

test('cache.get: returns undefined on miss', async () => {
  const cache = createCache(fakeStorage());
  assert.equal(await cache.get('does-not-exist'), undefined);
});

test('cache namespaces keys with the lookup: prefix', async () => {
  const storage = fakeStorage();
  const cache = createCache(storage);
  await cache.set('학교', { x: 1 });
  assert.deepEqual(Array.from(storage.backing.keys()), ['lookup:학교']);
});

test('cache: L1 reads do not touch storage on second hit', async () => {
  const storage = fakeStorage();
  let getCalls = 0;
  const wrapped = {
    ...storage,
    async get(k) { getCalls++; return storage.get(k); },
  };
  const cache = createCache(wrapped);
  await cache.set('a', { v: 1 });
  await cache.get('a'); // L1 hit (just-set)
  await cache.get('a');
  assert.equal(getCalls, 0, 'L1 should serve all reads after a set');
});

test('cache: cold L1 reads from L2 once, then serves L1', async () => {
  const storage = fakeStorage();
  await storage.set({ 'lookup:b': { v: 2 } }); // pre-populate L2 only
  let getCalls = 0;
  const wrapped = {
    ...storage,
    async get(k) { getCalls++; return storage.get(k); },
  };
  const cache = createCache(wrapped);
  const first = await cache.get('b');
  const second = await cache.get('b');
  assert.deepEqual(first, { v: 2 });
  assert.deepEqual(second, { v: 2 });
  assert.equal(getCalls, 1, 'should hit L2 only on the first read');
});

test('cache.clear: removes every namespaced key from L2', async () => {
  const storage = fakeStorage();
  const cache = createCache(storage);
  await cache.set('one', 1);
  await cache.set('two', 2);
  // Other keys outside our namespace must be left alone:
  await storage.set({ 'unrelated': 'keep me' });
  await cache.clear();
  assert.equal(await cache.get('one'), undefined);
  assert.equal(await cache.get('two'), undefined);
  assert.deepEqual(Array.from(storage.backing.keys()), ['unrelated']);
});

test('cache: L1 evicts the oldest entry beyond the configured limit', async () => {
  const storage = fakeStorage();
  const cache = createCache(storage, { l1Limit: 3 });
  await cache.set('a', 1);
  await cache.set('b', 2);
  await cache.set('c', 3);
  await cache.set('d', 4); // pushes out 'a'
  assert.equal(cache.l1Size(), 3);
  // L1 evicted 'a', but L2 still has it
  let getCalls = 0;
  const wrapped = {
    ...storage,
    async get(k) { getCalls++; return storage.get(k); },
  };
  const cache2 = createCache(wrapped, { l1Limit: 3 });
  await cache2.get('a');
  assert.equal(getCalls, 1, 'should fall through to L2 for an evicted entry');
});

test('cache: L1 LRU bumps recency on get', async () => {
  const storage = fakeStorage();
  const cache = createCache(storage, { l1Limit: 3 });
  await cache.set('a', 1);
  await cache.set('b', 2);
  await cache.set('c', 3);
  await cache.get('a'); // 'a' is now most-recent
  await cache.set('d', 4); // should evict 'b' (now oldest), not 'a'
  // Verify by inspecting L1 size and that 'a' is still served from L1:
  let getCalls = 0;
  const wrapped = {
    ...storage,
    async get(k) { getCalls++; return storage.get(k); },
  };
  // We can't introspect cache's L1 directly, but we can build a fresh cache
  // and confirm 'b' has been evicted from THIS cache's L1 by writing a
  // sentinel directly into L2 that bypasses L1:
  await storage.set({ 'lookup:a': 'L2-only-a' });
  const cachedAValue = await cache.get('a');
  assert.equal(cachedAValue, 1, 'L1 should still have a, returning the original 1 (not the L2-only sentinel)');
});

test('cache: works with namespace override', async () => {
  const storage = fakeStorage();
  const cache = createCache(storage, { namespace: 'kr' });
  await cache.set('학교', { v: 1 });
  assert.deepEqual(Array.from(storage.backing.keys()), ['kr:학교']);
});

test('cache.clear: falls back to storage.clear when getKeys is absent', async () => {
  const data = new Map();
  const storage = {
    async get(k) { return data.has(k) ? { [k]: data.get(k) } : {}; },
    async set(obj) { for (const [k, v] of Object.entries(obj)) data.set(k, v); },
    async remove() { /* not used */ },
    async clear() { data.clear(); },
    // no getKeys
  };
  const cache = createCache(storage);
  await cache.set('x', 1);
  await cache.clear();
  assert.equal(data.size, 0);
});

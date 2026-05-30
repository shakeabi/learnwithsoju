import { lemmaCandidatesFromNbest } from './lemmatizer.js';
import { buildKrdictUrl, buildOpendictUrl, looksEmpty } from './api.js';
import { createCache, chromeStorageAdapter } from './cache.js';
import init, { Mecab } from './vendor/mecab-ko/mecab_ko_wasm.js';

const LWS_NBEST_DIAG = true;

const STORAGE_KEYS = {
  KRDICT_KEY: 'krdictApiKey',
  OPENDICT_KEY: 'opendictApiKey',
};

const MECAB_VENDOR = 'vendor/mecab-ko/';
const MECAB_FILES = ['sys.dic.gz', 'matrix.bin.gz', 'entries.bin.gz'];
const MECAB_WASM = 'mecab_ko_wasm_bg.wasm';
// N-best path count fed to lemmaCandidatesFromNbest. 3 keeps the per-lookup
// tokenize cheap while still surfacing two alternative parses for ambiguous
// words (which is where KRDict hits were missing).
const NBEST_N = 3;

const cache = createCache(chromeStorageAdapter(chrome.storage.local));
// Hanja-meanings cache is namespaced separately so a `Clear cache` of word
// lookups doesn't blow away the (small, ~hundreds of entries) hanja gloss
// cache, and vice versa.
const hanjaCache = createCache(chromeStorageAdapter(chrome.storage.local), { namespace: 'hanja' });
// Per-query dict-response caches: keyed by the exact lemma string sent to the
// API.  Two surfaces that lemmatize to the same lemma share these cached
// responses, avoiding repeat network calls to the same endpoint.
const krdictCache = createCache(chromeStorageAdapter(chrome.storage.local), { namespace: 'krdict' });
const opendictCache = createCache(chromeStorageAdapter(chrome.storage.local), { namespace: 'opendict' });
const HANJA_API = 'https://hangulhanja.com/api/search';

let mecabInstance = null;
let mecabReadyPromise = null;

let krKey = '';
let odKey = '';
let settingsReady = null;

function ensureSettings() {
  if (settingsReady) return settingsReady;
  settingsReady = chrome.storage.sync.get([STORAGE_KEYS.KRDICT_KEY, STORAGE_KEYS.OPENDICT_KEY])
    .then((settings) => {
      krKey = settings[STORAGE_KEYS.KRDICT_KEY] || '';
      odKey = settings[STORAGE_KEYS.OPENDICT_KEY] || '';
    })
    .catch((err) => {
      console.warn('[lws] settings load failed:', err);
    });
  return settingsReady;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (STORAGE_KEYS.KRDICT_KEY in changes) krKey = changes[STORAGE_KEYS.KRDICT_KEY].newValue || '';
  if (STORAGE_KEYS.OPENDICT_KEY in changes) odKey = changes[STORAGE_KEYS.OPENDICT_KEY].newValue || '';
});

ensureSettings();

async function fetchAndGunzip(path) {
  const url = chrome.runtime.getURL(path);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${path}: HTTP ${res.status}`);
  // DecompressionStream is built into MV3 service workers (Chrome 80+).
  // Stream the gzipped response through it and reassemble the bytes.
  const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function ensureMecab() {
  if (mecabInstance) return mecabInstance;
  if (mecabReadyPromise) return mecabReadyPromise;
  mecabReadyPromise = (async () => {
    await init({ module_or_path: chrome.runtime.getURL(MECAB_VENDOR + MECAB_WASM) });
    const [trie, matrix, entries] = await Promise.all(
      MECAB_FILES.map((f) => fetchAndGunzip(MECAB_VENDOR + f)),
    );
    mecabInstance = Mecab.withDictBytes(trie, matrix, entries);
    return mecabInstance;
  })();
  return mecabReadyPromise;
}

async function fetchXml(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function fetchKrdictCached(query, key) {
  try {
    const hit = await krdictCache.get(query);
    if (hit !== undefined) return hit.xml;
  } catch (err) {
    console.warn('[lws] krdictCache.get failed, fetching:', err);
  }
  const xml = await fetchXml(buildKrdictUrl(query, key));
  try {
    await krdictCache.set(query, { xml, cachedAt: Date.now() });
  } catch (err) {
    console.warn('[lws] krdictCache.set failed:', err);
  }
  return xml;
}

async function fetchOpendictCached(query, key) {
  try {
    const hit = await opendictCache.get(query);
    if (hit !== undefined) return hit.xml;
  } catch (err) {
    console.warn('[lws] opendictCache.get failed, fetching:', err);
  }
  const xml = await fetchXml(buildOpendictUrl(query, key));
  try {
    await opendictCache.set(query, { xml, cachedAt: Date.now() });
  } catch (err) {
    console.warn('[lws] opendictCache.set failed:', err);
  }
  return xml;
}

function normalizeToken(t) {
  return {
    surface: t.surface,
    pos: t.pos,
    lemma: t.lemma || null,
    reading: t.reading || null,
    features: t.features || null,
    start: t.start,
    end: t.end,
  };
}

async function tokenizeSurfaceNbest(surface) {
  // Best-effort: if mecab fails, return empty paths — caller falls back to
  // surface-only candidates and the popup just hides the decomposition row.
  try {
    const mecab = await ensureMecab();
    if (typeof mecab.tokenize_nbest === 'function') {
      const raw = mecab.tokenize_nbest(surface, NBEST_N);
      if (Array.isArray(raw) && raw.length > 0) {
        const paths = raw.map((p) => ({
          tokens: (p.tokens || []).map(normalizeToken),
          cost: typeof p.cost === 'number' ? p.cost : 0,
        }));
        if (LWS_NBEST_DIAG) {
          console.log(`[lws-nbest] surface=${surface} got ${paths.length} paths`);
          for (let i = 0; i < paths.length; i++) {
            const p = paths[i];
            const tokStr = p.tokens.map((t) => `${t.surface}(${t.pos})`).join(', ');
            console.log(`[lws-nbest]   path ${i} (cost=${p.cost}): tokens=[${tokStr}]`);
          }
        }
        return paths;
      }
    }
    // Defensive fallback: older WASM bundle without tokenize_nbest.
    console.warn('[lws] mecab.tokenize_nbest unavailable, using 1-best');
    const single = mecab.tokenize(surface);
    return [{ tokens: single.map(normalizeToken), cost: 0 }];
  } catch (err) {
    console.warn('[learnwithsoju] mecab unavailable, falling back:', err);
    return [];
  }
}

async function handleLookup(surface) {
  const cached = await cache.get(surface);
  if (cached) return cached;

  const [paths] = await Promise.all([tokenizeSurfaceNbest(surface), ensureSettings()]);
  // 1-best path's tokens are what the popup's decomposition row renders;
  // n-best feeds candidate generation only.
  const tokens = paths.length > 0 ? paths[0].tokens : null;
  const candidates = lemmaCandidatesFromNbest(paths, surface);
  const krKeyVal = krKey;
  const odKeyVal = odKey;

  if (!krKeyVal) return { surface, lemma: candidates[0], tokens, error: 'NO_API_KEY' };

  // Fire up to 4 parallel KRDict queries: the top candidates from the
  // lemma chain. We do more than 2 so multi-noun compounds (파티원들 →
  // 파티 + 원, 한국말 → 한국 + 말) can show every constituent as a
  // primary tab. For verb compounds we still fire ≤4 queries but only
  // promote the first to primary (see `multiPrimary` flag below).
  let krXmls = [];
  let queriesUsed = [];
  const parallelQueue = pickTopNDistinct(candidates, 4);
  if (LWS_NBEST_DIAG) {
    console.log(`[lws-nbest] top-4 queried in parallel: [${parallelQueue.join(', ')}]`);
    const seqFallback = candidates.filter((c) => !parallelQueue.includes(c));
    if (seqFallback.length > 0) {
      console.log(`[lws-nbest] sequential fallback list (if parallel empty): [${seqFallback.join(', ')}]`);
    }
  }
  try {
    const responses = await Promise.all(
      parallelQueue.map((q) => fetchKrdictCached(q, krKeyVal).catch(() => null)),
    );
    for (let i = 0; i < parallelQueue.length; i++) {
      const xml = responses[i];
      if (LWS_NBEST_DIAG) {
        const entryCount = xml ? (xml.match(/<item>/g) || []).length : 0;
        console.log(`[lws-nbest] krdict query="${parallelQueue[i]}" → ${xml ? entryCount : 0} entries${xml ? '' : ' (null/error)'}`);
      }
      if (!xml || looksEmpty(xml)) continue;
      krXmls.push(xml);
      queriesUsed.push(parallelQueue[i]);
    }

    // If every parallel query came back empty, fall through to remaining
    // candidates sequentially (older path) — covers obscure inflected
    // forms whose constituents we didn't include in the top-4.
    if (queriesUsed.length === 0) {
      for (const q of candidates) {
        if (parallelQueue.includes(q)) continue;
        const xml = await fetchKrdictCached(q, krKeyVal);
        if (LWS_NBEST_DIAG) {
          const entryCount = xml ? (xml.match(/<item>/g) || []).length : 0;
          console.log(`[lws-nbest] krdict query="${q}" (seq fallback) → ${entryCount} entries`);
        }
        if (!looksEmpty(xml)) {
          krXmls.push(xml);
          queriesUsed.push(q);
          break;
        }
      }
    }
  } catch (err) {
    return {
      surface,
      lemma: candidates[0],
      tokens,
      error: 'FETCH_FAILED',
      message: String(err && err.message || err),
    };
  }

  // Multi-primary promotion: when the lemmatizer's surface-first rule
  // fires (which only happens for pure-noun compounds — see lemmatizer.js
  // for the COMPOUND_NOUN_TAGS check), every constituent we queried is
  // an equal primary. For verb compounds (예약해야, 한잔해, etc.) the
  // lemma is THE answer and constituents are related.
  const multiPrimary = candidates.length > 0 && candidates[0] === surface;

  // Backward-compat: keep the singular fields populated so older cached
  // payloads or other readers don't break.
  const krXml = krXmls[0] || null;
  const krXmlExtra = krXmls[1] || null;
  const queryUsed = queriesUsed[0] || null;
  const queryUsedExtra = queriesUsed[1] || null;

  let odXml = null;
  if (odKeyVal && (queryUsed === null || looksEmpty(krXml))) {
    try {
      for (const q of candidates) {
        const xml = await fetchOpendictCached(q, odKeyVal);
        if (!looksEmpty(xml)) {
          odXml = xml;
          if (queryUsed === null) queryUsed = q;
          break;
        }
      }
    } catch {
      // OpenDict failures are non-fatal; we still return the KRDict result.
    }
  }

  const result = {
    surface,
    lemma: queryUsed || candidates[0],
    queryUsed: queryUsed || null,
    queryUsedExtra: queryUsedExtra || null,
    queriesUsed,
    // Full ordered candidate list from the lemmatizer (not just the
    // subset that got non-empty KRDict results). Useful for the
    // popup's lookup-debug panel — shows every interpretation we
    // considered, in priority order.
    candidates,
    multiPrimary,
    tokens,
    krXml,
    krXmlExtra: krXmlExtra || null,
    krXmls,
    odXml,
    cachedAt: Date.now(),
  };
  if (LWS_NBEST_DIAG) {
    console.log(`[lws-nbest] final: lemma=${result.lemma} queriesUsed=[${queriesUsed.join(', ')}] entryCount=${krXmls.length}`);
  }
  await cache.set(surface, result);
  return result;
}

function pickTopNDistinct(candidates, n) {
  const out = [];
  for (const c of candidates) {
    if (!c || out.includes(c)) continue;
    out.push(c);
    if (out.length === n) break;
  }
  return out;
}

async function handleHanjaLookup(chars) {
  // `chars` is the concatenated Hanja string from one origin field (e.g. "豫約").
  // hangulhanja.com's /api/search accepts the whole string at once and returns
  // per-character glosses in one response.
  const key = String(chars || '').trim();
  if (!key) return { chars: '', hanjas: [] };
  const cached = await hanjaCache.get(key);
  if (cached) return cached;
  const url = `${HANJA_API}?q=${encodeURIComponent(key)}&mode=hanzi&locale=en`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      // 429s and 5xxs: return an error sentinel without caching, so a later
      // hover for the same chars gets a fresh chance.
      return { chars: key, error: 'FETCH_FAILED', status: res.status };
    }
    const data = await res.json();
    const hanjas = Array.isArray(data && data.hanjas)
      ? data.hanjas.map((h) => ({
          character: h.character || '',
          sino: h.sino || '',
          summary: h.summaryText || '',
        })).filter((h) => h.character)
      : [];
    const result = { chars: key, hanjas, cachedAt: Date.now() };
    await hanjaCache.set(key, result);
    return result;
  } catch (err) {
    return {
      chars: key,
      error: 'FETCH_FAILED',
      message: String(err && err.message || err),
    };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'lookup' && typeof msg.surface === 'string') {
    handleLookup(msg.surface)
      .then(sendResponse)
      .catch((err) => sendResponse({
        surface: msg.surface,
        error: 'INTERNAL',
        message: String(err && err.message || err),
      }));
    return true;
  }
  if (msg && msg.type === 'lookupHanja' && typeof msg.chars === 'string') {
    handleHanjaLookup(msg.chars)
      .then(sendResponse)
      .catch((err) => sendResponse({
        chars: msg.chars,
        error: 'INTERNAL',
        message: String(err && err.message || err),
      }));
    return true;
  }
  if (msg && msg.type === 'ping') {
    sendResponse({ ok: true });
    return false;
  }
  if (msg && msg.type === 'warmup') {
    ensureMecab().catch((err) => console.warn('[lws] warmup mecab failed:', err));
    ensureSettings();
    sendResponse({ ok: true });
    return false;
  }
  if (msg && msg.type === 'openOptions') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }
  if (msg && msg.type === 'clearCache') {
    Promise.all([cache.clear(), hanjaCache.clear(), krdictCache.clear(), opendictCache.clear()])
      .then(() => { console.log('[lws] dict cache cleared'); sendResponse({ ok: true }); })
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true;
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }
  ensureMecab().catch((err) => console.warn('[lws] onInstalled warmup failed:', err));
});

chrome.runtime.onStartup.addListener(() => {
  ensureMecab().catch((err) => console.warn('[lws] onStartup warmup failed:', err));
});

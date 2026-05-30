import { lemmaCandidatesFromNbest } from './core/lemmatizer.js';
import { buildKrdictUrl, buildOpendictUrl, looksEmpty, extractItemWords, pickTabsAndUnrelated } from './core/api.js';
import { createCache, chromeStorageAdapter } from './core/cache.js';
import init, { Mecab } from './vendor/mecab-ko/mecab_ko_wasm.js';

const LWS_NBEST_DIAG = true;

const STORAGE_KEYS = {
  KRDICT_KEY: 'krdictApiKey',
  OPENDICT_KEY: 'opendictApiKey',
};

const MECAB_VENDOR = 'vendor/mecab-ko/';
const MECAB_FILES = ['sys.dic.gz', 'matrix.bin.gz', 'entries.bin.gz'];
const MECAB_WASM = 'mecab_ko_wasm_bg.wasm';
const NBEST_N = 5;
const KRDICT_PARALLEL_CAP = 5;

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

function synthesizeProperNounEntry(surface, tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) return [];
  const nnpToken = tokens.find((t) => {
    const tag = (t.pos || '').split('+')[0];
    return tag === 'NNP';
  });
  if (!nnpToken) return [];
  const word = surface;
  console.log(`[lws] synthesizing proper-noun entry for surface="${surface}" (NNP token="${nnpToken.surface}")`);
  return [{
    word,
    sections: [{
      source: 'synthetic-nnp',
      word,
      pos: '고유명사',
      definition: `${word} — Proper noun (name of a person, place, or thing). No dictionary entry found.`,
      pronunciation: word,
      isSynthetic: true,
    }],
  }];
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

  // Top-5 parallel KRDict queries. Each query's full result list — every
  // <item> in order — is preserved so the grouping algorithm below can
  // walk them per query and bucket entries by their `word` field.
  const parallelQueue = pickTopNDistinct(candidates, KRDICT_PARALLEL_CAP);
  if (LWS_NBEST_DIAG) {
    console.log(`[lws-nbest] top-${KRDICT_PARALLEL_CAP} queried in parallel: [${parallelQueue.join(', ')}]`);
  }

  const krXmls = new Array(parallelQueue.length).fill(null);
  let krFetchError = null;
  try {
    const responses = await Promise.all(
      parallelQueue.map((q) => fetchKrdictCached(q, krKeyVal).catch(() => null)),
    );
    for (let i = 0; i < parallelQueue.length; i++) {
      const xml = responses[i];
      if (LWS_NBEST_DIAG) {
        const entryCount = xml ? (xml.match(/<item\b/g) || []).length : 0;
        console.log(`[lws-nbest] krdict query="${parallelQueue[i]}" → ${xml ? entryCount : 0} entries${xml ? '' : ' (null/error)'}`);
      }
      if (xml && !looksEmpty(xml)) krXmls[i] = xml;
    }
  } catch (err) {
    krFetchError = err;
  }
  if (krFetchError) {
    return {
      surface,
      lemma: candidates[0],
      tokens,
      error: 'FETCH_FAILED',
      message: String(krFetchError && krFetchError.message || krFetchError),
    };
  }

  const krAllEmpty = krXmls.every((x) => x === null);

  // OpenDict fallback fires only when every KRDict query returned nothing.
  let odXml = null;
  let odQuery = null;
  if (krAllEmpty && odKeyVal) {
    try {
      for (const q of candidates) {
        const xml = await fetchOpendictCached(q, odKeyVal);
        if (!looksEmpty(xml)) {
          odXml = xml;
          odQuery = q;
          break;
        }
      }
    } catch (err) {
      console.warn('[lws] opendict fallback failed (non-fatal):', err);
    }
  }

  // Per-query item words for grouping. KR queries align by parallelQueue
  // index; OpenDict (when present) collapses into a single "query" whose
  // sections all reference odXml.
  const krWordsPerQuery = krXmls.map((xml) => extractItemWords(xml));
  const odWords = odXml ? extractItemWords(odXml) : [];
  const { tabs, unrelated } = pickTabsAndUnrelated({
    krQueries: parallelQueue,
    krWordsPerQuery,
    odQuery,
    odWords,
  });

  // queriesUsed retained for diagnostics and the popup's lemma chip — the
  // first KR query that produced a non-empty result (or the OD query when
  // KR was empty).
  const queriesUsed = [];
  for (let i = 0; i < parallelQueue.length; i++) {
    if (krWordsPerQuery[i].length > 0) queriesUsed.push(parallelQueue[i]);
  }
  if (queriesUsed.length === 0 && odQuery) queriesUsed.push(odQuery);
  const queryUsed = queriesUsed[0] || null;

  const allEmpty = tabs.length === 0 && unrelated.length === 0;
  const syntheticTabs = allEmpty ? synthesizeProperNounEntry(surface, tokens) : [];

  const result = {
    surface,
    lemma: queryUsed || candidates[0],
    queryUsed,
    queriesUsed,
    candidates,
    tokens,
    krQueries: parallelQueue,
    krXmls,
    odXml,
    odQuery,
    tabs: syntheticTabs.length > 0 ? syntheticTabs : tabs,
    unrelated,
    cachedAt: Date.now(),
  };
  if (LWS_NBEST_DIAG) {
    const tabLabels = tabs.map((t) => `${t.word}(${t.sections.length})`).join(', ');
    const unrelLabels = unrelated.map((u) => u.word).join(', ');
    console.log(`[lws-nbest] grouped: tabs=[${tabLabels}] unrelated=[${unrelLabels}]`);
  }
  await cache.set(surface, result);
  return result;
}

function serializeToken(t) {
  const feats = (t.features || '').split(',');
  return {
    surface: t.surface,
    pos: t.pos,
    features: t.features,
    type: feats[4] || '',
    firstPos: feats[5] || '',
    lastPos: feats[6] || '',
    decomp: feats[7] || '',
    reading: t.reading || '',
    start: t.start,
    end: t.end,
  };
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
    (async () => {
      try {
        const target = msg.target || 'all';
        const cleared = {};
        if (target === 'lookup' || target === 'all') { await cache.clear(); cleared.lookup = true; }
        if (target === 'hanja' || target === 'all') { await hanjaCache.clear(); cleared.hanja = true; }
        if (target === 'dict' || target === 'all') {
          await krdictCache.clear();
          await opendictCache.clear();
          cleared.dict = true;
        }
        console.log('[lws] cache cleared', cleared);
        sendResponse({ ok: true, cleared });
      } catch (err) {
        console.warn('[lws] clearCache failed:', err);
        sendResponse({ ok: false, error: String(err && err.message || err) });
      }
    })();
    return true;
  }
  if (msg && msg.type === 'cacheCounts') {
    (async () => {
      try {
        const [lookupN, hanjaN, krN, odN] = await Promise.all([
          cache.count(), hanjaCache.count(), krdictCache.count(), opendictCache.count(),
        ]);
        sendResponse({ ok: true, counts: { lookup: lookupN, hanja: hanjaN, krdict: krN, opendict: odN } });
      } catch (err) {
        console.warn('[lws] cacheCounts failed:', err);
        sendResponse({ ok: false, error: err && err.message });
      }
    })();
    return true;
  }
  if (msg && msg.type === 'mecab-inspect') {
    (async () => {
      try {
        const text = String(msg.text || '').trim();
        if (!text) { sendResponse({ singlePath: [], nbestPaths: [], candidates: [] }); return; }
        await ensureMecab();
        const mecab = mecabInstance;
        const singlePath = mecab.tokenize(text).map(serializeToken);
        const nbestRaw = mecab.tokenize_nbest(text, Number(msg.nbest) || 5);
        const nbestPaths = Array.isArray(nbestRaw)
          ? nbestRaw.map((p) => ({ cost: p.cost, tokens: (p.tokens || []).map(serializeToken) }))
          : [];
        const candidates = lemmaCandidatesFromNbest(nbestPaths, text);
        sendResponse({ singlePath, nbestPaths, candidates });
      } catch (err) {
        console.warn('[lws] mecab-inspect failed:', err);
        sendResponse({ error: err && err.message || String(err) });
      }
    })();
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

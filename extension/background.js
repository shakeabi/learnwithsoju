import { lemmaCandidates } from './lemmatizer.js';
import { buildKrdictUrl, buildOpendictUrl, looksEmpty } from './api.js';
import { createCache, chromeStorageAdapter } from './cache.js';
import init, { Mecab } from './vendor/mecab-ko/mecab_ko_wasm.js';

const STORAGE_KEYS = {
  KRDICT_KEY: 'krdictApiKey',
  OPENDICT_KEY: 'opendictApiKey',
  ENABLED: 'enabled',
};

const MECAB_VENDOR = 'vendor/mecab-ko/';
const MECAB_FILES = ['sys.dic.gz', 'matrix.bin.gz', 'entries.bin.gz'];
const MECAB_WASM = 'mecab_ko_wasm_bg.wasm';

const cache = createCache(chromeStorageAdapter(chrome.storage.local));

let mecabInstance = null;
let mecabReadyPromise = null;

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

async function lemmasFor(surface) {
  // Best-effort: if mecab fails to init or tokenize, fall back to surface-only.
  // The extension still works, just with weaker lemma resolution.
  try {
    const mecab = await ensureMecab();
    const tokens = mecab.tokenize(surface);
    return lemmaCandidates(tokens, surface);
  } catch (err) {
    console.warn('[learnwithsoju] mecab unavailable, falling back:', err);
    return [surface];
  }
}

async function handleLookup(surface) {
  const cached = await cache.get(surface);
  if (cached) return cached;

  const candidates = await lemmasFor(surface);

  const settings = await chrome.storage.sync.get([STORAGE_KEYS.KRDICT_KEY, STORAGE_KEYS.OPENDICT_KEY]);
  const krKey = settings[STORAGE_KEYS.KRDICT_KEY];
  const odKey = settings[STORAGE_KEYS.OPENDICT_KEY];

  if (!krKey) return { surface, lemma: candidates[0], error: 'NO_API_KEY' };

  let krXml = null;
  let queryUsed = null;
  try {
    for (const q of candidates) {
      const xml = await fetchXml(buildKrdictUrl(q, krKey));
      if (!looksEmpty(xml)) {
        krXml = xml;
        queryUsed = q;
        break;
      }
      if (krXml === null) krXml = xml;
    }
  } catch (err) {
    return {
      surface,
      lemma: candidates[0],
      error: 'FETCH_FAILED',
      message: String(err && err.message || err),
    };
  }

  let odXml = null;
  if (odKey && (queryUsed === null || looksEmpty(krXml))) {
    try {
      for (const q of candidates) {
        const xml = await fetchXml(buildOpendictUrl(q, odKey));
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
    krXml,
    odXml,
    cachedAt: Date.now(),
  };
  await cache.set(surface, result);
  return result;
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
  if (msg && msg.type === 'ping') {
    sendResponse({ ok: true });
    return false;
  }
  if (msg && msg.type === 'openOptions') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }
  if (msg && msg.type === 'clearCache') {
    cache.clear()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true;
  }
});

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.sync.set({ [STORAGE_KEYS.ENABLED]: true });
    chrome.runtime.openOptionsPage();
  }
});

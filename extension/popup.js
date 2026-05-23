const KRDICT_KEY = 'krdictApiKey';
// Per-site disable lives in chrome.storage.local — sync is throttled
// (write-quota, eventual-consistency w/ the cloud) and was dropping
// per-site writes. Local is per-device, which matches the semantics:
// "for this browser, on this site, leave me alone."
const DISABLED_HOSTS_KEY = 'disabledHosts';

const siteRow = document.getElementById('site-row');
const siteToggle = document.getElementById('site-toggle');
const siteHostEl = document.getElementById('site-host');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const openOptionsBtn = document.getElementById('open-options');
const adapterSection = document.getElementById('site-adapter-section');

let currentHost = '';

async function load() {
  const data = await chrome.storage.sync.get(KRDICT_KEY);
  if (!data[KRDICT_KEY]) {
    statusDot.className = 'dot warn';
    statusText.textContent = 'API key not set';
  } else {
    statusDot.className = 'dot ok';
    statusText.textContent = 'Active';
  }
}

function applyToggleFromList(list) {
  const arr = Array.isArray(list) ? list : [];
  siteToggle.checked = !arr.includes(currentHost);
}

// Resolve the active tab's hostname. Tries tab.url first (works when
// activeTab grant is in effect); falls back to messaging the content
// script (which always knows its own location.hostname). Returns
// { host, protocol } or null if both sources fail (e.g. chrome:// page
// with no content script).
async function resolveActiveSite() {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (err) {
    console.log('[lws] popup resolveActiveSite: tabs.query failed', err);
    return null;
  }
  if (!tab) {
    console.log('[lws] popup resolveActiveSite: no active tab');
    return null;
  }
  if (tab.url) {
    try {
      const u = new URL(tab.url);
      return { tab, host: u.hostname.toLowerCase(), protocol: u.protocol, href: tab.url };
    } catch { /* fall through */ }
  }
  // Fallback: ask the content script directly.
  try {
    const reply = await chrome.tabs.sendMessage(tab.id, { type: 'lws-site-info' });
    if (reply && reply.host) {
      return {
        tab,
        host: String(reply.host).toLowerCase(),
        protocol: reply.protocol || 'https:',
        href: reply.href || '',
      };
    }
  } catch (err) {
    console.log('[lws] popup resolveActiveSite: content-script fallback failed', err);
  }
  return null;
}

async function loadSiteSection() {
  const site = await resolveActiveSite();
  if (!site) return;
  if (site.protocol !== 'http:' && site.protocol !== 'https:') {
    console.log('[lws] popup loadSiteSection: non-http(s) protocol', site.protocol);
    return;
  }
  currentHost = site.host;
  if (!currentHost) return;
  siteHostEl.textContent = currentHost;
  const data = await chrome.storage.local.get(DISABLED_HOSTS_KEY);
  applyToggleFromList(data[DISABLED_HOSTS_KEY]);
  siteRow.hidden = false;
  console.log('[lws] popup loadSiteSection', { host: currentHost, list: data[DISABLED_HOSTS_KEY], checked: siteToggle.checked });
}

siteToggle.addEventListener('change', async () => {
  if (!currentHost) return;
  const wantsEnabled = siteToggle.checked;
  const data = await chrome.storage.local.get(DISABLED_HOSTS_KEY);
  const list = Array.isArray(data[DISABLED_HOSTS_KEY]) ? data[DISABLED_HOSTS_KEY] : [];
  const set = new Set(list);
  if (wantsEnabled) set.delete(currentHost);
  else set.add(currentHost);
  const next = Array.from(set).sort();
  await chrome.storage.local.set({ [DISABLED_HOSTS_KEY]: next });
  console.log('[lws] popup wrote disabledHosts', { host: currentHost, wantsEnabled, next });
});

// Keep the toggle in sync if anything else changes disabledHosts while
// the popup is open (rare, but defensive).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (!(DISABLED_HOSTS_KEY in changes)) return;
  if (!currentHost) return;
  applyToggleFromList(changes[DISABLED_HOSTS_KEY].newValue);
});

// Generic per-site popup section. Looks up the SITE_CONFIGS entry for the
// active tab's hostname; if it declares a `popupModule`, dynamic-imports
// that module and hands it the section container. The module owns all DOM
// inside the container and toggles its visibility. Adding Netflix / Viki
// is a new SITE_CONFIGS entry + its own *-popup.js — no edits here.
async function loadAdapterSection() {
  const site = await resolveActiveSite();
  if (!site) return;
  if (site.protocol !== 'http:' && site.protocol !== 'https:') return;
  let findSiteConfig;
  try {
    ({ findSiteConfig } = await import('./site-configs.js'));
  } catch {
    return;
  }
  const cfg = findSiteConfig(site.host);
  if (!cfg || !cfg.popupModule) return;
  let mod;
  try {
    mod = await import(`./${cfg.popupModule}`);
  } catch {
    return;
  }
  if (!mod || typeof mod.renderSection !== 'function') return;
  try {
    await mod.renderSection({ tab: site.tab, href: site.href, container: adapterSection });
  } catch (err) {
    console.warn('[learnwithsoju] popupModule failed:', err);
  }
}

openOptionsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

// Lookup box. Lets the user paste a Korean word and see what the
// dictionary returns — useful when there's no hoverable context (notes
// app, a word a friend texted) and as a debug tool for diagnosing
// "wrong lemma" issues (renders the mecab tokens + lemma candidates
// the background chose, so we can see what mecab and the lemmatizer
// did without needing service-worker DevTools).
const lookupForm = document.getElementById('lookup-form');
const lookupInput = document.getElementById('lookup-input');
const lookupResult = document.getElementById('lookup-result');

if (lookupForm) {
  lookupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const word = lookupInput.value.trim();
    if (!word) return;
    await runLookup(word);
  });
}

async function runLookup(word) {
  lookupResult.hidden = false;
  lookupResult.textContent = 'Looking up…';
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: 'lookup', surface: word });
  } catch (err) {
    lookupResult.textContent = `Error: ${err && err.message || err}`;
    return;
  }
  await renderLookupResult(word, res);
}

async function renderLookupResult(word, res) {
  lookupResult.innerHTML = '';
  if (!res) {
    lookupResult.textContent = 'No response from the background script.';
    return;
  }
  if (res.error === 'NO_API_KEY') {
    lookupResult.textContent = 'No KRDict API key set. Open settings to add one.';
    return;
  }
  if (res.error) {
    lookupResult.textContent = `Error: ${res.error}${res.message ? ' — ' + res.message : ''}`;
    return;
  }

  // Parse the KRDict XML for the first/headline entry. We do this in
  // the popup directly (rather than asking the background for parsed
  // entries) so we stay decoupled from the in-page popup's rendering
  // pipeline — that one needs full sense/tab/Hanja machinery we don't
  // want to drag in here. A single headword + first translation is
  // enough for "what does this word mean".
  let parsers;
  try {
    parsers = await import('./parsers.js');
  } catch (err) {
    lookupResult.textContent = `Parser load failed: ${err && err.message || err}`;
    return;
  }
  const entries = (res.krXml && parsers.parseKrdictXml(res.krXml, window.DOMParser)) || [];
  const headEntry = entries.find((e) => e.word === res.queryUsed) || entries[0] || null;

  // Headline: queryUsed (the lemma the dictionary actually resolved) +
  // the surface the user typed, so they can see how mecab → lemma went.
  const headline = document.createElement('div');
  headline.className = 'lookup-headline';
  const lemma = document.createElement('span');
  lemma.className = 'lookup-lemma';
  lemma.textContent = res.queryUsed || res.lemma || word;
  headline.appendChild(lemma);
  if (res.queryUsed && res.queryUsed !== word) {
    const arrow = document.createElement('span');
    arrow.className = 'lookup-from';
    arrow.textContent = `from ${word}`;
    headline.appendChild(arrow);
  }
  lookupResult.appendChild(headline);

  if (headEntry) {
    if (headEntry.pos) {
      const pos = document.createElement('div');
      pos.className = 'lookup-pos';
      pos.textContent = headEntry.pos;
      lookupResult.appendChild(pos);
    }
    const firstSense = headEntry.senses && headEntry.senses[0];
    if (firstSense) {
      const tr = firstSense.translations && firstSense.translations[0];
      if (tr && (tr.trans_word || tr.trans_dfn)) {
        const meaning = document.createElement('div');
        meaning.className = 'lookup-meaning';
        if (tr.trans_word) {
          const tw = document.createElement('div');
          tw.className = 'lookup-trans-word';
          tw.textContent = tr.trans_word;
          meaning.appendChild(tw);
        }
        if (tr.trans_dfn) {
          const td = document.createElement('div');
          td.className = 'lookup-trans-dfn';
          td.textContent = tr.trans_dfn;
          meaning.appendChild(td);
        }
        lookupResult.appendChild(meaning);
      } else if (firstSense.definition) {
        const def = document.createElement('div');
        def.className = 'lookup-trans-dfn';
        def.textContent = firstSense.definition;
        lookupResult.appendChild(def);
      }
    }
  } else {
    const empty = document.createElement('div');
    empty.className = 'lookup-trans-dfn';
    empty.textContent = 'No dictionary entry found.';
    lookupResult.appendChild(empty);
  }

  // Debug section: mecab tokens + candidates the lemmatizer produced.
  // The whole reason for adding this lookup feature was to be able to
  // see exactly what mecab and the lemmatizer did when a hover returns
  // a surprising result. Hidden behind a <details> so it doesn't add
  // noise for the lookup-as-translation use case.
  const debug = document.createElement('details');
  debug.className = 'lookup-debug';
  const summary = document.createElement('summary');
  summary.textContent = 'Debug';
  debug.appendChild(summary);
  const tokensLine = document.createElement('div');
  tokensLine.className = 'lookup-debug-line';
  tokensLine.innerHTML = '<b>tokens:</b> ' + (
    Array.isArray(res.tokens) && res.tokens.length
      ? res.tokens.map((t) => `${escapeHtml(t.surface)}/${escapeHtml(t.pos || '?')}`).join(' + ')
      : '(none)'
  );
  debug.appendChild(tokensLine);
  // Full lemmatizer output (every candidate, in priority order).
  // `queriesUsed` is the subset that returned non-empty KRDict results,
  // which is what actually drove the displayed lemma. Showing both
  // tells you (a) what we tried and (b) which ones the dictionary had.
  const candsLine = document.createElement('div');
  candsLine.className = 'lookup-debug-line';
  candsLine.innerHTML = '<b>candidates:</b> ' + (
    Array.isArray(res.candidates) && res.candidates.length
      ? res.candidates.map(escapeHtml).join(', ')
      : '(none)'
  );
  debug.appendChild(candsLine);
  const hitsLine = document.createElement('div');
  hitsLine.className = 'lookup-debug-line';
  hitsLine.innerHTML = '<b>got hits for:</b> ' + (
    Array.isArray(res.queriesUsed) && res.queriesUsed.length
      ? res.queriesUsed.map(escapeHtml).join(', ')
      : '(none)'
  );
  debug.appendChild(hitsLine);
  lookupResult.appendChild(debug);
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

load();
loadSiteSection();
loadAdapterSection();

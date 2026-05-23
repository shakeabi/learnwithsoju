/**
 * Netflix dual-subs adapter — Phase 2.1 (caption-capture
 * instrumentation).
 *
 * This commit lays the foundation: the page-world hook is injected,
 * SPA navigations are handled, and captured caption data is logged
 * to the console. The actual overlay / dual-line rendering / track
 * picking lands in subsequent commits, once we see real captures in
 * your DevTools and know exactly which URLs to filter on and which
 * format(s) to parse.
 *
 * Structure intentionally mirrors `youtube-adapter.js` so the
 * Phase 2.2+ additions (parser, pickPrimarySource, mount overlay,
 * time-sync) slot in without restructuring:
 *
 *   - setup({unwrap, rescan})                       ← entry point
 *   - SPA-nav via URL polling (Netflix doesn't fire equivalents to
 *     yt-navigate-finish in a way that's stable across regions)
 *   - generation-token guarded activate/deactivate
 *   - host unwrap/rescan callbacks for `.lws-word` spans around nav
 *   - injectHookOnce() — append `<script src=…netflix-page-hook.js>`
 *
 * `isEnabled()` honors the same `disabledHosts` (chrome.storage.local)
 * key the per-site toggle and the YouTube adapter use; there's no
 * Netflix-specific setting yet (we may add `dualSubsNetflix` once
 * the overlay actually ships and there's a reason to let users
 * disable it without disabling the whole extension on netflix.com).
 */

const HOOK_PATH = 'netflix-page-hook.js';
const DISABLED_HOSTS_KEY = 'disabledHosts';
const DEFAULT_SECONDARY_KEY = 'secondaryLang';
const OVERLAY_CLASS = 'lws-nxsubs-overlay';
const NX_HIDE_STYLE_ID = 'lws-hide-nx-captions';

let teardownFn = null;
let hookInjected = false;
// Bumped on every activate() and deactivate(). activate() rechecks
// its myGen after each await; if it no longer equals activeGeneration
// we discard our own work (see youtube-adapter for the full
// rationale — same race fix).
let activeGeneration = 0;
// Adapter ↔ content-script bridge. Same contract as YouTube's
// adapter: callbacks passed in via setup({unwrap, rescan}), invoked
// around nav so content.js's `.lws-word` wrapping doesn't snag on
// Netflix's reused title / metadata containers.
let hostUnwrap = () => {};
let hostRescan = () => {};

// Per-session subtitle tracks, keyed by normalized language code
// ('ko', 'en', 'ja', …). Each value is `{ lines: [{start,end,text}],
// captionedness: 'cc' | 'plain', sourceUrl }`. Netflix only fetches
// one track at a time (whichever the user selected in CC menu); we
// accumulate as the user navigates between languages. mountOverlay()
// is called after every new track so the visible overlay re-renders
// with whatever's available now.
let tracksByLang = new Map();
let overlayState = null; // { overlayEl, styleEl, update, video, listeners }

function log(...args) {
  console.log('[learnwithsoju/netflix]', ...args);
}

export async function setup(api = {}) {
  if (typeof api.unwrap === 'function') hostUnwrap = api.unwrap;
  if (typeof api.rescan === 'function') hostRescan = api.rescan;

  // Page-world subtitle captures arrive here. Parse, cache per
  // language, re-render the overlay if it should now show a new
  // track / be promoted from KO-only to dual-line.
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__lwsNxCaption !== true) return;
    onCaptureBody(d.url, d.body);
  });

  // Per-site toggle change → reactivate. Mirrors YouTube; same
  // chrome.storage.local key.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[DISABLED_HOSTS_KEY]) {
      handleNavStart();
      handleNavFinish();
    }
  });

  // SPA navigation: Netflix's in-app navigation reuses the page
  // (no full reload) but doesn't fire a well-known event we can
  // listen for reliably. URL polling is the universal signal —
  // same fallback YouTube uses. Activate / deactivate run on URL
  // change so each new title gets a clean session.
  let lastHref = window.location.href;
  setInterval(() => {
    if (window.location.href === lastHref) return;
    lastHref = window.location.href;
    handleNavStart();
    handleNavFinish();
  }, 1000);

  await injectHookOnce();
  await activate();
}

function handleNavStart() {
  deactivate();
  try { hostUnwrap(); } catch {}
}

function handleNavFinish() {
  // Wait for Netflix's new DOM to settle before reactivating.
  // 500 ms (vs YouTube's 250) because Netflix's title-change flow
  // takes longer to commit player state.
  setTimeout(() => {
    void activate();
    try { hostRescan(); } catch {}
  }, 500);
}

async function activate() {
  const myGen = ++activeGeneration;
  if (teardownFn) {
    try { teardownFn(); } catch {}
    teardownFn = null;
  }
  if (!isWatchPage()) {
    log('activate skipped: not a /watch URL (pathname:', window.location.pathname, ')');
    return;
  }
  try {
    const enabled = await isEnabled();
    if (myGen !== activeGeneration) return;
    if (!enabled) {
      log('activate skipped: disabled on this host');
      return;
    }
    log('activating for', window.location.href);
    tracksByLang = new Map();

    // Install a teardown that tears down any mounted overlay; the
    // overlay itself gets mounted (later) inside onCaptureBody once
    // we have at least a Korean track. activate() doesn't block on
    // captures arriving — they come asynchronously as Netflix loads
    // the user's chosen subtitle track.
    teardownFn = () => {
      teardownOverlay();
      tracksByLang = new Map();
      log('session over');
    };
  } catch (err) {
    console.warn('[learnwithsoju/netflix] activate failed:', err);
  }
}

function deactivate() {
  ++activeGeneration;
  if (teardownFn) {
    try { teardownFn(); } catch (err) {
      console.warn('[learnwithsoju/netflix] teardown threw:', err);
    }
    teardownFn = null;
  }
}

function isWatchPage() {
  // Netflix uses /watch/<titleId> (sometimes with country prefix
  // like /us-en/watch/<titleId>; the bare /watch/ segment is the
  // reliable marker).
  return /(^|\/)watch(\/|$)/.test(window.location.pathname);
}

async function isEnabled() {
  const data = await chrome.storage.local.get(DISABLED_HOSTS_KEY);
  const list = Array.isArray(data[DISABLED_HOSTS_KEY]) ? data[DISABLED_HOSTS_KEY] : [];
  const host = (window.location && window.location.hostname || '').toLowerCase();
  return !(host && list.includes(host));
}

function injectHookOnce() {
  return new Promise((resolve) => {
    if (hookInjected) return resolve();
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(HOOK_PATH);
    script.onload = () => {
      script.remove();
      hookInjected = true;
      log('page hook installed');
      resolve();
    };
    script.onerror = (err) => {
      console.warn('[learnwithsoju/netflix] hook injection failed:', err);
      resolve();
    };
    (document.head || document.documentElement).appendChild(script);
  });
}

// ---------------------------------------------------------------------
// Caption ingestion: parse → cache → re-render
// ---------------------------------------------------------------------

function onCaptureBody(url, body) {
  if (typeof body !== 'string' || !body) return;
  let parsed;
  try {
    parsed = parseTtml(body);
  } catch (err) {
    log('TTML parse failed for', url, err && err.message);
    return;
  }
  if (!parsed || !parsed.lang || !parsed.lines.length) {
    log('skipped capture (no lang or zero lines):', url);
    return;
  }
  const lang = normalizeLang(parsed.lang);
  // CC variant detection — heuristic: a notable fraction of lines
  // contain bracketed annotations (e.g. [음악], [잡음], [웃음]) only
  // present in closed-caption tracks. If we later see the SAME
  // language as plain and as CC, prefer the CC version.
  const ccScore = parsed.lines.filter((ln) => /[\[(][^\])]{1,30}[\])]/.test(ln.text)).length;
  const captionedness = (ccScore >= 3 && (ccScore / parsed.lines.length) > 0.03) ? 'cc' : 'plain';
  const existing = tracksByLang.get(lang);
  // Prefer CC over plain when we see both for the same language.
  // If we already had CC and a plain version arrives, keep the CC.
  if (existing && existing.captionedness === 'cc' && captionedness === 'plain') {
    log(`got track: lang=${lang} variant=${captionedness} lines=${parsed.lines.length} — keeping prior CC variant`);
    return;
  }
  tracksByLang.set(lang, { lines: parsed.lines, captionedness, sourceUrl: url });
  log(`got track: lang=${lang} variant=${captionedness} lines=${parsed.lines.length}` + (existing ? ` (replacing ${existing.captionedness})` : ''));
  void rebuildOverlay();
}

// ---------------------------------------------------------------------
// TTML parser
// ---------------------------------------------------------------------

/**
 * Parse a Netflix TTML body. Returns
 *   `{ lang, lines: [{ start, end, text }] }` (`start`/`end` in seconds)
 * or null on hopeless input. We use the native DOMParser — Netflix's
 * TTML is well-formed XML.
 */
function parseTtml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (!doc) return null;
  if (doc.getElementsByTagName('parsererror').length) return null;

  // <tt xml:lang="ko"> is the root. Some Netflix files namespace it
  // (`http://www.w3.org/ns/ttml`); querySelector works regardless.
  const root = doc.documentElement;
  if (!root) return null;
  const lang = root.getAttribute('xml:lang') || root.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang') || '';

  const ps = doc.getElementsByTagName('p');
  const lines = [];
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    const begin = parseTtmlTime(p.getAttribute('begin'));
    const end = parseTtmlTime(p.getAttribute('end'));
    if (begin == null || end == null || end <= begin) continue;
    const text = extractTextFromTtmlP(p);
    if (!text) continue;
    lines.push({ start: begin, end, text });
  }
  lines.sort((a, b) => a.start - b.start);
  return { lang, lines };
}

/**
 * Parse a TTML time expression to seconds. Supports:
 *   HH:MM:SS(.fraction)?   e.g. "00:00:01.500"
 *   <N>ms                  e.g. "1500ms"
 *   <N>s                   e.g. "1.5s"
 *   <N>(.fraction)?        bare seconds, e.g. "1.5"
 * Returns null on unparseable input.
 */
function parseTtmlTime(s) {
  if (!s) return null;
  s = String(s).trim();
  const clock = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(s);
  if (clock) return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  const unit = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(s);
  if (unit) {
    const n = Number(unit[1]);
    switch (unit[2]) {
      case 'ms': return n / 1000;
      case 's':  return n;
      case 'm':  return n * 60;
      case 'h':  return n * 3600;
    }
  }
  const bare = /^\d+(?:\.\d+)?$/.exec(s);
  if (bare) return Number(s);
  return null;
}

/**
 * Concatenate a `<p>` element's text content, treating `<br/>` as a
 * line break. Strips `<span>` styling but keeps the text inside.
 */
function extractTextFromTtmlP(p) {
  let out = '';
  function walk(node) {
    if (node.nodeType === 3) { // text
      out += node.nodeValue;
    } else if (node.nodeType === 1) { // element
      const tag = node.nodeName.toLowerCase();
      if (tag === 'br') {
        out += '\n';
        return;
      }
      for (let c = node.firstChild; c; c = c.nextSibling) walk(c);
    }
  }
  walk(p);
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Normalize TTML language code to our internal short form.
 *   'ko-KR' → 'ko'
 *   'zh-Hans' → 'zh'
 *   'en-US' → 'en'
 * Falls back to the input lowercased if it doesn't match the pattern.
 */
function normalizeLang(lang) {
  const lower = String(lang || '').toLowerCase();
  const m = /^([a-z]{2,3})(-[a-z]+)?$/i.exec(lower);
  return m ? m[1] : lower;
}

// ---------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------

async function rebuildOverlay() {
  // Need Korean. Without KO there's nothing to render as a primary;
  // we don't try to learn-Korean from English subtitles.
  const ko = tracksByLang.get('ko');
  if (!ko) return;

  // Need a player video to anchor / time-sync to. Wait up to ~5s
  // after captures arrive (Netflix typically has the <video> ready
  // by then, but caption fetches can race ahead on initial load).
  const video = await waitForVideoElement(5000);
  if (!video) {
    log('no <video> element after 5s — overlay not mounted');
    return;
  }

  const secondaryLang = await resolveSecondaryLang();
  const secondary = secondaryLang && secondaryLang !== 'off'
    ? tracksByLang.get(secondaryLang)
    : null;

  // Tear down any prior mount before remounting — clean state.
  teardownOverlay();

  const player = video.closest('.watch-video, .nf-player-container, [data-uia="watch-video"]') || video.parentElement;
  if (!player) {
    log('no player container ancestor for the <video> — overlay not mounted');
    return;
  }
  // Position container has to be `relative`/`absolute`/`fixed` for our
  // `position: absolute; bottom: …` overlay to anchor correctly.
  const cs = window.getComputedStyle(player);
  if (cs.position === 'static') player.style.position = 'relative';

  const overlayEl = buildOverlay();
  player.appendChild(overlayEl);
  const styleEl = hideNativeCaptions();
  const koEl = overlayEl.querySelector('.lws-nxsubs-ko');
  const enEl = overlayEl.querySelector('.lws-nxsubs-en');

  let lastKoIdx = -1;
  let lastEnIdx = -1;
  function update() {
    const t = video.currentTime;
    const koIdx = findLineIdx(ko.lines, t);
    if (koIdx !== lastKoIdx) {
      koEl.textContent = koIdx >= 0 ? ko.lines[koIdx].text : '';
      koEl.style.display = koIdx >= 0 ? '' : 'none';
      lastKoIdx = koIdx;
    }
    if (secondary) {
      const enIdx = findLineIdx(secondary.lines, t);
      if (enIdx !== lastEnIdx) {
        enEl.textContent = enIdx >= 0 ? secondary.lines[enIdx].text : '';
        enEl.style.display = enIdx >= 0 ? '' : 'none';
        lastEnIdx = enIdx;
      }
    } else {
      enEl.style.display = 'none';
    }
  }
  video.addEventListener('timeupdate', update);
  video.addEventListener('seeking', update);
  video.addEventListener('seeked', update);
  update();

  overlayState = {
    overlayEl,
    styleEl,
    video,
    listeners: [['timeupdate', update], ['seeking', update], ['seeked', update]],
  };
  log(`mounted overlay — KO (${ko.captionedness}, ${ko.lines.length} lines)` +
    (secondary ? ` + ${secondaryLang} (${secondary.captionedness}, ${secondary.lines.length} lines)` : ' (no secondary track captured yet)'));
}

function teardownOverlay() {
  if (!overlayState) return;
  const { overlayEl, styleEl, video, listeners } = overlayState;
  for (const [evt, fn] of listeners) {
    try { video.removeEventListener(evt, fn); } catch {}
  }
  try { overlayEl.remove(); } catch {}
  try { styleEl && styleEl.remove(); } catch {}
  overlayState = null;
}

function buildOverlay() {
  const wrap = document.createElement('div');
  wrap.className = OVERLAY_CLASS;
  Object.assign(wrap.style, {
    position: 'absolute',
    left: '0',
    right: '0',
    bottom: '12%',
    pointerEvents: 'auto',
    textAlign: 'center',
    color: '#fff',
    fontFamily: 'Netflix Sans, Helvetica Neue, sans-serif',
    fontWeight: '500',
    textShadow: '0 0 4px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.85)',
    // Above the player chrome / controls. Netflix's controls overlay
    // sits around z-index 1-10; 2^31-1 is the safe ceiling.
    zIndex: '2147483646',
    lineHeight: '1.3',
  });
  const lineBg = 'rgba(0, 0, 0, 0.75)';
  const ko = document.createElement('div');
  ko.className = 'lws-nxsubs-ko';
  Object.assign(ko.style, {
    fontSize: 'clamp(18px, 2.4vw, 32px)',
    width: 'fit-content',
    maxWidth: '90%',
    margin: '0 auto',
    padding: '2px 10px',
    background: lineBg,
    borderRadius: '2px',
  });
  wrap.appendChild(ko);
  const en = document.createElement('div');
  en.className = 'lws-nxsubs-en';
  Object.assign(en.style, {
    fontSize: 'clamp(14px, 1.8vw, 24px)',
    color: '#e8e8e8',
    width: 'fit-content',
    maxWidth: '90%',
    margin: '4px auto 0',
    padding: '2px 10px',
    background: lineBg,
    borderRadius: '2px',
    fontWeight: '400',
  });
  wrap.appendChild(en);
  return wrap;
}

function hideNativeCaptions() {
  const existing = document.getElementById(NX_HIDE_STYLE_ID);
  if (existing) return existing;
  const style = document.createElement('style');
  style.id = NX_HIDE_STYLE_ID;
  // Netflix renames the caption container occasionally — list every
  // selector we've seen. None of these match anything else, so a
  // wide list is harmless on titles that use a different one.
  style.textContent = `
    .player-timedtext { display: none !important; }
    .player-timedtext-text-container { display: none !important; }
    [data-uia="player-caption-text"] { display: none !important; }
  `;
  document.head.appendChild(style);
  return style;
}

// ---------------------------------------------------------------------
// Time-sync helpers
// ---------------------------------------------------------------------

function findLineIdx(lines, t) {
  // Binary search for the line whose [start, end) contains t.
  let lo = 0, hi = lines.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const ln = lines[mid];
    if (t < ln.start) hi = mid - 1;
    else if (t >= ln.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

function waitForVideoElement(timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    function tick() {
      const v = document.querySelector('.watch-video video, video');
      if (v) return resolve(v);
      if (Date.now() - start > timeoutMs) return resolve(null);
      setTimeout(tick, 100);
    }
    tick();
  });
}

async function resolveSecondaryLang() {
  try {
    const d = await chrome.storage.sync.get(DEFAULT_SECONDARY_KEY);
    return d[DEFAULT_SECONDARY_KEY] || 'en';
  } catch {
    return 'en';
  }
}

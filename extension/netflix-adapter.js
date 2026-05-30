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
const DUAL_SUBS_NX_KEY = 'dualSubsNetflix';
const DEFAULT_SECONDARY_KEY = 'secondaryLang';
// Per-title override map, keyed by Netflix titleId. Written by
// netflix-popup.js (Secondary Subs dropdown); read here via the
// resolveSecondaryLang fallback chain. Separate from YouTube's
// `dualSubsOverrides` so titleId/videoId namespaces can't collide.
const PER_TITLE_OVERRIDE_KEY = 'dualSubsOverridesNetflix';
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
// Most recent secondary language we picked for the overlay. Exposed
// to the toolbar popup (lws-nx-popup-info) so the dropdown can
// preselect what's actually rendering. Updated at every rebuild.
let lastSecondaryLang = null;

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
  // chrome.storage.local key. The per-title override key gets a
  // softer treatment: re-render the overlay with the new secondary
  // (no tear-down/re-init of the whole adapter session — the
  // captured tracks are still valid, just the choice of which one
  // renders as line 2 changed).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[DUAL_SUBS_NX_KEY]) {
      const next = changes[DUAL_SUBS_NX_KEY].newValue;
      if (next === false) deactivate();
      else { deactivate(); void activate(); }
    }
    if (area !== 'local') return;
    if (changes[DISABLED_HOSTS_KEY]) {
      handleNavStart();
      handleNavFinish();
    }
    if (changes[PER_TITLE_OVERRIDE_KEY]) {
      const newMap = changes[PER_TITLE_OVERRIDE_KEY].newValue || {};
      const oldMap = changes[PER_TITLE_OVERRIDE_KEY].oldValue || {};
      const tid = currentTitleId();
      if (tid && newMap[tid] !== oldMap[tid]) {
        void rebuildOverlay();
      }
    }
  });

  // Toolbar popup ↔ adapter messages. Synchronous reply (return false)
  // so we don't hold the response channel open — the popup just needs
  // the snapshot we already have in memory.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'lws-nx-popup-info') {
      sendResponse({
        active: Boolean(overlayState),
        titleId: currentTitleId(),
        tracks: Array.from(tracksByLang.entries()).map(([code, info]) => ({
          languageCode: code,
          // We don't have a localised display name — Netflix's TTML
          // only carries xml:lang. The popup falls back to the code
          // itself when languageName is the same as languageCode.
          languageName: code,
          captionedness: info.captionedness,
        })),
        secondaryLang: lastSecondaryLang,
      });
      return false;
    }
    return undefined;
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
  const [sync, local] = await Promise.all([
    chrome.storage.sync.get(DUAL_SUBS_NX_KEY).catch((err) => {
      console.warn('[lws] netflix dualSubsNetflix read failed', err && err.message);
      return {};
    }),
    chrome.storage.local.get(DISABLED_HOSTS_KEY).catch((err) => {
      log('local disabledHosts read failed:', err && err.message);
      return {};
    }),
  ]);
  if (sync[DUAL_SUBS_NX_KEY] === false) return false;
  const list = Array.isArray(local[DISABLED_HOSTS_KEY]) ? local[DISABLED_HOSTS_KEY] : [];
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
    // Diagnostic dump — we got a body but couldn't extract a track.
    // The next iteration of the parser depends on knowing exactly
    // what shape this body has. Dumps:
    //   - The root tag name + namespace URI
    //   - xml:lang if present at any element
    //   - Counts of candidate caption-line elements
    //   - First 400 chars of the body (raw)
    //   - For the first <p>/<div>/etc. element seen: its attributes
    //     and a snippet of its text content
    diagnoseUnparseableBody(url, body, parsed);
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

  // Time scale: Netflix's IMSC1 TTML exports use tick-based time
  // (e.g. `begin="60060000t"`) with the rate declared on the root
  // (`ttp:tickRate="10000000"` — 10M ticks/sec is common). Without
  // dividing by tickRate, every begin/end comes out as millions of
  // seconds and falls outside any reasonable playback window. We
  // also pick up frameRate in case anything uses `<N>f` instead.
  const TTP = 'http://www.w3.org/ns/ttml#parameter';
  const tickRateAttr = root.getAttribute('ttp:tickRate') || root.getAttributeNS(TTP, 'tickRate');
  const frameRateAttr = root.getAttribute('ttp:frameRate') || root.getAttributeNS(TTP, 'frameRate');
  const tickRate = tickRateAttr ? Number(tickRateAttr) : 0;
  const frameRate = frameRateAttr ? Number(frameRateAttr) : 0;

  const ps = doc.getElementsByTagName('p');
  const lines = [];
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    const begin = parseTtmlTime(p.getAttribute('begin'), tickRate, frameRate);
    const end = parseTtmlTime(p.getAttribute('end'), tickRate, frameRate);
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
 *   HH:MM:SS(.fraction)?   e.g. "00:00:01.500"  (clock-time)
 *   <N>t                   e.g. "60060000t"      (ticks; needs rate)
 *   <N>f                   e.g. "1500f"          (frames; needs rate)
 *   <N>ms                  e.g. "1500ms"         (offset, ms)
 *   <N>s                   e.g. "1.5s"           (offset, s)
 *   <N>m / <N>h            (offset, minutes / hours)
 *   <N>(.fraction)?        bare seconds, e.g. "1.5"
 * Returns null on unparseable input or when a rate-dependent unit
 * was used without the corresponding rate (avoids silently producing
 * nonsense seconds).
 */
function parseTtmlTime(s, tickRate, frameRate) {
  if (!s) return null;
  s = String(s).trim();
  const clock = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(s);
  if (clock) return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  const tick = /^(\d+(?:\.\d+)?)t$/.exec(s);
  if (tick) return tickRate > 0 ? Number(tick[1]) / tickRate : null;
  const frame = /^(\d+(?:\.\d+)?)f$/.exec(s);
  if (frame) return frameRate > 0 ? Number(frame[1]) / frameRate : null;
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
  if (!ko) {
    log(`rebuildOverlay: no KO yet; cached langs=[${Array.from(tracksByLang.keys()).join(',') || 'empty'}]`);
    return;
  }

  // Need a player video to anchor / time-sync to. Wait up to ~5s
  // after captures arrive (Netflix typically has the <video> ready
  // by then, but caption fetches can race ahead on initial load).
  const video = await waitForVideoElement(5000);
  if (!video) {
    log('no <video> element after 5s — overlay not mounted');
    return;
  }

  const secondaryLang = await resolveSecondaryLang();
  lastSecondaryLang = secondaryLang;
  const secondary = secondaryLang && secondaryLang !== 'off'
    ? tracksByLang.get(secondaryLang)
    : null;
  // Verbose: tells us at mount time what's actually cached. If the
  // user sees "secondary=(missing)" but expects EN, either the EN
  // capture never arrived (Netflix served from cache without a
  // fresh fetch, or the page hook missed it) or normalizeLang
  // produced a different key for it. The full list at the end is
  // the source of truth — match against secondaryLang to find it.
  log(`rebuildOverlay: ko=${ko.captionedness}/${ko.lines.length}lines, ` +
    `secondaryLang='${secondaryLang}' → ${secondary ? secondary.captionedness + '/' + secondary.lines.length + 'lines' : '(missing)'}` +
    `, all cached langs=[${Array.from(tracksByLang.keys()).join(',')}]`);

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
    display: 'none',
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
    display: 'none',
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
  // Per-title override (from the toolbar popup) wins over the sync
  // default. Same shape as YouTube's resolveSecondaryLang — catch
  // storage failures per call so a transient error on one side
  // doesn't abort the whole resolution.
  const tid = currentTitleId();
  const [local, sync] = await Promise.all([
    chrome.storage.local.get(PER_TITLE_OVERRIDE_KEY).catch((err) => {
      log('local storage read failed:', err && err.message);
      return {};
    }),
    chrome.storage.sync.get(DEFAULT_SECONDARY_KEY).catch((err) => {
      log('sync storage read failed:', err && err.message);
      return {};
    }),
  ]);
  const overrides = (local && local[PER_TITLE_OVERRIDE_KEY]) || {};
  if (tid && overrides[tid]) return overrides[tid];
  return (sync && sync[DEFAULT_SECONDARY_KEY]) || 'en';
}

function currentTitleId() {
  // Netflix watch URLs are `/watch/<numeric titleId>`, sometimes
  // prefixed with a country segment (e.g. `/us-en/watch/123…`). On
  // non-watch routes returns null — callers should handle that
  // (we're not in a session that has captures anyway).
  const m = /\/watch\/(\d+)/.exec(window.location.pathname);
  return m ? m[1] : null;
}

/**
 * Dump everything we know about a captured body whose parser path
 * came up empty. Goal: produce enough information in the console
 * for the next code iteration to know whether the issue is:
 *   - A different root tag we don't recognise (dfxp, vtt, …)
 *   - A different paragraph tag (some TTML flavours use <div>, <span>)
 *   - A namespace we strip incorrectly
 *   - A time format we don't parse
 *   - A text-extraction pattern that drops the actual subtitle text
 *
 * Logs are intentionally verbose — this only fires when we couldn't
 * extract anything from the body, which should be rare.
 */
function diagnoseUnparseableBody(url, body, parsed) {
  let doc = null;
  try {
    doc = new DOMParser().parseFromString(body, 'application/xml');
  } catch {}
  const root = doc && doc.documentElement;
  const rootName = root ? root.nodeName : '(no root)';
  const rootNs = root ? root.namespaceURI : '(no root)';

  // Walk and collect a few interesting things without depending on
  // querySelectorAll (which respects XML namespaces and may need
  // namespace-aware selectors on Netflix's TTML).
  const tagCounts = {};
  let firstP = null;
  let firstAnyTimedEl = null;
  let firstXmlLangBearer = null;
  if (root) {
    const stack = [root];
    while (stack.length && Object.keys(tagCounts).length < 50) {
      const el = stack.shift();
      if (!el || el.nodeType !== 1) continue;
      const tag = String(el.nodeName || '').toLowerCase().split(':').pop();
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      if (!firstP && tag === 'p') firstP = el;
      if (!firstAnyTimedEl && (el.getAttribute('begin') || el.getAttribute('end'))) {
        firstAnyTimedEl = el;
      }
      if (!firstXmlLangBearer) {
        const lang = el.getAttribute('xml:lang')
          || el.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang');
        if (lang) firstXmlLangBearer = { tag, lang };
      }
      for (let c = el.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 1) stack.push(c);
      }
    }
  }

  const headSnippet = body.slice(0, 400).replace(/\s+/g, ' ');
  log('skipped capture — DIAGNOSTICS for', url);
  log('  root tag:', rootName, 'namespace:', rootNs);
  log('  xml:lang anywhere:', firstXmlLangBearer || '(none)');
  log('  element counts (sample):', tagCounts);
  log('  first <p>:', firstP ? {
    begin: firstP.getAttribute('begin'),
    end: firstP.getAttribute('end'),
    text: (firstP.textContent || '').slice(0, 80),
  } : '(none)');
  log('  first element with begin/end:', firstAnyTimedEl ? {
    tag: firstAnyTimedEl.nodeName,
    begin: firstAnyTimedEl.getAttribute('begin'),
    end: firstAnyTimedEl.getAttribute('end'),
    text: (firstAnyTimedEl.textContent || '').slice(0, 80),
  } : '(none)');
  log('  body head (400 chars):', headSnippet);
  log('  parser saw:', parsed ? { lang: parsed.lang, lineCount: parsed.lines.length } : '(parser returned null)');
}

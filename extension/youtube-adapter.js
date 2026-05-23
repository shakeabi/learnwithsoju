/**
 * YouTube site adapter: replaces YouTube's native captions with a dual-line
 * overlay (Korean + English).
 *
 * Caption-source strategy
 * -----------------------
 * The URLs in `ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer
 * .captionTracks[].baseUrl` are PoToken-protected — third-party fetches
 * return 200 + 0 bytes. The only working URLs are the ones the player
 * computes for itself (PoToken included via `&pot=…`).
 *
 * So we:
 *   1. Inject a main-world hook script that monkey-patches XHR / fetch
 *   2. Tell the player to load Korean via `setOption('captions','track',…)`
 *   3. Hook captures the resulting `/api/timedtext?…` URL + body
 *   4. For English: prefer to trigger a second `setOption(…en)` and capture
 *      that body too. If no EN track is in the tracklist, fall back to
 *      refetching the captured KO URL with `&tlang=en` appended (lang/tlang
 *      aren't in the signed sparams, so the signature still validates).
 *   5. Hide YouTube's native caption window, mount overlay, time-sync.
 *
 * Lifecycle
 * ---------
 * setup() is called once by content.js at init. It wires up:
 *   - Settings listener (chrome.storage.sync.dualSubsYouTube)
 *   - Navigation listener (yt-navigate-finish + URL polling fallback)
 *   - Initial activation if we're on a /watch page with the setting on
 *
 * The returned teardown closure undoes everything when we navigate away
 * or the user disables the setting.
 */

const SETTING_KEY = 'dualSubsYouTube';
const DEFAULT_SECONDARY_KEY = 'secondaryLang';
// chrome.storage.local because session storage is restricted to trusted
// contexts (background/popup/options) by default; content scripts get a
// silent throw on read. local is unrestricted and has the nice property
// that per-video preferences survive a browser restart.
const PER_VIDEO_OVERRIDE_KEY = 'dualSubsOverrides';
const STYLE_ID = 'lws-hide-yt-captions';
const OVERLAY_CLASS = 'lws-ytsubs-overlay';
const HOOK_PATH = 'youtube-page-hook.js';
const CAPTURE_TIMEOUT_MS = 6000;

let teardownFn = null;
let hookInjected = false;
// Snapshot of the most recent tracklist + which lang is currently rendered
// in the overlay, exposed to the toolbar popup via chrome.runtime messaging.
let lastTracklist = [];
let lastVideoId = null;
let lastSecondaryLang = null;

export async function setup() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      if (changes[SETTING_KEY]) {
        const next = changes[SETTING_KEY].newValue;
        if (next === false) deactivate();
        else { deactivate(); void activate(); }
      } else if (changes[DEFAULT_SECONDARY_KEY]) {
        // Default secondary lang changed in options — re-activate so the
        // new default applies, unless this video has a per-video override.
        deactivate();
        void activate();
      }
    } else if (area === 'local' && changes[PER_VIDEO_OVERRIDE_KEY]) {
      // Per-video override changed (probably from the toolbar popup) —
      // re-activate if it's for the video currently loaded.
      const newMap = changes[PER_VIDEO_OVERRIDE_KEY].newValue || {};
      const oldMap = changes[PER_VIDEO_OVERRIDE_KEY].oldValue || {};
      const vid = currentVideoId();
      if (vid && newMap[vid] !== oldMap[vid]) {
        deactivate();
        void activate();
      }
    }
  });

  // Toolbar popup ↔ adapter messages.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'lws-yt-popup-info') {
      sendResponse({
        active: Boolean(teardownFn),
        videoId: lastVideoId,
        tracks: lastTracklist.map((t) => ({
          languageCode: t.languageCode,
          languageName: t.languageName || t.displayName || t.languageCode,
          kind: t.kind || '',
          vssId: t.vss_id || '',
        })),
        secondaryLang: lastSecondaryLang,
      });
      return false;
    }
    return undefined;
  });

  document.addEventListener('yt-navigate-start', deactivate);
  document.addEventListener('yt-navigate-finish', () => {
    setTimeout(() => { void activate(); }, 250);
  });
  let lastHref = window.location.href;
  setInterval(() => {
    if (window.location.href === lastHref) return;
    lastHref = window.location.href;
    deactivate();
    setTimeout(() => { void activate(); }, 250);
  }, 1000);

  await injectHookOnce();
  await activate();
}

function currentVideoId() {
  try {
    const u = new URL(window.location.href);
    return u.searchParams.get('v');
  } catch { return null; }
}

async function resolveSecondaryLang(videoId) {
  // Catch storage failures per call rather than letting Promise.all reject
  // and silently abort activation — we always want a usable fallback.
  const [sync, local] = await Promise.all([
    chrome.storage.sync.get(DEFAULT_SECONDARY_KEY).catch((err) => {
      log('sync storage read failed:', err && err.message);
      return {};
    }),
    chrome.storage.local.get(PER_VIDEO_OVERRIDE_KEY).catch((err) => {
      log('local storage read failed:', err && err.message);
      return {};
    }),
  ]);
  const overrides = (local && local[PER_VIDEO_OVERRIDE_KEY]) || {};
  if (videoId && overrides[videoId]) return overrides[videoId];
  return sync[DEFAULT_SECONDARY_KEY] || 'en';
}

function log(...args) {
  console.log('[learnwithsoju/youtube]', ...args);
}

async function activate() {
  if (teardownFn) { log('activate skipped: already active'); return; }
  if (!isWatchPage()) { log('activate skipped: not /watch (pathname:', window.location.pathname, ')'); return; }
  try {
    const enabled = await isEnabled();
    if (!enabled) { log('activate skipped: dualSubsYouTube setting is false — enable it in the extension options page'); return; }
    log('activating for', window.location.href);
    teardownFn = await initForCurrentVideo();
    if (teardownFn) log('dual subs mounted');
    else log('initForCurrentVideo returned null (check the log lines above for which guard rejected — tracklist, audio gate, primary source, or 0 KO lines)');
  } catch (err) {
    console.warn('[learnwithsoju/youtube] activate failed:', err);
  }
}

function deactivate() {
  if (teardownFn) {
    try { teardownFn(); } catch (err) {
      console.warn('[learnwithsoju/youtube] teardown threw:', err);
    }
    teardownFn = null;
  }
}

function isWatchPage() {
  return window.location.pathname === '/watch';
}

async function isEnabled() {
  const data = await chrome.storage.sync.get(SETTING_KEY);
  return data[SETTING_KEY] !== false;
}

/**
 * Inject the main-world hook script. Idempotent — the hook itself also
 * guards via `window.__lwsYtHookInstalled` for double-injection safety.
 */
function injectHookOnce() {
  return new Promise((resolve) => {
    if (hookInjected) return resolve();
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(HOOK_PATH);
    script.onload = () => {
      script.remove();
      hookInjected = true;
      log('main-world hook installed');
      resolve();
    };
    script.onerror = (err) => {
      console.warn('[learnwithsoju/youtube] hook injection failed:', err);
      // Resolve anyway so activate() can continue and log a clearer error.
      resolve();
    };
    (document.head || document.documentElement).appendChild(script);
  });
}

/**
 * Wait for a `lws-yt-caption` message whose URL passes `predicate`.
 * Resolves with `{ url, status, body }` or rejects on timeout.
 */
function captureCaption(predicate, timeoutMs = CAPTURE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', handler);
      reject(new Error('capture timeout'));
    }, timeoutMs);
    function handler(e) {
      const d = e.data;
      if (!d || d.__lwsYtCaption !== true) return;
      if (!predicate(d)) return;
      clearTimeout(timer);
      window.removeEventListener('message', handler);
      resolve(d);
    }
    window.addEventListener('message', handler);
  });
}

async function initForCurrentVideo() {
  const video = await waitForVideoElement();
  if (!video) { log('no <video> element after 10s'); return null; }

  await injectHookOnce();

  let tracklist;
  try {
    tracklist = await waitForTracklist();
  } catch (err) {
    log('tracklist never arrived:', err && err.message);
    return null;
  }
  log('tracklist languages:', tracklist.map((t) => t.languageCode + (t.kind === 'asr' ? '(asr)' : '')));
  lastTracklist = tracklist;
  lastVideoId = currentVideoId();

  // Skip dual subs when we're *confident* the audio is non-Korean
  // (e.g. an English-ASR video with a translated KO subtitle track —
  // the learner would be listening to English with Korean text below).
  // Detection is best-effort: many Korean videos have no ASR at all
  // because the uploader supplied manual captions, so we fail OPEN —
  // unknown audio engages dual subs as long as a Korean caption track
  // exists (pickPrimarySource gates on that downstream).
  const audioInfo = await getAudioInfo();
  log('audio info:', audioInfo);
  if (audioInfo.lang) {
    const lang = String(audioInfo.lang).toLowerCase();
    const isKo = lang === 'ko' || lang.startsWith('ko-');
    if (!isKo) {
      log(`audio is ${audioInfo.lang} (not Korean) — skipping dual subs`);
      return null;
    }
  }

  // Resolve the secondary language preference: per-video override (set via
  // toolbar popup) wins over the default in the options page.
  const secondaryLang = await resolveSecondaryLang(lastVideoId);
  lastSecondaryLang = secondaryLang;
  log('secondary lang for this session:', secondaryLang);

  const primary = pickPrimarySource(tracklist);
  if (!primary) {
    log('no usable Korean source on this video');
    return null;
  }
  log('primary source:', describeSource(primary));

  const secondary = (secondaryLang && secondaryLang !== 'off')
    ? pickSecondarySource(tracklist, secondaryLang)
    : null;
  if (secondary) log('secondary source:', describeSource(secondary));
  else log('secondary disabled or no track available');

  // Capture each unique base track exactly once — primary and secondary
  // can share a base (e.g. user pref is English and the video has no
  // manual KO, so both pull from manual EN).
  const baseLangs = new Set();
  baseLangs.add(primary.baseTrack.languageCode);
  if (secondary) baseLangs.add(secondary.baseTrack.languageCode);
  const captures = new Map();
  for (const lang of baseLangs) {
    const cap = await captureBaseTrack(lang);
    if (cap) captures.set(lang, cap);
  }
  // Restore KO display after switching tracks for capture (avoids the
  // player flashing the secondary's text before we hide native captions).
  if (baseLangs.size > 1) triggerLoadTrack(primary.baseTrack.languageCode);

  const koLines = await materializeLines(primary, captures);
  if (koLines.length === 0) {
    log('primary KO produced 0 lines after parse/translate');
    return null;
  }
  const enLines = secondary ? await materializeLines(secondary, captures) : [];
  log(`materialized: ${koLines.length} primary lines, ${enLines.length} secondary lines`);

  // Mount the overlay on .html5-video-player (the player root) — that's
  // where YouTube's own caption window lives. Mounting on the inner
  // .html5-video-container instead resolves `bottom: …` against the wrong
  // ancestor (the container is `position: static`) and the overlay ends up
  // above the visible video area.
  const container = document.querySelector('.html5-video-player') || video.parentElement;
  if (!container) { log('no player root found'); return null; }
  log(`mounting overlay (${koLines.length} KO, ${enLines.length} EN) inside`, container.className);

  const overlay = buildOverlay();
  container.appendChild(overlay);
  const styleEl = hideNativeCaptions();

  let lastKoIdx = -1;
  let lastEnIdx = -1;
  const koEl = overlay.querySelector('.lws-ytsubs-ko');
  const enEl = overlay.querySelector('.lws-ytsubs-en');

  function update() {
    const t = video.currentTime;
    const koIdx = findLineIdx(koLines, t);
    const enIdx = findLineIdx(enLines, t);
    if (koIdx !== lastKoIdx) {
      koEl.textContent = koIdx >= 0 ? koLines[koIdx].text : '';
      koEl.style.display = koIdx >= 0 ? '' : 'none';
      lastKoIdx = koIdx;
    }
    if (enIdx !== lastEnIdx) {
      enEl.textContent = enIdx >= 0 ? enLines[enIdx].text : '';
      enEl.style.display = enIdx >= 0 ? '' : 'none';
      lastEnIdx = enIdx;
    }
  }
  video.addEventListener('timeupdate', update);
  video.addEventListener('seeking', update);
  video.addEventListener('seeked', update);
  update();

  return () => {
    video.removeEventListener('timeupdate', update);
    video.removeEventListener('seeking', update);
    video.removeEventListener('seeked', update);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
  };
}

function isCaptionUrlMatchingLang(url, lang) {
  if (typeof url !== 'string') return false;
  // Match `&lang=ko` or `&lang=ko-...` but not `&tlang=ko`. Use regex on
  // the query string boundaries to avoid `&lang=en` matching `tlang=en`.
  // Also escape regex special chars in lang (zh-TW has the dash).
  const escaped = lang.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const re = new RegExp(`[?&]lang=${escaped}(?:-[a-zA-Z0-9]+)?(?:&|$)`);
  return re.test(url);
}

// Primary (Korean) source selection.
//   1. manual KO track     → use directly
//   2. KO ASR (auto-gen)   → use directly
//
// We deliberately don't fall back to translating another language's
// manual track into Korean. Auto-translated KO from English subs ends
// up sounding nothing like the actual spoken Korean — for a learner,
// that's actively misleading (wrong word choice, wrong register,
// wrong morphology). KO ASR is imperfect but at least reflects what
// was actually said.
function pickPrimarySource(tracks) {
  const manualKo = tracks.find((t) => isLang(t, 'ko') && !isAsr(t));
  if (manualKo) return { baseTrack: manualKo, target: 'ko', translate: false };
  const asrKo = tracks.find((t) => isLang(t, 'ko') && isAsr(t));
  if (asrKo) return { baseTrack: asrKo, target: 'ko', translate: false };
  return null;
}

// Secondary (user-pref) source selection.
//   1. manual track in target lang                → use directly
//   2. any manual track, translated to target     → &tlang=<target>
//   3. any ASR track, translated to target        → &tlang=<target>
function pickSecondarySource(tracks, targetLang) {
  const manualTarget = tracks.find((t) => isLang(t, targetLang) && !isAsr(t));
  if (manualTarget) return { baseTrack: manualTarget, target: targetLang, translate: false };
  const anyManual = tracks.find((t) => !isAsr(t) && !isLang(t, targetLang));
  if (anyManual) return { baseTrack: anyManual, target: targetLang, translate: true };
  const anyAsr = tracks.find((t) => isAsr(t));
  if (anyAsr) return { baseTrack: anyAsr, target: targetLang, translate: true };
  return null;
}

function isLang(track, code) {
  if (!track || !track.languageCode) return false;
  const lower = String(track.languageCode).toLowerCase();
  const target = String(code).toLowerCase();
  return lower === target || lower.startsWith(target + '-');
}

function isAsr(track) {
  return track && track.kind === 'asr';
}

function describeSource(src) {
  return `${src.baseTrack.languageCode}${isAsr(src.baseTrack) ? '(asr)' : ''}` +
    (src.translate ? ` → tlang=${src.target}` : '');
}

async function captureBaseTrack(lang) {
  log(`triggering load + capture for lang=${lang}`);
  const promise = captureCaption((d) =>
    isCaptionUrlMatchingLang(d.url, lang) && !d.url.includes('tlang='));
  triggerLoadTrack(lang);
  try {
    const cap = await promise;
    log(`  captured ${lang}: status=${cap.status} body=${cap.body.length}b`);
    return cap;
  } catch (err) {
    log(`  capture failed for ${lang}:`, err && err.message);
    return null;
  }
}

async function materializeLines(source, captures) {
  const baseCap = captures.get(source.baseTrack.languageCode);
  if (!baseCap) return [];
  if (!source.translate) {
    return parseTimedText(baseCap.body);
  }
  // Auto-translate by refetching with &tlang=<target>. lang/tlang aren't
  // in the signed sparams so the signature still validates.
  try {
    const u = new URL(baseCap.url);
    u.searchParams.set('tlang', source.target);
    const r = await fetch(u.toString());
    if (!r.ok) {
      log(`tlang=${source.target} fetch HTTP ${r.status}`);
      return [];
    }
    return parseTimedText(await r.text());
  } catch (err) {
    log(`tlang=${source.target} fetch threw:`, err && err.message);
    return [];
  }
}

function waitForVideoElement(timeoutMs = 10000) {
  return new Promise((resolve) => {
    const found = document.querySelector('video.html5-main-video');
    if (found) return resolve(found);
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const v = document.querySelector('video.html5-main-video');
      if (v) return resolve(v);
      if (Date.now() > deadline) return resolve(null);
      requestAnimationFrame(tick);
    };
    tick();
  });
}

/**
 * Send a command to the page-world hook and (optionally) await its reply.
 * Replies are matched by request id, so multiple commands can be in flight
 * without interfering.
 */
let cmdSeq = 0;
function sendHookCmd(cmd, payload = {}) {
  const reqId = `lws-${Date.now()}-${++cmdSeq}`;
  window.postMessage({ __lwsYtCmd: cmd, reqId, ...payload }, '*');
  return reqId;
}

function awaitHookReply(replyType, reqId, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', handler);
      reject(new Error(`hook ${replyType} reply timeout`));
    }, timeoutMs);
    function handler(e) {
      const d = e.data;
      if (!d || d.__lwsYtReply !== replyType || d.reqId !== reqId) return;
      clearTimeout(timer);
      window.removeEventListener('message', handler);
      resolve(d);
    }
    window.addEventListener('message', handler);
  });
}

/**
 * Get the authoritative list of available caption tracks.
 *
 * Two sources, merged:
 *   1. player.getOption('captions', 'tracklist') — richer metadata
 *      (displayName, is_servable, etc.) but unreliable for ASR-only
 *      videos. The player sometimes returns [] until the user enables
 *      CC manually for the first time.
 *   2. ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer
 *      .captionTracks — set server-side on page load, always present
 *      and complete (including ASR), but with a thinner shape.
 *
 * Dedupe by (languageCode + kind). Entries from getOption win when both
 * sources have the same key — they're richer. We return as soon as the
 * UNION is non-empty.
 */
async function waitForTracklist(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const merged = await collectTracksOnce();
    if (merged.length > 0) return merged;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('tracklist never populated');
}

async function collectTracksOnce() {
  const tasks = [
    awaitHookReply('tracklist', sendHookCmd('tracklist'), 1500).catch(() => null),
    awaitHookReply('player-response-tracks', sendHookCmd('player-response-tracks'), 1500).catch(() => null),
  ];
  const [a, b] = await Promise.all(tasks);
  const fromPlayer = Array.isArray(a && a.tracks) ? a.tracks : [];
  const fromResponse = Array.isArray(b && b.tracks) ? b.tracks : [];
  const seen = new Map();
  const keyOf = (t) =>
    `${String(t.languageCode || '').toLowerCase()}|${String(t.kind || '').toLowerCase()}`;
  // Player tracks first so they win on duplicate keys.
  for (const t of fromPlayer) seen.set(keyOf(t), t);
  for (const t of fromResponse) {
    const k = keyOf(t);
    if (!seen.has(k)) seen.set(k, t);
  }
  return [...seen.values()];
}

function triggerLoadTrack(lang, kind) {
  // kind: pass 'asr' to specifically target the auto-generated track
  // when both a manual and an ASR variant exist for the same lang.
  const payload = kind ? { lang, kind } : { lang };
  const reqId = sendHookCmd('load-track', payload);
  awaitHookReply('load-track', reqId, 1500).catch(() => {/* fire-and-forget */});
}

/**
 * Best-effort detection of the video's spoken audio language.
 * Returns `{ lang: 'ko'|'en'|..., source: 'multiAudio'|'asr' } | { lang: null }`.
 * Detection logic lives in the page-world hook (needs access to
 * ytInitialPlayerResponse); see youtube-page-hook.js's 'audio-info' handler.
 */
async function getAudioInfo() {
  const reqId = sendHookCmd('audio-info');
  try {
    const reply = await awaitHookReply('audio-info', reqId, 1500);
    return (reply && reply.info) || { lang: null, source: null };
  } catch {
    return { lang: null, source: null };
  }
}

function parseTimedText(body) {
  if (!body) return [];
  const trimmed = body.trimStart();
  if (trimmed.startsWith('{')) {
    try {
      const out = parseJson3(JSON.parse(trimmed));
      if (out.length > 0) return out;
    } catch {/* fall through */}
  }
  return parseSrv1Xml(body);
}

function parseJson3(data) {
  if (!data || !Array.isArray(data.events)) return [];
  const out = [];
  for (const ev of data.events) {
    if (typeof ev.tStartMs !== 'number') continue;
    const segs = Array.isArray(ev.segs) ? ev.segs : null;
    if (!segs) continue;
    const text = segs
      .map((s) => (typeof s.utf8 === 'string' ? s.utf8 : ''))
      .join('')
      .replace(/\r?\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    const dur = typeof ev.dDurationMs === 'number' ? ev.dDurationMs : 2000;
    out.push({
      start: ev.tStartMs / 1000,
      end: (ev.tStartMs + dur) / 1000,
      text,
    });
  }
  return out;
}

function parseSrv1Xml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const out = [];
  const decoder = document.createElement('textarea');
  for (const node of doc.querySelectorAll('text')) {
    const start = parseFloat(node.getAttribute('start') || '0');
    const dur = parseFloat(node.getAttribute('dur') || '2');
    const raw = node.textContent || '';
    decoder.innerHTML = raw;
    const text = decoder.value
      .replace(/\r?\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    out.push({ start, end: start + dur, text });
  }
  return out;
}

function findLineIdx(lines, t) {
  if (!Array.isArray(lines) || lines.length === 0) return -1;
  let lo = 0, hi = lines.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const line = lines[mid];
    if (t < line.start) hi = mid - 1;
    else if (t >= line.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

function buildOverlay() {
  const wrap = document.createElement('div');
  wrap.className = OVERLAY_CLASS;
  Object.assign(wrap.style, {
    // Anchored to the bottom of .html5-video-player so we sit just above
    // the chrome/controls bar, matching where YouTube's own captions land.
    position: 'absolute',
    left: '0',
    right: '0',
    bottom: '80px',
    pointerEvents: 'auto',
    textAlign: 'center',
    color: '#fff',
    fontFamily: 'YouTube Sans, Roboto, sans-serif',
    fontWeight: '500',
    textShadow: '0 0 4px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.85)',
    // Above YouTube's caption-window-container (z:35), the video itself,
    // and the controls bar — but below the settings menu (z:80) so popups
    // don't get hidden.
    zIndex: '70',
    lineHeight: '1.3',
  });
  // Each line gets `width: fit-content; margin: 0 auto` so the translucent
  // background hugs the text instead of stretching across the full video
  // width — matches the look of YouTube's own captions.
  const lineBg = 'rgba(0, 0, 0, 0.75)';
  const ko = document.createElement('div');
  ko.className = 'lws-ytsubs-ko';
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
  en.className = 'lws-ytsubs-en';
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
  const existing = document.getElementById(STYLE_ID);
  if (existing) return existing;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `.ytp-caption-window-container { display: none !important; }`;
  document.head.appendChild(style);
  return style;
}

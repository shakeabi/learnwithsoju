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
 * CC-bound visibility
 * -------------------
 * Capture runs once per video, but the overlay's *visibility* tracks the
 * user's CC button. We poll `player.getOption('captions','track')` and
 * derive a two-state mode (plus UNKNOWN sentinel):
 *   CC_OFF       → overlay hidden, native captions allowed to show
 *   CC_ON        → overlay shown, native captions hidden via CSS
 *                  (any language — dual-subs users typically have EN CC
 *                  on while listening to KO audio; language is irrelevant)
 *   TRACK_UNKNOWN → fail-open: overlay shown
 * We deliberately do NOT force-select KO. The CC button + track-picker
 * are the user's primary controls; we just mirror their state.
 *
 * Lifecycle
 * ---------
 * setup() is called once by content.js at init. It wires up:
 *   - Settings listener (chrome.storage.sync.dualSubsYouTube)
 *   - video_id poll (500 ms) that hard-reloads on change. SPA-style
 *     teardown raced YouTube's React reconciler too often (stale
 *     .lws-word wrappers got adopted by the next video's title), so
 *     we just reload — costs ~1–2 s per swap, sidesteps every race.
 *   - Initial activation if we're on a /watch page with the setting on
 *
 * The returned teardown closure undoes everything when the user
 * disables the setting / disables the host. Cross-video navigation
 * goes through the hard-reload path instead.
 */

const LWS_YT_DIAG = false;
const LWS_YT_ASR_DIAG = true;

const SETTING_KEY = 'dualSubsYouTube';
const DEFAULT_SECONDARY_KEY = 'secondaryLang';
// chrome.storage.local because session storage is restricted to trusted
// contexts (background/popup/options) by default; content scripts get a
// silent throw on read. local is unrestricted and has the nice property
// that per-video preferences survive a browser restart.
const PER_VIDEO_OVERRIDE_KEY = 'dualSubsOverrides';
const DISABLED_HOSTS_KEY = 'disabledHosts';
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

// Generation token: every activate()/deactivate() bumps it. activate()
// re-checks after each await and discards its work if its generation
// is no longer current (i.e., we've been superseded by a later
// activate or deactivate). Prevents two concurrent activates from
// both mounting overlays — the older one's overlay would otherwise
// stay orphaned because only the latest teardownFn assignment wins.
let activeGeneration = 0;

// True when the video_id poll is allowed to trigger a hard reload on
// change. Set in activate() once we've confirmed the extension is
// enabled here; cleared in deactivate() so a settings flip / host
// disable doesn't get bounced by a reload mid-teardown.
let reloadOnVideoIdChange = false;

export async function setup(_api = {}) {
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
    } else if (area === 'local' && changes[DISABLED_HOSTS_KEY]) {
      // Per-host disable flipped (from the toolbar popup). Tear down
      // the overlay if we're now disabled here, or activate if it was
      // just re-enabled. activate()'s isEnabled() check will gate on
      // the new list value.
      deactivate();
      void activate();
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

  // Single SPA-nav signal: poll the player's `getVideoData().video_id`
  // and (when it changes) hard-reload to the new URL. Earlier attempts
  // tried a graceful teardown + re-init on yt-navigate-* events and on
  // video_id change, but YouTube's React reconciler kept racing us —
  // stale .lws-word wrappers ended up adopted by the new video's title
  // and the user saw the next title appended to the old text. Hard
  // reload sidesteps the race entirely; costs ~1–2s per video swap.
  let lastSeenVideoId = currentVideoId();
  setInterval(async () => {
    if (!reloadOnVideoIdChange) return;
    const vid = await readPlayerVideoId();
    if (!vid || vid === lastSeenVideoId) return;
    // First successful read after activation seeds the baseline rather
    // than triggering a reload — only a CHANGE from a known id reloads.
    if (lastSeenVideoId === null) { lastSeenVideoId = vid; return; }
    lastSeenVideoId = vid;
    // hard reload — React reconciliation race; teardown was too late
    reloadOnVideoIdChange = false;
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set('v', vid);
    log('video_id changed → hard reload to', newUrl.toString());
    window.location.href = newUrl.toString();
  }, 500);

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

function diagLog(...args) {
  if (!LWS_YT_DIAG) return;
  try { console.log('[lws-yt-diag]', ...args); } catch {}
}

async function activate() {
  const myGen = ++activeGeneration;
  // Always tear down whatever's currently mounted — we're starting
  // fresh for this generation. Avoids leaving an old-video overlay
  // up if activate races with a navigation that triggers another
  // activate before this one's deactivate path runs.
  if (teardownFn) {
    try { teardownFn(); } catch {}
    teardownFn = null;
  }
  if (!isWatchPage()) { log('activate skipped: not /watch (pathname:', window.location.pathname, ')'); return; }
  try {
    const enabled = await isEnabled();
    if (myGen !== activeGeneration) return; // superseded during isEnabled
    if (!enabled) { log('activate skipped: dualSubsYouTube setting is false — enable it in the extension options page'); return; }
    log('activating for', window.location.href);
    const teardown = await initForCurrentVideo();
    if (myGen !== activeGeneration) {
      // A later activate / deactivate ran while we were awaiting
      // captures. Whatever we mounted is for a video the user has
      // already moved past — clean it up so it doesn't stack with
      // the newer overlay.
      if (teardown) { try { teardown(); } catch {} }
      log('activate superseded; cleaned up own work');
      return;
    }
    teardownFn = teardown;
    if (teardownFn) {
      reloadOnVideoIdChange = true;
      log('dual subs mounted');
    } else {
      log('initForCurrentVideo returned null (check the log lines above for which guard rejected — tracklist, audio gate, primary source, or 0 KO lines)');
    }
  } catch (err) {
    console.warn('[learnwithsoju/youtube] activate failed:', err);
  }
}

function deactivate() {
  // Bump the generation so any in-flight activate's post-await check
  // discards its work instead of leaving an orphan overlay.
  ++activeGeneration;
  reloadOnVideoIdChange = false;
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
  const [sync, local] = await Promise.all([
    chrome.storage.sync.get(SETTING_KEY),
    chrome.storage.local.get(DISABLED_HOSTS_KEY),
  ]);
  if (sync[SETTING_KEY] === false) return false;
  const list = Array.isArray(local[DISABLED_HOSTS_KEY]) ? local[DISABLED_HOSTS_KEY] : [];
  const host = (window.location && window.location.hostname || '').toLowerCase();
  if (host && list.includes(host)) return false;
  return true;
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

  // Snapshot the user's CC state BEFORE we touch the player, so we can
  // restore it after the capture pipeline (which has to flip tracks via
  // setOption to coax the player into fetching them). Without this the
  // user would find CC silently enabled on every video.
  const initialTrack = await readCurrentTrack();

  let tracklist;
  try {
    tracklist = await waitForTracklist();
  } catch (err) {
    log('tracklist never arrived:', err && err.message);
    return null;
  }
  lastTracklist = tracklist;
  lastVideoId = currentVideoId();

  // No separate audio-language gate. The tracklist only contains
  // base tracks — manual (uploader-provided) and ASR (YouTube
  // auto-generated in the actual spoken language). Auto-translated
  // tracks via tlang= aren't enumerated here, they're derived on
  // demand. So "KO is in the tracklist" already means "manual KO or
  // KO audio" — both legitimate reasons to engage. pickPrimarySource
  // below returns null if there's no KO at all, which is the only
  // case we need to skip.

  // Resolve the secondary language preference: per-video override (set via
  // toolbar popup) wins over the default in the options page.
  const secondaryLang = await resolveSecondaryLang(lastVideoId);
  lastSecondaryLang = secondaryLang;

  const primary = pickPrimarySource(tracklist);
  if (!primary) {
    log('no usable Korean source on this video');
    return null;
  }

  const secondary = (secondaryLang && secondaryLang !== 'off')
    ? pickSecondarySource(tracklist, secondaryLang)
    : null;

  // Capture each unique base track exactly once — primary and secondary
  // can share a base (e.g. user pref is English and the video has no
  // manual KO, so both pull from manual EN).
  // Key by languageCode; include kind so ASR tracks are requested correctly.
  const baseTrackMap = new Map();
  baseTrackMap.set(primary.baseTrack.languageCode, primary.baseTrack);
  if (secondary) {
    const sl = secondary.baseTrack.languageCode;
    if (!baseTrackMap.has(sl)) baseTrackMap.set(sl, secondary.baseTrack);
  }
  const captures = new Map();
  for (const [lang, track] of baseTrackMap) {
    const cap = await captureBaseTrack(lang, track.kind);
    if (cap) captures.set(lang, cap);
  }
  // Restore the user's pre-capture CC choice. Empty object = CC off;
  // populated = they had a track selected. Either way, we don't keep
  // the player parked on whatever language the capture loop last
  // touched — the user is the authority on what (if anything) the CC
  // button is showing.
  restoreTrack(initialTrack);

  const koLines = await materializeLines(primary, captures);
  if (LWS_YT_ASR_DIAG) {
    console.log('[lws-yt-asr] after translate: ' + koLines.length + ' lines (primary KO, translate=' + primary.translate + ')');
  }
  if (koLines.length === 0) {
    log('primary KO produced 0 lines after parse/translate');
    return null;
  }
  const enLines = secondary ? await materializeLines(secondary, captures) : [];

  // Mount the overlay on .html5-video-player (the player root) — that's
  // where YouTube's own caption window lives. Mounting on the inner
  // .html5-video-container instead resolves `bottom: …` against the wrong
  // ancestor (the container is `position: static`) and the overlay ends up
  // above the visible video area.
  const container = document.querySelector('.html5-video-player') || video.parentElement;
  if (!container) { log('no player root found'); return null; }

  const overlay = buildOverlay();
  overlay.style.display = 'none';
  container.appendChild(overlay);
  if (LWS_YT_DIAG) {
    try {
      const initDisplay = getComputedStyle(overlay).display;
      const initVis = getComputedStyle(overlay).visibility;
      const initOp = getComputedStyle(overlay).opacity;
      const outerHtml = overlay.outerHTML.slice(0, 200);
      diagLog(`overlay mounted — initial visibility=${initDisplay} / ${initVis} / ${initOp}, element=${outerHtml}`);
      diagLog(`overlay computed CSS: display=${initDisplay} / visibility=${initVis} / opacity=${initOp}`);
    } catch (diagErr) {
      diagLog('overlay mount diag threw:', diagErr && diagErr.message);
    }
  }
  // styleEl is added/removed dynamically — only mounted while the
  // overlay is visible, so when CC is off (or set to a non-KO lang)
  // YouTube's own caption window stays free to render.
  let styleEl = null;

  let lastKoIdx = -1;
  let lastEnIdx = -1;
  const koEl = overlay.querySelector('.lws-ytsubs-ko');
  const enEl = overlay.querySelector('.lws-ytsubs-en');
  // Mark the KO line when the source is YT's ASR so the CSS in
  // hideNativeCaptions() can paint a small "(auto)" badge before each
  // line — gives the learner a heads-up that they're reading machine
  // transcription, not creator-provided text.
  if (isAsr(primary.baseTrack)) koEl.classList.add('is-asr');

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

  // State machine: CC_OFF | CC_ON. The poller below re-evaluates from
  // the player's current track every tick. We start as null so the
  // first tick always runs the transition path. Fail-open default:
  // unknown / unparseable states resolve to CC_ON so a transient read
  // failure doesn't hide the overlay the user opted into.
  let lastMode = null;
  function setOverlayVisible(visible) {
    if (LWS_YT_DIAG) {
      try {
        const caller = new Error().stack.split('\n').slice(2, 4).join(' | ');
        const beforeDisplay = getComputedStyle(overlay).display;
        if (visible) {
          overlay.style.display = '';
          if (!styleEl) styleEl = hideNativeCaptions();
          update();
        } else {
          overlay.style.display = 'none';
          if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
          styleEl = null;
        }
        const afterDisplay = getComputedStyle(overlay).display;
        diagLog(`setOverlayVisible(${visible}) — caller=${caller} before=${beforeDisplay} after=${afterDisplay}`);
      } catch (diagErr) {
        diagLog('setOverlayVisible diag threw:', diagErr && diagErr.message);
        if (visible) {
          overlay.style.display = '';
          if (!styleEl) styleEl = hideNativeCaptions();
          update();
        } else {
          overlay.style.display = 'none';
          if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
          styleEl = null;
        }
      }
      return;
    }
    if (visible) {
      overlay.style.display = '';
      if (!styleEl) styleEl = hideNativeCaptions();
      update();
    } else {
      overlay.style.display = 'none';
      if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
      styleEl = null;
    }
  }
  function classifyTrack(track) {
    // Fail-open: UNKNOWN (read failed) and "track present but no
    // recognizable languageCode" both resolve to CC_ON. Only an
    // explicit null (player returned {} / null — CC genuinely off)
    // hides the overlay. Language is irrelevant: dual-subs users
    // typically have EN CC on while listening to KO audio.
    if (track === TRACK_UNKNOWN) return 'CC_ON';
    if (track === null) return 'CC_OFF';
    if (!track || typeof track !== 'object') return 'CC_ON';
    const code = track.languageCode;
    if (!code) return 'CC_ON';
    return 'CC_ON';
  }
  async function evaluateCcState() {
    const track = await readCurrentTrack();
    const mode = classifyTrack(track);
    diagLog(`state: ${lastMode} → ${mode} — getOption returned=${JSON.stringify(track === TRACK_UNKNOWN ? '(TRACK_UNKNOWN)' : track)}`);
    if (mode === lastMode) return;
    lastMode = mode;
    const desc = track === TRACK_UNKNOWN
      ? '(unknown — fail open)'
      : track ? `(${track.languageCode || ''}${track.kind === 'asr' ? '/asr' : ''})` : '(off)';
    log('CC state →', mode, desc);
    setOverlayVisible(mode !== 'CC_OFF');
  }
  // Kick a first evaluation immediately so the overlay shows (or stays
  // hidden) on the same tick the mount completes, instead of waiting a
  // full 500 ms for the first poll. Fire-and-forget — any error inside
  // is already logged by readCurrentTrack.
  let firstPollDone = false;
  const _origEvaluateCcState = evaluateCcState;
  const evaluateCcStateWithDiag = LWS_YT_DIAG
    ? async () => {
      const track = await readCurrentTrack().catch(() => TRACK_UNKNOWN);
      const classified = classifyTrack(track);
      if (!firstPollDone) {
        firstPollDone = true;
        try {
          diagLog(`first poll after mount: track=${JSON.stringify(track === TRACK_UNKNOWN ? '(TRACK_UNKNOWN)' : track)}, classified=${classified}`);
        } catch {}
      }
      return _origEvaluateCcState();
    }
    : evaluateCcState;
  void evaluateCcStateWithDiag();
  const ccPoll = setInterval(() => { void evaluateCcStateWithDiag(); }, 500);

  return () => {
    clearInterval(ccPoll);
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

async function captureBaseTrack(lang, kind) {
  const promise = captureCaption((d) =>
    isCaptionUrlMatchingLang(d.url, lang) && !d.url.includes('tlang='));
  triggerLoadTrack(lang, kind);
  try {
    const cap = await promise;
    if (LWS_YT_ASR_DIAG && lang === 'ko') {
      const body = cap && cap.body != null ? String(cap.body) : '';
      const isAsrKind = kind === 'asr';
      const bytes = body.length;
      console.log('[lws-yt-asr] captured KO body kind=' + (isAsrKind ? 'asr' : 'manual') + ' bytes=' + bytes);
      if (bytes === 0) {
        console.log('[lws-yt-asr]   (empty body — 0 bytes)');
      } else if (body.trimStart().startsWith('{') || body.trimStart().startsWith('[')) {
        console.log('[lws-yt-asr]   JSON head: ' + body.slice(0, 800));
      } else {
        console.log('[lws-yt-asr]   head: ' + body.slice(0, 500));
        console.log('[lws-yt-asr]   tail: ' + body.slice(-200));
      }
    }
    return cap;
  } catch (err) {
    log(`  capture failed for ${lang}:`, err && err.message);
    return null;
  }
}

async function materializeLines(source, captures) {
  const baseCap = captures.get(source.baseTrack.languageCode);
  if (!baseCap) return [];
  const isKo = source.baseTrack.languageCode === 'ko' || source.target === 'ko';
  if (!source.translate) {
    const parsed = parseTimedText(baseCap.body);
    if (LWS_YT_ASR_DIAG && isKo) {
      console.log('[lws-yt-asr] after parse: ' + parsed.length + ' lines; first[0]=' + JSON.stringify(parsed[0]) + ', first[1]=' + JSON.stringify(parsed[1]) + ', first[2]=' + JSON.stringify(parsed[2]));
    }
    return parsed;
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
    const translated = parseTimedText(await r.text());
    if (LWS_YT_ASR_DIAG && isKo) {
      console.log('[lws-yt-asr] after parse (tlang=' + source.target + '): ' + translated.length + ' lines; first[0]=' + JSON.stringify(translated[0]) + ', first[1]=' + JSON.stringify(translated[1]) + ', first[2]=' + JSON.stringify(translated[2]));
    }
    return translated;
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

async function readPlayerVideoId() {
  try {
    const reply = await awaitHookReply('video-id', sendHookCmd('video-id'), 1500);
    return (reply && typeof reply.videoId === 'string' && reply.videoId) || null;
  } catch (err) {
    log('video_id read failed:', err && err.message);
    return null;
  }
}

// Sentinel returned by readCurrentTrack when we couldn't determine the
// player's CC state (hook reply not ok, getOption threw, etc.). The CC
// state machine treats this as "fail open → show overlay" rather than
// fail-closed-to-hidden, because dual subs being mounted at all means
// the user opted in and would rather see captions than nothing on a
// transient read failure.
const TRACK_UNKNOWN = Symbol('TRACK_UNKNOWN');

async function readCurrentTrack() {
  // Returns: a track object (CC on with some lang), `null` (CC genuinely
  // off — player returned {} or null), or TRACK_UNKNOWN (we couldn't
  // read; caller should fail open).
  try {
    const reply = await awaitHookReply('get-track', sendHookCmd('get-track'), 1500);
    if (!reply || reply.ok === false) {
      log('CC observer: get-track reply not ok:', reply && reply.error);
      return TRACK_UNKNOWN;
    }
    const t = reply.track;
    if (!t || typeof t !== 'object') return null;
    // Empty object = player has CC explicitly off.
    if (!t.languageCode && Object.keys(t).length === 0) return null;
    return t;
  } catch (err) {
    log('CC observer: get-track failed:', err && err.message);
    return TRACK_UNKNOWN;
  }
}

function restoreTrack(track) {
  // Put the player back in the state the user had before the capture
  // pipeline ran. UNKNOWN snapshot → no-op (we never got a clean read,
  // so we can't be sure clearing wouldn't disable CC the user had on).
  // Null snapshot (CC was off) → also no-op: leaving the player on the
  // capture-loop's last-loaded track means our overlay's CC poll reads
  // CC_ON_KO and shows immediately. If the user wants captions off,
  // they click YouTube's CC button — the poll mirrors that.
  if (track === TRACK_UNKNOWN) return;
  if (!track || typeof track !== 'object' || !track.languageCode) return;
  triggerLoadTrack(track.languageCode, track.kind);
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
    display: 'none',
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
    display: 'none',
    fontWeight: '400',
  });
  wrap.appendChild(en);
  return wrap;
}

function hideNativeCaptions() {
  const existing = document.getElementById(STYLE_ID);
  if (existing) {
    diagLog(`hide-captions CSS already present: id=${STYLE_ID}`);
    return existing;
  }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  // Two rules in one stylesheet — both adapter-owned, both injected
  // only when activate() mounts an overlay:
  //   1. Hide YouTube's own caption window so we don't double-render.
  //   2. (auto) badge on the KO line when the primary source is YT's
  //      auto-generated ASR (transcription, not uploader-provided).
  //      Pseudo-element instead of a real DOM child so textContent of
  //      .lws-ytsubs-ko (used for sentence extraction + Ask AI) only
  //      contains the actual caption text, not the badge.
  style.textContent = `
    .ytp-caption-window-container { display: none !important; }
    .lws-ytsubs-ko.is-asr::before {
      content: '(auto) ';
      font-size: 0.55em;
      vertical-align: middle;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      opacity: 0.75;
      font-weight: 400;
      margin-right: 4px;
    }
  `;
  document.head.appendChild(style);
  diagLog(`hide-captions CSS injected: id=${STYLE_ID}, content=${style.textContent.slice(0, 200)}`);
  return style;
}

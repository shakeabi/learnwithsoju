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
// Phase 2.1 diagnostic — accumulate captured caption records so we
// can dump a per-session summary on deactivate. Phase 2.2 will
// replace this with proper track storage + format detection.
let captures = [];

function log(...args) {
  console.log('[learnwithsoju/netflix]', ...args);
}

export async function setup(api = {}) {
  if (typeof api.unwrap === 'function') hostUnwrap = api.unwrap;
  if (typeof api.rescan === 'function') hostRescan = api.rescan;

  // Page-world subtitle captures arrive here. For now we just stash
  // them and log; the overlay pipeline will consume this in 2.2.
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__lwsNxCaption !== true) return;
    const bytes = typeof d.body === 'string' ? d.body.length : 0;
    const head = typeof d.body === 'string' ? d.body.trimStart().slice(0, 40) : '';
    captures.push({ url: d.url, status: d.status, bytes, head });
    log('caption capture:', d.url, `status=${d.status}`, `bytes=${bytes}`, `head="${head.replace(/\s+/g, ' ')}"`);
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
    captures = [];

    // Phase 2.2 work goes here:
    //   - waitForVideoElement
    //   - decide when "enough" captures have arrived (some captions
    //     stream incrementally; many arrive once at session start)
    //   - inspect captures to detect available tracks (Korean,
    //     Korean[cc], secondary, secondary[cc])
    //   - if both KO and secondary present → mount dual overlay
    //     (reusing YouTube's overlay structure / styling, possibly
    //     refactored into a shared module)
    //   - hide Netflix native captions, time-sync to <video>
    //
    // For now: install a teardown that just logs the session summary.
    teardownFn = () => {
      log(`session over — ${captures.length} caption capture(s)`);
      if (captures.length > 0) {
        log('captures:', captures.map((c) => `${c.url.split('?')[0]} (${c.bytes}b)`));
      }
      captures = [];
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

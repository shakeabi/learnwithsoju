/**
 * Per-site overrides for content-script + popup behavior.
 *
 * Fields:
 *
 * 1. `sentenceContainer` — CSS selector for the sentence boundary AND
 *    the caption-vs-prose signal. The default walk in content.js looks
 *    for the nearest ancestor `<p>` / `<li>` / `<blockquote>` / `<div>`
 *    and uses its `textContent` as the sentence. That falls apart on
 *    sites that render text as many sibling spans — YouTube subtitles,
 *    Netflix timed text, Viki captions — where the "sentence" is a flat
 *    list of word/segment spans inside one container. The selector is
 *    passed to `wordEl.closest()`; the matched ancestor is treated as
 *    the sentence block. If `closest()` finds no match (e.g. the user
 *    hovered a word in the YouTube video description or a comment), we
 *    fall back to the default walk so non-caption text on the same page
 *    still works.
 *
 *    The same selector gates the auto-pause behavior: pause only fires
 *    when the hovered word is inside this container, so hovering a
 *    comment / title / description never interrupts playback.
 *
 * 2. `findVideo()` — returns the page's main video element (or null).
 *    When present (and the hover is inside `sentenceContainer`), the
 *    popup auto-pauses that video on open and resumes it on close,
 *    unless the user manually paused it in the meantime.
 *
 * 3. `adapter` — relative path to a content-script-side module that
 *    runs its own setup logic (caption replacement, dual-subs overlay,
 *    page-world hook injection, etc.). content.js dynamic-imports the
 *    module at init time and calls its `setup()` export. The adapter
 *    owns its lifecycle, including teardown on SPA navigation.
 *
 * 4. `popupModule` — relative path to a popup-side module. popup.js
 *    dynamic-imports it when the active tab matches this config, and
 *    calls `renderSection({ tab, container })`. The module owns all
 *    DOM under `container` and is responsible for showing/hiding it.
 *    Use this for the per-site UI in the toolbar popup (e.g. YouTube's
 *    secondary-language picker for the current video).
 *
 * Adding a site (e.g. Netflix):
 *
 *   {
 *     name: 'Netflix',
 *     hostnames: ['www.netflix.com'],
 *     // - OR -
 *     match: /(^|\.)netflix\.com$/,
 *     sentenceContainer: '.netflix-caption-line, ...',
 *     findVideo: () => document.querySelector('video') || null,
 *     adapter: 'netflix-adapter.js',
 *     popupModule: 'netflix-popup.js',  // optional
 *   }
 *
 * Then drop `netflix-adapter.js` + `netflix-popup.js` next to the YT
 * pair and add them to `web_accessible_resources` in manifest.json (the
 * adapter needs WAR because content scripts dynamic-import from the
 * page world; the popup module does not, since popup.js runs in the
 * extension context).
 *
 * `closest()` walks up from the hovered word, so when multiple comma-
 * separated selectors are given, the tightest matching ancestor wins.
 */

export const SITE_CONFIGS = [
  {
    name: 'YouTube',
    hostnames: ['youtube.com', 'www.youtube.com', 'm.youtube.com'],
    // Sentence-extraction container, tightest selector first (closest()
    // returns the nearest matching ancestor):
    //   .lws-ytsubs-ko          ← our own overlay's KO line (the dual-
    //                             subs adapter mounts this; takes
    //                             precedence over YouTube's natives
    //                             since we hide those)
    //   .captions-text          ← one native caption line (kept as a
    //                             fallback for users who disable dual
    //                             subs in the options page)
    //   .caption-window
    //   .ytp-caption-window-container
    sentenceContainer: '.lws-ytsubs-ko, .captions-text, .caption-window, .ytp-caption-window-container',
    // Auto-pause on popup open. The main player video sits in the page's
    // light DOM under .html5-video-container; the class on the <video>
    // element itself (html5-main-video) has been stable across YouTube
    // revisions. Ordered most-specific → fallback in case it changes.
    findVideo: () => document.querySelector('video.html5-main-video')
      || document.querySelector('.html5-video-container video')
      || document.querySelector('video') || null,
    // Dual-subtitle overlay (Korean + English). Replaces YouTube's native
    // caption rendering with our own time-synced div; English is the
    // manual track if available, else YouTube auto-translate from KO.
    adapter: 'youtube-adapter.js',
    // Toolbar-popup section: secondary-language picker for the current
    // video. See extension/youtube-popup.js.
    popupModule: 'youtube-popup.js',
  },
];

/**
 * Find the site config matching the current document's hostname.
 *
 * @param {string} hostname  e.g. 'www.youtube.com'
 * @returns {object | null}
 */
export function findSiteConfig(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return null;
  for (const cfg of SITE_CONFIGS) {
    if (Array.isArray(cfg.hostnames) && cfg.hostnames.includes(host)) return cfg;
    if (cfg.match instanceof RegExp && cfg.match.test(host)) return cfg;
  }
  return null;
}

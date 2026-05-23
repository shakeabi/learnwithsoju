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
 * 5. `stylesheet` — optional CSS string injected as a `<style>` tag
 *    by `content.js` on init. Lives here (not in `content.css`) so
 *    each site's visual fixes stay scoped to that site. Typical use:
 *    z-index promotions to get our `.lws-word` spans above a
 *    transparent player-controls overlay that's intercepting hover
 *    events. Selectors in the stylesheet are not auto-scoped — they
 *    apply globally — but `content.js` only injects this stylesheet
 *    when the current host matches the entry, so site-specific
 *    selectors (e.g. Netflix's `.player-timedtext`) only take effect
 *    on that site.
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
  {
    name: 'Netflix',
    // Netflix serves /<country>/ paths but the host is the same. If
    // you find a country-specific host that isn't covered, add it here.
    hostnames: ['www.netflix.com'],
    // Netflix renders subtitles as DOM text inside a fixed structure:
    //   .player-timedtext                       ← overall caption layer
    //     .player-timedtext-text-container      ← one per caption line
    //       <span> ... <span>                   ← styled fragments
    // closest() up from a hovered .lws-word lands on the line
    // container; we use its textContent as the sentence.
    // (Some Netflix titles use canvas-rendered captions in low-bandwidth
    // /low-DRM modes — those won't be hoverable. Most modern titles
    // render to the DOM.)
    sentenceContainer: '.player-timedtext-text-container, .player-timedtext',
    // Netflix's main video element. The watch route mounts the player
    // under `.watch-video`; some embed paths and the post-play screen
    // use a plain top-level <video>.
    findVideo: () => document.querySelector('.watch-video video')
      || document.querySelector('video') || null,
    // Z-index fix: when the mouse moves on the player, Netflix fades
    // in its control overlay which sits above the caption layer and
    // intercepts pointer events — so even though our `.lws-word`
    // spans are visually under the cursor, mouseenter fires on the
    // control overlay, not the span. Earlier attempt promoted
    // `.player-timedtext`; that didn't work for two reasons:
    //   1. z-index requires a positioned ancestor — without
    //      `position: relative`, the property is silently ignored.
    //   2. Netflix uses different caption container class names
    //      depending on the title / DRM profile / region, so any
    //      Netflix-specific selector is fragile.
    // Solution: promote our own `.lws-word` directly. position+z-index
    // together actually take effect, and the selector targets a class
    // we own — Netflix can rename their containers freely without
    // breaking us. Scoping is enforced by content.js only injecting
    // this stylesheet when the host matches this entry, so the rule
    // doesn't touch `.lws-word` on other sites (which need their
    // normal default styling from content.css).
    stylesheet: `
      .lws-word {
        position: relative;
        z-index: 2147483647;
      }
    `,
    // No adapter / popupModule yet. Phase 2 is a netflix-adapter.js
    // mirroring youtube-adapter.js (capture TTML/IMSC1 fetches, hide
    // native captions, mount a dual-lang overlay, time-sync to
    // <video>.currentTime). Until that ships, Netflix gets:
    //  - hover dictionary on the existing native captions
    //  - per-site disable (toolbar popup)
    //  - auto-pause on popup open (findVideo above)
    //  - z-index fix above so hovers actually reach our spans
    // but NOT dual subs (no secondary-language overlay).
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

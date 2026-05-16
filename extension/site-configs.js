/**
 * Per-site overrides for sentence extraction.
 *
 * The default sentence walk in content.js looks for the nearest ancestor
 * `<p>` / `<li>` / `<blockquote>` / `<div>` / etc., then takes its
 * `textContent` as the sentence. That works for prose, news articles,
 * blog posts. It falls apart on sites that render text as many sibling
 * spans — YouTube subtitles, Netflix timed text, Twitch chat — where the
 * "sentence" is a flat list of word/segment spans inside one container.
 *
 * To handle those, register a config below. `sentenceContainer` is a
 * CSS selector string passed to `wordEl.closest()`; the matched ancestor
 * is treated as the sentence block. If `closest()` finds no match (e.g.
 * the user hovered a word outside the captions on YouTube), we fall back
 * to the default walk so non-caption text on the same page still works.
 *
 * Adding a site:
 *
 *   {
 *     name: 'Site display name (for logs/diagnostics only)',
 *     hostnames: ['example.com', 'www.example.com'],  // exact host match
 *     // - OR -
 *     match: /(^|\.)example\.com$/,                   // regex on host
 *     sentenceContainer: '.outer-line, .fallback-container',
 *   }
 *
 * `closest()` walks up from the hovered word, so when multiple comma-
 * separated selectors are given, the tightest matching ancestor wins.
 */

export const SITE_CONFIGS = [
  {
    name: 'YouTube',
    hostnames: ['youtube.com', 'www.youtube.com', 'm.youtube.com'],
    // YouTube's caption DOM nests roughly like:
    //   .ytp-caption-window-container
    //     > .caption-window
    //       > .captions-text          ← one visible caption line
    //         > .ytp-caption-segment  ← one segment (often one word)
    // We want the captions-text scope so concurrent captions on a
    // different line don't bleed into the sentence we extract. The
    // additional selectors are fallbacks in case the inner classes
    // change in future YouTube revisions.
    sentenceContainer: '.captions-text, .caption-window, .ytp-caption-window-container',
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

/**
 * Netflix page-world hook — monkey-patches XHR.open and window.fetch
 * to surface Netflix's subtitle requests to the isolated-world adapter.
 *
 * Why a hook rather than a public API: Netflix doesn't expose a
 * tracklist / setTrack method to extensions the way YouTube does
 * (`player.getOption('captions', 'tracklist')`). Subtitle data
 * arrives as plain TTML / DFXP / WebVTT over normal HTTPS, but the
 * URLs are opaque (CDN hosts vary by region / title) and there's no
 * single well-known path like YouTube's `/api/timedtext`. We
 * therefore cast a wide net:
 *
 *   - URL extension match for `.ttml`, `.dfxp`, `.vtt`, `.xml`.
 *   - Body sniff for `<tt`, `WEBVTT`, `<dfxp` markers on text-ish
 *     responses whose URLs didn't match the extension heuristic
 *     (Netflix sometimes serves subtitle bodies from URLs with no
 *     file extension — query-string-keyed cache entries).
 *
 * Matched fetches are posted to the isolated world as
 * `{ __lwsNxCaption: true, url, status, body }` for the adapter to
 * inspect / parse / cache. Wide-net capture is intentional for Phase
 * 2.1 — once we see real Netflix traffic in the adapter's console
 * log, the next phase narrows the filter to just the formats
 * actually in use.
 *
 * Idempotent via `window.__lwsNxHookInstalled` — re-injecting the
 * script (which can happen on SPA navs) is a no-op.
 */

(() => {
  if (window.__lwsNxHookInstalled) return;
  window.__lwsNxHookInstalled = true;

  function looksLikeCaptionUrl(url) {
    if (typeof url !== 'string') return false;
    return /\.(ttml|dfxp|vtt|xml)(\?|#|$)/i.test(url);
  }

  function looksLikeCaptionBody(body) {
    if (typeof body !== 'string' || !body) return false;
    const head = body.trimStart().slice(0, 256);
    return (
      /^\s*<\?xml[^>]*\?>\s*<(tt|dfxp)\b/.test(head)
      || /^\s*<(tt|dfxp)\b/.test(head)
      || /^WEBVTT(\r|\n|\s)/.test(head)
    );
  }

  function post(url, status, body) {
    try {
      window.postMessage({
        __lwsNxCaption: true,
        url,
        status,
        body,
      }, '*');
    } catch {}
  }

  // XHR path — intercept the open() so we can attach a load handler
  // on the right instance. Pre-screen by URL; body-sniff on load if
  // the URL didn't match (covers caption fetches with opaque URLs).
  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    const urlMatch = looksLikeCaptionUrl(url);
    this.addEventListener('load', () => {
      try {
        const status = this.status;
        // Only attempt body sniff on response types we can read as
        // text. JSON, XML, plain — all fine. Skip arraybuffer / blob.
        const rtype = this.responseType;
        if (rtype && rtype !== 'text' && rtype !== '') return;
        const body = this.responseText || '';
        if (urlMatch || looksLikeCaptionBody(body)) post(url, status, body);
      } catch {}
    });
    return _open.call(this, method, url, ...rest);
  };

  // fetch path — same pattern. Clone response before reading so the
  // app code still gets to read the original body.
  const _fetch = window.fetch;
  window.fetch = function(input, init) {
    const u = typeof input === 'string' ? input : (input && input.url) || '';
    const urlMatch = looksLikeCaptionUrl(u);
    return _fetch.call(this, input, init).then((r) => {
      try {
        // Cheap pre-screen by content-type so we don't read every
        // binary response into a string. text/*, application/xml,
        // application/dfxp+xml, application/ttml+xml, application/octet
        // (sometimes used for subtitle bodies) all qualify.
        const ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
        const ctTextish = !ct || /^(text|application\/(xml|json|dfxp|ttml|x-subrip|octet))/i.test(ct);
        if (!urlMatch && !ctTextish) return r;

        const clone = r.clone();
        clone.text().then((body) => {
          try {
            if (urlMatch || looksLikeCaptionBody(body)) post(u, r.status, body);
          } catch {}
        }, () => {});
      } catch {}
      return r;
    });
  };
})();

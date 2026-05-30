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

  // Diagnostic mode — when true, also log every non-media XHR/fetch.
  // Flip to false (or delete this block and all `if (LWS_NX_DIAG)`
  // sites below) in the same commit that implements the chosen
  // auto-prime approach. See
  // docs/superpowers/specs/2026-05-30-netflix-dual-subs-auto-prime-diagnostic-design.md
  const LWS_NX_DIAG = true;

  // Skip filter for video/audio/image noise. Returns true if the
  // request should NOT be diagnostically logged (still goes through
  // the caption-capture path unchanged).
  function isMediaSkip(url, ct) {
    if (typeof url === 'string' && /(\.ts|\.m4s|\.mp4|init\.mp4)(\?|#|$)/i.test(url)) return true;
    if (typeof ct === 'string' && /^(video|audio|image)\//i.test(ct)) return true;
    return false;
  }

  // Escape a string for inclusion in a single-line console log.
  // JSON.stringify handles control chars + quotes; we use it directly
  // (the surrounding quotes ARE part of the log format).
  function escapeForLog(s) {
    if (typeof s !== 'string') return String(s);
    return JSON.stringify(s.length > 200 ? s.slice(0, 200) : s);
  }

  // Emit one diagnostic log line per non-media request. `bodyHead`
  // is either a string (text body, sent through escapeForLog) OR
  // one of the sentinel markers '<binary>' / '<unreadable>'.
  function diagLogFetch(transport, method, url, status, ct, bodyHead) {
    const ctStr = ct || 'no-ct';
    const isSentinel = bodyHead === '<binary>' || bodyHead === '<unreadable>';
    const bodyStr = isSentinel ? `body=${bodyHead}` : `body=${escapeForLog(bodyHead)}`;
    console.log(`[lws-nx-diag] ${transport} ${method} ${url} → ${status} (${ctStr}) ${bodyStr}`);
  }

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
        const ct = (() => {
          try { return this.getResponseHeader('content-type') || ''; }
          catch { return ''; }
        })();
        const rtype = this.responseType;
        const isTextish = !rtype || rtype === 'text';

        // Existing caption-capture path — body-sniff if the URL didn't
        // already match (covers caption fetches with opaque URLs).
        if (isTextish) {
          const body = this.responseText || '';
          if (urlMatch || looksLikeCaptionBody(body)) post(url, status, body);
        }

        // Diagnostic path — log every non-media request. Reads body
        // only if responseType allows it; otherwise marks binary.
        if (LWS_NX_DIAG && !isMediaSkip(url, ct)) {
          if (isTextish) {
            const body = this.responseText || '';
            diagLogFetch('xhr', method, url, status, ct, body);
          } else {
            diagLogFetch('xhr', method, url, status, ct, '<binary>');
          }
        }
      } catch {}
    });
    return _open.call(this, method, url, ...rest);
  };

  // fetch path — same pattern. Clone response before reading so the
  // app code still gets to read the original body.
  const _fetch = window.fetch;
  window.fetch = function(input, init) {
    const u = typeof input === 'string' ? input : (input && input.url) || '';
    const method = (init && init.method) || (input && input.method) || 'GET';
    const urlMatch = looksLikeCaptionUrl(u);
    return _fetch.call(this, input, init).then((r) => {
      try {
        const ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
        const ctTextish = !ct || /^(text|application\/(xml|json|dfxp|ttml|x-subrip|octet))/i.test(ct);
        const skipMedia = isMediaSkip(u, ct);

        // Read body if either (a) caption-capture might need to body-sniff
        // (urlMatch || ctTextish) — exactly the original gate, preserved
        // verbatim — or (b) the diagnostic will log the body head (also
        // requires ctTextish; non-text gets the '<binary>' sentinel above
        // without a body read). The two conditions collapse to the same
        // expression because the diagnostic's body read is a strict
        // subset of capture's.
        const needBody = urlMatch || ctTextish;

        if (LWS_NX_DIAG && !skipMedia && !ctTextish) {
          // Non-text response, log without body read.
          diagLogFetch('fetch', method, u, r.status, ct, '<binary>');
        }

        if (!needBody) return r;

        const clone = r.clone();
        clone.text().then((body) => {
          try {
            // Caption capture (unchanged semantics).
            if (urlMatch || looksLikeCaptionBody(body)) post(u, r.status, body);
            // Diagnostic log (gated, additive).
            if (LWS_NX_DIAG && !skipMedia) {
              diagLogFetch('fetch', method, u, r.status, ct, body);
            }
          } catch {}
        }, () => {
          if (LWS_NX_DIAG && !skipMedia) {
            diagLogFetch('fetch', method, u, r.status, ct, '<unreadable>');
          }
        });
      } catch {}
      return r;
    });
  };
})();

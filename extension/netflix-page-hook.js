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
 * inspect / parse / cache.
 *
 * Manifest interception (auto-prime): when the player loads a title
 * it fetches a JSON manifest describing every available subtitle
 * track and its CDN URLs. We sniff JSON responses whose URL path
 * contains `manifest`, walk a few candidate shapes
 * (`timedtexttracks`, `subtitles`, `textTracks`), and post the
 * normalized list as `{ __lwsNxManifest: true, tracks }` so the
 * adapter can pick KO + secondary and trigger fetches WITHOUT the
 * user having to toggle each language in Netflix's CC menu.
 *
 * Fetch-on-demand: the adapter posts `{ __lwsNxFetchCaption: true,
 * url, lang }` back; the hook fires the XHR from the page context
 * (so cookies / headers come along) and the existing capture path
 * picks up the body via body-sniff.
 *
 * Idempotent via `window.__lwsNxHookInstalled` — re-injecting the
 * script (which can happen on SPA navs) is a no-op.
 */

(() => {
  if (window.__lwsNxHookInstalled) return;
  window.__lwsNxHookInstalled = true;

  let manifestKeysLogged = false;

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

  function looksLikeManifestUrl(url) {
    if (typeof url !== 'string') return false;
    // Defensive match — Netflix's manifest endpoint paths have
    // changed over the years (cadmium/manifest, pbo_manifests, …).
    // Path-contains-'manifest' covers known variants without
    // hard-coding any single one.
    return /manifest/i.test(url);
  }

  function isJsonContentType(ct) {
    return typeof ct === 'string' && /json/i.test(ct);
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

  function postManifest(tracks) {
    try {
      window.postMessage({
        __lwsNxManifest: true,
        tracks,
      }, '*');
    } catch {}
  }

  /**
   * Walk a parsed manifest JSON looking for a subtitle-track array.
   * Returns `[{ language, originalLanguage, isCC, urlsByFormat }]` or
   * `[]` if nothing recognisable was found.
   *
   * Why multiple candidate keys: we don't have direct evidence of the
   * exact field name Netflix uses in the current manifest shape — the
   * code we reverse-engineered for the popup didn't include the
   * content-script half. List a few likely names and the first that
   * yields a non-empty array wins.
   */
  function extractTracksFromManifest(parsed) {
    if (!parsed || typeof parsed !== 'object') return [];
    const CANDIDATE_KEYS = ['timedtexttracks', 'subtitles', 'textTracks', 'timedTextTracks'];
    let raw = null;
    for (const key of CANDIDATE_KEYS) {
      const v = parsed[key];
      if (Array.isArray(v) && v.length > 0) { raw = v; break; }
    }
    // Some manifests nest under `result` or `tracks` — try one level deep
    // if the top-level keys didn't hit.
    if (!raw) {
      for (const wrapKey of ['result', 'tracks']) {
        const wrap = parsed[wrapKey];
        if (wrap && typeof wrap === 'object') {
          for (const key of CANDIDATE_KEYS) {
            const v = wrap[key];
            if (Array.isArray(v) && v.length > 0) { raw = v; break; }
          }
        }
        if (raw) break;
      }
    }
    if (!raw) return [];

    const out = [];
    for (const t of raw) {
      if (!t || typeof t !== 'object') continue;
      // Skip forced narrative / none tracks — these aren't real subs.
      if (t.isForcedNarrative === true || t.isNoneTrack === true) continue;

      const originalLanguage = String(
        t.language || t.languageCode || t.bcp47 || t.lang || ''
      );
      if (!originalLanguage) continue;

      const trackType = String(t.trackType || t.rawTrackType || '').toUpperCase();
      const isCC = trackType.indexOf('CLOSEDCAPTIONS') !== -1
        || trackType.indexOf('CLOSED_CAPTIONS') !== -1
        || t.isClosedCaption === true
        || t.cc === true;

      const urlsByFormat = {};
      const dl = t.ttDownloadables || t.downloadables || t.urls;
      if (dl && typeof dl === 'object') {
        for (const fmtKey of Object.keys(dl)) {
          const entry = dl[fmtKey];
          if (!entry) continue;
          // Common shape: { downloadUrls: { cdnId: url, … } }
          if (entry.downloadUrls && typeof entry.downloadUrls === 'object') {
            const urls = Object.values(entry.downloadUrls).filter((u) => typeof u === 'string');
            if (urls.length) urlsByFormat[fmtKey] = urls[0];
            continue;
          }
          // Alternate shape: { urls: [{ url }, …] }
          if (Array.isArray(entry.urls) && entry.urls.length) {
            const first = entry.urls.find((u) => u && (typeof u === 'string' || typeof u.url === 'string'));
            if (first) urlsByFormat[fmtKey] = typeof first === 'string' ? first : first.url;
            continue;
          }
          // Bare string value
          if (typeof entry === 'string') urlsByFormat[fmtKey] = entry;
        }
      }
      if (Object.keys(urlsByFormat).length === 0) continue;

      out.push({ language: originalLanguage.toLowerCase(), originalLanguage, isCC, urlsByFormat });
    }
    return out;
  }

  function handleManifestBody(url, bodyText) {
    if (typeof bodyText !== 'string' || !bodyText) return;
    let parsed;
    try { parsed = JSON.parse(bodyText); } catch { return; }
    if (!manifestKeysLogged) {
      manifestKeysLogged = true;
      try {
        const keys = parsed && typeof parsed === 'object' ? Object.keys(parsed) : [];
        console.log('[lws-nx-prime] manifest keys:', keys, 'url:', url);
      } catch {}
    }
    const tracks = extractTracksFromManifest(parsed);
    if (tracks.length === 0) {
      console.log('[lws-nx-prime] manifest matched URL but no tracks extracted; top-level keys:',
        parsed && typeof parsed === 'object' ? Object.keys(parsed) : '(non-object)');
      return;
    }
    postManifest(tracks);
  }

  // Fire an XHR from the page context for a chosen track URL. The
  // load handler we attach posts the body via the existing capture
  // pipeline (body-sniff catches the TTML even though the CDN URL
  // has no `.ttml` extension).
  function runXhrFetch(url, lang) {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.addEventListener('load', () => {
        try {
          const body = xhr.responseText || '';
          // Tag the post with the requested URL so the adapter can
          // correlate. The body-sniff path will also pick this up via
          // the open() override below, but the explicit post here
          // guarantees delivery even if response type prevents that.
          post(url, xhr.status, body);
          console.log('[lws-nx-prime] fetched track lang=' + lang + ' status=' + xhr.status + ' bytes=' + body.length);
        } catch (err) {
          console.warn('[lws-nx-prime] xhr load handler failed for lang=' + lang + ':', err && err.message);
        }
      });
      xhr.addEventListener('error', () => {
        console.warn('[lws-nx-prime] xhr error fetching lang=' + lang + ' url=' + url);
      });
      xhr.send();
    } catch (err) {
      console.warn('[lws-nx-prime] runXhrFetch threw for lang=' + lang + ':', err && err.message);
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__lwsNxFetchCaption !== true) return;
    if (typeof d.url !== 'string' || !d.url) return;
    runXhrFetch(d.url, d.lang || '');
  });

  // XHR path — intercept the open() so we can attach a load handler
  // on the right instance. Pre-screen by URL; body-sniff on load if
  // the URL didn't match (covers caption fetches with opaque URLs).
  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    const urlMatch = looksLikeCaptionUrl(url);
    const maybeManifest = looksLikeManifestUrl(url);
    this.addEventListener('load', () => {
      try {
        const status = this.status;
        const rtype = this.responseType;
        if (rtype && rtype !== 'text' && rtype !== '') return;
        const body = this.responseText || '';
        const ct = (this.getResponseHeader && this.getResponseHeader('content-type')) || '';
        if (maybeManifest && isJsonContentType(ct)) {
          handleManifestBody(url, body);
        }
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
    const maybeManifest = looksLikeManifestUrl(u);
    return _fetch.call(this, input, init).then((r) => {
      try {
        const ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
        const ctTextish = !ct || /^(text|application\/(xml|json|dfxp|ttml|x-subrip|octet))/i.test(ct);
        if (!urlMatch && !maybeManifest && !ctTextish) return r;

        const clone = r.clone();
        clone.text().then((body) => {
          try {
            if (maybeManifest && isJsonContentType(ct)) {
              handleManifestBody(u, body);
            }
            if (urlMatch || looksLikeCaptionBody(body)) post(u, r.status, body);
          } catch {}
        }, () => {});
      } catch {}
      return r;
    });
  };
})();

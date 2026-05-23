/**
 * Page-world hook — monkey-patches XHR and fetch to capture YouTube's own
 * /api/timedtext caption requests.
 *
 * Why this is necessary: YouTube's caption URLs are PoToken-protected.
 * The player's runtime computes a `pot=` value via BotGuard and includes
 * it on the caption URL. Any third-party fetch of the caption URL from
 * `ytInitialPlayerResponse` returns 200 + 0 bytes because that URL lacks
 * the PoToken. The only URL that works is one the player generated for
 * itself.
 *
 * Solution: when the player fetches its caption, we observe via this
 * hook (XHR.open / fetch) and post the URL + response body back to the
 * content script. The content script then either uses that body directly
 * (for the user-visible language) or refetches with `&tlang=en` appended
 * (since `lang`/`tlang` aren't part of the signed `sparams`).
 *
 * Runs in the page's main world via `<script src=…>` injection — content
 * scripts can't patch the page's globals from their isolated world.
 */

(() => {
  if (window.__lwsYtHookInstalled) return;
  window.__lwsYtHookInstalled = true;

  const TARGET = '/api/timedtext';

  function post(url, status, body) {
    window.postMessage({
      __lwsYtCaption: true,
      url,
      status,
      body,
    }, '*');
  }

  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    if (typeof url === 'string' && url.indexOf(TARGET) !== -1) {
      this.addEventListener('load', () => {
        try { post(url, this.status, this.responseText || ''); } catch {}
      });
    }
    return _open.call(this, method, url, ...rest);
  };

  const _fetch = window.fetch;
  window.fetch = function(input, init) {
    const u = typeof input === 'string' ? input : (input && input.url) || '';
    if (u.indexOf(TARGET) !== -1) {
      return _fetch.call(this, input, init).then((r) => {
        try {
          const clone = r.clone();
          clone.text().then((body) => {
            try { post(u, r.status, body); } catch {}
          }, () => {});
        } catch {}
        return r;
      });
    }
    return _fetch.call(this, input, init);
  };

  // Command channel from the content script — needed because the YouTube
  // player's getOption/setOption methods are page-world expandos, invisible
  // to content scripts in their isolated world.
  function getPlayer() {
    const p = document.querySelector('.html5-video-player');
    return (p && typeof p.getOption === 'function' && typeof p.setOption === 'function') ? p : null;
  }

  // Current video's PlayerResponse. `window.ytInitialPlayerResponse`
  // is only set on full page load — YouTube does NOT update it on
  // SPA navigation (next video in playlist, autoplay, etc.), so
  // reading it for SPA-nav videos gives the FIRST video's data and
  // mis-identifies the audio language / tracklist. The player's
  // `getPlayerResponse()` returns the currently-loaded video's data
  // and updates per-nav; use that as primary, fall back to the
  // initial global only when the player isn't ready (very early
  // first load).
  function getCurrentPlayerResponse() {
    const player = getPlayer();
    if (player) {
      for (const method of ['getPlayerResponse', 'getRawPlayerResponse']) {
        if (typeof player[method] === 'function') {
          try {
            const pr = player[method]();
            if (pr && typeof pr === 'object') return pr;
          } catch {}
        }
      }
    }
    return window.ytInitialPlayerResponse || null;
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || typeof d.__lwsYtCmd !== 'string') return;
    const reqId = d.reqId;
    if (d.__lwsYtCmd === 'tracklist') {
      const player = getPlayer();
      let tracks = [];
      if (player) {
        try { tracks = player.getOption('captions', 'tracklist') || []; } catch {}
      }
      window.postMessage({ __lwsYtReply: 'tracklist', reqId, tracks }, '*');
    } else if (d.__lwsYtCmd === 'player-response-tracks') {
      // Fallback / supplement: the player's getOption('tracklist') is
      // unreliable on videos that only have ASR captions — sometimes
      // returns empty until the user explicitly enables CC. The
      // PlayerResponse always lists every available track, so we
      // merge both sources upstream. Use getCurrentPlayerResponse()
      // (not the cached global ytInitialPlayerResponse) so SPA-nav
      // videos return their own tracklist, not the first video's.
      let tracks = [];
      try {
        const pr = getCurrentPlayerResponse();
        const list = pr && pr.captions
          && pr.captions.playerCaptionsTracklistRenderer
          && pr.captions.playerCaptionsTracklistRenderer.captionTracks;
        if (Array.isArray(list)) {
          tracks = list.map((t) => ({
            languageCode: t.languageCode,
            languageName: (t.name && t.name.simpleText) || '',
            displayName: (t.name && t.name.simpleText) || '',
            kind: t.kind || '',
            vss_id: t.vssId || '',
            isTranslatable: t.isTranslatable === true,
            _fromPlayerResponse: true,
          }));
        }
      } catch {}
      window.postMessage({ __lwsYtReply: 'player-response-tracks', reqId, tracks }, '*');
    } else if (d.__lwsYtCmd === 'load-track' && typeof d.lang === 'string') {
      const player = getPlayer();
      if (!player) {
        window.postMessage({ __lwsYtReply: 'load-track', reqId, ok: false, error: 'no player' }, '*');
        return;
      }
      try {
        // Clear-then-set forces a fresh fetch even if the player already
        // has the target track loaded (which would otherwise no-op). When
        // a kind (e.g. 'asr') is supplied, pass it through — setOption
        // accepts {languageCode, kind} to target a specific track variant.
        const trackOpt = { languageCode: d.lang };
        if (typeof d.kind === 'string' && d.kind) trackOpt.kind = d.kind;
        try { player.setOption('captions', 'track', {}); } catch {}
        player.setOption('captions', 'track', trackOpt);
        window.postMessage({ __lwsYtReply: 'load-track', reqId, ok: true }, '*');
      } catch (err) {
        window.postMessage({ __lwsYtReply: 'load-track', reqId, ok: false, error: String(err && err.message || err) }, '*');
      }
    }
  });
})();

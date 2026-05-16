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
    } else if (d.__lwsYtCmd === 'load-track' && typeof d.lang === 'string') {
      const player = getPlayer();
      if (!player) {
        window.postMessage({ __lwsYtReply: 'load-track', reqId, ok: false, error: 'no player' }, '*');
        return;
      }
      try {
        // Clear-then-set forces a fresh fetch even if the player already
        // has the target track loaded (which would otherwise no-op).
        try { player.setOption('captions', 'track', {}); } catch {}
        player.setOption('captions', 'track', { languageCode: d.lang });
        window.postMessage({ __lwsYtReply: 'load-track', reqId, ok: true }, '*');
      } catch (err) {
        window.postMessage({ __lwsYtReply: 'load-track', reqId, ok: false, error: String(err && err.message || err) }, '*');
      }
    }
  });
})();

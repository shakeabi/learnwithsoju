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

  const LWS_NX_DIAG_PRIME = false;
  const LWS_NX_DIAG_API = false;
  function diag(...args) { if (LWS_NX_DIAG_PRIME) console.log('[lws-nx-diag]', ...args); }

  diag('page-hook installed (v=DIAG)');

  // -----------------------------------------------------------------------
  // API probe — discover window.netflix.appContext.state.playerApp surface
  // -----------------------------------------------------------------------

  let probed = false;
  let loadedProbed = false;

  function listMethods(obj) {
    const methods = new Set();
    let p = obj;
    while (p && p !== Object.prototype) {
      for (const name of Object.getOwnPropertyNames(p)) {
        if (name === 'constructor') continue;
        try {
          if (typeof obj[name] === 'function') methods.add(name);
        } catch {}
      }
      p = Object.getPrototypeOf(p);
    }
    return [...methods].sort();
  }

  function safeProbeCall(label, fn) {
    try {
      const result = fn();
      let summary;
      if (result == null) summary = String(result);
      else if (Array.isArray(result)) summary = `Array(${result.length})${result.length ? ' first=' + JSON.stringify(result[0]).slice(0, 200) : ''}`;
      else if (typeof result === 'object') summary = `Object keys=[${Object.keys(result).slice(0, 20).join(',')}]`;
      else summary = `${typeof result} ${JSON.stringify(result).slice(0, 200)}`;
      console.log(`[lws-nx-api] ${label} →`, summary, '(raw:', result, ')');
    } catch (e) {
      console.log(`[lws-nx-api] ${label} threw: ${e.message}`);
    }
  }

  function walkShape(node, maxDepth, currentDepth = 0, path = '$') {
    if (currentDepth >= maxDepth) return [{path, type: '...'}];
    if (node === null || node === undefined) return [{path, type: String(node)}];
    if (typeof node !== 'object') {
      const v = typeof node === 'string' ? `"${node.slice(0, 60)}"` : String(node).slice(0, 60);
      return [{path, type: typeof node, value: v}];
    }
    if (Array.isArray(node)) {
      const out = [{path, type: `Array(${node.length})`}];
      if (node.length > 0) out.push(...walkShape(node[0], maxDepth, currentDepth + 1, `${path}[0]`));
      return out;
    }
    const out = [{path, type: 'Object', keys: Object.keys(node).slice(0, 30)}];
    for (const k of Object.keys(node).slice(0, 30)) {
      try {
        out.push(...walkShape(node[k], maxDepth, currentDepth + 1, `${path}.${k}`));
      } catch (e) {
        out.push({path: `${path}.${k}`, type: 'threw', error: e.message});
      }
    }
    return out;
  }

  if (LWS_NX_DIAG_API) {
    const _apiPollStart = Date.now();
    const _apiPollId = setInterval(() => {
      try {
        if (probed) { clearInterval(_apiPollId); return; }
        if (Date.now() - _apiPollStart > 30000) {
          clearInterval(_apiPollId);
          console.log('[lws-nx-api] gave up — no session ids after 30s');
          return;
        }
        const playerApp = window.netflix
          && window.netflix.appContext
          && window.netflix.appContext.state
          && window.netflix.appContext.state.playerApp;
        if (!playerApp) return;

        let _vpCheck;
        try { _vpCheck = playerApp.getAPI().videoPlayer; } catch { return; }
        if (!_vpCheck || typeof _vpCheck.getAllPlayerSessionIds !== 'function') return;
        let _idsCheck;
        try { _idsCheck = _vpCheck.getAllPlayerSessionIds(); } catch { return; }
        if (!Array.isArray(_idsCheck) || _idsCheck.length === 0) return;

        clearInterval(_apiPollId);
        probed = true;

        console.log('[lws-nx-api] netflix found — appContext keys:',
          Object.keys(window.netflix.appContext));
        console.log('[lws-nx-api] appContext.state keys:',
          Object.keys(window.netflix.appContext.state));
        console.log('[lws-nx-api] playerApp keys:',
          Object.keys(playerApp));

        let api;
        try { api = playerApp.getAPI(); } catch (e) {
          console.log('[lws-nx-api] playerApp.getAPI() threw:', e.message);
          return;
        }
        console.log('[lws-nx-api] api keys:', Object.keys(api));

        let videoPlayer;
        try { videoPlayer = api.videoPlayer; } catch (e) {
          console.log('[lws-nx-api] api.videoPlayer access threw:', e.message);
          return;
        }
        console.log('[lws-nx-api] videoPlayer keys:', Object.keys(videoPlayer));
        console.log('[lws-nx-api] videoPlayer methods:', listMethods(videoPlayer));

        safeProbeCall('all session ids', () => videoPlayer.getAllPlayerSessionIds && videoPlayer.getAllPlayerSessionIds());

        let sessionIds = [];
        try { sessionIds = videoPlayer.getAllPlayerSessionIds ? videoPlayer.getAllPlayerSessionIds() : []; } catch {}
        if (!Array.isArray(sessionIds)) sessionIds = [];

        for (const sid of sessionIds) {
          let session;
          try { session = videoPlayer.getVideoPlayerBySessionId(sid); } catch (e) {
            console.log(`[lws-nx-api] getVideoPlayerBySessionId(${sid}) threw:`, e.message);
            continue;
          }
          if (!session) { console.log(`[lws-nx-api] session ${sid} is null/undefined`); continue; }

          console.log(`[lws-nx-api] session ${sid} own keys:`, Object.keys(session));
          console.log(`[lws-nx-api] session ${sid} methods:`, listMethods(session));

          const allOwnAndProto = [];
          let _p = session;
          while (_p && _p !== Object.prototype) {
            for (const name of Object.getOwnPropertyNames(_p)) {
              try { if (typeof session[name] !== 'function') allOwnAndProto.push(name); } catch {}
            }
            _p = Object.getPrototypeOf(_p);
          }
          console.log(`[lws-nx-api] session ${sid} all props:`, [...new Set(allOwnAndProto)].sort());

          safeProbeCall(`session ${sid} getTextTrackList()`, () => session.getTextTrackList && session.getTextTrackList());
          safeProbeCall(`session ${sid} getCurrentTextTrack()`, () => session.getCurrentTextTrack && session.getCurrentTextTrack());
          safeProbeCall(`session ${sid} getTimedTextTrack()`, () => session.getTimedTextTrack && session.getTimedTextTrack());
          safeProbeCall(`session ${sid} getCurrentAudioTrack()`, () => session.getCurrentAudioTrack && session.getCurrentAudioTrack());
          safeProbeCall(`session ${sid} getMovieId()`, () => session.getMovieId && session.getMovieId());
          safeProbeCall(`session ${sid} getCurrentVideoId()`, () => session.getCurrentVideoId && session.getCurrentVideoId());
          safeProbeCall(`session ${sid} getDuration()`, () => session.getDuration && session.getDuration());
          safeProbeCall(`session ${sid} getCurrentTime()`, () => session.getCurrentTime && session.getCurrentTime());

          const allMethods = listMethods(session);
          const candidates = allMethods.filter((m) => /textTrack|Subtitle|timedText|Caption/i.test(m));
          if (candidates.length) {
            console.log(`[lws-nx-api] session ${sid} candidate methods:`, candidates);
            for (const m of candidates) {
              safeProbeCall(`session ${sid} ${m}()`, () => session[m]());
            }
          }

          safeProbeCall(`getCurrentTextTrackBySessionId(${sid})`, () => videoPlayer.getCurrentTextTrackBySessionId && videoPlayer.getCurrentTextTrackBySessionId(sid));
          safeProbeCall(`getCurrentAudioTrackBySessionId(${sid})`, () => videoPlayer.getCurrentAudioTrackBySessionId && videoPlayer.getCurrentAudioTrackBySessionId(sid));
          safeProbeCall(`getTextTrackBySessionId(${sid})`, () => videoPlayer.getTextTrackBySessionId && videoPlayer.getTextTrackBySessionId(sid));
          safeProbeCall(`getAudioTrackBySessionId(${sid})`, () => videoPlayer.getAudioTrackBySessionId && videoPlayer.getAudioTrackBySessionId(sid));
          safeProbeCall(`getActiveVideoMetadata(${sid})`, () => videoPlayer.getActiveVideoMetadata && videoPlayer.getActiveVideoMetadata(sid));
          safeProbeCall(`showTimedTextBySessionId(${sid}) no-arg`, () => videoPlayer.showTimedTextBySessionId && videoPlayer.showTimedTextBySessionId(sid));
        }

        try {
          const store = playerApp.getStore();
          const state = store.getState();
          const stateKeys = Object.keys(state);
          console.log('[lws-nx-api] store state keys:', stateKeys);

          for (const k of stateKeys) {
            try {
              const sub = state[k];
              if (sub && typeof sub === 'object' && !Array.isArray(sub)) {
                console.log(`[lws-nx-api] store.${k} keys:`, Object.keys(sub).slice(0, 30));
              } else {
                console.log(`[lws-nx-api] store.${k}:`, typeof sub);
              }
            } catch (e) {
              console.log(`[lws-nx-api] store.${k} access threw:`, e.message);
            }
          }

          const interestingKeys = stateKeys.filter((k) => /player|playback|video|session|track/i.test(k));
          console.log('[lws-nx-api] store interesting keys (player/playback/video/session/track):', interestingKeys);

          const deepProbeKeys = [...new Set([
            ...interestingKeys,
            ...stateKeys.filter((k) => /^(videos|playbacks|videoplayers)$/i.test(k)),
          ])];

          for (const k of deepProbeKeys) {
            try {
              const walk = walkShape(state[k], 4, 0, `store.${k}`);
              console.log(`[lws-nx-api] store shape [${k}]:`);
              try { console.table(walk); } catch { console.log(walk); }

              const findTrackObjects = (node, path2, depth) => {
                if (!node || typeof node !== 'object' || depth > 6) return;
                const keys = Array.isArray(node) ? [] : Object.keys(node);
                const trackSignals = ['language', 'bcp47', 'trackType', 'ttDownloadables'];
                if (keys.some((kk) => trackSignals.includes(kk))) {
                  console.log(`[lws-nx-api] TRACK OBJECT at ${path2}:`, JSON.parse(JSON.stringify(node)));
                  return;
                }
                for (const kk of keys.slice(0, 20)) {
                  try { findTrackObjects(node[kk], `${path2}.${kk}`, depth + 1); } catch {}
                }
              };
              findTrackObjects(state[k], `store.${k}`, 0);
            } catch (e) {
              console.log(`[lws-nx-api] store walk [${k}] threw:`, e.message);
            }
          }
        } catch (e) {
          console.log('[lws-nx-api] store probe threw:', e.message);
        }

        try {
          const ac = playerApp.getActionCreators();
          console.log('[lws-nx-api] action creators keys:', Object.keys(ac).slice(0, 50));
          console.log('[lws-nx-api] action creators methods:', listMethods(ac));
          const trackAc = Object.keys(ac).filter((k) => /track|subtitle|caption/i.test(k));
          console.log('[lws-nx-api] action creators track/subtitle/caption matches:', trackAc);
        } catch (e) {
          console.log('[lws-nx-api] action creators probe threw:', e.message);
        }

        // Round 3: arm a second poll that waits for tracks to populate.
        // Capture the session id and player references from this round for reuse.
        (() => {
          let _r3sid = null;
          let _r3session = null;
          let _r3videoPlayer = null;
          let _r3store = null;
          try {
            const _r3api = playerApp.getAPI();
            _r3videoPlayer = _r3api.videoPlayer;
            const _r3ids = _r3videoPlayer.getAllPlayerSessionIds ? _r3videoPlayer.getAllPlayerSessionIds() : [];
            _r3sid = Array.isArray(_r3ids) && _r3ids.length > 0 ? _r3ids[0] : null;
            if (_r3sid) _r3session = _r3videoPlayer.getVideoPlayerBySessionId(_r3sid);
            _r3store = playerApp.getStore();
          } catch (e) {
            console.log('[lws-nx-api-loaded] round-3 setup threw:', e && e.message);
            return;
          }
          if (!_r3sid || !_r3session) {
            console.log('[lws-nx-api-loaded] round-3 setup: no usable session — skipping');
            return;
          }

          const _r3Start = Date.now();
          const _r3PollId = setInterval(() => {
            if (loadedProbed) { clearInterval(_r3PollId); return; }
            if (Date.now() - _r3Start > 45000) {
              clearInterval(_r3PollId);
              console.log('[lws-nx-api-loaded] gave up — no tracks after 45s');
              return;
            }

            let textList = [];
            let timedList = [];
            let audioList = [];
            try { textList = _r3session.getTextTrackList ? (_r3session.getTextTrackList() || []) : []; } catch {}
            try { timedList = _r3session.getTimedTextTrackList ? (_r3session.getTimedTextTrackList() || []) : []; } catch {}
            try {
              const _r3st = _r3store.getState();
              const _r3ps = _r3st && _r3st.videoPlayer && _r3st.videoPlayer.playbackStateBySessionId;
              audioList = (_r3ps && _r3ps[_r3sid] && _r3ps[_r3sid].audioTrackList) || [];
            } catch {}

            if (!Array.isArray(textList) || !Array.isArray(timedList) || !Array.isArray(audioList)) return;
            if (textList.length === 0 && timedList.length === 0 && audioList.length === 0) return;

            clearInterval(_r3PollId);
            loadedProbed = true;

            console.log('[lws-nx-api-loaded] tracks populated — session:', _r3sid);

            // 1. textTrackList
            try {
              console.log('[lws-nx-api-loaded] textTrackList: count=' + textList.length);
              for (let i = 0; i < textList.length; i++) {
                const track = textList[i];
                console.log('[lws-nx-api-loaded] textTrackList[' + i + '] raw:', track);
                try { console.table(walkShape(track, 4)); } catch { console.log(walkShape(track, 4)); }
              }
            } catch (e) { console.log('[lws-nx-api-loaded] textTrackList probe threw:', e && e.message); }

            // 2. timedTextTrackList
            try {
              console.log('[lws-nx-api-loaded] timedTextTrackList: count=' + timedList.length);
              for (let i = 0; i < timedList.length; i++) {
                const track = timedList[i];
                console.log('[lws-nx-api-loaded] timedTextTrackList[' + i + '] raw:', track);
                try { console.table(walkShape(track, 4)); } catch { console.log(walkShape(track, 4)); }
              }
            } catch (e) { console.log('[lws-nx-api-loaded] timedTextTrackList probe threw:', e && e.message); }

            // 3. audioTrackList from store
            try {
              console.log('[lws-nx-api-loaded] audioTrackList from store: count=' + audioList.length);
              for (let i = 0; i < audioList.length; i++) {
                console.log('[lws-nx-api-loaded] audioTrackList[' + i + '] raw:', audioList[i]);
                try { console.table(walkShape(audioList[i], 4)); } catch { console.log(walkShape(audioList[i], 4)); }
              }
            } catch (e) { console.log('[lws-nx-api-loaded] audioTrackList probe threw:', e && e.message); }

            // 4. active text track
            try {
              console.log('[lws-nx-api-loaded] active text track — session.getTextTrack():', safeCallR3('session.getTextTrack()', () => _r3session.getTextTrack && _r3session.getTextTrack()));
              console.log('[lws-nx-api-loaded] active text track — session.getCurrentTextTrack():', safeCallR3('session.getCurrentTextTrack()', () => _r3session.getCurrentTextTrack && _r3session.getCurrentTextTrack()));
              console.log('[lws-nx-api-loaded] active text track — videoPlayer.getCurrentTextTrackBySessionId:', safeCallR3('vpCurrentTextTrack', () => _r3videoPlayer.getCurrentTextTrackBySessionId && _r3videoPlayer.getCurrentTextTrackBySessionId(_r3sid)));
            } catch (e) { console.log('[lws-nx-api-loaded] active text track probe threw:', e && e.message); }

            // 5. active audio track
            try {
              console.log('[lws-nx-api-loaded] active audio track — session.getAudioTrack():', safeCallR3('session.getAudioTrack()', () => _r3session.getAudioTrack && _r3session.getAudioTrack()));
              console.log('[lws-nx-api-loaded] active audio track — session.getCurrentAudioTrack():', safeCallR3('session.getCurrentAudioTrack()', () => _r3session.getCurrentAudioTrack && _r3session.getCurrentAudioTrack()));
            } catch (e) { console.log('[lws-nx-api-loaded] active audio track probe threw:', e && e.message); }

            // 6. playback state subset — keys matching /track|text|audio|loaded/i
            try {
              const _r3st = _r3store.getState();
              const _r3ps = _r3st && _r3st.videoPlayer && _r3st.videoPlayer.playbackStateBySessionId;
              const pbState = _r3ps && _r3ps[_r3sid];
              if (pbState) {
                const interestingPbKeys = Object.keys(pbState).filter((k) => /track|text|audio|loaded/i.test(k));
                console.log('[lws-nx-api-loaded] playback state subset — interesting keys:', interestingPbKeys);
                for (const k of interestingPbKeys) {
                  try {
                    const walked = walkShape(pbState[k], 3);
                    console.log('[lws-nx-api-loaded] playback state subset [' + k + ']:');
                    try { console.table(walked); } catch { console.log(walked); }
                  } catch (e) {
                    console.log('[lws-nx-api-loaded] playback state subset [' + k + '] threw:', e && e.message);
                  }
                }
              } else {
                console.log('[lws-nx-api-loaded] playback state subset: pbState not found for sid', _r3sid);
              }
            } catch (e) { console.log('[lws-nx-api-loaded] playback state subset probe threw:', e && e.message); }

          }, 1000);

          function safeCallR3(label, fn) {
            try { return fn(); } catch (e) { return '(threw: ' + (e && e.message) + ')'; }
          }
        })();

      } catch (outerErr) {
        console.log('[lws-nx-api] probe outer error:', outerErr && outerErr.message);
      }
    }, 500);
  }

  // -----------------------------------------------------------------------
  // Track-select prime dance
  //
  // Triggered by the adapter via `{__lwsNxRunPrime: true, …}`. Netflix
  // doesn't expose subtitle URLs in any introspectable shape; the only
  // way to make it fetch a given language's TTML is to actually select
  // that track. We briefly drive the player through KO → secondary,
  // capturing each TTML via the existing XHR/fetch sniff path, then
  // restore the user's original selection. The CSS in the adapter that
  // hides Netflix's native caption container is what conceals the
  // flicker — activation must inject that BEFORE issuing the prime.
  // -----------------------------------------------------------------------

  let primeRunning = false;
  let primeGen = 0;

  function bcp47Matches(trackLang, pref) {
    const t = String(trackLang || '').toLowerCase();
    const p = String(pref || '').toLowerCase();
    if (!t || !p) return false;
    const tBase = t.split('-')[0];
    const pBase = p.split('-')[0];
    if (tBase !== pBase) return false;
    if (!p.includes('-')) return true;
    if (t === p) return true;
    const pRegion = p.split('-').slice(1).join('-');
    if (!t.includes('-')) return true;
    if (pRegion === 'tw' && /hant|hk/.test(t)) return true;
    if (pRegion === 'hant' && /tw|hk/.test(t)) return true;
    if (pRegion === 'cn' && /hans/.test(t)) return true;
    if (pRegion === 'hans' && /cn/.test(t)) return true;
    return t === p;
  }

  function isUsableTrack(t) {
    if (!t || typeof t !== 'object') return false;
    if (t.isNoneTrack === true) return false;
    if (t.isForcedNarrative === true) return false;
    if (t.isImageBased === true) return false;
    return true;
  }

  function pickKoTrack(tracks) {
    const candidates = tracks.filter((t) => isUsableTrack(t) && bcp47Matches(t.bcp47, 'ko'));
    if (candidates.length === 0) return null;
    const cc = candidates.find((t) => String(t.rawTrackType || '').toUpperCase() === 'CLOSEDCAPTIONS');
    return cc || candidates[0];
  }

  function pickSecondaryTrack(tracks, prefs) {
    const usable = tracks.filter(isUsableTrack);
    for (const pref of prefs) {
      if (!pref) continue;
      const matches = usable.filter((t) => bcp47Matches(t.bcp47, pref));
      if (matches.length === 0) continue;
      const plain = matches.find((t) => String(t.rawTrackType || '').toUpperCase() === 'SUBTITLES');
      return plain || matches[0];
    }
    return null;
  }

  function postPrimeStatus(status, detail) {
    try {
      window.postMessage({ __lwsNxPrimeStatus: true, status, detail: detail || null }, '*');
    } catch {}
  }

  function waitForLoadedSession(timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        try {
          const playerApp = window.netflix
            && window.netflix.appContext
            && window.netflix.appContext.state
            && window.netflix.appContext.state.playerApp;
          if (playerApp) {
            const vp = playerApp.getAPI().videoPlayer;
            const ids = (vp && vp.getAllPlayerSessionIds) ? vp.getAllPlayerSessionIds() : [];
            if (Array.isArray(ids) && ids.length > 0) {
              const sid = ids[0];
              const session = vp.getVideoPlayerBySessionId(sid);
              const list = session && session.getTextTrackList ? (session.getTextTrackList() || []) : [];
              if (Array.isArray(list) && list.length > 0) {
                return resolve({ session, sid, list });
              }
            }
          }
        } catch {}
        if (Date.now() - start > timeoutMs) return resolve(null);
        setTimeout(tick, 1000);
      };
      tick();
    });
  }

  function waitForCapture(predicate, timeoutMs) {
    return new Promise((resolve) => {
      let done = false;
      const onMsg = (e) => {
        if (e.source !== window) return;
        const d = e.data;
        if (!d || d.__lwsNxCaption !== true) return;
        try {
          if (predicate(d)) {
            if (done) return;
            done = true;
            window.removeEventListener('message', onMsg);
            resolve(true);
          }
        } catch {}
      };
      window.addEventListener('message', onMsg);
      setTimeout(() => {
        if (done) return;
        done = true;
        window.removeEventListener('message', onMsg);
        resolve(false);
      }, timeoutMs);
    });
  }

  async function selectAndCapture(session, track, label, myGen) {
    const trackId = track && track.trackId;
    const langTag = track && track.bcp47;
    console.log('[lws-nx-prime] selecting ' + label + ' (bcp47=' + langTag + ', trackId=' + String(trackId).slice(0, 40) + '…) for capture');
    let captureLanded = false;
    const captureP = waitForCapture((msg) => {
      const body = typeof msg.body === 'string' ? msg.body : '';
      if (!body) return false;
      const headSnip = body.slice(0, 4096);
      if (langTag) {
        const langLower = String(langTag).toLowerCase();
        const langBase = langLower.split('-')[0];
        const langRe = new RegExp('xml:lang\\s*=\\s*"(' + langBase + ')(?:[-_][A-Za-z0-9]+)?"', 'i');
        if (langRe.test(headSnip)) return true;
      }
      return /<tt\b/i.test(headSnip) || /WEBVTT/i.test(headSnip);
    }, 3000);
    try {
      const ret = session.setTextTrack(track);
      if (ret && typeof ret.then === 'function') await ret;
    } catch (err) {
      console.warn('[lws-nx-prime] setTextTrack threw for ' + label + ': ' + (err && err.message));
    }
    if (myGen !== primeGen) return false;
    captureLanded = await captureP;
    if (myGen !== primeGen) return false;
    if (!captureLanded) {
      console.warn('[lws-nx-prime] no capture landed for ' + label + ' within 3s');
    }
    return captureLanded;
  }

  async function runPrimeDance(cmd) {
    // Bump generation first; any in-flight dance will see myGen !==
    // primeGen on its next gen check and bail before restoring. The
    // newest dance is always the one that owns the player.
    const myGen = ++primeGen;
    if (primeRunning) {
      console.log('[lws-nx-prime] dance already running — preempting (gen=' + myGen + ')');
    }
    primeRunning = true;
    let session = null;
    let originalTrack = null;
    const isCurrent = () => myGen === primeGen;
    try {
      const ready = await waitForLoadedSession(45000);
      if (myGen !== primeGen) { postPrimeStatus('aborted', 'gen-stale-after-wait'); return; }
      if (!ready) {
        console.warn('[lws-nx-prime] timed out waiting for loaded session + track list (45s)');
        postPrimeStatus('aborted', 'no-session');
        return;
      }
      session = ready.session;
      const list = ready.list;

      try { originalTrack = session.getTextTrack ? session.getTextTrack() : null; } catch { originalTrack = null; }

      const koTrack = pickKoTrack(list);
      if (!koTrack) {
        console.log('[lws-nx-prime] no Korean track in list — dual-subs disabled for this title');
        postPrimeStatus('no-ko');
        return;
      }

      const prefs = [];
      if (cmd && cmd.perTitleOverride) prefs.push(cmd.perTitleOverride);
      if (cmd && cmd.secondaryPref && !prefs.includes(cmd.secondaryPref)) prefs.push(cmd.secondaryPref);
      if (!prefs.includes('en')) prefs.push('en');

      const secondaryTrack = pickSecondaryTrack(list.filter((t) => t !== koTrack), prefs);
      if (!secondaryTrack) {
        console.log('[lws-nx-prime] no secondary track in list (chain exhausted: ' + prefs.join(',') + ') — dual-subs disabled for this title');
        postPrimeStatus('no-secondary');
        return;
      }

      console.log('[lws-nx-prime] dance starting: KO=' + koTrack.bcp47 + '/' + koTrack.rawTrackType + ', secondary=' + secondaryTrack.bcp47 + '/' + secondaryTrack.rawTrackType);

      const koCaptured = await selectAndCapture(session, koTrack, 'ko', myGen);
      if (myGen !== primeGen) { postPrimeStatus('aborted', 'gen-stale-after-ko'); return; }
      if (koCaptured) postPrimeStatus('ko-captured', koTrack.bcp47);

      const secCaptured = await selectAndCapture(session, secondaryTrack, 'secondary', myGen);
      if (myGen !== primeGen) { postPrimeStatus('aborted', 'gen-stale-after-secondary'); return; }
      if (secCaptured) postPrimeStatus('secondary-captured', secondaryTrack.bcp47);

      const origName = (originalTrack && (originalTrack.displayName || originalTrack.bcp47)) || '(none/unknown)';
      console.log('[lws-nx-prime] dance complete: ko=' + koCaptured + ', secondary=' + secCaptured + '; restoring user track ' + origName);
      postPrimeStatus('done', { ko: koCaptured, secondary: secCaptured, koLang: koTrack.bcp47, secondaryLang: secondaryTrack.bcp47 });
    } catch (outerErr) {
      console.warn('[lws-nx-prime] dance outer error: ' + (outerErr && outerErr.message));
      postPrimeStatus('aborted', 'threw:' + (outerErr && outerErr.message));
    } finally {
      // Restore the user's pre-dance track unless a newer dance preempted us.
      if (session && originalTrack && isCurrent()) {
        try {
          const ret = session.setTextTrack(originalTrack);
          if (ret && typeof ret.then === 'function') await ret.catch(() => {});
        } catch (err) {
          console.warn('[lws-nx-prime] restore threw: ' + (err && err.message));
        }
      }
      // Only clear primeRunning if we're still the current dance; a
      // preempting newer dance owns the flag now.
      if (isCurrent()) primeRunning = false;
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__lwsNxRunPrime !== true) return;
    void runPrimeDance(d);
  });

  const _NX_HOST_RE = /netflix\.com$|\.netflix\.com$|\.nflxso\.net$|\.nflxext\.com$/;
  const _MEDIA_CT_RE = /^(video|audio|image|font)\//i;
  const _MEDIA_EXT_RE = /\.(ts|m4s|mp4|init\.mp4)(\?|#|$)/i;

  function isDiagCandidate(url, ct) {
    if (!LWS_NX_DIAG_PRIME) return false;
    try {
      const host = new URL(url).hostname;
      if (!_NX_HOST_RE.test(host)) return false;
    } catch { return false; }
    if (_MEDIA_CT_RE.test(ct)) return false;
    if (_MEDIA_EXT_RE.test(url)) return false;
    return true;
  }

  function truncBody(body) {
    const s = typeof body === 'string' ? body : '';
    return JSON.stringify(s.slice(0, 200));
  }

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
      const keys = parsed && typeof parsed === 'object' ? Object.keys(parsed) : [];
      try { console.log('[lws-nx-prime] manifest keys:', keys, 'url:', url); } catch {}
      diag('manifest detection FIRED for url:', url);
    }
    const tracks = extractTracksFromManifest(parsed);
    if (tracks.length === 0) {
      const topKeys = parsed && typeof parsed === 'object' ? Object.keys(parsed) : '(non-object)';
      console.log('[lws-nx-prime] manifest matched URL but no tracks extracted; top-level keys:', topKeys);
      diag('manifest candidate matched but parsed 0 tracks:', url, 'keys=' + JSON.stringify(topKeys));
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
        if (isDiagCandidate(url, ct)) {
          diag('xhr', method, status, ct, url, 'body-head:', truncBody(body));
        }
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
        const diagCandidate = isDiagCandidate(u, ct);
        if (!urlMatch && !maybeManifest && !ctTextish && !diagCandidate) return r;

        const clone = r.clone();
        clone.text().then((body) => {
          try {
            if (diagCandidate) {
              diag('fetch GET', r.status, ct, u, 'body-head:', truncBody(body));
            }
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

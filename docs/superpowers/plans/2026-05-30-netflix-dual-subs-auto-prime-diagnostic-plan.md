# Netflix dual-subs auto-prime — diagnostic round implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add throwaway diagnostic instrumentation to the Netflix adapter + page-hook so a single Korean-watch session produces enough console log data to choose between four auto-prime approaches before writing the actual feature.

**Architecture:** Two pieces, both gated by `const LWS_NX_DIAG = true;` declared at file scope. Piece 1 extends `extension/netflix-page-hook.js` to log every non-media XHR/fetch (URL, status, content-type, body head). Piece 2 extends `extension/netflix-adapter.js` to call `probeNetflixGlobals()` once per `activate()` after `waitForVideoElement(5000)` resolves, which walks `window.netflix.*` and probes the internal player API. All additions strictly additive to the existing capture/parse/mount pipeline — no rewrites.

**Tech Stack:** Plain JavaScript, MV3 content scripts, no build step. `node --check` for syntax, `npm test` for the existing 128-test suite (which doesn't cover Netflix code).

**Source spec:** `docs/superpowers/specs/2026-05-30-netflix-dual-subs-auto-prime-diagnostic-design.md`

---

## File Structure

Both files are modified, no new files. Each file's diagnostic block is fully self-contained and can be removed in a single later commit by deleting the gated regions.

| File | Today's responsibility | After this plan |
|---|---|---|
| `extension/netflix-page-hook.js` | Monkey-patches XHR + `window.fetch` in the page main world, captures subtitle-shaped bodies, posts them to the isolated world | Same + (when `LWS_NX_DIAG`) logs every non-media XHR/fetch with `[lws-nx-diag] fetch …` line |
| `extension/netflix-adapter.js` | Isolated-world adapter: setup, SPA-nav, generation-token activate/deactivate, caption parse + cache + overlay mount | Same + (when `LWS_NX_DIAG`) fires `probeNetflixGlobals()` once per `activate()` after `waitForVideoElement(5000)` resolves |

The page-hook touches two existing handlers (XHR `.open` load callback, `fetch` override) and adds three helpers (skip filter, body-head escape, diagnostic log). The adapter adds a call site inside `activate()` and three new functions (`runDiagnosticProbeOnce`, `shapeWalk`, `probeNetflixGlobals`).

**Important:** the spec's wording said "after waitForVideoElement(5000) resolves (line ~378 today)" but that call is inside `rebuildOverlay()`, which only fires after a Korean caption is captured. The probe needs to fire **once per activate() regardless of capture timing**, so it gets its own `waitForVideoElement` call inside `runDiagnosticProbeOnce`, fired from `activate()`. Generation-token-gated to handle SPA nav supersession.

---

## Task 1: Page-hook diagnostic infrastructure

**Files:**
- Modify: `extension/netflix-page-hook.js`

Adds the `LWS_NX_DIAG` flag and three helpers at the top of the IIFE, before the existing `looksLikeCaptionUrl` helper. No behavior change — these are added but not yet called.

- [ ] **Step 1: Add the flag + helpers**

Open `extension/netflix-page-hook.js`. Right after the `window.__lwsNxHookInstalled = true;` line (currently line 32), insert this block:

```js
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
```

- [ ] **Step 2: Verify syntax**

Run: `cd /home/abishake/projects/learnwithsoju/extension && node --check netflix-page-hook.js`
Expected: no output (exit 0).

---

## Task 2: Wire diagnostic into the page-hook's XHR and fetch handlers

**Files:**
- Modify: `extension/netflix-page-hook.js`

Both existing wrappers preserve their current behavior (caption-capture is unchanged). The diagnostic log is added as an additional, gated emission.

- [ ] **Step 1: Replace the XHR open override**

Find the existing `XMLHttpRequest.prototype.open = function(method, url, ...rest)` block (currently lines 64–78). Replace the entire function body (from `const urlMatch = …` through the `return _open.call(this, method, url, ...rest);`) with:

```js
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
```

This preserves the existing capture (untouched semantically — still gated on `isTextish` + `urlMatch || looksLikeCaptionBody(body)`) and adds the diagnostic emission only when the flag is on and the URL/content-type isn't media.

- [ ] **Step 2: Replace the fetch override**

Find the existing `window.fetch = function(input, init)` block (currently lines 83–105). Replace the entire function body with:

```js
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
```

Caption capture preserved (still triggered by `urlMatch || looksLikeCaptionBody(body)`); diagnostic emission added when flag on and not media.

- [ ] **Step 3: Verify syntax**

Run: `cd /home/abishake/projects/learnwithsoju/extension && node --check netflix-page-hook.js`
Expected: no output (exit 0).

- [ ] **Step 4: Sanity-check the diff**

Run: `cd /home/abishake/projects/learnwithsoju && git diff extension/netflix-page-hook.js | head -120`

Expected: shows the `LWS_NX_DIAG = true;` line, the three new helpers, and the XHR + fetch handler rewrites. No other deletions of original logic.

---

## Task 3: Adapter diagnostic flag + probe call site

**Files:**
- Modify: `extension/netflix-adapter.js`

Adds the flag at the top, wires a fire-and-forget call into `activate()`, and adds the new `runDiagnosticProbeOnce` function (which calls the still-to-be-written `probeNetflixGlobals`).

- [ ] **Step 1: Add the flag at file scope**

Open `extension/netflix-adapter.js`. After the existing top-of-file imports / constants block ends (line 34, after `const NX_HIDE_STYLE_ID = 'lws-hide-nx-captions';`), insert:

```js
// Diagnostic mode — when true, run probeNetflixGlobals() once per
// activate() to dump window.netflix shape + candidate player-API
// surface. Flip to false (or delete the gated block in activate() +
// runDiagnosticProbeOnce + probeNetflixGlobals + shapeWalk + summarize)
// in the same commit that implements the chosen auto-prime approach.
// See docs/superpowers/specs/2026-05-30-netflix-dual-subs-auto-prime-diagnostic-design.md
const LWS_NX_DIAG = true;
```

- [ ] **Step 2: Add the probe call inside activate()**

Find the existing `activate()` function (currently lines 119–152). Locate the line `log('activating for', window.location.href);` (currently line 136). Right after `tracksByLang = new Map();` (currently line 137), add:

```js
    if (LWS_NX_DIAG) {
      void runDiagnosticProbeOnce(myGen);
    }
```

The call is fire-and-forget — it awaits `waitForVideoElement` internally and is gated by `myGen` so a superseding `activate()` invalidates an in-flight probe.

- [ ] **Step 3: Add runDiagnosticProbeOnce helper**

Find the existing `resolveSecondaryLang` function (currently lines 560–567). After its closing brace, before the `diagnoseUnparseableBody` function (currently around line 582), insert:

```js
// ---------------------------------------------------------------------
// Diagnostic probe (LWS_NX_DIAG)
// ---------------------------------------------------------------------

async function runDiagnosticProbeOnce(myGen) {
  // Wait for the <video> element so window.netflix.* is populated
  // (Netflix lazy-loads the player). 5s timeout matches what
  // rebuildOverlay uses; the probe is a no-op if no video appears.
  const video = await waitForVideoElement(5000);
  // Generation-token gate: if the user navigated to another title
  // while we were waiting, the new activate() bumped activeGeneration
  // and our probe data would be for the previous title — skip.
  if (myGen !== activeGeneration) return;
  if (!video) {
    log('[lws-nx-diag] probe skipped: no <video> within 5s');
    return;
  }
  probeNetflixGlobals();
}
```

- [ ] **Step 4: Verify syntax**

Run: `cd /home/abishake/projects/learnwithsoju/extension && node --check netflix-adapter.js`
Expected: no output (exit 0). (It WILL fail to actually run until Task 4 defines `probeNetflixGlobals`, but `node --check` only validates syntax — undefined references are fine.)

---

## Task 4: Implement probeNetflixGlobals (shape walk + API probe)

**Files:**
- Modify: `extension/netflix-adapter.js`

Adds the actual probe implementation + two small helpers. Goes immediately after `runDiagnosticProbeOnce`.

- [ ] **Step 1: Add shape walk + summarize helpers + probe driver**

In `extension/netflix-adapter.js`, immediately after the `runDiagnosticProbeOnce` function added in Task 3 (before `diagnoseUnparseableBody`), insert:

```js
// Recursive walk of an object's key tree. Logs the path + value typeof
// (no values printed beyond primitives). Depth-limited and cycle-aware.
function shapeWalk(obj, path, depth, maxDepth, visited) {
  if (depth > maxDepth || obj == null) return;
  if (typeof obj !== 'object') return;
  if (visited.has(obj)) {
    console.log(`[lws-nx-diag] shape ${path}: <cycle>`);
    return;
  }
  visited.add(obj);
  let keys;
  try { keys = Object.keys(obj); }
  catch (err) { console.log(`[lws-nx-diag] shape ${path}: <enum error: ${err.message}>`); return; }
  for (const k of keys) {
    let v;
    try { v = obj[k]; }
    catch (err) { console.log(`[lws-nx-diag] shape ${path}.${k}: <access error: ${err.message}>`); continue; }
    const childPath = path ? `${path}.${k}` : k;
    const t = typeof v;
    if (v == null || t !== 'object') {
      console.log(`[lws-nx-diag] shape ${childPath}: ${v == null ? String(v) : t}`);
    } else if (Array.isArray(v)) {
      console.log(`[lws-nx-diag] shape ${childPath}: array length=${v.length}`);
    } else {
      console.log(`[lws-nx-diag] shape ${childPath}: object`);
      shapeWalk(v, childPath, depth + 1, maxDepth, visited);
    }
  }
}

// Single-line summary of an arbitrary probe return value for the log.
function summarizeProbeResult(v) {
  if (v == null) return String(v);
  if (typeof v !== 'object') return typeof v;
  if (Array.isArray(v)) {
    const sample = v.slice(0, 5).map((x) => {
      if (typeof x !== 'object' || x == null) return String(x);
      // Try a few common identity fields without enumerating large objects.
      return x.id || x.sessionId || x.languageCode || '<obj>';
    });
    return `array length=${v.length} sample=[${sample.join(', ')}]`;
  }
  let keys;
  try { keys = Object.keys(v).slice(0, 20); }
  catch { return 'object <enum error>'; }
  return `object keys=[${keys.join(', ')}]`;
}

// Run an individual probe. Logs the result-summary or the error.
// Returns the value (or undefined on error) for downstream chaining.
function probeCall(path, fn) {
  try {
    const v = fn();
    console.log(`[lws-nx-diag] probe ${path}: ${summarizeProbeResult(v)}`);
    return v;
  } catch (err) {
    console.log(`[lws-nx-diag] probe ${path}: ERROR ${err && err.message || err}`);
    return undefined;
  }
}

function probeNetflixGlobals() {
  const nx = window.netflix;
  if (!nx) {
    console.log('[lws-nx-diag] probe window.netflix: undefined');
    return;
  }
  console.log('[lws-nx-diag] window.netflix shape:');
  // Depth 4 covers netflix → appContext → state → playerApp without
  // exploding into per-session player internals (those get probed
  // explicitly below).
  shapeWalk(nx, 'netflix', 0, 4, new WeakSet());

  const getAPIResult = probeCall(
    'netflix.appContext.state.playerApp.getAPI()',
    () => nx.appContext.state.playerApp.getAPI(),
  );
  if (!getAPIResult || typeof getAPIResult !== 'object') return;

  const videoPlayer = getAPIResult.videoPlayer;
  if (!videoPlayer) {
    console.log('[lws-nx-diag] probe getAPI().videoPlayer: missing');
    return;
  }

  const sessionIds = probeCall(
    'getAPI().videoPlayer.getAllPlayerSessionIds()',
    () => videoPlayer.getAllPlayerSessionIds(),
  );
  if (!Array.isArray(sessionIds)) return;

  for (const id of sessionIds) {
    const player = probeCall(
      `getAPI().videoPlayer.getVideoPlayerBySessionId(${id})`,
      () => videoPlayer.getVideoPlayerBySessionId(id),
    );
    if (!player || typeof player !== 'object') continue;

    probeCall(`player(${id}).getTextTrackList()`, () => player.getTextTrackList());
    probeCall(`player(${id}).getCurrentTextTrack()`, () => player.getCurrentTextTrack());

    // Discover any text-track-related methods exposed on the player's
    // prototype. Surfaces unknown method names (e.g. setTextTrack,
    // selectTextTrack, getAvailableTextTracks) without us having to
    // guess them all up-front.
    try {
      const proto = Object.getPrototypeOf(player);
      const names = Object.getOwnPropertyNames(proto)
        .filter((n) => /TextTrack/i.test(n) || /Subtitle/i.test(n));
      console.log(`[lws-nx-diag] probe player(${id}) prototype text-track / subtitle method names: [${names.join(', ')}]`);
    } catch (err) {
      console.log(`[lws-nx-diag] probe player(${id}) prototype enum: ERROR ${err && err.message || err}`);
    }
  }
}
```

- [ ] **Step 2: Verify syntax**

Run: `cd /home/abishake/projects/learnwithsoju/extension && node --check netflix-adapter.js`
Expected: no output (exit 0).

- [ ] **Step 3: Confirm `node --check` on both touched files**

Run: `cd /home/abishake/projects/learnwithsoju/extension && node --check netflix-page-hook.js && node --check netflix-adapter.js && echo OK`
Expected: `OK`.

---

## Task 5: Final verification and commit

**Files:**
- (none modified beyond Task 1–4)

- [ ] **Step 1: Run the test suite**

Run: `cd /home/abishake/projects/learnwithsoju && npm test 2>&1 | tail -5`
Expected: `tests 128`, `pass 128`, `fail 0`. The Netflix adapter has no test coverage and we haven't changed any tested code, so the count is unchanged from baseline.

- [ ] **Step 2: Confirm no manifest / message-flow / chrome.* surface change**

Run: `cd /home/abishake/projects/learnwithsoju && git diff extension/manifest.json`
Expected: empty (no changes).

Run: `cd /home/abishake/projects/learnwithsoju && git diff extension/netflix-page-hook.js extension/netflix-adapter.js | grep -E "(chrome\.runtime\.sendMessage|chrome\.tabs\.sendMessage|web_accessible_resources|chrome\.storage)" | wc -l`
Expected: `0` (the diagnostic adds no chrome.* API calls and changes no existing ones).

- [ ] **Step 3: Skim full diff for accidental regressions**

Run: `cd /home/abishake/projects/learnwithsoju && git diff --stat extension/netflix-page-hook.js extension/netflix-adapter.js`
Expected: only those two files modified. Insertion count dominates deletion count (additive change).

Then: `cd /home/abishake/projects/learnwithsoju && git diff extension/netflix-page-hook.js extension/netflix-adapter.js > /tmp/diag-diff.patch && wc -l /tmp/diag-diff.patch`
Expected: a few hundred lines, all new helpers + the in-place handler rewrites.

Review the diff against the spec. Confirm:
- Every diagnostic code path is gated by `if (LWS_NX_DIAG)` (or runs only when `LWS_NX_DIAG === true` at module scope).
- The existing caption-capture path still triggers on `urlMatch || looksLikeCaptionBody(body)` (in both XHR and fetch handlers).
- `post(url, status, body)` is still called on caption matches.
- No `DEVELOPMENT.md` update is needed (no documented behavior changes; this is throwaway diagnostic).

- [ ] **Step 4: Commit**

Run:

```bash
cd /home/abishake/projects/learnwithsoju
git add extension/netflix-page-hook.js extension/netflix-adapter.js
git commit -m "$(cat <<'EOF'
Netflix dual-subs auto-prime: diagnostic round (gated by LWS_NX_DIAG)

Adds throwaway instrumentation to decide which auto-prime approach
is feasible before writing the feature. See spec
docs/superpowers/specs/2026-05-30-netflix-dual-subs-auto-prime-diagnostic-design.md

netflix-page-hook.js
  - LWS_NX_DIAG flag at top of IIFE.
  - isMediaSkip(url, ct) — skip filter for .ts/.m4s/.mp4 URLs and
    video|audio|image content-types.
  - escapeForLog(s) + diagLogFetch(transport, method, url, status, ct,
    bodyHead) — single-line log emitter.
  - XHR.open load handler and fetch override gain an additive
    diagnostic log emission gated on LWS_NX_DIAG && !isMediaSkip(...).
    Caption-capture path (urlMatch || looksLikeCaptionBody) preserved
    verbatim — only addition.

netflix-adapter.js
  - LWS_NX_DIAG flag at module scope.
  - activate() fires runDiagnosticProbeOnce(myGen) when the flag is on
    (fire-and-forget; generation-token gated so SPA-nav supersession
    discards a stale probe).
  - runDiagnosticProbeOnce awaits waitForVideoElement(5000) so
    window.netflix.* is populated before probing.
  - probeNetflixGlobals walks window.netflix to depth 4 (shapeWalk
    helper, cycle-aware via WeakSet, key/typeof only — no value
    payloads logged) and probes the candidate player-API surface
    (getAPI, videoPlayer.getAllPlayerSessionIds, per-session
    getVideoPlayerBySessionId, getTextTrackList, getCurrentTextTrack,
    plus discovery of any TextTrack/Subtitle-named prototype methods).
    Each probe wrapped in its own try/catch via probeCall; failures
    log "ERROR <message>" instead of throwing.

All gated by LWS_NX_DIAG = true. Flip to false (or delete the gated
blocks) in the same commit that implements the chosen auto-prime
approach. The capture/parse/cache/mount pipeline is unchanged.
EOF
)"
```

- [ ] **Step 5: Verify commit landed cleanly**

Run: `cd /home/abishake/projects/learnwithsoju && git log --oneline -2`
Expected: top line is the new commit, second is the prior commit.

Run: `cd /home/abishake/projects/learnwithsoju && git status`
Expected: `nothing to commit, working tree clean`.

- [ ] **Step 6: Report back**

Surface to the user:
- The commit SHA.
- Confirmation that `node --check` and `npm test` both passed.
- A reminder of the test plan from the spec: reload the extension at `chrome://extensions`, open a Korean Netflix watch page, hit play, watch ~30 seconds, toggle CC between Korean and English once, open DevTools console, filter for `[lws-nx-diag]`, paste output (expected: 30–80 lines).

---

## Notes for the executor

- The user prefers code + matching docs in one commit. This diagnostic is **throwaway** (will be deleted in the implementation commit per the spec's Cleanup section) and adds no behavior documented in `DEVELOPMENT.md`, so no doc update is expected. If you find yourself wanting to add a `DEVELOPMENT.md` section about the diagnostic, don't — by design it has the lifespan of "until we look at the dump."
- Console logs from `netflix-page-hook.js` (page-world) and `netflix-adapter.js` (isolated world) both land in the same DevTools page console. The `[lws-nx-diag]` prefix makes them filterable together.
- The page-hook IIFE runs only when injected — that happens in `injectHookOnce()` (adapter), which is called from `setup()`. So enabling `LWS_NX_DIAG` in the page-hook only takes effect on Netflix watch pages where the adapter mounted. Other pages don't see the page hook at all.
- If `node --check` fails at any step, do NOT proceed. Stop, share the error.
- If `npm test` shows a count other than 128 passing, do NOT proceed. Stop, share the failure — we changed nothing that touches a tested module, so a count change means something else regressed.

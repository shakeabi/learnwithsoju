# Netflix dual-subs auto-prime — diagnostic round

Date: 2026-05-30
Status: design, diagnostic-only (no implementation in this round)
Scope files touched by the diagnostic: `extension/netflix-page-hook.js`, `extension/netflix-adapter.js`

## Background

`extension/netflix-adapter.js` accumulates per-language subtitle tracks as
captures arrive via `window.addEventListener('message', …)` for the
`__lwsNxCaption` envelope posted by `extension/netflix-page-hook.js`. Once a
Korean track is cached and a paired secondary track is available, the adapter
mounts the dual-line overlay on the video. The capture → parse (TTML) → cache →
mount pipeline is working as of the most recent commits and is **not in scope
for this round**.

## Problem

Netflix only fetches subtitle assets for the track the user has actively
selected in the native CC menu. We therefore only ever capture one language at
a time. To get both Korean and (say) English cached, the user currently has to:

1. Open Netflix's CC menu.
2. Pick Korean — wait for our adapter to log a capture.
3. Re-open the menu and pick English — wait again.
4. Switch back to whichever they want displayed natively.

That manual priming dance is the only thing standing between us and a
"just works" dual-subs experience. The eventual feature: prime both languages
automatically once per video.

## Goal of this round

Decide **which auto-priming approach is feasible** before writing any
implementation. Four candidates are on the table, all equally speculative right
now:

1. Intercept Netflix's player manifest, extract per-language subtitle URLs, and
   `fetch()` them ourselves from the page context so the existing hook captures
   the bodies.
2. Programmatically click through Netflix's native CC menu DOM to trigger the
   real fetches.
3. Find Netflix's internal player API (rooted somewhere under
   `window.netflix.appContext.state.playerApp…`) and call a
   `setTextTrack`-equivalent directly.
4. Accept the limitation; show a one-time UI hint guiding the user through the
   manual priming.

We cannot choose intelligently without seeing (a) Netflix's real XHR traffic
around a CC toggle, and (b) the actual shape of `window.netflix` on a watch
page. The diagnostic in this spec produces exactly that data.

## Design

Two pieces of throwaway instrumentation, each gated by a single
`const LWS_NX_DIAG = true;` declared at the top of its file. Flipping that
constant to `false` (or deleting the gated blocks) removes all diagnostic
output without further edits.

### Piece 1 — verbose page-hook (in `extension/netflix-page-hook.js`)

Extend the existing `fetch` / `XMLHttpRequest` wrappers to log every non-media
request the page makes.

- Log line format (single line, no multi-line dumps):
  `[lws-nx-diag] fetch <METHOD> <url> → <status> (<content-type>) body="<first 200 chars, JSON-escaped>"`
  Use `xhr` instead of `fetch` for the XHR path. All HTTP methods (GET, POST,
  PUT, …) are in scope — Netflix's player APIs are commonly POSTs.
- Skip a request when **any** of these are true (video/audio/image noise):
  - URL contains any of: `.ts`, `.m4s`, `.mp4`, `init.mp4`
  - Response `content-type` starts with `video/`, `audio/`, or `image/`
- For text-ish bodies (JSON, XML, TTML, plain text), read up to the first
  200 chars of the response and include them in `body="…"`. For non-text or
  unreadable bodies, log `body=<binary>` and move on — never block the real
  request.
- Body capture must not interfere with Netflix's own consumption of the
  response: tee via `response.clone().text()` (fetch) or read `responseText`
  only after the original handler has fired (XHR).
- All diagnostic logging is wrapped in `if (LWS_NX_DIAG) { … }`.

Goal: surface (a) the manifest endpoint Netflix hits when the player starts
and (b) any "set track" / "select audio-track" style API calls Netflix issues
when the user toggles CC. Either is enough to evaluate approach 1.

### Piece 2 — active probe (in `extension/netflix-adapter.js` `activate()`)

Once per `activate()` session, after `waitForVideoElement(5000)` resolves
(line ~378 today), call a new local helper `probeNetflixGlobals()`. The probe
runs exactly once per activation (guarded by a session-scoped flag, cleared in
`deactivate()`).

`probeNetflixGlobals()` does two things:

1. **Shape walk.** Recursively walks `window.netflix.*`, depth limit 4, logging
   only the key tree — keys + value `typeof`, never the values themselves. One
   log line per traversed path, prefixed `[lws-nx-diag] shape `. Skips
   already-visited objects to avoid cycles.
2. **Candidate API probe.** Each candidate call wrapped in its own
   `try { … } catch (err) { … }`; never throws out of the probe. Each result
   logged as `[lws-nx-diag] probe <path>: <result-summary>` where
   `<result-summary>` is `typeof` + (for objects/arrays) own-key count, plus
   any returned IDs as a short list. Failures log
   `[lws-nx-diag] probe <path>: ERROR <err.message>`.

   Candidate calls, in order:
   - `netflix.appContext.state.playerApp.getAPI()`
   - `getAPI().videoPlayer.getAllPlayerSessionIds()`
   - For each returned session id:
     `getAPI().videoPlayer.getVideoPlayerBySessionId(id)`
   - On the resulting player object, probe (without invoking setters):
     `getTextTrackList()`, `getCurrentTextTrack()`, plus any
     `getTextTrack*` / `*TextTrack*` method names discovered via
     `Object.getOwnPropertyNames(Object.getPrototypeOf(player))`.

Goal: surface approach 3. If a `setTextTrack`-equivalent exists on the
internal player API, that's the clean programmatic path. If it doesn't, we
fall back to approach 1 using the manifest URL that piece 1 surfaced.

## What the user does with the output

1. Reload the extension at `chrome://extensions` (the only place to reload an
   unpacked Chrome extension).
2. Open a Korean Netflix watch page (`/watch/<id>`), hit play, let it run for
   ~30 seconds.
3. Open the CC menu, switch from Korean to English (or vice versa) once, then
   close the menu.
4. Open DevTools console, filter for `[lws-nx-diag]`.
5. Paste the filtered output back. Expected volume: 30–80 lines.

## Cleanup

When the follow-up spec picks an approach and implementation lands, the same
commit that lands the implementation flips `LWS_NX_DIAG` to `false` in both
files (or deletes the gated blocks and the constant entirely). Production
users never see `[lws-nx-diag]` log lines.

## Out of scope for this round

- Phase 2.4 popup module for the secondary-subs dropdown — that lands after
  manifest data is in hand.
- Any actual implementation of approaches 1, 2, or 3 — that's the next spec,
  written against the diagnostic output.
- The existing capture / TTML parse / per-language cache / dual-line overlay
  mount pipeline. It's working; don't touch it.

## Success criteria

The pasted diagnostic log gives a definitive answer to a single question:

> Which of approaches 1, 2, or 3 is feasible, and does the manifest list
> multiple language subtitle URLs (so approach 1 can prime languages the user
> hasn't selected)?

If the log answers that question, this round is done and we move to the
implementation spec. If it doesn't (e.g. neither the manifest nor a usable
player API showed up), the follow-up is another diagnostic round, not an
implementation guess.

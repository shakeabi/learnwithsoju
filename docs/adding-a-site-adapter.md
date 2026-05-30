# Adding a new site adapter

This is the **how-to walkthrough** for adding support for a new streaming
site (Disney+, Hulu, Crunchyroll, Viki, Naver TV, …). For the *reference*
description of the two existing adapters — including the gory bits of
YouTube's PoToken and Netflix's track-select dance — see
[`site-adapters.md`](site-adapters.md).

The goal of this guide is that you should be able to clone the YouTube
or Netflix structure and have a working dual-subs prototype on a third
site in an afternoon.

---

## What an adapter does

An adapter replaces a streaming host's native captions with a
**hover-friendly Korean + secondary-language overlay**, by capturing the
caption text the host is already loading, tokenizing it through mecab-ko,
mounting an overlay on top of the player, hiding the host's native
caption rendering, and keeping everything in sync as the user pauses,
seeks, switches episodes, or toggles CC on / off.

It plugs into a few shared systems:

- **Sentence extraction** (`content.js`) — the popup walks up from the
  hovered `.lws-word` to find the sentence container; your overlay's KO
  class needs to be in the registry's `sentenceContainer` selector so
  hovers inside your overlay get the right sentence context.
- **Auto-pause on hover** (`content.js`) — the popup pauses the video
  when hover starts inside `sentenceContainer`. Wire up `findVideo()` in
  the registry so this works.
- **Per-site disable** (`chrome.storage.local.disabledHosts`) — read it
  on activate, listen for changes, tear down when the host is disabled.
- **Dual-subs toggle** (`chrome.storage.sync.dualSubs<Site>`) — your own
  per-adapter setting so the user can turn just dual-subs off without
  killing the hover dictionary.
- **Secondary language** (`chrome.storage.sync.secondaryLang`) — same key
  YouTube and Netflix both read, plus an optional per-video / per-title
  override map in `chrome.storage.local.dualSubsOverrides<Site>`.

---

## The three files

Each existing adapter is a triple. Clone the shape:

```
extension/adapters/<site>/
  adapter.js     — isolated content-script world; orchestrates capture,
                   mount, teardown
  page-hook.js   — page main world (injected via <script> tag); accesses
                   site-specific player API and globals
  popup.js       — optional; per-site UI inside the toolbar popup (e.g.
                   secondary-language picker for the current title)
```

- **`adapter.js`** is loaded by `content.js` via `import()` (must be
  listed in `web_accessible_resources` for the dynamic import to work
  from a content script). Its default export is a `setup(api)` function
  that wires storage listeners, hooks page navigation events, injects
  `page-hook.js`, and kicks off `activate()`.
- **`page-hook.js`** is injected as a `<script src="chrome-extension://…">`
  tag appended to `<head>`. It runs in the page's main world so it can
  touch globals like `videoPlayer`, `ytInitialPlayerResponse`,
  `window.fetch`, `XMLHttpRequest.prototype.open` — none of which are
  reachable from the isolated content-script world. It communicates with
  the adapter over `window.postMessage` with a site-namespaced shape
  (see "postMessage protocol" below).
- **`popup.js`** is loaded by `pages/popup/popup.js` when the current
  tab matches your site. Its `renderSection({ tab, container })` export
  owns all DOM under `container`. Use this for site-specific controls
  like a secondary-language override picker.

---

## The registry entry

Add an entry to `SITE_CONFIGS` in `extension/core/site-configs.js`:

```js
{
  name: 'Disney+',
  hostnames: ['www.disneyplus.com'],
  // — OR — match: /(^|\.)disneyplus\.com$/,

  // CSS selector for the sentence-extraction ceiling. closest() walks up
  // from the hovered .lws-word; the FIRST matching ancestor wins, so put
  // your overlay's KO line class FIRST.
  sentenceContainer: '.lws-disneyplus-ko, .subtitle-container, .player-caption',

  // Returns the page's main <video> element (or null). Auto-pause on
  // hover hangs off this.
  findVideo: () => document.querySelector('video[data-testid="webPlayer"]')
    || document.querySelector('video') || null,

  // Optional per-site CSS injected into <head> only on matching hosts.
  // Useful for z-index fixes when the player overlays intercept hover
  // events. See Netflix's `.lws-word` z-index lift for an example.
  stylesheet: `
    .lws-word { position: relative; z-index: 2147483647; }
  `,

  adapter: 'adapters/disneyplus/adapter.js',
  popupModule: 'adapters/disneyplus/popup.js',   // optional
}
```

The field-by-field reference is in the JSDoc at the top of
`extension/core/site-configs.js` — read that for the full behaviour of
`sentenceContainer` (including its dual role as the auto-pause gate)
and the rules for `stylesheet` scoping.

---

## What every adapter must do (the contract)

The two existing adapters converged on this shape; the new one should
match it.

1. **Generation tokens for async safety.** Every `activate()` and
   `deactivate()` bumps `activeGeneration`. After every `await` inside
   `activate()`, re-check that your snapshot still equals
   `activeGeneration`; if not, abort silently and don't mount anything.
   Without this, two activates racing (e.g. an SPA-nav firing while
   capture is still in flight) will both mount overlays and only one
   teardown closure wins, leaving the other orphaned.
2. **Wait for the player to actually be playing** before capturing
   tracks. YouTube's `waitForPlaying` is the template: snapshot
   `activeGeneration`, short-circuit if `!video.paused`, otherwise
   attach a one-shot `'playing'` listener with a 10 s fallback
   timeout. If `activeGeneration` has bumped by the time the event
   fires, resolve as `'stale-generation'` and bail. This eliminates the
   race where the player's caption / tracklist infrastructure isn't
   ready yet on slow-loading pages.
3. **Subscribe to settings changes.** Wire `chrome.storage.onChanged` to
   react to:
   - Per-site disable (`local.disabledHosts`) — deactivate + maybe
     activate.
   - Dual-subs toggle (`sync.dualSubs<Site>`) — same.
   - Default secondary language (`sync.secondaryLang`) — re-activate so
     the new default applies (unless the current video has an override).
   - Per-video / per-title override (`local.dualSubsOverrides<Site>`) —
     re-activate if the change is for the currently-loaded title.
4. **Hide native captions while the dual overlay is mounted**, via a
   CSS injection or per-site mechanism. Remove the hide-CSS on teardown
   so the native captions can render again.
5. **Listen for the host's native CC toggle** if it has a clear one. The
   YouTube adapter polls `player.getOption('captions','track')` every
   500 ms and toggles the overlay between hidden and shown so the
   host's CC button stays the user's master on/off switch.
6. **On teardown**: remove your overlay, detach the hide-CSS style tag,
   clear timers / intervals / observers, remove listeners. Set
   `teardownFn = null` so re-activation can clean re-enter.

---

## Capture strategies — pick the right one for your site

Captions come in three flavors depending on what the site exposes.
Try them in this order:

### 1. Player API call (preferred)

The site's player exposes a method that triggers a caption fetch. The
adapter (via page-hook) calls that method, the page-hook's
XHR / fetch monkey-patches observe the resulting request, and the body
is posted back to the adapter.

- **YouTube**: `player.setOption('captions', 'track', { languageCode, kind })`
  forces the player to load that track. The hook observes the
  resulting `/api/timedtext?…` URL + body.
- **Netflix**: `videoPlayer.getVideoPlayerBySessionId(sid).setTextTrack(track)`
  forces a TTML fetch. The hook captures it the same way.

This is the most reliable strategy because you're observing requests the
player itself is making, which means any auth / signing / token logic
the player computes is already attached. (YouTube's PoToken story is the
textbook example — third-party fetches of the unsigned URLs return 200
+ 0 bytes; only the player's own URLs work.)

### 2. XHR / fetch sniff (passive)

Page-hook monkey-patches `XMLHttpRequest.prototype.open` and
`window.fetch` from the moment the page loads. Whenever a response
matches a caption-shaped URL (filename, path, content-type), it captures
the body and posts it to the adapter. The adapter then asks the user (or
auto-switches) into the language it wants and waits for the body to
land.

Netflix uses this as the underlying mechanism for the track-select
dance, and also as the fallback when the dance fails (the user manually
toggles a track in the CC menu and the body-sniff path picks it up).

### 3. DOM observation (last resort)

`MutationObserver` on a caption container, scrape the text directly. Use
this only when the site doesn't expose a player API and doesn't fetch
captions over the network (e.g. canvas-rendered or WebSocket-streamed
captions).

Drawback: you only see the *currently visible* line, so you can't
prefetch the whole track up front and you can't time-sync ahead.

---

## postMessage protocol — site-namespaced

The adapter (isolated world) and page-hook (main world) communicate over
`window.postMessage`. **Always namespace your message keys with the site
code** so multiple adapters on the same domain wouldn't collide:

```js
// adapter → hook
window.postMessage({ __lwsXxCmd: 'load-track', reqId: 'req-1', lang: 'ko' }, '*');

// hook → adapter (caption body landed)
window.postMessage({ __lwsXxCaption: true, url, status, body }, '*');

// hook → adapter (reply to a command)
window.postMessage({ __lwsXxReply: 'load-track', reqId: 'req-1', ok: true }, '*');
```

Conventions worth following:

- `__lws<Site><Verb>` for the discriminator key. YouTube uses
  `__lwsYtCmd`, `__lwsYtReply`, `__lwsYtCaption`; Netflix uses
  `__lwsNxCmd`, `__lwsNxCaption`, `__lwsNxManifest`. Two letters for
  the site is plenty.
- **`reqId`** on commands that expect a reply, so the adapter can match
  the right reply when multiple commands are in flight.
- **Hook is idempotent**: the IIFE checks
  `window.__lws<Site>HookInstalled` first and returns if already set.
  Re-injecting the script on SPA navigation is then a no-op.
- **Always check `event.source === window`** in your message handlers
  to avoid picking up messages from iframes or other extensions.

---

## Manifest.json updates

Three sections need an addition when you add a site:

1. **`host_permissions`** — if your adapter needs to fetch anything
   directly from the host (e.g. captions, manifests). Hover lookups
   already work everywhere via the wildcard content script; you only
   need this if you're issuing your own `fetch()` calls cross-origin.
2. **`content_scripts[].matches`** — already `<all_urls>` for the
   shared `content.js`, so usually no change needed. Only adjust if
   you want your adapter to run more narrowly than the rest.
3. **`web_accessible_resources[].resources`** — add **both** your
   `adapter.js` and your `page-hook.js`. The adapter needs WAR because
   `content.js` does `await import(chrome.runtime.getURL(adapter))` and
   that fails for non-WAR files. The page-hook needs WAR because we
   inject it as a `<script src="chrome-extension://…">` tag.

```json
"web_accessible_resources": [
  {
    "resources": [
      "...",
      "adapters/disneyplus/adapter.js",
      "adapters/disneyplus/page-hook.js"
    ],
    "matches": ["<all_urls>"]
  }
]
```

The popup module (`adapters/<site>/popup.js`) does **not** need WAR
because `pages/popup/popup.js` runs in the extension context, not the
content-script context.

---

## Testing checklist

Once you have a candidate adapter wired up:

- [ ] **Basic hover works**: load a video on the site, hover any Korean
      word in the captions → popup appears with definition. (If this
      doesn't work, the issue is in `sentenceContainer` or the
      content-script DOM walk, not your adapter — the hover dictionary
      should work *before* the dual-subs adapter is even loaded.)
- [ ] **Auto-pause on hover**: hover a Korean word while the video is
      playing → it pauses. Move mouse away → it resumes (unless the user
      paused it manually meanwhile). This depends on `findVideo()`
      returning the right element AND the hovered word being inside the
      `sentenceContainer` selector.
- [ ] **Dual overlay mounts**: with a Korean caption track available,
      the dual-language overlay appears stacked above the original
      caption position, native captions are hidden.
- [ ] **Secondary language switches** when you change it from the
      toolbar popup → re-activate fires, overlay re-renders with the
      new language.
- [ ] **CC toggle on the host** (if it has one): turning CC off in the
      host's own UI hides the overlay; turning CC back on shows it.
- [ ] **SPA navigation**: navigate to a new episode → previous video's
      overlay torn down, new one mounts with the new episode's captions.
      If the site's React reconciler is too racy to reliably tear down
      mid-flight, do what the YouTube adapter does: hard-reload on
      video-id change (set `window.location.href = newUrl`). Costs
      ~1–2 s per swap but sidesteps every race.
- [ ] **Pause / resume / seek**: overlay stays in sync with the video.
      `timeupdate` is the cheapest event but `seeking` / `seeked` give
      you a guaranteed callback after a scrub.
- [ ] **Per-site disable**: open toolbar popup → toggle off → overlay
      tears down, native captions reappear. Toggle back on → overlay
      reactivates without a page reload.
- [ ] **Per-site dual-subs toggle**: same as above, but only kills the
      overlay (hover dictionary should still work).

---

## Reference implementations

- **YouTube** — `extension/adapters/youtube/{adapter,page-hook,popup}.js`.
  Most intricate code path in the extension. Uses the **player API call**
  capture strategy. See [`site-adapters.md`](site-adapters.md) for the
  PoToken story, the CC-bound visibility state machine, the hard-reload-
  on-video-id-change rationale, and the audio-language-detection
  postmortem.
- **Netflix** — `extension/adapters/netflix/{adapter,page-hook,popup}.js`.
  Uses the **player API call** capture strategy via the track-select
  dance, with the **XHR/fetch sniff** as both the underlying capture
  mechanism and the fallback when the dance fails. See
  [`site-adapters.md`](site-adapters.md) for the dance steps, the
  per-language cache, and the manifest-interception dormant fallback.

When in doubt, pick whichever existing adapter is closer in spirit to
your target site (single-page app like YouTube vs. multi-route shell
like Netflix) and clone its structure.

# Site adapters — YouTube and Netflix

Both adapters replace the host's native captions with a dual-language
overlay (Korean on top, the user's preferred secondary language
below) and make the Korean line hoverable like any other text on the
page. The two adapters use different strategies because the hosts
expose different APIs.

Related reading:
- [message-flows.md](message-flows.md) — adapter ↔ page-hook
  postMessage protocol
- [extension-surfaces.md](extension-surfaces.md) — the per-site
  toolbar-popup sections (`youtube-popup.js`, `netflix-popup.js`)
- [storage-and-caching.md](storage-and-caching.md) — `dualSubsOverrides`
  / `dualSubsOverridesNetflix` per-video/title override maps

---

## YouTube

The most intricate code path in the extension. Files involved:
`content.js`, `site-configs.js`, `youtube-adapter.js`,
`youtube-page-hook.js`, `youtube-popup.js`.

### Why a page-world hook is needed

YouTube serves captions through `/api/timedtext?caps=...&lang=ko&pot=...&signature=...`.
The `pot=...` parameter is a PoToken computed by the player's
BotGuard runtime; the `signature=...` is signed and includes a list
of `sparams` (signed parameters).

The URLs you can read from
`ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer.captionTracks[].baseUrl`
are missing the PoToken. A third-party fetch of one of those URLs
returns 200 OK and 0 bytes — YouTube serves you a successful-looking
but empty response.

The ONLY caption URLs that actually return data are the ones the
player generated for itself. So we have to:

1. Tell the player to load the track we want.
2. Observe the network request the player makes for it.
3. Capture the response body.

Steps 1 and 2 both require access to page-world globals
(`html5VideoPlayer.setOption`, intercepting `window.fetch` /
`XMLHttpRequest.prototype.open`). Content scripts can't reach those,
so we inject `youtube-page-hook.js` as a `<script src>` tag and
communicate over `window.postMessage`.

### The activate sequence

1. `content.js`'s `init` resolves `siteConfig` for the current
   hostname; for `youtube.com` this returns the YouTube config with
   `adapter: 'youtube-adapter.js'`.
2. After scanning the page and setting up handlers, `init` dynamic-
   imports the adapter and calls `setup({ unwrap, rescan })` — the
   two callbacks let the adapter ask content.js to strip and re-
   apply `.lws-word` wrapping around SPA navigations (see
   "Hard reload on video_id change" below).
3. `youtube-adapter.js`'s `setup(api)`:
   1. Stashes `api.unwrap` / `api.rescan` (no-ops if missing).
   2. Registers `chrome.storage.onChanged` listener.
   3. Registers `chrome.runtime.onMessage` for `lws-yt-popup-info`.
   4. Wires `yt-navigate-start` → `handleNavStart` (deactivate +
      unwrap) and `yt-navigate-finish` → `handleNavFinish` (after
      250 ms: activate + rescan).
   5. `injectHookOnce()` — appends a
      `<script src=chrome-extension://.../youtube-page-hook.js>` tag
      to `document.head`. The hook's IIFE checks
      `window.__lwsYtHookInstalled` to be idempotent.
   6. `activate()` — bumps `activeGeneration`, tears down any
      existing overlay, guards on `/watch` and `isEnabled()`, then
      awaits `initForCurrentVideo()`. After each await it re-checks
      `myGen === activeGeneration` and discards its own work if a
      newer activate/deactivate has preempted it.

4. `initForCurrentVideo`:
   1. `waitForVideoElement` polls
      `document.querySelector('video.html5-main-video')` up to 10 s.
   2. **`waitForPlaying` — gate on the video's `playing` event.**
      Snapshots `activeGeneration` at call time, then short-circuits
      immediately if the video is already playing. Otherwise
      attaches a one-shot `'playing'` listener. If the event fires
      after a SPA-nav has bumped `activeGeneration` the callback
      resolves as `'stale-generation'` and the function returns
      `null` without mounting anything. A 10-second fallback timeout
      rejects the promise and `initForCurrentVideo` logs the named
      reason and continues rather than blocking forever. This
      eliminates the race where the player's caption/tracklist
      infrastructure isn't ready yet on slow-loading pages.
   3. `waitForTracklist` merges two sources every iteration:
      `player.getOption('captions','tracklist')` (rich metadata but
      unreliable for ASR-only videos — the player sometimes returns
      [] until the user enables CC manually) AND a fresh
      `player.getPlayerResponse().captions.playerCaptionsTracklistRenderer.captionTracks`
      (always present, complete, but thinner shape, AND updated per
      SPA-nav). Dedupes by `(languageCode, kind)`. Polls every
      250 ms for up to 10 s.
   4. **No separate audio-language gate.** Whether to engage dual
      subs is decided entirely by `pickPrimarySource`: if the
      tracklist contains any Korean track (manual or ASR), engage;
      otherwise skip. See "Audio-language detection postmortem"
      below for the history.
   5. `resolveSecondaryLang(videoId)` — per-video override (from
      `local.dualSubsOverrides`) wins over `sync.secondaryLang`,
      which defaults to `'en'`.
   6. `pickPrimarySource(tracklist)` and `pickSecondarySource` —
      see "Track-source priority" below.
   7. **Snapshot CC state** via `readCurrentTrack()` (posts
      `{__lwsYtCmd:'get-track'}`). The user's pre-capture choice
      — `{}` for CC off, `{languageCode, kind}` for a selected
      track. We save it so we can restore it after the next step.
   8. For each unique base track involved, `captureBaseTrack(lang)`
      posts `{__lwsYtCmd:'load-track', lang}`, then waits for a
      `__lwsYtCaption` postMessage whose URL has `lang=…` and no
      `tlang=` (signaling it's the original, not an auto-translation).
   9. **Restore CC state** via `restoreTrack(initialTrack)`. If the
      user had CC off, we post `{__lwsYtCmd:'clear-track'}` to put
      it back off. If they had a track selected, we re-`load-track`
      that one. We deliberately do NOT keep the player parked on KO
      — the CC button is the user's master switch.
   10. `materializeLines` — for each source, either parse the
       captured body directly (`parseJson3` or `parseSrv1Xml`), or
       refetch the captured URL with `&tlang=<target>` appended.
       The signed `sparams` don't include `lang`/`tlang`, so
       YouTube's signature still validates the second URL.
   11. Mount the overlay on `.html5-video-player` (the player root —
       NOT `.html5-video-container`, which has wrong positioning).
       The overlay starts hidden (`display:none`) and only becomes
       visible when the CC observer (below) classifies the state as
       `CC_ON`.
   12. **CC observer**: a 500 ms `setInterval` polls
       `readCurrentTrack()` and classifies the result into a
       2-state machine — `CC_OFF`, `CC_ON` (plus `TRACK_UNKNOWN`
       sentinel). On transitions:
       - `CC_OFF` → overlay hidden, native-caption hider stylesheet
         removed (so YouTube's own caption window is free to render).
       - `CC_ON` / `TRACK_UNKNOWN` → overlay shown, native-caption
         hider stylesheet injected, and the time-sync loop attaches.
       This makes YouTube's CC button the user's master on/off
       toggle, regardless of which language is active.
   13. Attach `timeupdate` / `seeking` / `seeked` listeners on the
       video element. Each tick does a binary search over the lines
       array (`findLineIdx`) and updates the KO and EN `<div>`s.

5. Teardown: returned closure clears the CC poll interval, removes
   listeners, detaches the overlay, detaches the style tag (if
   currently mounted).

### Track-source priority

`pickPrimarySource(tracks)`:

1. Manual KO track (kind !== 'asr') → use directly, target='ko',
   translate=false.
2. KO ASR (auto-generated) → use directly.

We deliberately don't fall back to translating another language's
manual track into Korean. Auto-translated KO from e.g. an English
manual track is misleading for learners — the wording, register,
and morphology won't match what's actually being spoken. KO ASR is
imperfect but at least reflects the actual audio.

`pickSecondarySource(tracks, targetLang)`:

1. Manual track in target lang → direct.
2. Any manual track (not in target lang) → translate to target via
   `&tlang=<target>`.
3. Any ASR track → translate to target via `&tlang=<target>`.

If `secondaryLang === 'off'`, skip and only render the Korean line.

When the primary and secondary derive from the same base language
(e.g. primary is "KO ASR direct" and the user's secondary is
translated from that same ASR), we only capture that base once.

### ASR badge

When the primary source is YouTube's ASR (`isAsr(primary.baseTrack)`
is true), the adapter adds an `is-asr` class to the KO line, which
triggers a CSS pseudo-element:
`.lws-ytsubs-ko.is-asr::before { content: '(auto) '; … }`. The
badge tells the learner they're reading machine transcription rather
than creator-provided text. It's intentionally a pseudo-element
rather than a real DOM child: `textContent` of `.lws-ytsubs-ko` is
what `extractSentence` uses for sentence context and what the Ask
AI pill bakes into its prompt, and pseudo-element content doesn't
show up in `textContent`.

### Hard reload on video_id change

Earlier iterations tried a graceful SPA-style teardown when the
player swapped videos — listen for `yt-navigate-start/finish`, also
poll `player.getVideoData().video_id` as a safety net for autoplay
(which doesn't always fire those events), and on change run
`hostUnwrap()` + deactivate + re-activate. This kept losing races
against YouTube's React reconciler: stale `.lws-word` wrappers from
the previous video's title/description would be adopted by the next
video's containers and the new title would get appended to the old
text ("AB" mangling).

**Current behaviour**: hard reload. When the 500 ms `video_id` poll
sees the id change, set `window.location.href` to the new `?v=`
URL. ~1–2 s reload cost per swap, but the new page is guaranteed
clean. The poll skips while `reloadOnVideoIdChange` is false (e.g.
during deactivate or before the first successful activation).

The `video_id` signal is always-fresh — during autoplay the player
swaps to the next video's `video_id` immediately, but `?v=` in
`location.href` can lag by hundreds of ms (long enough for YouTube
to re-render the title / description containers, which is what
created the "AB" mangling in the first place).

### CC visibility: fail-open state machine

The CC poll classifies `player.getOption('captions','track')` into
`CC_OFF | CC_ON` (plus `TRACK_UNKNOWN` sentinel) and toggles the
overlay accordingly. The state machine is language-agnostic:
`CC_ON` shows the overlay regardless of which language YouTube has
selected. This is intentional — dual-subs users almost always have
EN CC active while listening to KO audio, so gating visibility on
"is the track Korean?" defeats the feature. Only an explicit
`null` (player returned `{}` — CC genuinely off) hides the overlay.
`TRACK_UNKNOWN` (read error / not-ok hook reply) fails open to
`CC_ON` so a transient failure doesn't hide captions the user opted
into.

`restoreTrack` is a no-op on `UNKNOWN` / empty snapshots — calling
`clear-track` after a failed initial read was silently disabling CC
the user may have had on.

### Per-video override (toolbar popup)

See `youtube-popup.js` in [extension-surfaces.md](extension-surfaces.md).
Briefly: the popup writes the user's selection to
`chrome.storage.local.dualSubsOverrides` keyed by videoId; the
adapter's `onChanged` listener picks it up and re-activates.

### Audio-language detection postmortem

There used to be an "audio-language gate" that tried to inspect the
spoken language and skip dual subs when it wasn't Korean. It went
through three iterations and we eventually deleted it entirely.

**Attempt 1: page-hook reads `window.ytInitialPlayerResponse`** —
the global has rich data including `audioTracks[]` and ASR language.
**Problem**: that global is set ONCE at page load and YouTube does
NOT refresh it on SPA navigation (next video in playlist, autoplay,
in-page click on a related video). After any in-page nav, the
detection returned the FIRST video's audio language for every
subsequent video. Symptom: "audio is en, skipping" on Korean videos
auto-played from a Korean drama list when the page had originally
loaded on an English video.

**Attempt 2: page-hook reads `player.getPlayerResponse()`** — the
IFrame Player API has this method, so we tried calling it on the
inline player element. **Problem**: it doesn't reliably exist on the
inline player. The hook's `getCurrentPlayerResponse()` helper fell
through to `ytInitialPlayerResponse` and you were back to attempt
1's staleness.

**Attempt 3: adapter reads tracklist's ASR track language** — the
tracklist is always fresh for the current video, and ASR tracks
carry the audio language. **Problem**: redundant. YouTube only
generates ONE ASR per video (in the audio language), so "tracklist's
ASR is non-Korean" implies "tracklist has no KO ASR" — and
`pickPrimarySource` already skips when no KO track exists.

**Current behaviour**: no gate. `pickPrimarySource(tracklist)`
returns null iff the tracklist has no Korean entry; in that case we
skip. Auto-translated KO via `tlang=…` is NOT in the tracklist
(it's derived on demand), so an English-only video with no creator-
provided KO simply has no KO entry and skips correctly.

---

## Netflix

Netflix is partway through Phase 2 (dual-subs overlay). Files
involved: `content.js`, `site-configs.js`, `netflix-adapter.js`,
`netflix-page-hook.js`, `netflix-popup.js`.

### The track-select dance (auto-prime)

Netflix exposes a populated text-track list via its player API
(`videoPlayer.getVideoPlayerBySessionId(sid).getTextTrackList()`)
where each entry has `bcp47`, `trackId`, `rawTrackType`, and
metadata flags (`isNoneTrack`, `isForcedNarrative`, `isImageBased`)
— but **no fetchable URLs**. To force Netflix to download a track's
TTML, you have to actually `setTextTrack` it.

The dance (in `netflix-page-hook.js`, kicked off from the adapter's
`activate()`):

1. Snapshot the user's currently-selected text track.
2. `setTextTrack(koreanTrack)` — Netflix fetches its TTML; our
   XHR/fetch monkey-patches capture the body and post it to the
   adapter via `__lwsNxCaption`.
3. Wait for the capture to land.
4. `setTextTrack(secondaryTrack)` — same dance for the user's
   secondary language.
5. Wait again.
6. `setTextTrack(originalTrack)` — restore the user's choice.

The hide-CSS that suppresses Netflix's native captions is injected
up-front in `activate()` so the brief flicker during steps 2-6 is
invisible to the viewer.

### KO is hard-required

If no Korean track is in the list, the dance logs `no Korean track
in list — dual-subs disabled for this title` and bails. Dual-subs
without Korean is meaningless for the learn-Korean use case.

### Per-track preferences

- KO prefers `rawTrackType: 'CLOSEDCAPTIONS'` over `'SUBTITLES'`
  (CC has sound annotations + more on-screen text, which matches
  what a learner wants to read along with).
- Secondary prefers `'SUBTITLES'` over `'CLOSEDCAPTIONS'` (cleaner
  L1 reading without sound effects).

### Secondary-language resolution

Per-title override (`chrome.storage.local.dualSubsOverridesNetflix[titleId]`)
→ configured `secondaryLang` (`chrome.storage.sync`, default `'en'`)
→ hard fallback `'en'` → bail.

KO and secondary use a loose BCP-47 match (`'zh'` matches any
`'zh-*'`; `'zh-TW'` matches only `'zh-TW'`/`'zh-Hant'`/`'zh-HK'`)
so manifests with region-suffixed lang codes don't slip through.

### Per-language cache (`tracksByLang`)

Captured TTML is parsed in the isolated world by
`netflix-adapter.js`'s `parseTtml` (handles Netflix's IMSC1 tick-
based time format) and cached per language in a `tracksByLang` Map,
keyed by normalized `xml:lang`. When both plain and CC variants of
the same language arrive, the CC variant wins.

### Overlay rendering

A dual-language overlay mounts on the player as soon as a Korean
track is captured. The overlay shows KO alone if only Korean has
been captured so far; once a secondary track arrives (typically
moments later via the same dance, but also if the user manually
toggles a language in Netflix's CC menu), the overlay re-renders
with both lines.

### Fallback paths

- **Manual toggle**: if the dance fails for any reason (Netflix
  changes the player API, `setTextTrack` throws, the track list
  never populates within the 45 s window), the user can still
  toggle a language in Netflix's CC menu and the page-hook's body-
  sniff path will pick up the TTML and feed the cache.
- **Manifest interception** (`__lwsNxManifest`): legacy auto-prime
  path. The hook sniffs JSON manifest responses for a
  `timedtexttracks` array and posts the normalized list to the
  adapter (`onManifest` / `primeFromManifest`). Almost never lands
  usable URLs in practice (Netflix's manifest is MSL-encrypted) but
  is kept as a no-cost belt-and-braces fallback.
- **Diagnostic probes** (`LWS_NX_DIAG_PRIME`, `LWS_NX_DIAG_API`):
  three rounds of API discovery (commits `f9795ea`, `6523a55`,
  `d789702`, `a32052d`) confirmed how Netflix's player API exposes
  `getTextTrackList()` / `setTextTrack()`. The probe code remains
  in `netflix-page-hook.js` gated off behind those flags — dormant
  diagnostics in case Netflix shifts shape and we need to re-
  discover.

### `[lws-nx-prime]` console logs

Trace which path succeeded (dance / manifest / manual). Useful for
diagnosing why a title isn't getting dual subs.

### Gating

Activation gates on the `dualSubsNetflix` toggle
(`chrome.storage.sync`) — matching the YouTube adapter's
`dualSubsYouTube` gate. When the toggle is off, `isEnabled()`
returns false and no overlay is mounted. The options page exposes
the toggle under Behaviour → "Dual subtitles on Netflix". The
`onChanged` listener reacts live: flipping off deactivates
immediately; flipping on calls activate.

---

## Per-site adapter principles (apply to both)

- **`sentenceContainer` must include your overlay's KO class**: if
  your adapter hides the host's native caption containers AND mounts
  its own overlay, the host's `sentenceContainer` selector in
  `site-configs.js` MUST also list your overlay's KO container
  class. Without it, `closest(selector)` on a hovered `.lws-word`
  inside your overlay returns null, `extractSentence` falls back to
  its default block walk, AND `pauseVideoIfApplicable` silently
  doesn't fire. Both the YouTube and Netflix entries list their
  overlay classes first (`.lws-ytsubs-ko, …` and `.lws-nxsubs-ko, …`
  respectively).
- **Async guards need generation tokens**. Anything that does
  `deactivate(); await initThing(); mount(...)` needs to handle the
  user / host re-triggering before `initThing()` resolves. Bump a
  counter in every entry-and-exit, compare after each `await`, tear
  down your own work on supersession. See `activeGeneration` in
  `youtube-adapter.js`.
- **Page-hook idempotence**. The hook IIFEs check
  `window.__lwsYtHookInstalled` / `window.__lwsNxHookInstalled` so
  re-injecting on SPA navs is a no-op.
- **Per-host stylesheets in `site-configs.js`'s `stylesheet`
  field**. Used to promote `.player-timedtext` above Netflix's
  player-controls overlay so the controls don't intercept hovers.
  See `site-configs.js` for examples.

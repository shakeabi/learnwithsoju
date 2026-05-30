# Message flows

Every cross-context communication path in the extension. The two
big-ticket items are (a) content↔background dictionary requests, and
(b) the page-hook command channels between the isolated content
world and the page main world (YouTube + Netflix).

Related reading:
- [architecture-overview.md](architecture-overview.md) — visual map
  of who talks to whom
- [storage-and-caching.md](storage-and-caching.md) — settings
  propagate via `chrome.storage.onChanged` as a side-channel
- [site-adapters.md](site-adapters.md) — adapter-specific message
  semantics

---

## `chrome.runtime.sendMessage` — content / popup / inspector → background

All routed through `background.js`'s `chrome.runtime.onMessage`
listener, which dispatches by `msg.type`. Returning `true` from the
listener keeps `sendResponse` open across the async boundary.

| `msg.type`     | Payload                                                | Response                                                                                                       | Notes                                                                                                              |
| -------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `lookup`       | `{ surface: string }`                                  | `LookupResponse` (see [lookup-pipeline.md](lookup-pipeline.md))                                                | Async. Surface-keyed cache hit returns immediately.                                                                |
| `lookupHanja`  | `{ chars: string }`                                    | `{ chars, hanjas: [{character, sino, summary}], cachedAt }` or `{ chars, error, ... }`                          | Async. Failures (5xx/429) are NOT cached so the next click retries.                                                |
| `openOptions`  | `{}`                                                   | `{ ok: true }`                                                                                                 | Sync; `chrome.runtime.openOptionsPage()`.                                                                          |
| `ping`         | `{}`                                                   | `{ ok: true }`                                                                                                 | Sync; used to wake the SW.                                                                                         |
| `warmup`       | `{}`                                                   | `{ ok: true }`                                                                                                 | Sync response; fires `ensureMecab()` + `ensureSettings()`. Sent from `content.js` `init()` so first hover doesn't pay the dict-fetch+inflate stall. The SW also self-warms on `onInstalled` and `onStartup`. |
| `clearCache`   | `{ target?: 'lookup' \| 'hanja' \| 'dict' \| 'all' }`  | `{ ok: true, cleared: {...} }` or `{ ok: false, error }`                                                       | Async. `target` defaults to `'all'`. `'lookup'` clears `lookup:` only; `'hanja'` clears `hanja:` only; `'dict'` clears both `krdict:` and `opendict:`; `'all'` clears all four. |
| `cacheCounts`  | `{}`                                                   | `{ ok: true, counts: { lookup: N, hanja: N, krdict: N, opendict: N } }` or `{ ok: false, error }`              | Async. Scans `chrome.storage.local` keys by prefix. Powers the live `(~N)` suffix on each options-page button.     |
| `mecab-inspect`| `{ text: string, nbest?: number }`                     | `{ singlePath, nbestPaths, candidates }` (or `{}` on failure)                                                  | Async. Drives the morpheme-inspector page. Re-uses `ensureMecab()`; serializes every field of every token.         |

---

## `chrome.tabs.sendMessage` — popup module → content / adapter

Each site's popup module (e.g. `adapters/youtube/popup.js`,
`adapters/netflix/popup.js`) talks to its content-script-side
adapter using a site-specific message type. The generic
`pages/popup/popup.js` shell doesn't send these — only the
dynamic-imported module does.

| `msg.type`           | From                          | To                 | Response                                                                                                          |
| -------------------- | ----------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `lws-yt-popup-info`  | `adapters/youtube/popup.js`   | content script tab | `adapters/youtube/adapter.js`: `{ active, videoId, tracks: [{languageCode, languageName, kind, vssId}], secondaryLang }`   |
| `lws-nx-popup-info`  | `adapters/netflix/popup.js`   | content script tab | `adapters/netflix/adapter.js`: `{ active, titleId, tracks: [{code, languageName, captionedness}], secondaryLang }`         |
| `lws-site-info`      | `pages/popup/popup.js`        | content script tab | `content.js`: `{ host, protocol, href }` — fallback for when `chrome.tabs.query` returns an undefined `tab.url`   |

The adapter `onMessage` listeners intercept before `content.js`'s
normal lookup paths see them. `lws-site-info` lets the popup avoid
relying on the tabs API for the hostname (some Chrome states return
`tab.url === undefined` even with `activeTab` granted; the content
script always knows its own `window.location.hostname`).

---

## `window.postMessage` — isolated content world ↔ page main world

Both adapters bridge into the page main world via injected
`<script src>` hooks because content scripts can't see page expandos
like `html5VideoPlayer.getOption` or `window.netflix.appContext`.

### YouTube command channel (`adapters/youtube/page-hook.js`)

| Direction                   | Shape                                                              | Sent by                        | Handled by                       |
| --------------------------- | ------------------------------------------------------------------ | ------------------------------ | -------------------------------- |
| isolated → main             | `{ __lwsYtCmd: 'tracklist', reqId }`                               | `adapters/youtube/adapter.js`  | `adapters/youtube/page-hook.js`  |
| isolated → main             | `{ __lwsYtCmd: 'player-response-tracks', reqId }`                  | `adapters/youtube/adapter.js`  | `adapters/youtube/page-hook.js`  |
| isolated → main             | `{ __lwsYtCmd: 'load-track', reqId, lang }`                        | `adapters/youtube/adapter.js`  | `adapters/youtube/page-hook.js`  |
| isolated → main             | `{ __lwsYtCmd: 'get-track', reqId }`                               | `adapters/youtube/adapter.js`  | `adapters/youtube/page-hook.js`  |
| isolated → main             | `{ __lwsYtCmd: 'clear-track', reqId }`                             | `adapters/youtube/adapter.js`  | `adapters/youtube/page-hook.js`  |
| isolated → main             | `{ __lwsYtCmd: 'video-id', reqId }`                                | `adapters/youtube/adapter.js`  | `adapters/youtube/page-hook.js`  |
| main → isolated             | `{ __lwsYtReply: 'tracklist', reqId, tracks }`                     | hook                   | `awaitHookReply` in adapter |
| main → isolated             | `{ __lwsYtReply: 'player-response-tracks', reqId, tracks }`        | hook                   | `awaitHookReply` in adapter |
| main → isolated             | `{ __lwsYtReply: 'load-track', reqId, ok, error? }`                | hook                   | adapter (fire-and-forget)   |
| main → isolated             | `{ __lwsYtReply: 'get-track', reqId, ok, track, error? }`          | hook                   | `readCurrentTrack` in adapter |
| main → isolated             | `{ __lwsYtReply: 'clear-track', reqId, ok, error? }`               | hook                   | adapter (fire-and-forget)   |
| main → isolated             | `{ __lwsYtReply: 'video-id', reqId, videoId }`                     | hook                   | SPA-nav poll in adapter     |
| main → isolated (broadcast) | `{ __lwsYtCaption: true, url, status, body }`                      | hook (XHR/fetch tap)   | `captureCaption` in adapter |

The `clear-then-set` pattern lives inside `load-track` itself: the
hook first calls `player.setOption('captions', 'track', {})` to force
a fresh `/api/timedtext` fetch even when the player thinks it already
has the target loaded, then calls
`player.setOption('captions', 'track', { languageCode: lang })`.

There used to be an `audio-info` command pair here too. Removed in
favour of the simpler "is there even a Korean track in the
tracklist?" gate — see the SPA-nav postmortem in
[site-adapters.md](site-adapters.md).

### Netflix command channel (`adapters/netflix/page-hook.js`)

The Netflix hook is partly a passive sniffer (subtitle bodies arrive
unsolicited via XHR/fetch monkey-patches) and partly an active
controller (the track-select dance drives `setTextTrack` on the
player API).

| Direction                   | Shape                                                              | Sent by                | Handled by                  |
| --------------------------- | ------------------------------------------------------------------ | ---------------------- | --------------------------- |
| main → isolated (broadcast) | `{ __lwsNxCaption: true, url, status, body }`                      | hook (XHR/fetch tap)   | `captureCaption` in adapter |
| main → isolated (broadcast) | `{ __lwsNxManifest: true, tracks }`                                | hook (JSON manifest sniff) | `onManifest` in adapter (dormant — see below) |
| isolated → main             | `{ __lwsNxFetchCaption: true, url, lang }`                         | adapter (fallback path) | hook (fires XHR from page world) |
| isolated → main             | `{ __lwsNxPrime: true, kickoff }`                                  | adapter (`activate`)   | hook (runs the track-select dance) |

The track-select dance lives in the hook: snapshot the user's
selected track, `setTextTrack` KO, wait for the capture, `setTextTrack`
secondary, wait again, then `setTextTrack` the original. The adapter
just kicks it off and consumes the captures that arrive on
`__lwsNxCaption`.

Manifest interception (`__lwsNxManifest`) is the legacy auto-prime
path — it almost never lands usable URLs in practice because
Netflix's manifest is MSL-encrypted, but the code stays in tree as a
no-cost fallback. The `[lws-nx-prime]` console logs trace which path
succeeded.

Two diagnostic flags in `adapters/netflix/page-hook.js` (`LWS_NX_DIAG_PRIME`
and `LWS_NX_DIAG_API`) are gated off by default. The probe rounds
they enable (commits `f9795ea`, `6523a55`, `d789702`) confirmed how
Netflix's player API exposes `getTextTrackList()` /
`setTextTrack()`; the code remains as dormant diagnostics in case
Netflix shifts shape and we need to re-discover the API.

### `reqId` convention

`reqId` (e.g. `lws-1714430000000-3`) is a monotonic-per-content-
script-lifetime sequence (`lws-${Date.now()}-${++cmdSeq}`) so
concurrent commands don't get their replies cross-wired.

---

## `chrome.storage.onChanged` as a side-channel

In addition to direct messaging, the storage `onChanged` event acts
as a broadcast bus for settings:

| Key                            | Listener                          | What the listener does                                                                                                                                                                                   |
| ------------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `disabledHosts` (local)        | `content.js`                      | Toggle scanning + popup activity for this tab. On the disabled transition: hide the popup AND `unwrapAllWords()` to strip the `.lws-word` spans (dashed underline + cursor: help). Re-enabling re-scans. |
| `disabledHosts` (local)        | `adapters/youtube/adapter.js`     | Calls `deactivate()` and then `activate()` (which re-checks `isEnabled()`) — so the dual-subs overlay actually unmounts on per-site disable.                                                              |
| `disabledHosts` (local)        | `adapters/netflix/adapter.js`     | Same dance as YouTube.                                                                                                                                                                                   |
| `defLang` (sync)               | `content.js`                      | `rerenderActivePopup()` if popup is showing.                                                                                                                                                             |
| `dualSubsYouTube` (sync)       | `adapters/youtube/adapter.js`     | Re-activate / deactivate dual subs on the current page.                                                                                                                                                  |
| `dualSubsNetflix` (sync)       | `adapters/netflix/adapter.js`     | Re-activate / deactivate dual subs on the current Netflix watch page.                                                                                                                                    |
| `secondaryLang` (sync)         | `adapters/youtube/adapter.js`     | Re-activate so the new default applies.                                                                                                                                                                  |
| `secondaryLang` (sync)         | `adapters/netflix/adapter.js`     | Re-kick the prime dance so the new default secondary gets fetched if needed; re-render.                                                                                                                  |
| `dualSubsOverrides` (local)    | `adapters/youtube/adapter.js`     | Re-activate if the override changed for the current video.                                                                                                                                               |
| `dualSubsOverridesNetflix` (local) | `adapters/netflix/adapter.js` | Re-kick the prime dance (clears the per-session "already kicked off" flag) so the new secondary gets fetched if it isn't already in `tracksByLang`, then re-render the overlay. No activate/deactivate — captured tracks stay, only the choice of which one renders as line 2 changes. |
| `askAiPrompt` (sync)           | `content.js`                      | Swap the cached template; pill href is rebuilt on next render.                                                                                                                                            |
| `askAiProvider` (sync)         | `content.js`                      | Swap the cached provider; pill href + tooltip rebuilt on next render.                                                                                                                                     |
| `askAiChatGptTemporary` (sync) | `content.js`                      | Swap the cached flag; pill href appends `?temporary-chat=true` when true and provider is ChatGPT.                                                                                                         |
| `krdictApiKey` (sync)          | `background.js`                   | Refresh the `krKey` mirror used by the lookup hot path.                                                                                                                                                  |
| `opendictApiKey` (sync)        | `background.js`                   | Refresh the `odKey` mirror.                                                                                                                                                                              |

This keeps the options page from having to know which tabs to
message — it just writes to storage and any interested content
scripts react.

---

## Lifecycle events

| Event                              | Listener                | Behaviour                                                                                                          |
| ---------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `chrome.runtime.onInstalled`       | `background.js`         | On `reason === 'install'`, open the options page (paste-your-API-key landing). Also warms mecab.                  |
| `chrome.runtime.onStartup`         | `background.js`         | Warms mecab again so the first hover after browser restart doesn't pay the dict-fetch+inflate cost.               |

# Development guide

This document is the developer-facing architecture and code walkthrough for
`learnwithsoju`. It is intended for someone who has just cloned the repo and
wants a complete mental model of how the extension is put together before
making changes.

If you only want a getting-started recipe (install Node, run the tests, load
the extension into Chrome), read [CONTRIBUTING.md](../CONTRIBUTING.md)
instead. For the user-facing description of what the extension does, see
[README.md](../README.md).

---

## 1. Project overview

`learnwithsoju` is a Manifest V3 browser extension that turns any webpage
with Korean text into a hover dictionary. The user mouses over (or clicks)
any Korean word and a popup appears showing:

- the dictionary entry from KRDict (the National Institute of Korean
  Language's learner dictionary) — translated headword, part-of-speech,
  pronunciation, difficulty grade, Hanja origin (for Sino-Korean words),
  numbered senses with example sentences
- the sentence the word came from, with every other word in that sentence
  rendered as a clickable chip so the user can read through a sentence
  word-by-word without losing context
- a click-to-expand morpheme breakdown — every grammatical particle and
  ending that the MeCab-Ko morphological analyzer found, with a short
  gloss ("subject marker", "past tense", "polite ending", ...)
- a click-to-expand per-character Hanja breakdown — Sino-Korean reading
  plus an English meaning for every Han ideograph in the entry's origin
- an "Ask AI" pill that opens ChatGPT or Claude (user's choice) with a
  structured prompt pre-filled — focus word, sentence translation,
  word-by-word table, and an exhaustive grammar deep-dive of the
  focused word. The prompt template is fully customizable

On YouTube, the extension goes a step further: when the video has a
Korean caption track (manual or ASR), it replaces YouTube's native
caption rendering with a dual-language overlay — Korean on top, the
user's preferred secondary language below. The Korean line is then
hoverable just like any other text on the page, so the user can build
out vocabulary straight from the video they're watching. The
secondary language has a default in settings and a per-video override
from the toolbar popup.

Netflix is partway through Phase 2 (dual-subs overlay). Today the
extension:

  - hooks Netflix's subtitle fetches AND its player-manifest fetch in
    the page world (`netflix-page-hook.js`),
  - auto-primes KO + the configured secondary language directly from
    the manifest the moment the player loads the title — no need for
    the user to toggle either language in Netflix's CC menu. The
    page-hook intercepts JSON responses whose URL path contains
    `manifest`, extracts the available `timedtexttracks` (or
    equivalent — multiple candidate keys are tried) plus their CDN
    URLs by format, and posts the normalized list to the adapter. The
    adapter applies the selection chain (per-title override →
    `secondaryLang` → `'en'` → skip), picks one URL per chosen track
    (preferring TTML/IMSC1.1), and asks the page hook to XHR-fetch
    each. The existing capture pipeline picks the bodies up via
    body-sniff. Logs are prefixed `[lws-nx-prime]` end-to-end so the
    flow is traceable in DevTools,
  - KO is required: if Korean isn't in the manifest, no overlay is
    mounted (dual-subs without KO isn't meaningful for the
    learn-Korean use case). If the user's `secondaryLang` AND `'en'`
    are both missing, no overlay either,
  - parses captured TTML in the isolated world
    (`netflix-adapter.js`'s `parseTtml`),
  - caches per language (`tracksByLang` Map, keyed by normalized
    `xml:lang`), preferring CC variants when both plain and CC of the
    same language arrive,
  - mounts a dual-language overlay on the player as soon as a Korean
    track is captured. The overlay shows KO alone if only Korean has
    been captured so far; once a secondary track arrives (typically
    moments later via auto-prime, but also if the user manually
    toggles a language in Netflix's CC menu), the overlay re-renders
    with both lines,
  - exposes a per-title Secondary Subs dropdown in the toolbar
    popup (`netflix-popup.js`, mirrors YouTube's
    `youtube-popup.js`): every non-Korean language captured so far
    is listed (CC variants get a `(CC)` suffix). The selection is
    persisted to `dualSubsOverridesNetflix` in `chrome.storage.local`
    keyed by Netflix titleId, so each title remembers its own
    secondary-line preference across reloads. The adapter's
    `chrome.storage.onChanged` listener re-runs the auto-prime for
    the newly chosen secondary (if not already cached) and re-renders
    the overlay,
  - gates activation on the `dualSubsNetflix` toggle
    (`chrome.storage.sync`) — matching the YouTube adapter's
    `dualSubsYouTube` gate. When the toggle is off, `isEnabled()`
    returns false and no overlay is mounted. The options page exposes
    the toggle under Behaviour → "Dual subtitles on Netflix". The
    `onChanged` listener reacts live: flipping off deactivates
    immediately; flipping on calls activate (same pattern as
    YouTube).

The manual-toggle path remains as a fallback — if the manifest
interception misses (a different URL pattern, an unrecognised JSON
shape, region-specific routing), the user can still toggle a language
in Netflix's CC menu and the page-hook's body-sniff path will pick up
the TTML and feed the cache. The `[lws-nx-prime]` console logs make
it obvious when auto-prime succeeded vs fell back.

Per-site behaviour: the toolbar popup has a per-host disable toggle that
takes effect immediately — dictionary popups stop firing, the dashed
underlines come off, and (on YouTube) the dual-subs overlay tears down.
Toggling back on re-activates without a reload. There is no global
"hover dictionary on/off" toggle — the per-site list covers "off here"
and `chrome://extensions` covers "off everywhere".

The extension is intentionally small and **has no build step**. The
contents of `extension/` are what get loaded directly into the browser.
The only dependencies are at the test layer (`@xmldom/xmldom` for parsing
KRDict XML inside Node) and at the analyzer layer (a vendored fork of
`mecab-ko-wasm` plus a gzipped copy of `mecab-ko-dic 2.1.1`). The user
supplies their own free API key from the NIKL APIs; the extension makes
no network requests of its own beyond the dictionary APIs and the
on-demand Hanja meanings service.

---

## 2. Architecture overview

```
                                ┌──────────────────────────────┐
                                │   any webpage (light DOM)    │
                                │   <p>학교에서 친구들과…</p>     │
                                └──────────────┬───────────────┘
                                               │  content_scripts
                                               │  matches: <all_urls>
                                               ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │  content.js   (one instance per top-level frame, isolated world) │
   │  ────────────────────────────────────────────────────────────    │
   │    word-scan, mutation observer, hover/click delegation,         │
   │    shadow-DOM popup, sentence extraction, tab/lang/Hanja state,  │
   │    site-adapter dynamic import                                   │
   └──┬──────┬──────────────────────────────────────────┬─────────────┘
      │      │ chrome.runtime.sendMessage                │ dynamic import
      │      │   {type:'lookup', surface}                ▼
      │      │   {type:'lookupHanja', chars}     ┌───────────────┐
      │      │   {type:'openOptions'}            │ youtube-      │
      │      │   {type:'ping'}                   │ adapter.js    │
      │      ▼                                   │  (isolated)   │
      │   ┌─────────────────────────────────┐    └──┬────────────┘
      │   │  background.js (service worker) │       │ injects via
      │   │  ─────────────────────────────  │       │ <script src=…>
      │   │   mecab WASM (lazy)             │       ▼
      │   │   two cache namespaces          │  ┌─────────────────────┐
      │   │   (lookup:* and hanja:*)        │  │ youtube-page-hook.js│
      │   │   parallel KRDict queries       │  │  (page main world)  │
      │   │   handleLookup, handleHanja     │  │   XHR + fetch hooks │
      │   └──┬────────────────┬─────────────┘  │   getOption tracklist│
      │      │ HTTPS          │ HTTPS          │   setOption load    │
      │      ▼                ▼                └──┬──────────────────┘
      │   krdict.       opendict.                 │ window.postMessage
      │   korean.go.kr  korean.go.kr              │   __lwsYtCmd
      │      │                │                   │   __lwsYtCaption
      │      │                │                   │   __lwsYtReply
      │      ▼                ▼                   ▼
      │   (KRDict XML)    (OpenDict XML)    YouTube player
      │
      │ chrome.tabs.sendMessage
      │   {type:'lws-yt-popup-info'}
      │
   ┌──┴───────────────────────────┐    ┌─────────────────────────┐
   │  popup.html / popup.js       │    │ options.html /          │
   │  (toolbar action; opens on   │    │ options.js              │
   │  toolbar-icon click)         │    │ (chrome://exts →        │
   │  - per-site disable toggle   │    │  Options)               │
   │  - per-site adapter section  │    │  - API keys             │
   │    (e.g. youtube-popup.js    │    │  - dual subs on/off     │
   │     secondary-lang dropdown) │    │  - secondary lang       │
   │                              │    │      Ask-AI provider    │
   │                              │    │      Ask-AI prompt tmpl │
   │                              │    │  - clear cache          │
   └──────────────────────────────┘    └─────────────────────────┘

External services contacted at runtime (with user-supplied keys or no key):

   krdict.korean.go.kr/api/search       primary dictionary
   opendict.korean.go.kr/api/search     larger fallback dictionary (optional)
   hangulhanja.com/api/search           per-character Hanja meanings (on demand)

External links the popup builds (outbound href only, no API):

   koreanverb.app/?search=…             verb-conjugation tables
   koreanverb.app/pronounce?search=…    pronunciation guide
   hangulhanja.com/en/hanja/<char>      per-character breakdown
```

Component breakdown:


| Component                 | World           | Lifetime         | Notes                                                                                         |
| ------------------------- | --------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| `content.js`              | isolated        | per top-frame    | The only piece that touches the page DOM. One instance per tab/frame.                         |
| `background.js`           | service worker  | lazy / suspended | MV3 SW that handles dictionary requests and owns the mecab analyzer.                          |
| `popup.{html,js}`         | extension page  | open/close       | Toolbar-action UI. Talks to the active tab via `chrome.tabs.sendMessage`.                     |
| `options.{html,js}`       | extension page  | open/close       | Settings. Writes to `chrome.storage.sync`.                                                    |
| `youtube-adapter.js`      | isolated        | per /watch       | Site adapter for YouTube. Replaces native captions with dual-line overlay.                    |
| `youtube-page-hook.js`    | page main world | injected once    | Page-world hook that observes YouTube's caption fetches and drives `player.setOption`.        |
| Shadow-DOM popup          | content.js      | per popup        | The actual hover UI; uses an open Shadow Root attached at the document root with adopted CSS. |
| MeCab WASM + mecab-ko-dic | service worker  | lazy, kept       | ~22 MB compressed; init on first lookup, retained until the SW dies.                          |


External services touched at runtime:


| Host                        | When                                                                                                                                                                                                                                                                                   | Auth                  |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `krdict.korean.go.kr`       | Every dictionary lookup that misses the cache                                                                                                                                                                                                                                          | User's KRDict API key |
| `opendict.korean.go.kr`     | Only when KRDict returns nothing AND the user has provided a key                                                                                                                                                                                                                       | User's OpenDict key   |
| `hangulhanja.com`           | When the user clicks a Hanja origin chip in the popup (lazy, cached)                                                                                                                                                                                                                   | None (open API)       |
| `koreanverb.app`            | Outbound `target=_blank` link only — no extension-initiated fetch                                                                                                                                                                                                                      | n/a                   |
| `chatgpt.com` / `claude.ai` | "Ask AI" pill in the popup — opens the chosen AI service in a new tab with the rendered prompt as `?q=`. Providers are listed in `extension/ai-providers.js`; the user picks one in the options page's Advanced section. No extension-initiated fetch — just an `<a target="_blank">`. | n/a                   |


---

## 3. Repository layout

```
learnwithsoju/
├── extension/                          ← what gets loaded as an unpacked extension
│   ├── manifest.json                   ← MV3, dual-target Chrome + Firefox
│   ├── background.js                   ← service worker; owns mecab + cache; KRDict/OpenDict/Hanja fetches
│   ├── content.js                      ← injected on <all_urls>; only file that touches the page DOM
│   ├── content.css                     ← styling for the in-page `.lws-word` underline + the popup host
│   ├── popup-shadow.css                ← stylesheet for the in-page hover popup (loaded into its Shadow DOM)
│   ├── api.js                          ← KRDict/OpenDict URL builders + response-shape sniffers (pure)
│   ├── lemmatizer.js                   ← mecab tokens → ordered candidate dictionary forms (pure)
│   ├── parsers.js                      ← KRDict/OpenDict XML → entry objects; POS/Hanja/grade helpers; outbound link builders (pure)
│   ├── grammar-glosses.js              ← morpheme form/POS → short English gloss for the breakdown chips (pure)
│   ├── site-configs.js                 ← per-site sentence-container selectors + findVideo + adapter + popupModule paths
│   ├── ai-providers.js                 ← registry of "Ask AI" pill targets (ChatGPT, Claude, …); add new providers here
│   ├── youtube-adapter.js              ← content-script-side YouTube adapter; dual subs lifecycle
│   ├── youtube-popup.js                ← popup-side YouTube section (secondary-language dropdown); dynamic-imported by popup.js
│   ├── youtube-page-hook.js            ← page-main-world script; XHR/fetch hooks + tracklist/load-track command channel
│   ├── netflix-adapter.js              ← content-script-side Netflix adapter (TTML parse, per-lang cache, dual-line overlay, manifest-driven auto-prime of KO + secondary)
│   ├── netflix-popup.js                ← popup-side Netflix section (secondary-language dropdown); dynamic-imported by popup.js
│   ├── netflix-page-hook.js            ← page-main-world script; XHR/fetch hooks for Netflix subtitle URLs (TTML/DFXP/WebVTT) + manifest interception + on-demand XHR for auto-prime
│   ├── cache.js                        ← two-tier (in-mem LRU + storage adapter) cache factory; namespaced (pure)
│   ├── popup.html                      ← toolbar-action popup markup
│   ├── popup.js                        ← toolbar popup logic (per-site disable toggle, generic adapter-section loader, content-script lws-site-info fallback for hostname)
│   ├── popup.css                       ← styling for the toolbar popup (NOT the in-page hover popup)
│   ├── options.html                    ← settings-page markup (API keys, behaviour, cache)
│   ├── options.js                      ← settings-page logic (load/save, test key, clear cache)
│   ├── options.css                     ← styling for the settings page
│   ├── notepad.html                    ← standalone extension page; paste Korean text, hover any word
│   ├── notepad.js                      ← notepad page logic (commit textarea → display area; content.js's observer wraps the runs)
│   ├── icons/                          ← 16, 48, 128 px PNGs used by chrome://extensions and the toolbar
│   └── vendor/
│       └── mecab-ko/                   ← vendored analyzer artifacts (NOT a npm package — copied from a fork)
│           ├── mecab_ko_wasm.js              ← wasm-bindgen JS glue (ES module)
│           ├── mecab_ko_wasm.d.ts            ← TypeScript declarations (informational)
│           ├── mecab_ko_wasm_bg.wasm         ← ~145 KB WASM analyzer (no dictionary baked in)
│           ├── mecab_ko_wasm_bg.wasm.d.ts
│           ├── sys.dic.gz                    ← compiled mecab-ko-dic trie (9.3 MB compressed, 16 MB raw)
│           ├── matrix.bin.gz                 ← connection-cost matrix (2.5 MB / 20 MB)
│           └── entries.bin.gz                ← entry strings + features (9.7 MB / 54 MB)
│
├── tests/                              ← node:test suite. Pure modules only — no jsdom, no Chrome stubs.
│   ├── api.test.js                     ← URL builders, looksEmpty, extractApiError (20 tests)
│   ├── cache.test.js                   ← two-tier cache, LRU eviction, namespace isolation (11 tests)
│   ├── grammar-glosses.test.js         ← morphemeGloss disambiguation + isContentMorpheme filter (11 tests)
│   ├── lemmatizer.test.js              ← candidate-generation rules incl. compound-noun + Inflect-stem (29 tests)
│   ├── parsers.test.js                 ← KRDict/OpenDict XML parsing + POS/Hanja/grade helpers (51 tests)
│   └── fixtures/
│       ├── krdict-empty.xml            ← <total>0</total>
│       ├── krdict-error.xml            ← <error><error_code>020</error_code>… for error-path tests
│       ├── krdict-multi.xml            ← three-entry response (가다, 학교, 난해하다)
│       ├── krdict-sample.xml           ← single-entry response (먹다 with two senses)
│       ├── krdict-with-examples.xml    ← entry with multiple example sentences
│       └── opendict-sample.xml         ← OpenDict response with translation_info blocks
│
├── docs/
│   ├── DEVELOPMENT.md                  ← (this file)
│   ├── MECAB_INTEGRATION.md            ← how the mecab-ko-wasm fork was built; vendoring story
│   ├── THIRD-PARTY.md                  ← license attribution for everything under vendor/
│   ├── original-spec.md                ← the original V1 spec; kept for historical reference
│   └── mecab-browser-smoketest.html    ← stand-alone diagnostic page for the upstream mecab-ko-wasm
│
├── .github/workflows/ci.yml            ← npm test, parse-check every extension/*.js, validate manifest
├── .gitattributes                      ← marks .wasm/.gz/.png as binary
├── CONTRIBUTING.md                     ← contributor getting-started (clone → install → npm test → load unpacked)
├── README.md                           ← user-facing readme; install + privacy + feature list
├── LICENSE                             ← MIT (extension code only)
├── package.json                        ← exists for the test harness only ("npm test")
└── package-lock.json
```

The invariant that makes most of the codebase unit-testable: **only
`content.js`, `background.js`, `popup.js`, `options.js`, and the two
YouTube files touch host APIs.** Everything else (`api.js`,
`lemmatizer.js`, `parsers.js`, `grammar-glosses.js`, `cache.js` with an
injected adapter) is pure JavaScript that can be imported into Node.

---

## 4. Storage model

The extension uses both sync and local storage. Sync is small and roams
across the user's signed-in browsers; local is unrestricted and used for
the cache and the per-video YouTube override map. The
`unlimitedStorage` permission is declared in the manifest so the cache
can grow past the 5 MB default.

### `chrome.storage.sync`


| Key               | Type          | Default                  | Written by                      | Read by                                                                                       |
| ----------------- | ------------- | ------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------- |
| `krdictApiKey`    | string        | `""`                     | `options.js`                    | `background.js` (every lookup)                                                                |
| `opendictApiKey`  | string        | `""`                     | `options.js`                    | `background.js` (only when KRDict empty)                                                      |
| `defLang`         | `'en' \| 'ko'` | `'en'`                   | `content.js` (popup toggle)     | `content.js` (popup render)                                                                   |
| `dualSubsYouTube` | boolean       | `true`*                  | `options.js`                    | `youtube-adapter.js` (onChanged + isEnabled)                                                  |
| `dualSubsNetflix` | boolean       | `true`*                  | `options.js`                    | `netflix-adapter.js` (onChanged + isEnabled)                                                  |
| `secondaryLang`   | string        | `'en'`                   | `options.js`                    | `youtube-adapter.js`, `netflix-adapter.js`, `popup.js` (default)                              |
| `askAiPrompt`     | string        | unset → built-in default | `options.js` (Advanced section) | `content.js` (init + onChanged → `buildAskAiUrl`)                                             |
| `askAiProvider`   | string        | `'chatgpt'`              | `options.js` (Advanced section) | `content.js` (init + onChanged → `buildAskAiUrl` picks the URL prefix from `ai-providers.js`) |


*`dualSubsYouTube` and `dualSubsNetflix` default to `true` in each
adapter's `isEnabled()` — the setting is treated as "off only if
explicitly set to `false`". Each adapter's `isEnabled()` ALSO checks
`disabledHosts` (local) and bails when the current hostname is in the
list, so per-site disable tears down dual subs in addition to the
dictionary. On fresh install,
`background.js` just opens the options page so the user can paste
their KRDict key — there is no longer a global on/off switch (the
old `enabled` key was removed; the only soft-disable is per-site via
`disabledHosts`, and the only hard-disable is `chrome://extensions`).

The `askAiPrompt` template uses three placeholders: `{sentence}` (the
sentence with the focus word surrounded by backticks), `{word}` (the
focus word on its own), and `{language}` (the user's
secondary-language name, e.g. `"English"`). Substitution uses
`split().join()` rather than `String.replace()` so user templates
containing `$1`/`$&`/`$'` aren't mangled by replacement-pattern
interpolation. Storing the value equal to the default removes the
key (the options page's textarea handler does this), so the live
default in code is what's used.

`askAiProvider` is a key into the `AI_PROVIDERS` registry exported
from `extension/ai-providers.js`. Each entry contributes `{ name, urlPrefix }`; the pill's href is `urlPrefix + encodeURIComponent(prompt)`
and the tooltip says `Ask <name> to explain...`. Adding a provider is
one entry in `ai-providers.js` — the options-page dropdown is
populated from the same registry (no HTML edits) and `content.js`
picks it up via `chrome.runtime.getURL` import (the file is listed in
`web_accessible_resources`).

### `chrome.storage.local`


| Key (or namespace)  | Type                  | Written by                             | Read by                                                 |
| ------------------- | --------------------- | -------------------------------------- | ------------------------------------------------------- |
| `lookup:<surface>`  | `LookupResponse`      | `background.js` (`cache.set`)          | `background.js` (`cache.get`)                           |
| `hanja:<chars>`     | Hanja gloss array     | `background.js` (`hanjaCache.set`)     | `background.js`                                         |
| `dualSubsOverrides` | `{ [videoId]: lang }` | `popup.js` (per-video radio selection) | `youtube-adapter.js` (onChanged + resolveSecondaryLang) |
| `dualSubsOverridesNetflix` | `{ [titleId]: lang }` | `netflix-popup.js` (per-title dropdown) | `netflix-adapter.js` (onChanged + resolveSecondaryLang) |
| `disabledHosts`     | `string[]`            | `popup.js` (per-site toggle)           | `content.js` init + onChanged listener                  |


`lookup:` and `hanja:` are namespaces enforced by `cache.js` (see §11) —
the actual storage entries are keyed `lookup:먹다`, `hanja:豫約`, etc.
The two namespaces share a single `chrome.storage.local` area but
`cache.clear()` only deletes keys with its own prefix, so clearing the
word cache does not blow away the Hanja cache and vice versa.

### Why `chrome.storage.local` (not `chrome.storage.session`) for per-video overrides

`chrome.storage.session` is gated to "trusted contexts" by default in
MV3 — content scripts (where `youtube-adapter.js` runs) get a silent
permission denial. `chrome.storage.local` is unrestricted and has the
nice side-effect that per-video preferences survive a browser restart.

### Why `chrome.storage.local` (not `sync`) for `disabledHosts`

`chrome.storage.sync` is rate-limited (`MAX_WRITE_OPERATIONS_PER_MINUTE`,
`QUOTA_BYTES_PER_ITEM`) and is eventually-consistent with the cloud.
Per-site toggle writes were getting dropped — the user would toggle ON,
refresh, and the page would still see the host in the disabled list.
`local` is per-device with no quota concerns and writes through
immediately. "On this device, leave me alone on this site" is the
natural semantics anyway; no need to roam it.

---

## 5. Message-passing topology

Every cross-context communication path in the extension. The two
big-ticket items are (a) content↔background dictionary requests, and (b)
the YouTube command channel between the isolated content world and the
page main world.

### `chrome.runtime.sendMessage` — content → background

All from `content.js` (or from inside the popup's button-handlers).
`background.js`'s `onMessage` listener dispatches by `msg.type`:


| `msg.type`    | Payload               | Response                                                                               | Notes                                                               |
| ------------- | --------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `lookup`      | `{ surface: string }` | `LookupResponse` (see §7 main flows)                                                   | Async (`return true`). Surface keyed; cache-bypassing not exposed.  |
| `lookupHanja` | `{ chars: string }`   | `{ chars, hanjas: [{character, sino, summary}], cachedAt }` or `{ chars, error, ... }` | Async. Failures (5xx/429) are NOT cached so the next click retries. |
| `openOptions` | `{}`                  | `{ ok: true }`                                                                         | Sync; `chrome.runtime.openOptionsPage()`.                           |
| `ping`        | `{}`                  | `{ ok: true }`                                                                         | Sync; used to wake the SW.                                          |
| `clearCache`  | `{}`                  | `{ ok: true }` or `{ ok: false, error }`                                               | Async. Clears BOTH `lookup:` and `hanja:` namespaces.               |


### `chrome.tabs.sendMessage` — popup module → content (then content → adapter)

Each site's popup module (e.g. `youtube-popup.js`) talks to its
content-script-side adapter using a site-specific message type. The
generic `popup.js` shell doesn't send these — only the dynamic-imported
module does.


| `msg.type`          | From               | To                 | Response                                                                                                        |
| ------------------- | ------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `lws-yt-popup-info` | `youtube-popup.js` | content script tab | `youtube-adapter.js`: `{ active, videoId, tracks: [{languageCode, languageName, kind, vssId}], secondaryLang }` |
| `lws-site-info`     | `popup.js`         | content script tab | `content.js`: `{ host, protocol, href }` — fallback for when `chrome.tabs.query` returns an undefined `tab.url` |


The YT-adapter `onMessage` listener and the content-script `lws-site-info`
listener both intercept before `content.js`'s normal lookup paths see
them. `lws-site-info` lets the popup avoid relying on the tabs API for
the hostname (some Chrome states return `tab.url === undefined` even
with `activeTab` granted; the content script always knows its own
`window.location.hostname`).

### `window.postMessage` — isolated content world ↔ page main world

The YouTube hook is in the page main world (`<script src=…>` injection)
because content scripts can't see page expandos like
`html5VideoPlayer.getOption`. All communication is via `window.postMessage`:


| Direction                   | Shape                                                          | Sent by              | Handled by                  |
| --------------------------- | -------------------------------------------------------------- | -------------------- | --------------------------- |
| isolated → main             | `{ __lwsYtCmd: 'tracklist', reqId }`                           | `youtube-adapter.js` | `youtube-page-hook.js`      |
| isolated → main             | `{ __lwsYtCmd: 'player-response-tracks', reqId }`              | `youtube-adapter.js` | `youtube-page-hook.js`      |
| isolated → main             | `{ __lwsYtCmd: 'load-track', reqId, lang: 'ko' \| 'en' \| ... }` | `youtube-adapter.js` | `youtube-page-hook.js`      |
| isolated → main             | `{ __lwsYtCmd: 'get-track', reqId }`                           | `youtube-adapter.js` | `youtube-page-hook.js`      |
| isolated → main             | `{ __lwsYtCmd: 'clear-track', reqId }`                         | `youtube-adapter.js` | `youtube-page-hook.js`      |
| main → isolated             | `{ __lwsYtReply: 'tracklist', reqId, tracks }`                 | hook                 | `awaitHookReply` in adapter |
| main → isolated             | `{ __lwsYtReply: 'player-response-tracks', reqId, tracks }`    | hook                 | `awaitHookReply` in adapter |
| main → isolated             | `{ __lwsYtReply: 'load-track', reqId, ok, error? }`            | hook                 | adapter (fire-and-forget)   |
| main → isolated             | `{ __lwsYtReply: 'get-track', reqId, ok, track, error? }`      | hook                 | `readCurrentTrack` in adapter |
| main → isolated             | `{ __lwsYtReply: 'clear-track', reqId, ok, error? }`           | hook                 | adapter (fire-and-forget)   |
| main → isolated (broadcast) | `{ __lwsYtCaption: true, url, status, body }`                  | hook (XHR/fetch tap) | `captureCaption` in adapter |


(There used to be an `audio-info` command pair here too. Removed in
favour of in-adapter `detectAudioLangFromTracklist` — see §15.11 for
why the hook-based detection was inescapably stale.)

`reqId` (e.g. `lws-1714430000000-3`) lets the adapter run multiple
commands in flight without their replies getting cross-wired.

### `chrome.storage.onChanged` as a side-channel

In addition to direct messaging, the storage onChanged event acts as a
broadcast bus for settings:


| Key                     | Listener                          | What the listener does                                                                                                                                                                                   |
| ----------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `disabledHosts` (local) | `content.js`                      | Toggle scanning + popup activity for this tab. On the disabled transition: hide the popup AND `unwrapAllWords()` to strip the `.lws-word` spans (dashed underline + cursor: help). Re-enabling re-scans. |
| `disabledHosts` (local) | `youtube-adapter.js`              | Calls `deactivate()` and then `activate()` (which re-checks `isEnabled()`) — so the dual-subs overlay actually unmounts when the user disables on a YouTube page, not just the dictionary popup.         |
| `defLang`               | `content.js`                      | `rerenderActivePopup()` if popup is showing                                                                                                                                                              |
| `dualSubsYouTube`       | `youtube-adapter.js`              | Re-activate / deactivate dual subs on the current page                                                                                                                                                   |
| `dualSubsNetflix`       | `netflix-adapter.js`              | Re-activate / deactivate dual subs on the current Netflix watch page                                                                                                                                     |
| `secondaryLang`         | `youtube-adapter.js`              | Re-activate so the new default applies                                                                                                                                                                   |
| `dualSubsOverrides`     | `youtube-adapter.js` (local area) | Re-activate if the override changed for the current video                                                                                                                                                |
| `dualSubsOverridesNetflix` | `netflix-adapter.js` (local area) | Re-run auto-prime for the new secondary (if not already cached) + re-render the overlay. No activate/deactivate — captured tracks stay, the new track gets fetched on demand from the cached manifest. |


This keeps the options page from having to know which tabs to message —
it just writes to storage and any interested content scripts react.

---

## 6. Main flows

Each flow lists the user gesture, the participating files, and the steps
in order.

### 6.1 Page load: scan and wrap

Files: `content.js`.

1. `init()` runs at `document_idle` (manifest setting).
2. Read `defLang` + `askAiPrompt` from `chrome.storage.sync` and
  `disabledHosts` from `chrome.storage.local` in parallel. The
   effective gate is just `enabled = !hostDisabled` where
   `hostDisabled = disabledHosts.includes(location.hostname.toLowerCase())`.
   Handlers and the mutation observer are attached even when disabled
   (they self-gate on `enabled`) so a popup toggle can re-activate the
   page without a reload. Only the expensive scan and the site adapter
   are skipped when disabled.
3. Resolve `siteConfig = findSiteConfig(location.hostname)` once for the
  lifetime of this content script.
4. `scanRoot(document.body)` →
  `collectTextNodes` (TreeWalker, skips `<script>`, `<style>`,
   `<textarea>`, `<input>`, `<code>`, `<pre>`, `<noscript>`, `<iframe>`,
   `<canvas>`, `<svg>`, `contenteditable`, and existing `.lws-word`
   spans) → `processInChunks` (80 nodes per tick via
   `requestIdleCallback`).
5. For each accepted text node, `wrapTextNode` walks the node's value
  with the global Hangul regex
   `/[가-힣ᄀ-ᇿ㄰-㆏]+/g` and replaces every Hangul run with a
   `<span class="lws-word" data-surface="…">…</span>` inside a document
   fragment, preserving the non-Hangul text in between.
6. `attachWordHandlers(document.body)` registers capture-phase
  `mouseenter` / `mouseleave` / `click` delegates.
7. `setupMutationObserver()` watches `document.body` for newly added
  nodes (SPA navigation, lazy-rendered comments, ...) and scans them
   too.
8. If `siteConfig.adapter` is set, dynamically import it and call
  `setup()` (fire-and-forget — see §6.8).

### 6.2 Hover: dictionary lookup and popup render

Files: `content.js`, `background.js`, `lemmatizer.js`, `parsers.js`,
`grammar-glosses.js`, `cache.js`, `vendor/mecab-ko/`*.

1. Mouse enters a `.lws-word` span. `delegateEnter` →
  `onWordEnter(target)`.
2. After a 60 ms hover delay (lets the user pass over a word without
  triggering), `performLookup(target)` runs.
3. `performLookup` increments `pendingRequestId` (so a slow response
  can be discarded if the user has already moved on), resets per-popup
   state (`expandedExamples`, `expandedHanja`, `relatedExpanded`,
   `activeInsightTab`, popup min-size memos), then renders a loading
   placeholder via `showPopup(anchor, buildLoadingNode(surface))`.
   The loading node shows the hovered word and a live status line that
   advances through pipeline stages. Status is suppressed if the whole
   lookup completes within 50 ms (cache hit — no flicker). Otherwise
   the status label updates in place via `setLookupStatus(key)` as each
   stage starts, using `LOOKUP_STAGE_LABELS`:

   | Stage key  | Label                     | When shown                              |
   |------------|---------------------------|-----------------------------------------|
   | `init`     | `Initializing…`           | MeCab WASM still loading (first lookup) |
   | `cache`    | `Checking cache…`         | Cache read in flight (after 50 ms)      |
   | `morpheme` | `Analyzing morphemes…`    | MeCab tokenization running              |
   | `krdict`   | `Querying KRDict…`        | KRDict network request in flight        |
   | `opendict` | `Falling back to OpenDict…` | OpenDict fallback in flight           |
   | `render`   | `Rendering…`              | Result received, building DOM           |

   Since the pipeline runs as a single background message (no streaming),
   content-side stage advancement is optimistic: `cache` fires at 50 ms,
   `morpheme` at 200 ms, `krdict` at 500 ms — all timers are cancelled
   the moment the response arrives.
4. `chrome.runtime.sendMessage({ type: 'lookup', surface })` →
  `background.js` `handleLookup(surface)`:
  1. Cache hit? Return cached `LookupResponse` (still includes the
    mecab tokens and parallel queries; the cache stores the full
     response payload).
  2. `tokenizeSurface(surface)` — lazy-init mecab if first call (~1–2 s
    on cold SW), then return token objects with their POS, lemma,
     reading, features.
  3. `lemmaCandidates(tokens, surface)` produces an ordered list of
    dictionary candidates (see §8).
  4. Read `krdictApiKey` from `chrome.storage.sync`. If missing,
    return `{ error: 'NO_API_KEY' }`.
  5. Pick the top 4 distinct candidates and fire `Promise.all` of
    `fetchXml(buildKrdictUrl(q, key))` — see §9 for the partition
     logic that depends on the order of these results.
  6. If none of the 4 returned anything, fall through to remaining
    candidates sequentially.
  7. If `opendictApiKey` is set AND KRDict came back empty, try
    OpenDict in candidate order until one returns content.
  8. Build the response object — `surface`, `lemma`, `queryUsed`,
    `queriesUsed`, `multiPrimary` flag, `tokens`, `krXmls[]`,
     `odXml`, `cachedAt`. Persist to cache and return.
5. Back in `content.js`, the response arrives. If
  `requestId !== pendingRequestId`, the user has moved on; bail.
6. Handle error responses (`NO_API_KEY`, `FETCH_FAILED`, other) with
  `buildErrorNode`.
7. On success: store `lastPayload` and `lastSentence`, render
  `buildResultNode(payload, { sentence })` and show via `showPopup`.
8. `extractSentence(anchor)` walks up from the hovered word (using the
  site's `sentenceContainer` selector if set, else the default block-
   level tag set) to find the surrounding sentence, then truncates with
   ellipses if longer than 80 chars on either side of the hit.

### 6.3 Click: same as hover, but immediate

Files: `content.js`.

The click path (`onWordClick`) is mostly identical to hover but:

- `e.preventDefault()` + `e.stopPropagation()` — keeps the click from
navigating when the word happens to be inside an `<a>` (e.g. linked
YouTube subtitles).
- Skips the 60 ms hover delay — `performLookup` runs immediately.
- Useful for touch and for sites where mouseenter is unreliable (custom
event interceptors, overlays).

### 6.4 Sentence-word click: re-look-up without moving the popup

Files: `content.js`.

The sentence band at the top of the popup is rendered by
`buildSentenceNode` → `appendSentenceWords`, which splits the
before/after text into 어절 chunks (whitespace-separated). Every chunk
containing a Hangul "core" is wrapped in a `.lws-sentence-word` span with
its own click handler.

1. User clicks one of those spans. `onSentenceWordClick(surface, fullText, offset)` runs.
2. A new `{before, word, after}` sentence is built — same `fullText`,
  but with the clicked chunk as the hit.
3. `performLookup(null, { surface, sentence: newSentence })` runs.
  `target` is null, so `anchor = activeWordEl` (kept from the original
   hover) and `reposition = false` — the popup stays exactly where it is.
4. `extractSentence` is bypassed (the `opts.sentence` is used directly),
  so the popup keeps the same sentence band as the user reads through it
   one 어절 at a time.

### 6.5 EN / KR language toggle

Files: `content.js`.

1. User clicks the `[영어] [한국어]` toggle in the popup strip.
2. `onToggleLang(lang)` flips `defLang`, writes to
  `chrome.storage.sync` (so other tabs and a reopened popup also pick
   up the change), then `rerenderActivePopup()`.
3. `rerenderActivePopup` re-renders from the cached `lastPayload` +
  `lastSentence` with `reposition: false` — no DOM-derived sentence
   re-extraction (which would clobber a sentence-word-click rebuild),
   no popup move.

### 6.6 Tab switching: homograph entries and `+N related` expand

Files: `content.js`.

KRDict often returns more than one entry per query. `buildResultNode`
partitions the merged set of entries (across all parallel queries) into
"primary" (exact headword matches against promoted forms) and "related"
(everything else). See §9 for the partition logic.

1. Primary entries get rendered as tabs in `buildTabBar`. The active tab
  shows in `buildKrEntryNode`.
2. If there are hidden related entries, a `+N related` pill appears at
  the end of the tab strip.
3. Clicking a normal tab calls `onTabClick(idx)` →
  `rerenderActivePopup()` with `reposition: false` (so the user's click
   on the next tab in the strip doesn't get eaten by the popup moving
   away mid-click).
4. Clicking `+N related` sets `relatedExpanded = true` and re-renders.
  The previously hidden entries are now appended to the tab list.

### 6.7 Hanja meanings: click-to-expand per-character panel

Files: `content.js`, `background.js`.

1. The dictionary entry's `origin` field (e.g. `豫約 (예약)`) becomes a
  button via `makeHanjaChip` — only when at least one character passes
   `isHanjaChar` (CJK Unified or Extension A).
2. User clicks the chip. `expandedHanja` set toggles; `rerenderActivePopup`.
3. `buildHanjaMeaningsNode` mounts a panel below the meta row. On the
  first expansion for a given Hanja string, it sends
   `{ type: 'lookupHanja', chars }` to `background.js`.
4. `handleHanjaLookup(chars)` checks the `hanja:` cache namespace, then
  `fetch('https://hangulhanja.com/api/search?q=...&mode=hanzi&locale=en')`,
   normalizes the JSON response to `[{character, sino, summary}]`, caches
   it, and returns it.
5. The panel renders one row per character. The character itself is a
  link to `https://hangulhanja.com/en/hanja/<encoded char>` for the full
   per-character breakdown page.
6. A session-only `hanjaSession` Map in `content.js` short-circuits
  subsequent rerenders of the same popup so the panel doesn't flash
   "Loading…" again when the user toggles a tab.

### 6.8 YouTube dual subs activation

Files: `content.js`, `site-configs.js`, `youtube-adapter.js`,
`youtube-page-hook.js`.

1. `content.js`'s `init` resolves `siteConfig` for the current
  hostname; for `youtube.com` this returns the YouTube config with
   `adapter: 'youtube-adapter.js'`.
2. After scanning the page and setting up handlers, `init` dynamic-
  imports the adapter and calls `setup({ unwrap, rescan })` — the two
   callbacks let the adapter ask content.js to strip and re-apply
   `.lws-word` wrapping around SPA navigations (see the SPA-nav notes
   in §7.11.x).
3. `youtube-adapter.js`'s `setup(api)`:
  1. Stashes `api.unwrap` / `api.rescan` (no-ops if missing).
  2. Registers `chrome.storage.onChanged` listener (sync:
    dualSubsYouTube + secondaryLang; local: dualSubsOverrides +
     disabledHosts).
  3. Registers `chrome.runtime.onMessage` for `lws-yt-popup-info`.
  4. Wires `yt-navigate-start` → `handleNavStart` (deactivate +
    unwrap) and `yt-navigate-finish` → `handleNavFinish` (after
     250 ms: activate + rescan). Polls `window.location.href` every
     1 s as a fallback for navigations that don't fire those events.
  5. `injectHookOnce()` — appends a `<script src=chrome-extension://.../youtube-page-hook.js>` tag to `document.head`. The hook's IIFE
    checks `window.__lwsYtHookInstalled` to be idempotent.
  6. `activate()` — bumps `activeGeneration`, tears down any
    existing overlay, guards on `/watch` and `isEnabled()`, then
     awaits `initForCurrentVideo()`. After each await it re-checks
     `myGen === activeGeneration` and discards its own work if a
     newer activate/deactivate has preempted it. Prevents two
     concurrent activates from leaving an orphan overlay when
     YouTube SPA-navs faster than the capture pipeline finishes.
4. `initForCurrentVideo`:
  1. `waitForVideoElement` polls `document.querySelector('video.html5-main-video')` up to 10 s.
  2. `waitForTracklist` merges two sources every iteration:
    `player.getOption('captions','tracklist')` (rich metadata but
     unreliable for ASR-only videos — the player sometimes returns []
     until the user enables CC manually) AND a fresh
     `player.getPlayerResponse().captions.playerCaptionsTracklistRenderer.captionTracks`
     (always present, complete, but thinner shape, AND updated per
     SPA-nav — see "stale ytInitialPlayerResponse" gotcha below).
     Dedupes by `(languageCode, kind)` — player entries win on
     overlap. Polls every 250 ms for up to 10 s.
  3. **No separate audio-language gate.** Whether to engage dual subs
    is decided entirely by `pickPrimarySource` below: if the
     tracklist contains any Korean track (manual or ASR), engage;
     otherwise skip. There's no need to also inspect "audio language"
     because the tracklist only contains base tracks — manual
     (uploader-provided) and ASR (YouTube auto-generated, always in
     the actual spoken language). Auto-translated tracks via
     `tlang=…` aren't enumerated; they're derived on demand. So a
     KO entry in the tracklist always means either "uploader added
     it" or "the audio is Korean" — both legitimate reasons. See
     §15.11 for the design history (we tried two more complex
     gates first and they were both either redundant or broken).
  4. `resolveSecondaryLang(videoId)` — per-video override (from
    `local.dualSubsOverrides`) wins over `sync.secondaryLang`, which
     defaults to `'en'`.
  5. `pickPrimarySource(tracklist)` and `pickSecondarySource` —
    see §10 for the fallback chains.
  6. **Snapshot CC state** via `readCurrentTrack()` (posts
    `{__lwsYtCmd:'get-track'}`). This is the user's pre-capture
     choice — `{}` for CC off, `{languageCode, kind}` for a selected
     track. We save it so we can restore it after the next step.
  7. For each unique base track involved, `captureBaseTrack(lang)`:
    posts `{__lwsYtCmd:'load-track', lang}`, then waits for a
     `__lwsYtCaption` postMessage whose URL has `lang=…` and no
     `tlang=` (signaling it's the original, not an auto-translation).
  8. **Restore CC state** via `restoreTrack(initialTrack)`. If the
    user had CC off, we post `{__lwsYtCmd:'clear-track'}` to put it
     back off. If they had a track selected, we re-`load-track` that
     one. We deliberately do NOT keep the player parked on KO — the
     CC button is the user's master switch (see step 10).
  9. `materializeLines` — for each source, either parse the captured
    body directly (`parseJson3` or `parseSrv1Xml`), or refetch the
     captured URL with `&tlang=<target>` appended. The signed
     `sparams` don't include `lang`/`tlang`, so YouTube's signature
     still validates the second URL.
  10. Mount the overlay on `.html5-video-player` (the player root —
    NOT `.html5-video-container`, which has wrong positioning).
     The overlay starts hidden (`display:none`) and only becomes
     visible when the CC observer (below) classifies the state as
     `CC_ON_KO`.
  11. **CC observer**: a 500 ms `setInterval` polls
    `readCurrentTrack()` and classifies the result into a 3-state
     machine — `CC_OFF`, `CC_ON_KO`, `CC_ON_OTHER`. On transitions:
     - `CC_OFF` / `CC_ON_OTHER` → overlay hidden, native-caption
       hider stylesheet removed (so YouTube's own caption window is
       free to render whatever the user selected).
     - `CC_ON_KO` → overlay shown, native-caption hider stylesheet
       injected, and the time-sync loop attaches.
     This makes YouTube's CC button the user's master toggle: click
     CC → our overlay appears (if their selected track is Korean);
     click again → it hides; gear → English → overlay hides and EN
     native captions take over.
  12. Attach `timeupdate` / `seeking` / `seeked` listeners on the
    video element. Each tick does a binary search over the lines
     array (`findLineIdx`) and updates the KO and EN `<div>`s.
5. Teardown: returned closure clears the CC poll interval, removes
  listeners, detaches the overlay, detaches the style tag (if
   currently mounted). Called by `deactivate` on navigation away,
   on settings change, or on per-video override change.

### 6.9 Toolbar popup → YouTube per-video override

Files: `popup.js`, `popup.html`, `site-configs.js`, `youtube-popup.js`, `youtube-adapter.js`.

1. User clicks the extension's toolbar icon → `popup.html` opens.
2. `popup.js` `loadAdapterSection()`:
  1. `resolveActiveSite()` → `{ tab, host, protocol, href }`. Tries
    `tab.url` first (works under `activeTab`); falls back to a
     `lws-site-info` message to the content script (which always
     knows `window.location`).
  2. Resolves `findSiteConfig(site.host)` from `site-configs.js`;
    on YouTube this matches the entry whose `popupModule` is
     `'youtube-popup.js'`.
  3. Dynamic-imports `./youtube-popup.js` and calls
    `renderSection({ tab, href, container })`.
3. `youtube-popup.js` `renderSection`:
  1. Bails if the URL isn't `youtube.com/watch?...` (the adapter
    section stays hidden).
  2. `chrome.tabs.sendMessage(tab.id, { type: 'lws-yt-popup-info' })`.
  3. Adapter responds with `{ active, videoId, tracks, secondaryLang }`.
4. `renderTrackSelect` builds a single `<select>` row labelled
  "Secondary". Options are every distinct non-Korean language in the
   tracklist (ASR tracks get an `(auto)` suffix), plus the user's
   currently-selected secondary as `(translated)` if not in the
   tracklist, plus a final `Off` option.
5. User picks an option. `setOverride(videoId, lang)` reads
  `chrome.storage.local.dualSubsOverrides`, merges in
   `{[videoId]: lang}`, writes it back.
6. The adapter's `onChanged` listener for `local.dualSubsOverrides`
  fires, sees the entry for the current videoId changed, calls
   `deactivate()` + `activate()`. The overlay tears down and remounts
   with the new secondary.

### 6.10 Settings page changes propagate via storage

Files: `options.js`, `content.js`, `youtube-adapter.js`.

The options page never directly messages content scripts. It only
writes to `chrome.storage.sync`. The relevant listeners (see §5) fire
in every open tab and respond. The same pattern is used by the popup's
enable/disable toggle.

---

## 7. Per-file walkthrough

One section per file under `extension/`. Each lists purpose, public API,
module-level state, and the non-obvious invariants.

### 7.1 `manifest.json`

MV3 manifest. Notable bits:

- `permissions: ["storage", "unlimitedStorage", "activeTab"]` — no
host permissions on `<all_urls>` because the dictionary fetches
happen from the background service worker, which is bound by
`host_permissions`. `activeTab` is needed so the toolbar popup can
read `tab.url` for the active tab (used by the per-site disable
toggle and the per-site adapter section). Without it, both
`chrome.tabs.query` calls return a tab whose `url` is undefined and
the popup silently bails before unhiding anything.
- `host_permissions`: `krdict.korean.go.kr`, `opendict.korean.go.kr`,
`hangulhanja.com`. That's the entire network surface.
- `content_security_policy.extension_pages: "script-src 'self' 'wasm-unsafe-eval'; ..."` — the WASM analyzer needs `wasm-unsafe-eval` to instantiate inside the MV3 service worker.
- `browser_specific_settings.gecko.strict_min_version: "121.0"` —
Firefox 121+ for MV3 service-worker support (the SW is `type: "module"`).
- `content_scripts`: `content.js` + `content.css`, matches
`<all_urls>`, `run_at: document_idle`, `all_frames: false`.
- `web_accessible_resources`: every JS module that `content.js`
dynamic-imports (`parsers.js`, `grammar-glosses.js`, `site-configs.js`,
`youtube-adapter.js`, `youtube-page-hook.js`), plus
`popup-shadow.css`. These are accessed via
`chrome.runtime.getURL(...)` — the dynamic `import()` in
`content.js` needs the absolute extension URL.

### 7.2 `content.js`

Purpose: the only file that touches the page DOM. Scans for Hangul text,
wraps each Korean word in a `.lws-word` span, listens for hover/click
events, owns the Shadow-DOM popup, and renders dictionary results.

This is the biggest file in the extension (~1500 lines). Key sections:

#### Module-level state

All `let` bindings inside the top-level async IIFE:


| Binding                                                                            | Purpose                                                               |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `enabled`, `hostDisabled`                                                          | `enabled = !hostDisabled`; flips on `disabledHosts` onChanged         |
| `defLang`, `secondaryLang`, `askAiPromptTemplate`                                  | Read at init; updated by onChanged                                    |
| `popupHost`, `popupRoot`, `popupEl`                                                | Shadow-DOM popup parts; created lazily                                |
| `activeWordEl`                                                                     | The `.lws-word` currently being hovered                               |
| `lastPayload`                                                                      | Last `LookupResponse` for re-rendering after toggles                  |
| `lastSentence`                                                                     | The `{before, word, after}` used for the current popup                |
| `activeInsightTab`                                                                 | `'breakdown' | null` — which insights panel is open                   |
| `activeTabIdx`                                                                     | Active KRDict-entry tab (homograph switching)                         |
| `relatedExpanded`                                                                  | Whether the "+N related" pill has been clicked                        |
| `popupMinHeight`, `popupMinWidth`                                                  | Monotonic non-decreasing — popup never shrinks during a session       |
| `expandedExamples`                                                                 | Set of `senseId` keys whose examples are open                         |
| `expandedHanja`                                                                    | Set of Hanja-character strings whose meanings panels are open         |
| `hideTimer`, `hoverTimer`                                                          | Timeout handles for the 120 ms hide / 60 ms hover delay               |
| `pendingRequestId`                                                                 | Monotonic counter; lookup responses past this are discarded           |
| `pausedVideo`, `resumeVideoOnHide`, `suppressNextPauseEvent`, `videoPauseListener` | Video auto-pause state (see below)                                    |
| `hanjaSession`                                                                     | Per-session Map of Hanja chars → result (avoids re-flash on rerender) |


#### Word scanning

`wrapTextNode`, `collectTextNodes`, `processInChunks`, `scanRoot`:
classic TreeWalker pipeline. Hangul detection is `/[가-힣ᄀ-ᇿ㄰-㆏]+/g` —
the precomposed syllable block, plus the leading/trailing Jamo blocks,
plus the compatibility Jamo block. Conjoining Jamo (Korean morphemes
that haven't been precomposed into a syllable) are intentionally
included; punctuation, latin, digits are excluded.

`isSkippableNode` walks parents of a text node and rejects descendants
of `<script>`, `<style>`, `<textarea>`, `<input>`, `<code>`, `<pre>`,
`<noscript>`, `<iframe>`, `<canvas>`, `<svg>`, `contenteditable`
elements, and existing `.lws-word` spans (to keep MutationObserver
re-scans idempotent).

`processInChunks` batches at 80 nodes per `requestIdleCallback` tick so
a multi-MB Wikipedia page doesn't freeze the main thread on first load.

#### Popup lifecycle

`ensurePopup` lazily creates `popupHost` (a `position: absolute` div
attached to `document.documentElement` at coords 0,0), attaches an open
shadow root, mounts a `<link rel="stylesheet" href="...popup-shadow.css">`
inside, and creates the inner `#lws-popup` element.

`positionPopup(target)`:

- Computes preferred position in viewport coords (below the word + 8 px,
flipped above if it would overflow the bottom, clipped at the right
edge).
- Converts to document coords (`+ window.scrollX/Y`) before writing —
the popup is `position: absolute` so it stays attached to the document
origin and scrolls with the page.

`showPopup(target, contentNode, opts)`:

- Replaces popup contents, applies remembered `min-height`/`min-width`
so the popup never shrinks below its largest-seen size this session
(keeps the cursor inside the popup boundary across tab/lang/example
toggles).
- `opts.reposition !== false` is the default for fresh shows; tab/lang
re-renders pass `reposition: false`.
- After the next paint, captures the actual rendered size and bumps the
monotonic min-size memos.
- Calls `pauseVideoIfApplicable(target)` (idempotent within a session).

`hidePopup` is wired to a 120 ms `mouseleave` delay (`scheduleHide`),
cancellable when the cursor re-enters either the word or the popup.

#### Video auto-pause / resume

When `siteConfig.findVideo()` returns a video element:

- `pauseVideoIfApplicable(anchor)` first checks that the hovered word
(`anchor`) is inside the configured `sentenceContainer` — the same
selector that identifies caption-style text. This prevents hovers on
the video title, comments, description, or any other non-caption text
from interrupting playback. If the anchor isn't in a caption
container, no pause happens.
- On first eligible `showPopup` of a session, pauses the video, sets
`pausedVideo` and `resumeVideoOnHide`, and attaches a `pause` event
listener.
- The listener swallows exactly one event (the one our own
`.pause()` emitted) via `suppressNextPauseEvent`. Any subsequent pause
event is the user's, and it flips `resumeVideoOnHide` to `false`
(so we don't override their explicit pause when they're done reading
the popup).
- `resumeVideoIfApplicable` runs on `hidePopup`; only resumes if
`resumeVideoOnHide` is still `true` and the video is still paused.

#### Sentence extraction

`extractSentence(wordEl)`:

1. If `siteConfig.sentenceContainer` is set, use
  `wordEl.closest(selector)` — for YouTube this is `.lws-ytsubs-ko,  .captions-text, .caption-window, .ytp-caption-window-container`.
2. If `closest()` returned null OR no site-specific selector exists,
  walk up the DOM until hitting a `SENTENCE_BLOCK_TAGS` element
   (`<p>`, `<li>`, `<td>`, `<th>`, `<blockquote>`, `<figcaption>`,
   `<article>`, `<section>`, `<h1-6>`, `<dt>`, `<dd>`, `<caption>`,
   `<summary>`) — or stop at a `<div>` that has reasonable text.
3. Read `block.textContent`, normalize whitespace, reject if shorter
  than 3 chars or longer than 800 chars.
4. Locate the surface within that text, truncate to ±80 chars with
  ellipses, return `{before, word, after}`.

#### Result rendering

`buildResultNode(payload, options)` is the big one:

1. Parse the XML — `payload.krXmls[]` (new format) or
  `[krXml, krXmlExtra].filter(Boolean)` (legacy cached payloads).
2. `mergeKrEntriesAll(groups)` dedupes across parallel-query result
  groups by `(word|pos|definition[0..40])` — earlier groups (more
   specific queries) win.
3. Render the strip (lemma chip + EN/KR toggle), the sentence band,
  the insights node (morpheme breakdown tab).
4. Partition entries into primary vs related using the multiPrimary
  flag and promoted forms (see §9).
5. Sort primary so entries whose word equals the literal surface lead
  (stable sort).
6. Render tab bar (if >1 entry or hidden related entries), then the
  active entry via `buildKrEntryNode`.
7. If OpenDict has results, render those under a "OpenDict experimental"
  section label.

`buildKrEntryNode` lays out: headline (word + ★ stars), meta row (POS
chip, pronunciation chip, Hanja-origin chip), the Hanja meanings panel
(conditional on `expandedHanja`), then numbered senses with their
translations / definitions and the per-sense "Show examples" toggle.

#### POS shortform adapter

`displayPosKoreanToEnglishMaybe(pos)` translates Sejong tags (NNG, VV,
JKB, ...) into KRDict-style Korean POS labels (명사, 동사, 조사, ...) so
`posToShortform` from `parsers.js` produces the right shortform — that
helper expects KRDict's POS vocabulary, not mecab's tagset.

#### onMessage / onChanged listeners

`chrome.storage.onChanged` listens for `disabledHosts` (`local` area —
on enable: rescan + load adapter; on disable: hide popup + unwrap
spans), `defLang` (rerenderActivePopup), `secondaryLang` (cache new
value, used by the next Ask-AI pill render), and `askAiPrompt`
(swap the cached template; pill href is rebuilt on next render).

The content script also registers a `chrome.runtime.onMessage`
listener for `lws-site-info` (used by `popup.js` to discover the
hostname when `chrome.tabs.query` returns `tab.url === undefined`).
`youtube-adapter.js` registers its own listener for
`lws-yt-popup-info`. `lookup` requests still flow content →
background, not the other way.

### 7.3 `background.js`

Purpose: service worker. Owns the mecab WASM analyzer, the two caches,
and the network-side dictionary requests.

Module-level state:


| Binding             | Purpose                                                               |
| ------------------- | --------------------------------------------------------------------- |
| `cache`             | `createCache(adapter)` — `lookup:` namespace                          |
| `hanjaCache`        | `createCache(adapter, { namespace: 'hanja' })`                        |
| `mecabInstance`     | `Mecab` instance once initialized, otherwise null                     |
| `mecabReadyPromise` | In-flight init promise (so concurrent first-hovers don't double-init) |


`ensureMecab()`:

1. Returns cached instance if already initialized.
2. Otherwise: `init({ module_or_path: chrome.runtime.getURL('vendor/mecab-ko/mecab_ko_wasm_bg.wasm') })` — the wasm-bindgen `init` import accepts an explicit URL so the SW doesn't try to import.meta.url-resolve against itself.
3. `Promise.all` fetches `sys.dic.gz`, `matrix.bin.gz`, `entries.bin.gz`
  and pipes each through `DecompressionStream('gzip')` (built into MV3
   SWs since Chrome 80).
4. `Mecab.withDictBytes(trie, matrix, entries)` — the fork-only
  constructor that takes in-memory bytes instead of filesystem paths
   (see [MECAB_INTEGRATION.md](MECAB_INTEGRATION.md)).

`tokenizeSurface(surface)` wraps `mecab.tokenize(surface)` and
normalizes the WASM class instances into plain JS objects (for
structured-clone via `sendMessage` and `chrome.storage.local.set`). Any
error is swallowed → returns `null`, and `lemmaCandidates` falls back
to surface-only candidates.

`handleLookup(surface)` — see §6.2 step 4 for the full pipeline. Key
points:

- Top 4 distinct candidates fired in parallel via `Promise.all`. The
first non-empty per slot is collected into `krXmls[]` along with
the corresponding query in `queriesUsed[]`.
- `multiPrimary = candidates.length > 0 && candidates[0] === surface` —
this is the lemmatizer's surface-first signal that the surface is a
pure noun compound (see §8). It controls how the partition logic in
`buildResultNode` divvies primary vs related entries.
- Backward-compat: `krXml = krXmls[0]`, `krXmlExtra = krXmls[1]`,
`queryUsed = queriesUsed[0]`, `queryUsedExtra = queriesUsed[1]` —
older cached payloads in `storage.local` don't have the new array
field, so `buildResultNode` reads both.

`handleHanjaLookup(chars)` is much simpler: the whole Hanja string is
the cache key, the API takes the whole string at once and returns one
entry per character.

`chrome.runtime.onMessage` dispatches by `msg.type` — see §5 for the
table. Returning `true` from the listener keeps `sendResponse` open
across the async boundary.

`chrome.runtime.onInstalled` on `reason === 'install'` opens the
options page so the user lands on the "paste your API key" form.
There is no longer any default-state write — the extension is "on"
unconditionally; the only soft-disable is per-host (`disabledHosts`
in `chrome.storage.local`) toggled from the popup.

### 7.4 `lemmatizer.js`

Purpose: given mecab tokens and the original surface, produce an ordered
list of dictionary-form candidates to try against KRDict. Pure function;
fully unit-tested in Node.

Public:

```js
export function lemmaCandidates(tokens, surface): string[]
export function inflectStem(features): string | null
```

See §8 below for a deep dive on the rules. Key tag groups:


| Constant               | Tags                        | Used to                                                                          |
| ---------------------- | --------------------------- | -------------------------------------------------------------------------------- |
| `VERB_LEAD_TAGS`       | VV VA VX VCN VCP XSV XSA    | Build `<stem>다` per-token                                                        |
| `NOUN_LEAD_TAGS`       | NNG NNP NR NP SL SH SN      | Use morpheme as-is per-token                                                     |
| `COMPOUND_PREFIX_TAGS` | NNG NNP NNB NR NP MM XR XSN | Accumulate as prefix before an XSV/XSA — wider than NOUN_LEAD_TAGS so 한잔하다 works |
| `COMPOUND_DERIV_TAGS`  | XSV XSA                     | Consume the accumulator and emit `<prefix><stem>다`                               |
| `COMPOUND_NOUN_TAGS`   | NNG NNP NR NP XSN           | Surface-first promotion when every token is one of these                         |


### 7.5 `parsers.js`

Purpose: KRDict and OpenDict XML → normalized entry objects, plus a
batch of POS / Hanja / grade / outbound-link helpers. Pure module —
`DOMParser` is dependency-injected so it can be unit-tested with
`@xmldom/xmldom` in Node and uses the global `DOMParser` in the
content script.

Exports:

- `parseKrdictXml(xml, DOMParserCtor): KrEntry[]`
- `parseOpendictXml(xml, DOMParserCtor): OdEntry[]`
- `filterTranslations(translations, target)` — OpenDict translations
are tagged with `language_type` (e.g. `"영어"`); this filters to a
single language using a regex matcher (`en` → `/영어|english/i`).
- `gradeToStars(grade)` — `"초급" → "★★★"`, `"중급" → "★★"`,
`"고급" → "★"`, else `""`.
- `gradeToTooltip(grade)` — human-readable tooltip explaining the
difficulty level.
- `posToEnglish(pos)` — KRDict's `"동사"` → `"Verb"`, etc.
Falls through to the original string for unknown values (so they still
render).
- `posToShortform(pos, lang)` — abbreviated form for tab strips.
English (default) produces `"n."`, `"v."`, `"adj."`; Korean produces
the single-character Sejong-style `"명"`, `"동"`, `"형"`.
- `posExplanation(pos, lang)` — one-sentence tooltip explaining the POS.
- `isHanjaChar(ch)` — `[一-鿿㐀-䶿]` (CJK Unified + Extension A).
- `hanjaCharUrl(ch)` — builds the `hangulhanja.com/en/hanja/<encoded>` link.
- `isVerbLikePos(pos)` — true for verbs and adjectives ("descriptive
verbs"), which both conjugate the same way in Korean.
- `koreanVerbUrl(hangulWord, pos)` — builds the `koreanverb.app/?search=`
link, but only for verb-like POS and only when the word ends in `다`
(defensive: malformed data shouldn't link out).

`KrEntry` shape: `{ word, pronunciation, grade, pos, origin, senses: [{ definition, translations: [{trans_word, trans_dfn}], examples: [string] }] }`.

`OdEntry` shape: `{ word, pos, origin, senses: [{ definition, translations: [{trans_word, trans_dfn, language_type}], examples: [string] }] }` — note
the language_type field on translations, used by `filterTranslations`.

Example extraction handles both KRDict's `<example><type>…</type><example>…</example></example>` wrapping AND OpenDict's `<example_info><example>…</example></example_info>` wrapping by collecting every `<example>`/`<example_text>` leaf (no nested example children) and de-duplicating.

### 7.6 `api.js`

Purpose: pure URL builders and response-shape sniffers. Zero
dependencies on fetch, chrome.*, or DOM.

Exports:

- `KRDICT_ENDPOINT`, `OPENDICT_ENDPOINT`, `MIN_NUM` constants.
- `buildKrdictUrl(query, apiKey, options)` — sets `part=word`,
`translated=y`, `trans_lang=1` (English), `num` clamped to `[10, 100]`,
`sort=dict`.
- `buildOpendictUrl(query, apiKey, options)` — same family;
`req_type=xml` by default. OpenDict doesn't gate translations behind
a `trans_lang` parameter — they're inline in `<translation_info>`
blocks.
- `looksEmpty(xml)` — used by the SW to decide whether to fall through
to the next candidate without DOMParser-parsing in the SW (no DOM
available there). Returns `true` for: falsy/empty, `<error …>`
wrapper, `<total>0</total>`, or missing `<item>`.
- `extractApiError(xml)` — `{ code, message }` from a KRDict error
envelope, or `null` if not an error response. Used by the options-page
"Test KRDict key" button.

### 7.7 `cache.js`

Purpose: two-tier (in-memory LRU + injected storage adapter) cache
factory. Used twice in `background.js` — once for KRDict responses
(`lookup:` namespace), once for Hanja gloss responses (`hanja:`
namespace).

Exports:

- `createCache(storage, opts)` — `opts: { l1Limit?: 500, namespace?: 'lookup' }`.
Returns `{ get, set, clear, l1Size }`.
- `chromeStorageAdapter(area)` — wraps `chrome.storage.local` (or
`.sync`) into the adapter shape, handling both Promise and callback
styles defensively.

L1 is a `Map` — `Map`'s insertion-order iteration plus delete-and-re-set on access gives LRU for free.

L2 reads write back to L1 (cold-cache promotion). L1 evicts the oldest
entry when it exceeds `l1Limit` (default 500).

`clear()` only deletes namespace-prefixed keys when the storage adapter
supports `getKeys()` (it does in production — `chrome.storage.local`
has `.getKeys()` since Chrome 130; the fallback `storage.clear()` blows
away everything, which is fine for test adapters but never hit in
production).

### 7.8 `grammar-glosses.js`

Purpose: hand-curated table of short English glosses for the morphemes a
learner sees over and over — particles, endings, common verb stems. Used
by the popup's morpheme-breakdown chips to attach a one-line meaning to
each piece.

Exports:

- `morphemeGloss(form, pos)` — three-tier lookup:
  1. `FORM_POS_GLOSSES['<form>|<lead>']` — disambiguates homographs
  like `을|JKO` (object marker) vs `을|ETM` (future-tense modifier),
  `이|JKS` vs `이|VCP`, `은|JX` vs `은|ETM`.
  2. `FORM_GLOSSES[form]` — exact-form matches that aren't ambiguous
  (`에서`, `으면`, `었`, `습니다`, ...).
  3. `POS_GLOSSES[lead]` — last-resort fallback ("subject particle",
  "pre-final ending", "noun-forming suffix", ...).
- `isContentMorpheme(m)` — for filtering: drops punctuation marks
(`SF/SE/SS/SP/SO/SW/SY`) but keeps `SH` (Hanja), `SL` (Latin/foreign),
`SN` (numerals), which are real content morphemes.

### 7.9 `site-configs.js`

Purpose: the single registry that makes the extension's video-site
behavior modular. Currently registers YouTube (full adapter + popup
module) and Netflix (Phase-1 hover support — just sentence selector
and findVideo, no adapter yet). Adding another site is "append a
SITE_CONFIGS entry, optionally drop in two files" — no edits to
`content.js` or `popup.js`. Fields:

- `sentenceContainer` — CSS selector used by `content.js`'s
  `extractSentence` instead of the default block-element walk, AND the
  caption-vs-prose signal that gates auto-pause. Tightest match wins
  (we use `closest()`). For YouTube and Netflix, the selector lists
  our own overlay's KO line class FIRST (`.lws-ytsubs-ko` /
  `.lws-nxsubs-ko`), then the host's native caption containers as
  fallbacks. **Important**: when an adapter mounts its own overlay
  AND hides the host's native captions, its overlay's KO class MUST
  be in this selector — otherwise `closest()` returns null when the
  user hovers over the overlay (native containers are gone), so
  pause-on-popup silently doesn't fire. Hidden-native + missing
  overlay-class in `sentenceContainer` is a bug-shaped pattern; the
  fix is one comma-separated entry.
- `findVideo()` — returns the page's main video element (or null). Used
by `content.js` to auto-pause when the popup opens, but only when the
hover is inside `sentenceContainer` (so comments / titles don't pause
the video).
- `adapter` — relative path to a content-script-side JS module that
gets dynamic-imported and whose `setup()` is invoked. The adapter
owns its lifecycle including teardown on SPA navigation. For YouTube
this is the dual-subs overlay + page-hook injection.
- `popupModule` — relative path to a popup-side module. `popup.js`
  dynamic-imports it when the active tab matches this config and calls
  `renderSection({ tab, href, container })` (`href` is the page URL,
  resolved by popup.js from `tab.url` or the content-script fallback).
  The module owns all DOM inside
  the container (a hidden `<section id="site-adapter-section">` in
  `popup.html`) and is responsible for `container.hidden = false`. Use
  this for per-site UI in the toolbar popup — e.g. YouTube's
  per-video secondary-language picker.
- `stylesheet` — optional CSS string. `content.js` injects it as a
  `<style id="lws-site-style">` tag at init, only when the host
  matches this entry. The injection is idempotent (the `id` guard
  prevents double-add on re-injection). Use for per-site visual
  fixes that don't belong in the generic `content.css` — e.g. the
  Netflix entry uses this to promote `.player-timedtext` above the
  player-controls overlay so the controls don't intercept hovers
  meant for our `.lws-word` spans.

Exports:

- `SITE_CONFIGS` — array of site entries (YouTube + Netflix today).
- `findSiteConfig(hostname)` — exact host match or regex (`cfg.match`).
  Returns `null` for unknown hosts (which is the most common case;
  default `content.js` behavior applies).

### 7.10 `youtube-adapter.js`

Purpose: site adapter for YouTube. Runs in the isolated content world.
Replaces the native caption rendering with a dual-line overlay (Korean +
secondary language).

Module-level state:


| Binding                     | Purpose                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `teardownFn`                | When non-null, dual subs are active for this video                                                                                      |
| `activeGeneration`          | Bumped by every activate / deactivate. activate's post-await checks compare to this to detect supersession                              |
| `hostUnwrap` / `hostRescan` | Callbacks supplied by content.js's loadAdapter — invoked around SPA navs to keep `.lws-word` spans out of YouTube's reconciliation path |
| `hookInjected`              | Once true, don't re-add the `<script src>` tag                                                                                          |
| `lastTracklist`             | Most recent tracklist, exposed to popup via onMessage                                                                                   |
| `lastVideoId`               | YT video ID currently active                                                                                                            |
| `lastSecondaryLang`         | Currently-rendered secondary language                                                                                                   |
| `cmdSeq`                    | Monotonic counter for `reqId` in postMessage cmds                                                                                       |


Public:

- `setup(api)` — wires up storage listeners, message listener,
navigation listeners, injects the hook, calls `activate()`. `api`
is `{ unwrap, rescan }` from content.js; both default to no-ops.

Implementation notes:

- `currentVideoId()` reads `?v=` from the URL — robust to the
back-button SPA-style navigation YouTube does.
- `resolveSecondaryLang(videoId)` does a parallel sync+local read,
catches per-promise failures so one bad read doesn't sink the other.
Per-video override wins; default is `sync.secondaryLang || 'en'`.
- The `setInterval(..., 500)` poll is a fallback for cases where
the `yt-navigate-finish` event doesn't fire (some YouTube internal
navigation paths skip it). Its primary trigger is a change in
`player.getVideoData().video_id` (queried via the `video-id` hook
command); URL change is a secondary trigger. The video_id signal is
always-fresh — during autoplay the player swaps to the next video's
`video_id` immediately, but `?v=` in `location.href` can lag by
hundreds of ms (long enough for YouTube to re-render the title /
description containers into our stale `.lws-word` spans, producing
the "AB" mangling). Both signals fan into the same `handleNavStart`
/ `handleNavFinish` pair so the unwrap / activate logic is shared.
- **SPA navigation race**: `activate()` is async — its
`waitForVideoElement` + `waitForTracklist` + `captureBaseTrack`
chain can take seconds. Without the generation token, a YouTube
auto-advance to the next video would trigger
`deactivate()` → `activate(#2)` while `activate(#1)`'s pipeline was
still mid-flight. Both would eventually mount overlays, but only
`#2`'s `teardownFn` would be tracked — `#1`'s overlay stayed in the
DOM, so the next video showed both videos' subs. `activeGeneration`
fixes this: every `activate`/`deactivate` bumps it; after each
`await`, `activate` rechecks and tears down its own work if a
newer generation is current.
- **"AB" title mangling**: YouTube SPA-nav reuses the same DOM
containers for the video title, description, channel sidebar, etc.
When those containers still contain our `.lws-word` spans from the
previous video, YouTube's renderer can't cleanly replace the text
— it ends up appending the new text alongside our stale spans
("A" → "AB"). `handleNavStart` calls `hostUnwrap()` to strip the
spans BEFORE YouTube does its update; `handleNavFinish` calls
`hostRescan()` 250 ms later to rewrap the new content. This had
to be wired to the `video_id` poll (not just URL change) because
autoplay starts the next video — and re-renders those containers
— before the URL's `?v=` updates, so a URL-only signal would miss
the transition and leave the stale spans in place.
- Caption-source picking is the most subtle bit — see §10.
- Overlay container is `.html5-video-player` (the player root), not
the inner `.html5-video-container`. The inner container is
`position: static`, so a `bottom: 80px` on a `position: absolute`
child resolves against the wrong ancestor and the overlay floats above
the visible video area. Cost a bit of debugging to figure out.
- `findLineIdx(lines, t)` is a binary search — for a long video with
thousands of subtitle lines this matters; a linear scan on every
`timeupdate` (which fires ~250 ms) would burn CPU.
- **CC-bound visibility**: the overlay's `display:none` ↔ visible is
driven by a 500 ms CC observer that polls `get-track` and classifies
the player's current selection. There used to be a `triggerLoadTrack(ko)`
at the end of the capture pipeline that force-selected Korean — that
made YouTube's CC button useless as an off switch (the next poll
re-engaged KO). Removed: now `restoreTrack(initialTrack)` puts the
player back to whatever the user had before the capture flips. The
user's CC choices (off / KO / EN / whatever) are authoritative; the
overlay is just a mirror.
- `readCurrentTrack()` is fail-open — if `get-track` errors out or
times out, it returns `null` (treated as `CC_OFF`). Better the user
sees no overlay than a stuck-on overlay they can't dismiss.

### 7.11 `youtube-page-hook.js`

Purpose: runs in the page main world. Monkey-patches `XMLHttpRequest.prototype.open` and `window.fetch` to capture every `/api/timedtext` request the YouTube player makes, and posts the URL + response body back to the content script via `window.postMessage`. Also exposes a command channel for the adapter to query the player's tracklist and trigger track loads (since `player.getOption` / `player.setOption` are page-world expandos invisible to isolated scripts).

Message protocol:

1. `__lwsYtCaption` — broadcast on every captured request. The adapter's
  `captureCaption` filters by URL predicate.
2. `__lwsYtCmd: 'tracklist'` — request. Hook returns
  `player.getOption('captions','tracklist')` (live for the current
   video, but sometimes empty on ASR-only videos before CC is enabled).
3. `__lwsYtCmd: 'player-response-tracks'` — request. Hook returns the
  tracklist from `getCurrentPlayerResponse()` as a fallback /
   supplement to (2). Adapter merges both sources in `waitForTracklist`.
4. `__lwsYtCmd: 'load-track'` — request; the hook calls
  `player.setOption('captions', 'track', {})` then
   `player.setOption('captions', 'track', { languageCode: lang })`. The
   clear-then-set pattern forces a fresh `/api/timedtext` fetch even
   when the player thinks it already has the target track loaded.
5. `__lwsYtCmd: 'get-track'` — request. Hook returns
  `player.getOption('captions','track')` — `{}` when CC is off, a
   populated track object when CC is on. The adapter uses this for
   its CC-bound visibility state machine (see §7.10).
6. `__lwsYtCmd: 'clear-track'` — request. Hook calls
  `player.setOption('captions', 'track', {})` once. Used by the
   adapter to restore CC-off after the capture pipeline forced tracks
   to fetch caption bodies; without this the user would find CC
   silently enabled on every video they opened.
7. `__lwsYtCmd: 'video-id'` — request. Hook returns
  `player.getVideoData().video_id` (falling back to
   `getCurrentPlayerResponse().videoDetails.videoId` if `getVideoData`
   isn't available yet). The adapter's SPA-nav poll uses this as the
   primary "which video is loaded right now" signal because the
   player updates `video_id` the instant autoplay swaps to the next
   video — well before the URL's `?v=` reflects the change.

There used to be an `audio-info` command that returned the inferred
audio language from `getCurrentPlayerResponse()` — removed because
`player.getPlayerResponse()` doesn't actually exist on the inline
player element, so `getCurrentPlayerResponse()` fell through to
`window.ytInitialPlayerResponse` (stale post-SPA-nav) and audio
detection got the first video's data forever. Audio detection now
runs in the adapter against the already-fetched tracklist's ASR
track; see `detectAudioLangFromTracklist` and §15.11.

The hook is idempotent via `window.__lwsYtHookInstalled`.

### 7.12 `popup.html` / `popup.js` / `popup.css`

The toolbar action UI — what opens when the user clicks the extension's
icon. Four sections:

- Per-site toggle — shown only on `http(s):` pages. Reads the active
  tab's hostname via `resolveActiveSite()` (tabs API first, content
  script fallback if `tab.url` is undefined), then toggles membership
  in `disabledHosts` (`chrome.storage.local` array). When the user
  flips it, the content script's `onChanged` listener for
  `disabledHosts` activates / deactivates immediately. The list is
  sorted on every write so storage diffs stay small. There is no
  global hover-dictionary toggle here anymore — for "off everywhere",
  use `chrome://extensions`.
- Adapter section — generic shell. `loadAdapterSection()` resolves the
  active tab's hostname against `findSiteConfig(...)` from
  `site-configs.js`, and if the matched config declares a
  `popupModule`, dynamic-imports that module and calls
  `renderSection({ tab, href, container })`. The module owns the DOM
  under `<section id="site-adapter-section">`. For YouTube this is
  `youtube-popup.js` (secondary-subs dropdown). Adding Netflix / Viki is
  a new SITE_CONFIGS entry + its own `*-popup.js` — no edits to
  `popup.js` or `popup.html`.
- Links row — a left-aligned row of small inline-SVG icons at the
  bottom of the popup. Two are always present and baked into
  `popup.html`: Notepad (opens `notepad.html` (§7.x) in a new tab; its
  `href` is resolved at popup-open time via
  `chrome.runtime.getURL('notepad.html')` since the extension ID isn't
  known until runtime) and Settings (gear `<button>` wired to
  `chrome.runtime.openOptionsPage()`). External links (GitHub, Discord)
  live in a `LINKS` dict at the top of `popup.js` — a non-empty URL
  renders an active `<a>` for that key, an empty string renders a
  greyed `link-icon--disabled` placeholder. To enable GitHub or surface
  a Discord invite, set the URL in `LINKS`; no HTML/CSS edits needed.
- Ko-fi support banner — a full-width red button below the links row.
  Gated by `LINKS.kofi` in `popup.js`: empty string leaves it dimmed
  and non-interactive (`kofi-banner--disabled`); setting a URL flips it
  to an active link. No HTML/CSS edits needed to activate it.

`popup.js` stays a settings/status shell — no Korean-text rendering
of its own.

### 7.12.1 `youtube-popup.js`

Popup-side counterpart to `youtube-adapter.js`. Exports
`renderSection({ tab, container })` which:

1. Returns silently if the tab isn't on `/watch`.
2. Renders an italic "Asking the page…" status line and unhides the
  container so the user sees something while we wait.
3. Sends `lws-yt-popup-info` to the active tab; the content-script
  adapter responds with `{ tracks, secondaryLang, ... }`.
4. Replaces the status line with a single `<select>` (label
  "Secondary") containing every distinct non-Korean language in the
   tracklist. ASR-only tracks get an `(auto)` suffix; if the user's
   currently-selected secondary isn't natively in the tracklist, it's
   surfaced as `(translated)`. Final option is `Off`.
5. Writes the per-video selection to
  `chrome.storage.local.dualSubsOverrides`; the adapter's onChanged
   listener picks it up and re-activates without a direct message.

### 7.13 `options.html` / `options.js` / `options.css`

The settings page. Linked from the popup (gear icon in the links row) and from
`chrome://extensions` via the manifest's `options_page` field. Sections:

- API keys: KRDict (required) + OpenDict (optional, experimental).
  Both inputs are `type="password"`. A "Test KRDict key" button hits
  the real API with `q=사람` and surfaces the error code or success.
- Behaviour: dual-subs toggle (YouTube), dual-subs toggle (Netflix), default secondary language dropdown.
- Advanced (collapsible `<details>`, closed by default): "Ask AI"
  prompt template textarea + "Reset to default" button. Auto-saves
  to `askAiPrompt` (sync) on blur. Saving an empty value or the
  default text removes the key so the live default re-applies. Also
  an AI-service `<select>` populated dynamically from
  `ai-providers.js` and bound to `askAiProvider` (sync).
- Cache: a "Clear cache" button that sends `{type: 'clearCache'}` to
  the SW.

The settings page is plain settings — paste-a-word lookup has moved
to its own Notepad page (§7.x), so options.html no longer embeds
`content.js` or `content.css`.

Every settings change is written to `chrome.storage.sync` and
propagates to all content scripts via the `onChanged` event — no
direct messaging from the options page.

### 7.13.1 `notepad.html` / `notepad.js`

Standalone extension page reached from the toolbar popup's links row
(§7.12). Two cards:

- "Paste text" — a `<textarea>` with "Add to notepad" + "Clear"
  buttons. Autofocused on landing so the user can paste immediately.
  Ctrl/Cmd+Enter in the textarea is a shortcut for "Add" so the user
  doesn't have to grab the mouse after every paste.
- "Hoverable text" — a target `<div>` with `white-space: pre-wrap` so
  paragraph breaks from the paste survive. Clicking "Add" sets
  `target.textContent = input.value`; content.js's mutation observer
  then wraps each Korean run in a `.lws-word` span, and the regular
  in-page hover popup machinery takes over — same dictionary popup
  the user gets on any webpage.

The page links `content.css` (for the `.lws-word` underline) and
loads `content.js` as a plain `<script src>` at the bottom — its
chrome.* calls and dynamic imports work identically in extension and
content-script contexts. `findSiteConfig(extensionHost)` returns null
so no site adapter loads.

No persistence — the paste is ephemeral, and a page refresh resets
everything. (We may add a "saved snippets" feature later, but the MVP
is deliberately stateless: one paste → hover → done.)

### 7.14 `popup-shadow.css`

The stylesheet for the in-page hover popup. Lives in
`web_accessible_resources` so it can be loaded into the shadow DOM via
`<link rel=stylesheet href=chrome-extension://.../popup-shadow.css>`. It
uses CSS custom properties for theming and includes a
`@media (prefers-color-scheme: dark)` block.

Key sizing decisions:

- `min-width: 380px`, `max-width: min(520px, calc(100vw - 16px))`,
`max-height: 70vh` with `overflow-y: auto`. Width grows with content
so a wide tab strip can extend the popup, but caps at a comfortable
reading column.
- `position: absolute` (not `fixed`) — the popup scrolls with the page.
If a tab click grows it past the viewport, scrolling the page reveals
the rest, which is far better than clipping content the user can't
reach.

### 7.15 `content.css`

Tiny — just `.lws-word { cursor: help; border-bottom: 1px dashed ... }`
and the hover background. The popup itself is in
`popup-shadow.css` because it's inside a shadow root.

### 7.16 `vendor/mecab-ko/`

Vendored, not an npm package. See [MECAB_INTEGRATION.md](MECAB_INTEGRATION.md)
for the fork story. Files:

- `mecab_ko_wasm.js` — wasm-bindgen ES-module glue. Exports `init`
(the WASM initializer) and `Mecab` (the analyzer class).
- `mecab_ko_wasm.d.ts`, `mecab_ko_wasm_bg.wasm.d.ts` — TypeScript
declarations (informational only — the extension is plain JS).
- `mecab_ko_wasm_bg.wasm` — ~145 KB. The analyzer with no dictionary
baked in.
- `sys.dic.gz`, `matrix.bin.gz`, `entries.bin.gz` — gzipped output of
`mecab-ko-dict-builder` against mecab-ko-dic 2.1.1. ~22 MB total
compressed; ~90 MB raw.

The dict files are NOT loaded eagerly. `background.js`'s `ensureMecab()`
fetches and gunzips them on first lookup.

---

## 8. The lemmatizer in depth

`lemmatizer.js` is the single most accuracy-critical pure module in the
extension. The popup is only useful if the candidate it picks for KRDict
is the form a human would look up — and human Korean speakers don't look
up 예약해야 in the dictionary, they look up 예약하다. Getting this
right takes more than just "stem off the ending."

### 8.1 What mecab gives us

Each `tokenize` call returns an array of token objects:

```js
{ surface: '걸려', pos: 'VV+EC', lemma: '걸려', reading: null,
  features: 'VV+EC,*,F,걸려,Inflect,VV,EC,걸리/VV/*+어/EC/*',
  start: 0, end: 2 }
```

The `pos` field carries Sejong-style POS tags, sometimes joined with `+`
for fused morphemes (`VV+EC`, `XSV+EF`, ...). The lemmatizer always
looks at the lead tag (before the first `+`).

The `features` field is the raw mecab-ko-dic CSV row:

```
pos , semantic , jongseong , reading , type     , first_pos , last_pos , decomposition
```

For `type=Inflect` tokens (irregular conjugations stored whole — 걸려,
예뻐요, 봐요, 해야), the `decomposition` column carries the real
morpheme breakdown like `걸리/VV/*+어/EC/*`. The `lemma` column for these
tokens is just a clone of the surface — looking up `걸려` in KRDict is a
waste of bandwidth. The actual stem `걸리` lives only in the
decomposition.

`inflectStem(features)` is the helper that pulls the first stem out:

```js
inflectStem('VV+EC,*,F,걸려,Inflect,VV,EC,걸리/VV/*+어/EC/*')  // '걸리'
inflectStem('VV,*,T,먹,*,*,*,*')                                // null (decomposition = '*')
inflectStem(null) || inflectStem('VV,*,T,먹')                   // null (missing or short)
```

The "type=Inflect" gate matters — without it, we'd try to pull a stem
out of every token whose features column has 8 fields, which is almost
all of them, and we'd start corrupting non-Inflect cases.

### 8.2 Candidate ordering rules, with examples

The function `lemmaCandidates(tokens, surface)` walks tokens and pushes
candidates into a de-duplicated, order-preserving list. The list is
returned to the caller in priority order — `background.js` fires the
top 4 in parallel and the first hit wins.

The push order is:

1. **Surface-first promotion** — if tokens.length > 1 AND every token's
  lead tag is in `COMPOUND_NOUN_TAGS` (NNG NNP NR NP XSN), push the
   surface BEFORE walking the individual pieces. This is the
   pure-noun-compound case.
   Sets `multiPrimary` in the response — see §9.
2. **Compound-prefix accumulator** — walk left to right; accumulate the
  surface of every COMPOUND_PREFIX_TAG token (NNG NNP NNB NR NP MM XR
   XSN) into `prefix`. When you hit an XSV or XSA token, push
   `prefix + stem + '다'` where `stem` is the Inflect-extracted stem if
   any, otherwise the token's lemma or surface (with a trailing `다`
   stripped first so we don't end up with `다다`).
   Anything OTHER than COMPOUND_PREFIX_TAGS / COMPOUND_DERIV_TAGS resets
   the accumulator (so a stray particle doesn't fold into the prefix).
   After the first XSV/XSA, we break — only the first compound is
   emitted.
   The prefix tag set is intentionally wider than NOUN_LEAD_TAGS. MM
   (determiners like 한, 두, 새), NNB (bound nouns like 잔, 번, 적), and
   XR (roots like 깨끗, 행복) all need to participate as prefix so
   determiner+bound-noun+verb-deriving-suffix compounds resolve.
3. **Per-token push** — walk left to right; for each token:
  - Compute `decompStem = inflectStem(features)`, and
    `stem = decompStem || lemma || surface`.
  - If lead tag is in VERB_LEAD_TAGS:
    - **Ambiguous-ㄹ guard** (see §8.3.5 below): when `decompStem` is
      a single syllable AND `surface` is a *different* single syllable,
      push `surface + '다'` first, then `decompStem + '다'` as a
      fallback. Otherwise push `stem` (or `stem + '다'` if it doesn't
      already end in 다).
  - If lead tag is in NOUN_LEAD_TAGS, push `stem` as-is.
  - Otherwise skip — particles, endings, and pure-suffix tokens aren't
  dictionary headwords on their own.
   Note: XR and NNB on their own — without a following XSV/XSA — aren't
   standalone candidates. The per-token loop skips them (they're not in
   NOUN_LEAD_TAGS or VERB_LEAD_TAGS). They only participate when the
   compound-prefix accumulator picks them up.
4. **Surface fallback** — always push the trimmed surface at the end.
  Catches anything the per-token logic skipped (e.g. punctuation-only
   surface, multi-word inputs).

### 8.3 Why the Inflect gate matters

Earlier versions ran `inflectStem` unconditionally and pulled the
first-slash-prefix out of whatever was at index 7 of the features
column. For NNG tokens, that column is typically `*`, so this returned
`null` — fine. But for tokens with `type=Compound` (different from
`Inflect`) the decomposition column also carries a structure:

```
오랜만 → features = 'NNG,*,T,오랜만,Compound,NNG,*,오래/NNG/*+ㄴ/JX/*+만/NNG/*'
```

Without the Inflect gate, we'd extract `오래` as the "stem" and push it
as the primary noun candidate — but the user hovered `오랜만` and wants
that whole word. `inflectStem` is now type-gated: it returns the
extracted stem ONLY when the type column equals `Inflect`, falling
through to `lemma || surface` for everything else.

This split is what makes both pure-noun-compound rules safe to apply at
once: the surface-first rule pushes the whole compound first, and the
per-token loop's NNG path then uses the lemma (the canonical noun form),
not the Inflect-extracted prefix.

### 8.3.5 The ambiguous-ㄹ guard

Even when the Inflect gate fires correctly (`type === 'Inflect'`),
mecab-ko-dic occasionally picks an etymological analysis that gives a
misleading stem. Reproducible case: hovering `가볼게요` ("I'll try
going" / "I'll go and see"). mecab returns two tokens:

```
가/VV     features=… type=Inflect … decomposition=갈/VV/*
볼게요/EC+VX+EF
```

The surface IS `가`, but the dictionary's decomposition column claims
the underlying stem is `갈` (treating `가` as a contracted form of
`갈다` via phantom ㄹ-deletion). `inflectStem` faithfully extracts
`갈`, the per-token loop pushes `갈다` ("to grind"), KRDict happily
returns that — and the learner gets the wrong word.

The guard: when `decompStem` is a single syllable AND `surface` is
ALSO a single syllable AND they differ, the per-token loop pushes
`surface + '다'` FIRST and keeps `decompStem + '다'` as a fallback.
Rationale:

- For irregular conjugations the surface is multi-syllable (`봐요`,
  `해야`, `걸려`, `예뻐요`) — the guard's length check skips them.
- For single-syllable ambiguities (`가`/`갈`, `사`/`살`, `나`/`날`,
  `자`/`잘`), the surface itself is overwhelmingly the more common
  dictionary form in everyday Korean. Pushing it first means KRDict's
  first-hit-wins logic returns 가다 / 사다 / 나다 / 자다 — almost
  always the right answer.
- The rarer reading still gets a fair shot via the fallback push, so
  a genuine 갈다 / 살다 query (when surface really IS that stem) still
  resolves correctly because mecab returns surface=`갈` with stem=`갈`
  — no length mismatch, guard doesn't fire, normal path.

Tests in `tests/lemmatizer.test.js` cover the four cases: 가 fires
the guard, 사 fires the guard, 봐요 (multi-syllable) doesn't, 갈
with matching stem doesn't.

### 8.4 The Sejong POS tags the lemmatizer cares about

For reference, the relevant Sejong tags are:


| Family    | Tag                  | Meaning                          |
| --------- | -------------------- | -------------------------------- |
| Nouns     | NNG                  | Common noun                      |
|           | NNP                  | Proper noun                      |
|           | NNB                  | Bound noun (의존명사)                |
|           | NR                   | Numeral                          |
|           | NP                   | Pronoun                          |
| Pre-noun  | MM                   | Determiner (관형사)                 |
| Verbs     | VV                   | Verb                             |
|           | VA                   | Adjective ("descriptive verb")   |
|           | VX                   | Auxiliary verb / adjective       |
|           | VCN                  | Negative copula (아니다)            |
|           | VCP                  | Copula (이다)                      |
| Suffixes  | XPN                  | Noun-prefixing                   |
|           | XSN                  | Noun-forming                     |
|           | XSV                  | Verb-forming                     |
|           | XSA                  | Adjective-forming                |
|           | XR                   | Root                             |
| Endings   | EP                   | Pre-final ending                 |
|           | EF                   | Final ending                     |
|           | EC                   | Connecting ending                |
|           | ETN                  | Nominalizing ending              |
|           | ETM                  | Modifier ending                  |
| Particles | JKS                  | Subject                          |
|           | JKC                  | Complement                       |
|           | JKO                  | Object                           |
|           | JKG                  | Possessive                       |
|           | JKB                  | Adverbial                        |
|           | JKV                  | Vocative                         |
|           | JKQ                  | Quotative                        |
|           | JX                   | Auxiliary (topic, also, only, …) |
|           | JC                   | Connective                       |
| Symbols   | SL                   | Foreign / Latin                  |
|           | SH                   | Hanja                            |
|           | SN                   | Numeral characters               |
|           | SF/SE/SS/SP/SO/SW/SY | Punctuation                      |


### 8.5 The surface-first signal as a multiPrimary trigger

When the surface-first rule fires (rule #1 above), the resulting
candidates array starts with the surface itself. The lemma chain then
goes on to push the individual nouns:

```
candidates(반말) = ['반말', '반', '말']
```

The background fires the top 4 in parallel — for 반말 that's 3 distinct
queries. For pure-noun compounds, EVERY constituent that came back with
data is a legitimate "primary" answer for a learner — they hovered
"파티원들" and the dictionary entries for 파티, 원, AND any 파티원-prefixed
compounds are all relevant.

`background.js` sets:

```js
multiPrimary = candidates.length > 0 && candidates[0] === surface;
```

This boolean is the only signal `content.js` has that the lemmatizer
took the noun-compound path. The popup then promotes every queried
constituent to a primary tab (rather than burying all but the first
under "+N related"). See §9.

---

## 9. KRDict partition logic

`content.js`'s `buildResultNode` divides the merged-across-parallel-
queries KRDict entries into two visual buckets:

- **Primary** entries get tabs in the tab strip.
- **Related** entries hide behind a `+N related` pill that, when
clicked, appends them as additional tabs.

The partition key is a `promotedForms` set. An entry belongs in primary
iff its `word` (trimmed) is in that set.

### 9.1 What goes into `promotedForms`

Always: the literal hovered surface, plus `<surface>하다` and `<surface>되다`. The +하다 / +되다 promotion catches the very common case where
a noun maps to its action-verb form — `예약` queries return both `예약`
(noun) and `예약하다` (verb); both belong together for a learner, not
split across a primary/related fold.

Then, depending on `multiPrimary`:

- **multiPrimary === true (pure-noun compound case)**: every entry from
`queriesUsed` is promoted. With its `하다`/`되다` variants, that's
potentially 3N forms in the set.
- **multiPrimary === false (verb compound or anything else)**: only the
first query — the canonical lemma — is promoted, plus its `하다`/`되다`
variants. The other queries' constituents stay in "related".

Concrete examples:


| Surface | candidates              | multiPrimary | promotedForms                                |
| ------- | ----------------------- | ------------ | -------------------------------------------- |
| `반말`    | ['반말', '반', '말']        | true         | {반말, 반말하다, 반말되다, 반, 반하다, 반되다, 말, 말하다, 말되다}   |
| `예약해야`  | ['예약하다', '예약', '하다', …] | false        | {예약해야, 예약해야하다, 예약해야되다, 예약하다, 예약하다하다, 예약하다되다} |
| `학교에서`  | ['학교', '학교에서']          | false        | {학교에서, 학교에서하다, 학교에서되다, 학교, 학교하다, 학교되다}       |


Yes, you'll see entries like "예약하다하다" in promotedForms — they
don't match anything in KRDict, so they cost nothing. The set inclusion
is what's load-bearing, not the literal strings.

### 9.2 The sort

If more than one entry is primary AND the literal surface is non-empty,
`primaryEntries.sort` puts entries whose `word === surface` first. The
sort is stable (per ECMAScript 2019), so same-priority entries keep
their merge order (which was insertion order across query groups, with
earlier — i.e. more specific — groups winning).

### 9.3 The merge

`mergeKrEntriesAll(parsedGroups)` walks each per-query result group and
dedupes by `(word|pos|first-40-chars-of-definition)`. The first
occurrence wins. KRDict's broad-match can return overlapping entries
across adjacent queries (querying 파티원들 + 파티 + 원, KRDict's
exact-match for 파티 will include 파티원들 in its loose-match list).
The merge collapses these.

### 9.4 The fallback if no entry is exact

If `exactEntries.length === 0`, the partition collapses — every entry
becomes primary. This handles the case where the lemma chain hit
something looser than the headword (some KRDict idioms / multi-word
expressions whose `word` is wrapped in spaces or punctuation), and we'd
rather show the entries as tabs than as a single locked "+N related"
pill.

### 9.5 The "+N related" expansion

The pill is rendered into the tab strip only when there are hidden
related entries. Clicking it sets `relatedExpanded = true` and
rerenders. On rerender, the hidden entries are concatenated onto
`displayedEntries` — they appear as additional tabs to the right of the
primary ones. The pill itself disappears (since there's nothing left to
expand).

---

## 10. YouTube dual subs architecture

This is the most intricate code path in the extension. Worth its own
section.

### 10.1 Why a page-world hook is needed at all

YouTube serves captions through `/api/timedtext?caps=...&lang=ko&pot=...&signature=...`.
The `pot=...` parameter is a PoToken computed by the player's BotGuard
runtime; the `signature=...` parameter is signed and includes a list of
`sparams` (signed parameters).

The URLs you can read from `ytInitialPlayerResponse.captions .playerCaptionsTracklistRenderer.captionTracks[].baseUrl` are missing
the PoToken. A third-party fetch of one of those URLs returns 200 OK and
0 bytes — YouTube serves you a successful-looking but empty response.

The ONLY caption URLs that actually return data are the ones the
player generated for itself. So to get a caption body we have to:

1. Tell the player to load the track we want.
2. Observe the network request the player makes for the corresponding
  caption.
3. Capture the response body.

Steps 1 and 2 both require access to page-world globals
(`html5VideoPlayer.setOption`, intercepting `window.fetch` and
`XMLHttpRequest.prototype.open`). Content scripts in their isolated
world can't reach those, so we inject `youtube-page-hook.js` as a
`<script src=chrome-extension://.../youtube-page-hook.js>` tag and
communicate over `window.postMessage`.

### 10.2 The command channel


| Direction  | Message shape                                       | Purpose                                        |
| ---------- | --------------------------------------------------- | ---------------------------------------------- |
| iso → main | `{ __lwsYtCmd: 'tracklist', reqId }`                | "What captions does this video have?"          |
| iso → main | `{ __lwsYtCmd: 'load-track', reqId, lang }`         | "Switch to the lang track."                    |
| iso → main | `{ __lwsYtCmd: 'video-id', reqId }`                 | "Which video is loaded right now?" (SPA poll)  |
| main → iso | `{ __lwsYtReply: 'tracklist', reqId, tracks }`      | tracklist reply                                |
| main → iso | `{ __lwsYtReply: 'load-track', reqId, ok, error? }` | load-track ACK                                 |
| main → iso | `{ __lwsYtReply: 'video-id', reqId, videoId }`      | video-id reply (`null` if player not ready)    |
| main → iso | `{ __lwsYtCaption: true, url, status, body }`       | broadcast — every captured timedtext           |


`reqId` is a monotonic-per-content-script-lifetime sequence
(`lws-${Date.now()}-${++cmdSeq}`) so concurrent commands don't get
their replies cross-wired.

Inside `load-track`, the hook does:

```js
try { player.setOption('captions', 'track', {}); } catch {}
player.setOption('captions', 'track', { languageCode: lang });
```

The clear-then-set pattern forces a fresh `/api/timedtext` fetch even
when the player thinks it already has the target track loaded
(otherwise the call no-ops and we capture nothing).

### 10.3 The capture flow

`captureCaption(predicate, timeoutMs = 6000)` returns a promise that:

1. Sets up a `window.message` listener filtering on `__lwsYtCaption: true`.
2. For every captured request, invokes `predicate(data)` — typically a
  URL test like "has `lang=ko` and does NOT have `tlang=`".
3. Resolves on first match; rejects on timeout.

`captureBaseTrack(lang)`:

1. Starts a `captureCaption` race that waits for a URL with
  `lang=<lang>` and no `tlang=`.
2. Sends `__lwsYtCmd: 'load-track'` with that lang.
3. Awaits the capture (or 6 s timeout).

For each unique base language we need, we capture exactly once.

### 10.4 Primary Korean source priority

`pickPrimarySource(tracks)`:

1. Manual KO track (kind !== 'asr') → use directly, target='ko',
  translate=false.
2. KO ASR (auto-generated) → use directly.

We deliberately don't fall back to translating another language's
manual track into Korean. Auto-translated KO from e.g. an English
manual track is misleading for learners — the wording, register, and
morphology won't match what's actually being spoken. KO ASR is
imperfect but at least reflects the actual audio.

Returning `null` means the video has no Korean track at all. The
adapter logs and silently exits — no overlay is mounted.

### 10.5 Secondary user-lang source priority

`pickSecondarySource(tracks, targetLang)`:

1. Manual track in target lang → direct.
2. Any manual track (not in target lang) → translate to target via
  `&tlang=<target>`.
3. Any ASR track → translate to target via `&tlang=<target>`.

If `secondaryLang === 'off'`, we skip this entirely and only render the
Korean line.

### 10.6 Sharing base captures

When the primary and secondary derive from the same base language (e.g.
primary is "KO ASR direct" and the user's secondary preference is also
fed from that ASR via &tlang=…), we only need to capture once. The
`baseLangs` Set in `initForCurrentVideo` collects the unique base
languages and the capture loop fetches each one once.

After capture, if there was more than one base language captured, we
fire one more `load-track` to switch the player back to the primary's
base (avoids the player flashing the secondary's text just as we hide
native captions).

### 10.7 The translate step

For `source.translate === true`, `materializeLines` doesn't use the
captured body directly. It takes the captured URL, sets `tlang` to the
target, and `fetch`es it from the content script's isolated world. The
fetch works because `lang` and `tlang` are NOT in the signed `sparams`
list — they can be appended/changed without invalidating the signature.

### 10.8 Parsing

YouTube serves timedtext in two formats:

- JSON3 (`fmt=json3`): JSON with `events: [{ tStartMs, dDurationMs, segs: [{ utf8 }] }]`.
- SRV1 XML: `<text start="..." dur="...">…</text>` entries with HTML-
encoded text.

`parseTimedText(body)` tries JSON3 first (because it's faster and
unambiguous about whitespace), falls back to SRV1 XML. Both produce
`[{ start, end, text }]` where times are in seconds. SRV1 XML is
HTML-decoded via a `<textarea>` element trick.

### 10.9 Rendering and time sync

The overlay is a single `<div class=lws-ytsubs-overlay>` with two inner
divs (`.lws-ytsubs-ko`, `.lws-ytsubs-en`). It's mounted inside
`.html5-video-player` with `position: absolute; bottom: 80px; z-index: 70`
so it sits above the video and just above the controls bar.

`update()` runs on every `timeupdate`, `seeking`, and `seeked`. It
binary-searches both `koLines` and `enLines` for the line containing
`video.currentTime`, and updates the divs only when the index changes
(avoids thrashing text nodes).

Native YouTube captions are hidden via an injected `<style>` tag that
sets `.ytp-caption-window-container { display: none !important; }`.
The same stylesheet carries a second rule —
`.lws-ytsubs-ko.is-asr::before { content: '(auto) '; … }` — that the
adapter activates by adding the `is-asr` class to the KO line when
the primary source is YouTube's ASR (i.e. `isAsr(primary.baseTrack)`
is true). The badge tells the learner they're reading machine
transcription rather than creator-provided text. It's intentionally
a pseudo-element rather than a real DOM child: `textContent` of
`.lws-ytsubs-ko` is what `extractSentence` uses for sentence context
and what the Ask AI pill bakes into its prompt, and pseudo-element
content doesn't show up in `textContent`. Removing the injected
stylesheet on teardown restores the natives and also drops the badge.

### 10.10 The toolbar popup's per-video override

The toolbar popup gets the current tracklist by sending
`{type: 'lws-yt-popup-info'}` to the active tab. The adapter's own
`chrome.runtime.onMessage` listener (separate from `content.js`'s)
responds with `{ active, videoId, tracks, secondaryLang }`.

`popup.js` renders a radio group of non-Korean languages + "Off". The
user's selection writes to `chrome.storage.local.dualSubsOverrides`
keyed by videoId. The adapter's `onChanged` listener for
`local.dualSubsOverrides` sees the change for the current videoId and
re-runs activation with the new secondary.

The adapter never reads messages from the popup other than this one
type — settings flow exclusively via storage events.

---

## 11. Caching strategy

The `cache.js` module is used twice in the SW — once for KRDict
responses (`createCache(adapter)` — default `lookup:` namespace) and
once for Hanja gloss responses (`createCache(adapter, { namespace: 'hanja' })`).

### 11.1 Two tiers

**L1 — in-memory LRU `Map`.** Default limit 500 entries. Access bumps
recency (delete + re-insert). On full, the oldest insertion is evicted.

Service workers in MV3 are killed after ~30 s of inactivity, so the L1
is short-lived in practice — but on a busy reading session it absorbs
most of the lookups (the same word the user hovers twice in a paragraph
won't even need a storage read).

**L2 — injected storage adapter.** In production, `chromeStorageAdapter(chrome.storage.local)`. Reads are awaited Promise-style; writes are
fire-and-forget but awaited in tests. All keys are namespace-prefixed
(`lookup:먹다`, `hanja:豫約`) so multiple cache instances can share
one storage area.

### 11.2 Why namespaced

The KRDict cache and the Hanja cache live in the same
`chrome.storage.local` area but should be independent — clearing the
word-lookup cache when a definition seems stale shouldn't blow away the
Hanja gloss cache (which is tiny — hundreds of entries — and rarely
needs clearing). `cache.clear()` only deletes keys with its own prefix.

### 11.3 Cache keys


| Cache      | Key                | Value                                                       |
| ---------- | ------------------ | ----------------------------------------------------------- |
| `lookup:`* | `surface` (raw)    | Full `LookupResponse` with the raw XMLs etc.                |
| `hanja:*`  | concatenated Hanja | `{ chars, hanjas: [{character, sino, summary}], cachedAt }` |


The KRDict response payload is keyed by **surface** (not lemma) —
because the popup re-renders from `lastPayload` and needs to know what
surface the user actually hovered, including its sentence context.

The Hanja cache is keyed by the **concatenated Hanja characters** of one
origin field — so `豫約` and `學校` are separate cache entries; the
hangulhanja.com API returns per-character glosses in one response per
multi-character query.

### 11.4 Cache invalidation

There is no automatic cache invalidation. The cache grows monotonically
until the user clicks "Clear cache" in the options page or until
chrome.storage.local hits its quota (mitigated by the
`unlimitedStorage` permission).

`chrome.storage.local` keys aren't garbage-collected by the L1 LRU —
the L1 capacity bound applies only to the in-memory tier.

---

## 12. Mecab integration

The extension's morphological analysis uses a forked build of
mecab-ko-wasm with a `Mecab.withDictBytes(trie, matrix, entries)`
constructor that accepts in-memory bytes (upstream expects a
filesystem). Built from [https://github.com/abishake/mecab-ko](https://github.com/abishake/mecab-ko).

See [MECAB_INTEGRATION.md](MECAB_INTEGRATION.md) for the full story —
the four-phase integration plan, the Rust-side changes, the wasm-pack
build commands, the dict-builder invocation, and the manual smoke tests.

Short summary of the runtime side:

- `background.js` lazy-inits on first lookup. `ensureMecab()` runs
`init()` then `Promise.all` fetches and gunzips the three dict files.
- Time: ~1–2 s on a cold service worker; subsequent lookups within the
same SW lifetime tokenize in ~5 ms.
- `Mecab.tokenize(surface)` returns class instances with getters; we
normalize to plain objects in `tokenizeSurface` so the result is
structured-clone-safe for `sendMessage` and `chrome.storage.local`.
- Failure mode: if init throws, `tokenizeSurface` returns null; the
lemmatizer treats null tokens as "no info" and falls back to
surface-only candidates. The user gets a slightly worse hit rate
but no error UI.

---

## 13. Testing

Unit tests live in `tests/` and run with `npm test`
(`node --test 'tests/**/*.test.js'`). 122 tests, all green.


| File                            | Tests | Covers                                                                                                                                                                 |
| ------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/api.test.js`             | 20    | URL builders for KRDict / OpenDict; `looksEmpty`; `extractApiError`                                                                                                    |
| `tests/cache.test.js`           | 11    | Two-tier cache: set/get round-trip; namespacing; LRU eviction; clear with and without `getKeys`                                                                        |
| `tests/grammar-glosses.test.js` | 11    | `morphemeGloss` three-tier lookup; homograph disambiguation; `isContentMorpheme` filter                                                                                |
| `tests/lemmatizer.test.js`      | 29    | Verb / adjective stems; Inflect decomposition; compound nouns (NNG+NNG, NNG+XSV, XR+XSA, MM+NNB+XSV); particle skipping; dedup                                         |
| `tests/parsers.test.js`         | 51    | KRDict and OpenDict XML parsing; example extraction; POS translation tables (English / Korean / shortform); Hanja URL builders; grade-to-stars; verb-link URL builders |


The five pure modules — `api.js`, `cache.js`, `grammar-glosses.js`,
`lemmatizer.js`, `parsers.js` — have full coverage of their public
APIs. Adding a new candidate-generation rule or a new POS-to-English
mapping should always come with a test.

Files without unit tests, and why:

- `content.js` — touches the DOM, Shadow DOM, chrome.runtime, chrome.storage.onChanged. Would need jsdom + Chrome-API stubs to test meaningfully. Exercised manually in Chrome.
- `background.js` — service worker; needs `chrome.runtime`, `chrome.storage.local`, `DecompressionStream`, and the WASM analyzer. Tested manually by hovering Korean words on real pages.
- `popup.js`, `options.js` — settings UI; trivial DOM event handlers. Tested manually by interacting with the popup / options page in Chrome.
- `youtube-adapter.js`, `youtube-page-hook.js` — depend on the YouTube player's page-world objects, the actual `/api/timedtext` HTTP behavior, and Chrome's main-world script injection. Tested manually by visiting `youtube.com/watch` on real videos.
- `site-configs.js` — data-only module. The exported `findSiteConfig` is exercised indirectly via the YouTube manual tests.

CI lives in `.github/workflows/ci.yml`. Three jobs in one workflow:

1. `npm ci && npm test` — run the suite on Node 20.
2. Parse-check every `extension/*.js` with `node --check`. Catches
  syntax errors without trying to actually run the SW code in Node.
3. Validate `manifest.json` is valid JSON with `python3 -c "import json; json.load(open(...))"`.

---

## 14. Extending the extension

Three categories of extension surface, in roughly increasing scope:


| Surface                 | Where it lives                                                                | Add by                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Per-site behavior       | `site-configs.js` + optional `*-adapter.js` / `*-popup.js` / `*-page-hook.js` | Append a SITE_CONFIGS entry, drop files in `extension/`, add to `web_accessible_resources` |
| "Ask AI" pill providers | `ai-providers.js`                                                             | Append one entry to `AI_PROVIDERS`                                                         |
| Persistent settings     | `options.html` + `options.js` + the consumer                                  | Add a field, wire `load()` / `change` handler, react in `chrome.storage.onChanged`         |


Subsections below walk each in detail. §14.8 collects design principles
that apply to every extension surface.

### Site adapter for a new website

§14.1–14.5 cover the per-site path, in order of how much you're
overriding. Start at the top — if the default behavior is fine for your
site, you don't even need an entry.

### 14.1 If you only need a different sentence selector

Add an entry to `SITE_CONFIGS` in `extension/site-configs.js`:

```js
{
  name: 'Example News',
  hostnames: ['example.com', 'www.example.com'],
  // - or - match: /(^|\.)example\.com$/,
  sentenceContainer: '.article-paragraph, .pullquote',
},
```

That's it. `extractSentence` will `closest('.article-paragraph, .pullquote')`
when the user hovers a word on `example.com`. If `closest` returns
null (e.g. the user hovered something outside that selector), it falls
back to the default walk so non-article text on the same page still
works.

### 14.2 If you also need to pause the page's video

Add a `findVideo` function:

```js
{
  name: 'Example Player',
  hostnames: ['example.com'],
  sentenceContainer: '.subtitle-text',
  findVideo: () => document.querySelector('video.main-player')
    || document.querySelector('.player-container video')
    || document.querySelector('video') || null,
},
```

`content.js` will auto-pause that video on popup open, resuming when the
popup closes (unless the user paused it themselves in the meantime).

#### Per-site visual fixes (z-index, pointer-events, hidden chrome)

Some video players layer a transparent control overlay above the
captions whenever the cursor moves — Netflix is the canonical
example. Pointer events go to the overlay first, so our `.lws-word`
spans never see hover.

The clean fix is to promote `.lws-word` itself so it paints above
the overlay. Two reasons it's the right target rather than the host's
caption container:

1. **Stability** — `.lws-word` is our class; we control it. Hosts
   rename caption containers across redesigns / titles / DRM profiles
   (Netflix has had `.player-timedtext`, `.player-timedtext-text-container`,
   and others), so any host-side selector is fragile.
2. **z-index needs `position`** — z-index only takes effect on
   positioned elements (relative/absolute/fixed/sticky). A rule that
   sets `z-index` without setting `position` is silently ignored. Our
   default `.lws-word` styling in `content.css` doesn't position the
   span, so this stylesheet has to add both.

Solution: a `stylesheet` field on the SITE_CONFIGS entry. `content.js`
injects it as a `<style id="lws-site-style">` tag at init, scoped by
host (the script only runs when the entry matched). Idempotent — the
`id` guard prevents double-add.

```js
{
  name: 'Example Player',
  hostnames: ['example.com'],
  sentenceContainer: '.subtitle-text',
  findVideo: () => document.querySelector('video') || null,
  stylesheet: `
    /* Lift our hoverable word spans above the player's
     * transparent control overlay so mouseenter actually
     * fires on them. position+z-index are both required. */
    .lws-word {
      position: relative;
      z-index: 2147483647;
    }
  `,
},
```

This works as long as no ancestor of `.lws-word` creates its own
stacking context BELOW the control overlay's z-index — in which case
the span is constrained within the ancestor's context and never
escapes. If that happens, the symptom is "z-index higher but still
not on top." Mitigation is to also promote the offending ancestor
(name it in the selector), or write a real adapter (§14.3) that
mounts an overlay of its own outside the host's stacking contexts.

Use sparingly. If you find yourself adding more than a couple of
rules, the site probably needs a real adapter rather than fighting
the host's CSS.

### 14.3 If you need active page manipulation (caption replacement, etc.)

This is what `youtube-adapter.js` is. Create a new file in `extension/`
that exports `setup(api)`:

```js
// extension/myservice-adapter.js

// api is { unwrap, rescan } from content.js. unwrap strips all
// .lws-word spans (call before the host site mutates DOM containers
// that hold them); rescan re-wraps the page. Both are no-ops when
// the extension is disabled on the current host, so always safe to
// call. Default-arg so older callers (none yet, but allows safe
// signature evolution) don't crash.
let hostUnwrap = () => {};
let hostRescan = () => {};

export async function setup(api = {}) {
  if (typeof api.unwrap === 'function') hostUnwrap = api.unwrap;
  if (typeof api.rescan === 'function') hostRescan = api.rescan;

  // ... your setup logic
  // - register storage / runtime listeners
  // - mount DOM
  // - wire SPA navigation (call hostUnwrap on nav-start, hostRescan after)
  // Return value not used; manage your own teardown.
}
```

Register it in `site-configs.js`:

```js
{
  name: 'My Service',
  hostnames: ['myservice.com'],
  sentenceContainer: '.my-sentence',
  adapter: 'myservice-adapter.js',
},
```

Add it to `web_accessible_resources` in `manifest.json` (every file the
content script dynamic-imports needs to be listed there):

```json
"web_accessible_resources": [{
  "resources": [
    "popup-shadow.css",
    "parsers.js",
    "grammar-glosses.js",
    "site-configs.js",
    "ai-providers.js",
    "youtube-adapter.js",
    "youtube-page-hook.js",
    "myservice-adapter.js"
  ],
  "matches": ["<all_urls>"]
}]
```

`content.js`'s `loadAdapter()` dynamic-imports the adapter and calls
`setup({unwrap, rescan})` automatically — no further wiring needed.

The adapter is responsible for its own:

- **Storage listeners**: settings (sync) + per-site overrides (local)
  - the `disabledHosts` key in `chrome.storage.local` (otherwise your
  active manipulation won't tear down when the user toggles your site
  off in the popup). See `youtube-adapter.js`'s `isEnabled()` for the
  pattern.
- **Navigation handling**: SPA navigation events + a `setInterval`
URL-poll fallback (some host-internal nav paths skip the events).
On nav-start call `hostUnwrap()` and your own `deactivate()`; on
nav-finish (after a short timeout for the new DOM to settle) call
your `activate()` and `hostRescan()`.
- **Race-safe activate / deactivate**: `activate()` is almost always
async — captures, fetches, waiting for elements to appear. SPA navs
fire faster than that chain completes, so naive implementations
leave stacked overlays. Use a generation token: bump it in both
`activate()` and `deactivate()`; after every `await` in `activate`,
check `myGen === activeGeneration` and tear down your own work if
not. Pattern is in `youtube-adapter.js`'s `activate()`.
- **DOM teardown**: return a teardown closure from your "init for
current state" function, store it in `teardownFn`, call it from
`deactivate()`, and null `teardownFn` afterward.
- **Popup communication** (if needed): `chrome.runtime.onMessage`
  listener for a site-specific message type (e.g.
  `lws-myservice-info`). The adapter responds with whatever the
  toolbar popup's site module needs.
- **`sentenceContainer` must include your overlay's KO class**: if
  your adapter hides the host's native caption containers (so we
  don't double-render) AND mounts its own overlay, the host's
  `sentenceContainer` selector in `site-configs.js` MUST also list
  your overlay's KO container class. Without it, `closest(selector)`
  on a hovered `.lws-word` inside your overlay returns null,
  `extractSentence` falls back to its default block walk, AND
  `pauseVideoIfApplicable` silently doesn't fire. Both the YouTube
  and Netflix entries list their overlay classes first
  (`.lws-ytsubs-ko, …` and `.lws-nxsubs-ko, …` respectively).

### 14.4 If you need page-world access

If your adapter needs to read or write objects on `window` that the
page's own scripts created (player APIs, custom expandos, ...), it
needs to inject a page-world script — like
`youtube-page-hook.js`. The recipe:

1. Create the hook script. Use an IIFE with an idempotence guard
  (`if (window.__myAdapterHookInstalled) return; window.__myAdapterHookInstalled = true;`).
2. Communicate with the isolated-world adapter via
  `window.postMessage` with a unique tag in the message data (e.g.
   `__myAdapterCmd`, `__myAdapterReply`).
3. Add the file to `web_accessible_resources` in `manifest.json`.
4. From the adapter, inject the hook once:
  ```js
   const script = document.createElement('script');
   script.src = chrome.runtime.getURL('myadapter-page-hook.js');
   script.onload = () => script.remove();
   (document.head || document.documentElement).appendChild(script);
  ```
5. Use a `reqId` mechanism (monotonic counter) so multiple in-flight
  commands don't get their replies cross-wired.

See `youtube-adapter.js` (`sendHookCmd`, `awaitHookReply`,
`captureCaption`) for a working example.

### 14.5 If you want a section in the toolbar popup for your site

The toolbar popup (the panel that opens when you click the extension
icon) has a generic "adapter section" — `<section id="site-adapter-section">`.
`popup.js`'s `loadAdapterSection()` resolves the active tab's hostname
against `SITE_CONFIGS`, and if the matched entry declares a
`popupModule`, dynamic-imports it and calls
`renderSection({ tab, href, container })`.

Create `extension/myservice-popup.js`:

```js
// extension/myservice-popup.js
//
// Loaded by popup.js when the active tab matches the My Service
// SITE_CONFIGS entry. Owns all DOM under the container it's handed;
// must set container.hidden = false when it has something to show.

export async function renderSection({ tab, href, container }) {
  // `href` is the page URL (resolved by popup.js from tab.url or, as a
  // fallback, by messaging the content script). Don't read tab.url
  // directly — it can be undefined in some Chrome states.
  if (!href) return;
  let parsed;
  try { parsed = new URL(href); } catch { return; }
  // Bail if you've nothing to show on this kind of page.
  if (parsed.pathname !== '/relevant-route') return;

  // ... build DOM under `container` ...
  container.hidden = false;

  // Talk to your content-script adapter via:
  //   chrome.tabs.sendMessage(tab.id, { type: 'lws-myservice-info' })
  // The adapter's onMessage handler should sendResponse synchronously
  // (or return true if it needs to reply later).
}
```

Register the popup module in `site-configs.js` (add `popupModule` to
the existing entry):

```js
{
  name: 'My Service',
  hostnames: ['myservice.com'],
  sentenceContainer: '.my-sentence',
  adapter: 'myservice-adapter.js',
  popupModule: 'myservice-popup.js',
},
```

The popup module is **not** loaded into the page world (popup.js is
extension-context), so it doesn't need to be in `web_accessible_resources`.
The dynamic import resolves directly from the extension origin.

### 14.6 Adding an AI provider for the "Ask AI" pill

The pill at the top of the in-page popup opens an AI chat with a
rendered prompt. Providers are listed in `extension/ai-providers.js`:

```js
export const AI_PROVIDERS = {
  chatgpt: { name: 'ChatGPT', urlPrefix: 'https://chatgpt.com/?q=' },
  claude:  { name: 'Claude',  urlPrefix: 'https://claude.ai/new?q=' },
  // Add yours here:
  perplexity: { name: 'Perplexity', urlPrefix: 'https://www.perplexity.ai/?q=' },
};
```

That's the whole change. The options-page dropdown populates itself
from this registry (no HTML edit) and `content.js` reads it via the
same `chrome.runtime.getURL` import path as `site-configs.js`.

Requirements for a new provider:

- The service must accept a single URL query parameter that pre-fills
the chat prompt (most do — `?q=`, `?prompt=`, `?text=`, etc.).
- Use `urlPrefix` ending with `=` so the URL-encoded prompt appends
directly. If the parameter name differs, just bake it into the prefix
(`'https://example.com/chat?prompt='`).
- Don't list providers that require auth headers / POST bodies — the
pill is just an `<a target="_blank">`, no extension-initiated fetch.

If you remove a provider whose key some users have already saved as
their `askAiProvider`, `content.js` falls back to `DEFAULT_ASK_AI_PROVIDER`
(`chatgpt`). No migration needed.

### 14.7 Adding a new persistent setting

Decide first: `sync` (~roams across browsers, has quota and is
rate-limited) or `local` (per-device, unlimitedStorage, immediate)?

- Single small value (boolean, language code, API key): `sync`.
- Array / map written from the popup or frequently: `local` (the
`disabledHosts` key learned this the hard way — see the
"Why `chrome.storage.local` (not `sync`) for `disabledHosts`"
subsection in §4).

Then:

1. **Pick a stable key name**. Camel-case, no prefix needed
  (the storage area is the namespace). Add it to the relevant `KEYS`
   constants in whichever files use it.
2. **Add UI** in `options.html` (or `popup.html` for per-session
  things). Wire the load + change handler in `options.js`. The
   pattern: read in `load()`, write in a `change` listener. Use
   `chrome.storage.sync.remove(KEY)` when the value equals the
   in-code default so the live default re-applies if you ever change
   it.
3. **Read it in the consumer** (`content.js`, `youtube-adapter.js`,
  etc.). At init: `await chrome.storage.<area>.get(KEY)`, with a
   default-arg fallback. Update via `chrome.storage.onChanged`:
4. **Document it** in §4's storage tables in this file. If the consumer
  reacts to changes, also add a row in the onChanged-bus table.

If the setting needs sensible defaults across both the options page
and the consumer, share the constant via a small module in
`extension/` (see `ai-providers.js` for the pattern) rather than
duplicating it in two files.

### 14.8 Design principles for any extension surface

- **Fail open, log a named reason**. When a guard rejects, log
`[lws] <context>: <why>` and proceed safely. Silent
`try {…} catch { return; }` blocks have repeatedly hidden real
bugs in this codebase — an undefined `isKoreanCode()` killed dual
subs for weeks because the only signal was a quiet `null` return.
Reserve fail-closed for security boundaries (e.g. invalid API key →
refuse the request); for behavior gates, prefer fail-open with a
downstream check (e.g. dual subs engages if audio language is
unknown, gated by "is there even a Korean track to show?").
- **Async guards need generation tokens**. Anything that does
`deactivate(); await initThing(); mount(...)` needs to handle the
user / host re-triggering before `initThing()` resolves. Bump a
counter in every entry-and-exit, compare after each `await`, tear
down your own work on supersession.
- **No global state hidden in closures**. Adapter and popup module
parameters (`setup({unwrap, rescan})`, `renderSection({tab, href, container})`) are explicit so future maintainers can see the contract
without grepping for who-calls-who.
- **Storage keys are durable**. Once shipped, you can't rename a key
without migration code. Pick names you can live with — the
`disabledHosts` array got moved from `sync` to `local` mid-flight
and we just orphaned the old `sync` value (users had no UI to set
it, so harmless).
- **Tests cover pure modules** (`lemmatizer.js`, `parsers.js`,
`grammar-glosses.js`, `cache.js`). DOM-touching code (`content.js`,
`youtube-adapter.js`, popup files) has no harness — be extra careful
there. The `node --check` syntax pass is the cheapest correctness
check available; run it before committing.

---

## 15. Common gotchas and non-obvious behavior

A grab bag of things that bit us during development and would bite a
new contributor too.

### 15.1 Isolated world vs page main world

Content scripts run in an "isolated world" — same DOM as the page, but
a separate global scope. You can read element attributes, observe
mutations, register event listeners. You CANNOT see:

- Page-script-created expandos on `window` or DOM elements
(e.g. `html5VideoPlayer.getOption` is a YouTube player expando).
- Page-script monkey-patches of built-ins (the page's own `fetch`
override isn't visible from the isolated world).
- Page-script-defined custom elements' shadow DOMs (mode: closed).

To bridge: inject a `<script src=chrome-extension://.../...>` tag and
communicate via `window.postMessage`. That's what `youtube-page-hook.js`
exists for.

### 15.2 `chrome.storage.session` is forbidden in content scripts

`chrome.storage.session` is gated to "trusted contexts" by default in
MV3. From a content script (which runs in the host page's origin),
calls to `session.get/set` throw silently. We use `chrome.storage.local`
for per-video YouTube overrides for this reason — it's unrestricted and
has the side benefit of persisting across browser restarts.

### 15.3 Mecab dict is heavy; lazy is mandatory

The dict is ~22 MB compressed, ~90 MB raw. Loading it eagerly in
`background.js` top-level would make the SW unkillable for ~2 s on
every wake-up. We init lazily on first `lookup` request. The user
sees ~1–2 s latency on the first hover after the SW is killed; every
subsequent hover within the SW's lifetime is instant.

If you're tempted to load it eagerly (e.g. to remove the first-hover
delay), don't — the MV3 SW lifecycle is hostile to long startup. The
SW will be killed by the browser for "taking too long to start" on
slow machines.

### 15.4 The popup uses Shadow DOM with adopted styles

The popup is mounted into a Shadow Root attached to a host div at
`document.documentElement`. Its styles come from a `<link rel=stylesheet>`
loaded from `chrome.runtime.getURL('popup-shadow.css')` — which works
because `popup-shadow.css` is in `web_accessible_resources`.

Why Shadow DOM: page CSS leaks into anything in the light DOM. Sites
that have aggressive `* { ... }` rules or that target generic class
names would otherwise mangle our popup's typography, spacing, colors.
The shadow root gives us a clean styling context.

Side effect: keyboard events bubble up through the shadow root as
normal, so global page hotkeys still work even when the popup is
focused. But CSS does NOT inherit through the shadow boundary — anything
the popup needs has to be declared in `popup-shadow.css`.

### 15.5 Two pure-noun-compound rules, both load-bearing

There are two rules in `lemmatizer.js` that interact with pure noun
compounds:

1. **Surface-first push** — if every token is in COMPOUND_NOUN_TAGS,
  push the surface FIRST. (Rule #1 in §8.2.)
2. **inflectStem gating** — `inflectStem` returns null unless
  `type === 'Inflect'`. (Discussion in §8.3.)

You might be tempted to think the surface-first push alone is enough —
just push the whole compound and we're done. But without the Inflect
gate, the per-token loop will then call `inflectStem` on each NNG
token's features and (for any noun with a Compound decomposition like
오랜만) pull a sub-stem out and push it as a higher-priority candidate
than the noun itself. The Inflect gate is what keeps Compound-type
nouns' lemmas (not their pieces) coming through the per-token loop.

Both rules together are necessary. The lemmatizer test suite has a
case explicitly named for this (`'compound XSV verb in Inflect form: 예약해야 → 예약하다 first'`).

### 15.6 The video-pause flag dance

When the popup opens on a video page (YouTube, etc.), we auto-pause the
video. When the popup closes, we auto-resume IF we're the ones who
paused it. But the play/pause state changes also fire `pause` events,
including our own programmatic `video.pause()` call. So:

- `suppressNextPauseEvent` swallows exactly one event (the one our own
`.pause()` emits).
- Any subsequent `pause` event is the user clicking pause again — they
want it stopped, so we set `resumeVideoOnHide = false` to skip the
auto-resume.

This dance is robust but fragile to changes. If a future browser does
something weird with event ordering during programmatic pause (multiple
events, async events), be ready to debug.

### 15.7 popup-shadow.css `position: absolute`, not `fixed`

The popup is `position: absolute` against the host div anchored at
`(0, 0)` on `document.documentElement`. When the user scrolls the page,
the popup scrolls with it — by design. If a tab click grows the popup
past the viewport edge, the user can scroll the page to read the rest,
instead of being stuck with content clipped off-screen that they can't
reach.

The flip side is that `positionPopup` has to compute viewport coords
(for the initial fit clamps — flip above, clip to viewport edge) and
THEN convert to document coords (`+ window.scrollX/Y`) before writing.
Get that wrong and the popup either lands in the wrong place or
mysteriously moves on scroll.

### 15.8 Multi-frame: only top-level frames are scanned

`manifest.json` has `all_frames: false`, so `content.js` only runs in
the top-level frame of each tab. Iframes (ads, embedded media,
cross-origin widgets) don't get the dictionary. This is deliberate —
many embeds use Korean text in their controls / branding and showing the
popup over an ad is jarring. To opt an iframe in we'd need to opt
specific origins in and re-test the popup's z-index against the page's
ancestor stacking contexts.

### 15.9 The XR / NNB / MM-alone-isn't-a-candidate rule

The per-token loop in `lemmaCandidates` only pushes tokens whose lead
tag is in VERB_LEAD_TAGS or NOUN_LEAD_TAGS. XR, NNB, MM are NOT in
either set, even though they participate in the compound-prefix
accumulator (which IS in COMPOUND_PREFIX_TAGS). This is intentional:

- `깨끗` (XR) alone isn't a dictionary word — `깨끗하다` is.
- `잔` (NNB) alone isn't typically what a learner wants to look up
when they hovered `한잔하다`.
- `한` (MM) alone is too low-frequency standalone to be a useful
fallback.

If you ever need to look up XR/NNB/MM standalone (e.g. for a debugging
feature), add a separate code path — don't widen the per-token rule.

### 15.10 The popup's minimum-size monotonic growth

`popupMinHeight` and `popupMinWidth` start at 0 on every fresh lookup
(reset in `performLookup`). After every show, `requestAnimationFrame`
captures the actual rendered size and bumps the min-size memos UPWARD
only. This means: as the user clicks tabs and expands sections, the
popup grows; it never shrinks. The cursor stays inside the popup
boundary across the entire interaction. If the user moves to a new word
and triggers a fresh lookup, the memos reset and we start over.

### 15.11 Why there's no audio-language detection

There used to be an "audio-language gate" that tried to inspect the
spoken language and skip dual subs when it wasn't Korean. It went
through three iterations and we eventually deleted it entirely. The
postmortem is worth keeping so nobody reinvents it.

**Attempt 1: page-hook reads `window.ytInitialPlayerResponse`** —
the global has rich data including `audioTracks[]` and ASR language.
**Problem**: that global is set ONCE at page load and YouTube does
NOT refresh it on SPA navigation (next video in playlist, autoplay,
in-page click on a related video). After any in-page nav, the
detection returned the FIRST video's audio language for every
subsequent video. Symptom: "audio is en, skipping" on Korean videos
auto-played from a Korean drama list, when the page had originally
loaded on an English video.

**Attempt 2: page-hook reads `player.getPlayerResponse()`** — the
IFrame Player API has this method, so we tried calling it on the
inline player element. **Problem**: it doesn't reliably exist on the
inline player (the `<div class="html5-video-player">` element). The
hook's `getCurrentPlayerResponse()` helper fell through to
`ytInitialPlayerResponse` and you were back to attempt 1's staleness.

**Attempt 3: adapter reads tracklist's ASR track language** — the
tracklist from `player.getOption('captions','tracklist')` is always
fresh for the current video, and ASR tracks carry the audio language.
**Problem**: redundant. YouTube only generates ONE ASR per video (in
the audio language), so "tracklist's ASR is non-Korean" implies
"tracklist has no KO ASR" — and `pickPrimarySource` already skips
when no KO track exists (manual or ASR). The gate's "skip when audio
non-Korean and no manual KO" condition is logically equivalent to
"skip when no KO track at all," which is what `pickPrimarySource`
returning null already does. Dead policy.

**Current behaviour**: no gate. `pickPrimarySource(tracklist)`
returns null iff the tracklist has no Korean entry; in that case we
skip. Auto-translated KO via `tlang=…` is NOT in the tracklist (it's
derived on demand), so an English-only video with no creator-provided
KO simply has no KO entry and skips correctly. Anything else engages.

The masked-bug story is also worth keeping: the multi-iteration audio
gate hid for a long time behind the dual-overlay race (fixed in
`fcee30e`), where the orphaned previous-video overlay stayed visible
alongside the new video and nobody noticed detection was returning
stale data. Once the race was fixed, every misread surfaced. The two
bugs together — a race plus a stale global — looked like one bug
("dual subs sometimes don't work on the new video") until we
disentangled them.

Multi-audio detection (audioTracks[] in PlayerResponse, e.g. K-dramas
with a Korean-original and English-dub track) was never reachable
from the tracklist alone. Since attempt 3's failure made it clear the
PlayerResponse approach can't be reached per-video on SPA-navigated
videos, we accept this. If the user is on a multi-audio video and
currently listening to the English audio, dual subs will engage
because a KO track is in the tracklist. Per-site disable is the
workaround.

---

## 16. Where to make changes for common requests


| User request                                | What to change                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Add a new POS-to-English mapping            | `parsers.js` `KOREAN_POS_TO_ENGLISH` + test                                                 |
| Add a morpheme gloss for a new particle     | `grammar-glosses.js` `FORM_GLOSSES` + test                                                  |
| Fix a wrong lemma for a specific surface    | `lemmatizer.js` candidate ordering + test                                                   |
| Debug a "wrong lemma" hover result          | Open Notepad from the popup's links row, paste the word, hover it. The popup's morpheme breakdown shows the mecab tokens that drove the lemma; for the lemma chain itself (candidates / queriesUsed), inspect the page DevTools to see the `lookup` response from background. |
| Add a new site-specific sentence selector   | `site-configs.js` entry (see §14.1)                                                         |
| Auto-pause a page's video on popup open     | `findVideo` in the `site-configs.js` entry (see §14.2)                                      |
| Fix hovers being eaten by a player control overlay | `stylesheet` field on the `site-configs.js` entry — z-index promo for the caption layer (see §14.2 "Per-site visual fixes") |
| Replace a site's captions with dual subs    | New `*-adapter.js` + SITE_CONFIGS entry + manifest WAR (see §14.3)                          |
| Add a toolbar-popup section for a site      | New `*-popup.js` + `popupModule` on the SITE_CONFIGS entry (see §14.5)                      |
| Add a new "Ask AI" provider (ChatGPT-style) | One entry in `ai-providers.js` `AI_PROVIDERS` (see §14.6)                                   |
| Add a new persistent setting                | UI in `options.html` / `options.js`; storage onChanged listener in the consumer (see §14.7) |
| Hook a new dictionary API                   | `api.js` URL builder + `parsers.js` XML parser + `background.js` `handleLookup`             |
| Change in-page hover-popup look             | `popup-shadow.css`, NOT `popup.css`                                                         |
| Change toolbar popup look                   | `popup.css`                                                                                 |
| Change settings page look                   | `options.css`                                                                               |
| Tweak word scanning (e.g. add a skip tag)   | `content.js` `SKIP_TAGS`                                                                    |
| Change the default "Ask AI" prompt          | `DEFAULT_ASK_AI_PROMPT` in BOTH `content.js` and `options.js` (kept in sync)                |


When in doubt, search the codebase for the user-facing string you see in
the popup — almost all rendering goes through `buildResultNode`,
`buildKrEntryNode`, `buildSenseNode`, `makeChip`, or
`makeHanjaChip`. From there it's one or two hops back to whichever pure
module produced the data.

---

## Further reading

- [README.md](../README.md) — user-facing description.
- [CONTRIBUTING.md](../CONTRIBUTING.md) — contributor getting-started.
- [docs/MECAB_INTEGRATION.md](MECAB_INTEGRATION.md) — the mecab-ko-wasm fork story.
- [docs/THIRD-PARTY.md](THIRD-PARTY.md) — license attribution for vendored components.
- [docs/original-spec.md](original-spec.md) — the original V1 spec, kept for historical context. The current code has diverged substantially.


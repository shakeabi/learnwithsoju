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

On YouTube, the extension goes a step further: it replaces YouTube's native
caption rendering with a dual-language overlay (Korean on top, the user's
preferred secondary language below). The Korean line is then hoverable
just like any other text on the page, so the user can build out vocabulary
straight from the video they're watching.

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
   ┌──┴───────────────────────────┐    ┌───────────────────┐
   │  popup.html / popup.js       │    │ options.html /    │
   │  (toolbar action; opens on   │    │ options.js        │
   │  toolbar-icon click)         │    │ (chrome://exts →  │
   │  - enable/disable toggle     │    │  Options)         │
   │  - per-video YT subs picker  │    │  - API keys       │
   │                              │    │  - dual subs on/off│
   └──────────────────────────────┘    │  - secondary lang │
                                       │  - clear cache    │
                                       └───────────────────┘

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

| Component                        | World           | Lifetime         | Notes                                                                 |
|----------------------------------|-----------------|------------------|-----------------------------------------------------------------------|
| `content.js`                     | isolated        | per top-frame    | The only piece that touches the page DOM. One instance per tab/frame. |
| `background.js`                  | service worker  | lazy / suspended | MV3 SW that handles dictionary requests and owns the mecab analyzer. |
| `popup.{html,js}`                | extension page  | open/close       | Toolbar-action UI. Talks to the active tab via `chrome.tabs.sendMessage`. |
| `options.{html,js}`              | extension page  | open/close       | Settings. Writes to `chrome.storage.sync`.                            |
| `youtube-adapter.js`             | isolated        | per /watch       | Site adapter for YouTube. Replaces native captions with dual-line overlay. |
| `youtube-page-hook.js`           | page main world | injected once    | Page-world hook that observes YouTube's caption fetches and drives `player.setOption`. |
| Shadow-DOM popup                 | content.js      | per popup        | The actual hover UI; uses an open Shadow Root attached at the document root with adopted CSS. |
| MeCab WASM + mecab-ko-dic        | service worker  | lazy, kept       | ~22 MB compressed; init on first lookup, retained until the SW dies. |

External services touched at runtime:

| Host                       | When                                                                 | Auth                  |
|----------------------------|----------------------------------------------------------------------|-----------------------|
| `krdict.korean.go.kr`      | Every dictionary lookup that misses the cache                        | User's KRDict API key |
| `opendict.korean.go.kr`    | Only when KRDict returns nothing AND the user has provided a key     | User's OpenDict key   |
| `hangulhanja.com`          | When the user clicks a Hanja origin chip in the popup (lazy, cached) | None (open API)       |
| `koreanverb.app`           | Outbound `target=_blank` link only — no extension-initiated fetch    | n/a                   |
| `chatgpt.com`              | Not currently used. (No code path opens chatgpt.com; mentioned in the project README only as a possible future direction.) | n/a |

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
│   ├── site-configs.js                 ← per-site sentence-container selectors + findVideo + adapter path
│   ├── youtube-adapter.js              ← site adapter for YouTube (isolated-world); dual subs lifecycle
│   ├── youtube-page-hook.js            ← page-main-world script; XHR/fetch hooks + tracklist/load-track command channel
│   ├── cache.js                        ← two-tier (in-mem LRU + storage adapter) cache factory; namespaced (pure)
│   ├── popup.html                      ← toolbar-action popup markup
│   ├── popup.js                        ← toolbar popup logic (enable toggle, per-video YT subs picker)
│   ├── popup.css                       ← styling for the toolbar popup (NOT the in-page hover popup)
│   ├── options.html                    ← settings-page markup (API keys, behaviour, cache)
│   ├── options.js                      ← settings-page logic (load/save, test key, clear cache)
│   ├── options.css                     ← styling for the settings page
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

| Key                | Type      | Default  | Written by                       | Read by                                  |
|--------------------|-----------|----------|----------------------------------|------------------------------------------|
| `krdictApiKey`     | string    | `""`     | `options.js`                     | `background.js` (every lookup)           |
| `opendictApiKey`   | string    | `""`     | `options.js`                     | `background.js` (only when KRDict empty) |
| `enabled`          | boolean   | `true`   | `options.js`, `popup.js`         | `content.js` init + onChanged listener   |
| `defLang`          | `'en' \| 'ko'` | `'en'` | `content.js` (popup toggle) | `content.js` (popup render)              |
| `dualSubsYouTube`  | boolean   | `true`*  | `options.js`                     | `youtube-adapter.js` (onChanged + isEnabled) |
| `secondaryLang`    | string    | `'en'`   | `options.js`                     | `youtube-adapter.js`, `popup.js` (default) |

*`dualSubsYouTube` defaults to `true` in the adapter's `isEnabled()` —
the setting is treated as "off only if explicitly set to `false`". On
fresh install, `background.js` writes `enabled: true` and opens the
options page; nothing else is initialized.

### `chrome.storage.local`

| Key (or namespace)        | Type              | Written by                                    | Read by                       |
|---------------------------|-------------------|-----------------------------------------------|-------------------------------|
| `lookup:<surface>`        | `LookupResponse`  | `background.js` (`cache.set`)                 | `background.js` (`cache.get`) |
| `hanja:<chars>`           | Hanja gloss array | `background.js` (`hanjaCache.set`)            | `background.js`               |
| `dualSubsOverrides`       | `{ [videoId]: lang }` | `popup.js` (per-video radio selection)    | `youtube-adapter.js` (onChanged + resolveSecondaryLang) |

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

---

## 5. Message-passing topology

Every cross-context communication path in the extension. The two
big-ticket items are (a) content↔background dictionary requests, and (b)
the YouTube command channel between the isolated content world and the
page main world.

### `chrome.runtime.sendMessage` — content → background

All from `content.js` (or from inside the popup's button-handlers).
`background.js`'s `onMessage` listener dispatches by `msg.type`:

| `msg.type`     | Payload                       | Response                                              | Notes |
|----------------|-------------------------------|-------------------------------------------------------|-------|
| `lookup`       | `{ surface: string }`         | `LookupResponse` (see §7 main flows)                  | Async (`return true`). Surface keyed; cache-bypassing not exposed. |
| `lookupHanja`  | `{ chars: string }`           | `{ chars, hanjas: [{character, sino, summary}], cachedAt }` or `{ chars, error, ... }` | Async. Failures (5xx/429) are NOT cached so the next click retries. |
| `openOptions`  | `{}`                          | `{ ok: true }`                                        | Sync; `chrome.runtime.openOptionsPage()`. |
| `ping`         | `{}`                          | `{ ok: true }`                                        | Sync; used to wake the SW. |
| `clearCache`   | `{}`                          | `{ ok: true }` or `{ ok: false, error }`              | Async. Clears BOTH `lookup:` and `hanja:` namespaces. |

### `chrome.tabs.sendMessage` — popup → content (then content → adapter)

The toolbar popup, when open on a YouTube `/watch` URL, queries the
active tab for the current tracklist:

| `msg.type`            | From       | To                  | Response (sent by `youtube-adapter.js`)                                    |
|-----------------------|------------|---------------------|----------------------------------------------------------------------------|
| `lws-yt-popup-info`   | `popup.js` | content script tab  | `{ active, videoId, tracks: [{languageCode, languageName, kind, vssId}], secondaryLang }` |

The adapter's `onMessage` listener intercepts this before any of
`content.js`'s normal lookup paths see it.

### `window.postMessage` — isolated content world ↔ page main world

The YouTube hook is in the page main world (`<script src=…>` injection)
because content scripts can't see page expandos like
`html5VideoPlayer.getOption`. All communication is via `window.postMessage`:

| Direction                | Shape                                                            | Sent by               | Handled by               |
|--------------------------|------------------------------------------------------------------|-----------------------|--------------------------|
| isolated → main          | `{ __lwsYtCmd: 'tracklist', reqId }`                             | `youtube-adapter.js`  | `youtube-page-hook.js`   |
| isolated → main          | `{ __lwsYtCmd: 'load-track', reqId, lang: 'ko' \| 'en' \| ... }` | `youtube-adapter.js`  | `youtube-page-hook.js`   |
| main → isolated          | `{ __lwsYtReply: 'tracklist', reqId, tracks }`                   | hook                  | `awaitHookReply` in adapter |
| main → isolated          | `{ __lwsYtReply: 'load-track', reqId, ok, error? }`              | hook                  | adapter (fire-and-forget) |
| main → isolated (broadcast) | `{ __lwsYtCaption: true, url, status, body }`                 | hook (XHR/fetch tap)  | `captureCaption` in adapter |

`reqId` (e.g. `lws-1714430000000-3`) lets the adapter run multiple
commands in flight without their replies getting cross-wired.

### `chrome.storage.onChanged` as a side-channel

In addition to direct messaging, the storage onChanged event acts as a
broadcast bus for settings:

| Key                  | Listener                                | What the listener does                                  |
|----------------------|-----------------------------------------|---------------------------------------------------------|
| `enabled`            | `content.js`                            | Toggle scanning + popup activity for this tab           |
| `defLang`            | `content.js`                            | `rerenderActivePopup()` if popup is showing             |
| `dualSubsYouTube`    | `youtube-adapter.js`                    | Re-activate / deactivate dual subs on the current page  |
| `secondaryLang`      | `youtube-adapter.js`                    | Re-activate so the new default applies                  |
| `dualSubsOverrides`  | `youtube-adapter.js` (local area)       | Re-activate if the override changed for the current video |

This keeps the options page from having to know which tabs to message —
it just writes to storage and any interested content scripts react.

---

## 6. Main flows

Each flow lists the user gesture, the participating files, and the steps
in order.

### 6.1 Page load: scan and wrap

Files: `content.js`.

1. `init()` runs at `document_idle` (manifest setting).
2. Read `enabled` and `defLang` from `chrome.storage.sync`. If
   `enabled === false`, bail.
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
`grammar-glosses.js`, `cache.js`, `vendor/mecab-ko/*`.

1. Mouse enters a `.lws-word` span. `delegateEnter` →
   `onWordEnter(target)`.
2. After a 60 ms hover delay (lets the user pass over a word without
   triggering), `performLookup(target)` runs.
3. `performLookup` increments `pendingRequestId` (so a slow response
   can be discarded if the user has already moved on), resets per-popup
   state (`expandedExamples`, `expandedHanja`, `relatedExpanded`,
   `activeInsightTab`, popup min-size memos), then renders a loading
   placeholder via `showPopup(anchor, buildLoadingNode(surface))`.
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
   imports the adapter and calls `setup()`.
3. `youtube-adapter.js`'s `setup()`:
    1. Registers `chrome.storage.onChanged` listener (sync:
       dualSubsYouTube + secondaryLang; local: dualSubsOverrides).
    2. Registers `chrome.runtime.onMessage` for `lws-yt-popup-info`.
    3. Listens for `yt-navigate-start` / `yt-navigate-finish` and polls
       `window.location.href` every 1 s as a fallback.
    4. `injectHookOnce()` — appends a `<script src=chrome-extension://.../youtube-page-hook.js>` tag to `document.head`. The hook's IIFE
       checks `window.__lwsYtHookInstalled` to be idempotent.
    5. `activate()` — guard against already-active and against not being
       on `/watch`; check the `dualSubsYouTube` setting; call
       `initForCurrentVideo()`.
4. `initForCurrentVideo`:
    1. `waitForVideoElement` polls `document.querySelector('video.html5-main-video')` up to 10 s.
    2. `waitForTracklist` repeatedly posts `{__lwsYtCmd:'tracklist'}` to
       the page world (which forwards `player.getOption('captions','tracklist')` back as a `__lwsYtReply`). Polls every 250 ms for up to 10 s.
    3. `resolveSecondaryLang(videoId)` — per-video override (from
       `local.dualSubsOverrides`) wins over `sync.secondaryLang`, which
       defaults to `'en'`.
    4. `pickPrimarySource(tracklist)` and `pickSecondarySource` —
       see §10 for the fallback chains.
    5. For each unique base track involved, `captureBaseTrack(lang)`:
       posts `{__lwsYtCmd:'load-track', lang}`, then waits for a
       `__lwsYtCaption` postMessage whose URL has `lang=…` and no
       `tlang=` (signaling it's the original, not an auto-translation).
    6. `materializeLines` — for each source, either parse the captured
       body directly (`parseJson3` or `parseSrv1Xml`), or refetch the
       captured URL with `&tlang=<target>` appended. The signed
       `sparams` don't include `lang`/`tlang`, so YouTube's signature
       still validates the second URL.
    7. Mount the overlay on `.html5-video-player` (the player root —
       NOT `.html5-video-container`, which has wrong positioning).
    8. Inject a `<style>#lws-hide-yt-captions { .ytp-caption-window-container { display: none !important; }}</style>` to hide the native captions.
    9. Attach `timeupdate` / `seeking` / `seeked` listeners on the
       video element. Each tick does a binary search over the lines
       array (`findLineIdx`) and updates the KO and EN `<div>`s.
5. Teardown: returned closure removes listeners, detaches the overlay,
   detaches the style tag. Called by `deactivate` on navigation away,
   on settings change, or on per-video override change.

### 6.9 Toolbar popup → YouTube per-video override

Files: `popup.js`, `popup.html`, `youtube-adapter.js`.

1. User clicks the extension's toolbar icon → `popup.html` opens.
2. `popup.js` `loadYouTubeSection()`:
    1. `chrome.tabs.query({active: true, currentWindow: true})` → tab.
    2. If the tab's URL isn't `youtube.com/watch?...`, bail — the YT
       section stays hidden.
    3. `chrome.tabs.sendMessage(tab.id, { type: 'lws-yt-popup-info' })`.
    4. Adapter responds with `{ active, videoId, tracks, secondaryLang }`.
3. `renderTrackList` builds a radio group of every non-Korean language
   in the tracklist, plus the user's currently-selected secondary if it
   isn't in the tracklist (as "auto-translate"), plus an explicit
   "Off (Korean only)" row.
4. User picks a radio. `setOverride(videoId, lang)` reads
   `chrome.storage.local.dualSubsOverrides`, merges in
   `{[videoId]: lang}`, writes it back.
5. The adapter's `onChanged` listener for `local.dualSubsOverrides`
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

- `permissions: ["storage", "unlimitedStorage"]` — no host permissions
  on `<all_urls>` because the dictionary fetches happen from the
  background service worker, which is bound by `host_permissions`.
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

| Binding                  | Purpose                                                  |
|--------------------------|----------------------------------------------------------|
| `enabled`, `defLang`     | Read from sync storage; updated by onChanged             |
| `popupHost`, `popupRoot`, `popupEl` | Shadow-DOM popup parts; created lazily         |
| `activeWordEl`           | The `.lws-word` currently being hovered                  |
| `lastPayload`            | Last `LookupResponse` for re-rendering after toggles     |
| `lastSentence`           | The `{before, word, after}` used for the current popup   |
| `activeInsightTab`       | `'breakdown' \| null` — which insights panel is open     |
| `activeTabIdx`           | Active KRDict-entry tab (homograph switching)            |
| `relatedExpanded`        | Whether the "+N related" pill has been clicked           |
| `popupMinHeight`, `popupMinWidth` | Monotonic non-decreasing — popup never shrinks during a session |
| `expandedExamples`       | Set of `senseId` keys whose examples are open            |
| `expandedHanja`          | Set of Hanja-character strings whose meanings panels are open |
| `hideTimer`, `hoverTimer`| Timeout handles for the 120 ms hide / 60 ms hover delay  |
| `pendingRequestId`       | Monotonic counter; lookup responses past this are discarded |
| `pausedVideo`, `resumeVideoOnHide`, `suppressNextPauseEvent`, `videoPauseListener` | Video auto-pause state (see below) |
| `hanjaSession`           | Per-session Map of Hanja chars → result (avoids re-flash on rerender) |

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
- Calls `pauseVideoIfApplicable()` (idempotent within a session).

`hidePopup` is wired to a 120 ms `mouseleave` delay (`scheduleHide`),
cancellable when the cursor re-enters either the word or the popup.

#### Video auto-pause / resume

When `siteConfig.findVideo()` returns a video element:

- `pauseVideoIfApplicable` pauses it on first `showPopup` of a session,
  sets `pausedVideo` and `resumeVideoOnHide`, and attaches a `pause`
  event listener.
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
   `wordEl.closest(selector)` — for YouTube this is `.lws-ytsubs-ko,
   .captions-text, .caption-window, .ytp-caption-window-container`.
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

`chrome.storage.onChanged` listens for `enabled` (rescan on re-enable,
hide popup on disable) and `defLang` (rerenderActivePopup).

The content script does NOT register a `chrome.runtime.onMessage`
listener (`youtube-adapter.js` does, separately) — `lookup` requests
flow content → background, not the other way.

### 7.3 `background.js`

Purpose: service worker. Owns the mecab WASM analyzer, the two caches,
and the network-side dictionary requests.

Module-level state:

| Binding              | Purpose                                            |
|----------------------|----------------------------------------------------|
| `cache`              | `createCache(adapter)` — `lookup:` namespace       |
| `hanjaCache`         | `createCache(adapter, { namespace: 'hanja' })`     |
| `mecabInstance`      | `Mecab` instance once initialized, otherwise null  |
| `mecabReadyPromise`  | In-flight init promise (so concurrent first-hovers don't double-init) |

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

`chrome.runtime.onInstalled` on `reason === 'install'` writes
`enabled: true` and opens the options page so the user lands on the
"paste your API key" form.

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

| Constant                | Tags                                              | Used to                                                          |
|-------------------------|---------------------------------------------------|------------------------------------------------------------------|
| `VERB_LEAD_TAGS`        | VV VA VX VCN VCP XSV XSA                          | Build `<stem>다` per-token                                       |
| `NOUN_LEAD_TAGS`        | NNG NNP NR NP SL SH SN                            | Use morpheme as-is per-token                                     |
| `COMPOUND_PREFIX_TAGS`  | NNG NNP NNB NR NP MM XR XSN                       | Accumulate as prefix before an XSV/XSA — wider than NOUN_LEAD_TAGS so 한잔하다 works |
| `COMPOUND_DERIV_TAGS`   | XSV XSA                                            | Consume the accumulator and emit `<prefix><stem>다`              |
| `COMPOUND_NOUN_TAGS`    | NNG NNP NR NP XSN                                 | Surface-first promotion when every token is one of these         |

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

Purpose: per-site overrides to the content script's behavior. Two
classes of override:

- `sentenceContainer` — CSS selector used by `content.js`'s
  `extractSentence` instead of the default block-element walk. Tightest
  match wins (we use `closest()`). For YouTube, this points at our own
  overlay's KO line first, then YouTube's native caption containers as
  fallbacks.
- `findVideo()` — returns the page's main video element (or null). Used
  by `content.js` to auto-pause when the popup opens.
- `adapter` — relative path to a JS module that gets dynamic-imported and whose `setup()` is invoked. The adapter is then on its own — it manages its own lifecycle, including teardown on SPA navigation.

Exports:

- `SITE_CONFIGS` — currently a single YouTube entry.
- `findSiteConfig(hostname)` — exact host match or regex (`cfg.match`).
  Returns `null` for unknown hosts (which is the most common case;
  default `content.js` behavior applies).

### 7.10 `youtube-adapter.js`

Purpose: site adapter for YouTube. Runs in the isolated content world.
Replaces the native caption rendering with a dual-line overlay (Korean +
secondary language).

Module-level state:

| Binding              | Purpose                                              |
|----------------------|------------------------------------------------------|
| `teardownFn`         | When non-null, dual subs are active for this video   |
| `hookInjected`       | Once true, don't re-add the `<script src>` tag       |
| `lastTracklist`      | Most recent tracklist, exposed to popup via onMessage|
| `lastVideoId`        | YT video ID currently active                         |
| `lastSecondaryLang`  | Currently-rendered secondary language                |
| `cmdSeq`             | Monotonic counter for `reqId` in postMessage cmds    |

Public:

- `setup()` — wires up storage listeners, message listener, navigation
  listeners, injects the hook, calls `activate()`.

Implementation notes:

- `currentVideoId()` reads `?v=` from the URL — robust to the
  back-button SPA-style navigation YouTube does.
- `resolveSecondaryLang(videoId)` does a parallel sync+local read,
  catches per-promise failures so one bad read doesn't sink the other.
  Per-video override wins; default is `sync.secondaryLang || 'en'`.
- The `setInterval(..., 1000)` href-poll is a fallback for cases where
  the `yt-navigate-finish` event doesn't fire (some YouTube internal
  navigation paths skip it).
- Caption-source picking is the most subtle bit — see §10.
- Overlay container is `.html5-video-player` (the player root), not
  the inner `.html5-video-container`. The inner container is
  `position: static`, so a `bottom: 80px` on a `position: absolute`
  child resolves against the wrong ancestor and the overlay floats above
  the visible video area. Cost a bit of debugging to figure out.
- `findLineIdx(lines, t)` is a binary search — for a long video with
  thousands of subtitle lines this matters; a linear scan on every
  `timeupdate` (which fires ~250 ms) would burn CPU.

### 7.11 `youtube-page-hook.js`

Purpose: runs in the page main world. Monkey-patches `XMLHttpRequest.prototype.open` and `window.fetch` to capture every `/api/timedtext` request the YouTube player makes, and posts the URL + response body back to the content script via `window.postMessage`. Also exposes a command channel for the adapter to query the player's tracklist and trigger track loads (since `player.getOption` / `player.setOption` are page-world expandos invisible to isolated scripts).

Three-message protocol:

1. `__lwsYtCaption` — broadcast on every captured request. The adapter's
   `captureCaption` filters by URL predicate.
2. `__lwsYtCmd: 'tracklist'` — request; replies with
   `__lwsYtReply: 'tracklist'`.
3. `__lwsYtCmd: 'load-track'` — request; the hook calls
   `player.setOption('captions', 'track', {})` then
   `player.setOption('captions', 'track', { languageCode: lang })`. The
   clear-then-set pattern forces a fresh `/api/timedtext` fetch even
   when the player thinks it already has the target track loaded.

The hook is idempotent via `window.__lwsYtHookInstalled`.

### 7.12 `popup.html` / `popup.js` / `popup.css`

The toolbar action UI — what opens when the user clicks the extension's
icon. Three sections:

- Hover-dictionary toggle (writes `enabled` to sync).
- Status row (API key status / disabled / active).
- YouTube section — visible only on `youtube.com/watch?...`. Asks the
  active tab for its tracklist via `chrome.tabs.sendMessage`, renders
  a radio group of available secondary languages, writes the per-video
  selection to `chrome.storage.local.dualSubsOverrides`.

The popup never imports `parsers.js` or anything Korean-related — it's
purely a settings/status UI.

### 7.13 `options.html` / `options.js` / `options.css`

The settings page. Linked from the popup ("Open settings →") and from
`chrome://extensions` via the manifest's `options_page` field. Sections:

- API keys: KRDict (required) + OpenDict (optional, experimental).
  Both inputs are `type="password"`. A "Test KRDict key" button hits
  the real API with `q=사람` and surfaces the error code or success.
- Behaviour: hover toggle, dual-subs toggle, default secondary language
  dropdown.
- Cache: a "Clear cache" button that sends `{type: 'clearCache'}` to
  the SW.

Every change is written to `chrome.storage.sync` and propagates to all
content scripts via the `onChanged` event — no direct messaging from the
options page.

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

   ```
   한국말   → [한국/NNP, 말/NNG]                  ⇒ '한국말' pushed first
   반말     → [반/NNG, 말/NNG]                    ⇒ '반말' first
   무조건   → [무/NNG, 조건/NNG]                  ⇒ '무조건' first
   친구들   → [친구/NNG, 들/XSN]                  ⇒ '친구들' first
   ```

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

   ```
   어색하려고  → [어색/NNG, 하/XSV, 려고/EC]          ⇒ '어색하다'
   예약해야    → [예약/NNG, 해야/XSV+EC]              ⇒ '예약하다'
                                                       (해야's Inflect: 하/XSV/*+아야/EC/*)
   한잔해     → [한/MM, 잔/NNB, 해/XSV+EC]           ⇒ '한잔하다'
   깨끗하다    → [깨끗/XR, 하/XSA, 다/EF]              ⇒ '깨끗하다'
   ```

   The prefix tag set is intentionally wider than NOUN_LEAD_TAGS. MM
   (determiners like 한, 두, 새), NNB (bound nouns like 잔, 번, 적), and
   XR (roots like 깨끗, 행복) all need to participate as prefix so
   determiner+bound-noun+verb-deriving-suffix compounds resolve.

3. **Per-token push** — walk left to right; for each token:
   - Compute `stem = inflectStem(features) || lemma || surface`.
   - If lead tag is in VERB_LEAD_TAGS, push `stem` (or `stem + '다'` if
     it doesn't already end in 다).
   - If lead tag is in NOUN_LEAD_TAGS, push `stem` as-is.
   - Otherwise skip — particles, endings, and pure-suffix tokens aren't
     dictionary headwords on their own.

   ```
   먹었어요  → [먹/VV, 었/EP, 어요/EF]
              ⇒ '먹다' (EP/EF skipped)
   학교에서  → [학교/NNG, 에서/JKB]
              ⇒ '학교' (JKB skipped)
   친구들과  → [친구/NNG, 들/XSN, 과/JKB]
              ⇒ '친구' (XSN doesn't appear in NOUN_LEAD_TAGS;
                        JKB skipped)
   ```

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

### 8.4 The Sejong POS tags the lemmatizer cares about

For reference, the relevant Sejong tags are:

| Family    | Tag   | Meaning                              |
|-----------|-------|--------------------------------------|
| Nouns     | NNG   | Common noun                          |
|           | NNP   | Proper noun                          |
|           | NNB   | Bound noun (의존명사)                |
|           | NR    | Numeral                              |
|           | NP    | Pronoun                              |
| Pre-noun  | MM    | Determiner (관형사)                  |
| Verbs     | VV    | Verb                                 |
|           | VA    | Adjective ("descriptive verb")       |
|           | VX    | Auxiliary verb / adjective            |
|           | VCN   | Negative copula (아니다)             |
|           | VCP   | Copula (이다)                        |
| Suffixes  | XPN   | Noun-prefixing                       |
|           | XSN   | Noun-forming                         |
|           | XSV   | Verb-forming                         |
|           | XSA   | Adjective-forming                    |
|           | XR    | Root                                 |
| Endings   | EP    | Pre-final ending                     |
|           | EF    | Final ending                         |
|           | EC    | Connecting ending                    |
|           | ETN   | Nominalizing ending                  |
|           | ETM   | Modifier ending                      |
| Particles | JKS   | Subject                              |
|           | JKC   | Complement                           |
|           | JKO   | Object                               |
|           | JKG   | Possessive                           |
|           | JKB   | Adverbial                            |
|           | JKV   | Vocative                             |
|           | JKQ   | Quotative                            |
|           | JX    | Auxiliary (topic, also, only, …)     |
|           | JC    | Connective                           |
| Symbols   | SL    | Foreign / Latin                      |
|           | SH    | Hanja                                |
|           | SN    | Numeral characters                   |
|           | SF/SE/SS/SP/SO/SW/SY | Punctuation              |

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

| Surface     | candidates                       | multiPrimary | promotedForms                                 |
|-------------|----------------------------------|--------------|-----------------------------------------------|
| `반말`      | ['반말', '반', '말']             | true         | {반말, 반말하다, 반말되다, 반, 반하다, 반되다, 말, 말하다, 말되다} |
| `예약해야`  | ['예약하다', '예약', '하다', …]  | false        | {예약해야, 예약해야하다, 예약해야되다, 예약하다, 예약하다하다, 예약하다되다} |
| `학교에서`  | ['학교', '학교에서']             | false        | {학교에서, 학교에서하다, 학교에서되다, 학교, 학교하다, 학교되다} |

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

The URLs you can read from `ytInitialPlayerResponse.captions
.playerCaptionsTracklistRenderer.captionTracks[].baseUrl` are missing
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

| Direction | Message shape                                         | Purpose                                |
|-----------|-------------------------------------------------------|----------------------------------------|
| iso → main| `{ __lwsYtCmd: 'tracklist', reqId }`                  | "What captions does this video have?"  |
| iso → main| `{ __lwsYtCmd: 'load-track', reqId, lang }`           | "Switch to the lang track."             |
| main → iso| `{ __lwsYtReply: 'tracklist', reqId, tracks }`        | tracklist reply                         |
| main → iso| `{ __lwsYtReply: 'load-track', reqId, ok, error? }`   | load-track ACK                          |
| main → iso| `{ __lwsYtCaption: true, url, status, body }`         | broadcast — every captured timedtext    |

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
Removing it on teardown restores the natives.

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

| Cache         | Key                  | Value                                          |
|---------------|----------------------|------------------------------------------------|
| `lookup:*`    | `surface` (raw)      | Full `LookupResponse` with the raw XMLs etc.   |
| `hanja:*`     | concatenated Hanja   | `{ chars, hanjas: [{character, sino, summary}], cachedAt }` |

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
filesystem). Built from <https://github.com/abishake/mecab-ko>.

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

| File                          | Tests | Covers                                                            |
|-------------------------------|-------|-------------------------------------------------------------------|
| `tests/api.test.js`           | 20    | URL builders for KRDict / OpenDict; `looksEmpty`; `extractApiError` |
| `tests/cache.test.js`         | 11    | Two-tier cache: set/get round-trip; namespacing; LRU eviction; clear with and without `getKeys` |
| `tests/grammar-glosses.test.js`| 11   | `morphemeGloss` three-tier lookup; homograph disambiguation; `isContentMorpheme` filter |
| `tests/lemmatizer.test.js`    | 29    | Verb / adjective stems; Inflect decomposition; compound nouns (NNG+NNG, NNG+XSV, XR+XSA, MM+NNB+XSV); particle skipping; dedup |
| `tests/parsers.test.js`       | 51    | KRDict and OpenDict XML parsing; example extraction; POS translation tables (English / Korean / shortform); Hanja URL builders; grade-to-stars; verb-link URL builders |

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

## 14. How to add a new site adapter

Most sites work out of the box — the default sentence-extraction walks
up the DOM until it hits a `<p>`, `<li>`, `<blockquote>`, `<article>`,
etc. and uses that block's text. If your target site needs different
behavior, here's the recipe.

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

### 14.3 If you need active page manipulation (caption replacement, etc.)

This is what `youtube-adapter.js` is. Create a new file in `extension/`
that exports `setup()`:

```js
// extension/myservice-adapter.js
export async function setup() {
  // ... your setup logic
  // - register listeners
  // - mount DOM
  // - watch for SPA navigation
  // Return value not used by content.js; manage your own teardown.
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

Add it to `web_accessible_resources` in `manifest.json`:

```json
"web_accessible_resources": [{
  "resources": [
    "popup-shadow.css",
    "parsers.js",
    "grammar-glosses.js",
    "site-configs.js",
    "youtube-adapter.js",
    "youtube-page-hook.js",
    "myservice-adapter.js"
  ],
  "matches": ["<all_urls>"]
}]
```

`content.js` dynamic-imports the adapter at the end of `init()`:

```js
if (siteConfig && siteConfig.adapter) {
  import(chrome.runtime.getURL(siteConfig.adapter))
    .then((mod) => mod && typeof mod.setup === 'function' && mod.setup())
    .catch(...);
}
```

The adapter is responsible for its own:
- Storage listeners (settings + per-site overrides).
- Navigation handling (SPA navigation events + URL polling fallback).
- DOM teardown when navigating away or when the user disables a relevant
  setting.
- Communication with the popup (if needed) via `chrome.runtime.onMessage`.

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

---

## 16. Where to make changes for common requests

| User request                                | What to change                                                |
|---------------------------------------------|---------------------------------------------------------------|
| Add a new POS-to-English mapping            | `parsers.js` `KOREAN_POS_TO_ENGLISH` + test                   |
| Add a morpheme gloss for a new particle     | `grammar-glosses.js` `FORM_GLOSSES` + test                    |
| Fix a wrong lemma for a specific surface    | `lemmatizer.js` candidate ordering + test                     |
| Add a new site-specific sentence selector   | `site-configs.js` entry                                       |
| Replace a site's captions with dual subs    | New adapter in `extension/`, registered in `site-configs.js`  |
| Add a new chrome.storage.sync setting       | `options.html` + `options.js`; `chrome.storage.onChanged` listener in the consumer |
| Hook a new dictionary API                   | `api.js` URL builder + `parsers.js` XML parser + `background.js` `handleLookup` |
| Change popup look                           | `popup-shadow.css` (the in-page popup), NOT `popup.css` (the toolbar popup) |
| Change toolbar popup look                   | `popup.css`                                                   |
| Change settings page look                   | `options.css`                                                 |
| Tweak word scanning (e.g. add a skip tag)   | `content.js` `SKIP_TAGS`                                      |

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

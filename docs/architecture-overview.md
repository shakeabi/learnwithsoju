# Architecture overview

High-level view of how `learnwithsoju` is wired together. Read this
first to get the mental model; then jump to the topic-specific docs
linked from [`DEVELOPMENT.md`](DEVELOPMENT.md).

---

## What the extension does

`learnwithsoju` is a Manifest V3 browser extension that turns any
webpage with Korean text into a hover dictionary. The user mouses over
(or clicks) any Korean word and a popup appears showing:

- the dictionary entry from KRDict (the National Institute of Korean
  Language's learner dictionary) — translated headword,
  part-of-speech, pronunciation, difficulty grade, Hanja origin,
  numbered senses with example sentences
- the sentence the word came from, with every other word in that
  sentence rendered as a clickable chip so the user can read through
  a sentence word-by-word without losing context
- a click-to-expand morpheme breakdown — every grammatical particle
  and ending that the MeCab-Ko morphological analyzer found, with a
  short gloss ("subject marker", "past tense", "polite ending", ...)
- a click-to-expand per-character Hanja breakdown — Sino-Korean
  reading plus an English meaning for every Han ideograph in the
  entry's origin
- an "Ask AI" pill that opens ChatGPT or Claude with a structured
  prompt pre-filled

On YouTube and Netflix the extension goes further and replaces the
host's native captions with a dual-language overlay (Korean on top,
the user's preferred secondary language below). See
[site-adapters.md](site-adapters.md) for the gory details of each.

The extension is intentionally small and **has no build step**. The
contents of `extension/` are what get loaded directly into the
browser. The only dependencies are at the test layer
(`@xmldom/xmldom`) and at the analyzer layer (a vendored fork of
`mecab-ko-wasm` plus a gzipped copy of `mecab-ko-dic 2.1.1`). The
user supplies their own free API key from the NIKL APIs.

---

## Components and worlds

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
   │      │   {type:'openOptions'}            │ youtube- /    │
   │      │   {type:'ping' | 'warmup'}        │ netflix-      │
   │      │   {type:'clearCache' | 'cacheCounts'} │ adapter.js │
   │      │   {type:'mecab-inspect'}          │  (isolated)   │
   │      ▼                                   └──┬────────────┘
   │   ┌─────────────────────────────────┐       │ injects via
   │   │  background.js (service worker) │       │ <script src=…>
   │   │  ─────────────────────────────  │       ▼
   │   │   mecab WASM (warmed at startup)│  ┌─────────────────────┐
   │   │   four cache namespaces:        │  │ *-page-hook.js      │
   │   │     lookup:* hanja:*            │  │   (page main world) │
   │   │     krdict:* opendict:*         │  │   XHR + fetch hooks │
   │   │   API key mirror (krKey/odKey)  │  │   player API access │
   │   │   handleLookup, handleHanja     │  └──┬──────────────────┘
   │   └──┬────────────────┬─────────────┘     │ window.postMessage
   │      │ HTTPS          │ HTTPS             │   __lwsYtCmd / __lwsNxCaption
   │      ▼                ▼                   │   __lwsYtReply / __lwsNxManifest
   │   krdict.       opendict.                 ▼
   │   korean.go.kr  korean.go.kr           Host player
   │
   │ chrome.tabs.sendMessage
   │   {type:'lws-yt-popup-info'}
   │   {type:'lws-nx-popup-info'}
   │   {type:'lws-site-info'}
   │
┌──┴───────────────────────────┐    ┌─────────────────────────┐
│  popup.html / popup.js       │    │ options.html /          │
│  (toolbar action)            │    │ options.js              │
│  - per-site disable toggle   │    │  - API keys             │
│  - per-site adapter section  │    │  - dual subs on/off     │
│    (e.g. youtube-popup.js,   │    │  - secondary lang       │
│     netflix-popup.js)        │    │  - Ask-AI provider/prompt│
│                              │    │  - 3 per-namespace      │
│                              │    │    clear-cache buttons  │
└──────────────────────────────┘    └─────────────────────────┘
```

| Component                 | World           | Lifetime         | Notes                                                                                          |
| ------------------------- | --------------- | ---------------- | ---------------------------------------------------------------------------------------------- |
| `content.js`              | isolated        | per top-frame    | The only piece that touches the page DOM. One instance per tab/frame.                          |
| `background.js`           | service worker  | lazy / suspended | MV3 SW that handles dictionary requests and owns the mecab analyzer.                           |
| `popup.{html,js}`         | extension page  | open/close       | Toolbar-action UI. Talks to the active tab via `chrome.tabs.sendMessage`.                      |
| `options.{html,js}`       | extension page  | open/close       | Settings. Writes to `chrome.storage.sync`.                                                     |
| `notepad.{html,js}`       | extension page  | open/close       | Paste-Korean-text scratchpad; reuses content.js's machinery.                                   |
| `morpheme-inspector.{html,js}` | extension page | open/close   | Developer tool; visualizes every mecab field plus the n-best lemma candidate pool.             |
| `youtube-adapter.js`      | isolated        | per /watch       | Site adapter for YouTube. Replaces native captions with dual-line overlay.                     |
| `youtube-page-hook.js`    | page main world | injected once    | Page-world hook that observes YouTube's caption fetches and drives `player.setOption`.         |
| `netflix-adapter.js`      | isolated        | per /watch       | Site adapter for Netflix. TTML parse + per-language cache + dual-language overlay.             |
| `netflix-page-hook.js`    | page main world | injected once    | Page-world hook: subtitle body sniff + `setTextTrack` track-select dance for auto-prime.       |
| Shadow-DOM popup          | content.js      | per popup        | The actual hover UI; uses an open Shadow Root attached at the document root with adopted CSS.  |
| MeCab WASM + mecab-ko-dic | service worker  | warmed eagerly   | ~22 MB compressed; init triggered on SW startup (`onStartup` / `onInstalled`) so the first hover doesn't pay the dict-fetch + inflate stall.    |

External services touched at runtime:

| Host                        | When                                                                                                              | Auth                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------- |
| `krdict.korean.go.kr`       | Every dictionary lookup that misses the cache                                                                     | User's KRDict API key |
| `opendict.korean.go.kr`     | Only when KRDict returns nothing AND the user has provided a key                                                  | User's OpenDict key   |
| `hangulhanja.com`           | When the user clicks a Hanja origin chip in the popup (lazy, cached)                                              | None (open API)       |
| `koreanverb.app`            | Outbound `target=_blank` link only — no extension-initiated fetch                                                 | n/a                   |
| `chatgpt.com` / `claude.ai` / etc. | "Ask AI" pill — opens the chosen provider in a new tab with `?q=<prompt>`. No extension-initiated fetch.   | n/a                   |

---

## Per-site behaviour

The toolbar popup has a per-host disable toggle that takes effect
immediately — dictionary popups stop firing, the dashed underlines
come off, and (on YouTube/Netflix) the dual-subs overlay tears down.
Toggling back on re-activates without a reload. There is no global
"hover dictionary on/off" toggle — the per-site list covers "off
here" and `chrome://extensions` covers "off everywhere".

Site behaviour is data-driven via `SITE_CONFIGS` in
[`site-configs.js`](../extension/site-configs.js). See
[site-adapters.md](site-adapters.md) for the YouTube and Netflix
specifics, and [extension-surfaces.md](extension-surfaces.md) for the
popup-side site sections.

---

## Repository layout

```
learnwithsoju/
├── extension/                          ← what gets loaded as an unpacked extension
│   ├── manifest.json                   ← MV3, dual-target Chrome + Firefox
│   ├── background.js                   ← service worker; owns mecab + caches; KRDict/OpenDict/Hanja fetches
│   ├── content.js                      ← injected on <all_urls>; only file that touches the page DOM
│   ├── content.css                     ← styling for the in-page `.lws-word` underline + popup host
│   ├── popup-shadow.css                ← stylesheet for the in-page hover popup (loaded into its Shadow DOM)
│   ├── api.js                          ← KRDict/OpenDict URL builders + response-shape sniffers + grouping algorithm (pure)
│   ├── lemmatizer.js                   ← mecab tokens → ordered candidate dictionary forms (pure)
│   ├── parsers.js                      ← KRDict/OpenDict XML → entry objects; POS/Hanja/grade helpers (pure)
│   ├── grammar-glosses.js              ← morpheme form/POS → short English gloss for the breakdown chips (pure)
│   ├── ai-providers.js                 ← registry of "Ask AI" pill targets (ChatGPT, Claude, …)
│   ├── site-configs.js                 ← per-site sentence selectors + findVideo + adapter + popupModule paths
│   ├── youtube-adapter.js              ← content-script-side YouTube adapter; dual subs lifecycle
│   ├── youtube-popup.js                ← popup-side YouTube section (per-video secondary-language picker)
│   ├── youtube-page-hook.js            ← page-main-world script; XHR/fetch hooks + tracklist/load-track command channel
│   ├── netflix-adapter.js              ← content-script-side Netflix adapter (TTML parse, per-lang cache, dual-line overlay, kicks off track-select dance)
│   ├── netflix-popup.js                ← popup-side Netflix section (per-title secondary-language dropdown)
│   ├── netflix-page-hook.js            ← page-main-world script; subtitle body sniff + track-select dance via window.netflix player API
│   ├── cache.js                        ← two-tier (in-mem LRU + storage adapter) cache factory; namespaced (pure)
│   ├── popup.html / popup.js / popup.css           ← toolbar action UI
│   ├── options.html / options.js / options.css     ← settings page (API keys, behaviour, cache buttons, Ask-AI)
│   ├── notepad.html / notepad.js                   ← standalone paste-and-hover scratchpad
│   ├── morpheme-inspector.html / .js / .css        ← developer tool: tokenize Korean text + show every mecab field
│   ├── icons/                          ← 16, 48, 128 px PNGs used by chrome://extensions and the toolbar
│   └── vendor/mecab-ko/                ← vendored analyzer artifacts; see MECAB_INTEGRATION.md
│
├── tests/                              ← node:test suite. Pure modules only — no jsdom, no Chrome stubs.
├── docs/                               ← this directory; see DEVELOPMENT.md for the index
├── .github/workflows/ci.yml            ← npm test, parse-check every extension/*.js, validate manifest
├── CONTRIBUTING.md                     ← contributor getting-started
├── README.md                           ← user-facing readme
├── LICENSE                             ← AGPL-3.0-or-later
└── package.json                        ← exists for the test harness only ("npm test")
```

The invariant that makes most of the codebase unit-testable: **only
`content.js`, `background.js`, `popup.js`, `options.js`, and the
site-adapter / page-hook files touch host APIs.** Everything else
(`api.js`, `lemmatizer.js`, `parsers.js`, `grammar-glosses.js`,
`cache.js` with an injected adapter) is pure JavaScript that can be
imported into Node.

See [file-walkthroughs.md](file-walkthroughs.md) for a per-file
breakdown of responsibilities and module-level state.

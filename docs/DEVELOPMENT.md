# Development guide

This document is the architecture and code-walkthrough reference. If you're contributing, start here. For a getting-started/install guide use [CONTRIBUTING.md](../CONTRIBUTING.md). For the user-facing description, see [README.md](../README.md).

## Project at a glance

```
learnwithsoju/
├── extension/                         ← what gets loaded as a browser extension
│   ├── manifest.json                  ← MV3, dual-target Chrome + Firefox
│   ├── background.js                  ← service worker / event page entry point
│   ├── content.js                     ← injected into every page; the only file that touches the DOM
│   ├── content.css                    ← styles for in-page word spans
│   ├── popup-shadow.css               ← styles for the popup, loaded into the popup's shadow DOM
│   ├── api.js                         ← URL builders + response sniffing helpers (pure)
│   ├── lemmatizer.js                  ← mecab tokens → candidate dictionary forms (pure)
│   ├── parsers.js                     ← KRDict/OpenDict XML → entry objects (pure, DOMParser injected)
│   ├── grammar-glosses.js             ← morpheme form/POS → short English gloss (pure)
│   ├── grammar-match.js               ← grammar-pattern regex matcher (pure)
│   ├── cache.js                       ← two-tier cache abstraction (pure)
│   ├── popup.{html,js,css}            ← toolbar action popup
│   ├── options.{html,js,css}          ← settings page
│   ├── icons/                         ← 16/48/128 PNGs
│   └── vendor/
│       ├── mecab-ko/                  ← built mecab-ko-wasm + gzipped mecab-ko-dic
│       └── grammar-patterns/patterns.json
│
├── tests/                             ← node:test suite (run with `npm test`)
│   ├── *.test.js                      ← one per pure module
│   └── fixtures/                      ← KRDict/OpenDict sample XML used by parser tests
│
├── docs/
│   ├── DEVELOPMENT.md                 ← (this file)
│   ├── MECAB_INTEGRATION.md           ← the mecab-ko-wasm fork-and-rebuild story
│   ├── THIRD-PARTY.md                 ← attribution + licenses for everything vendored
│   ├── original-spec.md               ← the original V1 spec, kept for historical reference
│   └── mecab-browser-smoketest.html   ← stand-alone diagnostic for upstream mecab-ko-wasm
│
├── scripts/
│   └── build-grammar-patterns.mjs     ← regenerates extension/vendor/grammar-patterns/patterns.json
│
├── .github/workflows/ci.yml           ← runs npm test + parses each extension/*.js + validates manifest
├── .gitattributes                     ← marks .wasm/.gz/.png as binary
├── CONTRIBUTING.md                    ← getting-started for contributors
├── README.md                          ← user-facing intro
├── LICENSE                            ← MIT (extension code only — vendored deps have their own licenses)
├── package.json                       ← exists for the test harness only
└── package-lock.json
```

## High-level architecture

```
                    ┌─────────────────────────────────────────────┐
                    │   any webpage with Korean text              │
                    │     <p>학교에서 친구들과 점심을…</p>          │
                    └──────────────────────┬──────────────────────┘
                                           │ injected
                                           ▼
                            ┌─────────────────────────────┐
                            │   content.js (per tab)      │
                            │   - TreeWalker DOM scan     │
                            │   - wraps spans, hover UI   │
                            │   - shadow-DOM popup        │
                            └────────────┬────────────────┘
                                         │ chrome.runtime.sendMessage
                                         │   {type:'lookup', surface}
                                         ▼
                            ┌─────────────────────────────┐
                            │  background.js (SW)         │
                            │  - mecab WASM (lazy init)   │
                            │  - cache (chrome.storage +  │
                            │    in-memory LRU)           │
                            │  - KRDict / OpenDict fetch  │
                            └────────────┬────────────────┘
                                         │ HTTPS
                            ┌────────────┴────────────────┐
                            ▼                             ▼
                  https://krdict.korean.go.kr   https://opendict.korean.go.kr
```

The key invariant: **the only file that touches the DOM is `content.js`.** Everything else is pure logic that takes data and returns data, which is why most of it is unit-tested cleanly without a browser harness.

## Message contract (content ↔ background)

Single message type for normal flow: `{ type: 'lookup', surface: string }`. Service worker responds with:

```ts
type LookupResponse = {
  surface: string,
  lemma: string,                    // best candidate, used as fallback display
  queryUsed: string | null,         // which candidate actually hit the dictionary
  tokens: MecabToken[] | null,      // mecab tokenization of `surface` (null on init failure)
  krXml: string | null,             // raw KRDict XML response
  odXml: string | null,             // raw OpenDict XML response (optional fallback)
  cachedAt: number,
} | {
  error: 'NO_API_KEY' | 'FETCH_FAILED' | 'INTERNAL',
  message?: string,
  surface, lemma, tokens,           // partial info still available
}
```

Other messages: `{ type: 'ping' }` (health check), `{ type: 'openOptions' }` (content script asks SW to open settings), `{ type: 'clearCache' }` (settings page wipes the L2 cache).

XML is parsed in **content.js** (which has DOMParser), not the service worker (which doesn't). The cached payload includes the raw XML so a cache hit on rerender doesn't require re-fetching.

## Lookup pipeline (background.js)

```
handleLookup(surface)
   │
   ├─ cache.get(surface)             → return cached if present
   │
   ├─ tokenizeSurface(surface)
   │     │
   │     ├─ ensureMecab()             [first call only]
   │     │     ├─ wasm-bindgen init from extension/vendor/mecab-ko/mecab_ko_wasm.js
   │     │     ├─ fetchAndGunzip(sys.dic.gz, matrix.bin.gz, entries.bin.gz)
   │     │     │     uses Chrome's built-in DecompressionStream
   │     │     └─ Mecab.withDictBytes(trie, matrix, entries)
   │     └─ mecab.tokenize(surface)  → serialize to plain JS objects
   │
   ├─ lemmaCandidates(tokens, surface)
   │     │  (extension/lemmatizer.js)
   │     │  walks tokens, collects content morphemes:
   │     │   - VV/VA/VX/XSV/XSA → stem + 다
   │     │   - NN*/NR/NP/SL/SH/SN → stem itself
   │     │   - particles (JK*) and endings (E*) → skipped
   │     └  always includes surface as fallback
   │
   ├─ for each candidate:
   │     fetch buildKrdictUrl(candidate, krKey)
   │     if !looksEmpty(xml) → break
   │
   ├─ if KRDict returned no results AND OpenDict key present:
   │     same loop against OpenDict
   │
   └─ cache.set(surface, response) and return
```

`ensureMecab()` is memoized via a module-level promise so concurrent first-hover requests share the same init. The WASM + dict only load once per service-worker lifetime; the SW may be evicted by Chrome after ~30s idle, in which case the next lookup pays the init cost again (~1–2 s).

## Lemmatizer (extension/lemmatizer.js)

Pure function: `lemmaCandidates(tokens, surface) => string[]`.

The Sejong POS tags from mecab are split on `+` (mecab merges some tags like `VV+EP` for past-tense verb stems). The lead tag determines the role:

| Lead tag | Role | Lemma rule |
|---|---|---|
| VV, VA, VX, VCN, VCP, XSV, XSA | verb / adjective stem | append `다` |
| NNG, NNP, NR, NP, SL, SH, SN | noun-like | take stem as-is |
| JK*, JX, JC | particle | skip |
| EP, EF, EC, ETN, ETM | ending | skip |
| (other) | (other) | skip |

The candidate list is ordered: most-likely lemma first, surface form last as fallback. Caller (background.js) tries them sequentially against KRDict; first hit wins.

The "surface as fallback" is important — mecab splits compound nouns like `한국말` into `한국 + 말`, but KRDict often indexes the compound whole. So we try both.

**Inflect-type tokens.** When the dictionary stores an irregular conjugation whole (`걸려`, `예뻐요`, `봐요`, `돼요`, `해야` …), mecab emits a single token whose `lemma` getter returns just the reading — useless for dictionary lookup. The real morpheme decomposition lives at index 7 of the raw `features` CSV row, e.g. `걸리/VV/*+어/EC/*`. `inflectStem(features)` parses that out and the lemmatizer prefers it over `lemma` when present, so `걸려` resolves to `걸리다` instead of `걸려다`.

## Mecab integration (the long story)

Full deep-dive in [MECAB_INTEGRATION.md](MECAB_INTEGRATION.md). Short version:

- The published `mecab-ko-wasm` npm package ships only the analyzer engine (~86 KB WASM); `mecab-ko-dic` is not bundled. `new Mecab()` errors at runtime in browsers.
- We forked the upstream Rust crate and added a `from_bytes` constructor path that accepts dict bytes from JavaScript:
  - `SystemDictionary::from_bytes(DictBytes)` (mecab-ko-dict)
  - `Tokenizer::from_dict_bytes(DictBytes)` (mecab-ko-core)
  - `Mecab::withDictBytes(trie, matrix, entries)` (mecab-ko-wasm, JS-facing)
- Built the WASM with `wasm-pack build --target web --release`.
- Built `mecab-ko-dic 2.1.1` raw `.bin` files via the upstream `mecab-ko-dict-builder`.
- Gzipped those files (~22 MB compressed total).
- The service worker's `fetchAndGunzip` uses Chrome's built-in `DecompressionStream('gzip')` to inflate at init time.
- Why this works: `UnknownHandler::korean_default()` is hardcoded in mecab-ko-core, so we don't need to ship `char.bin` or `unk.bin` — only the 3 dict files are required.

The fork lives at `~/projects/mecab-ko-fork/`. To rebuild after upstream changes:

```bash
cd ~/projects/mecab-ko-fork/rust/crates/mecab-ko-wasm
wasm-pack build --target web --release --out-dir pkg-web
cp pkg-web/{mecab_ko_wasm.js,mecab_ko_wasm.d.ts,mecab_ko_wasm_bg.wasm,mecab_ko_wasm_bg.wasm.d.ts} \
   ~/projects/learnwithsoju/extension/vendor/mecab-ko/
```

## Popup rendering (content.js)

`content.js` is the only file with DOM access. Its responsibilities:

1. **Word wrapping.** On `document_idle`, walks the DOM with a `TreeWalker`, finds Korean text nodes, replaces each `[Korean run]` with a `<span class="lws-word" data-surface="…">`. Skips inputs, code blocks, contenteditable, and our own popup. Uses `requestIdleCallback` chunking on large pages.
2. **Mutation observer.** Re-runs the wrap on dynamically-added DOM (so SPAs and pages with infinite scroll just work).
3. **Hover handling.** Delegates `mouseenter`/`mouseleave` on `.lws-word`. Debounces 60ms to avoid lookups on cursor flyovers.
4. **Popup.** Single persistent `<div>` reattached as needed, hosting a shadow DOM. Repositioned on each show. Flips above/left when near the viewport edges. Tracks monotonic non-decreasing min-height/min-width for the lifetime of one lookup so the popup doesn't shrink under the cursor when the user toggles tabs/lang.
5. **Sentence extraction.** Walks up from the hovered span to the nearest semantic block (`P`, `LI`, `TD`, headings, `BLOCKQUOTE`, etc.) and produces `{before, word, after}`. Used for both the contextual sentence display and the grammar-pattern matcher.
6. **Grammar matching.** Lazy-loads `vendor/grammar-patterns/patterns.json` on first hover, runs `findMatches()` against the extracted sentence + hovered range, renders matches between the decomposition and entries.

Popup composition order:

```
1. lemma chip + EN/KR toggle row    (when lemma differs from surface OR there are entries)
2. given-sentence band              (when extractSentence found one)
3. morpheme-breakdown stack         (when ≥ 2 content morphemes)
4. grammar-pattern matches          (when any pattern hits the hovered range)
5. tab strip                        (when KRDict returned > 1 entry)
6. KRDict entries                   (currently active tab only)
7. OpenDict section                 (when KRDict was empty and OpenDict key set)
```

## Grammar pattern matcher

Two pieces:

**Build-time** (`scripts/build-grammar-patterns.mjs`): walks YAML files in the upstream grammar-pattern dataset (URL in [THIRD-PARTY.md](THIRD-PARTY.md)), derives a regex source string from each pattern's display name. Regex generation handles:

- `A/B/...` alternation: same-length arms → full alternation; mixed-length arms with a vowel-harmony head set (`아/어`, `아/어/여`, `았/었`, `았/었/였`) → char-level alternation with shared suffix factored out.
- `(A)` parens around Korean → optional group.
- Whitespace → `\s*` flex.

Output: `extension/vendor/grammar-patterns/patterns.json` (~92 KB, 290 patterns).

**Runtime** (`extension/grammar-match.js`):

1. Lazy-compile each pattern's regex on first use, cache via `WeakMap`.
2. `findMatches(db, sentenceText, hoverRange)` runs each pattern's regex against the sentence; keeps matches whose character range overlaps the hovered word's range (with ±1 char tolerance).
3. Filters out patterns with single-character names (`요`, `부`, `지`) — too noisy.
4. Returns at most 5 matches, ordered by start position, then name length (longer/more-specific first).

Known limit: the regex is built from the literal display name. Verb conjugation contractions like `해야` (from `하 + 여야`) or `돼요` (from `되 + 어요`) defeat patterns that include `되다`/`하다` as targets. A V2 morpheme-aware matcher would use the mecab token sequence directly. Listed in the README's roadmap.

## Cache (extension/cache.js)

Two-tier:

- **L1**: in-memory `Map` with LRU eviction (default cap 500 entries). Keyed by surface form. Lost when the service worker is killed (~30s idle in Chrome).
- **L2**: `chrome.storage.local` with the `unlimitedStorage` permission. Persistent across SW restarts.

The factory takes a `storage` adapter so tests can pass a `Map`-backed mock. `chromeStorageAdapter()` wraps the real `chrome.storage.StorageArea` and normalizes the (callback-vs-promise) API differences across MV2 and MV3.

The "Clear cache" button on the settings page sends `{type: 'clearCache'}` to the SW; that walks every key prefixed with `lookup:` and deletes them, leaving other extension storage untouched.

## Parsers (extension/parsers.js)

Pure module — DOMParser is **injected**, so the same code runs in the content script (real DOMParser) and in tests (`@xmldom/xmldom`).

Three parser functions:

- `parseKrdictXml(xml, DOMParserCtor)` — channel/item/sense structure with translations and examples.
- `parseOpendictXml(xml, DOMParserCtor)` — similar shape but with `translation_info`/`language_type` instead of KRDict's `translation`/`trans_lang`.
- `extractExamplesFromSense(senseEl)` — internal helper, walks `<example>` and `<example_text>` elements, dedupes leaves.

Plus a few small data-massage helpers exported for content.js: `gradeToStars`, `gradeToTooltip`, `posToEnglish`, `posToShortform`, `isHanjaChar`, `hanjaCharUrl`, `koreanVerbUrl`, `isVerbLikePos`, `filterTranslations`. Each is a pure lookup or trivial regex; each has unit tests.

## Decomposition glosses (extension/grammar-glosses.js)

Hand-curated tables for the ~50 most common Korean particles, endings, and grammatical morphemes. Three-tier lookup in `morphemeGloss(form, pos)`:

1. **POS-disambiguated form**: `${form}|${leadPos}` (handles homographs like 을 = object marker for JKO vs future-tense modifier for ETM).
2. **Form-only**: bare form match.
3. **POS-only**: fallback to a generic gloss for the lead Sejong tag.

`isContentMorpheme({form, pos})` filters out punctuation marks (`SF`, `SE`, `SS`, `SP`, `SO`, `SW`, `SY`) but keeps content S* tags (`SH` Hanja, `SL` Latin, `SN` numerals).

The breakdown row in the popup is suppressed when there's only 1 content morpheme — the headword section already shows the same info.

## Settings page (extension/options.html, options.js, options.css)

Standalone HTML page. State is `chrome.storage.sync`-backed:

- `krdictApiKey` (required)
- `opendictApiKey` (optional, experimental)
- `enabled` (global on/off — also surfaced via the toolbar action popup)
- `defLang` ('en' or 'ko' — controls which translation language the popup shows)

Plus a "Test KRDict key" button that does a one-off `사람` lookup so the user can verify their key works without leaving the settings page.

## Toolbar action popup (extension/popup.html, popup.js, popup.css)

Tiny ~260px popover. Shows enable/disable toggle, status (active / disabled / API key not set), and a link to the settings page. Two-way bound to `chrome.storage.sync.enabled`.

## Tests

`npm test` runs all `tests/**/*.test.js` via Node's built-in `node:test`. 112 tests as of writing, structured one suite per pure module:

- `lemmatizer.test.js` — 15 cases, token-driven candidate generation.
- `api.test.js` — 19 cases, URL builders and response sniffing.
- `parsers.test.js` — 26 cases, KRDict/OpenDict XML → entries.
- `cache.test.js` — 11 cases, two-tier behavior + LRU + clear semantics.
- `grammar-glosses.test.js` — 11 cases, form/POS lookup, homograph disambiguation.
- `grammar-match.test.js` — 11 cases, overlap, adjacency, dedup, useful-pattern filter.

The single dev dependency is `@xmldom/xmldom`, used by parsers.test.js to provide a Node DOMParser. `js-yaml` is used only by the grammar-pattern build script.

Files we don't unit test (touch the DOM, chrome.* APIs, or mecab itself):

- `background.js` — exercised manually by loading the extension and using it
- `content.js` — same
- `popup.js`, `options.js` — same

Their pure logic is extracted into the testable modules above where possible.

## CI (.github/workflows/ci.yml)

On every push and PR to `main`:

1. `npm ci` to install the test harness deps.
2. `npm test` — must pass.
3. `node --check` on every `extension/*.js` — guards against syntax errors.
4. Validate `manifest.json` parses as JSON.

Runs on Node 20. No browser tests in CI yet — manual smoke testing on extension load is the cross-browser verification step.

## Cross-browser story

The `extension/` folder is meant to load directly in both Chrome MV3 (109+) and Firefox MV3 (121+).

In `manifest.json`:

- `background.service_worker` is what Chrome reads.
- `background.scripts` is what older Firefox MV3 versions read; newer ones tolerate both.
- `browser_specific_settings.gecko.id` + `strict_min_version: 121.0` is required for Firefox AMO submission and signals the minimum supported version.

In code: the `chrome.*` namespace is used everywhere. Firefox aliases `chrome` to `browser` for compatibility, so no conditional branching is needed for the APIs we use (`storage`, `runtime`, `action`, `storage.onChanged`).

Capabilities matrix (everything we depend on):

| Feature | Chrome | Firefox |
|---|---|---|
| MV3 service worker as background | 88+ | 121+ for full SW; 109+ for event-page fallback |
| `chrome.storage.sync/local` | 88+ | 109+ |
| `chrome.runtime.sendMessage`/onMessage | 88+ | 109+ |
| `DecompressionStream('gzip')` | 80+ | 113+ |
| `WebAssembly.instantiate` with `'wasm-unsafe-eval'` CSP | 88+ | 102+ for CSP directive; 121+ for SW WASM |
| ES modules in service worker | 88+ | 121+ |

Lowest common floor: Chrome 88 / Firefox 121 (the latter is the actual gating constraint).

## Release process (rough)

When ready to publish:

1. Bump version in `extension/manifest.json` and `package.json`.
2. ZIP `extension/` for Chrome Web Store upload.
3. ZIP `extension/` again (or use the same ZIP) for AMO upload.
4. Tag the commit: `git tag v0.1.0 && git push --tags`.

Both stores will run their own automated checks. The Chrome Web Store typically clears within hours; AMO can take days for the first review.

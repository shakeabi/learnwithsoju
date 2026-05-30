# Per-file walkthrough

One section per file under `extension/` (now organized into
`core/`, `adapters/<site>/`, and `pages/<page>/` subfolders, with
`background.js` and `content.js` at the root). Each lists purpose, public
API, module-level state, and the non-obvious invariants. For
end-to-end flows that cross files, see
[lookup-pipeline.md](lookup-pipeline.md),
[site-adapters.md](site-adapters.md), and
[message-flows.md](message-flows.md).

---

## `manifest.json`

MV3 manifest. Notable bits:

- `permissions: ["storage", "unlimitedStorage", "activeTab"]` — no
  host permissions on `<all_urls>` because the dictionary fetches
  happen from the background service worker, which is bound by
  `host_permissions`. `activeTab` lets the toolbar popup read
  `tab.url` for the active tab. Without it, both `chrome.tabs.query`
  calls return a tab whose `url` is undefined and the popup silently
  bails before unhiding anything.
- `host_permissions`: `krdict.korean.go.kr`, `opendict.korean.go.kr`,
  `hangulhanja.com`. That's the entire network surface.
- `content_security_policy.extension_pages: "script-src 'self' 'wasm-unsafe-eval'; ..."`
  — the WASM analyzer needs `wasm-unsafe-eval` to instantiate inside
  the MV3 service worker.
- `browser_specific_settings.gecko.strict_min_version: "121.0"` —
  Firefox 121+ for MV3 service-worker support (the SW is
  `type: "module"`).
- `content_scripts`: `content.js` + `content.css`, matches
  `<all_urls>`, `run_at: document_idle`, `all_frames: false`.
- `web_accessible_resources`: every JS module that `content.js`
  dynamic-imports (`core/parsers.js`, `core/grammar-glosses.js`,
  `core/site-configs.js`, `core/ai-providers.js`,
  `adapters/youtube/adapter.js`, `adapters/youtube/page-hook.js`,
  `adapters/netflix/adapter.js`, `adapters/netflix/page-hook.js`),
  plus `core/popup-shadow.css`. Accessed via
  `chrome.runtime.getURL(...)`.
- `action.default_popup: "pages/popup/popup.html"`,
  `options_page: "pages/options/options.html"` — the toolbar popup
  and the settings page live under `pages/`.

---

## `content.js`

Purpose: the only file that touches the page DOM. Scans for Hangul
text, wraps each Korean word in a `.lws-word` span, listens for
hover/click events, owns the Shadow-DOM popup, and renders
dictionary results.

This is the biggest file in the extension (~1900 lines). Key
sections:

### Module-level state

All `let` bindings inside the top-level async IIFE:

| Binding                                                                            | Purpose                                                                |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `enabled`, `hostDisabled`                                                          | `enabled = !hostDisabled`; flips on `disabledHosts` onChanged          |
| `defLang`, `secondaryLang`, `askAiPromptTemplate`, `askAiProvider`, `askAiChatGptTemporary` | Read at init; updated by onChanged                              |
| `popupHost`, `popupRoot`, `popupEl`                                                | Shadow-DOM popup parts; created lazily                                 |
| `activeWordEl`                                                                     | The `.lws-word` currently being hovered                                |
| `lastPayload`                                                                      | Last `LookupResponse` for re-rendering after toggles                   |
| `lastSentence`                                                                     | The `{before, word, after}` used for the current popup                 |
| `activeInsightTab`                                                                 | `'breakdown' \| null` — which insights panel is open                   |
| `activeTab`                                                                        | `{ source: 'primary'\|'related', index }` — which tab is highlighted   |
| `relatedExpanded`                                                                  | Whether the "+N related" pill has been clicked (shows related row)     |
| `popupMinHeight`, `popupMinWidth`                                                  | Monotonic non-decreasing — popup never shrinks during a session        |
| `expandedExamples`                                                                 | Set of `senseId` keys whose examples are open                          |
| `expandedSectionByTab`                                                             | Map of tab-id → open section index (-1 = none); exclusive per tab      |
| `expandedHanja`                                                                    | Set of Hanja-character strings whose meanings panels are open          |
| `hideTimer`, `hoverTimer`                                                          | Timeout handles for the 120 ms hide / 60 ms hover delay                |
| `pendingRequestId`                                                                 | Monotonic counter; lookup responses past this are discarded            |
| `pausedVideo`, `resumeVideoOnHide`, `suppressNextPauseEvent`, `videoPauseListener` | Video auto-pause state                                                  |
| `hanjaSession`                                                                     | Per-session Map of Hanja chars → result (avoids re-flash on rerender)  |

### Word scanning

`wrapTextNode`, `collectTextNodes`, `processInChunks`, `scanRoot`:
classic TreeWalker pipeline. Hangul detection is
`/[가-힣ᄀ-ᇿ㄰-㆏]+/g` — the precomposed syllable block, plus
the leading/trailing Jamo blocks, plus the compatibility Jamo
block.

`isSkippableNode` walks parents of a text node and rejects
descendants of `<script>`, `<style>`, `<textarea>`, `<input>`,
`<code>`, `<pre>`, `<noscript>`, `<iframe>`, `<canvas>`, `<svg>`,
`contenteditable` elements, and existing `.lws-word` spans.

`processInChunks` batches at 80 nodes per `requestIdleCallback`
tick so a multi-MB Wikipedia page doesn't freeze the main thread
on first load.

Gap spans: non-Hangul runs between matches (spaces, punctuation) are
emitted as `<span class="lws-gap">` rather than bare text nodes so
they carry the same `user-select: text` override and aren't dropped
by Chrome's selection serializer when the host container has
`user-select: none`.

### Popup lifecycle

`ensurePopup` lazily creates `popupHost` (`position: absolute`
attached to `document.documentElement` at coords 0,0), attaches an
open shadow root, mounts the stylesheet `<link>`, creates inner
`#lws-popup`.

`positionPopup(target)`: computes preferred position in viewport
coords (below the word + 8 px, flipped above if it would overflow,
clipped at the right edge), then converts to document coords
(`+ window.scrollX/Y`) before writing — the popup is
`position: absolute` so it scrolls with the page.

`showPopup(target, contentNode, opts)`: replaces popup contents,
applies remembered `min-height`/`min-width` so the popup never
shrinks below its largest-seen size this session. After the next
paint, captures the actual rendered size and bumps the monotonic
min-size memos.

`hidePopup` is wired to a 120 ms `mouseleave` delay
(`scheduleHide`), cancellable when the cursor re-enters either the
word or the popup.

### Video auto-pause / resume

When `siteConfig.findVideo()` returns a video element:

- `pauseVideoIfApplicable(anchor)` first checks that the hovered
  word is inside the configured `sentenceContainer`. If not, no
  pause happens (so comments / title hovers don't interrupt
  playback).
- On first eligible `showPopup`: pauses the video, sets
  `pausedVideo` and `resumeVideoOnHide`, attaches a `pause`
  listener.
- `suppressNextPauseEvent` swallows exactly one event (the one our
  own `.pause()` emitted). Any subsequent pause event is the user's
  and flips `resumeVideoOnHide` to `false`.
- `resumeVideoIfApplicable` runs on `hidePopup`.

### Sentence extraction

1. If `siteConfig.sentenceContainer` is set, use
   `wordEl.closest(selector)`. For YouTube this is
   `.lws-ytsubs-ko, .captions-text, .caption-window, .ytp-caption-window-container`;
   for Netflix `.lws-nxsubs-ko, .player-timedtext, .player-timedtext-text-container`.
2. If `closest()` returned null OR no site-specific selector exists,
   walk up the DOM until hitting a `SENTENCE_BLOCK_TAGS` element
   (`<p>`, `<li>`, `<td>`, `<th>`, `<blockquote>`, `<figcaption>`,
   `<article>`, `<section>`, `<h1-6>`, `<dt>`, `<dd>`, `<caption>`,
   `<summary>`) — or stop at a `<div>` with reasonable text. A
   `.lws-sentence-root` ancestor (used by the notepad page) is a
   hard ceiling — never walk above it.
3. Read `block.textContent`, normalize whitespace, reject if shorter
   than 3 chars or longer than 800 chars.
4. Locate the surface within that text, truncate to ±80 chars with
   ellipses, return `{before, word, after}`.

### Result rendering

`buildResultNode(payload, options)`:

1. Materialize each tab/unrelated group on demand via
   `entryForSection({source, queryIdx, itemIdx})`, which parses the
   matching XML the first time a section from a given query is
   requested and memoizes on
   `payload.__entryCache = { kr: Map<queryIdx, entries[]>, od: entries[] | null }`.
   Re-renders (tab switch, EN/KR toggle, section expand) reuse the
   parsed arrays.
2. Render the strip (lemma chip + EN/KR toggle), the sentence band,
   the insights node (morpheme breakdown tab).
3. Render the tab bar when `tabs.length > 1`. Multi-section primary
   tabs get a count badge. When `relatedExpanded`, also render
   `buildRelatedTabRow(unrelated)` as a second row below the
   primary strip.
4. Unrelated entries are hidden by default behind the "+N related"
   pill; clicking it reveals the related tab row (stage 1). Clicking
   a related pill switches the active tab to that word (stage 2).
5. Empty state: `No definition found for …`.

`buildTabBodyNode` stacks one `buildSectionNode` per entry. Each
section's header renders headline (word + ★ stars) plus the meta
row (POS chip, pronunciation chip, Hanja-origin chip). Only one
section per tab can be expanded at a time (tracked in
`expandedSectionByTab`).

### POS shortform adapter

`displayPosKoreanToEnglishMaybe(pos)` translates Sejong tags (NNG,
VV, JKB, ...) into KRDict-style Korean POS labels (명사, 동사, 조사,
...) so `posToShortform` from `core/parsers.js` produces the right
shortform — that helper expects KRDict's POS vocabulary, not
mecab's tagset.

### onMessage / onChanged listeners

See [message-flows.md](message-flows.md) for the full listener
table. content.js owns the `lws-site-info` responder; the YouTube
and Netflix adapters register their own `lws-yt-popup-info` /
`lws-nx-popup-info` responders.

---

## `background.js`

Purpose: service worker. Owns the mecab WASM analyzer, the four
caches, the API key mirror, and the network-side dictionary
requests.

### Module-level state

| Binding             | Purpose                                                                                |
| ------------------- | -------------------------------------------------------------------------------------- |
| `cache`             | `createCache(adapter)` — `lookup:` namespace (surface-keyed)                           |
| `hanjaCache`        | `createCache(adapter, { namespace: 'hanja' })`                                         |
| `krdictCache`       | `createCache(adapter, { namespace: 'krdict' })` — lemma-keyed raw XML                  |
| `opendictCache`     | `createCache(adapter, { namespace: 'opendict' })` — lemma-keyed raw XML                |
| `mecabInstance`     | `Mecab` instance once initialized, otherwise null                                      |
| `mecabReadyPromise` | In-flight init promise (so concurrent first-hovers don't double-init)                  |
| `krKey`             | KRDict API key mirrored from `chrome.storage.sync`; read in the lookup hot path        |
| `odKey`             | OpenDict API key mirrored from `chrome.storage.sync`                                   |
| `settingsReady`     | Promise that resolves once the initial sync.get fills `krKey`/`odKey`                  |

### Lifecycle warmup

`chrome.runtime.onInstalled` + `chrome.runtime.onStartup` both call
`ensureMecab()` so the dict loads before the user lands on a Korean
page. `content.js` also sends a `warmup` message at init for the
case where the SW had been killed for inactivity.

### `ensureMecab()`

1. Returns cached instance if already initialized.
2. Otherwise: `init({ module_or_path: chrome.runtime.getURL('vendor/mecab-ko/mecab_ko_wasm_bg.wasm') })`.
3. `Promise.all` fetches `sys.dic.gz`, `matrix.bin.gz`,
   `entries.bin.gz` and pipes each through
   `DecompressionStream('gzip')`.
4. `Mecab.withDictBytes(trie, matrix, entries)` — the fork-only
   constructor that takes in-memory bytes (see
   [MECAB_INTEGRATION.md](MECAB_INTEGRATION.md)).

### `tokenizeSurfaceNbest(surface)`

Wraps `mecab.tokenize_nbest(surface, NBEST_N)` (`NBEST_N = 5`) and
normalizes each path's WASM class instances into plain JS objects.
Returns `Array<{ tokens, cost }>` sorted by Viterbi cost ascending.
Defensive fallback to single-path `mecab.tokenize` if
`tokenize_nbest` is missing.

### `handleLookup(surface)`

Full pipeline detailed in [lookup-pipeline.md](lookup-pipeline.md).
Key points:

- Top 5 distinct candidates (`KRDICT_PARALLEL_CAP = 5`) fired in
  parallel via `Promise.all`. Each query's full XML is kept at its
  own slot in `krXmls[]` (null on empty/error), aligned with
  `parallelQueue`.
- `extractItemWords(xml)` (regex-based, in `core/api.js`) extracts one
  `<word>` per `<item>` per query. The per-query word arrays feed
  `pickTabsAndUnrelated`, which returns `{tabs, unrelated}`.
- OpenDict fallback fires only when every KRDict query returned
  empty. OD result is treated as one additional tail query
  (`source: 'od'`) in `pickTabsAndUnrelated`.
- Proper-noun synthesis (`synthesizeProperNounEntry`) injects a
  synthetic "고유명사" tab when both `tabs` and `unrelated` are
  empty AND the 1-best token path contains an NNP.

### `handleHanjaLookup(chars)`

Much simpler: the whole Hanja string is the cache key, the API
takes the whole string at once and returns one entry per character.

### `mecab-inspect` handler

Re-uses `ensureMecab()` and a `serializeToken` helper that extracts
the four sub-fields from the raw features CSV (type at index 4,
first_pos at 5, last_pos at 6, decomp at 7). Drives the
morpheme-inspector page.

---

## `core/lemmatizer.js`

Purpose: given mecab tokens and the original surface, produce an
ordered list of dictionary-form candidates to try against KRDict.
Pure function; fully unit-tested in Node.

Public:

```js
export function lemmaCandidates(tokens, surface): string[]
export function lemmaCandidatesFromNbest(paths, surface): string[]
export function inflectStem(features): string | null
```

`lemmaCandidatesFromNbest` runs `lemmaCandidates` over each path in
cost order and merges the union with insertion-order de-dup. The
1-best candidates stay first; lower-cost alternative-parse
candidates are appended.

Key tag groups:

| Constant               | Tags                        | Used to                                                                          |
| ---------------------- | --------------------------- | -------------------------------------------------------------------------------- |
| `VERB_LEAD_TAGS`       | VV VA VX VCN VCP XSV XSA    | Build `<stem>다` per-token                                                       |
| `AMBIGUOUS_L_TAGS`     | VV VA                       | Subset of VERB_LEAD_TAGS eligible for the ambiguous-ㄹ guard; VCP/VCN/VX/XSV/XSA excluded because their lemma is fixed |
| `NOUN_LEAD_TAGS`       | NNG NNP NR NP SL SH SN      | Use morpheme as-is per-token                                                     |
| `COMPOUND_PREFIX_TAGS` | NNG NNP NNB NR NP MM XR XSN | Accumulate as prefix before an XSV/XSA — wider than NOUN_LEAD_TAGS so 한잔하다 works |
| `COMPOUND_DERIV_TAGS`  | XSV XSA                     | Consume the accumulator and emit `<prefix><stem>다`                              |
| `COMPOUND_NOUN_TAGS`   | NNG NNP NR NP XSN           | Surface-first promotion when every token is one of these                         |

Deep dive: [LEMMATIZATION.md](LEMMATIZATION.md).

---

## `core/parsers.js`

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
- `gradeToStars(grade)`, `gradeToTooltip(grade)`
- `posToEnglish(pos)`, `posToShortform(pos, lang)`,
  `posExplanation(pos, lang)`
- `isHanjaChar(ch)` — `[一-鿿㐀-䶿]` (CJK Unified + Extension A).
- `hanjaCharUrl(ch)` — builds the `hangulhanja.com/en/hanja/<encoded>` link.
- `isVerbLikePos(pos)`, `koreanVerbUrl(hangulWord, pos)`

`KrEntry` shape:
`{ word, pronunciation, grade, pos, origin, senses: [{ definition, translations: [{trans_word, trans_dfn}], examples: [string] }] }`.

`OdEntry` shape similar but translations carry `language_type`.

Example extraction handles both KRDict's
`<example><type>…</type><example>…</example></example>` wrapping
AND OpenDict's `<example_info><example>…</example></example_info>`
wrapping.

---

## `core/api.js`

Purpose: pure URL builders, response-shape sniffers, and the
group-by-word algorithm. Zero dependencies on fetch, chrome.*, or
DOM.

Exports:

- `KRDICT_ENDPOINT`, `OPENDICT_ENDPOINT`, `MIN_NUM` constants.
- `buildKrdictUrl(query, apiKey, options)` — `part=word`,
  `translated=y`, `trans_lang=1` (English), `num` clamped to
  `[10, 100]`, `sort=dict`.
- `buildOpendictUrl(query, apiKey, options)` — `req_type=xml`.
- `looksEmpty(xml)` — `true` for falsy/empty, `<error …>`,
  `<total>0</total>`, or missing `<item>`. Used by the SW to decide
  whether to fall through without DOMParser-parsing (no DOM in the
  SW).
- `extractApiError(xml)` — `{ code, message }` from a KRDict error
  envelope.
- `extractItemWords(xml)` — regex, extracts one `<word>` per
  `<item>` in document order.
- `groupByWord(words)`, `pickTabsAndUnrelated(perQueryWords)` —
  the grouping algorithm; see
  [lookup-pipeline.md](lookup-pipeline.md).

---

## `core/cache.js`

Purpose: two-tier (in-memory LRU + injected storage adapter) cache
factory. Used four times in `background.js`. Full coverage in
[storage-and-caching.md](storage-and-caching.md).

Exports:

- `createCache(storage, opts)` — `opts: { l1Limit?: 500, namespace?: 'lookup' }`.
  Returns `{ get, set, clear, l1Size }`.
- `chromeStorageAdapter(area)` — wraps `chrome.storage.local` (or
  `.sync`) into the adapter shape, handling both Promise and
  callback styles defensively.

---

## `core/grammar-glosses.js`

Purpose: hand-curated table of short English glosses for the
morphemes a learner sees over and over — particles, endings, common
verb stems. Used by the popup's morpheme-breakdown chips.

Exports:

- `morphemeGloss(form, pos)` — three-tier lookup:
  1. `FORM_POS_GLOSSES['<form>|<lead>']` — disambiguates homographs
     like `을|JKO` vs `을|ETM`, `이|JKS` vs `이|VCP`.
  2. `FORM_GLOSSES[form]` — exact-form matches.
  3. `POS_GLOSSES[lead]` — last-resort fallback.
- `isContentMorpheme(m)` — drops punctuation marks
  (`SF/SE/SS/SP/SO/SW/SY`) but keeps `SH` (Hanja), `SL`
  (Latin/foreign), `SN` (numerals).

---

## `core/site-configs.js`

Purpose: the single registry that makes the extension's video-site
behavior modular. Registers YouTube and Netflix. Fields:

- `sentenceContainer` — CSS selector used by `extractSentence`
  AND the auto-pause gate. For YouTube/Netflix, lists our own
  overlay's KO line class FIRST (`.lws-ytsubs-ko` /
  `.lws-nxsubs-ko`), then host's native containers as fallbacks.
- `findVideo()` — returns the page's main video element (or null).
- `adapter` — relative path to a content-script-side module that
  gets dynamic-imported and whose `setup()` is invoked.
- `popupModule` — relative path to a popup-side module.
  `popup.js` dynamic-imports it and calls
  `renderSection({ tab, href, container })`.
- `stylesheet` — optional CSS string. `content.js` injects it as a
  `<style id="lws-site-style">` tag at init, only when the host
  matches. Used by Netflix to promote `.player-timedtext` above the
  player-controls overlay.

Exports: `SITE_CONFIGS` (array) and `findSiteConfig(hostname)`
(exact host match or regex `cfg.match`).

---

## `core/ai-providers.js`

Registry of "Ask AI" pill targets. Two entries shipped:
`chatgpt` (`https://chatgpt.com/?q=`) and `claude`
(`https://claude.ai/new?q=`). Imported by both `content.js`
(via `chrome.runtime.getURL`) and `pages/options/options.js`
(dynamic import).
Adding a provider is one entry — the options-page dropdown is
populated from the same registry.

---

## `adapters/youtube/adapter.js`

Purpose: site adapter for YouTube. Runs in the isolated content
world. Replaces native caption rendering with a dual-line overlay.

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
| `reloadOnVideoIdChange`     | Gates the `video_id` poll's hard-reload action                                                                                          |

Public: `setup(api)` — wires up storage listeners, message listener,
navigation listeners, injects the hook, calls `activate()`. `api`
is `{ unwrap, rescan }` from content.js.

Full activate sequence + CC state machine + hard-reload-on-video_id-
change discussion: [site-adapters.md](site-adapters.md).

---

## `adapters/youtube/page-hook.js`

Purpose: runs in the page main world. Monkey-patches
`XMLHttpRequest.prototype.open` and `window.fetch` to capture every
`/api/timedtext` request the YouTube player makes, and posts the
URL + response body back to the content script via
`window.postMessage`. Also exposes a command channel for the
adapter to query the player's tracklist and trigger track loads.

Idempotent via `window.__lwsYtHookInstalled`.

Full message protocol: [message-flows.md](message-flows.md).

---

## `adapters/netflix/adapter.js`

Purpose: site adapter for Netflix. Runs in the isolated content
world. TTML parser + per-language cache (`tracksByLang`) + dual-
line overlay + kicks off the track-select dance from the page hook.

Public: `setup(api)` (same shape as YouTube). Activate sequence,
KO hard-require, per-track CC/SUBTITLES preferences, secondary
resolution: [site-adapters.md](site-adapters.md).

---

## `adapters/netflix/page-hook.js`

Purpose: runs in the page main world. Two responsibilities:

1. **Passive sniff**: monkey-patches XHR/fetch to capture every
   subtitle body (URL extension match for `.ttml`/`.dfxp`/`.vtt`/`.xml`
   PLUS body sniff for `<tt`/`WEBVTT`/`<dfxp` markers). Posts
   matched bodies as `__lwsNxCaption`.
2. **Active control**: the **track-select dance** — snapshot the
   user's selected text track, `setTextTrack(KO)`, wait for capture,
   `setTextTrack(secondary)`, wait, `setTextTrack(original)`. Drives
   Netflix to actually download the TTML for the languages we need.

Also has a dormant manifest interception path (`__lwsNxManifest`)
and two diagnostic flags (`LWS_NX_DIAG_PRIME`, `LWS_NX_DIAG_API`,
both `false` in shipped code) that gate verbose API-discovery probe
logging.

Idempotent via `window.__lwsNxHookInstalled`.

---

## `pages/popup/popup.html` / `popup.js` / `popup.css`

The toolbar action UI. Sections:

- **Per-site toggle** — shown only on `http(s):` pages. Reads the
  active tab's hostname via `resolveActiveSite()` (tabs API first,
  content-script `lws-site-info` fallback). Toggles membership in
  `disabledHosts` (`chrome.storage.local` array).
- **Adapter section** — generic shell. `loadAdapterSection()`
  resolves the active tab's hostname against `findSiteConfig(...)`
  and dynamic-imports the matched config's `popupModule`. For
  YouTube this is `adapters/youtube/popup.js`; for Netflix
  `adapters/netflix/popup.js`.
- **Links row** — left-aligned inline-SVG icons: Notepad (opens
  `pages/notepad/notepad.html` via `chrome.runtime.getURL`),
  Settings (gear),
  plus external links (GitHub, Discord) gated by `LINKS` dict.
- **Ko-fi support banner** — full-width red button below the links
  row. Gated by `LINKS.kofi`.

`popup.js` stays a settings/status shell — no Korean-text rendering
of its own.

See [extension-surfaces.md](extension-surfaces.md) for the per-site
popup modules and the options/notepad/inspector pages.

---

## `pages/options/options.html` / `options.js` / `options.css`

See [extension-surfaces.md](extension-surfaces.md).

---

## `pages/notepad/notepad.html` / `notepad.js`

See [extension-surfaces.md](extension-surfaces.md).

---

## `pages/morpheme-inspector/morpheme-inspector.html` / `.js` / `.css`

See [extension-surfaces.md](extension-surfaces.md).

---

## `core/popup-shadow.css`

The stylesheet for the in-page hover popup. Lives in
`web_accessible_resources` so it can be loaded into the shadow DOM.
Uses CSS custom properties for theming and includes a
`@media (prefers-color-scheme: dark)` block.

Sizing decisions: `min-width: 380px`,
`max-width: min(520px, calc(100vw - 16px))`, `max-height: 70vh`
with `overflow-y: auto`. `position: absolute` (not `fixed`) — the
popup scrolls with the page.

---

## `content.css`

Tiny — `.lws-word { cursor: help; border-bottom: 1px dashed ... }`
and the hover background. The popup itself is in
`core/popup-shadow.css`.

---

## `vendor/mecab-ko/`

Vendored, not an npm package. See
[MECAB_INTEGRATION.md](MECAB_INTEGRATION.md) for the fork story.
Files:

- `mecab_ko_wasm.js` — wasm-bindgen ES-module glue. Exports `init`
  and `Mecab` (the analyzer class).
- `mecab_ko_wasm.d.ts`, `mecab_ko_wasm_bg.wasm.d.ts` — TypeScript
  declarations (informational).
- `mecab_ko_wasm_bg.wasm` — ~145 KB. The analyzer with no
  dictionary baked in.
- `sys.dic.gz`, `matrix.bin.gz`, `entries.bin.gz` — gzipped output
  of `mecab-ko-dict-builder` against mecab-ko-dic 2.1.1. ~22 MB
  compressed; ~90 MB raw.

The dict files are NOT loaded eagerly at module-init time. They're
fetched and gunzipped inside `ensureMecab()`, which is called on
`onInstalled` / `onStartup` / first lookup.

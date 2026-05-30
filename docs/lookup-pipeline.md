# The lookup pipeline

How a hover becomes a populated dictionary popup. Covers
`handleLookup` in the background service worker, the mecab + n-best
candidate generation, the parallel KRDict fan-out, the group-by-word
algorithm, and the proper-noun synthesis fallback.

Related reading:
- [storage-and-caching.md](storage-and-caching.md) — the four cache
  namespaces this pipeline reads/writes
- [message-flows.md](message-flows.md) — `lookup`, `warmup`,
  `lookupHanja` RPC shapes
- [LEMMATIZATION.md](LEMMATIZATION.md) — deep dive on
  `lemmaCandidates`, the ambiguous-ㄹ guard, the surface-first rule
- [MECAB_INTEGRATION.md](MECAB_INTEGRATION.md) — the `Mecab.withDictBytes` / `tokenize_nbest` fork

---

## End-to-end: hover → popup

Files: `content.js`, `background.js`, `core/lemmatizer.js`,
`core/parsers.js`, `core/grammar-glosses.js`, `core/api.js`,
`core/cache.js`, `vendor/mecab-ko/`*.

1. Mouse enters a `.lws-word` span. `delegateEnter` →
   `onWordEnter(target)`.
2. After a 60 ms hover delay (lets the user pass over a word without
   triggering), `performLookup(target)` runs.
3. `performLookup` increments `pendingRequestId` (so a slow response
   can be discarded if the user has moved on), resets per-popup
   state (`expandedExamples`, `expandedHanja`, `relatedExpanded`,
   `expandedSectionByTab`, `activeInsightTab`, popup min-size memos),
   then renders a loading placeholder via
   `showPopup(anchor, buildLoadingNode(surface))`.

   The loading node shows the hovered word and a live status line
   that advances through pipeline stages. Status is suppressed if
   the whole lookup completes within 50 ms (cache hit — no flicker).
   Otherwise the status label updates in place via
   `setLookupStatus(key)`:

   | Stage key  | Label                       | When shown                                  |
   |------------|-----------------------------|---------------------------------------------|
   | `init`     | `Initializing…`             | MeCab WASM still loading (first lookup)     |
   | `cache`    | `Checking cache…`           | Cache read in flight (after 50 ms)          |
   | `morpheme` | `Analyzing morphemes…`      | MeCab tokenization running                  |
   | `krdict`   | `Querying KRDict…`          | KRDict network request in flight            |
   | `opendict` | `Falling back to OpenDict…` | OpenDict fallback in flight                 |
   | `render`   | `Rendering…`                | Result received, building DOM               |

   Since the pipeline runs as a single background message (no
   streaming), content-side stage advancement is optimistic: `cache`
   fires at 50 ms, `morpheme` at 200 ms, `krdict` at 500 ms — all
   timers are cancelled the moment the response arrives.

4. `chrome.runtime.sendMessage({ type: 'lookup', surface })` →
   `background.js` `handleLookup(surface)`:

   1. **Cache hit?** Return cached `LookupResponse` from the
      `lookup:` namespace. Cache includes the mecab tokens AND the
      pre-computed `{tabs, unrelated}` grouping plan AND the raw
      `krXmls[]` / `odXml` so re-renders don't re-walk anything.
   2. **`tokenizeSurfaceNbest(surface)`** — calls
      `mecab.tokenize_nbest(surface, NBEST_N)` where `NBEST_N = 5`.
      Returns an array of `{ tokens, cost }` paths sorted by Viterbi
      cost ascending. The 1-best path is `paths[0].tokens` and that's
      what the popup's decomposition row renders. The n-best union
      feeds candidate generation. Defensive fallback: if
      `tokenize_nbest` is missing on the WASM bundle, falls through
      to single-path `mecab.tokenize`; if mecab itself fails,
      returns `[]` and the lemmatizer falls back to surface-only.
   3. **`lemmaCandidatesFromNbest(paths, surface)`** runs
      `lemmaCandidates` over each path in cost order and merges the
      union with insertion-order de-dup. The 1-best candidates stay
      first; alternative-parse candidates are appended after. See
      [LEMMATIZATION.md](LEMMATIZATION.md) for the rules.
   4. **Read API keys** from the `krKey` / `odKey` in-SW mirrors
      (populated once via `ensureSettings()` and kept current via
      `storage.onChanged`). No `chrome.storage.sync.get` per lookup.
      If `krKey` is empty, return `{ error: 'NO_API_KEY' }`.
   5. **Fan out top 5 candidates in parallel.** Take the top 5
      distinct candidates (`KRDICT_PARALLEL_CAP = 5`) and fire
      `Promise.all` of `fetchKrdictCached(q, key)`. Each call
      consults the `krdict:` cache (keyed by exact lemma string)
      before hitting the network; two surfaces that lemmatize to the
      same lemma share the cached XML. The full result list per
      query is kept in `krXmls[i]` (null for empty/error), aligned
      with `parallelQueue`, so the grouping algorithm can walk each
      query's items in order.
   6. **OpenDict fallback.** If `odKey` is set AND every KRDict query
      returned empty, try OpenDict via `fetchOpendictCached` in
      candidate order until one returns content. The `opendict:`
      cache is consulted first.
   7. **Per-query word extraction.** For each non-empty XML,
      `extractItemWords(xml)` (regex, in `core/api.js` — no DOMParser
      in the service worker) reads the `<word>` of each `<item>` in
      document order. That per-query word list drives
      `pickTabsAndUnrelated`.
   8. **Group into `{tabs, unrelated}`.** See §"Grouping algorithm"
      below. Each section in the plan is
      `{source: 'kr' | 'od', queryIdx, itemIdx}` so the content
      script can locate the matching parsed entry without re-grouping.
   9. **Per-NNP-run synthesis.** `extractNnpRuns` walks the 1-best
      token path and collects *runs* of consecutive `NNP`-tagged
      tokens (e.g. `강남(NNP)+구(NNP)` → one run `"강남구"`; a
      particle between two proper nouns produces two separate runs).
      For each run, if no existing tab's `word` already matches that
      run's surface, `synthesizeMissingNnpRuns` prepends a synthetic
      tab with `source: 'synthetic-nnp'`, `pos: '고유명사'`, and a
      canned definition. Multiple missing runs each get their own
      synthetic tab, prepended in surface order before any real dict
      tabs. Runs already covered by a real dict result produce no
      synthetic tab. If there are no NNP tokens at all, this step is
      a no-op. Synthetic results are cached in `lookup:<surface>` like
      any real result.
   10. **Build the response object** — `surface`, `lemma`,
       `queryUsed`, `queriesUsed`, `candidates`, `tokens`,
       `krQueries`, `krXmls[]`, `odXml`, `odQuery`, `tabs`,
       `unrelated`, `cachedAt`. Persist to `lookup:` cache and
       return.

5. Back in `content.js`, the response arrives. If
   `requestId !== pendingRequestId`, the user has moved on; bail.
6. Handle error responses (`NO_API_KEY`, `FETCH_FAILED`, other) with
   `buildErrorNode`.
7. On success: store `lastPayload` and `lastSentence`, render
   `buildResultNode(payload, { sentence })` and show via `showPopup`.
8. `extractSentence(anchor)` walks up from the hovered word (using
   the site's `sentenceContainer` selector if set, else the default
   block-level tag set) to find the surrounding sentence, then
   truncates with ellipses if longer than 80 chars on either side of
   the hit.

---

## Click path

`onWordClick` is mostly identical to hover but:

- Skips the 60 ms hover delay — `performLookup` runs immediately.
- Useful for touch and for sites where mouseenter is unreliable
  (custom event interceptors, overlays).
- Does NOT call `preventDefault()` or `stopPropagation()`. If the
  word happens to be wrapped in an `<a>` / `<button>` / other
  interactive element (linked subtitles, headline links), the
  user's click still triggers that element's behavior — the lookup
  runs alongside, not instead.
- `.lws-word` and `.lws-gap` both set `user-select: text` so
  drag-selecting across wrapped words — including the spaces between
  them — works even when the host page sets `user-select: none` on
  the surrounding container. (Bare text nodes cannot carry
  `user-select`, which is why gaps are wrapped in a span rather than
  emitted as raw text nodes.)

---

## Sentence-word click (re-look-up without moving the popup)

The sentence band at the top of the popup is rendered by
`buildSentenceNode` → `appendSentenceWords`, which splits the
before/after text into 어절 chunks (whitespace-separated). Every
chunk containing a Hangul "core" is wrapped in a
`.lws-sentence-word` span with its own click handler.

1. User clicks one of those spans. `onSentenceWordClick(surface,
   fullText, offset)` runs.
2. A new `{before, word, after}` sentence is built — same `fullText`,
   but with the clicked chunk as the hit.
3. `performLookup(null, { surface, sentence: newSentence })` runs.
   `target` is null, so `anchor = activeWordEl` (kept from the
   original hover) and `reposition = false` — the popup stays
   exactly where it is.
4. `extractSentence` is bypassed (the `opts.sentence` is used
   directly), so the popup keeps the same sentence band as the user
   reads through it one 어절 at a time.

---

## Grouping algorithm (`pickTabsAndUnrelated`)

`background.js` runs the top-5 lemma candidates as parallel KRDict
queries, then assembles the response into `{tabs, unrelated}` using
`pickTabsAndUnrelated` (in `core/api.js`, pure, fully unit-tested). The
content script renders one tab per `tabs[i].word`, each tab holding
1+ sections (= one KRDict entry per section).

### Why grouping by `word`

KRDict often returns multiple entries for the same headword —
different POS (살 the noun, 살 the bound noun) or different sense
rows on the same POS (살 noun definition #1, #2). Pre-grouping,
those all became separate tabs, fragmenting the user's attention.
Post-grouping, one tab "살" holds all three; the user clicks once
and sees every interpretation stacked, with the first expanded and
the rest one click away.

### The five-step merge

Input: per-query `<word>` lists (extracted in document order by
`extractItemWords`). Output: `{tabs, unrelated}` where each section
is `{source: 'kr' | 'od', queryIdx, itemIdx}`.

1. **Per-query result list**: already done by the caller — one list
   of `<word>` strings per query, indexed by `queryIdx`.
2. **Group by `word`**: `groupByWord(words)` collapses one query's
   flat list into ordered, deduped `{word, indices[]}` buckets,
   preserving first-occurrence order. Same `word` from different
   `<item>` blocks goes into the same group (different POS / sense
   variants).
3. **Pick primary tabs in query order**: walk queries in order. For
   each query, pick its FIRST not-yet-tabbed group as a new tab. If
   the query's first group's word was already picked from an earlier
   query, advance to the NEXT group from that query. A single query
   can contribute multiple tabs when earlier groups are duplicates.
4. **Across-query consolidation**: after the tab set is fixed, walk
   every query's every group again. If a group's word matches an
   existing tab, fold its items into that tab's `sections[]`. This
   is what keeps query 살's `살다(v.)` row from becoming a duplicate
   tab when query 살다 already produced one.
5. **Unrelated bucket**: every group whose word is neither a primary
   tab nor folded becomes an `unrelated[]` entry, also grouped by
   word, in query-then-item order.

### Worked example — `살이었지`

Mecab top-5 → `[살, 살다, 살이, 살이었지, 사다]`. KRDict returns:

| Query     | `<word>` per item (in order)        |
| --------- | ----------------------------------- |
| 살        | 살, 살, 살, 살-, 살다                |
| 살다      | 살다                                 |
| 살이      | (empty)                             |
| 살이었지   | (empty)                             |
| 사다      | 사다                                 |

After grouping:

- **Tab 살** ← query 살 picks `살` (3 sections: items 0, 1, 2 — three
  POS/sense variants).
- **Tab 살다** ← query 살다 picks `살다`; step 4 folds query 살's
  `살다` item (idx 4) into the same tab.
  Sections: `[{kr,1,0}, {kr,0,4}]`.
- (queries 살이 / 살이었지 contribute nothing — empty)
- **Tab 사다** ← query 사다 picks `사다`.
- **Unrelated 살-** ← left over from query 살.

Net rendering: 3 visible tabs + 1 unrelated entry. Tab `살` opens
with section 0 expanded; sections 1 and 2 are collapsed. Only one
section can be expanded at a time per tab — clicking a collapsed
section header switches to it; clicking the open one closes it
(`expandedSectionByTab` is a `Map<tabId, openIdx | -1>`).

### OpenDict integration

When every KRDict query returned empty, `handleLookup` fires
OpenDict sequentially over `candidates` until one returns content.
That one result is treated as a single additional tail query
(`source: 'od'`) inside `pickTabsAndUnrelated`. Typical outcome:
`tabs.length === 1` with one section. The rest of the pipeline
(content rendering) is source-agnostic — each section just carries
its `source` so the OD "experimental" styling can hook in if needed.

### The unrelated bucket — two-stage reveal

`unrelated[]` is hidden by default behind the `+N related ▾` pill in
the primary tab strip. KRDict's broad-match list is often noisy
(compound nouns containing the queried word, derived forms, etc.)
and we don't want to push the primary tabs offscreen.

The reveal is two-stage:

1. **Click the pill** → toggles `relatedExpanded` and renders a
   second row of pill buttons (`buildRelatedTabRow`) directly below
   the primary strip — one pill per unrelated word. Arrow flips to
   ▴.
2. **Click a related pill** → makes it the active tab
   (`activeTab.source === 'related'`) and its content fills the main
   body via `buildTabBodyNode`, the same path as primary tabs.

Collapsing the row while a related tab is active reverts `activeTab`
to primary tab 0. Tab-count badges show on multi-section primary
tabs so the user can see at a glance which tabs hold more than one
entry.

---

## Render-time entry parsing

`buildResultNode` doesn't pre-parse every entry. It walks
`payload.tabs` and materializes each section on demand:

```js
function entryForSection(payload, section) {
  if (!payload.__entryCache) payload.__entryCache = { kr: new Map(), od: null };
  // ... parses the matching XML the first time a section
  // from a given query is requested; memoizes on the payload.
}
```

The cache is `payload.__entryCache = { kr: Map<queryIdx, entries[]>, od: entries[] | null }`. Re-renders (tab switch, EN/KR toggle,
section expand) reuse the parsed arrays without re-walking the XML.
This replaced the earlier `__parsedGroups` memoization scheme that
parsed all groups up front.

---

## Hanja meanings (click-to-expand panel)

Separate RPC, separate cache (`hanja:` namespace).

1. The dictionary entry's `origin` field (e.g. `豫約 (예약)`)
   becomes a button via `makeHanjaChip` — only when at least one
   character passes `isHanjaChar` (CJK Unified or Extension A).
2. User clicks the chip. `expandedHanja` set toggles;
   `rerenderActivePopup`.
3. `buildHanjaMeaningsNode` mounts a panel below the meta row. On
   the first expansion for a given Hanja string, it sends
   `{ type: 'lookupHanja', chars }` to `background.js`.
4. `handleHanjaLookup(chars)` checks the `hanja:` cache, then
   `fetch('https://hangulhanja.com/api/search?q=...&mode=hanzi&locale=en')`,
   normalizes the JSON response to `[{character, sino, summary}]`,
   caches it, and returns it.
5. The panel renders one row per character. The character itself is
   a link to `https://hangulhanja.com/en/hanja/<encoded char>` for
   the full per-character breakdown page.
6. A session-only `hanjaSession` Map in `content.js` short-circuits
   subsequent rerenders of the same popup so the panel doesn't flash
   "Loading…" again when the user toggles a tab.

---

## EN / KR language toggle

1. User clicks the `[영어] [한국어]` toggle in the popup strip.
2. `onToggleLang(lang)` flips `defLang`, writes to
   `chrome.storage.sync` (so other tabs and a reopened popup also
   pick up the change), then `rerenderActivePopup()`.
3. `rerenderActivePopup` re-renders from the cached `lastPayload` +
   `lastSentence` with `reposition: false` — no DOM-derived sentence
   re-extraction (which would clobber a sentence-word-click rebuild),
   no popup move.

---

## Warmup strategy

The mecab dict is ~22 MB compressed, ~90 MB raw, and the dictionary
fetch+gunzip takes ~1–2 s on a cold service worker. To keep the
first hover snappy:

- **`onInstalled` / `onStartup`** — `background.js` calls
  `ensureMecab()` from both lifecycle listeners. The dict loads
  while the user is still poking around their browser, before they
  even land on a Korean page.
- **`content.js` init sends `warmup`** — even if the SW was killed
  for inactivity, the first content-script init wakes it and primes
  mecab + settings before the user's first hover.
- **`krKey` / `odKey` in-SW mirror** — `ensureSettings()` populates
  them once and `storage.onChanged` keeps them current.
  `handleLookup` reads the mirror, not `chrome.storage.sync`.
- **Payload `__entryCache` memo** — see "Render-time entry parsing"
  above.

If you're tempted to move the dict load even earlier (e.g. eager
top-level await in the SW), don't — the MV3 SW lifecycle is hostile
to long startup. The SW will be killed by the browser for "taking
too long to start" on slow machines.

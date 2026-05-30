# Development guide

`learnwithsoju` is a Manifest V3 browser extension that turns any
webpage with Korean text into a hover dictionary. It runs entirely
client-side (KRDict + OpenDict + hangulhanja.com are the only
network calls, all with user-supplied keys), uses a vendored fork of
`mecab-ko-wasm` for morphological analysis, and has no build step —
the contents of `extension/` are what get loaded into the browser.
On YouTube and Netflix the extension also replaces the host's native
captions with a dual-language overlay (Korean + secondary language).

This file is the index. Each topic below links to a focused doc; if
you only need a getting-started recipe, read
[CONTRIBUTING.md](../CONTRIBUTING.md) instead.

---

## Where to find what

| Topic                                  | File                                                         |
| -------------------------------------- | ------------------------------------------------------------ |
| High-level architecture                | [architecture-overview.md](architecture-overview.md)         |
| How a hover lookup works               | [lookup-pipeline.md](lookup-pipeline.md)                     |
| Lemmatization heuristics               | [LEMMATIZATION.md](LEMMATIZATION.md)                         |
| What every file does                   | [file-walkthroughs.md](file-walkthroughs.md)                 |
| Caching layers + storage keys          | [storage-and-caching.md](storage-and-caching.md)             |
| Messages between components            | [message-flows.md](message-flows.md)                         |
| YouTube + Netflix dual-subs internals  | [site-adapters.md](site-adapters.md)                         |
| Adding support for a new streaming site | [adding-a-site-adapter.md](adding-a-site-adapter.md)        |
| Adding a lemmatizer guard              | [lemmatizer-guards.md](lemmatizer-guards.md)                 |
| Popup / options / notepad / inspector  | [extension-surfaces.md](extension-surfaces.md)               |
| Mecab integration (fork story)         | [MECAB_INTEGRATION.md](MECAB_INTEGRATION.md)                 |
| Third-party components                 | [THIRD-PARTY.md](THIRD-PARTY.md)                             |
| Testing + dev workflow + gotchas       | [testing-and-development.md](testing-and-development.md)     |
| Chrome Web Store + Mozilla AMO copy   | [store-listings/](store-listings/)                           |

---

## Recent commits worth reading

If you're catching up after time away, these are the big landings to
skim first:

- `d958287` — per-NNP-run synthesis: `extractNnpRuns` collects runs of
  consecutive NNP tokens; for each run not already covered by a real dict
  tab, a synthetic "고유명사" tab is prepended at position 0. Replaces the
  old all-empty gate so a proper noun gets its synthetic tab even when other
  lemma queries returned real results. (see [lookup-pipeline.md](lookup-pipeline.md))
- `4bba790` — popup two-stage related reveal + exclusive section
  expand per tab; tab-count badges. (see
  [lookup-pipeline.md](lookup-pipeline.md))
- `fc22cba` — options cache UI: split Clear Cache into 3 per-
  namespace buttons with live `(~N)` entry counts. (see
  [storage-and-caching.md](storage-and-caching.md))
- `7f92697` — YouTube `waitForPlaying` gate before tracklist
  capture; eliminates the race where the player's caption
  infrastructure isn't ready yet on slow-loading pages. (see
  [site-adapters.md](site-adapters.md))
- `6d66c3a` — top-5 candidate fan-out + group-by-word tabs with
  per-section pills. (see [lookup-pipeline.md](lookup-pipeline.md))
- `6a1809b` — per-lemma `krdict:` / `opendict:` dict-response
  caches; surfaces that lemmatize to the same lemma share the cached
  XML. (see [storage-and-caching.md](storage-and-caching.md))
- `3940175` — perf: warm mecab on SW init (`onInstalled` /
  `onStartup`) + in-SW API key mirror + memoize parsed XML on the
  payload. (see [lookup-pipeline.md](lookup-pipeline.md))
- `5bb9e2d` — lemmatizer: ambiguous-ㄹ guard scoped to VV/VA so the
  copula (VCP) isn't mis-fired. (see
  [LEMMATIZATION.md](LEMMATIZATION.md))
- `3420542` — mecab `tokenize_nbest`: n-best paths broaden the
  lemma candidate pool. `NBEST_N = 5`. (see
  [MECAB_INTEGRATION.md](MECAB_INTEGRATION.md))
- `e4bc2fa` — n-best cost-delta filter: `filterPathsByCost()` in
  `background.js` drops paths whose additive cost delta from the
  1-best exceeds `COST_DELTA_MAX = 5000` (~10^21× less probable)
  before candidate derivation. Diagnostic log when paths are dropped.
  (see [lookup-pipeline.md](lookup-pipeline.md))
- `602cb29` — morpheme inspector page: tokenize Korean text + show
  every mecab field. Linked from options → Advanced. (see
  [extension-surfaces.md](extension-surfaces.md))
- `fad17b5` — YouTube hard reload on `video_id` change + fail-open
  CC visibility. Replaces the earlier graceful SPA teardown that
  kept losing races to YouTube's React reconciler. (see
  [site-adapters.md](site-adapters.md))
- `9a495c8` — Netflix auto-prime via track-select dance: snapshot
  the user's selected track, `setTextTrack` KO, wait for the TTML
  body to land, `setTextTrack` secondary, wait, restore. (see
  [site-adapters.md](site-adapters.md))

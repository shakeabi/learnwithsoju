# Development guide

`learnwithsoju` is a Manifest V3 browser extension that turns any
webpage with Korean text into a hover dictionary. It runs entirely
client-side (KRDict + OpenDict + hangulhanja.com are the only
network calls, all with user-supplied keys), uses a vendored fork of
`mecab-ko-wasm` for morphological analysis. The contents of
`extension/` are what get loaded into the browser; everything under
`extension/` (background.js, content.js, adapters, vendor/) is hand-
written JS with no transpile step. The 4 UI pages and the in-page
hover popup are mid-migration from vanilla JS to Svelte 5 +
TypeScript on the `svelte-rewrite` branch — when a surface migrates,
its source moves under `src/` and Vite emits the built bundle back
into `extension/<surface>/main.js`. The Vite build (`npm run build`)
is a no-op on `main`; the distribution zips are now built by
`npm run package` (`npm run build` / `build:chrome` / `build:firefox`
on `main` were renamed when Vite took over the `build` script name).
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
| Firefox build + AMO submission         | [firefox-build.md](firefox-build.md)                         |

---

## Build (Svelte / Vite)

The extension's UI (4 pages and the in-page overlay) is built from
Svelte + TypeScript sources under `src/` and emitted into `extension/`.
Vendor JS in `extension/` (background.js, content.js, adapters, mecab-ko)
is plain JS and untouched by the build.

### Scripts

| Script | Purpose |
|---|---|
| `npm run build` | One-shot Vite build, emits `extension/<surface>/main.js` |
| `npm run dev` | Vite build in `--watch` mode (rebuilds on source change) |
| `npm test` | Node test harness — covers plain-JS code in `extension/` |
| `npm run test:ui` | Vitest — covers Svelte components and `src/lib` |
| `npm run package:chrome` | Zip extension/ for Chrome Web Store submission |
| `npm run package:firefox` | Zip extension/ for AMO submission |
| `npm run package` | Both store zips |

### Source layout

```
src/
├── types/        Shared TS types (message contracts, settings schema, overlay payload)
├── lib/          Reusable modules — typed message wrappers, settings store, cache helpers
│   └── styles/   Shared page-shell tokens (CSS variables + base form styles)
├── pages/        One subfolder per extension page (options, notepad, etc.)
└── overlay/      In-page shadow-DOM lookup popup
```

### Build output

Bundles land at:

- `extension/pages/<surface>/main.js` + `main.css` for the 4 pages
- `extension/overlay/main.js` + `main.css` for the in-page overlay
- `extension/shared/<module>-<hash>.js` — shared modules (Svelte
  runtime via `disclose-version-<hash>.js`, plus other modules like
  `messages-<hash>.js` once enough pages import them) auto-extracted
  by Rollup once 2+ entries share them; each page's main.js imports
  them relatively (`../../shared/...`). When the hash changes, `git rm`
  the old file and commit the new one so exactly one of each remains.
  These are listed in `manifest.json` `web_accessible_resources` as
  `shared/*.js` (wildcard so hash rotations don't require manifest
  edits) — the overlay bundle is dynamic-imported from the content
  script, so Chrome must be able to fetch its shared-chunk imports
  from any page origin.

These files are committed to git so the extension stays loadable from
`extension/` without a build step. After editing any `src/` file, run
`npm run build` (or `npm run dev`) and commit both the source change
and the regenerated bundle.

### CSS convention: `@import` page-shell.css from tokens.css

Each page's `src/pages/<surface>/styles/tokens.css` should pull in the
shared shell via `@import '$lib/styles/page-shell.css';` rather than
having `main.ts` do `import '$lib/styles/page-shell.css'`. Why: with
2+ entries doing the JS-side import, Vite dedups page-shell.css into
a shared CSS asset whose name (`disclose-version.css`) lands at the
extension root with no `<link>` referencing it — the pages render
unstyled. Keeping the dependency at the CSS layer lets Vite inline
the shell into each entry's `main.css` standalone.

**Exception:** the toolbar popup (`src/pages/popup/`) is a 260px-wide
fixed-size panel and deliberately does NOT import `page-shell.css`.
Its `styles/tokens.css` is fully self-contained (own palette, own
`body { width: 260px }`, own `[hidden] { display: none !important }`
override).

---

## Recent commits worth reading

If you're catching up after time away, these are the big landings to
skim first:

- `df2d07a` — overlay full tree (commit 6b of the Svelte migration):
  replaces the 6a skeleton with the 8-component overlay tree under
  `src/overlay/` (App + SentenceBand, MorphemeBreakdown, TabStrip,
  DictionaryTab, EntrySection + AskAiPanel/Footer stubs;
  RelatedPills folded into TabStrip). App.svelte owns the per-payload
  `$state` for the 4 invariants — tab switching, exclusive
  expand-within-tab, two-stage related reveal, and entry-identity
  dedup (preserved from f8afd99 via `lib/entries.ts`'s
  `materializeGroup`). `extension/core/popup-shadow.css` (856L)
  deleted; tokens moved into `src/overlay/styles/tokens.css` (and
  load/error frame chrome alongside), per-component styling moved
  into scoped `<style>` blocks. `web_accessible_resources` drops
  the deleted CSS entry. content.js's storage.onChanged handlers now
  patch `window.__lwsOverlay.update({defLang, secondaryLang,
  askAi*})` so live setting changes reflect in an active popup
  without a re-fetch. `pauseVideoIfApplicable` now receives the
  active anchor again (Task 6 had passed null, which made the
  caption-container guard fall through and auto-paused on any
  Korean-word hover anywhere on a video page). The Task-6-staged
  symbols (`POPUP_ID`, `lastPayload`, `lastSentence`, the pin
  subsystem, `positionPopup`) were unused after 6a and have been
  removed; the overlay component owns positioning via
  `lib/position.ts`. (see [extension-surfaces.md](extension-surfaces.md))
- `ec9f91c` — overlay infra (commit 6a of the Svelte migration):
  ~1000 lines of imperative DOM construction deleted from
  `extension/content.js` (sentence band, morpheme breakdown, insights
  tab, tab strip, dictionary entry builders, related-pills, Hanja
  meanings, chip helpers). `ensurePopup()` shrinks to creating the
  shadow host + a single `#lws-overlay-root` mount point, plus a
  `<link rel="stylesheet" href="overlay/main.css">` injected directly
  into the shadow root (shadow roots don't inherit page styles). A new
  Svelte `src/overlay/App.svelte` (skeleton in 6a; full tree in 6b
  above) mounts into that root and registers
  `window.__lwsOverlay = { show(frame), hide(), update(patch) }`.
  content.js's `showPopup` becomes a thin proxy: dynamic-imports
  `chrome.runtime.getURL('overlay/main.js')` once (idempotent
  `loadOverlayBundle()`), then forwards a typed `OverlayFrame`
  (`{kind: 'loading'|'error'|'payload'}`) over the bridge.
  `computeAnchorRect()` snapshots the anchor in document coords so
  the overlay can position without seeing the DOM node. Realm note:
  MV3 isolated worlds share `window` per-extension, so content.js and
  the WAR-loaded overlay bundle see the same global. (see
  [extension-surfaces.md](extension-surfaces.md))
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

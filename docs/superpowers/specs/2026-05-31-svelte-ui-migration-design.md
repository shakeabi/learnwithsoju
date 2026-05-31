---
title: learnwithsoju UI Migration to Svelte + TypeScript
date: 2026-05-31
status: Approved, ready for implementation planning
branch_planned: svelte-rewrite
---

# learnwithsoju UI Migration to Svelte + TypeScript

## Goal

Migrate the extension's UI layer — 4 pages (popup, options, notepad, morpheme-inspector) plus the in-page shadow-DOM lookup popup currently constructed imperatively in `extension/content.js` — from vanilla JS to Svelte 5 + TypeScript. The driver is dynamic UI maintainability: showing new dynamic data in the popup today means hand-writing imperative DOM construction. Component-based reactivity removes that cost.

## Scope

### In scope

- `extension/pages/popup/` (toolbar popup, 39L HTML + 209L JS + 217L CSS today)
- `extension/pages/options/` (171L HTML + 346L JS + 279L CSS)
- `extension/pages/notepad/` (60L HTML + 21L JS)
- `extension/pages/morpheme-inspector/` (25L HTML + 175L JS + 136L CSS)
- The in-page shadow-DOM popup rendered by `extension/content.js` lines 663–1100+ (~1000+ lines of DOM construction); the bridge layer of content.js stays
- `extension/core/popup-shadow.css` (856L) gets distributed across Svelte components

### Out of scope (stay plain JS, untouched)

- `extension/background.js` (service worker, mecab + lookup pipeline)
- `extension/content.js` bridge: event routing, mouseenter/leave, selection handling, video pause/resume, storage listeners (~900 lines after DOM construction is removed)
- `extension/adapters/youtube/` and `extension/adapters/netflix/` (adapter.js, page-hook.js, popup.js)
- `extension/vendor/mecab-ko/` (WASM glue)
- `extension/core/api.js`, `extension/core/cache.js`, `extension/core/lemmatizer.js`, `extension/core/site-configs.js`, `extension/core/ai-providers.js`, `extension/core/parsers.js`, `extension/core/grammar-glosses.js`
- DEVELOPMENT.md restructure beyond per-commit updates
- New features — like-for-like rewrite only

## Decisions

### 1. Migration strategy: incremental shipping, single branch `svelte-rewrite`, separate commits per surface

Each migration is its own commit; the user reviews the full arc at the end.

### 2. Build setup: hybrid Vite

Vanilla Vite with `@sveltejs/vite-plugin-svelte`. Manifest stays hand-edited at `extension/manifest.json`. Vite emits Svelte bundles into `extension/pages/<surface>/main.js` and `extension/overlay/main.js`. Plain JS files in `extension/` are untouched and have no knowledge of the build. `npm run build` is one-shot; `npm run dev` is `vite build --watch`. Build output is committed (preserves load-from-`extension/` workflow, makes diffs informative at review).

**Rejected:** `@crxjs/vite-plugin` (would force all of `extension/` under `src/`, restructuring files we're explicitly not rewriting).

### 3. Framework: Svelte 5 with runes

`$state` / `$derived` / `$effect` make the overlay's tab/expand state machine more legible than Svelte 4 stores. Fresh project = no migration cost. Better TS inference. Long-term support.

### 4. Language: TypeScript for new Svelte code; plain-JS files untouched (no JSDoc retrofit)

TS code can call into plain JS freely; the boundary is effectively `any` and we shape data at use sites. Types live in `src/types/` only because it's convenient to have one place for shared shapes consumed by multiple components.

### 5. Type boundary at message-passing edges: typed wrappers (option A)

`src/lib/messages.ts` exposes typed functions like `lookup(req)`, `mecabInspect(text)`, `cacheCounts()`, `clearCache(target)`, `lookupHanja(...)`. Components import and call these — no raw `chrome.runtime.sendMessage` in component code. Plain-JS handlers in `background.js` stay unchanged; if contracts drift, runtime catches it.

### 6. Shadow-root mount mechanism: window global (option A)

The overlay's `src/overlay/main.ts` registers `window.__lwsOverlay = { show(payload), hide(), update(patch) }`. `content.js` calls these directly. Content-script realm is isolated from page JS, so no name collision. Direct method call is the cleanest API for the 4 imperative actions content.js needs.

**Rejected:**
- CustomEvent on shadow host (weaker typing, indirection with no benefit since only one consumer)
- Svelte custom-element mode (lifecycle quirks cost more than they save)
- Making content.js a Vite entry (contradicts UI-only scope)

### 7. CSS strategy: hybrid, scoped-by-default

Per-component `<style>` blocks for component-specific styles (chip layout, tab pills, entry cards). Per-surface global stylesheet for theme tokens (CSS variables), shadow-root reset, dark mode media query (`src/<surface>/styles/tokens.css`, imported once at top of `App.svelte` via `<style global>` or a CSS import). Shared page-level tokens (button styles, form inputs, headers used across the 4 pages) in `src/lib/styles/page-shell.css`. Existing CSS variables (`--bg`, `--fg`, `--border`, etc.) port over as-is. No CSS-in-JS, no Tailwind, no extra PostCSS plugins.

## Architecture

### Source (new)

```
src/
├── types/                          (shared TS types — message shapes, lookup payloads)
├── lib/
│   ├── messages.ts                 (typed wrappers around chrome.runtime.sendMessage)
│   ├── storage.ts                  (Svelte 5 $state-backed settings store wrapping chrome.storage.sync)
│   ├── cache.ts                    (cacheCounts/clearCache wrappers)
│   └── styles/page-shell.css       (shared button/form/header tokens for the 4 pages)
├── pages/
│   ├── popup/main.ts
│   ├── options/main.ts
│   ├── notepad/main.ts
│   └── morpheme-inspector/main.ts
└── overlay/main.ts                 (in-page shadow popup, mounted by content.js bridge)
```

Per-surface `styles/tokens.css` files (e.g. `src/pages/options/styles/tokens.css`, `src/overlay/styles/tokens.css`) are not pre-shown here — they land in the commit that introduces each surface (see commit sequence).

### Output (existing layout preserved)

- `extension/pages/<surface>/main.js` (Svelte bundle)
- `extension/pages/<surface>/<surface>.html` (existing HTML, `<script>` rewritten + body becomes mount-point div)
- `extension/overlay/main.js` (overlay bundle, new dir)
- `manifest.json` hand-edited; new `web_accessible_resources` entry for `overlay/main.js`
- Plain JS files in `extension/` completely untouched

### Build

- `npm run build` — one-shot Vite build, emits bundles into the paths above.
- `npm run dev` — `vite build --watch`.
- Build output is committed to git.

## Component breakdown per surface

Component names are indicative; finalized during implementation.

### popup/ (toolbar)

- `App.svelte`
- `SiteToggleRow.svelte`
- `AdapterStatus.svelte`
- `LinkRow.svelte`
- `KofiBanner.svelte`

Stores: `activeSite` (from `chrome.tabs.query`), `disabledSites` (from `chrome.storage.sync`).

### options/

- `App.svelte`
- `ApiKeySection.svelte` (KRDict + OpenDict + Ask-AI keys + test buttons)
- `SubtitleSection.svelte` (YouTube + Netflix dual-subs toggles, secondary lang dropdown)
- `AdvancedSection.svelte` (AI provider select, Ask-AI prompt template, morpheme inspector link)
- `CacheSection.svelte` (3 clear buttons + live counts via `cacheCounts` message)

Store: `settings` (wraps `chrome.storage.sync`, two-way reactive).

### notepad/

- `App.svelte` (textarea state, 150ms debounce)
- `HoverableTarget.svelte` (live-updating div the content-script word-wrapper scans)

### morpheme-inspector/

- `App.svelte` (textarea + debounced inspect call)
- `SinglePathTable.svelte`
- `NbestTable.svelte` (top-5 paths with cost deltas)
- `CandidateTable.svelte`

### overlay/ (in-page popup)

- `App.svelte` (root, mounted into shadow root, subscribes to bridge messages, owns popup state)
- `SentenceBand.svelte`
- `MorphemeBreakdown.svelte`
- `TabStrip.svelte`
- `DictionaryTab.svelte`
- `EntrySection.svelte` (exclusive expand-within-tab)
- `RelatedPills.svelte` (two-stage reveal)
- `AskAiPanel.svelte`
- `Footer.svelte`

State (runes):
- `popupState` (`visible`, `mode`)
- `lookupPayload` (`$state` from bridge)
- `activeTabIdx` + `expandedEntryId` (`$state` with exclusive-expand invariant)

### Shared (src/lib/)

- `messages.ts` — typed `sendMessage` wrappers, one per handler
- `storage.ts` — reactive settings store
- `cache.ts` — `cacheCounts` / `clearCache` wrappers

**Total: ~25 components. Smallest 30–80 lines; overlay `App.svelte` largest at ~150–200 lines orchestrating state.**

## Data flow

### Pages → background.js

Components call typed wrappers in `src/lib/messages.ts`, which wrap `chrome.runtime.sendMessage`. Returns typed `Promise`. Background handlers (in plain JS) unchanged.

### Pages ↔ chrome.storage.sync

Components import `settings` store from `src/lib/storage.ts`, which is Svelte 5 `$state`-backed and hydrates from `chrome.storage.sync` + subscribes to `chrome.storage.onChanged`. Two-way reactive.

### content.js bridge → overlay

Overlay registers `window.__lwsOverlay = { show, hide, update }` on script load. `content.js` calls these when word hover/selection events fire (after fetching lookup data from background). Overlay component owns all rendering, popup state, and tab/expand state machine; `content.js` handles event routing, mouseenter/leave hide timer, video pause/resume, selection handling, storage-change listeners.

## Testing approach

- **Existing 6 `node --test` files untouched** (parsers, lemmatizer, api, grammar-glosses, cache, nnp-synthesis). They cover plain-JS code the migration doesn't touch.
- **Vitest + @testing-library/svelte added in commit 1**, used selectively:
  - Overlay `App.svelte` orchestration: tab switching, exclusive-expand invariant, two-stage related reveal, dedup rendering (the f8afd99 invariant).
  - Options settings store reactivity: writes fire `chrome.storage.sync` writes; `onChanged` updates the store.
  - Skip simple components (banners, link rows, simple tables) — visual smoke test is fine.
- **Smoke tests (manual)** per commit: load extension, exercise migrated surface, confirm no console errors and live-data path works.

## Commit sequence

| # | Commit | What lands | Verify |
|---|---|---|---|
| 1 | Build infrastructure | `package.json` deps (svelte 5, vite, typescript, `@sveltejs/vite-plugin-svelte`, vitest, `@testing-library/svelte`), `vite.config.ts` (multi-entry), `tsconfig.json`, `src/types/` + `src/lib/` skeletons, `src/lib/messages.ts` wrappers, `src/lib/storage.ts` settings store, `src/lib/styles/page-shell.css`, npm scripts | `npm run build` emits nothing user-facing; `npm test` 6 files still passing; extension still loads identically |
| 2 | Pilot: options/ | `src/pages/options/` (5 components), `tokens.css`; rewritten `options.html`; deleted `options.js` / `options.css`; DEVELOPMENT.md updated | Every control round-trips `chrome.storage.sync`, cache counts populate live, API key tests work |
| 3 | notepad/ | `src/pages/notepad/` (2 components); rewritten HTML; deleted old JS | Type in notepad, content.js word-wrapping still works on live target |
| 4 | morpheme-inspector/ | `src/pages/morpheme-inspector/` (4 components); rewritten HTML; deleted old JS | Type Korean, see single-path + n-best + candidate tables render live |
| 5 | popup/ (toolbar) | `src/pages/popup/` (5 components); rewritten HTML; deleted old JS | Site toggle works, adapter status shows, links open, Ko-fi banner renders |
| 6a | overlay infra | content.js surgery: delete ~1000 lines of DOM construction (663–1100+), `ensurePopup` reduced to thin host-mount, add `window.__lwsOverlay` consumer pattern; `src/overlay/main.ts` + minimal `App.svelte` skeleton acknowledging show/hide; bundle wired into manifest as WAR | Word hover → console shows show/hide calls; no popup visible (skeleton) |
| 6b | overlay components | All 9 components, scoped styles, `popup-shadow.css` mostly deleted (tokens moved to `src/overlay/styles/tokens.css`) | Full lookup flow renders; exclusive expand works; two-stage related reveal works; dedup invariant (f8afd99) preserved |

Splitting commit 6 into 6a+6b keeps each reviewable. If 6b regresses, 6a leaves the extension in a controlled "mount works, renders nothing" state for bisecting.

## Risks & mitigations

- **content.js bridge surgery in 6a is the highest-risk commit** — removing ~1000 lines while keeping ~900 lines of bridge logic working. Mitigation: 6a's verification is purely the mount path (show/hide calls fire from content.js), not rendering. Bisect-friendly split into 6a+6b.
- **CSS regressions in the overlay** — 856 lines getting redistributed. Mitigation: token file ports CSS variables 1:1; per-component `<style>` blocks lift styles from the original CSS without rewriting the selectors. Visual smoke test before committing 6b.
- **Build output in git creates noisy diffs.** Mitigation: accepted tradeoff per design decision 2 — keeps load-from-`extension/` workflow and store submission simple. Build output diffs are skippable at review.
- **TypeScript/plain-JS boundary drift.** Mitigation: contracts caught at runtime; documented in `src/lib/messages.ts` as the single source of truth; handlers in `background.js` change rarely.
- **Subagent commit races.** Mitigation: serialize all committing subagents per the established rule.

## What this migration does NOT do

- Doesn't change extension behavior (like-for-like rewrite)
- Doesn't migrate `background.js`, adapters, page-hooks, mecab glue, or any non-UI plain-JS file
- Doesn't introduce new dynamic-data features (those come after, on top of the new component model)
- Doesn't restructure DEVELOPMENT.md (split was done in prior work)
- Doesn't add CSS frameworks, design systems, or codegen beyond Vite's defaults

## Implementation handoff

After spec approval, invoke `superpowers:writing-plans` to produce a detailed implementation plan covering all 7 commits with bite-sized tasks. Implementation runs via subagents per established preference; committing subagents serialized.

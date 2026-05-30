# Storage and caching

Where every persistent bit lives, and how the four-namespace cache
layer works. Related reading:
[message-flows.md](message-flows.md) (the `clearCache` / `cacheCounts`
RPCs that drive the cache buttons),
[lookup-pipeline.md](lookup-pipeline.md) (the lookup hot path that
reads/writes the caches).

---

## Why split into sync and local

The extension uses both `chrome.storage.sync` and
`chrome.storage.local`. Sync is small, roams across the user's
signed-in browsers, and is rate-limited; local is unrestricted and
used for the caches and the per-video / per-title override maps.
The `unlimitedStorage` permission is declared in the manifest so the
cache can grow past the 5 MB default.

---

## `chrome.storage.sync` — settings

| Key                     | Type            | Default                    | Written by                              | Read by                                                                                       |
| ----------------------- | --------------- | -------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `krdictApiKey`          | string          | `""`                       | `pages/options/options.js`              | `background.js` (mirrored as `krKey`, refreshed via `onChanged`)                              |
| `opendictApiKey`        | string          | `""`                       | `pages/options/options.js`              | `background.js` (mirrored as `odKey`)                                                         |
| `defLang`               | `'en' \| 'ko'`  | `'en'`                     | `content.js` (popup toggle)             | `content.js` (popup render)                                                                   |
| `dualSubsYouTube`       | boolean         | `true`*                    | `pages/options/options.js`              | `adapters/youtube/adapter.js` (`onChanged` + `isEnabled()`)                                   |
| `dualSubsNetflix`       | boolean         | `true`*                    | `pages/options/options.js`              | `adapters/netflix/adapter.js` (`onChanged` + `isEnabled()`)                                   |
| `secondaryLang`         | string          | `'en'`                     | `pages/options/options.js`              | `adapters/youtube/adapter.js`, `adapters/netflix/adapter.js`, popup modules (default)         |
| `askAiPrompt`           | string          | unset → built-in default   | `pages/options/options.js` (Advanced section) | `content.js` (init + `onChanged` → `buildAskAiUrl`)                                     |
| `askAiProvider`         | string          | `'chatgpt'`                | `pages/options/options.js` (Advanced section) | `content.js` (picks URL prefix from `core/ai-providers.js`)                             |
| `askAiChatGptTemporary` | boolean         | `false`                    | `pages/options/options.js` (visible only when provider is ChatGPT) | `content.js` (appends `?temporary-chat=true` when checked)            |

*`dualSubsYouTube` and `dualSubsNetflix` default to `true` in each
adapter's `isEnabled()` — the setting is treated as "off only if
explicitly set to `false`". Each adapter's `isEnabled()` ALSO checks
`disabledHosts` (local) and bails when the current hostname is in the
list, so per-site disable tears down dual subs in addition to the
dictionary. On fresh install, `background.js` just opens the options
page so the user can paste their KRDict key — there is no global
on/off switch (the only soft-disable is per-site via `disabledHosts`,
and the only hard-disable is `chrome://extensions`).

### Ask-AI prompt template

The `askAiPrompt` template uses three placeholders: `{sentence}` (the
sentence with the focus word surrounded by backticks), `{word}` (the
focus word on its own), and `{language}` (the user's secondary-
language name, e.g. `"English"`). Substitution uses `split().join()`
rather than `String.replace()` so user templates containing
`$1`/`$&`/`$'` aren't mangled. Storing the value equal to the default
removes the key (the options page does this on blur), so the live
default in code is what's used.

`askAiProvider` is a key into the `AI_PROVIDERS` registry exported
from `extension/core/ai-providers.js`. Each entry contributes
`{ name, urlPrefix }`. Adding a provider is one entry — the options-
page dropdown is populated from the same registry, and `content.js`
imports it via `chrome.runtime.getURL`.

---

## `chrome.storage.local` — overrides, per-site, and L2 cache

| Key (or namespace)           | Type                  | Written by                                       | Read by                                                            |
| ---------------------------- | --------------------- | ------------------------------------------------ | ------------------------------------------------------------------ |
| `lookup:<surface>`           | `LookupResponse`      | `background.js` (`cache.set`)                    | `background.js` (`cache.get`)                                      |
| `hanja:<chars>`              | Hanja gloss array     | `background.js` (`hanjaCache.set`)               | `background.js`                                                    |
| `krdict:<lemma>`             | `{ xml, cachedAt }`   | `background.js` (`krdictCache.set`)              | `background.js` (`fetchKrdictCached`)                              |
| `opendict:<lemma>`           | `{ xml, cachedAt }`   | `background.js` (`opendictCache.set`)            | `background.js` (`fetchOpendictCached`)                            |
| `dualSubsOverrides`          | `{ [videoId]: lang }` | `adapters/youtube/popup.js` (per-video radio)    | `adapters/youtube/adapter.js` (`onChanged` + `resolveSecondaryLang`) |
| `dualSubsOverridesNetflix`   | `{ [titleId]: lang }` | `adapters/netflix/popup.js` (per-title dropdown) | `adapters/netflix/adapter.js` (`onChanged` + `resolveSecondaryLang`) |
| `disabledHosts`              | `string[]`            | `pages/popup/popup.js` (per-site toggle)         | `content.js` init + `onChanged`; adapters' `isEnabled()`           |

### Why `chrome.storage.local` (not `session`) for per-video overrides

`chrome.storage.session` is gated to "trusted contexts" by default in
MV3 — content scripts (where the adapters run) get a silent
permission denial. `chrome.storage.local` is unrestricted and has the
nice side-effect that per-video preferences survive a browser
restart.

### Why `chrome.storage.local` (not `sync`) for `disabledHosts`

`chrome.storage.sync` is rate-limited
(`MAX_WRITE_OPERATIONS_PER_MINUTE`, `QUOTA_BYTES_PER_ITEM`) and is
eventually-consistent with the cloud. Per-site toggle writes were
getting dropped — the user would toggle ON, refresh, and the page
would still see the host in the disabled list. `local` is per-device
with no quota concerns and writes through immediately.

---

## The four cache namespaces

The `core/cache.js` module (`createCache(adapter, { namespace })`) is
instantiated four times in the service worker:

| Namespace    | Key                | Value shape                                                                                          | Populated when                                       |
| ------------ | ------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `lookup:`    | `surface` (raw)    | Full `LookupResponse` — surface, lemma, candidates, tokens, krQueries, krXmls[], odXml, odQuery, tabs[], unrelated[], cachedAt | First successful lookup for a given surface          |
| `hanja:`     | concatenated Hanja | `{ chars, hanjas: [{character, sino, summary}], cachedAt }`                                          | First click on a Hanja origin chip                   |
| `krdict:`    | lemma string sent  | `{ xml, cachedAt }` — raw KRDict XML (even empty responses)                                          | First KRDict query for a given lemma                 |
| `opendict:`  | lemma string sent  | `{ xml, cachedAt }` — raw OpenDict XML                                                               | First OpenDict fallback query for a given lemma      |

All four namespaces share a single `chrome.storage.local` area but
`cache.clear()` only deletes keys with its own prefix, so clearing
any one cache does not touch the others.

### Why these four

- **`lookup:` is keyed by surface** (not lemma) — the popup re-renders
  from `lastPayload` and needs to know what surface the user actually
  hovered, including its sentence context. The cached value includes
  BOTH the raw `krXmls[]` / `odXml` AND the pre-computed
  `{tabs, unrelated}` grouping plan (so grouping doesn't repeat on
  every re-render or every re-load from disk). The raw XMLs are still
  needed because the content script parses entries on demand (one
  query's XML at a time, as a tab is opened).
- **`krdict:` and `opendict:` are keyed by lemma**. They sit between
  `handleLookup` and the network: before any `fetch` is issued,
  `fetchKrdictCached` / `fetchOpendictCached` check whether the lemma
  was already queried in this or a previous session. All responses
  are cached including empty ones — the goal is to avoid repeating
  the network call, not to filter results. Only thrown errors
  (network failure, 5xx) bypass the set path.
  Concrete benefit: a second hover on `먹었어요` after `먹었어` shares
  the cached `먹다` KRDict XML without re-firing.
- **`hanja:` is keyed by the full Hanja string** of one origin field
  — `豫約` and `學校` are separate entries; the hangulhanja.com API
  returns per-character glosses in one response per multi-character
  query.

---

## Two-tier cache: L1 + L2

`core/cache.js` is a two-tier factory.

**L1 — in-memory LRU `Map`.** Default limit 500 entries. Access
bumps recency (delete + re-insert). On full, the oldest insertion is
evicted. Map's insertion-order iteration plus delete-and-re-set on
access gives LRU for free.

Service workers in MV3 are killed after ~30 s of inactivity, so the
L1 is short-lived in practice — but on a busy reading session it
absorbs most lookups (the same word the user hovers twice in a
paragraph won't even need a storage read).

**L2 — injected storage adapter.** In production,
`chromeStorageAdapter(chrome.storage.local)`. Reads are awaited
Promise-style; writes are fire-and-forget but awaited in tests. All
keys are namespace-prefixed (`lookup:먹다`, `hanja:豫約`,
`krdict:먹다`, `opendict:먹다`) so multiple cache instances share
one storage area.

L2 reads write back to L1 (cold-cache promotion). L1 evicts on
overflow.

`clear()` only deletes namespace-prefixed keys when the storage
adapter supports `getKeys()` (it does in production —
`chrome.storage.local.getKeys()` has been available since Chrome
130). The fallback `storage.clear()` blows away everything; fine for
test adapters but never hit in production.

---

## Cache UI — per-namespace clear

The options page exposes three buttons, each with a live `(~N)` entry
count refreshed via the `cacheCounts` RPC:

- **Clear lookup cache** — wipes `lookup:` only
- **Clear Hanja cache** — wipes `hanja:` only
- **Clear all caches** — wipes all four (`lookup:`, `hanja:`,
  `krdict:`, `opendict:`)

Internally each button sends `{type: 'clearCache', target}` to the
service worker (`target ∈ 'lookup' | 'hanja' | 'dict' | 'all'`, with
`'dict'` covering both `krdict:` and `opendict:`). After the response
the page re-runs `cacheCounts` to refresh the labels. See
[message-flows.md](message-flows.md) for the exact wire shape.

---

## In-memory mirrors in the SW

Beyond the four `core/cache.js` instances, the service worker keeps a
tiny in-memory mirror of the two API keys (`krKey` / `odKey`),
populated once from `chrome.storage.sync` via `ensureSettings()` and
kept current via `storage.onChanged`. `handleLookup` reads the mirror
instead of re-issuing `sync.get` on every lookup — measurable savings
on busy reading sessions. The mirror is part of the lookup hot path's
warmup strategy (see [lookup-pipeline.md](lookup-pipeline.md)).

---

## Settings change propagation

`chrome.storage.onChanged` acts as a broadcast bus — the options
page never directly messages content scripts. The relevant listeners
fire in every open tab and respond. See the
"`chrome.storage.onChanged` as a side-channel" section in
[message-flows.md](message-flows.md) for the full listener table.

---

## Cache invalidation

There is no automatic cache invalidation. The cache grows
monotonically until the user clicks "Clear cache" in the options
page or until `chrome.storage.local` hits its quota (mitigated by
the `unlimitedStorage` permission).

`chrome.storage.local` keys aren't garbage-collected by the L1 LRU
— the L1 capacity bound applies only to the in-memory tier.

### Cache shape evolution

Old-shape `lookup:` cache entries (from before the
group-by-word + n-best landings — missing `tabs` / `unrelated` /
`krXmls[]`) render as the empty state on next hover. A "Clear
lookup cache" from the options page repopulates everything in the
new shape on subsequent lookups.
